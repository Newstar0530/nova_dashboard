"""行事曆：讀取 ICS 訂閱網址（Outlook「發佈行事曆」、Google 日曆私人網址等），含重複行程。"""
import time
from datetime import date, datetime, timedelta

import httpx
import icalendar
import recurring_ical_events

import config

CACHE_SECONDS = 600
_cache: dict[str, tuple[float, icalendar.Calendar]] = {}


def sources() -> list[dict]:
    """CALENDAR_ICS=NEOMA=https://...;清大=https://..."""
    out = []
    for item in config.CALENDAR_ICS.split(";"):
        if "=" in item:
            label, url = (s.strip() for s in item.split("=", 1))
            if label and url:
                out.append({"label": label, "url": "https://" + url[len("webcal://"):] if url.startswith("webcal://") else url})
    return out


def status() -> dict:
    return {"configured": bool(sources()), "sources": [s["label"] for s in sources()]}


def _calendar(url: str, refresh: bool = False) -> icalendar.Calendar:
    hit = _cache.get(url)
    if hit and not refresh and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    r = httpx.get(url, timeout=30, follow_redirects=True)
    r.raise_for_status()
    cal = icalendar.Calendar.from_ical(r.content)
    _cache[url] = (time.time(), cal)
    return cal


def _local(dt) -> datetime:
    if dt.tzinfo is None:
        return dt  # 浮動時間：照原樣當本地時間
    return dt.astimezone()  # 轉成這台電腦的時區


def _event(ev, label: str) -> dict:
    start = ev.get("DTSTART").dt
    end_prop = ev.get("DTEND")
    end = end_prop.dt if end_prop else None
    all_day = not isinstance(start, datetime)
    if all_day:
        end = end or start + timedelta(days=1)
        start_s, end_s = start.isoformat(), end.isoformat()
    else:
        start = _local(start)
        end = _local(end) if isinstance(end, datetime) else start + timedelta(hours=1)
        start_s, end_s = start.isoformat(timespec="minutes"), end.isoformat(timespec="minutes")
    return {
        "title": str(ev.get("SUMMARY", "")).strip() or "(無標題)",
        "start": start_s,
        "end": end_s,
        "all_day": all_day,
        "location": str(ev.get("LOCATION", "")).strip(),
        "source": label,
    }


def events(start: date, end: date, refresh: bool = False) -> dict:
    """[start, end) 之間的行程；某個來源失敗時其他來源照常回傳，錯誤列在 errors。"""
    out, errors = [], []
    for src in sources():
        try:
            cal = _calendar(src["url"], refresh)
            for ev in recurring_ical_events.of(cal).between(start, end):
                if str(ev.get("STATUS", "")).upper() == "CANCELLED":
                    continue
                out.append(_event(ev, src["label"]))
        except (httpx.HTTPError, ValueError) as e:
            errors.append(f"{src['label']}：{e}")
    out.sort(key=lambda e: (e["start"][:10], not e["all_day"], e["start"]))
    return {"events": out, "errors": errors}
