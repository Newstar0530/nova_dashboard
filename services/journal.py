"""每日紀錄：日記、心情、習慣打卡、學習時數。

每天一篇 `40 紀錄/日記/YYYY-MM-DD.md`，數值放 frontmatter（Obsidian 屬性 / Dataview 可直接用）：

    ---
    date: 2026-10-19
    mood: 4
    habits: [運動, 背單字]
    study: {微積分: 50, 行銷: 25}
    tags: [日記]
    ---
    # 2026-10-19 星期一

    ## 日記
    今天……

    ## 學習紀錄
    - 09:00 微積分 50 分鐘

習慣與科目清單存在 `40 紀錄/設定.md` 的 frontmatter。
"""
import re
import threading
from datetime import date, datetime, timedelta

import yaml

import config
from services import vault

FM_RE = re.compile(r"\A---\n(.*?)\n---\n?", re.S)
WEEKDAYS = "一二三四五六日"
DEFAULT_HABITS = ["運動", "背單字", "早睡"]
_lock = threading.Lock()


# ---------- 讀寫工具 ----------

def _split(text: str) -> tuple[dict, str]:
    text = text.replace("\r\n", "\n")
    m = FM_RE.match(text)
    if not m:
        return {}, text
    try:
        fm = yaml.safe_load(m.group(1)) or {}
    except yaml.YAMLError:
        fm = {}
    return (fm if isinstance(fm, dict) else {}), text[m.end():]


def _join(fm: dict, body: str) -> str:
    head = yaml.safe_dump(fm, allow_unicode=True, sort_keys=False, default_flow_style=None).strip()
    return f"---\n{head}\n---\n{body.lstrip(chr(10))}"


def _sections(body: str) -> list[tuple[str | None, str]]:
    """依「## 標題」切段：[(標題或 None, 內容)]。"""
    parts: list[tuple[str | None, str]] = []
    current, buf = None, []
    for line in body.split("\n"):
        h = re.match(r"^## (.+?)\s*$", line)
        if h:
            parts.append((current, "\n".join(buf)))
            current, buf = h.group(1), []
        else:
            buf.append(line)
    parts.append((current, "\n".join(buf)))
    return parts


def _render_sections(parts: list[tuple[str | None, str]]) -> str:
    out = []
    for title, content in parts:
        if title is None:
            out.append(content.strip("\n"))
        else:
            out.append(f"## {title}\n{content.strip(chr(10))}".rstrip())
    return "\n\n".join(p for p in out if p) + "\n"


def _set_section(body: str, title: str, content: str) -> str:
    parts = _sections(body)
    for i, (t, _) in enumerate(parts):
        if t == title:
            parts[i] = (t, content)
            break
    else:
        parts.append((title, content))
    return _render_sections(parts)


def _get_section(body: str, title: str) -> str:
    return next((c.strip("\n") for t, c in _sections(body) if t == title), "")


def _day_path(d: date):
    return vault.safe_path(f"{config.RECORDS_DIR}/日記/{d.isoformat()}.md")


def _new_body(d: date) -> str:
    return f"# {d.isoformat()} 星期{WEEKDAYS[d.weekday()]}\n\n## 日記\n\n## 學習紀錄\n"


def _load(d: date) -> tuple[dict, str, bool]:
    p = _day_path(d)
    if not p.exists():
        return {"date": d, "tags": ["日記"]}, _new_body(d), False
    fm, body = _split(p.read_text(encoding="utf-8"))
    return fm, body, True


def _save(d: date, fm: dict, body: str):
    fm.setdefault("date", d)
    fm.setdefault("tags", ["日記"])
    p = _day_path(d)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(_join(fm, body), encoding="utf-8")


def _summary(d: date, fm: dict, body: str, exists: bool) -> dict:
    mood = fm.get("mood")
    study = fm.get("study") or {}
    return {
        "date": d.isoformat(),
        "exists": exists,
        "path": vault.rel(_day_path(d)),
        "mood": mood if isinstance(mood, int) else None,
        "habits": [str(h) for h in (fm.get("habits") or [])],
        "study": {str(k): int(v) for k, v in study.items() if isinstance(v, (int, float))} if isinstance(study, dict) else {},
        "diary": _get_section(body, "日記"),
        "study_log": _get_section(body, "學習紀錄"),
    }


