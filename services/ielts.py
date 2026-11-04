"""IELTS card on the Today page: reads the vault's `30 雅思` folder (the /ielts skill's data).

Everything comes from the notes the /ielts skill maintains:
- 學習計畫.md frontmatter: target_band, exam_date, phase, current_band; the "Weekly rotation" table
- 單字/ 句型/ 文法/ cards: next_review (spaced repetition)
- 寫作/ 口說/ 聽力/ 閱讀/ practice notes: status "to review" / "to analyse"
- 每週回顧/ latest weekly review: "Next week's focus"
- today's study minutes for subjects starting with "IELTS" (daily record)
"""
import re
from datetime import date
from urllib.parse import quote

import yaml

from services import journal, vault

ROOT = "30 雅思"
CARD_DIRS = {"單字": "words", "句型": "patterns", "文法": "grammar"}
PRACTICE_DIRS = ["寫作", "口說", "聽力", "閱讀"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
# Same as the plan's table; used when the table can't be read
DEFAULT_ROTATION = {
    "Mon": "Listening", "Tue": "Reading", "Wed": "Writing Task 2", "Thu": "Speaking",
    "Fri": "Listening + Reading", "Sat": "Writing Task 1 + Speaking", "Sun": "Weekly review",
}
FM_RE = re.compile(r"\A---\r?\n(.*?)\r?\n---", re.S)


def _fm(path) -> dict:
    try:
        m = FM_RE.match(path.read_text(encoding="utf-8"))
        data = yaml.safe_load(m.group(1)) if m else None
    except (OSError, UnicodeDecodeError, yaml.YAMLError):
        return {}
    return data if isinstance(data, dict) else {}


def _as_date(v) -> date | None:
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except (TypeError, ValueError):
        return None


def _rotation(plan_text: str) -> dict:
    """Rows like `| Mon | Listening | ... |` under '## Weekly rotation'."""
    section = plan_text.split("## Weekly rotation", 1)[-1].split("\n## ", 1)[0] if "## Weekly rotation" in plan_text else ""
    rows = re.findall(r"^\|\s*(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s*\|\s*([^|]+?)\s*\|", section, re.M)
    return {**DEFAULT_ROTATION, **dict(rows)} if rows else dict(DEFAULT_ROTATION)


def _focus_subject(skill: str) -> str | None:
    """Map today's skill to a focus-timer subject (the /ielts skill logs time under these)."""
    s = skill.lower()
    for key, subject in (("listening", "IELTS Listening"), ("reading", "IELTS Reading"),
                         ("writing", "IELTS Writing"), ("speaking", "IELTS Speaking")):
        if key in s:
            return subject
    return None


def _weekly_focus(root) -> list[str]:
    folder = root / "每週回顧"
    notes = sorted(folder.glob("*.md")) if folder.exists() else []
    if not notes:
        return []
    text = notes[-1].read_text(encoding="utf-8")
    if "## Next week's focus" not in text:
        return []
    block = text.split("## Next week's focus", 1)[1].split("\n## ", 1)[0]
    return [re.sub(r"^\s*[-*]\s*", "", line).strip() for line in block.splitlines() if re.match(r"^\s*[-*]\s+\S", line)][:3]


def status() -> dict:
    root = vault.safe_path(ROOT)
    plan_path = root / "學習計畫.md"
    if not plan_path.exists():
        return {"available": False}

    today = date.today()
    plan = _fm(plan_path)
    plan_text = plan_path.read_text(encoding="utf-8")
    phase = str(plan.get("phase") or "Diagnostic")
    exam = _as_date(plan.get("exam_date"))
    bands = plan.get("current_band") if isinstance(plan.get("current_band"), dict) else {}

    # Today's skill (Final sprint: mock tests on Mon and Thu, mistakes on other days)
    weekday = DAYS[today.weekday()]
    if phase.lower() == "final sprint":
        skill = "Full mock test" if weekday in ("Mon", "Thu") else "Review mistakes"
    else:
        skill = _rotation(plan_text).get(weekday, "")

    # Cards due (next_review <= today), and when the next ones come up
    due = {v: 0 for v in CARD_DIRS.values()}
    upcoming: list[date] = []
    total_cards = 0
    for folder, kind in CARD_DIRS.items():
        d = root / folder
        for p in (d.glob("*.md") if d.exists() else []):
            nr = _as_date(_fm(p).get("next_review"))
            total_cards += 1
            if nr and nr <= today:
                due[kind] += 1
            elif nr:
                upcoming.append(nr)

    waiting = []
    for folder in PRACTICE_DIRS:
        d = root / folder
        for p in (d.glob("*.md") if d.exists() else []):
            if str(_fm(p).get("status", "")).strip() in ("to review", "to analyse"):
                waiting.append({"title": p.stem, "path": vault.rel(p)})

    day = journal.get_day(today)
    minutes = sum(m for s, m in day["study"].items() if s.upper().startswith("IELTS"))

    return {
        "available": True,
        "phase": phase,
        "target_band": plan.get("target_band") or 7.5,
        "exam_date": exam.isoformat() if exam else None,
        "days_to_exam": (exam - today).days if exam else None,
        "bands": {k: bands.get(k) for k in ("listening", "reading", "writing", "speaking")},
        "needs_diagnostic": not exam or not any(bands.get(k) for k in ("listening", "reading", "writing", "speaking")),
        "weekday": weekday,
        "skill": skill,
        "focus_subject": _focus_subject(skill),
        "due": due,
        "due_total": sum(due.values()),
        "next_due": min(upcoming).isoformat() if upcoming and not sum(due.values()) else None,
        "next_due_count": sum(1 for d in upcoming if d == min(upcoming)) if upcoming and not sum(due.values()) else 0,
        "total_cards": total_cards,
        "waiting": waiting,
        "minutes_today": minutes,
        "weekly_focus": _weekly_focus(root),
        "overview_uri": f"obsidian://open?vault={quote(vault.vault_name())}&file={quote(ROOT + '/雅思總覽.md')}",
        "sprint_soon": bool(exam and 0 <= (exam - today).days <= 14 and phase.lower() != "final sprint"),
    }
