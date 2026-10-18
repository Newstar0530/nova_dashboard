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
        raise ValueError("路徑不在 vault 內")
    return p


def rel(p: Path) -> str:
    return p.relative_to(config.VAULT_PATH).as_posix()


def iter_notes():
    for p in config.VAULT_PATH.rglob("*.md"):
        if not SKIP_DIRS.intersection(p.relative_to(config.VAULT_PATH).parts):
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
    }


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
        raise ValueError("只能刪除 vault 裡的 Markdown 筆記")
    if SKIP_DIRS.intersection(p.relative_to(config.VAULT_PATH).parts):
        raise ValueError("不能刪除系統資料夾裡的檔案")
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
