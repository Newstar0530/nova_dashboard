"""Nova Dashboard — 個人工作台（Obsidian 知識庫 + Outlook 郵件 + Notion 課堂筆記）。"""
import asyncio
import os
import webbrowser
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import config
from services import mail, notion_sync, vault

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


@app.exception_handler(ValueError)
async def _bad_path(_req, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.exception_handler(mail.MailNotConfigured)
@app.exception_handler(notion_sync.NotionNotConfigured)
async def _not_configured(_req, exc):
    return JSONResponse({"detail": str(exc), "code": "not_configured"}, status_code=412)


@app.exception_handler(mail.NotSignedIn)
async def _not_signed_in(_req, exc):
    return JSONResponse({"detail": str(exc), "code": "not_signed_in"}, status_code=401)


@app.exception_handler(httpx.HTTPStatusError)
async def _upstream(_req, exc: httpx.HTTPStatusError):
    return JSONResponse({"detail": f"外部服務錯誤 {exc.response.status_code}: {exc.response.text[:300]}"}, status_code=502)


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


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
        raise HTTPException(404, "找不到筆記")
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
        raise HTTPException(400, "內容不可空白")
    return vault.capture(body.text, body.title or None)


# ---------- Outlook ----------

@app.get("/api/mail/status")
def mail_status():
    return mail.status()


@app.post("/api/mail/login")
def mail_login():
    return mail.start_login()


@app.post("/api/mail/logout")
def mail_logout():
    mail.logout()
    return {"ok": True}


@app.get("/api/mail/messages")
def mail_messages(folder: str = "inbox", top: int = 30, q: str | None = None):
    return mail.list_messages(folder, min(top, 100), q or None)


@app.get("/api/mail/messages/{msg_id}")
def mail_message(msg_id: str):
    return mail.get_message(msg_id)


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
        raise notion_sync.NotionNotConfigured("尚未設定 NOTION_TOKEN / NOTION_DATABASE_ID，請參考 README")
    notion_sync.sync_in_background(force)
    return {"started": True}


if __name__ == "__main__":
    import uvicorn

    url = f"http://{config.HOST}:{config.PORT}"
    print(f"Nova Dashboard → {url}\nVault → {config.VAULT_PATH}")
    if os.getenv("NO_BROWSER") != "1":
        webbrowser.open(url)
    uvicorn.run(app, host=config.HOST, port=config.PORT)
