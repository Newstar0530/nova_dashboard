"""待辦清單：存在 vault 的一個 Markdown 檔，格式與 Obsidian Tasks 外掛相容。

    - [ ] 交報告 #行銷 📅 2026-10-20
    - [x] 繳學費 📅 2026-10-15 ✅ 2026-10-14

每項待辦的 id 由「該行內容 + 第幾次出現」算出；內容一改 id 就變，前端操作後重新載入清單即可。
"""
import hashlib
import re
import threading
from datetime import date

import config
from services import vault

TASK_RE = re.compile(r"^(\s*)- \[( |x|X)\] (.*)$")
DUE_RE = re.compile(r"\s*📅\s*(\d{4}-\d{2}-\d{2})")
DONE_RE = re.compile(r"\s*✅\s*(\d{4}-\d{2}-\d{2})")
TAG_RE = re.compile(r"(?<!\S)#([^\s#]+)")
HEADER = "# 待辦\n\n由 Nova Dashboard 管理，也可以直接在 Obsidian 編輯（格式相容 Tasks 外掛）。\n\n"

_lock = threading.Lock()


class TaskNotFound(Exception):
    pass


def _path():
    return vault.safe_path(config.TASKS_FILE)


def _read_lines() -> list[str]:
    p = _path()
    return p.read_text(encoding="utf-8").splitlines() if p.exists() else []


def _write_lines(lines: list[str]):
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")


def _ids(lines: list[str]):
    """逐行產生 (行號, id, match)。"""
    seen: dict[str, int] = {}
    for i, line in enumerate(lines):
        m = TASK_RE.match(line)
        if not m:
            continue
        h = hashlib.sha1(line.strip().encode("utf-8")).hexdigest()[:10]
        seen[h] = seen.get(h, 0) + 1
        yield i, f"{h}-{seen[h]}", m


def _parse(task_id: str, m: re.Match) -> dict:
    body = m.group(3)
    due = DUE_RE.search(body)
    done_on = DONE_RE.search(body)
    text = DONE_RE.sub("", DUE_RE.sub("", body)).strip()
    return {
        "id": task_id,
        "text": text,
        "done": m.group(2).lower() == "x",
        "due": due.group(1) if due else None,
        "done_date": done_on.group(1) if done_on else None,
        "tags": TAG_RE.findall(text),
        "indent": len(m.group(1)),
    }


def _format(text: str, done: bool, due: str | None, done_date: str | None, indent: int = 0) -> str:
    line = f"{' ' * indent}- [{'x' if done else ' '}] {text.strip()}"
    if due:
        line += f" 📅 {due}"
    if done and done_date:
        line += f" ✅ {done_date}"
    return line


def _check_date(d: str | None) -> str | None:
    if not d:
        return None
    date.fromisoformat(d)  # 格式錯誤會丟 ValueError → 400
    return d


def list_tasks(include_done: bool = False, done_days: int = 7) -> list[dict]:
    """未完成的全部列出；已完成的只列最近 done_days 天內完成的。"""
    today = date.today()
    out = []
    for _, tid, m in _ids(_read_lines()):
        t = _parse(tid, m)
        if t["done"]:
            if not include_done:
                continue
            if t["done_date"] and (today - date.fromisoformat(t["done_date"])).days > done_days:
                continue
        out.append(t)
    # 排序：未完成在前 → 有截止日的依日期 → 沒截止日的
    out.sort(key=lambda t: (t["done"], t["due"] is None, t["due"] or "", t["done_date"] or ""))
    return out


def add_task(text: str, due: str | None = None) -> dict:
    text = text.replace("\n", " ").strip()
    if not text:
        raise ValueError("待辦內容不可空白")
    with _lock:
        lines = _read_lines() or HEADER.splitlines()
        lines.append(_format(text, False, _check_date(due), None))
        _write_lines(lines)
    return {"ok": True}


def _find(lines: list[str], task_id: str):
    for i, tid, m in _ids(lines):
        if tid == task_id:
            return i, _parse(tid, m)
    raise TaskNotFound("找不到這項待辦（可能已在 Obsidian 被修改），請重新整理")


def update_task(task_id: str, text: str | None = None, done: bool | None = None,
                due: str | None = None, clear_due: bool = False) -> dict:
    with _lock:
        lines = _read_lines()
        i, t = _find(lines, task_id)
        new_done = t["done"] if done is None else done
        done_date = t["done_date"]
        if new_done and not t["done"]:
            done_date = date.today().isoformat()
        if not new_done:
            done_date = None
        new_due = None if clear_due else (_check_date(due) if due else t["due"])
        new_text = text.replace("\n", " ").strip() if text is not None else t["text"]
        if not new_text:
            raise ValueError("待辦內容不可空白")
        lines[i] = _format(new_text, new_done, new_due, done_date, t["indent"])
        _write_lines(lines)
    return {"ok": True}


def delete_task(task_id: str) -> dict:
    with _lock:
        lines = _read_lines()
        i, _ = _find(lines, task_id)
        del lines[i]
        _write_lines(lines)
    return {"ok": True}


def due_between(start: date, end: date) -> list[dict]:
    """行事曆用：截止日在 [start, end) 之間的待辦。"""
    out = []
    for t in list_tasks(include_done=True, done_days=3650):
        if t["due"] and start <= date.fromisoformat(t["due"]) < end:
            out.append(t)
    return out
