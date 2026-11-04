// 筆記頁：Obsidian 知識庫瀏覽 / 搜尋 / 閱讀，以及 Notion 課堂筆記同步。
Nova.views.notes = (() => {
  let vaultTab = "recent";
  let folderFilter = null;
  let activePath = null;
  let notionPoll = null;
  let editing = null; // 編輯中的筆記：{ path, original, mtime }
  const list = () => $("#vault-list");

  // 有未儲存的修改時先確認
  const dirty = () => editing && $("#note-editor") && $("#note-editor").value !== editing.original;
  const leaveOk = () => !dirty() || confirm("You have unsaved changes. Discard them?");

  async function openNote(path, { force = false } = {}) {
    if (!force && !leaveOk()) return;
    const reader = $("#note-reader");
    try {
      const n = await api(`/api/vault/note?path=${encodeURIComponent(path)}`);
      editing = null;
      activePath = n.path;
      reader.innerHTML = `
        <div class="reader-head">
          <div><h1>${esc(n.name)}</h1><div class="muted small">${esc(n.path)}${n.editable ? "" : " · synced from Notion, read-only"}</div></div>
          <div class="btns">
            ${n.editable ? `<button class="ghost" data-act="edit">Edit</button>` : ""}
            <a class="ghost" href="${esc(n.obsidian_uri)}">Open in Obsidian</a>
            <button class="ghost danger" data-act="delete">Delete</button>
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
      const edit = $("[data-act=edit]", reader);
      if (edit) edit.onclick = () => editNote(n);
      $$(".item", list()).forEach((i) => i.classList.toggle("active", i.dataset.path === n.path));
      return n;
    } catch (e) { toast(e.message); }
  }

  function editNote(n) {
    const reader = $("#note-reader");
    editing = { path: n.path, original: n.raw, mtime: n.mtime };
    reader.innerHTML = `
      <div class="reader-head">
        <div><h1>${esc(n.name)}</h1><div class="muted small">${esc(n.path)} · editing · ⌘/Ctrl+S to save</div></div>
        <div class="btns">
          <button class="ghost" data-act="cancel">Cancel</button>
          <button class="small-btn" data-act="save">Save</button>
        </div>
      </div>
      <textarea id="note-editor" class="note-editor" spellcheck="false"></textarea>`;
    const ta = $("#note-editor");
    ta.value = n.raw;
    ta.focus();
    ta.setSelectionRange(0, 0);
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
      if (e.key === "Tab" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
      }
    });
    $("[data-act=cancel]", reader).onclick = () => openNote(n.path);
    $("[data-act=save]", reader).onclick = () => save();
  }

  async function save(force = false) {
    if (!editing) return;
    const content = $("#note-editor").value;
    try {
      await api("/api/vault/note", { method: "PUT", body: { path: editing.path, content, mtime: editing.mtime, force } });
      toast("Saved");
      await openNote(editing.path, { force: true });
      loadVault();
      emit("vault-changed");
    } catch (e) {
      if (e.status !== 409) return toast(e.message);
      dialog(`<h3>This note changed elsewhere</h3>
        <p class="muted small">It was modified (probably in Obsidian) after you started editing. Saving will overwrite that version with yours.</p>`,
        () => save(true));
    }
  }

  // 新增筆記時記住每個範本上次存到哪個資料夾
  const FOLDERS_KEY = "nova.newNoteFolders";
  const loadRemembered = () => { try { return JSON.parse(localStorage.getItem(FOLDERS_KEY) || "{}"); } catch { return {}; } };

  async function newNote() {
    if (!leaveOk()) return;
    let folders, templates;
    try { [folders, templates] = await Promise.all([api("/api/vault/folders"), api("/api/vault/templates")]); }
    catch (e) { return toast(e.message); }
    const remembered = loadRemembered();
    const lastFolder = remembered[""] ?? (folders.includes("00 Inbox") ? "00 Inbox" : "");
    const opt = (v, label, sel) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(label)}</option>`;
    dialog(`<h3>New note</h3>
      <label>Template
        <select name="template">${opt("", "Blank note", "")}${templates.map((t) => opt(t.path, t.name, "")).join("")}</select></label>
      <label>Folder
        <select name="folder">${folders.map((f) => opt(f, f || "(vault root)", lastFolder)).join("")}</select></label>
      <label>Title <input name="title" required value="${todayISO()} "></label>`,
      async (fd) => {
        const template = fd.get("template"), folder = fd.get("folder");
        const n = await api("/api/vault/note", { method: "POST", body: { folder, title: fd.get("title"), template } });
        remembered[template] = folder;
        remembered[""] = folder;
        try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(remembered)); } catch {}
        toast(`Created: ${n.name}`);
        activePath = n.path;
        loadVault();
        emit("vault-changed");
        editNote(n);
      });
    // 選範本時，跳到上次用這個範本存的資料夾
    const form = $("#dlg form");
    form.template.addEventListener("change", () => {
      const f = remembered[form.template.value];
      if (f !== undefined && folders.includes(f)) form.folder.value = f;
    });
    form.title.focus();
    form.title.setSelectionRange(form.title.value.length, form.title.value.length);
  }

  function deleteNote(n) {
    const synced = n.frontmatter.includes("notion_id:");
    dialog(`<h3>Delete “${esc(n.name)}”?</h3>
      <p class="muted small">It will be moved to Obsidian's trash (the <code>.trash</code> folder) and can be restored in Obsidian later.</p>
      ${synced ? `<p class="notice small">This class note is synced from Notion. If you only delete it here, the next Sync will bring it back. To remove it for good, delete the page in Notion.</p>` : ""}`,
      async () => {
        await api(`/api/vault/note?path=${encodeURIComponent(n.path)}`, { method: "DELETE" });
        toast(`Moved to trash: ${n.name}`);
        activePath = null;
        $("#note-reader").innerHTML = `<div class="empty"><div class="big">✦</div><p>Pick a note on the left</p></div>`;
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
          : `<p class="muted small">No notes match “${esc(q)}”</p>`;
      } else if (vaultTab === "recent") {
        const notes = await api("/api/vault/recent?limit=30");
        list().innerHTML = notes.length
          ? notes.map((n) => noteItem(n, `${esc(n.path.split("/").slice(0, -1).join(" / ") || "Root")} · ${fmtTime(n.modified)}`)).join("")
          : `<p class="muted small">The vault has no notes yet. Try the quick capture at the top.</p>`;
      } else {
        const groups = await api("/api/vault/tree");
        const shown = folderFilter ? groups.filter((g) => g.folder === folderFilter || g.folder.startsWith(folderFilter + "/")) : groups;
        list().innerHTML =
          (folderFilter ? `<button class="ghost" id="clear-filter">✕ ${esc(folderFilter)}</button>` : "") +
          shown.map((g) => `<div class="folder">${esc(g.folder || "Root")} <span class="small">(${g.notes.length})</span></div>
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
        box.innerHTML = `<div class="notice">Notion is not set up yet.<br>Set <code>NOTION_TOKEN</code> and <code>NOTION_DATABASE_ID</code> in <code>workbench/.env</code> (see the README for steps).</div>`;
        return s;
      }
      box.innerHTML = `
        ${s.message || !s.total_pages ? `<div class="small">${s.running ? "⏳ " : ""}${esc(s.message || "Not synced yet")}</div>` : ""}
        <div class="muted small">${s.total_pages} pages synced${s.last_run ? " · last run " + new Date(s.last_run).toLocaleString("en-US") : ""}</div>
        ${s.errors?.length ? `<details class="small"><summary>${s.errors.length} error${s.errors.length === 1 ? "" : "s"}</summary>${s.errors.map(esc).join("<br>")}</details>` : ""}
        <div class="courses">${s.courses.map((c) => `<button class="chip" data-folder="${esc(c.folder)}">${esc(c.name)} · ${c.count}</button>`).join("")}</div>
        <p class="muted small hint">Shift-click Sync to refetch all pages</p>`;
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
      $("#vault-new").addEventListener("click", newNote);
      addEventListener("beforeunload", (e) => { if (dirty()) e.preventDefault(); });
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
          toast(e.shiftKey ? "Force-resyncing all pages…" : "Syncing Notion…");
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
