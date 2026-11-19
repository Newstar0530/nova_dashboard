"""每日資訊：Claude 排程任務（claude.ai routines）把報告寄到 Gmail，這裡依主旨開頭把它們找出來。

DAILY_FEEDS 設定每個來源：名稱=主旨開頭（例如 `AI daily digest=[AI 每日摘要]`）。
只用一次 Gmail 搜尋抓所有來源最近的信，再依主旨開頭分組；結果快取幾分鐘。
"""
import re
import time

import config
from services import mail

CACHE_SECONDS = 180
HISTORY = 10  # 每個來源保留最近幾期
_cache: tuple[float, list[dict]] | None = None


def feeds() -> list[dict]:
    out = []
    for part in config.DAILY_FEEDS.split(";"):
        name, _, prefix = part.partition("=")
        if name.strip() and prefix.strip():
            out.append({"key": re.sub(r"\W+", "-", name.strip().lower()).strip("-"),
                        "name": name.strip(), "prefix": prefix.strip()})
    return out


def _query(fs: list[dict]) -> str:
    # Gmail 搜尋會忽略括號，所以只搜括號內的文字，再在本機比對完整的主旨開頭
    terms = [f'subject:"{f["prefix"].strip("[]【】 ")}"' for f in fs]
    return " OR ".join(terms) + " newer_than:60d"


def overview(refresh: bool = False) -> list[dict]:
    global _cache
    if _cache and not refresh and time.time() - _cache[0] < CACHE_SECONDS:
        return _cache[1]
    fs = feeds()
    msgs = mail.list_messages(top=100, q=_query(fs)) if fs else []
    result = []
    for f in fs:
        issues = [m for m in msgs if m["subject"].startswith(f["prefix"])][:HISTORY]
        result.append({**f, "issues": [
            {"id": m["id"], "subject": m["subject"], "title": m["subject"][len(f["prefix"]):].strip(),
             "received": m["received"], "is_read": m["is_read"], "web_link": m["web_link"]}
            for m in issues
        ]})
    _cache = (time.time(), result)
    return result


def mark_read(uid: str) -> None:
    """閱讀後更新快取裡的已讀狀態，不必重新搜尋。"""
    for f in (_cache[1] if _cache else []):
        for m in f["issues"]:
            if m["id"] == uid:
                m["is_read"] = True
