// 行事曆：月檢視（ICS 訂閱的行程 + 有截止日的待辦），右側顯示選取日的明細。
Nova.views.calendar = (() => {
  let cursor = new Date(); cursor.setDate(1);
  let selected = todayISO();
  let data = { events: [], tasks: [], errors: [] };

  const gridStart = () => { const d = new Date(cursor); d.setDate(1 - ((d.getDay() + 6) % 7)); return d; }; // 週一開始

  // 某天的行程（跨日的全天行程每天都顯示）
  const eventsOn = (iso) => data.events.filter((e) =>
    e.all_day ? e.start <= iso && iso < e.end : e.start.slice(0, 10) === iso);
  const tasksOn = (iso) => data.tasks.filter((t) => t.due === iso);

  async function load(refresh = false) {
    const start = gridStart(), end = addDays(start, 42);
    $("#cal-title").textContent = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
    try {
      const st = await api("/api/calendar/status");
      $("#cal-notice").innerHTML = st.configured ? "" : `<div class="notice">尚未訂閱行事曆，目前只顯示待辦的截止日。<br>
        學校 Outlook：網頁版 → 設定 → 行事曆 → 共用行事曆 →「發佈行事曆」→ 複製 <b>ICS</b> 連結，
        填到 <code>.env</code> 的 <code>CALENDAR_ICS=NEOMA=連結</code> 後重新啟動。</div>`;
      data = await api(`/api/calendar/events?start=${isoDate(start)}&end=${isoDate(end)}${refresh ? "&refresh=true" : ""}`);
      if (data.errors.length) $("#cal-notice").innerHTML += `<div class="notice">⚠ ${data.errors.map(esc).join("<br>")}</div>`;
    } catch (e) {
      data = { events: [], tasks: [], errors: [] };
      $("#cal-notice").innerHTML = `<div class="notice">${esc(e.message)}</div>`;
    }
    renderGrid();
    renderDay();
  }

  function renderGrid() {
    const start = gridStart(), today = todayISO(), month = cursor.getMonth();
    let html = ["一", "二", "三", "四", "五", "六", "日"].map((w) => `<div class="cal-wd">${w}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), iso = isoDate(d);
      const evs = eventsOn(iso), ts = tasksOn(iso);
      const items = [
        ...evs.map((e) => `<span class="cal-ev${e.all_day ? " allday" : ""}">${e.all_day ? "" : `<i>${hhmm(e.start)}</i>`}${esc(e.title)}</span>`),
        ...ts.map((t) => `<span class="cal-task${t.done ? " done" : ""}">${t.done ? "✓" : "☐"} ${esc(t.text)}</span>`),
      ];
      const shown = items.slice(0, 3), more = items.length - shown.length;
      html += `<button class="cal-cell${d.getMonth() !== month ? " out" : ""}${iso === today ? " today" : ""}${iso === selected ? " sel" : ""}" data-date="${iso}">
        <span class="cal-num">${d.getDate()}</span>${shown.join("")}${more > 0 ? `<span class="cal-more">+${more}</span>` : ""}</button>`;
    }
    $("#cal-grid").innerHTML = html;
  }

  function renderDay() {
    $("#cal-day-title").innerHTML = `${fmtDay(selected)} <span class="eyebrow">${selected === todayISO() ? "Today" : "Day"}</span>`;
    const evs = eventsOn(selected), ts = tasksOn(selected);
    $("#cal-day-body").innerHTML =
      (evs.length ? evs.map((e) => `<div class="event">
        <span class="ev-time">${e.all_day ? "全天" : `${hhmm(e.start)}<br><span>${hhmm(e.end)}</span>`}</span>
        <span class="ev-main"><b>${esc(e.title)}</b>${e.location ? `<span class="muted small">📍 ${esc(e.location)}</span>` : ""}</span>
        <span class="tag">${esc(e.source)}</span></div>`).join("") : `<p class="muted small">沒有行程</p>`) +
      `<div class="sched-day">待辦</div>` +
      (ts.length ? ts.map((t) => `<div class="task${t.done ? " done" : ""}"><span class="check static">${t.done ? "✓" : ""}</span><span class="task-text">${esc(t.text)}</span></div>`).join("") : `<p class="muted small">沒有到期的待辦</p>`) +
      `<form class="task-form" id="cal-add-task"><input class="search" name="text" placeholder="在這天新增待辦…" autocomplete="off"><button class="small-btn">新增</button></form>`;
  }

  return {
    init() {
      // 換月時把選取日移到該月（本月就選今天），右側明細才對得上已載入的資料
      const shift = (n) => {
        cursor.setMonth(cursor.getMonth() + n);
        const now = new Date();
        selected = cursor.getFullYear() === now.getFullYear() && cursor.getMonth() === now.getMonth() ? todayISO() : isoDate(cursor);
        load();
      };
      $("#cal-prev").addEventListener("click", () => shift(-1));
      $("#cal-next").addEventListener("click", () => shift(1));
      $("#cal-today").addEventListener("click", () => { cursor = new Date(); cursor.setDate(1); selected = todayISO(); load(); });
      $("#cal-refresh").addEventListener("click", () => { load(true); toast("重新抓取行事曆…"); });
      $("#cal-grid").addEventListener("click", (e) => {
        const cell = e.target.closest(".cal-cell");
        if (!cell) return;
        selected = cell.dataset.date;
        const d = parseISO(selected);
        if (d.getMonth() !== cursor.getMonth()) { cursor = new Date(d.getFullYear(), d.getMonth(), 1); load(); }
        else { renderGrid(); renderDay(); }
      });
      $("#cal-day-body").addEventListener("submit", async (e) => {
        e.preventDefault();
        const text = e.target.text.value.trim();
        if (!text) return;
        try {
          await api("/api/tasks", { method: "POST", body: { text, due: selected } });
          toast(`已新增到 ${fmtDay(selected)}`);
          load();
        } catch (err) { toast(err.message); }
      });
      on("tasks-changed", () => Nova.current === "calendar" && load());
    },
    show() { load(); },
  };
})();
