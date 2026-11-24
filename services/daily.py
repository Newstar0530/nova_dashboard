"""每日資訊：Claude 排程任務（claude.ai routines）把報告寄到 Gmail，這裡依主旨開頭把它們找出來。

DAILY_FEEDS 設定每個來源：名稱=主旨開頭（例如 `AI daily digest=[AI 每日摘要]`）。
只用一次 Gmail 搜尋抓所有來源最近的信，再依主旨開頭分組；結果快取幾分鐘。
"""
import hashlib
import html
import json
import re
import threading
import time
from datetime import date, datetime
from urllib.parse import parse_qs, urlparse

import config
from services import mail

CACHE_SECONDS = 180
HISTORY = 10  # 每個來源保留最近幾期
_cache: tuple[float, list[dict]] | None = None


def feeds() -> list[dict]:
    """主旨開頭可以用 | 列出好幾個（排程改過主旨時，舊信也找得到）；第一個是現在用的。"""
    out = []
    for part in config.DAILY_FEEDS.split(";"):
        name, _, prefix = part.partition("=")
        prefixes = [p.strip() for p in prefix.split("|") if p.strip()]
        if name.strip() and prefixes:
            out.append({"key": re.sub(r"\W+", "-", name.strip().lower()).strip("-"),
                        "name": name.strip(), "prefix": prefixes[0], "prefixes": prefixes})
    return out


def _query(fs: list[dict]) -> str:
    # Gmail 搜尋會忽略括號，所以只搜括號內的文字，再在本機比對完整的主旨開頭
    terms = [f'subject:"{p.strip("[]【】 ")}"' for f in fs for p in f["prefixes"]]
    return " OR ".join(terms) + " newer_than:60d"


def _match(subject: str, prefixes: list[str]) -> str | None:
    return next((p for p in prefixes if subject.startswith(p)), None)


def overview(refresh: bool = False) -> list[dict]:
    global _cache
    if _cache and not refresh and time.time() - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    fs = feeds()
    msgs = mail.list_messages(top=100, q=_query(fs)) if fs else []
    result = []
    for f in fs:
        issues = [(m, p) for m in msgs if (p := _match(m["subject"], f["prefixes"]))][:HISTORY]
        result.append({**f, "issues": [
            {"id": m["id"], "subject": m["subject"], "title": m["subject"][len(p):].strip(),
             "received": m["received"], "is_read": m["is_read"], "web_link": m["web_link"]}
            for m, p in issues
        ]})
    _cache = (time.time(), result)
    return result


def mark_read(uid: str) -> None:
    """閱讀後更新快取裡的已讀狀態，不必重新搜尋。"""
    for f in (_cache[1] if _cache else []):
        for m in f["issues"]:
            if m["id"] == uid:
                m["is_read"] = True


# ---------- 收件匣整理：今天報告裡的 🔴（今天需處理） ----------
TRIAGE_PREFIX = "[收件匣整理]"
_SECTION = re.compile(r"<h3[^>]*>\s*(🔴|🟡|⚪)[^<]*</h3>\s*<ul[^>]*>(.*?)</ul>", re.S)
_ITEM = re.compile(r"<li[^>]*>(.*?)</li>", re.S)
_LINK = re.compile(r'<a[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_triage_cache: dict[str, dict] = {}


def _text(s: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", s)).strip()


def _gmail_url(href: str) -> str:
    # 報告裡的連結是 google.com/url?q=… 轉址，取出真正的 Gmail 網址
    href = html.unescape(href)
    q = parse_qs(urlparse(href).query).get("q")
    return q[0] if q and q[0].startswith("https://mail.google.com/") else href


def _parse_item(li: str) -> dict:
    link = _LINK.search(li)
    text = _text(li)
    m = re.match(r"【([^】]+)】(.*)", text)
    kind, rest = (m.group(1), m.group(2)) if m else ("", text)
    sender, _, summary = rest.partition("｜")
    return {"key": hashlib.sha1(text.encode()).hexdigest()[:12],  # 打勾記錄用
            "kind": kind, "sender": sender.strip(), "summary": summary.strip(),
            "url": _gmail_url(link.group(1)) if link else None}


# 打勾（處理完）的項目：{報告 id: [項目 key]}，存在工作台資料夾，只留最近幾份報告
DONE_FILE = config.BASE_DIR / ".attention_done.json"
DONE_KEEP = 30
_done_lock = threading.Lock()


def _load_done() -> dict:
    try:
        return json.loads(DONE_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def set_done(report_id: str, key: str, done: bool) -> list[str]:
    with _done_lock:
        data = _load_done()
        keys = set(data.get(report_id, []))
        (keys.add if done else keys.discard)(key)
        data[report_id] = sorted(keys)
        data = dict(sorted(data.items(), key=lambda kv: int(kv[0]) if kv[0].isdigit() else 0)[-DONE_KEEP:])
        DONE_FILE.write_text(json.dumps(data), encoding="utf-8")
        return data[report_id]


def triage_today() -> dict:
    """今天的收件匣整理報告：🔴 各封、🟡 封數。今天還沒有報告就回傳 report=None。"""
    feed = next((f for f in overview() if f["prefix"] == TRIAGE_PREFIX), None)
    latest = feed["issues"][0] if feed and feed["issues"] else None
    if not latest or not latest["received"] or \
            datetime.fromisoformat(latest["received"]).astimezone().date() != date.today():
        return {"report": None}
    if latest["id"] not in _triage_cache:
        m = mail.get_message(latest["id"], peek=True)  # 不要因為工作台讀了就變成已讀
        sections = {icon: [_parse_item(li) for li in _ITEM.findall(body)] for icon, body in _SECTION.findall(m["body_html"])}
        _triage_cache[latest["id"]] = {
            "report": {"id": latest["id"], "title": latest["title"], "received": latest["received"]},
            "red": sections.get("🔴", []), "yellow": len(sections.get("🟡", []))}
    result = _triage_cache[latest["id"]]
    done = set(_load_done().get(latest["id"], []))
    return {**result, "red": [{**item, "done": item["key"] in done} for item in result["red"]]}
