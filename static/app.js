const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.detail || res.statusText);
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function toast(msg) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.append(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2200);
}

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

/* ---------- greeting ---------- */
(function greet() {
  const h = new Date().getHours();
  const hi = h < 5 ? "夜深了" : h < 12 ? "早安" : h < 18 ? "午安" : "晚安";
  $("#greeting").textContent = `${hi}・${new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" })}`;
})();

/* ---------- reader ---------- */
const reader = $("#reader");
let activePath = null;

async function openNote(path) {
  try {
    const n = await api(`/api/vault/note?path=${encodeURIComponent(path)}`);
    activePath = n.path;
    reader.innerHTML = `
      <div class="reader-head">
        <div><h1>${esc(n.name)}</h1><div class="muted small">${esc(n.path)}</div></div>
        <div class="btns"><a class="ghost" href="${esc(n.obsidian_uri)}">在 Obsidian 開啟</a></div>
      </div>
      <div class="reader-body">
        ${n.frontmatter ? `<div class="frontmatter">${esc(n.frontmatter.replace(/^---\n|---\n$/g, ""))}</div>` : ""}
        <div class="markdown">${n.html}</div>
      </div>`;
    reader.querySelectorAll(".wikilink[data-path]").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); openNote(a.dataset.path); }));
    reader.querySelectorAll(".markdown a[href^='http']").forEach((a) => (a.target = "_blank"));
    document.querySelectorAll("#vault-list .item").forEach((i) => i.classList.toggle("active", i.dataset.path === n.path));
  } catch (e) { toast(e.message); }
}

/* ---------- vault ---------- */
let vaultTab = "recent";
let folderFilter = null;
const vaultList = $("#vault-list");

function noteItem(n, sub = "") {
  return `<button class="item${n.path === activePath ? " active" : ""}" data-path="${esc(n.path)}">
    <div class="title">${esc(n.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</button>`;
}

async function loadVault() {
  const q = $("#vault-search").value.trim();
  try {
    if (q) {
      const hits = await api(`/api/vault/search?q=${encodeURIComponent(q)}`);
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
      vaultList.innerHTML = hits.length
        ? hits.map((h) => noteItem(h, esc(h.snippet).replace(re, (m) => `<mark>${m}</mark>`) || esc(h.path))).join("")
        : `<p class="muted small">沒有符合「${esc(q)}」的筆記</p>`;
    } else if (vaultTab === "recent") {
      const notes = await api("/api/vault/recent?limit=30");
      vaultList.innerHTML = notes.length
        ? notes.map((n) => noteItem(n, `${esc(n.path.split("/").slice(0, -1).join(" / ") || "根目錄")}・${fmtTime(n.modified)}`)).join("")
        : `<p class="muted small">vault 還沒有筆記，試試上方的快速記錄。</p>`;
    } else {
      const groups = await api("/api/vault/tree");
      const shown = folderFilter ? groups.filter((g) => g.folder === folderFilter || g.folder.startsWith(folderFilter + "/")) : groups;
      vaultList.innerHTML =
        (folderFilter ? `<button class="ghost" id="clear-filter">✕ ${esc(folderFilter)}</button>` : "") +
        shown.map((g) => `<div class="folder">${esc(g.folder || "根目錄")} <span class="small">(${g.notes.length})</span></div>
          <div class="folder-items">${g.notes.map((n) => noteItem(n)).join("")}</div>`).join("");
      $("#clear-filter")?.addEventListener("click", () => { folderFilter = null; loadVault(); });
    }
  } catch (e) { vaultList.innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
}

vaultList.addEventListener("click", (e) => {
  const item = e.target.closest(".item[data-path]");
  if (item) return openNote(item.dataset.path);
  const f = e.target.closest(".folder");
  if (f) f.classList.toggle("collapsed");
});
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
  vaultTab = t.dataset.tab;
  loadVault();
}));
let searchTimer;
$("#vault-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadVault, 250); });

api("/api/vault/info").then((v) => ($("#vault-name").textContent = v.name)).catch(() => {});

/* ---------- quick capture ---------- */
$("#capture-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); capture(true); }
});
$("#capture").addEventListener("submit", (e) => { e.preventDefault(); capture(false); });

