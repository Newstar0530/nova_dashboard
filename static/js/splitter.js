// 可拖曳調整大小的版面：容器加上 data-rs="名稱" data-dir="h|v"，子元素之間會插入分隔條。
//   h = 子元素左右排列（拖曳直線調寬度），v = 上下排列（拖曳橫線調高度）
//   子元素可用 data-grow 設定預設比例；拖曳後的比例記在瀏覽器（localStorage），雙擊分隔條恢復預設。
// 窄螢幕（CSS 把分隔條藏起來時）不會作用，版面交給 RWD 規則。
const Splitter = (() => {
  const MIN_W = 240, MIN_H = 120; // 每個框框最小寬 / 高（px），太窄文字會一字一行
  const key = (name) => `nova.rs.${name}`;
  const load = (name) => { try { return JSON.parse(localStorage.getItem(key(name))); } catch { return null; } };
  const save = (name, v) => { try { v ? localStorage.setItem(key(name), JSON.stringify(v)) : localStorage.removeItem(key(name)); } catch {} };

  const items = (box) => [...box.children].filter((c) => !c.classList.contains("rs-gutter"));
  const defaults = (box) => items(box).map((c) => Number(c.dataset.grow) || 1);
  const apply = (box, grows) => items(box).forEach((c, i) => c.style.setProperty("--g", grows[i]));

  function setup(box) {
    const name = box.dataset.rs, horiz = box.dataset.dir === "h";
    const kids = items(box);
    kids.forEach((c, i) => {
      if (i === 0) return;
      const g = document.createElement("div");
      g.className = `rs-gutter ${horiz ? "rs-gutter-h" : "rs-gutter-v"}`;
      g.title = "拖曳調整大小，雙擊恢復預設";
      g.setAttribute("role", "separator");
      g.setAttribute("aria-orientation", horiz ? "vertical" : "horizontal");
      box.insertBefore(g, c);
    });
    const saved = load(name);
    apply(box, saved && saved.length === kids.length ? saved : defaults(box));

    box.addEventListener("dblclick", (e) => {
      const g = e.target.closest(".rs-gutter");
      if (!g || g.parentElement !== box) return;
      save(name, null);
      apply(box, defaults(box));
      emit("layout-changed");
      toast("已恢復預設大小");
    });

    box.addEventListener("pointerdown", (e) => {
      const g = e.target.closest(".rs-gutter");
      if (!g || g.parentElement !== box || e.button !== 0) return;
      e.preventDefault();
      const all = items(box);
      const a = g.previousElementSibling, b = g.nextElementSibling;
      const size = (el) => (horiz ? el.getBoundingClientRect().width : el.getBoundingClientRect().height);
      // 先把所有框框的比例換成目前的 px，之後只動相鄰兩個
      const px = all.map(size);
      const ia = all.indexOf(a), ib = all.indexOf(b);
      const start = horiz ? e.clientX : e.clientY;
      const pair = px[ia] + px[ib];
      const MIN = Math.min(horiz ? MIN_W : MIN_H, pair / 2);
      g.setPointerCapture(e.pointerId);
      document.body.classList.add("rs-dragging", horiz ? "rs-dragging-h" : "rs-dragging-v");
      g.classList.add("active");

      const move = (ev) => {
        const d = (horiz ? ev.clientX : ev.clientY) - start;
        const na = Math.min(Math.max(px[ia] + d, MIN), pair - MIN);
        const grows = px.slice();
        grows[ia] = na;
        grows[ib] = pair - na;
        apply(box, grows);
      };
      const up = () => {
        g.removeEventListener("pointermove", move);
        g.removeEventListener("pointerup", up);
        g.removeEventListener("pointercancel", up);
        document.body.classList.remove("rs-dragging", "rs-dragging-h", "rs-dragging-v");
        g.classList.remove("active");
        const final = items(box).map(size).map((v) => Math.round(v));
        save(name, final);
        apply(box, final);
        emit("layout-changed");
      };
      g.addEventListener("pointermove", move);
      g.addEventListener("pointerup", up);
      g.addEventListener("pointercancel", up);
    });
  }

  function init() { $$("[data-rs]").forEach(setup); }

  // 重設全部（給設定用）
  function resetAll() {
    $$("[data-rs]").forEach((box) => { save(box.dataset.rs, null); apply(box, defaults(box)); });
    emit("layout-changed");
  }

  return { init, resetAll };
})();

Splitter.init();
