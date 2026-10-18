// 紀錄頁的圖表（純 SVG）：習慣熱度圖、心情折線、學習時數堆疊長條。
// 色票已用 dataviz validate_palette.js 在深色底 #0e0d19 驗證（亮度帶、CVD、對比全數通過）。
const Charts = (() => {
  const SERIES = ["#2ba59c", "#8b5cf6", "#c9822f", "#4f7be0", "#c95a8a", "#5f9a2e"];
  const OTHER = "#6b6880";
  const SURFACE = "#0e0d19";
  const HEAT_ON = "#2ba59c";
  const HEAT_OFF = "rgba(255,255,255,.06)";
  const MOOD_LINE = "#8b5cf6";
  const NS = "http://www.w3.org/2000/svg";

  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    parent?.appendChild(n);
    return n;
  };

  // 共用 tooltip
  function tip(container) {
    let t = container.querySelector(".chart-tip");
    if (!t) { t = document.createElement("div"); t.className = "chart-tip"; container.appendChild(t); }
    return {
      show(html, x, y) {
        t.innerHTML = html;
        t.classList.add("on");
        const w = container.clientWidth, tw = t.offsetWidth;
        t.style.left = `${Math.min(Math.max(x - tw / 2, 0), w - tw)}px`;
        t.style.top = `${Math.max(y - t.offsetHeight - 10, 0)}px`;
      },
      hide() { t.classList.remove("on"); },
    };
  }

  // 科目 → 顏色：依設定中的順序固定，不因篩選或排名改變
  function subjectColors(subjects) {
    const map = {};
    subjects.forEach((s, i) => (map[s] = SERIES[i] ?? OTHER));
    return (s) => map[s] ?? OTHER;
  }

  // ---------- 習慣熱度圖（GitHub 風格，一欄一週） ----------
  function heatmap(container, days, habit) {
    container.innerHTML = "";
    const CELL = 12, GAP = 3, TOP = 14, LEFT = 18;
    const first = parseISO(days[0].date);
    const offset = (first.getDay() + 6) % 7; // 週一為第一列
    const weeks = Math.ceil((days.length + offset) / 7);
    const W = LEFT + weeks * (CELL + GAP), H = TOP + 7 * (CELL + GAP);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${habit} 打卡熱度圖` }, container);
    ["一", "", "三", "", "五", "", "日"].forEach((l, r) => l && el("text", { x: 0, y: TOP + r * (CELL + GAP) + CELL - 2, class: "ax" }, svg).append(l));
    let lastMonth = -1;
    const t = tip(container);
    days.forEach((d, i) => {
      const idx = i + offset, col = Math.floor(idx / 7), row = idx % 7;
      const x = LEFT + col * (CELL + GAP), y = TOP + row * (CELL + GAP);
      const date = parseISO(d.date);
      if (row === 0 || i === 0) {
        if (date.getMonth() !== lastMonth && date.getDate() <= 7) {
          el("text", { x, y: 9, class: "ax" }, svg).append(`${date.getMonth() + 1}月`);
          lastMonth = date.getMonth();
        }
      }
      const done = d.habits.includes(habit);
      const r = el("rect", { x, y, width: CELL, height: CELL, rx: 3, fill: done ? HEAT_ON : HEAT_OFF, class: "cell" }, svg);
      r.addEventListener("pointerenter", () => {
        const box = container.getBoundingClientRect(), rb = r.getBoundingClientRect();
        t.show(`<b>${fmtDay(d.date)}</b><br>${done ? "✓ 已完成" : "— 未完成"}`, rb.left - box.left + CELL / 2, rb.top - box.top);
      });
      r.addEventListener("pointerleave", () => t.hide());
    });
  }

  // ---------- 心情折線（1–5，沒紀錄的日子斷線） ----------
  function moodLine(container, days) {
    container.innerHTML = "";
    const W = Math.max(container.clientWidth, 280), H = 180;
    const M = { l: 26, r: 10, t: 12, b: 24 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const x = (i) => M.l + (days.length === 1 ? iw / 2 : (i / (days.length - 1)) * iw);
    const y = (v) => M.t + ih - ((v - 1) / 4) * ih;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img", "aria-label": "近 30 天心情折線圖" }, container);
    for (let v = 1; v <= 5; v++) {
      el("line", { x1: M.l, x2: W - M.r, y1: y(v), y2: y(v), class: "grid" }, svg);
      el("text", { x: M.l - 8, y: y(v) + 4, class: "ax", "text-anchor": "end" }, svg).append(v);
    }
    days.forEach((d, i) => {
      if (i % 7 === days.length % 7 || i === days.length - 1) {
        el("text", { x: x(i), y: H - 6, class: "ax", "text-anchor": "middle" }, svg).append(fmtDay(d.date).split("（")[0]);
      }
    });
    // 折線：遇到空值就斷開
    let path = "", pen = false;
    days.forEach((d, i) => {
      if (d.mood == null) { pen = false; return; }
      path += `${pen ? "L" : "M"}${x(i)},${y(d.mood)}`;
      pen = true;
    });
    el("path", { d: path, fill: "none", stroke: MOOD_LINE, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    days.forEach((d, i) => d.mood != null && el("circle", { cx: x(i), cy: y(d.mood), r: 4, fill: MOOD_LINE, stroke: SURFACE, "stroke-width": 2 }, svg));

    if (!days.some((d) => d.mood != null)) {
      el("text", { x: W / 2, y: H / 2, class: "ax empty", "text-anchor": "middle" }, svg).append("還沒有心情紀錄，從「今天」頁開始打卡吧");
    }

    // 十字線 + tooltip
    const cross = el("line", { y1: M.t, y2: M.t + ih, class: "crosshair" }, svg);
    const dot = el("circle", { r: 5, fill: MOOD_LINE, stroke: "#fff", "stroke-width": 2, class: "hover-dot" }, svg);
    const t = tip(container);
    const hit = el("rect", { x: M.l, y: 0, width: iw, height: H, fill: "transparent" }, svg);
    hit.addEventListener("pointermove", (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(days.length - 1, Math.round(((px - M.l) / iw) * (days.length - 1))));
      const d = days[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.classList.add("on");
      if (d.mood != null) { dot.setAttribute("cx", x(i)); dot.setAttribute("cy", y(d.mood)); dot.classList.add("on"); }
      else dot.classList.remove("on");
      const label = d.mood != null ? `心情 <b>${d.mood}</b> / 5 ${MOODS[d.mood - 1]}` : "沒有紀錄";
      t.show(`<b>${fmtDay(d.date)}</b><br>${label}`, (x(i) / W) * r.width, ((d.mood != null ? y(d.mood) : M.t + ih / 2) / H) * r.height);
    });
    hit.addEventListener("pointerleave", () => { cross.classList.remove("on"); dot.classList.remove("on"); t.hide(); });

    container.appendChild(table(["日期", "心情"], days.filter((d) => d.mood != null).map((d) => [fmtDay(d.date), `${d.mood} ${MOODS[d.mood - 1]}`])));
  }

  // ---------- 學習時數：每日堆疊長條（依科目） ----------
  function studyBars(container, days, subjects) {
    container.innerHTML = "";
    const color = subjectColors(subjects);
    const used = [...new Set(days.flatMap((d) => Object.keys(d.study)))];
    const order = [...subjects.filter((s) => used.includes(s)), ...used.filter((s) => !subjects.includes(s))];

    // 圖例（≥2 個科目才需要；1 個科目由標題說明）
    if (order.length >= 2) {
      const lg = document.createElement("div");
      lg.className = "legend";
      lg.innerHTML = order.map((s) => `<span><i style="background:${color(s)}"></i>${esc(s)}</span>`).join("");
      container.appendChild(lg);
    }

    const W = Math.max(container.clientWidth, 280), H = 190;
    const M = { l: 34, r: 8, t: 10, b: 24 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const maxMin = Math.max(60, ...days.map((d) => d.study_total));
    const stepH = maxMin <= 120 ? 0.5 : maxMin <= 300 ? 1 : 2; // 刻度（小時）
    const top = Math.ceil(maxMin / 60 / stepH) * stepH * 60;
    const y = (m) => M.t + ih - (m / top) * ih;
    const band = iw / days.length, bw = Math.min(26, band * 0.62);
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", height: H, role: "img", "aria-label": "近 14 天學習時數" }, container);
    for (let h = 0; h <= top / 60 + 1e-9; h += stepH) {
      el("line", { x1: M.l, x2: W - M.r, y1: y(h * 60), y2: y(h * 60), class: h === 0 ? "base" : "grid" }, svg);
      el("text", { x: M.l - 6, y: y(h * 60) + 4, class: "ax", "text-anchor": "end" }, svg).append(h === 0 ? "0" : `${h}h`);
    }
    const t = tip(container);
    days.forEach((d, i) => {
      const cx = M.l + band * i + band / 2;
      if (i % 2 === (days.length - 1) % 2) el("text", { x: cx, y: H - 6, class: "ax", "text-anchor": "middle" }, svg).append(fmtDay(d.date).split("（")[0]);
      const segs = order.filter((s) => d.study[s]);
      let acc = 0;
      segs.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + d.study[s]);
        acc += d.study[s];
        const isTop = k === segs.length - 1;
        const h = Math.max(y0 - y1 - (isTop ? 0 : 2), 1); // 段與段之間留 2px 底色間隙
        const x0 = cx - bw / 2;
        const r = isTop ? Math.min(4, h) : 0;
        const p = `M${x0},${y1 + h}V${y1 + r}${r ? `Q${x0},${y1} ${x0 + r},${y1}` : ""}H${x0 + bw - r}${r ? `Q${x0 + bw},${y1} ${x0 + bw},${y1 + r}` : ""}V${y1 + h}Z`;
        el("path", { d: p, fill: color(s) }, svg);
      });
      // 比長條大的感應區
      const hit = el("rect", { x: cx - band / 2, y: M.t, width: band, height: ih, fill: "transparent", class: "bar-hit" }, svg);
      hit.addEventListener("pointerenter", () => {
        const r = svg.getBoundingClientRect();
        const rows = segs.map((s) => `<span class="tip-row"><i style="background:${color(s)}"></i>${esc(s)}<b>${d.study[s]} 分</b></span>`).join("");
        t.show(`<b>${fmtDay(d.date)}</b>${rows || "<br>沒有紀錄"}${segs.length > 1 ? `<span class="tip-row total">合計<b>${d.study_total} 分</b></span>` : ""}`,
          (cx / W) * r.width, (y(d.study_total) / H) * r.height + (container.querySelector(".legend")?.offsetHeight || 0));
        hit.classList.add("on");
      });
      hit.addEventListener("pointerleave", () => { t.hide(); hit.classList.remove("on"); });
    });
    if (!days.some((d) => d.study_total)) {
      el("text", { x: W / 2, y: H / 2, class: "ax empty", "text-anchor": "middle" }, svg).append("還沒有學習紀錄，用「專注計時」開始吧");
    }
    container.appendChild(table(["日期", ...order, "合計"],
      days.filter((d) => d.study_total).map((d) => [fmtDay(d.date), ...order.map((s) => d.study[s] || ""), d.study_total])));
  }

  // 表格檢視（無障礙 / 想看精確數字時）
  function table(head, rows) {
    const det = document.createElement("details");
    det.className = "chart-table";
    det.innerHTML = `<summary>以表格檢視</summary>` + (rows.length
      ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      : `<p class="muted small">沒有資料</p>`);
    return det;
  }

  return { heatmap, moodLine, studyBars, subjectColors };
})();

const MOODS = ["😞", "😕", "😐", "🙂", "😄"];
