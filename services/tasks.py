"""待辦：直接讀寫 Obsidian TaskNotes 外掛的格式（一個待辦 = 一篇筆記）。

    TaskNotes/Tasks/交行銷報告.md
    ---
    status: open
    priority: normal
    due: 2026-10-20
    scheduled: 2026-10-19
    dateCreated: 2026-10-19T10:00:00.000+02:00
    dateModified: 2026-10-19T10:00:00.000+02:00
    tags:
      - task
      - 行銷
    ---
    （筆記內容：作業要求、連結…）

設定（任務資料夾、識別標籤、欄位名稱、狀態、優先度）直接讀 vault 裡 TaskNotes 的 data.json，
所以在 Obsidian 改了 TaskNotes 設定，工作台也會跟著用。待辦的 id 是它在 vault 中的相對路徑。
"""
import json
import re
import threading
from datetime import date, datetime
from urllib.parse import quote

import yaml

import config
from services import links, vault

FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n?", re.S)
TAG_RE = re.compile(r"(?<!\S)#([^\s#]+)")
SKIP_DIRS = {".obsidian", ".trash", ".git"}
_lock = threading.Lock()

DEFAULTS = {
    "tasksFolder": "TaskNotes/Tasks",
    "taskTag": "task",
    "taskIdentificationMethod": "tag",
    "taskPropertyName": "",
    "taskPropertyValue": "",
    "storeTitleInFilename": True,
    "defaultTaskStatus": "open",
    "defaultTaskPriority": "normal",
    "excludedFolders": "",
    "fieldMapping": {},
    "customStatuses": [
        {"value": "open", "label": "Open", "color": "#808080", "isCompleted": False},
        {"value": "in-progress", "label": "In progress", "color": "#0066cc", "isCompleted": False},
        {"value": "done", "label": "Done", "color": "#00aa00", "isCompleted": True},
    ],
    "customPriorities": [
        {"value": "low", "label": "Low", "color": "#00aa00", "weight": 1},
        {"value": "normal", "label": "Normal", "color": "#ffaa00", "weight": 2},
        {"value": "high", "label": "High", "color": "#ff0000", "weight": 3},
    ],
    "taskCreationDefaults": {},
}
FIELDS = {  # TaskNotes 內部名稱 → 預設屬性名（使用者可在 TaskNotes 設定改名）
    "title": "title", "status": "status", "priority": "priority", "due": "due", "scheduled": "scheduled",
    "contexts": "contexts", "projects": "projects", "completedDate": "completedDate",
    "dateCreated": "dateCreated", "dateModified": "dateModified", "recurrence": "recurrence",
    "completeInstances": "complete_instances", "archiveTag": "archived",
}


class TaskNotFound(Exception):
    pass


# ---------- YAML：時間字串保持原樣（不要被轉成 datetime，免得寫回時格式改變） ----------

class _Loader(yaml.SafeLoader):
    pass


class _Dumper(yaml.SafeDumper):
    pass


# 讀：日期/時間保持字串；寫：日期字串不加引號（和 TaskNotes 寫出來的一樣）
for _cls, _base in ((_Loader, yaml.SafeLoader), (_Dumper, yaml.SafeDumper)):
    _cls.yaml_implicit_resolvers = {
        k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
        for k, v in _base.yaml_implicit_resolvers.items()
    }


def _split(text: str) -> tuple[dict, str] | None:
    m = FM_RE.match(text)
    if not m:
        return None
    try:
        fm = yaml.load(m.group(1), Loader=_Loader) or {}
    except yaml.YAMLError:
        return None
    return (fm, text[m.end():]) if isinstance(fm, dict) else None


def _dump(fm: dict, body: str) -> str:
    head = yaml.dump(fm, Dumper=_Dumper, allow_unicode=True, sort_keys=False, default_flow_style=False, width=1000).strip()
    return f"---\n{head}\n---\n{body}"


# ---------- TaskNotes 設定 ----------

_settings_cache: tuple[float, dict] | None = None


