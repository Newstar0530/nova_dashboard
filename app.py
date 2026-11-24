"""Nova Dashboard — 個人工作台（知識庫、郵件、行事曆、待辦、課堂筆記、每日紀錄）。"""
import asyncio
import imaplib
import os
import re
import webbrowser
from contextlib import asynccontextmanager
from datetime import date

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from services import calendar_feed, daily, glance, ielts, inbox, journal, links, mail, notion_sync, tasks, vault

AUTO_SYNC_MINUTES = int(os.getenv("NOTION_AUTO_SYNC_MINUTES", "0"))


@asynccontextmanager
async def lifespan(_app):
    config.VAULT_PATH.mkdir(parents=True, exist_ok=True)
    task = None
    if AUTO_SYNC_MINUTES > 0 and notion_sync.status()["configured"]:

        async def loop():
            while True:
                await asyncio.to_thread(notion_sync.sync)
                await asyncio.sleep(AUTO_SYNC_MINUTES * 60)

        task = asyncio.create_task(loop())
    yield
    if task:
        task.cancel()


app = FastAPI(title="Nova Dashboard", lifespan=lifespan)
STATIC = config.BASE_DIR / "static"
app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.middleware("http")
async def _no_stale_assets(request, call_next):
    """前端檔案每次都向伺服器確認（有 ETag，沒改就回 304），更新後不用強制重新整理。"""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(ValueError)
