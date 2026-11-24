// 共用工具、頁面切換（#today / #calendar / #mail / #notes / #records）、快速記錄。
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function api(path, opts = {}) {
  const init = { headers: { "Content-Type": "application/json" }, ...opts };
  if (init.body && typeof init.body !== "string") init.body = JSON.stringify(init.body);
  const res = await fetch(path, init);
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
  t._h = setTimeout(() => t.classList.remove("show"), 2400);
}

// ---------- 日期 ----------
const pad = (n) => String(n).padStart(2, "0");
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoDate(new Date());
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const parseISO = (s) => { const [y, m, d] = s.slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d); };
const WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmtMD = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtDay = (s) => `${WEEK[parseISO(s).getDay()]} ${fmtMD(s)}`;
const hhmm = (iso) => iso.length > 10 ? iso.slice(11, 16) : "";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// 信件框裡唯一能執行的程式：把滑鼠位置回報給工作台，讓游標光環在信件裡也跟著
const FRAME_RELAY = `(() => {
  const send = (t, e) => parent.postMessage({ novaFrame: t, x: e.clientX, y: e.clientY,
    hot: !!(e.target && e.target.closest && e.target.closest("a, button, input, summary")) }, "*");
  addEventListener("pointermove", (e) => send("move", e), { passive: true });
  addEventListener("pointerdown", (e) => send("down", e));
  addEventListener("pointerup", (e) => send("up", e));
  document.documentElement.addEventListener("pointerleave", (e) => send("leave", e));
})();`;

// 信件內容放進 iframe：深色底，並蓋掉信件自帶的白底與深色字，避免看不到。
// 框是隔離的（sandbox，不同來源），CSP 只放行帶這次隨機 nonce 的 FRAME_RELAY，信件自己的程式一律不執行。
function mailDoc(m) {
  const html = m.body_type === "text" ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.body_html)}</pre>` : m.body_html;
  const nonce = crypto.randomUUID().replaceAll("-", "");
  return `<meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}'; object-src 'none'">
  <script nonce="${nonce}">${FRAME_RELAY}</script>
  <base target="_blank"><meta name="color-scheme" content="dark"><style>
    html, body { background: #121022 !important; }
    body { font-family: "Segoe UI", "Microsoft JhengHei", sans-serif; padding: 16px 24px; line-height: 1.55; margin: 0; }
    body, body * { color: #e6e3f5 !important; background-color: transparent !important; border-color: rgba(255,255,255,.14) !important; }
    a, a * { color: #7aa2ff !important; }
    img { max-width: 100%; height: auto; }
    hr { border: 0; border-top: 1px solid rgba(255,255,255,.14); }
  </style>${html}`;
}

// 截止日：距今天幾天、緊急程度（逾期或 0–1 天 urgent、2–3 天 soon、一週內 week）
const daysLeft = (due) => Math.round((parseISO(due) - parseISO(todayISO())) / 86400000);
function deadlineLevel(due) {
  const n = daysLeft(due);
  return n <= 1 ? "urgent" : n <= 3 ? "soon" : n <= 7 ? "week" : "later";
}
// 倒數的短標示：Overdue / Today / 1d / 12d
function countdown(due) {
  const n = daysLeft(due);
  return n < 0 ? `${-n}d late` : n === 0 ? "Today" : `${n}d`;
}
const taskCourse = (t) => (t.projects || []).map((p) => p.replace(/^\[\[|\]\]$/g, "").split("|")[0])[0];

// 截止日的相對說明
function dueLabel(due) {
  if (!due) return "";
  const diff = Math.round((parseISO(due) - parseISO(todayISO())) / 86400000);
  if (diff < 0) return `${-diff} day${diff === -1 ? "" : "s"} overdue`;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return `in ${diff} days`;
  return fmtDay(due);
}

// 輸入框空白時給回饋（不然按鈕看起來像沒反應）
function needInput(input, msg) {
  toast(msg);
  input.focus();
  input.classList.remove("shake");
  void input.offsetWidth;  // 重新觸發動畫
  input.classList.add("shake");
}

// ---------- 小對話框（取代 prompt） ----------
function dialog(html, onSubmit) {
  const dlg = $("#dlg");
  dlg.innerHTML = `<form method="dialog" class="dlg-form">${html}
    <div class="dlg-btns"><button value="cancel" class="ghost" formnovalidate>Cancel</button><button value="ok" class="small-btn">OK</button></div></form>`;
  const form = $("form", dlg);
  form.addEventListener("submit", async (e) => {
    if (e.submitter?.value !== "ok") return;
    e.preventDefault();
    try { await onSubmit(new FormData(form)); dlg.close(); }
    catch (err) { toast(err.message); }
  });
  dlg.showModal();
  $("input, textarea, select", dlg)?.focus();
}

// ---------- 事件匯流排 ----------
const bus = new EventTarget();
const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

// ---------- 頁面切換 ----------
const Nova = { views: {}, current: null };

function showView(name) {
  if (!Nova.views[name]) name = "today";
  $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  $$(".sidenav a").forEach((a) => a.classList.toggle("active", a.dataset.view === name));
  const view = Nova.views[name];
  if (!view._inited) { view._inited = true; view.init?.(); }
  view.show?.();
  Nova.current = name;
  try { localStorage.setItem("nova.view", name); } catch {}
}

function go(name) {
  if (location.hash === `#${name}`) showView(name);
  else location.hash = name;
}

addEventListener("hashchange", () => showView(location.hash.slice(1)));
addEventListener("DOMContentLoaded", () => {
  let start = location.hash.slice(1);
  if (!start) { try { start = localStorage.getItem("nova.view") || "today"; } catch { start = "today"; } }
  showView(start);
});

// ---------- 問候 ----------
(function greet() {
  const h = new Date().getHours();
  const hi = h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("#greeting").textContent = `${hi} · ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", weekday: "long" })}`;
})();

// ---------- 快速記錄 ----------
$("#capture-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); capture(true); }
});
$("#capture").addEventListener("submit", (e) => { e.preventDefault(); capture(false); });

async function capture(asNote) {
  const input = $("#capture-text");
  const text = input.value.trim();
  if (!text) return needInput(input, "Type something in the box above first");
  const save = async (title) => {
    const r = await api("/api/vault/capture", { method: "POST", body: { text, title } });
    input.value = "";
    toast(`Saved to ${r.path}`);
    emit("vault-changed");
  };
  if (!asNote) return save(null).catch((e) => toast(e.message));
  dialog(`<h3>Save as new note</h3><label>Title<input name="title" required value="${esc(text.slice(0, 30))}"></label>`,
    (fd) => save(fd.get("title")));
}