async function capture(asNote) {
  const input = $("#capture-text");
  const text = input.value.trim();
  if (!text) return;
  let title = null;
  if (asNote) {
    title = prompt("新筆記標題：", text.slice(0, 30));
    if (!title) return;
  }
  try {
    const r = await api("/api/vault/capture", { method: "POST", body: JSON.stringify({ text, title }) });
    input.value = "";
    toast(`已記錄到 ${r.path}`);
    loadVault();
  } catch (e) { toast(e.message); }
}

/* ---------- mail ---------- */
const mailBody = $("#mail-body");
let mailSchool = null;   // 目前篩選的學校標籤
let mailReq = 0;         // 避免舊請求覆蓋新結果
let onlySchool = true;   // 只看學校轉寄的信（記在瀏覽器）
try { onlySchool = localStorage.getItem("nova.onlySchool") !== "0"; } catch {}

async function loadMail() {
  const req = ++mailReq;
  try {
    const s = await api("/api/mail/status");
    $("#mail-tools").hidden = !s.configured;
    if (!s.configured) {
      mailBody.innerHTML = `<div class="notice">尚未設定 Gmail。<br>請在 <code>workbench/.env</code> 填入 <code>GMAIL_ADDRESS</code> 與 <code>GMAIL_APP_PASSWORD</code>（步驟見 README）後重新啟動。</div>`;
      return;
    }
    $("#mail-schools").innerHTML =
      `<button class="chip${onlySchool ? " on" : ""}" id="only-school" title="只顯示從學校 Outlook 轉寄過來的信">🏫 只看學校轉寄</button>` +
      s.schools.map((x) => `<button class="chip${mailSchool === x.label ? " on" : ""}" data-school="${esc(x.label)}">${esc(x.label)}</button>
        <a class="chip" href="${esc(x.link)}" target="_blank" title="開啟${esc(x.label)} Outlook（確認有沒有漏轉寄的信）">${esc(x.label)} Outlook ↗</a>`).join("");
    mailBody.innerHTML = `<p class="muted small">${esc(s.account)}・載入中…</p>`;
    const params = new URLSearchParams({ top: 40 });
    const q = $("#mail-search").value.trim();
    if (q) params.set("q", q);
    if (mailSchool) params.set("school", mailSchool);
    else if (onlySchool) params.set("only_school", "true");
    const msgs = await api(`/api/mail/messages?${params}`);
    if (req !== mailReq) return;
    mailBody.innerHTML = `<p class="muted small">${esc(s.account)}</p>` + (msgs.length ? msgs.map((m) => `
      <button class="item mail-item${m.is_read ? "" : " unread"}" data-id="${esc(m.id)}">
        <div class="mail-meta"><span>${m.important ? "⭐ " : ""}${esc(m.from)}</span><span>${m.has_attachments ? "📎 " : ""}${fmtTime(m.received)}</span></div>
        <div class="title">${esc(m.subject)}</div>
        ${m.school ? `<div class="sub"><span class="tag">${esc(m.school)}</span></div>` : ""}
      </button>`).join("") : `<p class="muted small">${q || mailSchool || onlySchool ? "最近沒有符合的郵件" : "收件匣是空的 🎉"}</p>`);
  } catch (e) {
    if (req === mailReq) mailBody.innerHTML = `<div class="notice">${esc(e.message)}</div>`;
  }
}

$("#mail-schools").addEventListener("click", (e) => {
  const chip = e.target.closest("button.chip");
  if (!chip) return;
  if (chip.id === "only-school") {
    onlySchool = !onlySchool;
    mailSchool = null;
    try { localStorage.setItem("nova.onlySchool", onlySchool ? "1" : "0"); } catch {}
  } else {
    mailSchool = mailSchool === chip.dataset.school ? null : chip.dataset.school;  // 再點一次取消
  }
  loadMail();
});
let mailSearchTimer;
$("#mail-search").addEventListener("input", () => { clearTimeout(mailSearchTimer); mailSearchTimer = setTimeout(loadMail, 500); });

