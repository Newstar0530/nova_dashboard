"""Gmail 郵件：IMAP + 應用程式密碼讀信（學校信箱轉寄到 Gmail）。"""
import email
import html
import imaplib
import re
from contextlib import contextmanager
from datetime import datetime
from email.policy import default as default_policy
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from urllib.parse import quote

import config
from services import vault

FOLDER = "INBOX"
# 後三個是 Outlook / Exchange 轉寄時才會加上的標頭，用來辨識「學校轉寄過來的信」
FORWARD_HEADERS = ("Resent-From", "X-MS-Exchange-ForwardingLoop", "X-MS-Exchange-Inbox-Rules-Loop")
HEADER_FIELDS = "FROM TO CC SUBJECT DATE DELIVERED-TO X-FORWARDED-TO CONTENT-TYPE " + " ".join(h.upper() for h in FORWARD_HEADERS)
SCAN_LIMIT = 400  # 篩選學校信時，往回掃描的封數
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


class MailNotConfigured(Exception):
    pass


class MailAuthError(Exception):
    pass


class MailConnectionError(Exception):
    pass


def _is_gmail() -> bool:
    return config.IMAP_HOST.endswith("gmail.com")


def schools() -> list[dict]:
    """.env 的 MAIL_ACCOUNTS → 用來分類轉寄來的信。

    值可以是完整地址或網域，例：清大=s113@m113.nthu.edu.tw;B校=b.edu.tw
    """
    out = []
    for item in config.MAIL_ACCOUNTS.split(";"):
        item = item.strip()
        if not item:
            continue
        if "=" in item:
            label, addr = (s.strip() for s in item.split("=", 1))
        else:  # 只填地址沒填標籤 → 用網域第一段當標籤（例：neoma-bs）
            label, addr = item.rsplit("@", 1)[-1].split(".")[0], item
        if label and addr:
            hint = f"?login_hint={quote(addr)}" if "@" in addr else ""
            out.append({
                "label": label,
                "address": addr.lower(),
                "link": f"https://outlook.office.com/mail/{hint}",
            })
    return out


def _matches(addr: str, pattern: str) -> bool:
    """pattern 是完整地址 → 完全相同；是網域 → 地址網域等於或屬於該網域。"""
    if "@" in pattern:
        return addr == pattern
    domain = addr.rsplit("@", 1)[-1]
    return domain == pattern or domain.endswith("." + pattern)


@contextmanager
def _connect(folder: str = FOLDER, readonly: bool = True):
    if not config.GMAIL_ADDRESS or not config.GMAIL_APP_PASSWORD:
        raise MailNotConfigured("尚未設定 GMAIL_ADDRESS / GMAIL_APP_PASSWORD，請參考 README")
    try:
        conn = imaplib.IMAP4_SSL(config.IMAP_HOST, 993, timeout=20)
    except OSError as e:
        raise MailConnectionError(f"{config.IMAP_HOST}：{e}") from e
    try:
        try:
            conn.login(config.GMAIL_ADDRESS, config.GMAIL_APP_PASSWORD.replace(" ", ""))
        except imaplib.IMAP4.error:
            raise MailAuthError("Gmail 登入失敗：請確認 GMAIL_ADDRESS 與 16 碼應用程式密碼，且 Gmail 已開啟兩步驟驗證")
        typ, _ = conn.select(f'"{folder}"', readonly=readonly)
        if typ != "OK":
            raise RuntimeError(f"找不到資料夾 {folder}")
        yield conn
    except OSError as e:  # 讀信途中斷線 / 逾時
        raise MailConnectionError(str(e)) from e
    finally:
        try:
            conn.logout()
        except Exception:
            pass


def status() -> dict:
    return {
        "configured": bool(config.GMAIL_ADDRESS and config.GMAIL_APP_PASSWORD),
        "account": config.GMAIL_ADDRESS or None,
        "schools": schools(),
    }


def _search(conn, q: str | None) -> list[bytes]:
    if not q:
        typ, data = conn.uid("SEARCH", None, "ALL")
    else:
        conn.literal = q.encode("utf-8")
        typ, data = conn.uid("SEARCH", "CHARSET", "UTF-8", "X-GM-RAW" if _is_gmail() else "TEXT")
    return data[0].split() if typ == "OK" and data and data[0] else []


def _forwarded_from(msg) -> list[str]:
    """Outlook 轉寄標頭裡的原始學校信箱地址（不是轉寄的信 → 空 list）。"""
    found = []
    for h in FORWARD_HEADERS:
        for v in msg.get_all(h, []):
            found += [a.lower() for a in EMAIL_RE.findall(str(v))]
    return found


def _school_of(msg) -> str | None:
    """判斷這封信來自哪間學校：比對 MAIL_ACCOUNTS；沒設定但有轉寄標頭時，用原信箱網域當標籤。"""
    # 空字串要先濾掉：Python 3.13 的 getaddresses 遇到空欄位會整批回傳空結果
    fields = [str(v) for h in ("To", "Cc", "Delivered-To", "X-Forwarded-To") for v in msg.get_all(h, [])]
    forwarded = _forwarded_from(msg)
    addrs = {a.lower() for _, a in getaddresses([f for f in fields if f.strip()])} | set(forwarded)
    for s in schools():
        if any(_matches(a, s["address"]) for a in addrs):
            return s["label"]
    if forwarded:
        return forwarded[0].rsplit("@", 1)[-1]
    return None


def _display_from(value: str) -> str:
    name, addr = parseaddr(value)
    return name or addr


def _iso(date_value) -> str | None:
    try:
        return parsedate_to_datetime(str(date_value)).isoformat()
    except (TypeError, ValueError):
        return None


