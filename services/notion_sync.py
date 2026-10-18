"""Notion → Obsidian：把 Notion 課堂筆記資料庫同步成 Markdown。

- 每個 Notion 頁面存成 `10 課堂筆記/<課程>/<標題>.md`
- frontmatter 記錄 notion_id / last_edited，未變更的頁面會跳過
- Notion 內的圖片會下載到 vault 附件資料夾（Notion 檔案連結一小時後會失效）
"""
import json
import mimetypes
import threading
from datetime import datetime
from pathlib import Path

import httpx

import config
from services import vault

API = "https://api.notion.com/v1"
VERSION = "2022-06-28"

_state_lock = threading.Lock()
_progress = {"running": False, "last_run": None, "message": "", "synced": 0, "skipped": 0, "errors": []}


class NotionNotConfigured(Exception):
    pass


def _client() -> httpx.Client:
    if not config.NOTION_TOKEN or not config.NOTION_DATABASE_ID:
        raise NotionNotConfigured("尚未設定 NOTION_TOKEN / NOTION_DATABASE_ID，請參考 README")
    return httpx.Client(
        base_url=API,
        headers={
            "Authorization": f"Bearer {config.NOTION_TOKEN}",
            "Notion-Version": VERSION,
            "Content-Type": "application/json",
        },
        timeout=30,
    )


def _load_state() -> dict:
    if config.NOTION_STATE_FILE.exists():
        return json.loads(config.NOTION_STATE_FILE.read_text(encoding="utf-8"))
    return {}


def _save_state(state: dict):
    config.NOTION_STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------- 頁面屬性 ----------

def _plain(rich: list) -> str:
    return "".join(t.get("plain_text", "") for t in rich or [])


def _prop_value(prop: dict) -> str | list | None:
    t = prop.get("type")
    v = prop.get(t)
    if t in ("title", "rich_text"):
        return _plain(v)
    if t == "select":
        return v["name"] if v else None
    if t in ("multi_select", "people"):
        return [x.get("name", "") for x in v or []]
    if t == "date":
        return v["start"] if v else None
    if t in ("number", "checkbox", "url", "email", "phone_number"):
        return v
    if t == "status":
        return v["name"] if v else None
    return None


def _page_meta(page: dict) -> dict:
    props = page.get("properties", {})
    title = next((_prop_value(p) for p in props.values() if p.get("type") == "title"), "") or "未命名"
    course = None
    if config.NOTION_COURSE_PROPERTY in props:
        course = _prop_value(props[config.NOTION_COURSE_PROPERTY])
        if isinstance(course, list):
            course = course[0] if course else None
    extra = {}
    for name, p in props.items():
        if p.get("type") == "title" or name == config.NOTION_COURSE_PROPERTY:
            continue
        val = _prop_value(p)
        if val not in (None, "", []):
            extra[name] = val
    return {"title": title, "course": course or "未分類", "props": extra}


# ---------- Block → Markdown ----------

def _rich(rich: list) -> str:
    out = []
    for t in rich or []:
        if t.get("type") == "equation":
            out.append(f"${t['equation']['expression']}$")
            continue
        s = t.get("plain_text", "")
        if not s:
            continue
        a = t.get("annotations", {})
        if a.get("code"):
            s = f"`{s}`"
        if a.get("bold"):
            s = f"**{s}**"
        if a.get("italic"):
            s = f"*{s}*"
        if a.get("strikethrough"):
            s = f"~~{s}~~"
        if a.get("underline"):
            s = f"<u>{s}</u>"
        if t.get("href"):
            s = f"[{s}]({t['href']})"
        out.append(s)
    return "".join(out)


