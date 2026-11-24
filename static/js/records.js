// 紀錄頁：習慣熱度圖、心情折線、學習時數、日記回顧 / 編輯。
Nova.views.records = (() => {
  let stats = null, settings = null, vaultName = "";
  let diaryDate = todayISO();
  let saveTimer = null;

  async function load() {
    [stats, settings] = await Promise.all([api("/api/records/stats?days=84"), api("/api/records/settings")]);
    draw();
    loadDiary();
  }

  function draw() {
    if (!stats) return;
    // 習慣
    const box = $("#habit-heatmaps");
    box.innerHTML = stats.habits.length ? "" : `<p class="muted small">No habits yet. Click “Edit items” to add some.</p>`;
    stats.habits.forEach((h) => {
      const wrap = document.createElement("div");
      wrap.className = "habit-block";
      wrap.innerHTML = `<div class="habit-head"><b>${esc(h.name)}</b>
        <span class="muted small"><b class="streak">${h.streak}</b>-day streak · ${h.total} days in 12 weeks</span></div><div class="heat"></div>`;
      box.appendChild(wrap);
      Charts.heatmap($(".heat", wrap), stats.days, h.name);
    });
    // 心情：最近 30 天
    Charts.moodLine($("#mood-chart"), stats.days.slice(-30));
    // 學習：最近 14 天
    const last14 = stats.days.slice(-14);
    const total = last14.reduce((a, d) => a + d.study_total, 0);
    $("#study-total").textContent = total ? `${(total / 60).toFixed(1)} h total` : "";
    Charts.studyBars($("#study-chart"), last14, settings.subjects);
  }

  async function loadDiary() {
    $("#diary-date").value = diaryDate;
    const d = await api(`/api/records/day/${diaryDate}`);
    const recent = stats.days.filter((x) => x.has_diary).slice(-10).reverse();
    const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(d.path)}`;
    $("#diary-view").innerHTML = `
      <div class="diary-meta">
        <span>${d.mood ? `${MOODS[d.mood - 1]} ${d.mood}/5` : "<span class='muted'>No mood logged</span>"}</span>
        ${d.habits.map((h) => `<span class="tag">✓ ${esc(h)}</span>`).join("")}
        ${Object.entries(d.study).map(([s, m]) => `<span class="tag">${esc(s)} ${m} min</span>`).join("")}
        ${d.exists ? `<a class="ghost" href="${esc(uri)}">Open in Obsidian</a>` : ""}
      </div>
      <textarea class="diary" id="rec-diary-text" placeholder="Write your journal for ${fmtDay(diaryDate)}…">${esc(d.diary)}</textarea>
      <div class="muted small" id="rec-diary-status"></div>
      ${recent.length ? `<div class="sub-label">Recent entries</div><div class="courses">${recent.map((r) =>
        `<button class="chip${r.date === diaryDate ? " on" : ""}" data-date="${r.date}">${fmtDay(r.date)}</button>`).join("")}</div>` : ""}`;
  }

  function editSettings() {
    dialog(`<h3>Edit record items</h3>
      <label>Habits (one per line)<textarea name="habits" rows="5">${esc(settings.habits.join("\n"))}</textarea></label>
      <label>Study subjects (one per line; order sets chart colors)<textarea name="subjects" rows="5">${esc(settings.subjects.join("\n"))}</textarea></label>`,
      async (fd) => {
        const lines = (k) => String(fd.get(k)).split("\n").map((s) => s.trim()).filter(Boolean);
        settings = await api("/api/records/settings", { method: "PUT", body: { habits: lines("habits"), subjects: lines("subjects") } });
        toast("Updated");
        emit("settings-changed");
        load();
      });
  }

  return {
    init() {
      api("/api/vault/info").then((v) => (vaultName = v.name)).catch(() => {});
      $("#rec-settings-btn").addEventListener("click", editSettings);
      $("#diary-date").addEventListener("change", (e) => { diaryDate = e.target.value || todayISO(); loadDiary(); });
      $("#diary-view").addEventListener("click", (e) => {
        const chip = e.target.closest(".chip[data-date]");
        if (chip) { diaryDate = chip.dataset.date; loadDiary(); }
      });
      $("#diary-view").addEventListener("input", (e) => {
        if (e.target.id !== "rec-diary-text") return;
        $("#rec-diary-status").textContent = "Editing…";
        clearTimeout(saveTimer);
        const date = diaryDate, text = e.target.value;
        saveTimer = setTimeout(async () => {
          try {
            await api(`/api/records/day/${date}/diary`, { method: "PUT", body: { text } });
            $("#rec-diary-status").textContent = "Saved ✓";
          } catch (err) { $("#rec-diary-status").textContent = "Save failed: " + err.message; }
        }, 800);
      });
      on("records-changed", () => Nova.current === "records" && load());
      let rt;
      addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => Nova.current === "records" && draw(), 200); });
    },
    show() { load().catch((e) => toast(e.message)); },
  };
})();
