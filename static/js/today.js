// 「今天」總覽：今日行程、待辦、心情/習慣打卡、專注計時、學校信件、今日日記。
Nova.views.today = (() => {

  // ---------- 今日行程 ----------
  async function loadSchedule() {
    const body = $("#schedule-body");
    const start = todayISO(), end = isoDate(addDays(new Date(), 2));
    try {
      const st = await api("/api/calendar/status");
      if (!st.configured) {
        body.innerHTML = `<div class="notice">No calendar subscribed yet.<br>Set <code>CALENDAR_ICS</code> in <code>.env</code> (your school Outlook ICS URL; see the README for steps).</div>`;
        return;
      }
      const r = await api(`/api/calendar/events?start=${start}&end=${end}`);
      const groups = [[start, "Today"], [isoDate(addDays(new Date(), 1)), "Tomorrow"]].map(([d, label]) => {
        const evs = r.events.filter((e) => e.start.slice(0, 10) <= d && (e.all_day ? e.end > d : e.start.slice(0, 10) === d));
        return `<div class="sched-day">${label}</div>` + (evs.length ? evs.map(eventRow).join("") : `<p class="muted small">No events</p>`);
      }).join("");
      body.innerHTML = groups + (r.errors.length ? `<p class="muted small">⚠ ${r.errors.map(esc).join("<br>")}</p>` : "");
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  const eventRow = (e) => {
    const now = new Date();
    const live = !e.all_day && new Date(e.start) <= now && now < new Date(e.end);
    return `<div class="event${live ? " live" : ""}">
      <span class="ev-time">${e.all_day ? "All day" : `${hhmm(e.start)}<br><span>${hhmm(e.end)}</span>`}</span>
      <span class="ev-main"><b>${esc(e.title)}</b>${e.location ? `<span class="muted small">📍 ${esc(e.location)}</span>` : ""}</span>
      <span class="tag">${esc(e.source)}</span></div>`;
  };

  // ---------- 待辦（TaskNotes 格式：一個待辦 = 一篇筆記） ----------
  let taskMeta = { statuses: [], priorities: [], courses: [], installed: true };
  const courseOf = (t) => (t.projects || []).map((p) => p.replace(/^\[\[|\]\]$/g, "").split("|")[0])[0];
  const prioOf = (v) => taskMeta.priorities.find((p) => p.value === v);
  const statusOf = (v) => taskMeta.statuses.find((s) => s.value === v);

  async function loadTasks() {
    const body = $("#tasks-body");
    try {
      const list = await api(`/api/tasks?include_done=${$("#tasks-show-done").checked}`);
      const today = todayISO();
      const when = (t) => t.due || t.scheduled;
      const groups = [
        ["Overdue", list.filter((t) => !t.done && t.due && t.due < today)],
        ["Today", list.filter((t) => !t.done && !(t.due && t.due < today) && when(t) && when(t) <= today)],
        ["Upcoming", list.filter((t) => !t.done && when(t) > today)],
        ["No date", list.filter((t) => !t.done && !when(t))],
        ["Completed", list.filter((t) => t.done)],
      ].filter(([, ts]) => ts.length);
      body.innerHTML = (taskMeta.installed ? "" : `<div class="notice">TaskNotes plugin not detected; using default settings (tasks are stored in <code>TaskNotes/Tasks</code>).</div>`) +
        (groups.length
          ? groups.map(([label, ts]) => `<div class="task-group${label === "Overdue" ? " overdue" : ""}">${label} <span>${ts.length}</span></div>` + ts.map(taskRow).join("")).join("")
          : `<p class="muted small">No tasks. Enjoy the break ✦</p>`);
      emit("tasks-changed");
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  const taskRow = (t) => {
    const p = prioOf(t.priority), st = statusOf(t.status);
    const tags = t.tags.map((g) => `<span class="tag">#${esc(g)}</span>`).join(" ");
    let date = "";
    if (t.due) date = `<span class="due${!t.done && t.due < todayISO() ? " late" : ""}" title="Due date">${dueLabel(t.due)}${t.due_time ? " " + t.due_time : ""}</span>`;
    else if (t.recurring) date = `<span class="due" title="Recurring task (follows the TaskNotes recurrence rule)">Recurring</span>`;
    else if (t.scheduled) {
      // 排程日只是「打算哪天做」，過了不算逾期，直接顯示日期
      const label = t.scheduled < todayISO() ? fmtMD(t.scheduled) : dueLabel(t.scheduled);
      date = `<span class="due" title="Scheduled date">⏱ ${label}</span>`;
    }
    return `<div class="task${t.done ? " done" : ""}" data-id="${esc(t.id)}">
      <button class="check" aria-label="${t.done ? "Mark as not done" : "Mark as done"}" style="${p && !t.done ? `border-color:${p.color}` : ""}">${t.done ? "✓" : ""}</button>
      <span class="task-text">${t.recurring ? '<span class="rec" title="Recurring task">↻</span> ' : ""}${esc(t.text)}
        ${st && !st.isCompleted && t.status !== taskMeta.statuses[0]?.value ? `<span class="tag status" style="--c:${st.color}">${esc(st.label)}</span>` : ""}
        ${courseOf(t) ? `<span class="tag course-tag">${esc(courseOf(t))}</span>` : ""}
        ${tags}</span>
      ${date}
      <a class="open-obs" href="${esc(t.obsidian_uri)}" title="Open in Obsidian (add details)">↗</a>
      <button class="del" title="Move to Obsidian trash">✕</button></div>`;
  };

  // 待辦 id 是 vault 內路徑：逐段編碼
  const taskUrl = (id) => `/api/tasks/${id.split("/").map(encodeURIComponent).join("/")}`;

  function initTasks() {
    api("/api/tasks/meta").then((m) => {
      taskMeta = m;
      $("#task-prio").innerHTML = m.priorities.map((p) => `<option value="${esc(p.value)}">${esc(p.label)}</option>`).join("");
      $("#task-prio").value = m.priorities.find((p) => p.value === "normal")?.value || m.priorities[0]?.value || "";
      $("#task-course").innerHTML = `<option value="">No course</option>` + m.courses.map((c) => `<option>${esc(c)}</option>`).join("");
      $("#task-course").hidden = !m.courses.length;
      loadTasks();
    }).catch(() => {});
    $("#task-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#task-text").value.trim();
      if (!text) return needInput($("#task-text"), "Enter a task first");
      try {
        await api("/api/tasks", { method: "POST", body: { text, due: $("#task-due").value || null, priority: $("#task-prio").value || null, project: $("#task-course").value || null } });
        $("#task-text").value = ""; $("#task-due").value = "";
        toast(`Task added: ${text}`);
        loadTasks();
      } catch (err) { toast(err.message); }
    });
    $("#tasks-show-done").addEventListener("change", loadTasks);
    $("#tasks-body").addEventListener("click", async (e) => {
      const row = e.target.closest(".task");
      if (!row || e.target.closest(".open-obs")) return;
      try {
        if (e.target.closest(".check")) {
          row.classList.toggle("done");
          await api(taskUrl(row.dataset.id), { method: "PATCH", body: { done: row.classList.contains("done") } });
          if (row.classList.contains("done")) toast("Done ✓");
        } else if (e.target.closest(".del")) {
          await api(taskUrl(row.dataset.id), { method: "DELETE" });
          toast("Moved to Obsidian trash (.trash)");
        } else if (e.target.closest(".task-text")) {
          return editTask(row.dataset.id);
        } else return;
        loadTasks();
      } catch (err) { toast(err.message); loadTasks(); }
    });
  }

  async function editTask(id) {
    const t = (await api("/api/tasks?include_done=true")).find((x) => x.id === id);
    if (!t) return loadTasks();
    const opts = (xs, cur) => xs.map((x) => `<option value="${esc(x.value)}"${x.value === cur ? " selected" : ""}>${esc(x.label)}</option>`).join("");
    dialog(`<h3>Edit task</h3>
      <label>Title<input name="text" required value="${esc(t.text)}"></label>
      <div class="dlg-row">
        <label>Status<select name="status"${t.recurring ? " disabled" : ""}>${opts(taskMeta.statuses, t.status)}</select></label>
        <label>Priority<select name="priority">${opts(taskMeta.priorities, t.priority)}</select></label>
      </div>
      ${taskMeta.courses.length ? `<label>Course (links to the course home page)<select name="course"><option value="">No course</option>${taskMeta.courses.map((c) => `<option${c === courseOf(t) ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></label>` : ""}
      <div class="dlg-row">
        <label>Due date<input name="due" type="date" value="${t.due || ""}"></label>
        <label>Scheduled<input name="scheduled" type="date" value="${t.scheduled || ""}"></label>
      </div>
      ${t.recurring ? `<p class="muted small">↻ Recurring task: checking it off only completes today's instance. Edit the recurrence rule in Obsidian.</p>` : ""}
      <a class="link-btn" href="${esc(t.obsidian_uri)}">↗ Open in Obsidian to add details like assignment notes and links</a>`,
      async (fd) => {
        const due = fd.get("due"), scheduled = fd.get("scheduled");
        const body = { priority: fd.get("priority"), due: due || null, clear_due: !due, scheduled: scheduled || null, clear_scheduled: !scheduled };
        if (fd.get("text") !== t.text) body.text = fd.get("text");
        if (fd.has("course") && fd.get("course") !== (courseOf(t) || "")) {
          if (fd.get("course")) body.project = fd.get("course"); else body.clear_project = true;
        }
        if (!t.recurring && fd.get("status") !== t.status) body.status = fd.get("status");
        if (t.due_time && due === t.due) { delete body.due; delete body.clear_due; }  // 沒改日期就保留原本的時間
        await api(taskUrl(id), { method: "PATCH", body });
        loadTasks();
      });
  }

  // ---------- Inbox（快速記錄 → 轉成待辦 / 刪除） ----------
  let captures = [];

  async function loadInbox() {
    const body = $("#inbox-body");
    try {
      captures = await api("/api/inbox?days=7");
      $("#inbox-count").textContent = captures.length ? `${captures.length} to process` : "";
      if (!captures.length) {
        body.innerHTML = `<p class="muted small">All quick captures from the last 7 days are processed ✦<br>Jot down ideas in the box at the top and they will show up here.</p>`;
        return;
      }
      const today = todayISO(), yday = isoDate(addDays(new Date(), -1));
      let html = "", last = "";
      for (const c of captures) {
        if (c.date !== last) {
          last = c.date;
          html += `<div class="cap-day">${c.date === today ? "Today" : c.date === yday ? "Yesterday" : fmtDay(c.date)}</div>`;
        }
        html += `<div class="capture-item" data-id="${esc(c.id)}">
          <span class="cap-time">${esc(c.time)}</span>
          <span class="cap-text">${esc(c.text)}</span>
          <span class="cap-btns">
            <button class="to-task" title="Convert to a TaskNotes task">→ Task</button>
            <button class="cap-del" title="Delete this capture">✕</button>
          </span></div>`;
      }
      body.innerHTML = html;
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  function initInbox() {
    $("#inbox-body").addEventListener("click", (e) => {
      const row = e.target.closest(".capture-item");
      if (!row) return;
      const c = captures.find((x) => x.id === row.dataset.id);
      if (!c) return;
      if (e.target.closest(".to-task")) {
        const opts = taskMeta.priorities.map((p) => `<option value="${esc(p.value)}"${p.value === "normal" ? " selected" : ""}>${esc(p.label)}</option>`).join("");
        dialog(`<h3>Convert to task</h3>
          <label>Title (#tags allowed)<input name="text" required value="${esc(c.text)}"></label>
          <div class="dlg-row">
            <label>Due date<input name="due" type="date"></label>
            <label>Priority<select name="priority">${opts}</select></label>
          </div>
          <p class="muted small">The original capture is kept and marked as converted, with a link to the new task.</p>`,
          async (fd) => {
            await api("/api/inbox/convert", { method: "POST", body: { id: c.id, text: fd.get("text"), due: fd.get("due") || null, priority: fd.get("priority") } });
            toast("Converted to task ✓");
            loadInbox(); loadTasks();
          });
      } else if (e.target.closest(".cap-del")) {
        dialog(`<h3>Delete this capture?</h3><p class="muted">“${esc(c.text)}”</p><p class="muted small">This line will be removed from ${esc(c.path)}.</p>`,
          async () => {
            await api("/api/inbox/delete", { method: "POST", body: { id: c.id } });
            toast("Deleted");
            loadInbox();
          });
      }
    });
    on("vault-changed", () => Nova.current === "today" && loadInbox());
  }

  // ---------- 截止倒數：未完成、有截止日的待辦（逾期的也算） ----------
  const DL_DAYS = 14;
  async function loadDeadlines() {
    let list, ielts = null;
    try { [list, ielts] = await Promise.all([api("/api/tasks"), api("/api/ielts").catch(() => null)]); }
    catch (e) { $("#dl-list").innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
    if (ielts?.available && ielts.exam_date) {
      list = [...list, { text: "IELTS exam", due: ielts.exam_date, done: false, projects: [], exam: true }];
    }
    const open = list.filter((t) => !t.done && t.due && daysLeft(t.due) < DL_DAYS)
      .sort((a, b) => a.due.localeCompare(b.due) || a.text.localeCompare(b.text));
    const later = list.filter((t) => !t.done && t.due && daysLeft(t.due) >= DL_DAYS).length;
    const week = open.filter((t) => daysLeft(t.due) <= 7).length;
    $("#deadline-summary").textContent = open.length ? `${week} this week` : "";

    // 14 天的小日曆條：每天一格，點點 = 當天截止的數量
    const start = new Date();
    $("#dl-strip").innerHTML = Array.from({ length: DL_DAYS }, (_, i) => {
      const d = addDays(start, i), iso = isoDate(d);
      const due = open.filter((t) => t.due === iso);
      const lvl = due.length ? deadlineLevel(iso) : "";
      return `<div class="dl-day${i === 0 ? " today" : ""}${d.getDay() === 1 && i ? " mon" : ""}${lvl ? ` has ${lvl}` : ""}"
        title="${fmtDay(iso)}${due.length ? ` · ${due.map((t) => t.text).join(", ")}` : ""}">
        <span class="dl-wd">${WEEK[d.getDay()].slice(0, 2)}</span><span class="dl-n">${d.getDate()}</span>
        <span class="dl-dots">${"●".repeat(Math.min(due.length, 3))}</span></div>`;
    }).join("");

    $("#dl-list").innerHTML = (open.length ? open.map((t) => `
      <div class="dl-item ${deadlineLevel(t.due)}">
        <span class="dl-count">${countdown(t.due)}</span>
        <span class="dl-main"><span class="dl-title">${esc(t.text)}</span>
          <span class="dl-meta">${fmtDay(t.due)}${taskCourse(t) ? ` · ${esc(taskCourse(t))}` : ""}</span></span>
      </div>`).join("") + (later ? `<p class="muted small dl-later">+${later} later — see Calendar</p>` : "")
      : `<p class="muted small">Nothing due in the next ${DL_DAYS} days 🎉</p>${later ? `<p class="muted small">${later} later — see Calendar</p>` : ""}`);
  }

  // IELTS 的一行提醒：今天練哪一項、幾張卡片要複習、考試倒數
  function ieltsReminder(s) {
    if (!s?.available) return "";
    const parts = [`<b>${esc(s.skill)}</b> today`];
    if (s.due_total) parts.push(`${s.due_total} card${s.due_total === 1 ? "" : "s"} to review`);
    if (s.days_to_exam != null && s.days_to_exam >= 0) parts.push(`exam in ${s.days_to_exam} days`);
    const hint = s.needs_diagnostic ? "Take a full mock test first"
      : s.no_exam_date ? "No exam date yet" : s.sprint_soon ? "Switch to Final sprint" : "";
    return `<button class="dl-ielts" title="Click to copy /ielts today for Claude Code">
      <span class="dl-ielts-tag">IELTS</span>
      <span class="dl-main"><span class="dl-title">${parts.join(" · ")}</span>
        <span class="dl-meta">${hint ? `${esc(hint)} · ` : ""}copy <code>/ielts today</code></span></span></button>`;
  }

  // ---------- 世界時鐘：台灣、法國 ----------
  const CLOCKS = [
    { label: "Taiwan", city: "Taipei", tz: "Asia/Taipei", flag: "🇹🇼" },
    { label: "France", city: "Paris", tz: "Europe/Paris", flag: "🇫🇷" },
  ];
  let glance = { weather: [], fx: null };  // 天氣依順序對應上面兩個時鐘（WEATHER_PLACES）
  const WMO = [  // Open-Meteo 天氣代碼
    [[0], "☀️", "🌙", "Clear"], [[1], "🌤️", "🌙", "Mostly clear"], [[2], "⛅", "☁️", "Partly cloudy"], [[3], "☁️", "☁️", "Overcast"],
    [[45, 48], "🌫️", "🌫️", "Fog"], [[51, 53, 55, 56, 57], "🌦️", "🌧️", "Drizzle"], [[61, 63, 65, 66, 67, 80, 81, 82], "🌧️", "🌧️", "Rain"],
    [[71, 73, 75, 77, 85, 86], "🌨️", "🌨️", "Snow"], [[95, 96, 99], "⛈️", "⛈️", "Thunderstorm"],
  ];
  const weatherLine = (w) => {
    if (!w) return "";
    const [, day, night, label] = WMO.find(([codes]) => codes.includes(w.code)) || [[], "🌡️", "🌡️", ""];
    return `<div class="clock-weather" title="${esc(w.name)} · ${label}">${w.is_day ? day : night} ${Math.round(w.temp)}°
      <span class="muted">${esc(w.name)} · ${Math.round(w.min)}°–${Math.round(w.max)}°</span></div>`;
  };
  async function loadGlance() {
    try { glance = await api("/api/glance"); } catch { return; }
    renderFx();
    renderClocks();
  }

  // 歐元 ⇄ 台幣換算（方向與金額記在瀏覽器）
  const FX_KEY = "nova.fx";
  let fxState = { toTwd: true, amount: "100" };
  try { fxState = { ...fxState, ...JSON.parse(localStorage.getItem(FX_KEY) || "{}") }; } catch {}
  const saveFx = () => { try { localStorage.setItem(FX_KEY, JSON.stringify(fxState)); } catch {} };
  function renderFx() {
    const fx = glance.fx;
    $("#fx").hidden = !fx;
    if (!fx) return;
    $("#fx-from").textContent = fxState.toTwd ? "€" : "NT$";
    $("#fx-to").textContent = fxState.toTwd ? "NT$" : "€";
    const input = $("#fx-amount");
    if (document.activeElement !== input) input.value = fxState.amount;
    const n = parseFloat(input.value);
    const out = fxState.toTwd ? n * fx.rate : n / fx.rate;
    $("#fx-result").textContent = Number.isFinite(out) && input.value !== ""
      ? out.toLocaleString("en-US", { maximumFractionDigits: fxState.toTwd ? 0 : 2, minimumFractionDigits: fxState.toTwd ? 0 : 2 })
      : "–";
    const when = new Date(fx.updated * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    $("#fx-rate").textContent = fxState.toTwd
      ? `1 € = ${fx.rate.toFixed(2)} NT$ · rate of ${when}`
      : `1 NT$ = ${(1 / fx.rate).toFixed(4)} € · rate of ${when}`;
  }
  function initFx() {
    $("#fx-amount").addEventListener("input", (e) => { fxState.amount = e.target.value; saveFx(); renderFx(); });
    $("#fx-amount").addEventListener("focus", (e) => e.target.select());
    $("#fx-swap").addEventListener("click", () => {
      // 交換方向時，把剛才的結果當成新的金額，比較直覺
      const r = $("#fx-result").textContent.replace(/,/g, "");
      fxState.toTwd = !fxState.toTwd;
      if (r !== "–") fxState.amount = r;
      saveFx(); renderFx();
    });
  }
  const tzOffset = (tz, d) => {  // 該時區相對 UTC 的分鐘數（含夏令時間）
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(d).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 60000) * 60000) / 60000);
  };
  function renderClocks() {
    const now = new Date();
    const diff = (tzOffset(CLOCKS[0].tz, now) - tzOffset(CLOCKS[1].tz, now)) / 60;
    $("#clocks").innerHTML = CLOCKS.map((c, i) => {
      const time = now.toLocaleTimeString("en-GB", { timeZone: c.tz, hour: "2-digit", minute: "2-digit" });
      const sec = now.toLocaleTimeString("en-GB", { timeZone: c.tz, second: "2-digit" }).padStart(2, "0");
      const date = now.toLocaleDateString("en-US", { timeZone: c.tz, weekday: "short", month: "short", day: "numeric" });
      const note = i === 0 ? `${diff >= 0 ? "+" : ""}${diff}h vs France` : `UTC${tzOffset(c.tz, now) >= 0 ? "+" : ""}${tzOffset(c.tz, now) / 60}`;
      return `<div class="clock">
        <div class="clock-place"><span>${c.flag}</span> ${c.label} <span class="muted">· ${c.city}</span></div>
        <div class="clock-time">${time}<span class="clock-sec">${sec}</span></div>
        <div class="clock-meta">${date} <span class="muted">· ${note}</span></div>
        ${weatherLine(glance.weather[i])}
      </div>`;
    }).join("");
  }
  function initClocks() {
    try { localStorage.removeItem("nova.focus"); } catch {}  // 舊的番茄鐘狀態
    renderClocks();
    setInterval(renderClocks, 1000);
    loadGlance();
    setInterval(loadGlance, 15 * 60 * 1000);
  }

  // ---------- 需要注意：今天收件匣整理報告裡的 🔴 ----------
  async function loadAttention() {
    const box = $("#attention-body");
    let t, ielts;
    try { [t, ielts] = await Promise.all([api("/api/daily/triage"), api("/api/ielts").catch(() => null)]); }
    catch (e) { box.innerHTML = `<div class="notice">${esc(e.message)}</div>`; return; }
    const reminder = ieltsReminder(ielts);
    if (!t.report) {
      const weekend = [0, 6].includes(new Date().getDay());
      box.innerHTML = reminder + `<p class="muted small">${weekend ? "No inbox triage on weekends." : "Today's inbox triage hasn't arrived yet — it runs on weekdays at 7:45."}</p>`;
      return;
    }
    box.innerHTML = reminder + (t.red.length ? t.red.map((m) => `
      <div class="att-item">
        <div class="att-head">${m.kind ? `<span class="tag">${esc(m.kind)}</span>` : ""}
          ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noreferrer">${esc(m.sender)}</a>` : `<b>${esc(m.sender)}</b>`}</div>
        <div class="att-text">${esc(m.summary)}</div>
      </div>`).join("") : `<p class="muted small">🎉 Nothing needs handling today.</p>`) +
      `<button class="link-btn att-more" data-id="${esc(t.report.id)}">${t.yellow ? `🟡 ${t.yellow} more this week · ` : ""}Open today's report →</button>`;
  }

  // ---------- 側欄 Mail 的未讀數（學校信件） ----------
  async function loadMailBadge() {
    try {
      const s = await api("/api/mail/status");
      if (!s.configured) return;
      const msgs = await api("/api/mail/messages?top=40&only_school=true");
      const unread = msgs.filter((m) => !m.is_read).length;
      const badge = $("#mail-badge");
      badge.hidden = !unread; badge.textContent = unread;
    } catch {}
  }

  return {
    init() {
      initTasks(); initInbox(); initClocks();
      initFx();
      $("#attention-body").addEventListener("click", async (e) => {
        if (e.target.closest(".att-more")) return go("daily");
        if (!e.target.closest(".dl-ielts")) return;
        try { await navigator.clipboard.writeText("/ielts today"); toast("Copied /ielts today — paste it into Claude Code"); }
        catch { toast("Couldn't copy — type /ielts today in Claude Code"); }
      });
      on("tasks-changed", () => Nova.current === "today" && loadDeadlines());
      $("#dl-list").addEventListener("click", () => go("calendar"));
    },
    show() {
      loadSchedule(); loadTasks(); loadInbox(); loadMailBadge(); loadDeadlines(); loadAttention();
    },
  };
})();
