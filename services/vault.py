"""Obsidian vault 讀寫：瀏覽、搜尋、渲染、快速記錄。"""
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import markdown

import config

WIKILINK = re.compile(r"(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|([^\]]+))?\]\]")
FRONTMATTER = re.compile(r"\A---\n.*?\n---\n", re.S)
CALLOUT = re.compile(r"^(>\s*)\[!(\w+)\][+-]?\s*", re.M)
SKIP_DIRS = {".obsidian", ".trash", ".git"}


def vault_name() -> str:
    return config.VAULT_PATH.name


def safe_path(rel: str) -> Path:
    """把相對路徑轉成 vault 內的絕對路徑，阻擋 ../ 跳脫。"""
    p = (config.VAULT_PATH / rel).resolve()
    if p != config.VAULT_PATH and config.VAULT_PATH not in p.parents:
        raise ValueError("Path is outside the vault")
    return p


def rel(p: Path) -> str:
    return p.relative_to(config.VAULT_PATH).as_posix()


def iter_notes():
    for p in config.VAULT_PATH.rglob("*.md"):
        # 跳過 .obsidian、.trash、.git、.claude 等隱藏資料夾
        if not any(part.startswith(".") for part in p.relative_to(config.VAULT_PATH).parts):
            yield p


def obsidian_uri(rel_path: str) -> str:
    return f"obsidian://open?vault={quote(vault_name())}&file={quote(rel_path)}"


def tree() -> list[dict]:
    """依資料夾分組的筆記清單。"""
    groups: dict[str, list] = {}
    for p in sorted(iter_notes(), key=lambda x: rel(x).lower()):
        folder = p.parent.relative_to(config.VAULT_PATH).as_posix()
        groups.setdefault("" if folder == "." else folder, []).append(
            {"path": rel(p), "name": p.stem}
        )
    return [{"folder": k, "notes": v} for k, v in sorted(groups.items())]


def recent(limit: int = 12) -> list[dict]:
    notes = sorted(iter_notes(), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "path": rel(p),
            "name": p.stem,
            "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(timespec="minutes"),
        }
        for p in notes[:limit]
    ]


def _resolve_link(target: str) -> str | None:
    """[[名稱]] → vault 內相對路徑（Obsidian 的最短路徑規則）。"""
    target = target.strip()
    direct = config.VAULT_PATH / (target if target.endswith(".md") else target + ".md")
    if direct.exists():
        return rel(direct)
    stem = Path(target).name.removesuffix(".md").lower()
    for p in iter_notes():
        if p.stem.lower() == stem:
            return rel(p)
    for p in config.VAULT_PATH.rglob(Path(target).name):  # 圖片等附件
        return rel(p)
    return None


def _render(text: str) -> str:
    body = FRONTMATTER.sub("", text)

    def repl(m):
        embed, target, _, _, alias = m.groups()
        resolved = _resolve_link(target)
        label = alias or target
        if embed and resolved and not resolved.endswith(".md"):
            return f'<img src="/api/vault/file?path={quote(resolved)}" alt="{label}">'
        if resolved:
            return f'<a href="#" class="wikilink" data-path="{resolved}">{label}</a>'
        return f'<span class="wikilink missing">{label}</span>'

    body = WIKILINK.sub(repl, body)
    # Obsidian callout「> [!info] 標題」→ 引言區塊，類型改成小標籤
    body = CALLOUT.sub(lambda m: f'{m.group(1)}<span class="callout-type">{m.group(2).upper()}</span> ', body)
    return markdown.markdown(
        body, extensions=["fenced_code", "tables", "sane_lists", "nl2br", "toc"]
    )


def read_note(rel_path: str) -> dict:
    p = safe_path(rel_path)
    text = p.read_text(encoding="utf-8")
    fm = FRONTMATTER.match(text)
    return {
        "path": rel(p),
        "name": p.stem,
        "raw": text,
        "frontmatter": fm.group(0) if fm else "",
        "html": _render(text),
        "obsidian_uri": obsidian_uri(rel(p)),
        "editable": not _is_synced(text),
        "mtime": str(p.stat().st_mtime_ns),
    }


# ---------- 編輯、新增 ----------

class Conflict(Exception):
    """筆記在載入後被別的地方（例如 Obsidian）改過。"""


def _is_synced(text: str) -> bool:
    # Notion 同步來的筆記，下次同步會被覆蓋，所以不開放在工作台編輯
    fm = FRONTMATTER.match(text)
    return bool(fm and re.search(r"^notion_id:", fm.group(0), re.M))


def _editable_md(p: Path) -> None:
    if p.suffix != ".md":
        raise ValueError("Only Markdown notes can be edited")
    if SKIP_DIRS.intersection(p.relative_to(config.VAULT_PATH).parts):
        raise ValueError("Files in system folders cannot be edited")


def save_note(rel_path: str, content: str, mtime: str | None = None, force: bool = False) -> dict:
    p = safe_path(rel_path)
    _editable_md(p)
    if not p.is_file():
        raise FileNotFoundError(rel_path)
    current = p.read_text(encoding="utf-8")
    if _is_synced(current):
        raise ValueError("Notes synced from Notion can't be edited here — edit them in Notion")
    if not force and mtime and str(p.stat().st_mtime_ns) != mtime:
        raise Conflict(rel_path)
    p.write_text(content, encoding="utf-8")
    return read_note(rel(p))