async def _bad_path(_req, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(mail.MailNotConfigured)
@app.exception_handler(notion_sync.NotionNotConfigured)
async def _not_configured(_req, exc):
    return JSONResponse({"detail": str(exc), "code": "not_configured"}, status_code=412)


@app.exception_handler(mail.MailAuthError)
async def _mail_auth(_req, exc):
    return JSONResponse({"detail": str(exc), "code": "auth_failed"}, status_code=401)


@app.exception_handler(imaplib.IMAP4.error)
@app.exception_handler(mail.MailConnectionError)
async def _imap_error(_req, exc):
    return JSONResponse({"detail": f"Could not connect to the mail server: {exc}"}, status_code=502)


@app.exception_handler(tasks.TaskNotFound)
@app.exception_handler(inbox.CaptureNotFound)
async def _task_missing(_req, exc):
    return JSONResponse({"detail": str(exc)}, status_code=404)


@app.exception_handler(httpx.HTTPStatusError)
async def _upstream(_req, exc: httpx.HTTPStatusError):
    return JSONResponse({"detail": f"External service error {exc.response.status_code}: {exc.response.text[:300]}"}, status_code=502)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    # 有些瀏覽器不看 <link rel="icon">，直接要 /favicon.ico
    return FileResponse(STATIC / "icons" / "favicon.png", media_type="image/png")


# ---------- Obsidian ----------

@app.get("/api/vault/info")
def vault_info():
    return {"name": vault.vault_name(), "path": str(config.VAULT_PATH)}


@app.get("/api/vault/tree")
def vault_tree():
    return vault.tree()


@app.get("/api/vault/recent")
def vault_recent(limit: int = 12):
    return vault.recent(limit)


@app.get("/api/vault/note")
def vault_note(path: str):
    p = vault.safe_path(path)
    if not p.is_file():
        raise HTTPException(404, "Note not found")
    return vault.read_note(path)


@app.get("/api/vault/file")
def vault_file(path: str):
    p = vault.safe_path(path)
    if not p.is_file():
        raise HTTPException(404)
    return FileResponse(p)


@app.get("/api/vault/search")
def vault_search(q: str):
    return vault.search(q)


class Capture(BaseModel):
    text: str
    title: str | None = None


@app.post("/api/vault/capture")
def vault_capture(body: Capture):
    if not body.text.strip():
        raise HTTPException(400, "Content cannot be empty")
    return vault.capture(body.text, body.title or None)


@app.delete("/api/vault/note")
def vault_delete(path: str):
    return vault.trash_note(path)


class NoteSave(BaseModel):
    path: str
    content: str
    mtime: str | None = None
    force: bool = False


@app.put("/api/vault/note")
def vault_save(body: NoteSave):
    try:
        return vault.save_note(body.path, body.content, body.mtime, body.force)
    except FileNotFoundError:
        raise HTTPException(404, "Note not found")
    except vault.Conflict:
        raise HTTPException(409, "This note was changed somewhere else (e.g. in Obsidian) after you opened it")


class NoteCreate(BaseModel):
    folder: str = ""
    title: str
    template: str | None = None


@app.post("/api/vault/note")
def vault_create(body: NoteCreate):
    return vault.create_note(body.folder, body.title, body.template or None)


@app.get("/api/vault/folders")
def vault_folders():
    return vault.folders()


@app.get("/api/vault/templates")
def vault_templates():
    return vault.templates()


# ---------- Inbox（快速記錄） ----------

class CaptureAction(BaseModel):
    id: str
    text: str | None = None
    due: str | None = None
    priority: str | None = None


@app.get("/api/inbox")
def inbox_list(days: int = 7):
    return inbox.list_captures(max(1, min(days, 60)))


@app.post("/api/inbox/convert")
def inbox_convert(body: CaptureAction):
    return inbox.convert(body.id, body.text or None, body.due or None, body.priority or None)


@app.post("/api/inbox/delete")
def inbox_delete(body: CaptureAction):
    return inbox.delete(body.id)


# ---------- Gmail ----------

@app.get("/api/mail/status")
def mail_status():
    return mail.status()


@app.get("/api/mail/messages")
def mail_messages(top: int = 40, q: str | None = None, school: str | None = None, only_school: bool = False):
    return mail.list_messages(min(top, 100), q or None, school or None, only_school)


@app.get("/api/mail/messages/{msg_id}")
def mail_message(msg_id: str):
    return mail.get_message(msg_id)


# ---------- 每日資訊（Claude 排程任務的報告） ----------

@app.get("/api/daily")
def daily_overview(refresh: bool = False):
    return {"configured": bool(config.GMAIL_ADDRESS and config.GMAIL_APP_PASSWORD),
            "feeds": daily.overview(refresh) if config.GMAIL_ADDRESS and config.GMAIL_APP_PASSWORD else []}


@app.get("/api/daily/triage")
def daily_triage():
    if not (config.GMAIL_ADDRESS and config.GMAIL_APP_PASSWORD):
        return {"report": None}
    return daily.triage_today()


class AttentionDone(BaseModel):
    done: bool


@app.put("/api/daily/triage/{report_id}/{key}")
def daily_triage_done(report_id: str, key: str, body: AttentionDone):
    if not report_id.isdigit() or not re.fullmatch(r"[0-9a-f]{12}", key):
        raise HTTPException(400, "Invalid item")
    return {"done": daily.set_done(report_id, key, body.done)}


@app.get("/api/glance")
def glance_overview():
    return glance.overview()


@app.get("/api/daily/{msg_id}")
def daily_issue(msg_id: str):
    m = mail.get_message(msg_id)
    daily.mark_read(msg_id)
    return m


@app.post("/api/mail/messages/{msg_id}/to-vault")
def mail_to_vault(msg_id: str):
    return mail.save_to_vault(msg_id)


# ---------- Notion ----------

@app.get("/api/notion/status")
def notion_status():
    return notion_sync.status()


@app.post("/api/notion/sync")
def notion_sync_now(force: bool = False):
    if not notion_sync.status()["configured"]:
        raise notion_sync.NotionNotConfigured("NOTION_TOKEN / NOTION_DATABASE_ID not set; see the README")
    notion_sync.sync_in_background(force)
    return {"started": True}


# ---------- 待辦 ----------

class TaskIn(BaseModel):
    text: str
    due: str | None = None
    priority: str | None = None
    scheduled: str | None = None
    project: str | None = None


class TaskPatch(BaseModel):
    text: str | None = None
    done: bool | None = None
    due: str | None = None
    clear_due: bool = False
    priority: str | None = None
    status: str | None = None
    scheduled: str | None = None
    clear_scheduled: bool = False
    project: str | None = None
    clear_project: bool = False


@app.get("/api/tasks")
def tasks_list(include_done: bool = False):
    return tasks.list_tasks(include_done)


@app.get("/api/tasks/meta")
def tasks_meta():
    return tasks.meta()


@app.post("/api/tasks")
def tasks_add(body: TaskIn):
    return tasks.add_task(body.text, body.due or None, body.priority or None, body.scheduled or None, body.project or None)


# 待辦 id 是 vault 內的相對路徑（含 /），所以用 :path
@app.patch("/api/tasks/{task_id:path}")
def tasks_update(task_id: str, body: TaskPatch):
    return tasks.update_task(task_id, body.text, body.done, body.due or None, body.clear_due,
                             body.priority or None, body.status or None, body.scheduled or None, body.clear_scheduled,
                             body.project or None, body.clear_project)


@app.delete("/api/tasks/{task_id:path}")
def tasks_delete(task_id: str):
    return tasks.delete_task(task_id)


@app.get("/api/ielts")
def ielts_status():
    return ielts.status()


@app.post("/api/links/rebuild")
def links_rebuild():
    return links.rebuild_course_hubs()


# ---------- 行事曆 ----------

@app.get("/api/calendar/status")
def calendar_status():
    return calendar_feed.status()


@app.get("/api/calendar/events")
def calendar_events(start: str, end: str, refresh: bool = False):
    s, e = date.fromisoformat(start), date.fromisoformat(end)
    if not s < e or (e - s).days > 62:
        raise ValueError("Invalid date range (max 62 days)")
    result = calendar_feed.events(s, e, refresh)
    result["tasks"] = tasks.due_between(s, e)
    return result


# ---------- 每日紀錄 ----------

class SettingsIn(BaseModel):
    habits: list[str]
    subjects: list[str]


class MoodIn(BaseModel):
    mood: int | None = None


class DiaryIn(BaseModel):
    text: str


class HabitIn(BaseModel):
    habit: str
    done: bool


class StudyIn(BaseModel):
    subject: str
    minutes: int
    start: str | None = None
    note: str = ""


@app.get("/api/records/settings")
def records_settings():
    return journal.settings()


@app.put("/api/records/settings")
def records_save_settings(body: SettingsIn):
    return journal.save_settings(body.habits, body.subjects)


@app.get("/api/records/stats")
def records_stats(days: int = 84):
    return journal.stats(max(7, min(days, 366)))


@app.get("/api/records/day/{day}")
def records_day(day: str):
    return journal.get_day(journal.parse_date(day))


@app.put("/api/records/day/{day}/mood")
def records_mood(day: str, body: MoodIn):
    return journal.set_mood(journal.parse_date(day), body.mood)


@app.put("/api/records/day/{day}/diary")
def records_diary(day: str, body: DiaryIn):
    return journal.set_diary(journal.parse_date(day), body.text)


@app.put("/api/records/day/{day}/habit")
def records_habit(day: str, body: HabitIn):
    return journal.set_habit(journal.parse_date(day), body.habit, body.done)


@app.post("/api/records/day/{day}/study")
def records_study(day: str, body: StudyIn):
    return journal.add_study(journal.parse_date(day), body.subject, body.minutes, body.start, body.note)


if __name__ == "__main__":
    import uvicorn

    url = f"http://{config.HOST}:{config.PORT}"
    print(f"Nova Dashboard → {url}\nVault → {config.VAULT_PATH}")
    if os.getenv("NO_BROWSER") != "1":
        webbrowser.open(url)
    uvicorn.run(app, host=config.HOST, port=config.PORT)
