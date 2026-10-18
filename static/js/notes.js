// 筆記頁：Obsidian 知識庫瀏覽 / 搜尋 / 閱讀，以及 Notion 課堂筆記同步。
Nova.views.notes = (() => {
  let vaultTab = "recent";
  let folderFilter = null;
  let activePath = null;
  let notionPoll = null;
  const list = () => $("#vault-list");

  async function openNote(path) {
    const reader = $("#note-reader");
    try {
      const n = await api(`/api/vault/note?path=${encodeURIComponent(path)}`);
      activePath = n.path;
      reader.innerHTML = `
        <div class="reader-head">
          <div><h1>${esc(n.name)}</h1><div class="muted small">${esc(n.path)}</div></div>
          <div class="btns">
            <a class="ghost" href="${esc(n.obsidian_uri)}">在 Obsidian 開啟</a>
            <button class="ghost danger" data-act="delete">刪除</button>
          </div>
        </div>
        <div class="reader-body">
          ${n.frontmatter ? `<div class="frontmatter">${esc(n.frontmatter.replace(/^---\n|---\n$/g, ""))}</div>` : ""}
          <div class="markdown">${n.html}</div>
        </div>`;
      $$(".wikilink[data-path]", reader).forEach((a) =>
        a.addEventListener("click", (e) => { e.preventDefault(); openNote(a.dataset.path); }));
      $$(".markdown a[href^='http']", reader).forEach((a) => (a.target = "_blank"));
      $("[data-act=delete]", reader).onclick = () => deleteNote(n);
      $$(".item", list()).forEach((i) => i.classList.toggle("active", i.dataset.path === n.path));
    } catch (e) { toast(e.message); }
  }

  function deleteNote(n) {
    const synced = n.frontmatter.includes("notion_id:");
    dialog(`<h3>刪除「${esc(n.name)}」？</h3>
      <p class="muted small">會移到 Obsidian 的垃圾桶（<code>.trash</code> 資料夾），之後可以在 Obsidian 還原。</p>
      ${synced ? `<p class="notice small">這是 Notion 同步的課堂筆記：只刪這裡的話，下次按「同步」會再被抓回來。要永久移除，請在 Notion 刪掉那一頁。</p>` : ""}`,
      async () => {
        await api(`/api/vault/note?path=${encodeURIComponent(n.path)}`, { method: "DELETE" });
        toast(`已移到垃圾桶：${n.name}`);
        activePath = null;
        $("#note-reader").innerHTML = `<div class="empty"><div class="big">✦</div><p>從左邊選一篇筆記</p></div>`;
        loadVault();
        emit("vault-changed");
      });
  }

  const noteItem = (n, sub = "") => `<button class="item${n.path === activePath ? " active" : ""}" data-path="${esc(n.path)}">
    <div class="title">${esc(n.name)}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</button>`;

  async function loadVault() {
    const q = $("#vault-search").value.trim();
    try {
      if (q) {
        const hits = await api(`/api/vault/search?q=${encodeURIComponent(q)}`);
        const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
        list().innerHTML = hits.length
          ? hits.map((h) => noteItem(h, esc(h.snippet).replace(re, (m) => `<mark>${m}</mark>`) || esc(h.path))).join("")
          : `<p class="muted small">沒有符合「${esc(q)}」的筆記</p>`;
      } else if (vaultTab === "recent") {
        const notes = await api("/api/vault/recent?limit=30");
        list().innerHTML = notes.length
          ? notes.map((n) => noteItem(n, `${esc(n.path.split("/").slice(0, -1).join(" / ") || "根目錄")}・${fmtTime(n.modified)}`)).join("")
          : `<p class="muted small">vault 還沒有筆記，試試上方的快速記錄。</p>`;
      } else {
        const groups = await api("/api/vault/tree");
        const shown = folderFilter ? groups.filter((g) => g.folder === folderFilter || g.folder.startsWith(folderFilter + "/")) : groups;
        list().innerHTML =
          (folderFilter ? `<button class="ghost" id="clear-filter">✕ ${esc(folderFilter)}</button>` : "") +
          shown.map((g) => `<div class="folder">${esc(g.folder || "根目錄")} <span class="small">(${g.notes.length})</span></div>
            <div class="folder-items">${g.notes.map((n) => noteItem(n)).join("")}</div>`).join("");
        $("#clear-filter")?.addEventListener("click", () => { folderFilter = null; loadVault(); });
      }
    } catch (e) { list().innerHTML = `<p class="muted small">${esc(e.message)}</p>`; }
  }

  function setTab(tab) {
    vaultTab = tab;
    $$("#panel-vault .tab").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  }

  async function loadNotion() {
    const box = $("#notion-body");
    try {
      const s = await api("/api/notion/status");
      $("#notion-sync").disabled = !s.configured || s.running;
      if (!s.configured) {
        box.innerHTML = `<div class="notice">尚未設定 Notion。<br>請在 <code>workbench/.env</code> 填入 <code>NOTION_TOKEN</code> 與 <code>NOTION_DATABASE_ID</code>（步驟見 README）。</div>`;
        return s;
      }
      box.innerHTML = `
        ${s.message || !s.total_pages ? `<div class="small">${s.running ? "⏳ " : ""}${esc(s.message || "尚未同步")}</div>` : ""}
        <div class="muted small">已同步 ${s.total_pages} 頁${s.last_run ? "・上次 " + new Date(s.last_run).toLocaleString("zh-TW") : ""}</div>
        ${s.errors?.length ? `<details class="small"><summary>${s.errors.length} 個錯誤</summary>${s.errors.map(esc).join("<br>")}</details>` : ""}
        <div class="courses">${s.courses.map((c) => `<button class="chip" data-folder="${esc(c.folder)}">${esc(c.name)} · ${c.count}</button>`).join("")}</div>
        <p class="muted small hint">Shift + 點「同步」會重新抓取全部頁面</p>`;
      return s;
    } catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  return {
    openNote,
    init() {
      list().addEventListener("click", (e) => {
        const item = e.target.closest(".item[data-path]");
        if (item) return openNote(item.dataset.path);
        const f = e.target.closest(".folder");
        if (f) f.classList.toggle("collapsed");
      });
      $$("#panel-vault .tab").forEach((t) => t.addEventListener("click", () => { setTab(t.dataset.tab); loadVault(); }));
      let st;
      $("#vault-search").addEventListener("input", () => { clearTimeout(st); st = setTimeout(loadVault, 250); });
      api("/api/vault/info").then((v) => ($("#vault-name").textContent = v.name)).catch(() => {});

      $("#notion-body").addEventListener("click", (e) => {
        const chip = e.target.closest(".chip");
        if (!chip) return;
        $("#vault-search").value = "";
        folderFilter = chip.dataset.folder;
        setTab("tree");
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
      on("vault-changed", () => Nova.current === "notes" && loadVault());
    },
    show() { loadVault(); loadNotion(); },
  };
})();
