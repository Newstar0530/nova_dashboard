"""Outlook / 學校信箱：透過 Microsoft Graph 讀信（Device Code 登入）。"""
import html
import re
import threading
from datetime import datetime

import httpx
import msal

import config
from services import vault

GRAPH = "https://graph.microsoft.com/v1.0"

_cache = msal.SerializableTokenCache()
if config.TOKEN_CACHE_FILE.exists():
    _cache.deserialize(config.TOKEN_CACHE_FILE.read_text(encoding="utf-8"))
_lock = threading.Lock()
_pending_flow: dict = {}  # 目前進行中的 device flow
_app: msal.PublicClientApplication | None = None


class MailNotConfigured(Exception):
    pass


class NotSignedIn(Exception):
    pass


def _get_app() -> msal.PublicClientApplication:
    global _app
    if not config.MS_CLIENT_ID:
        raise MailNotConfigured("尚未設定 MS_CLIENT_ID，請參考 README 註冊 Azure App")
    if _app is None:
        _app = msal.PublicClientApplication(
            config.MS_CLIENT_ID,
            authority=f"https://login.microsoftonline.com/{config.MS_TENANT}",
            token_cache=_cache,
        )
    return _app


def _save_cache():
    if _cache.has_state_changed:
        config.TOKEN_CACHE_FILE.write_text(_cache.serialize(), encoding="utf-8")


def _token() -> str:
    app = _get_app()
    accounts = app.get_accounts()
    if not accounts:
        raise NotSignedIn("尚未登入")
    with _lock:
        result = app.acquire_token_silent(config.MS_SCOPES, account=accounts[0])
        _save_cache()
    if not result or "access_token" not in result:
        raise NotSignedIn("登入已過期，請重新登入")
    return result["access_token"]


def status() -> dict:
    if not config.MS_CLIENT_ID:
        return {"configured": False, "signed_in": False}
    accounts = _get_app().get_accounts()
    out = {
        "configured": True,
        "signed_in": bool(accounts),
        "account": accounts[0]["username"] if accounts else None,
    }
    if not accounts and _pending_flow:
        out["pending"] = {
            "user_code": _pending_flow.get("user_code"),
            "verification_uri": _pending_flow.get("verification_uri"),
            "error": _pending_flow.get("error"),
        }
    return out


def start_login() -> dict:
    """開始 device code 登入；背景執行緒等待使用者在瀏覽器完成驗證。"""
    app = _get_app()
    flow = app.initiate_device_flow(scopes=config.MS_SCOPES)
    if "user_code" not in flow:
        raise RuntimeError(flow.get("error_description", "無法開始登入"))
    _pending_flow.clear()
    _pending_flow.update(flow)

    def wait():
        result = app.acquire_token_by_device_flow(flow)
        with _lock:
            _save_cache()
        if "access_token" in result:
            _pending_flow.clear()
        else:
            _pending_flow["error"] = result.get("error_description", "登入失敗")

    threading.Thread(target=wait, daemon=True).start()
    return {"user_code": flow["user_code"], "verification_uri": flow["verification_uri"]}


def logout():
    app = _get_app()
    for acc in app.get_accounts():
        app.remove_account(acc)
    with _lock:
        _save_cache()
    _pending_flow.clear()


def _get(path: str, params: dict | None = None) -> dict:
    r = httpx.get(
        f"{GRAPH}{path}",
        params=params,
        headers={"Authorization": f"Bearer {_token()}", "Prefer": 'outlook.body-content-type="html"'},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def list_messages(folder: str = "inbox", top: int = 30, search: str | None = None) -> list[dict]:
    params = {
        "$top": str(top),
        "$select": "id,subject,from,receivedDateTime,isRead,bodyPreview,hasAttachments,webLink,importance",
    }
    if search:
        params["$search"] = f'"{search}"'  # $search 不能和 $orderby 一起用
    else:
        params["$orderby"] = "receivedDateTime desc"
    data = _get(f"/me/mailFolders/{folder}/messages", params)
    return [
        {
            "id": m["id"],
            "subject": m.get("subject") or "(無主旨)",
            "from": (m.get("from") or {}).get("emailAddress", {}).get("name")
            or (m.get("from") or {}).get("emailAddress", {}).get("address", ""),
            "received": m.get("receivedDateTime"),
            "is_read": m.get("isRead"),
            "preview": m.get("bodyPreview", ""),
            "has_attachments": m.get("hasAttachments"),
            "important": m.get("importance") == "high",
            "web_link": m.get("webLink"),
        }
        for m in data.get("value", [])
    ]


def get_message(msg_id: str) -> dict:
    m = _get(
        f"/me/messages/{msg_id}",
        {"$select": "id,subject,from,toRecipients,receivedDateTime,body,webLink"},
    )
    sender = (m.get("from") or {}).get("emailAddress", {})
    return {
        "id": m["id"],
        "subject": m.get("subject") or "(無主旨)",
        "from": f'{sender.get("name", "")} <{sender.get("address", "")}>',
        "to": ", ".join(r["emailAddress"]["address"] for r in m.get("toRecipients", [])),
        "received": m.get("receivedDateTime"),
        "body_html": m.get("body", {}).get("content", ""),
        "body_type": m.get("body", {}).get("contentType", "html"),
        "web_link": m.get("webLink"),
    }


def _html_to_text(s: str) -> str:
    s = re.sub(r"(?is)<(script|style|head).*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\n\s*\n+", "\n\n", s).strip()


def save_to_vault(msg_id: str) -> dict:
    """把一封信存成 Obsidian 筆記（放進 Inbox）。"""
    m = get_message(msg_id)
    body = m["body_html"] if m["body_type"] == "text" else _html_to_text(m["body_html"])
    received = (m["received"] or "")[:16].replace("T", " ")
    date = (m["received"] or datetime.now().isoformat())[:10]
    title = vault.sanitize_filename(f"{date} {m['subject']}")
    content = (
        "---\n"
        "type: email\n"
        f'subject: "{m["subject"].replace(chr(34), chr(39))}"\n'
        f'from: "{m["from"]}"\n'
        f"received: {received}\n"
        f"link: {m['web_link']}\n"
        "tags: [email]\n"
        "---\n\n"
        f"# {m['subject']}\n\n"
        f"> 寄件者：{m['from']}　時間：{received}\n\n"
        f"{body}\n"
    )
    p = vault.unique_path(vault.safe_path(f"{config.INBOX_DIR}/{title}.md"))
    vault.write_note(vault.rel(p), content)
    return {"path": vault.rel(p)}
