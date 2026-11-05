// 「今天」總覽：今日行程、待辦、心情/習慣打卡、專注計時、學校信件、今日日記。
Nova.views.today = (() => {
  let settings = { habits: [], subjects: [] };
  let day = null;

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

  // ---------- 心情 / 習慣 ----------
  function renderCheckin() {
    $("#mood-row").innerHTML = MOODS.map((m, i) =>
      `<button class="mood${day?.mood === i + 1 ? " on" : ""}" data-mood="${i + 1}" title="${i + 1} / 5">${m}</button>`).join("");
    $("#habit-row").innerHTML = settings.habits.length
      ? settings.habits.map((h) => `<button class="chip habit${day?.habits.includes(h) ? " on" : ""}" data-habit="${esc(h)}">${day?.habits.includes(h) ? "✓ " : ""}${esc(h)}</button>`).join("")
      : `<span class="muted small">Add habits on the Records page</span>`;
  }

  function initCheckin() {
    $("#mood-row").addEventListener("click", async (e) => {
      const b = e.target.closest(".mood");
      if (!b) return;
      const mood = Number(b.dataset.mood);
      try {
        day = await api("/api/records/day/today/mood", { method: "PUT", body: { mood: day?.mood === mood ? null : mood } });
        renderCheckin(); emit("records-changed");
      } catch (err) { toast(err.message); }
    });
    $("#habit-row").addEventListener("click", async (e) => {
      const b = e.target.closest(".habit");
      if (!b) return;
      try {
        day = await api("/api/records/day/today/habit", { method: "PUT", body: { habit: b.dataset.habit, done: !b.classList.contains("on") } });
        renderCheckin(); emit("records-changed");
      } catch (err) { toast(err.message); }
    });
  }

  // ---------- IELTS（30 雅思 資料夾，/ielts skill 的資料） ----------
  let ielts = null;

  async function loadIelts() {
    const card = $("#card-ielts");
    try {
      ielts = await api("/api/ielts");
    } catch { card.hidden = true; return; }
    card.hidden = !ielts.available;
    if (!ielts.available) return;
    const s = ielts;
    $("#ielts-phase").textContent = `${s.phase} · Target ${s.target_band}`;
    $("#ielts-countdown").textContent = s.days_to_exam == null ? "No exam date" : s.days_to_exam >= 0 ? `Exam in ${s.days_to_exam} days` : "Exam date passed";

    const notices = [];
    if (s.needs_diagnostic) notices.push(`Start with one full mock test, then run <code>/ielts mock</code>.`);
    else if (s.no_exam_date) notices.push(`No exam date yet — add <code>exam_date</code> in <code>學習計畫</code> when you book it.`);
    if (s.sprint_soon) notices.push(`The exam is less than two weeks away — switch the phase to <b>Final sprint</b>.`);

    const due = s.due_total
      ? `<b>${s.due_total}</b> due <span class="muted">(${[["words", "words"], ["patterns", "patterns"], ["grammar", "grammar"]].filter(([k]) => s.due[k]).map(([k, l]) => `${s.due[k]} ${l}`).join(" · ")})</span>`
      : s.next_due ? `None today <span class="muted">· ${s.next_due_count} due ${dueLabel(s.next_due).toLowerCase()}</span>` : `<span class="muted">No cards yet</span>`;
    const waiting = s.waiting.length
      ? s.waiting.map((w) => `<a href="#" class="ielts-note" data-path="${esc(w.path)}">${esc(w.title)}</a>`).join("<br>")
      : `<span class="muted">None</span>`;

    $("#ielts-body").innerHTML = `
      ${notices.map((n) => `<div class="notice small">${n}</div>`).join("")}
      <div class="ielts-grid">
        <span class="k">Today (${esc(s.weekday)})</span>
        <span class="v"><b>${esc(s.skill)}</b>
          ${s.focus_subject ? `<button class="link-btn" id="ielts-timer">Set timer →</button>` : ""}</span>
        <span class="k">Review</span><span class="v">${due}${s.due_total ? ` <code>/ielts review</code>` : ""}</span>
        <span class="k">Feedback</span><span class="v">${waiting}</span>
        <span class="k">Studied</span><span class="v">${s.minutes_today ? `${s.minutes_today} min today` : `<span class="muted">Nothing logged today</span>`}</span>
      </div>
      ${s.weekly_focus.length ? `<div class="sub-label">This week's focus</div><ul class="ielts-focus">${s.weekly_focus.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
      <div class="ielts-actions">
        <button class="ghost" id="ielts-copy" title="Paste into Claude Code (opened in the vault folder)">Copy <code>/ielts today</code></button>
        <a class="ghost" href="${esc(s.overview_uri)}">Overview in Obsidian ↗</a>
      </div>`;
  }

  function initIelts() {
    $("#ielts-body").addEventListener("click", async (e) => {
      if (e.target.closest("#ielts-timer")) {
        // 專注計時預選今天的科目（計時中就不動）
        if (getFocus()) return toast("A focus session is already running");
        const sel = $("#focus-subject");
        if (![...sel.options].some((o) => o.value === ielts.focus_subject)) sel.add(new Option(ielts.focus_subject));
        sel.value = ielts.focus_subject;
        $("#card-focus").scrollIntoView({ behavior: "smooth", block: "nearest" });
        $("#card-focus").classList.remove("flash"); void $("#card-focus").offsetWidth; $("#card-focus").classList.add("flash");
        toast(`Focus timer set to ${ielts.focus_subject} — press Start`);
      } else if (e.target.closest("#ielts-copy")) {
        try { await navigator.clipboard.writeText("/ielts today"); toast("Copied /ielts today"); }
        catch { toast("Couldn't copy — type /ielts today in Claude Code"); }
      } else if (e.target.closest(".ielts-note")) {
        e.preventDefault();
        go("notes");
        Nova.views.notes.openNote(e.target.closest(".ielts-note").dataset.path);
      }
    });
    on("records-changed", () => Nova.current === "today" && loadIelts());
  }

  // ---------- 專注計時（番茄鐘） ----------
  const FOCUS_KEY = "nova.focus";
  let focusLen = 25, tick = null;
  const getFocus = () => { try { return JSON.parse(localStorage.getItem(FOCUS_KEY)); } catch { return null; } };
  const setFocus = (v) => { try { v ? localStorage.setItem(FOCUS_KEY, JSON.stringify(v)) : localStorage.removeItem(FOCUS_KEY); } catch {} };

  function renderFocus() {
    const f = getFocus();
    const total = (f?.minutes || focusLen) * 60;
    const left = f ? Math.max(0, Math.round((f.end - Date.now()) / 1000)) : total;
    $("#focus-time").textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`;
    $("#focus-ring").style.setProperty("--p", `${f ? (1 - left / total) * 360 : 0}deg`);
    $("#focus-ring").classList.toggle("running", !!f);
    $("#focus-start").hidden = !!f;
    $("#focus-stop").hidden = !f;
    $("#focus-subject").disabled = !!f;
    $$("#focus-len button").forEach((b) => (b.disabled = !!f));
    document.title = f ? `⏳ ${$("#focus-time").textContent} · ${f.subject}` : "Nova Dashboard";
    if (f && left === 0) finishFocus(true);
  }

  async function finishFocus(completed) {
    const f = getFocus();
    if (!f) return;
    setFocus(null);
    clearInterval(tick);
    const minutes = completed ? f.minutes : Math.round((Date.now() - f.start) / 60000);
    renderFocus();
    if (minutes < 1) return toast("Under 1 minute, nothing logged");
    try {
      day = await api("/api/records/day/today/study", { method: "POST", body: { subject: f.subject, minutes, start: f.startLabel } });
      renderStudyToday(); emit("records-changed");
      const msg = completed ? `✦ Finished ${minutes} min of ${f.subject}. Take a break!` : `Logged ${minutes} min of ${f.subject}`;
      toast(msg);
      if (completed && "Notification" in window && Notification.permission === "granted") new Notification("Nova focus timer", { body: msg });
    } catch (err) { toast(err.message); }
  }

  function renderStudyToday() {
    const total = Object.values(day?.study || {}).reduce((a, b) => a + b, 0);
    $("#focus-today").textContent = total ? `Today: ${Math.floor(total / 60) ? `${Math.floor(total / 60)} h ` : ""}${total % 60} min` : "Not started today";
  }

  function initFocus() {
    $("#focus-len").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b || getFocus()) return;
      focusLen = Number(b.dataset.min);
      $$("#focus-len button").forEach((x) => x.classList.toggle("on", x === b));
      renderFocus();
    });
    $("#focus-start").addEventListener("click", () => {
      const now = new Date();
      setFocus({ subject: $("#focus-subject").value || "其他", minutes: focusLen, start: now.getTime(), end: now.getTime() + focusLen * 60000,
        startLabel: `${pad(now.getHours())}:${pad(now.getMinutes())}` });
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
      startTick();
    });
    $("#focus-stop").addEventListener("click", () => finishFocus(false));
    $("#focus-manual").addEventListener("click", () => {
      dialog(`<h3>Log study time</h3>
        <label>Subject<select name="subject">${settings.subjects.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
        <label>Minutes<input name="minutes" type="number" min="1" max="1440" value="30" required></label>
        <label>Date<input name="date" type="date" value="${todayISO()}" required></label>
        <label>Note<input name="note" placeholder="e.g. Exercise 3"></label>`,
        async (fd) => {
          await api(`/api/records/day/${fd.get("date")}/study`, { method: "POST", body: { subject: fd.get("subject"), minutes: Number(fd.get("minutes")), note: fd.get("note") } });
          if (fd.get("date") === todayISO()) { day = await api("/api/records/day/today"); renderStudyToday(); }
          emit("records-changed"); toast("Logged");
        });
    });
    if (getFocus()) { $("#focus-subject").value = getFocus().subject; startTick(); }
    else renderFocus();
  }

  function startTick() {
    clearInterval(tick);
    renderFocus();
    tick = setInterval(renderFocus, 1000);
  }

  // ---------- 學校信件（前 6 封） ----------
  async function loadMail() {
    const body = $("#today-mail");
    try {
      const s = await api("/api/mail/status");
      if (!s.configured) { body.innerHTML = `<div class="notice">Gmail is not set up yet (see the README).</div>`; return; }
      const msgs = await api("/api/mail/messages?top=40&only_school=true");
      const unread = msgs.filter((m) => !m.is_read).length;
      const badge = $("#mail-badge");
      badge.hidden = !unread; badge.textContent = unread;
      body.innerHTML = msgs.length ? msgs.slice(0, 6).map((m) => `
        <button class="item mail-item${m.is_read ? "" : " unread"}" data-id="${esc(m.id)}">
          <div class="mail-meta"><span>${esc(m.from)}</span><span>${fmtTime(m.received)}</span></div>
          <div class="title">${esc(m.subject)}</div>
        </button>`).join("") : `<p class="muted small">No recent school mail</p>`;
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  // ---------- 今日日記（自動儲存） ----------
  let diaryTimer = null;
  function initDiary() {
    $("#diary-text").addEventListener("input", () => {
      $("#diary-status").textContent = "Editing…";
      clearTimeout(diaryTimer);
      diaryTimer = setTimeout(async () => {
        try {
          day = await api("/api/records/day/today/diary", { method: "PUT", body: { text: $("#diary-text").value } });
          $("#diary-status").textContent = "Saved ✓";
          emit("records-changed");
        } catch (e) { $("#diary-status").textContent = "Save failed: " + e.message; }
      }, 800);
    });
  }

  async function loadDay() {
    [settings, day] = await Promise.all([api("/api/records/settings"), api("/api/records/day/today")]);
    $("#focus-subject").innerHTML = settings.subjects.map((s) => `<option>${esc(s)}</option>`).join("");
    if (getFocus()) $("#focus-subject").value = getFocus().subject;
    renderCheckin();
    renderStudyToday();
    if (document.activeElement !== $("#diary-text")) $("#diary-text").value = day.diary;
  }

  return {
    init() {
      initTasks(); initInbox(); initCheckin(); initIelts(); initFocus(); initDiary();
      $("#today-mail").addEventListener("click", (e) => {
        const item = e.target.closest(".mail-item");
        if (item) { go("mail"); Nova.views.mail.open(item.dataset.id); }
      });
      on("settings-changed", loadDay);
    },
    show() {
      loadSchedule(); loadTasks(); loadInbox(); loadMail(); loadIelts();
      loadDay().catch((e) => toast(e.message));
    },
  };
})();