def _gmail_link(msgid: str | None) -> str | None:
    if not msgid or not _is_gmail():
        return None
    return f"https://mail.google.com/mail/?authuser={quote(config.GMAIL_ADDRESS)}#all/{int(msgid):x}"


def _parse_fetch(data) -> list[tuple[dict, bytes]]:
    """imaplib FETCH 回傳 → [(meta, payload)]，meta 含 uid / flags / msgid。"""
    out = []
    for part in data:
        if not isinstance(part, tuple):
            continue
        head = part[0].decode(errors="replace")
        uid = re.search(r"UID (\d+)", head)
        flags = re.search(r"FLAGS \(([^)]*)\)", head)
        msgid = re.search(r"X-GM-MSGID (\d+)", head)
        out.append((
            {
                "uid": uid.group(1) if uid else None,
                "flags": flags.group(1) if flags else "",
                "msgid": msgid.group(1) if msgid else None,
            },
            part[1],
        ))
    return out


def list_messages(top: int = 40, q: str | None = None, school: str | None = None,
                  only_school: bool = False) -> list[dict]:
    """school：只看某間學校；only_school：只看任何學校轉寄過來的信。

    Gmail 搜尋無法查 Outlook 轉寄標頭，所以篩選時先抓最近 SCAN_LIMIT 封的標頭，在本機判斷。
    """
    filtering = bool(school or only_school)
    with _connect() as conn:
        uids = _search(conn, q)[-(SCAN_LIMIT if filtering else top):][::-1]
        if not uids:
            return []
        extra = " X-GM-MSGID" if _is_gmail() else ""
        typ, data = conn.uid(
            "FETCH", b",".join(uids).decode(), f"(UID FLAGS{extra} BODY.PEEK[HEADER.FIELDS ({HEADER_FIELDS})])"
        )
    msgs = []
    for meta, raw in _parse_fetch(data):
        m = email.message_from_bytes(raw, policy=default_policy)
        label = _school_of(m)
        if (school and label != school) or (only_school and not label):
            continue
        msgs.append({
            "id": meta["uid"],
            "subject": str(m.get("Subject", "")).strip() or "(無主旨)",
            "from": _display_from(str(m.get("From", ""))),
            "received": _iso(m.get("Date")),
            "is_read": "\\Seen" in meta["flags"],
            "important": "\\Flagged" in meta["flags"],
            "has_attachments": m.get_content_type() == "multipart/mixed",
            "school": label,
            "web_link": _gmail_link(meta["msgid"]),
        })
    msgs.sort(key=lambda x: x["received"] or "", reverse=True)
    return msgs[:top]


def get_message(uid: str) -> dict:
    if not uid.isdigit():
        raise ValueError("郵件 ID 不正確")
    with _connect(readonly=False) as conn:  # 用 BODY[]（非 PEEK）讀取 → 標為已讀
        extra = " X-GM-MSGID" if _is_gmail() else ""
        typ, data = conn.uid("FETCH", uid, f"(UID{extra} BODY[])")
    parsed = _parse_fetch(data)
    if not parsed:
        raise ValueError("找不到這封信")
    meta, raw = parsed[0]
    m = email.message_from_bytes(raw, policy=default_policy)
    body_part = m.get_body(preferencelist=("html", "plain"))
    body, body_type = "", "text"
    if body_part is not None:
        try:
            body = body_part.get_content()
        except (LookupError, UnicodeDecodeError):
            body = body_part.get_payload(decode=True).decode("utf-8", errors="replace")
        body_type = "html" if body_part.get_content_type() == "text/html" else "text"
    return {
        "id": meta["uid"],
        "subject": str(m.get("Subject", "")).strip() or "(無主旨)",
        "from": str(m.get("From", "")),
        "to": str(m.get("To", "")),
        "received": _iso(m.get("Date")),
        "school": _school_of(m),
        "body_html": body,
        "body_type": body_type,
        "attachments": [a.get_filename() or "附件" for a in m.iter_attachments()],
        "web_link": _gmail_link(meta["msgid"]),
    }


def _html_to_text(s: str) -> str:
    s = re.sub(r"(?is)<(script|style|head).*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\n\s*\n+", "\n\n", s).strip()


def save_to_vault(uid: str) -> dict:
    """把一封信存成 Obsidian 筆記（放進 Inbox）。"""
    m = get_message(uid)
    body = m["body_html"] if m["body_type"] == "text" else _html_to_text(m["body_html"])
    received = (m["received"] or "")[:16].replace("T", " ")
    date = (m["received"] or datetime.now().isoformat())[:10]
    title = vault.sanitize_filename(f"{date} {m['subject']}")
    quote_ = lambda s: s.replace('"', "'")
    lines = [
        "---",
        "type: email",
        f'subject: "{quote_(m["subject"])}"',
        f'from: "{quote_(m["from"])}"',
        f"received: {received}",
    ]
    if m["school"]:
        lines.append(f"school: {m['school']}")
    if m["web_link"]:
        lines.append(f"link: {m['web_link']}")
    lines += ["tags: [email]", "---", ""]
    attach = f"\n> 附件：{'、'.join(m['attachments'])}\n" if m["attachments"] else ""
    content = (
        "\n".join(lines)
        + f"\n# {m['subject']}\n\n> 寄件者：{m['from']}　時間：{received}\n{attach}\n{body}\n"
    )
    p = vault.unique_path(vault.safe_path(f"{config.INBOX_DIR}/{title}.md"))
    vault.write_note(vault.rel(p), content)
    return {"path": vault.rel(p)}