def settings() -> dict:
    global _settings_cache
    p = vault.safe_path(".obsidian/plugins/tasknotes/data.json")
    mtime = p.stat().st_mtime if p.exists() else 0
    if _settings_cache and _settings_cache[0] == mtime:
        return _settings_cache[1]
    s = dict(DEFAULTS)
    if p.exists():
        try:
            s.update({k: v for k, v in json.loads(p.read_text(encoding="utf-8")).items() if v is not None})
        except (json.JSONDecodeError, OSError):
            pass
    s["fields"] = {**FIELDS, **{k: v for k, v in (s.get("fieldMapping") or {}).items() if k in FIELDS and v}}
    s["installed"] = p.exists()
    _settings_cache = (mtime, s)
    return s


def meta() -> dict:
    """前端用：狀態、優先度選項（含顏色）、TaskNotes 是否安裝。"""
    s = settings()
    pick = lambda xs, keys: [{k: x.get(k) for k in keys} for x in xs if x.get("value") != "none"]
    return {
        "installed": s["installed"],
        "folder": s["tasksFolder"],
        "statuses": pick(s["customStatuses"], ("value", "label", "color", "isCompleted")),
        "priorities": pick(s["customPriorities"], ("value", "label", "color", "weight")),
        "courses": links.courses(),  # 待辦可以歸到哪門課（寫進 TaskNotes 的 projects）
    }


def _done_status(s) -> str:
    return next((x["value"] for x in s["customStatuses"] if x.get("isCompleted")), "done")


def _completed_values(s) -> set[str]:
    return {x["value"] for x in s["customStatuses"] if x.get("isCompleted")}


# ---------- 讀取 ----------

def _as_list(v) -> list:
    if v is None or v == "":
        return []
    return [str(x) for x in v] if isinstance(v, list) else [str(v)]


def _is_task(fm: dict, s) -> bool:
    if s["taskIdentificationMethod"] == "property" and s.get("taskPropertyName"):
        return str(fm.get(s["taskPropertyName"], "")).lower() == str(s.get("taskPropertyValue", "")).lower()
    tags = [t.lstrip("#") for t in _as_list(fm.get("tags"))]
    tag = s["taskTag"]
    return tag in tags or any(t.startswith(tag + "/") for t in tags)


def _excluded(rel_path: str, s) -> bool:
    parts = rel_path.split("/")
    if SKIP_DIRS.intersection(parts):
        return True
    for folder in str(s.get("excludedFolders") or "").split(","):
        folder = folder.strip().strip("/")
        if folder and (rel_path == folder or rel_path.startswith(folder + "/")):
            return True
    return False


def _date_part(v) -> str | None:
    v = str(v or "").strip()
    return v[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", v) else None


def _to_task(rel_path: str, fm: dict, s) -> dict:
    f = s["fields"]
    status = str(fm.get(f["status"]) or s["defaultTaskStatus"])
    recurrence = fm.get(f["recurrence"])
    recurring = bool(recurrence)
    today = date.today().isoformat()
    instances = _as_list(fm.get(f["completeInstances"]))
    done = (today in instances) if recurring else status in _completed_values(s)
    filename_title = rel_path.rsplit("/", 1)[-1][:-3]
    # 「標題存在檔名」開啟時以檔名為準；否則用 title 屬性（沒有就退回檔名）
    title = filename_title if s["storeTitleInFilename"] else (fm.get(f["title"]) or filename_title)
    tags = [t.lstrip("#") for t in _as_list(fm.get("tags")) if t.lstrip("#") != s["taskTag"]]
    due = fm.get(f["due"])
    return {
        "id": rel_path,
        "path": rel_path,
        "text": str(title),
        "done": done,
        "status": status,
        "priority": str(fm.get(f["priority"]) or s["defaultTaskPriority"]),
        "due": _date_part(due),
        "due_time": str(due)[11:16] if due and len(str(due)) >= 16 else None,
        "scheduled": _date_part(fm.get(f["scheduled"])),
        "done_date": today if recurring and done else _date_part(fm.get(f["completedDate"])),
        "tags": tags,
        "contexts": _as_list(fm.get(f["contexts"])),
        "projects": _as_list(fm.get(f["projects"])),
        "recurring": recurring,
        "obsidian_uri": f"obsidian://open?vault={quote(vault.vault_name())}&file={quote(rel_path)}",
    }


def _all() -> list[dict]:
    s = settings()
    out = []
    for p in config.VAULT_PATH.rglob("*.md"):
        rel = vault.rel(p)
        if _excluded(rel, s):
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if not text.startswith("---"):
            continue
        parsed = _split(text)
        if not parsed or not _is_task(parsed[0], s):
            continue
        fm = parsed[0]
        if s["fields"]["archiveTag"] in [t.lstrip("#") for t in _as_list(fm.get("tags"))]:
            continue  # 已封存
        out.append(_to_task(rel, fm, s))
    return out


def list_tasks(include_done: bool = False, done_days: int = 7) -> list[dict]:
    """未完成的全部列出；已完成的只列最近 done_days 天內完成的。"""
    today = date.today()
    weight = {p["value"]: p.get("weight", 0) for p in settings()["customPriorities"]}
    out = []
    for t in _all():
        if t["done"]:
            if not include_done:
                continue
            if t["done_date"] and (today - date.fromisoformat(t["done_date"])).days > done_days:
                continue
        out.append(t)
    # 未完成在前 → 有日期的依日期 → 優先度高的在前 → 標題
    key_date = lambda t: t["due"] or t["scheduled"]
    out.sort(key=lambda t: (t["done"], key_date(t) is None, key_date(t) or "", -weight.get(t["priority"], 0), t["text"]))
    return out


# ---------- 寫入 ----------

def _now_ts() -> str:
    """與 TaskNotes 相同的時間格式：2026-10-19T10:00:00.000+02:00"""
    n = datetime.now().astimezone()
    off = n.strftime("%z")
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}" + f"{off[:3]}:{off[3:]}"


