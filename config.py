"""讀取 .env 設定。"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

# Obsidian vault 位置（預設為同層的「知識庫」資料夾）
VAULT_PATH = Path(os.getenv("VAULT_PATH", BASE_DIR.parent / "知識庫")).resolve()
INBOX_DIR = os.getenv("INBOX_DIR", "00 Inbox")
CLASS_NOTES_DIR = os.getenv("CLASS_NOTES_DIR", "10 課堂筆記")
ATTACHMENTS_DIR = os.getenv("ATTACHMENTS_DIR", "90 附件")

# Microsoft Graph（Outlook / 學校信箱）
MS_CLIENT_ID = os.getenv("MS_CLIENT_ID", "").strip()
MS_TENANT = os.getenv("MS_TENANT", "common").strip() or "common"
MS_SCOPES = ["Mail.Read", "User.Read"]
TOKEN_CACHE_FILE = BASE_DIR / ".token_cache.json"

# Notion
NOTION_TOKEN = os.getenv("NOTION_TOKEN", "").strip()
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID", "").strip()
NOTION_COURSE_PROPERTY = os.getenv("NOTION_COURSE_PROPERTY", "課程").strip()
NOTION_STATE_FILE = BASE_DIR / ".notion_sync_state.json"

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8765"))
