"""自動連結：每門課一篇「課程首頁」，列出這門課的課堂筆記和待辦，讓 Obsidian 關係圖連起來。

    10 課堂筆記/The movie industry/The movie industry.md

首頁中 <!-- nova:auto --> 與 <!-- /nova:auto --> 之間由工作台自動產生（每次同步 / 待辦變動時更新），
這兩行以外的內容是你自己的，不會被覆蓋，可以寫課程大綱、評分方式等。
"""
import re
import threading
from datetime import date

import config
from services import vault

START, END = "<!-- nova:auto -->", "<!-- /nova:auto -->"
AUTO_RE = re.compile(re.escape(START) + r".*?" + re.escape(END), re.S)
_lock = threading.Lock()


def link(name: str) -> str:
    return f"[[{name}]]"


def unlink(value) -> str:
    """'[[X]]' / '[[X|別名]]' / 'X' → 'X'"""
    s = str(value or "").strip().strip('"')
    m = re.fullmatch(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]", s)
    return m.group(1).strip() if m else s


def courses() -> list[str]:
    from services import notion_sync
    return [c["name"] for c in notion_sync.status()["courses"]]


def hub_path(course: str) -> str:
    folder = vault.sanitize_filename(course)
    return f"{config.CLASS_NOTES_DIR}/{folder}/{folder}.md"


def _notes_by_course() -> dict[str, list[dict]]:
    from services import notion_sync
    out: dict[str, list[dict]] = {}
    for info in notion_sync._scan_existing().values():
        course = unlink(info["course"])
        out.setdefault(course, []).append(info)
    return out


def _auto_block(course: str, notes: list[dict], tasks: list[dict]) -> str:
    today = date.today().isoformat()
    lines = [START, "", "## 課堂筆記", ""]
    notes = sorted(notes, key=lambda n: (n.get("created", ""), n["title"]))
    lines += [f"- {link(n['title'])}" for n in notes] or ["- （還沒有課堂筆記）"]
    open_tasks = [t for t in tasks if not t["done"]]
    done_tasks = [t for t in tasks if t["done"]]
    lines += ["", "## 待辦", ""]
    for t in sorted(open_tasks, key=lambda t: (t["due"] or "9999", t["text"])):
        due = f" 📅 {t['due']}" + (" ⚠️ 逾期" if t["due"] < today else "") if t["due"] else ""
        lines.append(f"- [ ] {link(t['text'])}{due}")
    if not open_tasks:
        lines.append("- （沒有未完成的待辦）")
    if done_tasks:
        lines += ["", "<details><summary>已完成</summary>", ""]
        lines += [f"- [x] {link(t['text'])}" for t in done_tasks]
        lines += ["", "</details>"]
    lines += ["", f"<small>由 Nova Dashboard 自動更新：{today}</small>", "", END]
    return "\n".join(lines)


def rebuild_course_hubs() -> dict:
    """更新（或建立）每門課的首頁。只改自動區塊，其他內容保留。"""
    from services import tasks as tasks_svc
    with _lock:
        by_course = _notes_by_course()
        all_tasks = tasks_svc.list_tasks(include_done=True, done_days=3650)
        updated = []
        for course in sorted(set(by_course) | set(courses())):
            if not course or (course == "未分類" and course not in by_course):
                continue
            course_tasks = [t for t in all_tasks if course in [unlink(p) for p in t["projects"]]]
            block = _auto_block(course, by_course.get(course, []), course_tasks)
            rel = hub_path(course)
            p = vault.safe_path(rel)
            if p.exists():
                text = p.read_text(encoding="utf-8")
                new = AUTO_RE.sub(lambda _: block, text) if AUTO_RE.search(text) else text.rstrip() + "\n\n" + block + "\n"
            else:
                new = (
                    "---\ntype: course\ntags:\n- 課程\n---\n"
                    f"# {course}\n\n"
                    "> [!tip] 課程首頁\n> 下面的清單由工作台自動更新；在這行以上可以自由寫課程大綱、評分方式、教授聯絡方式等。\n\n"
                    + block + "\n"
                )
            if not p.exists() or p.read_text(encoding="utf-8") != new:
                vault.write_note(rel, new)
                updated.append(rel)
    return {"updated": updated}
