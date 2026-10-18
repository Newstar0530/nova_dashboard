// 郵件頁：Gmail（學校轉寄）清單 + 閱讀。
Nova.views.mail = (() => {
  const body = () => $("#mail-body");
  const reader = () => $("#mail-reader");
  let mailSchool = null;   // 目前篩選的學校標籤
  let mailReq = 0;         // 避免舊請求覆蓋新結果
  let onlySchool = true;   // 只看學校轉寄的信（記在瀏覽器）
  let activeId = null;
  try { onlySchool = localStorage.getItem("nova.onlySchool") !== "0"; } catch {}

  async function load() {
    const req = ++mailReq;
    try {
      const s = await api("/api/mail/status");
      $("#mail-tools").hidden = !s.configured;
      if (!s.configured) {
        body().innerHTML = `<div class="notice">尚未設定 Gmail。<br>請在 <code>workbench/.env</code> 填入 <code>GMAIL_ADDRESS</code> 與 <code>GMAIL_APP_PASSWORD</code>（步驟見 README）後重新啟動。</div>`;
        return;
      }
      $("#mail-schools").innerHTML =
        `<button class="chip${onlySchool ? " on" : ""}" id="only-school" title="只顯示從學校 Outlook 轉寄過來的信">🏫 只看學校轉寄</button>` +
        s.schools.map((x) => `<button class="chip${mailSchool === x.label ? " on" : ""}" data-school="${esc(x.label)}">${esc(x.label)}</button>
          <a class="chip" href="${esc(x.link)}" target="_blank" title="開啟${esc(x.label)} Outlook（確認有沒有漏轉寄的信）">${esc(x.label)} Outlook ↗</a>`).join("");
      if (!body().children.length) body().innerHTML = `<p class="muted small">${esc(s.account)}・載入中…</p>`;
      const params = new URLSearchParams({ top: 40 });
      const q = $("#mail-search").value.trim();
      if (q) params.set("q", q);
      if (mailSchool) params.set("school", mailSchool);
      else if (onlySchool) params.set("only_school", "true");
      const msgs = await api(`/api/mail/messages?${params}`);
      if (req !== mailReq) return;
      body().innerHTML = `<p class="muted small">${esc(s.account)}</p>` + (msgs.length ? msgs.map((m) => `
        <button class="item mail-item${m.is_read ? "" : " unread"}${m.id === activeId ? " active" : ""}" data-id="${esc(m.id)}">
          <div class="mail-meta"><span>${m.important ? "⭐ " : ""}${esc(m.from)}</span><span>${m.has_attachments ? "📎 " : ""}${fmtTime(m.received)}</span></div>
          <div class="title">${esc(m.subject)}</div>
          ${m.school ? `<div class="sub"><span class="tag">${esc(m.school)}</span></div>` : ""}
        </button>`).join("") : `<p class="muted small">${q || mailSchool || onlySchool ? "最近沒有符合的郵件" : "收件匣是空的 🎉"}</p>`);
    } catch (e) {
      if (req === mailReq) body().innerHTML = `<div class="notice">${esc(e.message)}</div>`;
    }
  }

  async function open(id) {
    activeId = id;
    $$(".mail-item", body()).forEach((i) => {
      i.classList.toggle("active", i.dataset.id === id);
      if (i.dataset.id === id) i.classList.remove("unread");
    });
    const r = reader();
    r.innerHTML = `<div class="empty"><p>載入郵件中…</p></div>`;
    try {
      const m = await api(`/api/mail/messages/${encodeURIComponent(id)}`);
      r.innerHTML = `
        <div class="reader-head">
          <div><h1>${esc(m.subject)}</h1>
            <div class="muted small">${m.school ? `<span class="tag">${esc(m.school)}</span> ` : ""}${esc(m.from)}・${m.received ? new Date(m.received).toLocaleString("zh-TW") : ""}</div>
            ${m.attachments?.length ? `<div class="muted small">📎 ${m.attachments.map(esc).join("、")}</div>` : ""}</div>
          <div class="btns">
            <button class="ghost" data-act="task">加入待辦</button>
            <button class="ghost" data-act="vault">存到知識庫</button>
            ${m.web_link ? `<a class="ghost" href="${esc(m.web_link)}" target="_blank">在 Gmail 開啟</a>` : ""}
          </div>
        </div>
        <iframe sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>`;
      const html = m.body_type === "text" ? `<pre style="white-space:pre-wrap;font-family:inherit">${esc(m.body_html)}</pre>` : m.body_html;
      $("iframe", r).srcdoc = `<base target="_blank"><style>body{font-family:"Segoe UI","Microsoft JhengHei",sans-serif;padding:16px 24px;color:#1f2328}img{max-width:100%}</style>${html}`;
      $("[data-act=vault]", r).onclick = async () => {
        try {
          const res = await api(`/api/mail/messages/${encodeURIComponent(m.id)}/to-vault`, { method: "POST" });
          toast(`已存到 ${res.path}`);
          emit("vault-changed");
        } catch (err) { toast(err.message); }
      };
      $("[data-act=task]", r).onclick = () => dialog(`<h3>從信件建立待辦</h3>
        <label>內容<input name="text" required value="${esc(m.subject)}"></label>
        <label>截止日<input name="due" type="date"></label>`,
        async (fd) => {
          await api("/api/tasks", { method: "POST", body: { text: fd.get("text"), due: fd.get("due") || null } });
          toast("已加入待辦");
          emit("tasks-changed");
        });
    } catch (err) { r.innerHTML = `<div class="empty"><p>${esc(err.message)}</p></div>`; }
  }

  return {
    open,
    init() {
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
        load();
      });
      let t;
      $("#mail-search").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 500); });
      body().addEventListener("click", (e) => {
        const item = e.target.closest(".mail-item");
        if (item) open(item.dataset.id);
      });
      $("#mail-refresh").addEventListener("click", load);
    },
    show() { load(); },
  };
})();
