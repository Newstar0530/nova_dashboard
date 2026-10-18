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
        body.innerHTML = `<div class="notice">尚未訂閱行事曆。<br>在 <code>.env</code> 填入 <code>CALENDAR_ICS</code>（學校 Outlook 的 ICS 網址，步驟見 README）。</div>`;
        return;
      }
      const r = await api(`/api/calendar/events?start=${start}&end=${end}`);
      const groups = [[start, "今天"], [isoDate(addDays(new Date(), 1)), "明天"]].map(([d, label]) => {
        const evs = r.events.filter((e) => e.start.slice(0, 10) <= d && (e.all_day ? e.end > d : e.start.slice(0, 10) === d));
        return `<div class="sched-day">${label}</div>` + (evs.length ? evs.map(eventRow).join("") : `<p class="muted small">沒有行程</p>`);
      }).join("");
      body.innerHTML = groups + (r.errors.length ? `<p class="muted small">⚠ ${r.errors.map(esc).join("<br>")}</p>` : "");
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  const eventRow = (e) => {
    const now = new Date();
    const live = !e.all_day && new Date(e.start) <= now && now < new Date(e.end);
    return `<div class="event${live ? " live" : ""}">
      <span class="ev-time">${e.all_day ? "全天" : `${hhmm(e.start)}<br><span>${hhmm(e.end)}</span>`}</span>
      <span class="ev-main"><b>${esc(e.title)}</b>${e.location ? `<span class="muted small">📍 ${esc(e.location)}</span>` : ""}</span>
      <span class="tag">${esc(e.source)}</span></div>`;
  };

  // ---------- 待辦（TaskNotes 格式：一個待辦 = 一篇筆記） ----------
  let taskMeta = { statuses: [], priorities: [], installed: true };
  const prioOf = (v) => taskMeta.priorities.find((p) => p.value === v);
  const statusOf = (v) => taskMeta.statuses.find((s) => s.value === v);

  async function loadTasks() {
    const body = $("#tasks-body");
    try {
      const list = await api(`/api/tasks?include_done=${$("#tasks-show-done").checked}`);
      const today = todayISO();
      const when = (t) => t.due || t.scheduled;
      const groups = [
        ["逾期", list.filter((t) => !t.done && t.due && t.due < today)],
        ["今天", list.filter((t) => !t.done && !(t.due && t.due < today) && when(t) && when(t) <= today)],
        ["接下來", list.filter((t) => !t.done && when(t) > today)],
        ["沒有日期", list.filter((t) => !t.done && !when(t))],
        ["已完成", list.filter((t) => t.done)],
      ].filter(([, ts]) => ts.length);
      body.innerHTML = (taskMeta.installed ? "" : `<div class="notice">沒有偵測到 TaskNotes 外掛，使用預設設定（待辦存在 <code>TaskNotes/Tasks</code>）。</div>`) +
        (groups.length
          ? groups.map(([label, ts]) => `<div class="task-group${label === "逾期" ? " overdue" : ""}">${label} <span>${ts.length}</span></div>` + ts.map(taskRow).join("")).join("")
          : `<p class="muted small">沒有待辦，好好休息 ✦</p>`);
      emit("tasks-changed");
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  const taskRow = (t) => {
    const p = prioOf(t.priority), st = statusOf(t.status);
    const tags = t.tags.map((g) => `<span class="tag">#${esc(g)}</span>`).join(" ");
    let date = "";
    if (t.due) date = `<span class="due${!t.done && t.due < todayISO() ? " late" : ""}" title="截止日">${dueLabel(t.due)}${t.due_time ? " " + t.due_time : ""}</span>`;
    else if (t.recurring) date = `<span class="due" title="重複待辦（依 TaskNotes 的重複規則）">重複</span>`;
    else if (t.scheduled) {
      // 排程日只是「打算哪天做」，過了不算逾期，直接顯示日期
      const label = t.scheduled < todayISO() ? fmtDay(t.scheduled).split("（")[0] : dueLabel(t.scheduled);
      date = `<span class="due" title="排程日">⏱ ${label}</span>`;
    }
    return `<div class="task${t.done ? " done" : ""}" data-id="${esc(t.id)}">
      <button class="check" aria-label="${t.done ? "標為未完成" : "完成"}" style="${p && !t.done ? `border-color:${p.color}` : ""}">${t.done ? "✓" : ""}</button>
      <span class="task-text">${t.recurring ? '<span class="rec" title="重複待辦">↻</span> ' : ""}${esc(t.text)}
        ${st && !st.isCompleted && t.status !== taskMeta.statuses[0]?.value ? `<span class="tag status" style="--c:${st.color}">${esc(st.label)}</span>` : ""}
        ${tags}</span>
      ${date}
      <a class="open-obs" href="${esc(t.obsidian_uri)}" title="在 Obsidian 開啟（寫詳細內容）">↗</a>
      <button class="del" title="移到 Obsidian 垃圾桶">✕</button></div>`;
  };

  // 待辦 id 是 vault 內路徑：逐段編碼
  const taskUrl = (id) => `/api/tasks/${id.split("/").map(encodeURIComponent).join("/")}`;

  function initTasks() {
    api("/api/tasks/meta").then((m) => {
      taskMeta = m;
      $("#task-prio").innerHTML = m.priorities.map((p) => `<option value="${esc(p.value)}">${esc(p.label)}</option>`).join("");
      $("#task-prio").value = m.priorities.find((p) => p.value === "normal")?.value || m.priorities[0]?.value || "";
      loadTasks();
    }).catch(() => {});
    $("#task-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = $("#task-text").value.trim();
      if (!text) return needInput($("#task-text"), "先輸入待辦內容");
      try {
        await api("/api/tasks", { method: "POST", body: { text, due: $("#task-due").value || null, priority: $("#task-prio").value || null } });
        $("#task-text").value = ""; $("#task-due").value = "";
        toast(`已新增待辦：${text}`);
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
          if (row.classList.contains("done")) toast("完成 ✓");
        } else if (e.target.closest(".del")) {
          await api(taskUrl(row.dataset.id), { method: "DELETE" });
          toast("已移到 Obsidian 垃圾桶（.trash）");
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
    dialog(`<h3>編輯待辦</h3>
      <label>標題<input name="text" required value="${esc(t.text)}"></label>
      <div class="dlg-row">
        <label>狀態<select name="status"${t.recurring ? " disabled" : ""}>${opts(taskMeta.statuses, t.status)}</select></label>
        <label>優先度<select name="priority">${opts(taskMeta.priorities, t.priority)}</select></label>
      </div>
      <div class="dlg-row">
        <label>截止日<input name="due" type="date" value="${t.due || ""}"></label>
        <label>排程日<input name="scheduled" type="date" value="${t.scheduled || ""}"></label>
      </div>
      ${t.recurring ? `<p class="muted small">↻ 重複待辦：勾選只會完成今天這一次，重複規則請在 Obsidian 修改。</p>` : ""}
      <a class="link-btn" href="${esc(t.obsidian_uri)}">↗ 在 Obsidian 開啟，寫作業說明、連結等詳細內容</a>`,
      async (fd) => {
        const due = fd.get("due"), scheduled = fd.get("scheduled");
        const body = { priority: fd.get("priority"), due: due || null, clear_due: !due, scheduled: scheduled || null, clear_scheduled: !scheduled };
        if (fd.get("text") !== t.text) body.text = fd.get("text");
        if (!t.recurring && fd.get("status") !== t.status) body.status = fd.get("status");
        if (t.due_time && due === t.due) { delete body.due; delete body.clear_due; }  // 沒改日期就保留原本的時間
        await api(taskUrl(id), { method: "PATCH", body });
        loadTasks();
      });
  }

  // ---------- 心情 / 習慣 ----------
  function renderCheckin() {
    $("#mood-row").innerHTML = MOODS.map((m, i) =>
      `<button class="mood${day?.mood === i + 1 ? " on" : ""}" data-mood="${i + 1}" title="${i + 1} / 5">${m}</button>`).join("");
    $("#habit-row").innerHTML = settings.habits.length
      ? settings.habits.map((h) => `<button class="chip habit${day?.habits.includes(h) ? " on" : ""}" data-habit="${esc(h)}">${day?.habits.includes(h) ? "✓ " : ""}${esc(h)}</button>`).join("")
      : `<span class="muted small">到「紀錄」頁新增習慣項目</span>`;
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
    if (minutes < 1) return toast("不到 1 分鐘，沒有記錄");
    try {
      day = await api("/api/records/day/today/study", { method: "POST", body: { subject: f.subject, minutes, start: f.startLabel } });
      renderStudyToday(); emit("records-changed");
      const msg = completed ? `✦ 完成 ${minutes} 分鐘的 ${f.subject}，休息一下吧` : `已記錄 ${f.subject} ${minutes} 分鐘`;
      toast(msg);
      if (completed && "Notification" in window && Notification.permission === "granted") new Notification("Nova 專注計時", { body: msg });
    } catch (err) { toast(err.message); }
  }

  function renderStudyToday() {
    const total = Object.values(day?.study || {}).reduce((a, b) => a + b, 0);
    $("#focus-today").textContent = total ? `今天已讀 ${Math.floor(total / 60) ? `${Math.floor(total / 60)} 小時 ` : ""}${total % 60} 分` : "今天還沒開始";
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
      dialog(`<h3>補記學習時數</h3>
        <label>科目<select name="subject">${settings.subjects.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
        <label>分鐘<input name="minutes" type="number" min="1" max="1440" value="30" required></label>
        <label>日期<input name="date" type="date" value="${todayISO()}" required></label>
        <label>備註<input name="note" placeholder="例如：習題 3"></label>`,
        async (fd) => {
          await api(`/api/records/day/${fd.get("date")}/study`, { method: "POST", body: { subject: fd.get("subject"), minutes: Number(fd.get("minutes")), note: fd.get("note") } });
          if (fd.get("date") === todayISO()) { day = await api("/api/records/day/today"); renderStudyToday(); }
          emit("records-changed"); toast("已記錄");
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
      if (!s.configured) { body.innerHTML = `<div class="notice">尚未設定 Gmail（見 README）。</div>`; return; }
      const msgs = await api("/api/mail/messages?top=40&only_school=true");
      const unread = msgs.filter((m) => !m.is_read).length;
      const badge = $("#mail-badge");
      badge.hidden = !unread; badge.textContent = unread;
      body.innerHTML = msgs.length ? msgs.slice(0, 6).map((m) => `
        <button class="item mail-item${m.is_read ? "" : " unread"}" data-id="${esc(m.id)}">
          <div class="mail-meta"><span>${esc(m.from)}</span><span>${fmtTime(m.received)}</span></div>
          <div class="title">${esc(m.subject)}</div>
        </button>`).join("") : `<p class="muted small">最近沒有學校信件</p>`;
    } catch (e) { body.innerHTML = `<div class="notice">${esc(e.message)}</div>`; }
  }

  // ---------- 今日日記（自動儲存） ----------
  let diaryTimer = null;
  function initDiary() {
    $("#diary-text").addEventListener("input", () => {
      $("#diary-status").textContent = "編輯中…";
      clearTimeout(diaryTimer);
      diaryTimer = setTimeout(async () => {
        try {
          day = await api("/api/records/day/today/diary", { method: "PUT", body: { text: $("#diary-text").value } });
          $("#diary-status").textContent = "已儲存 ✓";
          emit("records-changed");
        } catch (e) { $("#diary-status").textContent = "儲存失敗：" + e.message; }
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
      initTasks(); initCheckin(); initFocus(); initDiary();
      $("#today-mail").addEventListener("click", (e) => {
        const item = e.target.closest(".mail-item");
        if (item) { go("mail"); Nova.views.mail.open(item.dataset.id); }
      });
      on("settings-changed", loadDay);
    },
    show() {
      loadSchedule(); loadTasks(); loadMail();
      loadDay().catch((e) => toast(e.message));
    },
  };
})();