def _check_date(d: str | None) -> str | None:
    if not d:
        return None
    date.fromisoformat(d[:10])  # 格式錯誤會丟 ValueError → 400
    return d


def _safe_title(title: str) -> str:
    """與 TaskNotes 相同的檔名清理規則。"""
    t = re.sub(r"\s+", " ", title.strip())
    t = re.sub(r'[<>:"/\\|?*#\[\]]', "", t)
    t = "".join(c for c in t if not (ord(c) <= 31 or 127 <= ord(c) <= 159)).strip(". ").strip()
    return t[:200] or "untitled"


def _unique(folder: str, name: str, current: str | None = None) -> str:
    rel = f"{folder}/{name}.md" if folder else f"{name}.md"
    i = 1
    while vault.safe_path(rel).exists() and rel != current:
        rel = f"{folder}/{name} {i}.md" if folder else f"{name} {i}.md"
        i += 1
    return rel


def _zettel() -> str:
    """TaskNotes 的 zettel 檔名：yyMMdd + 當天秒數（36 進位）。"""
    n = datetime.now()
    secs = n.hour * 3600 + n.minute * 60 + n.second
    digits, x = "", secs
    while True:
        digits = "0123456789abcdefghijklmnopqrstuvwxyz"[x % 36] + digits
        x //= 36
        if not x:
            break
    return n.strftime("%y%m%d") + digits


def add_task(text: str, due: str | None = None, priority: str | None = None, scheduled: str | None = None,
             project: str | None = None) -> dict:
    s = settings()
    f = s["fields"]
    text = text.replace("\n", " ").strip()
    tags = list(dict.fromkeys(TAG_RE.findall(text)))
    title = TAG_RE.sub("", text).strip() or text
    if not title:
        raise ValueError("待辦內容不可空白")
    defaults = s.get("taskCreationDefaults") or {}
    if not scheduled and defaults.get("defaultScheduledDate") == "today":
        scheduled = date.today().isoformat()
    now = _now_ts()
    fm: dict = {}
    if not s["storeTitleInFilename"]:
        fm[f["title"]] = title
    fm[f["status"]] = s["defaultTaskStatus"]
    fm[f["priority"]] = priority or s["defaultTaskPriority"]
    if _check_date(due):
        fm[f["due"]] = due
    if _check_date(scheduled):
        fm[f["scheduled"]] = scheduled
    if project:
        fm[f["projects"]] = [links.link(project)]  # 連到課程首頁
    fm[f["dateCreated"]] = now
    fm[f["dateModified"]] = now
    if s["taskIdentificationMethod"] == "property" and s.get("taskPropertyName"):
        fm[s["taskPropertyName"]] = s.get("taskPropertyValue") or True
        if tags:
            fm["tags"] = tags
    else:
        fm["tags"] = [s["taskTag"], *tags]
    folder = str(s["tasksFolder"] or "").strip("/")
    with _lock:
        name = _safe_title(title) if s["storeTitleInFilename"] else _zettel()
        rel = _unique(folder, name)
        vault.write_note(rel, _dump(fm, ""))
    if project:
        links.rebuild_course_hubs()
    return {"ok": True, "id": rel}