def folders() -> list[str]:
    """vault 裡所有資料夾（含空的），給新增筆記選位置用。"""
    out = [""]
    for d in sorted(config.VAULT_PATH.rglob("*"), key=lambda x: rel(x).lower()):
        if d.is_dir() and not any(part.startswith(".") for part in d.relative_to(config.VAULT_PATH).parts):
            out.append(rel(d))
    return out


TEMPLATE_DIRS = {"範本", "templates", "Templates"}


def templates() -> list[dict]:
    """名為「範本 / Templates」的資料夾裡的筆記。"""
    return [
        {"path": rel(p), "name": p.stem}
        for p in sorted(iter_notes(), key=lambda x: rel(x).lower())
        if p.parent.name in TEMPLATE_DIRS
    ]


MOMENT = [("YYYY", "%Y"), ("MM", "%m"), ("DD", "%d"), ("HH", "%H"), ("mm", "%M"), ("ss", "%S")]
TP_DATE = re.compile(r"<%\s*tp\.date\.now\(\s*[\"']([^\"']*)[\"']\s*\)\s*%>")
TP_TITLE = re.compile(r"<%\s*tp\.file\.title\s*%>")


def _fill_template(text: str, title: str) -> str:
    """替換最常用的 Templater 語法：日期與標題；其他的原樣保留。"""
    now = datetime.now()

    def date(m):
        fmt = m.group(1) or "YYYY-MM-DD"
        for token, code in MOMENT:
            fmt = fmt.replace(token, code)
        return now.strftime(fmt)

    return TP_TITLE.sub(lambda _: title, TP_DATE.sub(date, text))


def create_note(folder: str, title: str, template: str | None = None) -> dict:
    title = title.strip()
    if not title:
        raise ValueError("Title cannot be empty")
    d = safe_path(folder)
    if any(part.startswith(".") for part in d.relative_to(config.VAULT_PATH).parts):
        raise ValueError("Can't create notes in system folders")
    content = ""
    if template:
        t = safe_path(template)
        if not t.is_file() or t.suffix != ".md":
            raise ValueError("Template not found")
        content = _fill_template(t.read_text(encoding="utf-8"), title)
    d.mkdir(parents=True, exist_ok=True)
    p = unique_path(d / f"{sanitize_filename(title)}.md")
    p.write_text(content, encoding="utf-8")
    return read_note(rel(p))


def search(q: str, limit: int = 40) -> list[dict]:
    q = q.strip().lower()
    if not q:
        return []
    hits = []
    for p in iter_notes():
        name_hit = q in p.stem.lower()
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        idx = text.lower().find(q)
        if not name_hit and idx < 0:
            continue
        snippet = ""
        if idx >= 0:
            start = max(0, idx - 40)
            snippet = text[start : idx + len(q) + 60].replace("\n", " ")
        hits.append({"path": rel(p), "name": p.stem, "snippet": snippet, "score": 2 if name_hit else 1})
    hits.sort(key=lambda h: (-h["score"], h["name"]))
    return hits[:limit]


def capture(text: str, title: str | None = None) -> dict:
    """快速記錄：有標題就建新筆記，否則附加到今天的 Inbox 日誌。"""
    inbox = safe_path(config.INBOX_DIR)
    inbox.mkdir(parents=True, exist_ok=True)
    now = datetime.now()
    if title:
        p = inbox / f"{sanitize_filename(title)}.md"
        p = unique_path(p)
        p.write_text(f"---\ncreated: {now:%Y-%m-%d %H:%M}\n---\n\n{text.strip()}\n", encoding="utf-8")
    else:
        p = inbox / f"{now:%Y-%m-%d}.md"
        if not p.exists():
            p.write_text(f"# {now:%Y-%m-%d} 快速記錄\n\n", encoding="utf-8")
        with p.open("a", encoding="utf-8") as f:
            f.write(f"- {now:%H:%M} {text.strip()}\n")
    return {"path": rel(p)}


def write_note(rel_path: str, content: str) -> Path:
    p = safe_path(rel_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return p


def trash_note(rel_path: str) -> dict:
    """把筆記移到 vault 的 .trash（Obsidian 的垃圾桶），可在 Obsidian 還原；不是真的刪除。"""
    p = safe_path(rel_path)
    if not p.is_file() or p.suffix != ".md":
        raise ValueError("Only Markdown notes in the vault can be deleted")
    if SKIP_DIRS.intersection(p.relative_to(config.VAULT_PATH).parts):
        raise ValueError("Files in system folders cannot be deleted")
    trash = config.VAULT_PATH / ".trash"
    trash.mkdir(exist_ok=True)
    target = unique_path(trash / p.name)
    p.rename(target)
    return {"ok": True, "trashed_as": rel(target)}


def sanitize_filename(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|#^\[\]]', "-", name).strip(" .")
    return name[:120] or "未命名"


def unique_path(p: Path) -> Path:
    i = 2
    base = p
    while p.exists():
        p = base.with_name(f"{base.stem} ({i}){base.suffix}")
        i += 1
    return p
