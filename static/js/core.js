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
const WEEK = "日一二三四五六";
const fmtDay = (s) => { const d = parseISO(s); return `${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`; };
const hhmm = (iso) => iso.length > 10 ? iso.slice(11, 16) : "";

function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("zh-TW", { month: "numeric", day: "numeric" });
}

// 截止日的相對說明
function dueLabel(due) {
  if (!due) return "";
  const diff = Math.round((parseISO(due) - parseISO(todayISO())) / 86400000);
  if (diff < 0) return `逾期 ${-diff} 天`;
  if (diff === 0) return "今天";
  if (diff === 1) return "明天";
  if (diff < 7) return `${diff} 天後`;
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
    <div class="dlg-btns"><button value="cancel" class="ghost" formnovalidate>取消</button><button value="ok" class="small-btn">確定</button></div></form>`;
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
  const hi = h < 5 ? "夜深了" : h < 12 ? "早安" : h < 18 ? "午安" : "晚安";
  $("#greeting").textContent = `${hi}・${new Date().toLocaleDateString("zh-TW", { month: "long", day: "numeric", weekday: "long" })}`;
})();

// ---------- 快速記錄 ----------
$("#capture-text").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); capture(true); }
});
$("#capture").addEventListener("submit", (e) => { e.preventDefault(); capture(false); });

async function capture(asNote) {
  const input = $("#capture-text");
  const text = input.value.trim();
  if (!text) return needInput(input, "先在上方輸入框寫下想記錄的內容");
  const save = async (title) => {
    const r = await api("/api/vault/capture", { method: "POST", body: { text, title } });
    input.value = "";
    toast(`已記錄到 ${r.path}`);
    emit("vault-changed");
  };
  if (!asNote) return save(null).catch((e) => toast(e.message));
  dialog(`<h3>另存成新筆記</h3><label>標題<input name="title" required value="${esc(text.slice(0, 30))}"></label>`,
    (fd) => save(fd.get("title")));
}