def _load(task_id: str):
    s = settings()
    p = vault.safe_path(task_id)
    if not p.exists() or not task_id.endswith(".md"):
        raise TaskNotFound("找不到這項待辦（可能已在 Obsidian 被移動或刪除），請重新整理")
    parsed = _split(p.read_text(encoding="utf-8"))
    if not parsed or not _is_task(parsed[0], s):
        raise TaskNotFound("這篇筆記不是 TaskNotes 待辦")
    return s, p, parsed[0], parsed[1]


def update_task(task_id: str, text: str | None = None, done: bool | None = None,
                due: str | None = None, clear_due: bool = False, priority: str | None = None,
                status: str | None = None, scheduled: str | None = None, clear_scheduled: bool = False,
                project: str | None = None, clear_project: bool = False) -> dict:
    with _lock:
        s, p, fm, body = _load(task_id)
        f = s["fields"]
        today = date.today().isoformat()
        recurring = bool(fm.get(f["recurrence"]))
        was_done = (today in _as_list(fm.get(f["completeInstances"]))) if recurring             else str(fm.get(f["status"])) in _completed_values(s)
        had_project = bool(_as_list(fm.get(f["projects"])))

        if done is not None and recurring:
            # 重複待辦：完成「今天這一次」，記在 complete_instances（TaskNotes 的作法）
            inst = _as_list(fm.get(f["completeInstances"]))
            if done and today not in inst:
                inst.append(today)
            if not done and today in inst:
                inst.remove(today)
            fm[f["completeInstances"]] = inst
        elif done is not None:
            status = _done_status(s) if done else s["defaultTaskStatus"]

        if status is not None:
            fm[f["status"]] = status
            if status in _completed_values(s) and not recurring:
                fm.setdefault(f["completedDate"], today)
            else:
                fm.pop(f["completedDate"], None)
        if priority:
            fm[f["priority"]] = priority
        if clear_project:
            fm.pop(f["projects"], None)
        elif project:
            fm[f["projects"]] = [links.link(project)]
        if clear_due:
            fm.pop(f["due"], None)
        elif _check_date(due):
            fm[f["due"]] = due
        if clear_scheduled:
            fm.pop(f["scheduled"], None)
        elif _check_date(scheduled):
            fm[f["scheduled"]] = scheduled
        fm[f["dateModified"]] = _now_ts()

        new_id = task_id
        if text is not None:
            title = TAG_RE.sub("", text.replace("\n", " ")).strip()
            if not title:
                raise ValueError("待辦內容不可空白")
            if s["storeTitleInFilename"]:
                folder = task_id.rsplit("/", 1)[0] if "/" in task_id else ""
                new_id = _unique(folder, _safe_title(title), current=task_id)
            else:
                fm[f["title"]] = title
        vault.write_note(new_id, _dump(fm, body))
        if new_id != task_id:
            p.unlink()
        now_done = (today in _as_list(fm.get(f["completeInstances"]))) if recurring             else str(fm.get(f["status"])) in _completed_values(s)
    title = new_id.rsplit("/", 1)[-1][:-3]
    if now_done and not was_done:
        from services import journal
        journal.log_done(title)  # 今天的日記記一筆「完成的待辦」→ 連到待辦
    if had_project or project or clear_project:
        links.rebuild_course_hubs()
    return {"ok": True, "id": new_id}


def delete_task(task_id: str) -> dict:
    """移到 vault 的 .trash（Obsidian 的垃圾桶），可以在 Obsidian 還原。"""
    with _lock:
        _, _, fm, _ = _load(task_id)  # 確認真的是待辦
        result = vault.trash_note(task_id)
    if _as_list(fm.get(settings()["fields"]["projects"])):
        links.rebuild_course_hubs()
    return result


def due_between(start: date, end: date) -> list[dict]:
    """行事曆用：截止日（沒有截止日就用排程日）落在 [start, end) 的待辦。"""
    out = []
    for t in list_tasks(include_done=True, done_days=3650):
        d = t["due"] or t["scheduled"]
        if d and start <= date.fromisoformat(d) < end:
            out.append(t)
    return out
