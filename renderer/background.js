// =====================================================================
// Nebula – Wärmebild-Hintergrund
// Zeichnet Isothermen (Linien gleicher Temperatur) wie eine Wärmebildkamera.
// Die Hitze folgt der echten CPU-Temperatur bzw. Auslastung: setHeat(0..1)
// =====================================================================
(() => {
  const canvas = document.getElementById("bg-canvas");
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const CELL = 12;                 // Rastergröße in px (kleiner = feiner, teurer)
  const FPS = 24;
  const LEVELS = [0.16, 0.27, 0.38, 0.49, 0.6, 0.71, 0.82, 0.92];

  let ramp = ["#2B1B5A", "#A42E7B", "#F06A2A", "#FFD25A"];
  let heat = 0.35;
  let heatTarget = 0.35;
  let w = 0, h = 0, cols = 0, rows = 0, field = null;
  let last = 0;
  let t = Math.random() * 1000;

  // Wärmequellen: Position, Radius, Stärke, Drift
  const sources = [
    { x: 0.74, y: 0.3, r: 0.3, a: 1.0, sx: 0.11, sy: 0.07, ax: 0.07, ay: 0.06, p: 0, core: true },
    { x: 0.6, y: 0.46, r: 0.17, a: 0.55, sx: 0.13, sy: 0.1, ax: 0.09, ay: 0.07, p: 5 },
    { x: 0.86, y: 0.12, r: 0.14, a: 0.45, sx: 0.08, sy: 0.12, ax: 0.05, ay: 0.05, p: 6 },
    { x: 0.28, y: 0.78, r: 0.34, a: 0.75, sx: 0.07, sy: 0.09, ax: 0.08, ay: 0.05, p: 2 },
    { x: 0.12, y: 0.22, r: 0.22, a: 0.55, sx: 0.09, sy: 0.05, ax: 0.05, ay: 0.07, p: 4 },
    { x: 0.92, y: 0.86, r: 0.26, a: 0.6, sx: 0.05, sy: 0.08, ax: 0.06, ay: 0.05, p: 1 },
    { x: 0.5, y: 0.55, r: 0.18, a: -0.35, sx: 0.06, sy: 0.06, ax: 0.1, ay: 0.08, p: 3 }, // Kältesenke
  ];

  // ---------- Farben ----------
  const hexToRgb = (hex) => {
    const n = parseInt(hex.replace("#", ""), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  function rampColor(f, alpha) {
    const stops = ramp.map(hexToRgb);
    const pos = Math.max(0, Math.min(1, f)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(pos));
    const k = pos - i;
    const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
    return `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
  }

  // ---------- Größe ----------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / CELL) + 1;
    rows = Math.ceil(h / CELL) + 1;
    field = new Float32Array(cols * rows);
    draw();
  }

  // ---------- Temperaturfeld berechnen ----------
  function computeField() {
    const aspect = w / h;
    const pts = sources.map((s) => ({
      x: (s.x + Math.sin(t * s.sx + s.p) * s.ax) * aspect,
      y: s.y + Math.cos(t * s.sy + s.p * 1.3) * s.ay,
      r2: (s.r * (s.core ? 0.85 + heat * 0.45 : 1)) ** 2,
      a: s.core ? 0.55 + heat * 0.75 : s.a,
    }));
    for (let j = 0; j < rows; j++) {
      const y = (j * CELL) / h;
      for (let i = 0; i < cols; i++) {
        const x = ((i * CELL) / w) * aspect;
        let v = 0.08;
        for (const p of pts) {
          const dx = x - p.x;
          const dy = y - p.y;
          v += p.a * Math.exp(-(dx * dx + dy * dy) / p.r2);
        }
        // leichte Welligkeit, damit die Linien organisch wirken
        v += Math.sin(x * 9 + t * 0.4) * Math.cos(y * 7 - t * 0.3) * 0.035 + Math.sin(x * 23 - y * 17 + t * 0.6) * 0.012;
        field[j * cols + i] = v;
      }
    }
  }

  // ---------- Isolinien (Marching Squares) ----------
  function drawLevel(level, color, width) {
    ctx.beginPath();
    const lerp = (a, b) => (level - a) / (b - a || 1e-6);
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = field[j * cols + i];
        const b = field[j * cols + i + 1];
        const c = field[(j + 1) * cols + i + 1];
        const d = field[(j + 1) * cols + i];
        const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
        if (idx === 0 || idx === 15) continue;

        const x0 = i * CELL, y0 = j * CELL;
        const top = [x0 + CELL * lerp(a, b), y0];
        const right = [x0 + CELL, y0 + CELL * lerp(b, c)];
        const bottom = [x0 + CELL * lerp(d, c), y0 + CELL];
        const left = [x0, y0 + CELL * lerp(a, d)];

        const seg = (p, q) => { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
        switch (idx) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  function draw() {
    if (!field) return;
    computeField();
    ctx.clearRect(0, 0, w, h);

    // Glut unter dem heißesten Punkt
    const core = sources[0];
    const cx = (core.x + Math.sin(t * core.sx + core.p) * core.ax) * w;
    const cy = (core.y + Math.cos(t * core.sy + core.p * 1.3) * core.ay) * h;
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.45);
    glow.addColorStop(0, rampColor(0.75, 0.10 + heat * 0.14));
    glow.addColorStop(1, rampColor(0.2, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    LEVELS.forEach((level, n) => {
      const f = n / (LEVELS.length - 1);
      drawLevel(level, rampColor(f, 0.26 + f * 0.44), n >= LEVELS.length - 2 ? 1.6 : 1.1);
    });
  }

  function loop(now) {
    requestAnimationFrame(loop);
    if (document.hidden || now - last < 1000 / FPS) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    heat += (heatTarget - heat) * 0.03;   // weich nachziehen
    t += dt * (0.35 + heat * 0.5);         // wärmer = unruhiger
    draw();
  }

  window.addEventListener("resize", resize);
  resize();
  if (!reduceMotion) requestAnimationFrame(loop);

  window.NebulaBG = {
    setHeat(v) {
      heatTarget = Math.max(0, Math.min(1, v));
      if (reduceMotion) { heat = heatTarget; draw(); }
    },
    setRamp(colors) {
      ramp = colors;
      draw();
    },
  };
})();
