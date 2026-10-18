# ✦ Nova Dashboard

個人工作台：一個本機網頁，把每天的小事集中在一起。左側（手機在下方）切換五個頁面：

- ◐ **今天**：今日行程、待辦、心情與習慣打卡、專注計時（番茄鐘）、學校信件、今日日記
- ▦ **行事曆**：訂閱學校 Outlook 行事曆（含每週重複的課），待辦的截止日也會顯示在上面
- ✉ **郵件**：Gmail（學校信箱轉寄過來），可依學校篩選、用 Gmail 語法搜尋，可「加入待辦」或「存到知識庫」
- ❖ **筆記**：瀏覽、搜尋、閱讀 Obsidian vault（支援 `[[雙向連結]]`），Notion 課堂筆記同步
- ◔ **紀錄**：習慣熱度圖與連續天數、心情折線、各科學習時數、日記回顧
- ✍️ **快速記錄**：上方輸入框 Enter → 附加到 `00 Inbox/今天.md`；Shift+Enter → 另存新筆記

所有資料都存成 vault 裡的 Markdown，Obsidian 也能直接開、會跟著 vault 同步到其他電腦：

| 資料 | 位置 | 格式 |
| --- | --- | --- |
| 待辦 | `30 待辦/待辦.md` | `- [ ] 內容 📅 2026-10-20`（相容 Obsidian Tasks 外掛） |
| 每日紀錄 | `40 紀錄/日記/YYYY-MM-DD.md` | frontmatter：`mood`、`habits`、`study`（Dataview 可查） |
| 習慣 / 科目清單 | `40 紀錄/設定.md` | 可在「紀錄」頁按「編輯項目」修改 |

資料只在你的電腦上：伺服器只聽 `127.0.0.1`，密碼與 token 只存在本機 `.env`（已 gitignore）。

## 快速開始

```bash
git clone https://github.com/Newstar0530/nova_dashboard.git workbench
```

1. 雙擊 `start.bat`（第一次會建立虛擬環境、安裝套件、複製 `.env`）
2. 瀏覽器自動開啟 http://127.0.0.1:8765
3. 在 Obsidian 選「開啟資料夾作為 vault」→ 選 `知識庫` 資料夾（「在 Obsidian 開啟」按鈕才會生效）

vault 預設在 workbench 同層的 `知識庫`，可用 `.env` 的 `VAULT_PATH` 改成任何資料夾。

## 設定郵件（學校信箱 → Gmail）

學校封鎖了第三方 App 直接讀 Outlook，所以改成「學校信箱轉寄到 Gmail，工作台讀 Gmail」。

1. **學校信箱轉寄**：學校 Outlook 網頁版 → 設定 →「郵件」→「轉寄」→ 填 Gmail，勾「保留轉寄郵件的複本」
2. **Gmail 防漏信**：Gmail 設定 →「篩選器和封鎖的地址」→ 建立篩選器，「收件者」填學校信箱 → 勾「一律不要將它傳送到垃圾郵件」
3. **應用程式密碼**：Google 帳號開啟兩步驟驗證 → https://myaccount.google.com/apppasswords 建立一組（16 碼）
4. 填入 `.env`：
   ```
   GMAIL_ADDRESS=你的帳號@gmail.com
   GMAIL_APP_PASSWORD=16碼應用程式密碼
   MAIL_ACCOUNTS=A校=s123@a.edu.tw;B校=s456@b.edu.tw
   ```
   `MAIL_ACCOUNTS` 的值可以是完整地址或網域（例如 `清大=nthu.edu.tw`）。填了之後郵件會標示來自哪間學校、可以篩選，並出現「開啟學校 Outlook」按鈕（用來確認有沒有漏轉寄的信）。

郵件區的「🏫 只看學校轉寄」開關（預設開啟）只顯示學校轉寄過來的信，判斷方式：
- 信件帶有 Outlook / Exchange 轉寄標頭（`X-MS-Exchange-ForwardingLoop`、`Resent-From`），或
- 收件者符合 `MAIL_ACCOUNTS` 裡的地址 / 網域（非 Outlook 的學校信箱靠這個判斷）

Gmail 搜尋查不到這些標頭，所以篩選時會在本機掃描最近 400 封的標頭。
5. 重啟工作台

搜尋框支援 Gmail 語法，例如 `from:王教授`、`has:attachment`、`subject:期中考`、`newer_than:7d`。
點開信件會標為已讀。其他支援 IMAP 的信箱也能用：改 `IMAP_HOST`，帳號密碼一樣填 `GMAIL_ADDRESS` / `GMAIL_APP_PASSWORD`。

## 設定行事曆（學校 Outlook）

1. 用學校帳號登入 Outlook 網頁版 → 右上齒輪「設定」→「行事曆」→「共用行事曆」
2. 在「發佈行事曆」選要發佈的行事曆、權限選「可以檢視所有詳細資料」→「發佈」
3. 複製 **ICS** 連結（不是 HTML），填到 `.env`：
   ```
   CALENDAR_ICS=NEOMA=https://outlook.office365.com/owa/calendar/.../calendar.ics
   ```
   多個行事曆用分號分隔；Google 日曆的「私人網址（iCal 格式）」也可以。
4. 重啟工作台。行程每 10 分鐘重新抓取一次，行事曆頁的 ⟳ 可立即更新。

> 若「發佈行事曆」選項不見或無法使用，代表學校關閉了這個功能。
> 這個網址等同密碼，知道網址的人都能看到你的行程，不要分享。

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
services/mail.py       Gmail 郵件（IMAP + 應用程式密碼）
services/notion_sync.py Notion 資料庫 → Markdown
services/tasks.py      待辦清單（Obsidian Tasks 格式）
services/calendar_feed.py ICS 行事曆訂閱（含重複行程）
services/journal.py    每日紀錄：日記、心情、習慣、學習時數
static/index.html      頁面骨架；static/js/ 每頁一支 JS；style.css 視覺 + views.css 版面
```