def parse_date(s: str) -> date:
    return date.today() if s == "today" else date.fromisoformat(s)


# ---------- 設定（習慣、科目） ----------

def _settings_path():
    return vault.safe_path(f"{config.RECORDS_DIR}/設定.md")


def settings() -> dict:
    p = _settings_path()
    fm = _split(p.read_text(encoding="utf-8"))[0] if p.exists() else {}
    habits = [str(h) for h in fm.get("habits", DEFAULT_HABITS) or []]
    subjects = [str(s) for s in fm.get("subjects", []) or []]
    if not subjects:  # 預設用 Notion 同步過來的課程
        from services import notion_sync
        subjects = [c["name"] for c in notion_sync.status()["courses"]] + ["其他"]
    return {"habits": habits, "subjects": subjects}


def save_settings(habits: list[str], subjects: list[str]) -> dict:
    clean = lambda xs: list(dict.fromkeys(x.strip() for x in xs if x and x.strip()))
    fm = {"habits": clean(habits), "subjects": clean(subjects)}
    body = "# 紀錄設定\n\n工作台的習慣打卡項目與學習科目，可在工作台或這裡修改。\n"
    with _lock:
        p = _settings_path()
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(_join(fm, body), encoding="utf-8")
    return settings()


# ---------- 單日操作 ----------

def get_day(d: date) -> dict:
    return _summary(d, *_load(d))


def set_mood(d: date, mood: int | None) -> dict:
    if mood is not None and not 1 <= mood <= 5:
        raise ValueError("心情分數要在 1–5 之間")
    with _lock:
        fm, body, _ = _load(d)
        if mood is None:
            fm.pop("mood", None)
        else:
            fm["mood"] = mood
        _save(d, fm, body)
    return get_day(d)


def set_diary(d: date, text: str) -> dict:
    with _lock:
        fm, body, _ = _load(d)
        _save(d, fm, _set_section(body, "日記", "\n" + text.strip() + "\n" if text.strip() else ""))
    return get_day(d)


def set_habit(d: date, habit: str, done: bool) -> dict:
    with _lock:
        fm, body, _ = _load(d)
        habits = [str(h) for h in (fm.get("habits") or [])]
        if done and habit not in habits:
            habits.append(habit)
        if not done and habit in habits:
            habits.remove(habit)
        fm["habits"] = habits
        _save(d, fm, body)
    return get_day(d)


def add_study(d: date, subject: str, minutes: int, start: str | None = None, note: str = "") -> dict:
    subject = subject.strip() or "其他"
    if not 1 <= minutes <= 24 * 60:
        raise ValueError("分鐘數不正確")
    with _lock:
        fm, body, _ = _load(d)
        study = fm.get("study") if isinstance(fm.get("study"), dict) else {}
        study[subject] = int(study.get(subject, 0)) + minutes
        fm["study"] = study
        log = _get_section(body, "學習紀錄")
        when = start or datetime.now().strftime("%H:%M")
        line = f"- {when} {subject} {minutes} 分鐘" + (f"：{note.strip()}" if note.strip() else "")
        body = _set_section(body, "學習紀錄", "\n" + (log + "\n" if log else "") + line + "\n")
        _save(d, fm, body)
    return get_day(d)


# ---------- 統計 ----------

def stats(days: int = 84) -> dict:
    today = date.today()
    habit_names = settings()["habits"]
    rows = []
    for i in range(days - 1, -1, -1):
        d = today - timedelta(days=i)
        fm, body, exists = _load(d)
        s = _summary(d, fm, body, exists)
        rows.append({
            "date": s["date"],
            "mood": s["mood"],
            "habits": s["habits"],
            "study": s["study"],
            "study_total": sum(s["study"].values()),
            "has_diary": bool(s["diary"].strip()),
        })

    def streak(name: str) -> int:
        n = 0
        # 今天還沒打卡不算斷，從昨天開始算
        for r in reversed(rows if name in rows[-1]["habits"] else rows[:-1]):
            if name not in r["habits"]:
                break
            n += 1
        return n

    return {
        "days": rows,
        "habits": [{"name": h, "streak": streak(h), "total": sum(h in r["habits"] for r in rows)} for h in habit_names],
    }
