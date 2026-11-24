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
RECORDS_DIR = os.getenv("RECORDS_DIR", "40 紀錄")  # 每日筆記（日記、心情、打卡、學習時數）

# 行事曆訂閱（ICS 網址）：標籤=網址，用分號分隔
CALENDAR_ICS = os.getenv("CALENDAR_ICS", "").strip()

# Gmail（IMAP + 應用程式密碼）
GMAIL_ADDRESS = os.getenv("GMAIL_ADDRESS", "").strip()
GMAIL_APP_PASSWORD = os.getenv("GMAIL_APP_PASSWORD", "").strip()
IMAP_HOST = os.getenv("IMAP_HOST", "imap.gmail.com").strip()
# 轉寄到 Gmail 的學校信箱：標籤=地址，用分號分隔
MAIL_ACCOUNTS = os.getenv("MAIL_ACCOUNTS", "").strip()

# 每日資訊：Claude 排程任務寄到 Gmail 的報告，依信件主旨開頭辨識
# 格式：名稱=主旨開頭，用分號分隔
DAILY_FEEDS = os.getenv(
    "DAILY_FEEDS",
    "Inbox triage=[收件匣整理];AI daily digest=[AI 每日摘要];"
    "Student deals=[留學生交通住宿優惠];AI stocks weekly=[AI 股價影響週報]",
).strip()

# Today 頁世界時鐘旁的天氣：名稱=緯度,經度，用分號分隔（台灣、法國各一個）
WEATHER_PLACES = os.getenv("WEATHER_PLACES", "Hsinchu=24.8138,120.9675;Rouen=49.4431,1.0993").strip()

# Notion
NOTION_TOKEN = os.getenv("NOTION_TOKEN", "").strip()
NOTION_DATABASE_ID = os.getenv("NOTION_DATABASE_ID", "").strip()
NOTION_COURSE_PROPERTY = os.getenv("NOTION_COURSE_PROPERTY", "課程").strip()
NOTION_STATE_FILE = BASE_DIR / ".notion_sync_state.json"

HOST = os.getenv("HOST", "127.0.0.1")
PORT = int(os.getenv("PORT", "8765"))