class _Converter:
    def __init__(self, client: httpx.Client, page_title: str):
        self.client = client
        self.page_title = page_title
        self.img_count = 0

    def children(self, block_id: str) -> list[dict]:
        blocks, cursor = [], None
        while True:
            params = {"page_size": 100}
            if cursor:
                params["start_cursor"] = cursor
            r = self.client.get(f"/blocks/{block_id}/children", params=params)
            r.raise_for_status()
            data = r.json()
            blocks += data["results"]
            if not data.get("has_more"):
                return blocks
            cursor = data["next_cursor"]

    def convert(self, block_id: str, depth: int = 0) -> str:
        lines: list[str] = []
        num = 0
        list_types = ("bulleted_list_item", "numbered_list_item", "to_do", "toggle")
        prev_list = False
        for b in self.children(block_id):
            t = b["type"]
            num = num + 1 if t == "numbered_list_item" else 0
            if prev_list and t not in list_types and depth == 0:
                lines.append("")  # 清單結束後空一行，避免後面的區塊被併入清單
            prev_list = t in list_types
            md = self.block(b, depth, num)
            if md is not None:
                lines.append(md)
        return "\n".join(lines)

    def _kids(self, b: dict, depth: int) -> str:
        return self.convert(b["id"], depth) if b.get("has_children") else ""

    def block(self, b: dict, depth: int, num: int) -> str | None:
        t = b["type"]
        d = b.get(t, {})
        ind = "    " * depth
        text = _rich(d.get("rich_text"))

        if t == "paragraph":
            kids = self._kids(b, depth + 1)
            return f"{ind}{text}\n" + (kids + "\n" if kids else "")
        if t in ("heading_1", "heading_2", "heading_3"):
            level = int(t[-1])
            head = f"\n{'#' * level} {text}\n"
            if d.get("is_toggleable") and b.get("has_children"):
                head += self.convert(b["id"], depth) + "\n"
            return head
        if t in ("bulleted_list_item", "numbered_list_item", "to_do"):
            if t == "bulleted_list_item":
                bullet = "-"
            elif t == "numbered_list_item":
                bullet = f"{num}."
            else:
                bullet = "- [x]" if d.get("checked") else "- [ ]"
            kids = self._kids(b, depth + 1)
            return f"{ind}{bullet} {text}" + ("\n" + kids if kids else "")
        if t == "toggle":
            kids = self._kids(b, depth + 1)
            return f"{ind}- **{text}**" + ("\n" + kids if kids else "")
        if t == "quote":
            kids = self._kids(b, 0)
            body = text + ("\n" + kids if kids else "")
            return "\n".join(f"{ind}> {line}" for line in body.splitlines()) + "\n"
        if t == "callout":
            icon = (d.get("icon") or {}).get("emoji", "💡")
            kids = self._kids(b, 0)
            body = f"[!note] {icon} {text}" + ("\n" + kids if kids else "")
            return "\n".join(f"{ind}> {line}" for line in body.splitlines()) + "\n"
        if t == "code":
            lang = d.get("language", "")
            return f"{ind}```{'' if lang == 'plain text' else lang}\n{_plain(d.get('rich_text'))}\n```\n"
        if t == "equation":
            return f"$$\n{d.get('expression', '')}\n$$\n"
        if t == "divider":
            return "---\n"
        if t == "image":
            return self.image(d) + "\n"
        if t in ("bookmark", "embed", "link_preview"):
            url = d.get("url", "")
            cap = _rich(d.get("caption")) or url
            return f"[{cap}]({url})\n"
        if t in ("file", "pdf", "video", "audio"):
            src = d.get("external", {}).get("url") or d.get("file", {}).get("url", "")
            name = d.get("name") or _rich(d.get("caption")) or t
            return f"[📎 {name}]({src})\n"
        if t == "table":
            return self.table(b) + "\n"
        if t in ("column_list", "column", "synced_block"):
            return self._kids(b, depth)
        if t == "child_page":
            return f"- 📄 [[{vault.sanitize_filename(d.get('title', ''))}]]"
        if t == "child_database":
            return f"- 🗂️ {d.get('title', '子資料庫')}（請在 Notion 查看）"
        if t == "table_of_contents":
            return None
        return f"{ind}<!-- 不支援的 Notion 區塊：{t} -->"

    def table(self, b: dict) -> str:
        rows = [r["table_row"]["cells"] for r in self.children(b["id"]) if r["type"] == "table_row"]
        if not rows:
            return ""
        md = ["| " + " | ".join(_rich(c).replace("|", "\\|") for c in row) + " |" for row in rows]
        md.insert(1, "|" + " --- |" * len(rows[0]))
        return "\n".join(md) + "\n"

    def image(self, d: dict) -> str:
        cap = _rich(d.get("caption"))
        if d.get("type") == "external":
            return f"![{cap}]({d['external']['url']})"
        url = d.get("file", {}).get("url", "")
        try:
            r = httpx.get(url, timeout=60, follow_redirects=True)
            r.raise_for_status()
            ext = Path(url.split("?")[0]).suffix or mimetypes.guess_extension(
                r.headers.get("content-type", "").split(";")[0]
            ) or ".png"
            self.img_count += 1
            name = vault.sanitize_filename(f"{self.page_title}-{self.img_count}") + ext
            p = vault.safe_path(f"{config.ATTACHMENTS_DIR}/notion/{name}")
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(r.content)
            return f"![[{name}]]"
        except httpx.HTTPError:
            return f"![{cap}]({url})"


