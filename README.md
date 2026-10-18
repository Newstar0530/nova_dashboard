# ✦ Nova Dashboard

個人工作台：一個本機網頁，同時看 **Obsidian 知識庫**、**Outlook / 學校信箱**、**Notion 課堂筆記**。

- 📚 **知識庫**：瀏覽、搜尋、閱讀 Obsidian vault（支援 `[[雙向連結]]`），一鍵在 Obsidian 開啟
- ✍️ **快速記錄**：上方輸入框 Enter → 附加到 `00 Inbox/今天.md`；Shift+Enter → 另存新筆記
- ✉️ **郵件**：Microsoft Graph 讀取 Outlook 收件匣，重要的信可「存到知識庫」
- 📝 **課堂筆記**：Notion 資料庫 → 同步成 Markdown 到 `10 課堂筆記/<課程>/`，圖片自動下載

資料只在你的電腦上：伺服器只聽 `127.0.0.1`，token 存在本機 `.env` / `.token_cache.json`（皆已 gitignore）。

## 快速開始

```bash
git clone https://github.com/Newstar0530/nova_dashboard.git workbench
```

1. 雙擊 `start.bat`（第一次會建立虛擬環境、安裝套件、複製 `.env`）
2. 瀏覽器自動開啟 http://127.0.0.1:8765
3. 在 Obsidian 選「開啟資料夾作為 vault」→ 選 `知識庫` 資料夾（「在 Obsidian 開啟」按鈕才會生效）

vault 預設在 workbench 同層的 `知識庫`，可用 `.env` 的 `VAULT_PATH` 改成任何資料夾。

## 設定 Outlook（學校信箱）

需要註冊一個 Azure App（免費，約 3 分鐘）：

1. 到 [Azure Portal → 應用程式註冊](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) →「新增註冊」
2. 名稱隨意（例如 `Nova Dashboard`）；支援的帳戶類型選 **「任何組織目錄中的帳戶及個人 Microsoft 帳戶」**
3. 建立後，左側「驗證」→ 最下方 **「允許公用用戶端流程」設為「是」** → 儲存
4. 「API 權限」確認有 `Mail.Read`、`User.Read`（Microsoft Graph／委派）
5. 複製「概觀」頁的 **應用程式 (用戶端) 識別碼** 填到 `.env` 的 `MS_CLIENT_ID`
6. 重啟工作台 → 郵件面板按「登入 Outlook」→ 輸入畫面上的代碼

> 如果學校帳號出現「需要管理員核准」，代表學校 IT 禁止使用者自行授權第三方 App，
> 需請學校 IT 核准，或改用個人 Outlook 帳號並設定學校信件自動轉寄。
> 沒有 Azure 帳號的話，用個人 Microsoft 帳號登入 Azure Portal 即可註冊。

## 設定 Notion 課堂筆記

1. 到 https://www.notion.so/profile/integrations →「新增整合」（Internal），複製 **Internal Integration Secret** → `.env` 的 `NOTION_TOKEN`
2. 在 Notion 準備一個課堂筆記**資料庫**（每頁一堂課），建議欄位：
   - `名稱`（標題）
   - `課程`（Select）← 用來分資料夾，欄位名可用 `NOTION_COURSE_PROPERTY` 修改
   - 其他欄位（日期、週次、標籤…）會自動寫進 frontmatter
3. 在資料庫頁面右上 `···` →「連線」→ 加入剛建立的整合
4. 資料庫網址 `https://www.notion.so/xxx/<32碼>?v=...` 中的 32 碼 → `NOTION_DATABASE_ID`
5. 重啟後按「同步」；**Shift+點同步** = 強制全部重抓

同步是單向的（Notion → Obsidian）：只更新有修改過的頁面，改標題/課程會自動搬檔。
想在 Obsidian 延伸整理，請另寫在 `20 知識` 並用 `[[連結]]` 指向課堂筆記。
`NOTION_AUTO_SYNC_MINUTES=30` 可每 30 分鐘自動同步。

## 專案結構

```
app.py                 FastAPI 伺服器 + API 路由
config.py              讀取 .env
services/vault.py      Obsidian vault 讀寫、搜尋、Markdown 渲染
services/mail.py       Microsoft Graph 郵件（MSAL device code 登入）
services/notion_sync.py Notion 資料庫 → Markdown
static/                前端（純 HTML/CSS/JS）
```
