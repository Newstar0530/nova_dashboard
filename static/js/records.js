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
    box.innerHTML = stats.habits.length ? "" : `<p class="muted small">還沒有習慣項目，按「編輯項目」新增。</p>`;
    stats.habits.forEach((h) => {
      const wrap = document.createElement("div");
      wrap.className = "habit-block";
      wrap.innerHTML = `<div class="habit-head"><b>${esc(h.name)}</b>
        <span class="muted small">連續 <b class="streak">${h.streak}</b> 天 · 12 週共 ${h.total} 天</span></div><div class="heat"></div>`;
      box.appendChild(wrap);
      Charts.heatmap($(".heat", wrap), stats.days, h.name);
    });
    // 心情：最近 30 天
    Charts.moodLine($("#mood-chart"), stats.days.slice(-30));
    // 學習：最近 14 天
    const last14 = stats.days.slice(-14);
    const total = last14.reduce((a, d) => a + d.study_total, 0);
    $("#study-total").textContent = total ? `共 ${(total / 60).toFixed(1)} 小時` : "";
    Charts.studyBars($("#study-chart"), last14, settings.subjects);
  }

  async function loadDiary() {
    $("#diary-date").value = diaryDate;
    const d = await api(`/api/records/day/${diaryDate}`);
    const recent = stats.days.filter((x) => x.has_diary).slice(-10).reverse();
    const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(d.path)}`;
    $("#diary-view").innerHTML = `
      <div class="diary-meta">
        <span>${d.mood ? `${MOODS[d.mood - 1]} ${d.mood}/5` : "<span class='muted'>沒有心情紀錄</span>"}</span>
        ${d.habits.map((h) => `<span class="tag">✓ ${esc(h)}</span>`).join("")}
        ${Object.entries(d.study).map(([s, m]) => `<span class="tag">${esc(s)} ${m} 分</span>`).join("")}
        ${d.exists ? `<a class="ghost" href="${esc(uri)}">在 Obsidian 開啟</a>` : ""}
      </div>
      <textarea class="diary" id="rec-diary-text" placeholder="寫下 ${fmtDay(diaryDate)} 的日記…">${esc(d.diary)}</textarea>
      <div class="muted small" id="rec-diary-status"></div>
      ${recent.length ? `<div class="sub-label">最近的日記</div><div class="courses">${recent.map((r) =>
        `<button class="chip${r.date === diaryDate ? " on" : ""}" data-date="${r.date}">${fmtDay(r.date)}</button>`).join("")}</div>` : ""}`;
  }

  function editSettings() {
    dialog(`<h3>編輯紀錄項目</h3>
      <label>習慣（一行一個）<textarea name="habits" rows="5">${esc(settings.habits.join("\n"))}</textarea></label>
      <label>學習科目（一行一個，順序決定圖表顏色）<textarea name="subjects" rows="5">${esc(settings.subjects.join("\n"))}</textarea></label>`,
      async (fd) => {
        const lines = (k) => String(fd.get(k)).split("\n").map((s) => s.trim()).filter(Boolean);
        settings = await api("/api/records/settings", { method: "PUT", body: { habits: lines("habits"), subjects: lines("subjects") } });
        toast("已更新");
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
        $("#rec-diary-status").textContent = "編輯中…";
        clearTimeout(saveTimer);
        const date = diaryDate, text = e.target.value;
        saveTimer = setTimeout(async () => {
          try {
            await api(`/api/records/day/${date}/diary`, { method: "PUT", body: { text } });
            $("#rec-diary-status").textContent = "已儲存 ✓";
            if (date === todayISO()) $("#diary-text").value = text;
          } catch (err) { $("#rec-diary-status").textContent = "儲存失敗：" + err.message; }
        }, 800);
      });
      on("records-changed", () => Nova.current === "records" && load());
      let rt;
      addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => Nova.current === "records" && draw(), 200); });
    },
    show() { load().catch((e) => toast(e.message)); },
  };
})();
