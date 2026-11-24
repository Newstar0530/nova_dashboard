"""Today 頁世界時鐘旁的小資訊：兩地天氣（Open-Meteo）與歐元兌台幣匯率（open.er-api.com）。

兩個來源都免費、不需要金鑰；結果快取，避免每次開頁面都去要。
地點用 WEATHER_PLACES 設定：名稱=緯度,經度，用分號分隔。
"""
import time

import httpx

import config

WEATHER_TTL = 15 * 60
FX_TTL = 6 * 60 * 60
_cache: dict[str, tuple[float, object]] = {}


def _cached(key: str, ttl: int, fetch):
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    try:
        value = fetch()
    except (httpx.HTTPError, KeyError, ValueError, IndexError):
        return hit[1] if hit else None  # 抓不到就沿用上次的結果
    _cache[key] = (time.time(), value)
    return value


def places() -> list[dict]:
    out = []
    for part in config.WEATHER_PLACES.split(";"):
        name, _, coords = part.partition("=")
        lat, _, lon = coords.partition(",")
        try:
            out.append({"name": name.strip(), "lat": float(lat), "lon": float(lon)})
        except ValueError:
            continue
    return out


def _weather() -> list[dict]:
    ps = places()
    if not ps:
        return []
    r = httpx.get("https://api.open-meteo.com/v1/forecast", timeout=10, params={
        "latitude": ",".join(str(p["lat"]) for p in ps),
        "longitude": ",".join(str(p["lon"]) for p in ps),
        "current": "temperature_2m,weather_code,is_day",
        "daily": "temperature_2m_max,temperature_2m_min",
        "forecast_days": 1, "timezone": "auto",
    })
    r.raise_for_status()
    data = r.json()
    data = data if isinstance(data, list) else [data]  # 只有一個地點時回傳的不是 list
    return [{
        "name": p["name"],
        "temp": d["current"]["temperature_2m"],
        "code": d["current"]["weather_code"],
        "is_day": bool(d["current"]["is_day"]),
        "max": d["daily"]["temperature_2m_max"][0],
        "min": d["daily"]["temperature_2m_min"][0],
    } for p, d in zip(ps, data)]


def _fx() -> dict:
    r = httpx.get("https://open.er-api.com/v6/latest/EUR", timeout=10)
    r.raise_for_status()
    d = r.json()
    if d.get("result") != "success":
        raise ValueError(d.get("error-type", "exchange rate unavailable"))
    return {"base": "EUR", "quote": "TWD", "rate": d["rates"]["TWD"], "updated": d["time_last_update_unix"]}


def overview() -> dict:
    return {"weather": _cached("weather", WEATHER_TTL, _weather) or [],
            "fx": _cached("fx", FX_TTL, _fx)}
