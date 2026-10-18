// 特效層：沿用 newstar0530.github.io 的 motion.js / fx.js 手法，改寫給工作台用。
// 進場模糊淡入、標題逐字出現、卡片游標聚光、背景星座、游標光暈與光環、點擊火花、磁吸按鈕。
(() => {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(pointer: fine)").matches;

  // ---------- 1. 進場：卡片依序由模糊淡入 ----------
  const reveals = [...document.querySelectorAll(".reveal")];
  if (reduceMotion) {
    reveals.forEach((el) => el.classList.add("in"));
  } else {
    reveals.forEach((el, i) => {
      el.style.transitionDelay = `${i * 90}ms`;
      // 背景分頁不會跑 requestAnimationFrame，用 setTimeout 確保卡片一定會出現
      setTimeout(() => el.classList.add("in"), 30);
      // 動畫結束後清掉 delay，之後的 hover 效果才不會延遲
      el.addEventListener("transitionend", () => (el.style.transitionDelay = ""), { once: true });
    });
  }

  // ---------- 2. 標題逐字淡入（中文逐字、英文逐詞，帶樣式的元素保持完整） ----------
  const splitWords = (el) => {
    let i = 0;
    [...el.childNodes].forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const frag = document.createDocumentFragment();
        node.textContent.split(/(\s+|[㐀-鿿])/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
          const w = document.createElement("span");
          w.className = "bt-w";
          w.style.setProperty("--i", i++);
          w.textContent = part;
          frag.appendChild(w);
        });
        node.replaceWith(frag);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        node.classList.add("bt-w");
        node.style.setProperty("--i", i++);
      }
    });
  };
  if (!reduceMotion) {
    document.querySelectorAll(".bt").forEach((el, k) => {
      splitWords(el);
      setTimeout(() => el.classList.add("bt-on"), 200 + k * 120);
    });
  }

  if (reduceMotion) return;

  // ---------- 3. 卡片游標聚光 + 發光邊框（CSS 讀 --mx / --my） ----------
  const mouse = { x: -9999, y: -9999, active: false };
  document.addEventListener("pointermove", (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.active = true;
    document.body.classList.add("pointer-in");
    const panel = e.target.closest?.(".panel");
    if (panel) {
      const r = panel.getBoundingClientRect();
      panel.style.setProperty("--mx", `${e.clientX - r.left}px`);
      panel.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
  }, { passive: true });
  document.addEventListener("pointerleave", () => {
    mouse.active = false;
    document.body.classList.remove("pointer-in", "has-ring");
  });

  // ---------- 4. 游標光暈（緩動跟隨） ----------
  const glow = document.querySelector(".cursor-glow");
  let gx = innerWidth / 2, gy = innerHeight / 2;
  const glowLoop = () => {
    gx += (mouse.x - gx) * 0.12;
    gy += (mouse.y - gy) * 0.12;
    if (glow) glow.style.transform = `translate(${gx - 280}px, ${gy - 280}px)`;
    requestAnimationFrame(glowLoop);
  };
  if (glow) { glow.style.left = "0"; glow.style.top = "0"; requestAnimationFrame(glowLoop); }

  // ---------- 5. 背景星座：星點緩慢漂移，靠近彼此或游標時連線 ----------
  const space = document.querySelector(".space");
  if (space) {
    const canvas = document.createElement("canvas");
    canvas.className = "constellation";
    space.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    const COLORS = ["95, 216, 207", "122, 162, 255", "139, 92, 246"];
    const LINK = 120, REACH = 170;
    let W = 0, H = 0, nodes = [];

    const build = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = innerWidth; H = innerHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round(Math.min((W * H) / (finePointer ? 16000 : 26000), 110));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.18, vy: (Math.random() - 0.5) * 0.18,
        r: Math.random() * 1.4 + 0.5,
        c: COLORS[Math.floor(Math.random() * COLORS.length)],
        tw: Math.random() * Math.PI * 2,
      }));
    };
    build();
    let resizeT;
    addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(build, 200); });

    const draw = (t) => {
      ctx.clearRect(0, 0, W, H);
      for (const n of nodes) {
        if (mouse.active) {  // 被游標輕輕推開
          const dx = n.x - mouse.x, dy = n.y - mouse.y, d = Math.hypot(dx, dy);
          if (d < REACH && d > 0.1) { n.x += (dx / d) * 0.35; n.y += (dy / d) * 0.35; }
        }
        n.x += n.vx; n.y += n.vy;
        if (n.x < -10) n.x = W + 10; else if (n.x > W + 10) n.x = -10;
        if (n.y < -10) n.y = H + 10; else if (n.y > H + 10) n.y = -10;
      }
      ctx.lineWidth = 0.6;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.strokeStyle = `rgba(${a.c}, ${(1 - d / LINK) * 0.18})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        if (mouse.active) {  // 連到游標的亮線
          const d = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (d < REACH) {
            ctx.strokeStyle = `rgba(95, 216, 207, ${(1 - d / REACH) * 0.35})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
          }
        }
        const alpha = 0.45 + Math.sin(t / 900 + a.tw) * 0.3;
        ctx.fillStyle = `rgba(${a.c}, ${alpha})`;
        ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
      }
    };

    let raf = null;
    const loop = (t) => { draw(t); raf = requestAnimationFrame(loop); };
    const start = () => { if (!raf) raf = requestAnimationFrame(loop); };
    const stop = () => { cancelAnimationFrame(raf); raf = null; };
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
  }

  // ---------- 6. 點擊火花 ----------
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const burst = document.createElement("span");
    burst.className = "spark-burst";
    burst.style.left = `${e.clientX}px`;
    burst.style.top = `${e.clientY}px`;
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("i");
      s.style.setProperty("--a", `${i * 45}deg`);
      burst.appendChild(s);
    }
    document.body.appendChild(burst);
    setTimeout(() => burst.remove(), 600);
  });

  if (!finePointer) return;

  // ---------- 7. 游標光環：滑到可點擊的東西上會放大 ----------
  const ring = document.createElement("div");
  ring.className = "cursor-ring";
  const dot = document.createElement("div");
  dot.className = "cursor-dot";
  document.body.append(ring, dot);
  let rx = 0, ry = 0;
  const CLICKABLE = "a, button, .item, .chip, .folder, .wikilink, input, summary";
  document.addEventListener("pointermove", (e) => {
    document.body.classList.add("has-ring");
    dot.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    ring.classList.toggle("hot", !!e.target.closest?.(CLICKABLE));
  }, { passive: true });
  document.addEventListener("pointerdown", () => ring.classList.add("press"));
  document.addEventListener("pointerup", () => ring.classList.remove("press"));
  const ringLoop = () => {
    rx += (mouse.x - rx) * 0.2;
    ry += (mouse.y - ry) * 0.2;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    requestAnimationFrame(ringLoop);
  };
  requestAnimationFrame(ringLoop);
  // 游標進到信件 iframe 時，這頁收不到移動事件，先把光環藏起來
  new MutationObserver(() => {
    document.querySelectorAll("iframe:not([data-fx])").forEach((f) => {
      f.dataset.fx = "1";
      f.addEventListener("mouseenter", () => document.body.classList.remove("has-ring", "pointer-in"));
    });
  }).observe(document.body, { childList: true, subtree: true });

  // ---------- 8. 磁吸按鈕 ----------
  document.querySelectorAll(".capture button, .small-btn").forEach((btn) => {
    btn.addEventListener("pointermove", (e) => {
      const r = btn.getBoundingClientRect();
      const x = (e.clientX - r.left - r.width / 2) * 0.25;
      const y = (e.clientY - r.top - r.height / 2) * 0.35;
      btn.style.translate = `${x}px ${y}px`;
    });
    btn.addEventListener("pointerleave", () => (btn.style.translate = ""));
  });
})();
