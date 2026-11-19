// 每日資訊頁：Claude 排程任務寄到 Gmail 的報告（每個來源一張卡片 + 歷史期數），右邊閱讀。
Nova.views.daily = (() => {
  const list = () => $("#daily-list");
  const reader = () => $("#daily-reader");
  let feeds = [];
  let activeFeed = null;
  let activeId = null;
  let req = 0;

  const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();
  const when = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isToday(iso)) return `Today ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  // 側欄徽章：今天有新報告、而且還沒讀的來源數
  function updateBadge() {
    const n = feeds.filter((f) => f.issues[0] && isToday(f.issues[0].received) && !f.issues[0].is_read).length;
    const b = $("#daily-badge");
    b.hidden = !n;
    b.textContent = n;
  }

  function render() {
    list().innerHTML = feeds.map((f) => {
      const latest = f.issues[0];
      const open = f.key === activeFeed;
      return `<div class="daily-feed${open ? " open" : ""}">
        <button class="item daily-head${latest && !latest.is_read ? " unread" : ""}" data-feed="${esc(f.key)}">
          <div class="mail-meta"><span class="daily-name">${esc(f.name)}</span><span>${latest ? when(latest.received) : ""}</span></div>
          <div class="sub">${latest ? esc(latest.title || latest.subject) : "No reports yet"}</div>
        </button>
        ${open ? (f.issues.length
          ? f.issues.map((m) => `<button class="item mail-item daily-issue${m.is_read ? "" : " unread"}${m.id === activeId ? " active" : ""}" data-id="${esc(m.id)}">
              <div class="title">${esc(m.title || m.subject)}</div><div class="sub">${when(m.received)}</div></button>`).join("")
          : `<p class="muted small daily-empty">No email with a subject starting <code>${esc(f.prefix)}</code> in the last 60 days. Make sure this routine emails its report.</p>`)
          : ""}
      </div>`;
    }).join("");
  }

  async function load(refresh = false) {
    const r = ++req;
    try {
      const d = await api(`/api/daily${refresh ? "?refresh=true" : ""}`);
      if (r !== req) return;
      if (!d.configured) {
        list().innerHTML = `<div class="notice">Gmail is not set up yet — the daily reports are read from the emails your Claude routines send. Set <code>GMAIL_ADDRESS</code> and <code>GMAIL_APP_PASSWORD</code> in <code>.env</code>.</div>`;
        return;
      }
      feeds = d.feeds;
      // 預設打開「今天最新、還沒讀」的來源，否則第一個有報告的來源
      if (!activeFeed) {
        const pick = feeds.find((f) => f.issues[0] && isToday(f.issues[0].received) && !f.issues[0].is_read)
          || feeds.find((f) => f.issues.length);
        activeFeed = pick?.key ?? feeds[0]?.key ?? null;
        if (pick) open(pick.issues[0].id);
      }
      render();
      updateBadge();
    } catch (e) {
      if (r === req) list().innerHTML = `<div class="notice">${esc(e.message)}</div>`;
    }
  }

  async function open(id) {
    activeId = id;
    feeds.forEach((f) => f.issues.forEach((m) => { if (m.id === id) m.is_read = true; }));
    render();
    updateBadge();
    const r = reader();
    r.innerHTML = `<div class="empty"><p>Loading report…</p></div>`;
    try {
      const m = await api(`/api/daily/${encodeURIComponent(id)}`);
      if (activeId !== id) return;
      r.innerHTML = `
        <div class="reader-head">
          <div><h1>${esc(m.subject)}</h1>
            <div class="muted small">${m.received ? new Date(m.received).toLocaleString("en-US") : ""}</div></div>
          <div class="btns">
            <button class="ghost" data-act="vault">Save to vault</button>
            ${m.web_link ? `<a class="ghost" href="${esc(m.web_link)}" target="_blank">Open in Gmail</a>` : ""}
          </div>
        </div>
        <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`;
      const html = m.body_type === "text" ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.body_html)}</pre>` : m.body_html;
      $("iframe", r).srcdoc = `<base target="_blank"><style>body{font-family:"Segoe UI","Microsoft JhengHei",sans-serif;padding:16px 24px;color:#1f2328;line-height:1.55}img{max-width:100%}</style>${html}`;
      $("[data-act=vault]", r).onclick = async () => {
        try {
          const res = await api(`/api/mail/messages/${encodeURIComponent(m.id)}/to-vault`, { method: "POST" });
          toast(`Saved to ${res.path}`);
          emit("vault-changed");
        } catch (err) { toast(err.message); }
      };
    } catch (e) { r.innerHTML = `<div class="empty"><p>${esc(e.message)}</p></div>`; }
  }

  return {
    init() {
      list().addEventListener("click", (e) => {
        const issue = e.target.closest(".daily-issue");
        if (issue) return open(issue.dataset.id);
        const head = e.target.closest(".daily-head");
        if (!head) return;
        const f = feeds.find((x) => x.key === head.dataset.feed);
        activeFeed = activeFeed === f.key ? null : f.key;
        if (activeFeed && f.issues[0]) open(f.issues[0].id);
        else render();
      });
      $("#daily-refresh").addEventListener("click", () => { toast("Checking for new reports…"); load(true); });
      setInterval(() => load(), 10 * 60 * 1000); // 每 10 分鐘看有沒有新報告
    },
    show() { load(); },
    badge: () => load(), // 頁面載入時先算徽章
  };
})();

// 不必打開每日資訊頁，也能在側欄看到今天有幾份新報告
addEventListener("DOMContentLoaded", () => setTimeout(() => {
  if (Nova.current !== "daily") Nova.views.daily.badge();
}, 1500));
