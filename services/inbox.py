"""Inbox：讀取快速記錄（`00 Inbox/YYYY-MM-DD.md` 裡的「- HH:MM 內容」），轉成待辦或刪除。

轉成待辦後，原本那行會變成「- HH:MM 內容 → 已轉成待辦 [[標題]]」，保留紀錄並連到待辦，卡片上就不再顯示。
每筆的 id = 檔案 # 行號 # 該行內容雜湊；檔案在 Obsidian 被改過時會比對失敗，避免改錯行。
"""
import hashlib
import re
import threading
from datetime import date, timedelta

import config
from services import tasks, vault

LINE_RE = re.compile(r"^- (\d{1,2}:\d{2}) (.+)$")
CONVERTED = "→ 已轉成待辦"
_lock = threading.Lock()


class CaptureNotFound(Exception):
    pass


def _h(line: str) -> str:
    return hashlib.sha1(line.encode("utf-8")).hexdigest()[:8]


def _files(days: int):
    inbox = vault.safe_path(config.INBOX_DIR)
    today = date.today()
    for i in range(days):
        d = today - timedelta(days=i)
        p = inbox / f"{d.isoformat()}.md"
        if p.exists():
            yield d, p


def list_captures(days: int = 7) -> list[dict]:
    """最近 days 天、還沒處理（沒轉成待辦）的快速記錄，新的在前。"""
    out = []
    for d, p in _files(days):
        rel = vault.rel(p)
        lines = p.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            m = LINE_RE.match(line)
            if not m or CONVERTED in line:
                continue
            out.append({
                "id": f"{rel}#{i}#{_h(line)}",
                "date": d.isoformat(),
                "time": m.group(1),
                "text": m.group(2).strip(),
                "path": rel,
            })
    out.sort(key=lambda c: (c["date"], c["time"]), reverse=True)
    return out


def _locate(capture_id: str):
    try:
        rel, idx, h = capture_id.rsplit("#", 2)
        idx = int(idx)
    except ValueError:
        raise CaptureNotFound("記錄 id 不正確")
    if not rel.startswith(config.INBOX_DIR.rstrip("/") + "/"):
        raise CaptureNotFound("只能處理 Inbox 裡的快速記錄")
    p = vault.safe_path(rel)
    lines = p.read_text(encoding="utf-8").splitlines() if p.exists() else []
    if not 0 <= idx < len(lines) or _h(lines[idx]) != h or not LINE_RE.match(lines[idx]):
        raise CaptureNotFound("這筆記錄已在別處被修改，請重新整理")
    return p, lines, idx


def _write(p, lines):
    p.write_text("\n".join(lines).rstrip("\n") + "\n", encoding="utf-8")


def convert(capture_id: str, text: str | None = None, due: str | None = None, priority: str | None = None) -> dict:
    """建立 TaskNotes 待辦，並在原本那行標記「已轉成待辦」連到新待辦。"""
    with _lock:
        p, lines, idx = _locate(capture_id)
        m = LINE_RE.match(lines[idx])
        r = tasks.add_task(text or m.group(2), due, priority)
        title = r["id"].rsplit("/", 1)[-1][:-3]
        lines[idx] = f"{lines[idx]} {CONVERTED} [[{title}]]"
        _write(p, lines)
    return {"ok": True, "task_id": r["id"]}


def delete(capture_id: str) -> dict:
    with _lock:
        p, lines, idx = _locate(capture_id)
        del lines[idx]
        _write(p, lines)
    return {"ok": True}