mailBody.addEventListener("click", async (e) => {
  const item = e.target.closest(".mail-item");
  if (!item) return;
  mailBody.querySelectorAll(".mail-item").forEach((i) => i.classList.toggle("active", i === item));
  item.classList.remove("unread");
  activePath = null;
  reader.innerHTML = `<div class="empty"><p>載入郵件中…</p></div>`;
  try {
    const m = await api(`/api/mail/messages/${encodeURIComponent(item.dataset.id)}`);
    reader.innerHTML = `
      <div class="reader-head">
        <div><h1>${esc(m.subject)}</h1>
          <div class="muted small">${m.school ? `<span class="tag">${esc(m.school)}</span> ` : ""}${esc(m.from)}・${m.received ? new Date(m.received).toLocaleString("zh-TW") : ""}</div>
          ${m.attachments?.length ? `<div class="muted small">📎 ${m.attachments.map(esc).join("、")}</div>` : ""}</div>
        <div class="btns">
          <button class="ghost" id="to-vault">存到知識庫</button>
          ${m.web_link ? `<a class="ghost" href="${esc(m.web_link)}" target="_blank">在 Gmail 開啟</a>` : ""}
        </div>
      </div>
      <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`;
    const body = m.body_type === "text" ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.body_html)}</pre>` : m.body_html;
    $("iframe", reader).srcdoc = `<base target="_blank"><style>body{font-family:"Segoe UI","Microsoft JhengHei",sans-serif;padding:16px 24px;color:#1f2328}img{max-width:100%}</style>${body}`;
    $("#to-vault").onclick = async () => {
      try {
        const r = await api(`/api/mail/messages/${encodeURIComponent(m.id)}/to-vault`, { method: "POST" });
        toast(`已存到 ${r.path}`);
        loadVault();
      } catch (err) { toast(err.message); }
    };
  } catch (err) { reader.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; }
});
$("#mail-refresh").onclick = loadMail;

/* ---------- notion ---------- */
const notionBody = $("#notion-body");
let notionPoll = null;

async function loadNotion() {
  try {
    const s = await api("/api/notion/status");
    $("#notion-sync").disabled = !s.configured || s.running;
    if (!s.configured) {
      notionBody.innerHTML = `<div class="notice">尚未設定 Notion。<br>請在 <code>workbench/.env</code> 填入 <code>NOTION_TOKEN</code> 與 <code>NOTION_DATABASE_ID</code>（步驟見 README）。</div>`;
      return s;
    }
    notionBody.innerHTML = `
      ${s.message || !s.total_pages ? `<div class="small">${s.running ? "⏳ " : ""}${esc(s.message || "尚未同步")}</div>` : ""}
      <div class="muted small">已同步 ${s.total_pages} 頁${s.last_run ? "・上次 " + new Date(s.last_run).toLocaleString("zh-TW") : ""}</div>
      ${s.errors?.length ? `<details class="small"><summary>${s.errors.length} 個錯誤</summary>${s.errors.map(esc).join("<br>")}</details>` : ""}
      <div class="courses">${s.courses.map((c) => `<button class="chip" data-folder="${esc(c.folder)}">${esc(c.name)} · ${c.count}</button>`).join("")}</div>`;
    return s;
  } catch (e) { notionBody.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
}

notionBody.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  $("#vault-search").value = "";
  folderFilter = chip.dataset.folder;
  document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === "tree"));
  vaultTab = "tree";
  loadVault();
});

$("#notion-sync").addEventListener("click", async (e) => {
  try {
    await api(`/api/notion/sync${e.shiftKey ? "?force=true" : ""}`, { method: "POST" });
    toast(e.shiftKey ? "強制重新同步全部頁面…" : "開始同步 Notion…");
    clearInterval(notionPoll);
    notionPoll = setInterval(async () => {
      const s = await loadNotion();
      if (s && !s.running) { clearInterval(notionPoll); loadVault(); }
    }, 1500);
    loadNotion();
  } catch (err) { toast(err.message); }
});

/* ---------- init ---------- */
loadVault();
loadMail();
loadNotion();