# ---------- 同步主流程 ----------

def _query_database(client: httpx.Client) -> list[dict]:
    pages, cursor = [], None
    while True:
        body = {"page_size": 100, "sorts": [{"timestamp": "last_edited_time", "direction": "descending"}]}
        if cursor:
            body["start_cursor"] = cursor
        r = client.post(f"/databases/{config.NOTION_DATABASE_ID}/query", json=body)
        r.raise_for_status()
        data = r.json()
        pages += data["results"]
        if not data.get("has_more"):
            return pages
        cursor = data["next_cursor"]


def _yaml(v) -> str:
    if isinstance(v, list):
        return "[" + ", ".join(json.dumps(x, ensure_ascii=False) for x in v) + "]"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return str(v)
    return json.dumps(str(v), ensure_ascii=False)


def sync(force: bool = False) -> dict:
    if _progress["running"]:
        return status()
    _progress.update(running=True, message="同步中…", synced=0, skipped=0, errors=[])
    try:
        with _client() as client, _state_lock:
            state = _load_state()
            pages = _query_database(client)
            _progress["message"] = f"共 {len(pages)} 頁"
            for page in pages:
                if page.get("archived") or page.get("in_trash"):
                    continue
                pid = page["id"]
                edited = page["last_edited_time"]
                prev = state.get(pid)
                if not force and prev and prev["last_edited"] == edited and vault.safe_path(prev["path"]).exists():
                    _progress["skipped"] += 1
                    continue
                try:
                    meta = _page_meta(page)
                    folder = f"{config.CLASS_NOTES_DIR}/{vault.sanitize_filename(meta['course'])}"
                    target = f"{folder}/{vault.sanitize_filename(meta['title'])}.md"
                    # 標題/課程改了 → 移除舊檔
                    if prev and prev["path"] != target:
                        old = vault.safe_path(prev["path"])
                        if old.exists():
                            old.unlink()
                    elif not prev and vault.safe_path(target).exists():
                        target = vault.rel(vault.unique_path(vault.safe_path(target)))
                    body = _Converter(client, meta["title"]).convert(pid)
                    fm = [
                        "---",
                        f"notion_id: {pid}",
                        f"notion_url: {page.get('url', '')}",
                        f"course: {_yaml(meta['course'])}",
                        f"created: {page['created_time'][:10]}",
                        f"last_edited: {edited}",
                        f"synced: {datetime.now():%Y-%m-%d %H:%M}",
                    ]
                    fm += [f"{_yaml(k)[1:-1]}: {_yaml(v)}" for k, v in meta["props"].items()]
                    fm += ["tags: [課堂筆記]", "---", ""]
                    note = "\n".join(fm) + f"\n# {meta['title']}\n\n> [!info] 由 Notion 同步，請在 Notion 編輯（本機修改會在下次同步時被覆蓋）\n\n{body}\n"
                    vault.write_note(target, note)
                    state[pid] = {"path": target, "last_edited": edited, "title": meta["title"], "course": meta["course"]}
                    _save_state(state)
                    _progress["synced"] += 1
                except Exception as e:  # 單頁失敗不影響其他頁
                    _progress["errors"].append(f"{pid}: {e}")
            _progress["message"] = f"完成：更新 {_progress['synced']} 頁，略過 {_progress['skipped']} 頁"
    except httpx.HTTPStatusError as e:
        _progress["message"] = f"Notion API 錯誤 {e.response.status_code}：{e.response.text[:200]}"
    except Exception as e:
        _progress["message"] = f"錯誤：{e}"
    finally:
        _progress["running"] = False
        _progress["last_run"] = datetime.now().isoformat(timespec="seconds")
    return status()


def sync_in_background(force: bool = False):
    threading.Thread(target=sync, args=(force,), daemon=True).start()


def status() -> dict:
    state = _load_state() if config.NOTION_STATE_FILE.exists() else {}
    courses: dict[str, int] = {}
    for v in state.values():
        courses[v["course"]] = courses.get(v["course"], 0) + 1
    return {
        "configured": bool(config.NOTION_TOKEN and config.NOTION_DATABASE_ID),
        **_progress,
        "total_pages": len(state),
        "courses": [
            {"name": k, "count": c, "folder": f"{config.CLASS_NOTES_DIR}/{vault.sanitize_filename(k)}"}
            for k, c in sorted(courses.items())
        ],
    }
