// =====================================================================
// Nebula Desktop – Oberfläche
// =====================================================================
const $ = (id) => document.getElementById(id);
const api = window.nebula;

const FAST_MS = 1500;
const SLOW_MS = 4000;
const RING = 2 * Math.PI * 52;

// Wärmebild-Paletten wie bei echten Wärmebildkameras: [kalt … heiß]
const THEMES = [
  { name: "Ironbow", ramp: ["#2b1b5a", "#a42e7b", "#f06a2a", "#ffd25a"] },
  { name: "Arktis", ramp: ["#0b2a4a", "#1e6fb8", "#5ec8ff", "#e9f8ff"] },
  { name: "Lava", ramp: ["#3a0a0a", "#9e1b1b", "#ff5a1f", "#ffc34d"] },
  { name: "Weiß-heiß", ramp: ["#26292f", "#5c626d", "#aeb6c2", "#ffffff"] },
];

let settings = {};
let hw = null;          // statische Hardware-Infos
let slow = null;        // letzte langsame Live-Werte
let procs = null;       // letzte Prozessliste
let fast = null;        // letzte schnelle Live-Werte
let sensorStatus = null; // Status des Sensor-Dienstes

// Verlauf für die großen Diagramme der Detailseiten (ca. 2–4 Minuten)
const HIST_FAST = 90;
const HIST_SLOW = 60;
const hist = { cpu: [], ram: [], netRx: [], netTx: [], cpuTemp: [], gpuLoad: [], gpuTemp: [] };
function pushHist(key, value, size) {
  const arr = hist[key];
  arr.push(value ?? null);
  if (arr.length > size) arr.shift();
}

// =====================================================================
// Helfer
// =====================================================================
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function fmtBytes(b, digits = 1) {
  if (b == null || isNaN(b)) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i >= 3 ? digits : 0)} ${u[i]}`;
}
const fmtRate = (b) => `${fmtBytes(b || 0)}/s`;
const fmtTemp = (t) => (t == null ? "—" : `${Math.round(t)}°`);
const has = (v) => v != null && v !== "" && !(typeof v === "number" && isNaN(v));

function fmtUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}T ${h}h` : `${h}h ${m}m`;
}

// Typische Grenzen für Desktop-CPUs/GPUs: unter 70 °C entspannt, ab 85 °C heiß
const tempState = (t) => (t == null ? "na" : t < 70 ? "cool" : t < 85 ? "warm" : "hot");
const shortBrand = (s) => (s ?? "").replace(/\s*(COMPUTER INC\.?|Corporation|Co\.,? Ltd\.?|Inc\.?)\s*/gi, " ").trim();

function infoList(rows) {
  const dl = el("dl", "info");
  rows.forEach(([k, v]) => {
    if (!has(v)) return;
    const dd = el("dd", null, String(v));
    dd.title = String(v);
    dl.append(el("dt", null, k), dd);
  });
  return dl;
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2000);
}

// Bestätigungsdialog im Nebula-Stil (ersetzt window.confirm)
function confirmDialog({ title, text, ok = "OK", danger = false }) {
  return new Promise((resolve) => {
    const modal = $("modal");
    $("modal-title").textContent = title;
    $("modal-text").textContent = text;
    const okBtn = $("modal-ok");
    okBtn.textContent = ok;
    okBtn.className = `btn ${danger ? "btn--danger" : "btn--primary"}`;
    modal.classList.remove("hidden");
    okBtn.focus();

    const close = (result) => {
      modal.classList.add("hidden");
      okBtn.onclick = null;
      $("modal-cancel").onclick = null;
      modal.onclick = null;
      document.removeEventListener("keydown", onKey, true);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      if (e.key === "Enter") { e.preventDefault(); close(true); }
    };
    okBtn.onclick = () => close(true);
    $("modal-cancel").onclick = () => close(false);
    modal.onclick = (e) => { if (e.target === modal) close(false); };
    document.addEventListener("keydown", onKey, true);
  });
}

function applyTheme(index) {
  const theme = THEMES[index] ?? THEMES[0];
  const root = document.documentElement.style;
  theme.ramp.forEach((c, i) => root.setProperty(`--t${i}`, c));
  root.setProperty("--accent", theme.ramp[2]);
  root.setProperty("--accent-2", theme.ramp[3]);
  window.NebulaBG?.setRamp(theme.ramp);
  document.querySelectorAll(".swatch").forEach((s, i) => s.classList.toggle("active", i === index));
}

// Ring-Kachel setzen: pct = Füllstand 0–100
function setTile(id, pct, value, sub, state) {
  const tile = $(id);
  const p = Math.max(0, Math.min(100, pct ?? 0));
  tile.querySelector(".ring__fg").style.strokeDashoffset = RING * (1 - p / 100);
  tile.querySelector(".tile__value").textContent = value;
  if (sub !== undefined) tile.querySelector(".tile__sub").textContent = sub;
  tile.dataset.state = state ?? "";
}

// =====================================================================
// Sparkline-Charts (1 oder 2 Linien)
// =====================================================================
class Sparkline {
  // series: Anzahl Linien · max: feste Obergrenze (null = automatisch)
  // grid: Hilfslinien mit Beschriftung · format: Beschriftung der Hilfslinien
  constructor(canvas, { series = 1, size = 48, max = 100, grid = false, format = (v) => `${Math.round(v)}` } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.max = max;
    this.grid = grid;
    this.format = format;
    this.size = size;
    this.data = Array.from({ length: series }, () => new Array(size).fill(null));
  }

  // Mit vorhandenem Verlauf füllen (z. B. beim Öffnen einer Detailseite)
  seed(...arrays) {
    arrays.forEach((arr, i) => {
      const tail = arr.slice(-this.size);
      this.data[i] = new Array(this.size - tail.length).fill(null).concat(tail);
    });
    this.started = arrays.some((a) => a.length);
    this.draw();
  }

  push(...values) {
    // Beim ersten Wert die ganze Linie damit füllen, statt bei 0 zu starten
    if (!this.started) { this.started = true; values.forEach((v, i) => this.data[i].fill(v ?? null)); }
    values.forEach((v, i) => { this.data[i].push(v ?? null); this.data[i].shift(); });
    this.draw();
  }

  draw() {
    const { canvas, ctx } = this;
    if (!canvas.isConnected) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const css = getComputedStyle(document.documentElement);
    const colors = [css.getPropertyValue("--accent").trim(), css.getPropertyValue("--accent-2").trim()];
    const values = this.data.flat().filter((v) => v != null);
    const max = this.max ?? Math.max(1, ...values) * 1.15;
    // Platz rechts für die Beschriftung der Hilfslinien (abhängig von der Textbreite)
    let padR = 0;
    if (this.grid) {
      ctx.font = `11px ${css.getPropertyValue("--font")}`;
      padR = 14 + Math.max(...[0.25, 0.5, 0.75, 1].map((f) => ctx.measureText(this.format(max * f)).width));
    }
    const plotW = w - padR;
    const y = (v) => h - 3 - (v / max) * (h - 6);

    if (this.grid) {
      ctx.font = `11px ${css.getPropertyValue("--font")}`;
      ctx.textBaseline = "middle";
      [0.25, 0.5, 0.75, 1].forEach((f) => {
        const yy = Math.round(y(max * f)) + 0.5;
        ctx.strokeStyle = "rgba(232,238,245,0.07)";
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(140,152,171,0.85)";
        ctx.fillText(this.format(max * f), plotW + 8, yy);
      });
    }

    this.data.forEach((series, si) => {
      const step = plotW / (series.length - 1);
      const color = this.data.length === 1 ? colors[0] : colors[si % 2];
      const first = series.findIndex((v) => v != null);
      if (first < 0) return;
      ctx.beginPath();
      series.forEach((v, i) => {
        if (v == null) return;
        i === first ? ctx.moveTo(i * step, y(v)) : ctx.lineTo(i * step, y(v));
      });

      if (this.data.length === 1) {
        const g = ctx.createLinearGradient(0, 0, plotW, 0);
        g.addColorStop(0, colors[0]);
        g.addColorStop(1, colors[1]);
        ctx.strokeStyle = g;
      } else {
        ctx.strokeStyle = color;
      }
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.stroke();

      ctx.lineTo((series.length - 1) * step, h);
      ctx.lineTo(first * step, h);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, 0, 0, h);
      fill.addColorStop(0, color + "40");
      fill.addColorStop(1, color + "00");
      ctx.shadowBlur = 0;
      ctx.fillStyle = fill;
      ctx.fill();
    });
  }
}

const charts = {
  cpu: new Sparkline($("cpu-chart")),
  net: new Sparkline($("net-chart"), { series: 2, max: null }),
};
// Detailseiten melden ihre Diagramme hier an, damit sie bei Farbwechsel/Größenänderung neu zeichnen
const extraCharts = new Set();
const redrawCharts = () => [...Object.values(charts), ...extraCharts].forEach((c) => c.draw());
window.addEventListener("resize", redrawCharts);

// =====================================================================
// Navigation & Fenster
// =====================================================================
$("wc-min").addEventListener("click", api.window.minimize);
$("wc-max").addEventListener("click", api.window.maximize);
$("wc-close").addEventListener("click", api.window.close);

let currentView = "dashboard";
function showView(name) {
  currentView = name;
  const navName = name === "detail" ? "dashboard" : name;
  document.querySelectorAll(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === navName));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  document.querySelector(".content").scrollTop = 0;
  if (name !== "detail") window.Details?.close();
  if (name === "notes") $("notes").focus();
  if (name === "processes") $("proc-search").focus();
  requestAnimationFrame(redrawCharts);
}
document.querySelectorAll(".nav").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
// Klicks auf alles mit data-goto (Ansicht) oder data-detail (Detailseite)
document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-goto], [data-detail]");
  if (!target || target.closest("#modal")) return;
  if (target.dataset.goto) showView(target.dataset.goto);
  else if (target.dataset.detail) window.Details?.open(target.dataset.detail);
});

function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const h = now.getHours();
  const part = h < 5 ? "Gute Nacht" : h < 12 ? "Guten Morgen" : h < 18 ? "Guten Tag" : "Guten Abend";
  $("greeting").textContent = hw?.user ? `${part}, ${hw.user}` : part;
}

// =====================================================================
// Schnelle Live-Werte
// =====================================================================
let fastBusy = false;

function buildCores(count) {
  const box = $("cores");
  if (box.childElementCount === count) return;
  box.replaceChildren();
  for (let i = 0; i < count; i++) {
    const c = el("div", "core");
    c.title = `Thread ${i + 1}`;
    c.append(el("div", "core__fill"));
    box.append(c);
  }
}

async function updateFast() {
  if (fastBusy) return;
  fastBusy = true;
  try {
    const f = await api.hw.fast();
    fast = f;

    setTile("t-cpu", f.cpu, `${f.cpu}%`, f.cpuSpeed ? `${f.cpuSpeed.toFixed(2)} GHz` : hw?.cpu?.name ?? "");
    setTile("t-ram", f.ramPercent, `${f.ramPercent}%`, `${fmtBytes(f.ramUsed)} von ${fmtBytes(f.ramTotal)}`, f.ramPercent >= 90 ? "hot" : "");
    $("t-ram").querySelector(".temp-pill").textContent = `${fmtBytes(f.ramTotal - f.ramUsed)} frei`;

    $("net-rx").textContent = fmtRate(f.netRx);
    $("net-tx").textContent = fmtRate(f.netTx);

    buildCores(f.cores.length);
    $("cores-label").textContent = `${f.cores.length} Threads`;
    [...$("cores").children].forEach((c, i) => {
      c.firstChild.style.height = `${f.cores[i]}%`;
      c.title = `Thread ${i + 1}: ${f.cores[i]}%`;
    });

    $("side-uptime").textContent = fmtUptime(f.uptime);

    lastRamPercent = f.ramPercent;
    // Ohne Temperatursensor folgt die Hitze des Hintergrunds der CPU-Last
    if (slow && slow.cpuTemp == null && !slow.gpus[0]?.temp) window.NebulaBG?.setHeat(f.cpu / 100);
    charts.cpu.push(f.cpu);
    charts.net.push(f.netRx, f.netTx);
    pushHist("cpu", f.cpu, HIST_FAST);
    pushHist("ram", f.ramPercent, HIST_FAST);
    pushHist("netRx", f.netRx, HIST_FAST);
    pushHist("netTx", f.netTx, HIST_FAST);
    window.Details?.onFast(f);
  } catch (err) {
    console.error(err);
  } finally {
    fastBusy = false;
  }
}

// =====================================================================
// Langsame Live-Werte (Temperaturen, GPU, Laufwerke, Prozesse)
// =====================================================================
let slowBusy = false;

async function updateSlow() {
  if (slowBusy) return;
  slowBusy = true;
  try {
    slow = await api.hw.slow();
    pushHist("cpuTemp", slow.cpuTemp, HIST_SLOW);
    pushHist("gpuTemp", slow.gpus[0]?.temp ?? null, HIST_SLOW);
    pushHist("gpuLoad", slow.gpus[0]?.load ?? null, HIST_SLOW);
    renderTemps();
    renderDiskTile();
    renderSensors();
    window.Details?.onSlow(slow);
  } catch (err) {
    console.error(err);
  } finally {
    slowBusy = false;
  }
}

function setPill(tileId, temp) {
  const pill = $(tileId).querySelector(".temp-pill");
  pill.dataset.state = tempState(temp);
  pill.textContent = temp == null ? "Temperatur fehlt" : `${Math.round(temp)} °C`;
}

function renderTemps() {
  const ct = slow.cpuTemp;
  setPill("t-cpu", ct);

  const g = slow.gpus[0];
  if (g) {
    const vram = g.memUsed != null && g.memTotal ? `VRAM ${Math.round((g.memUsed / g.memTotal) * 100)} % belegt` : g.model;
    setTile("t-gpu", g.load ?? 0, g.load != null ? `${g.load}%` : "—", vram, g.load == null ? "na" : "");
    setPill("t-gpu", g.temp);
  } else {
    setTile("t-gpu", 0, "—", "Keine GPU erkannt", "na");
    setPill("t-gpu", null);
  }

  renderStatus(ct, g?.temp ?? null);

  const missing = ct == null || (g && g.temp == null);
  $("temp-banner").classList.toggle("hidden", !missing || slow.lhm.connected);
}

// Statuszeile oben + Hitze des Hintergrunds
let lastRamPercent = 0;
function renderStatus(cpuT, gpuT) {
  const box = $("hero-status");
  const text = $("hero-status-text");
  const hottest = [["CPU", cpuT], ["GPU", gpuT]].filter(([, t]) => t != null).sort((a, b) => b[1] - a[1])[0];

  if (!hottest) {
    box.dataset.state = lastRamPercent >= 90 ? "warm" : "na";
    text.textContent = lastRamPercent >= 90 ? "Arbeitsspeicher fast voll" : "Temperaturen werden nicht gemessen";
    return;
  }
  const [part, t] = hottest;
  const state = tempState(t);
  box.dataset.state = state;
  text.textContent =
    state === "hot" ? `${part} ist heiß: ${Math.round(t)} °C` :
    state === "warm" ? `${part} wird warm: ${Math.round(t)} °C` :
    lastRamPercent >= 90 ? "Kühl, aber der Arbeitsspeicher ist fast voll" :
    "Alles im grünen Bereich";
  // 35 °C = kalt, 90 °C = maximale Glut
  window.NebulaBG?.setHeat((t - 35) / 55);
}

// Systemlaufwerk (meist C:) als Kachel
function systemVolume() {
  const vols = slow?.volumes ?? [];
  return vols.find((v) => /^c:?$/i.test(v.mount)) ?? vols.find((v) => v.mount === "/") ?? vols[0];
}

function renderDiskTile() {
  const v = systemVolume();
  if (!v) { setTile("t-disk", 0, "—", "Kein Laufwerk erkannt", "na"); return; }
  setTile("t-disk", v.use, `${Math.round(v.use)}%`, `${v.mount}, ${fmtBytes(v.size)} gesamt`, v.use >= 90 ? "hot" : "");
  $("t-disk").querySelector(".temp-pill").textContent = `${fmtBytes(v.size - v.used)} frei`;
}

// ---------- Prozesse (eigene Schleife, Darstellung in processes.js) ----------
let procsBusy = false;
async function updateProcs() {
  if (procsBusy) return;
  procsBusy = true;
  try {
    procs = await api.hw.procs();
    window.Processes?.render();
    $("side-procs").textContent = procs.processCount || "—";
    if (slow) renderSources();
  } catch (err) {
    console.error(err);
  } finally {
    procsBusy = false;
  }
}

// =====================================================================
// Sensoren
// =====================================================================
function sensorValue(s) {
  if (s.unit === "B/s") return fmtRate(s.value);
  const v = Number.isInteger(s.value) ? s.value : s.value.toFixed(s.unit === "V" ? 3 : 1);
  return `${v} ${s.unit}`.trim();
}

// ---------- Datenquellen: zeigt, was woher kommt und was fehlt ----------
function renderSources() {
  const g = slow.gpus[0];
  const lhmOk = slow.lhm.connected;
  const rows = [
    ["CPU-Temperatur", slow.cpuTemp != null, slow.cpuTemp != null ? `${Math.round(slow.cpuTemp)} °C über ${slow.cpuTempSource}` : "Braucht den Sensor-Dienst"],
    ["GPU-Temperatur", g?.temp != null, !g ? "Keine Grafikkarte erkannt" : g.temp != null ? `${Math.round(g.temp)} °C über ${g.tempSource}` : "Braucht den Sensor-Dienst (bei NVIDIA auch ohne)"],
    ["GPU-Auslastung", g?.load != null, !g ? "Keine Grafikkarte erkannt" : g.load != null ? `${g.load} % über ${g.loadSource}` : "Nicht verfügbar"],
    ["Prozesse", Boolean(procs?.processCount), procs?.processCount ? `${procs.processCount} Prozesse über ${procs.source}` : procs ? "Keine Daten erhalten" : "Werden gelesen"],
    ["Sensor-Dienst", lhmOk,
      lhmOk ? `Verbunden, ${slow.lhm.sensors.length} Sensoren`
      : sensorStatus?.installed ? (sensorStatus.running ? "Läuft, antwortet aber nicht (Port prüfen)" : "Eingerichtet, aber nicht gestartet")
      : "Nicht eingerichtet"],
  ];
  const list = $("sources");
  list.replaceChildren();
  rows.forEach(([name, ok, detail]) => {
    const li = el("li", "source");
    li.dataset.ok = String(Boolean(ok));
    li.append(el("span", "source__dot"), el("strong", null, name), el("span", null, detail));
    list.append(li);
  });
}

// ---------- Einrichtung des Sensor-Dienstes ----------
let setupActive = false;

function renderSetupCard() {
  const card = $("sensor-setup");
  const connected = slow?.lhm.connected;
  if (connected && !setupActive) { card.classList.add("hidden"); return; }
  if (!sensorStatus) return;
  card.classList.remove("hidden");
  if (setupActive) return;

  const btn = $("btn-setup");
  btn.disabled = false;
  if (!sensorStatus.supported) {
    $("setup-title").textContent = "Nur unter Windows verfügbar";
    $("setup-desc").textContent = "Die automatische Sensor-Einrichtung funktioniert nur unter Windows.";
    btn.classList.add("hidden");
  } else if (sensorStatus.bundled) {
    // Mit Nebula installiert, antwortet aber nicht
    $("setup-title").textContent = sensorStatus.running ? "Sensor-Dienst startet noch" : "Sensor-Dienst läuft nicht";
    $("setup-desc").textContent = sensorStatus.running
      ? "Der Sensor-Dienst wurde mit Nebula installiert und fährt gerade hoch. Das dauert nach dem Windows-Start manchmal eine Minute."
      : "Der Sensor-Dienst wurde mit Nebula installiert, läuft aber gerade nicht. Mit „Reparieren“ richtet Nebula ihn neu ein.";
    btn.textContent = "Reparieren";
    btn.dataset.action = "setup";
  } else if (sensorStatus.installed) {
    $("setup-title").textContent = "Sensor-Dienst ist nicht gestartet";
    $("setup-desc").textContent = sensorStatus.task
      ? "LibreHardwareMonitor ist eingerichtet, läuft aber gerade nicht. Normalerweise startet er automatisch mit Windows."
      : "LibreHardwareMonitor ist heruntergeladen, aber der Autostart fehlt. Richte ihn neu ein, das dauert nur einen Moment.";
    btn.textContent = sensorStatus.task ? "Sensor-Dienst starten" : "Erneut einrichten";
    btn.dataset.action = sensorStatus.task ? "start" : "setup";
  } else {
    $("setup-title").textContent = "CPU-Temperatur freischalten";
    btn.textContent = "Sensoren einrichten";
    btn.dataset.action = "setup";
  }
}

function setProgress(text, isError = false) {
  const box = $("setup-progress");
  box.classList.toggle("hidden", !text);
  box.classList.toggle("error", isError);
  $("setup-progress-text").textContent = text ?? "";
}

async function refreshSensorStatus() {
  try {
    sensorStatus = await api.sensors.status();
  } catch (err) {
    console.error(err);
  }
  renderSetupCard();
  if (slow) renderSources();
}

api.sensors.onProgress(({ message }) => setProgress(message));

$("btn-setup").addEventListener("click", async () => {
  const btn = $("btn-setup");
  const action = btn.dataset.action || "setup";
  setupActive = true;
  btn.disabled = true;
  setProgress(action === "start" ? "Sensor-Dienst wird gestartet…" : "Einrichtung startet…");

  const result = action === "start" ? await api.sensors.start() : await api.sensors.setup();

  setupActive = false;
  if (result.ok) {
    setProgress("");
    toast("Sensoren verbunden ✓");
    await updateSlow();
  } else {
    setProgress(result.error, true);
    btn.disabled = false;
    btn.textContent = action === "start" ? "Erneut versuchen" : "Erneut einrichten";
  }
  refreshSensorStatus();
});

function renderSensors() {
  const connected = slow.lhm.connected;
  const chip = $("lhm-chip");
  chip.textContent = connected ? `Sensor-Dienst verbunden, ${slow.lhm.sensors.length} Sensoren` : "Sensor-Dienst nicht verbunden";
  chip.className = `chip ${connected ? "ok" : "off"}`;
  renderSetupCard();
  renderSources();

  // Übersicht
  const summary = $("sensor-summary");
  summary.replaceChildren();
  const cpuCard = el("div", "card glass");
  cpuCard.append(el("h3", null, "Prozessor"));
  const cpuRows = [["Temperatur", slow.cpuTemp != null ? `${Math.round(slow.cpuTemp)} °C` : "Nicht verfügbar"]];
  if (slow.coreTemps.length) cpuRows.push(["Kerne", slow.coreTemps.map((t) => `${Math.round(t)}°`).join("  ")]);
  if (slow.cpuTempSource) cpuRows.push(["Quelle", slow.cpuTempSource]);
  cpuCard.append(infoList(cpuRows));
  summary.append(cpuCard);

  slow.gpus.forEach((g) => {
    const c = el("div", "card glass");
    c.append(el("h3", null, g.model));
    c.append(infoList([
      ["Temperatur", g.temp != null ? `${Math.round(g.temp)} °C` : "Nicht verfügbar"],
      ["Hotspot", g.hotspot != null ? `${Math.round(g.hotspot)} °C` : null],
      ["Auslastung", g.load != null ? `${g.load} %` : null],
      ["VRAM", g.memUsed != null && g.memTotal ? `${fmtBytes(g.memUsed * 1024 ** 2)} / ${fmtBytes(g.memTotal * 1024 ** 2)}` : null],
      ["Lüfter", g.fan != null ? `${g.fan} %` : null],
      ["Leistung", g.power != null ? `${Math.round(g.power)} W` : null],
      ["Takt", g.clock != null ? `${g.clock} MHz` : null],
    ]));
    summary.append(c);
  });

  // Alle LHM-Sensoren, gruppiert nach Hardware
  const groups = $("sensor-groups");
  groups.replaceChildren();
  if (!connected) return;

  const byHw = new Map();
  slow.lhm.sensors.forEach((s) => {
    if (!byHw.has(s.hw)) byHw.set(s.hw, new Map());
    const g = byHw.get(s.hw);
    if (!g.has(s.group)) g.set(s.group, []);
    g.get(s.group).push(s);
  });

  byHw.forEach((grp, hwName) => {
    const card = el("div", "card glass");
    card.append(el("h3", null, hwName));
    grp.forEach((list, groupName) => {
      card.append(el("p", "sensor-group__label", groupName));
      list.forEach((s) => {
        const row = el("div", "sensor-row");
        const val = el("span", null, sensorValue(s));
        if (s.unit.includes("°C")) val.className = `t-${tempState(s.value)}`;
        row.append(el("span", null, s.name), val);
        card.append(row);
      });
    });
    groups.append(card);
  });
}

$("btn-remove-sensors").addEventListener("click", async () => {
  const ok = await confirmDialog({
    title: "Sensor-Dienst entfernen?",
    text: "CPU- und GPU-Temperaturen sind danach nicht mehr verfügbar. Du kannst ihn unter Sensoren jederzeit wieder einrichten.",
    ok: "Entfernen",
    danger: true,
  });
  if (!ok) return;
  const result = await api.sensors.remove();
  toast(result.ok ? "Sensor-Dienst entfernt" : result.error);
  refreshSensorStatus();
  updateSlow();
});

// =====================================================================
// Hardware-Ansicht
// =====================================================================
function hwCard(icon, title, subtitle, wide = false) {
  const card = el("div", `card glass hw-card${wide ? " hw-card--wide" : ""}`);
  const head = el("div", "hw-card__head");
  const t = el("div", "hw-card__title");
  t.append(el("h3", null, title), el("p", null, subtitle || "—"));
  t.lastChild.title = subtitle || "";
  head.append(el("div", "hw-icon", icon), t);
  card.append(head);
  return card;
}

function subItem(name, rows) {
  const box = el("div", "sub-item");
  if (name) box.append(el("p", "sub-item__name", name));
  box.append(infoList(rows));
  return box;
}

function renderHardware() {
  const grid = $("hw-grid");
  grid.replaceChildren();
  const i = hw;

  // Prozessor
  const cpu = hwCard("⚡", "Prozessor", i.cpu.name);
  cpu.append(infoList([
    ["Hersteller", i.cpu.manufacturer],
    ["Kerne / Threads", has(i.cpu.cores) ? `${i.cpu.cores} / ${i.cpu.threads}` : null],
    ["Basistakt", i.cpu.baseGHz ? `${i.cpu.baseGHz} GHz` : null],
    ["Max. Takt", i.cpu.maxGHz ? `${i.cpu.maxGHz} GHz` : null],
    ["Sockel", i.cpu.socket],
    ["L2-Cache", i.cpu.l2 ? fmtBytes(i.cpu.l2) : null],
    ["L3-Cache", i.cpu.l3 ? fmtBytes(i.cpu.l3) : null],
    ["Virtualisierung", i.cpu.virtualization == null ? null : i.cpu.virtualization ? "Aktiv" : "Aus"],
  ]));
  grid.append(cpu);

  // Grafik
  const gpu = hwCard("▣", i.gpus.length > 1 ? `Grafikkarten (${i.gpus.length})` : "Grafikkarte", i.gpus[0]?.model ?? "Keine erkannt");
  i.gpus.forEach((g) =>
    gpu.append(subItem(i.gpus.length > 1 ? g.model : null, [
      ["Hersteller", g.vendor],
      ["Grafikspeicher", g.vramMB ? fmtBytes(g.vramMB * 1024 ** 2) : null],
      ["Treiber", g.driver],
      ["Anschluss", g.bus],
    ]))
  );
  grid.append(gpu);

  // Arbeitsspeicher
  const mods = i.memory.modules;
  const first = mods[0] ?? {};
  const ram = hwCard("▤", "Arbeitsspeicher",
    `${fmtBytes(i.memory.total, 0)}${first.type ? " " + first.type : ""}${first.clock ? ", " + first.clock + " MHz" : ""}`);
  ram.append(infoList([
    ["Gesamt", fmtBytes(i.memory.total)],
    ["Module", mods.length ? `${mods.length} Riegel` : null],
  ]));
  mods.forEach((m) =>
    ram.append(subItem(m.bank || "Modul", [
      ["Größe", fmtBytes(m.size, 0)],
      ["Typ", [m.type, m.formFactor].filter(Boolean).join(", ")],
      ["Takt", m.clock ? `${m.clock} MHz` : null],
      ["Hersteller", m.manufacturer],
      ["Teilenummer", m.part],
    ]))
  );
  grid.append(ram);

  // Mainboard & BIOS
  const board = hwCard("▦", "Mainboard", [shortBrand(i.board.manufacturer), i.board.model].filter(Boolean).join(" "));
  board.append(infoList([
    ["Hersteller", i.board.manufacturer],
    ["Modell", i.board.model],
    ["Revision", i.board.version],
    ["BIOS", [i.bios.vendor, i.bios.version].filter(Boolean).join(" ")],
    ["BIOS-Datum", i.bios.releaseDate],
    ["System", [i.system.manufacturer, i.system.model].filter(Boolean).join(" ")],
  ]));
  grid.append(board);

  // Betriebssystem
  const osCard = hwCard("◈", "Betriebssystem", i.os.name);
  osCard.append(infoList([
    ["Version", i.os.release],
    ["Build", i.os.build],
    ["Architektur", i.os.arch],
    ["Gerätename", i.os.hostname],
    ["Benutzer", i.user],
    ["Kernel", i.os.kernel],
  ]));
  grid.append(osCard);

  // Bildschirme
  const disp = hwCard("▭", i.displays.length > 1 ? `Bildschirme (${i.displays.length})` : "Bildschirm", i.displays[0]?.model ?? "—");
  i.displays.forEach((d) =>
    disp.append(subItem(i.displays.length > 1 ? `${d.model}${d.main ? " (Haupt)" : ""}` : null, [
      ["Auflösung", d.resX ? `${d.resX} × ${d.resY}` : null],
      ["Bildrate", d.hz ? `${d.hz} Hz` : null],
      ["Anschluss", d.connection],
      ["Typ", d.builtin ? "Integriert" : d.builtin === false ? "Extern" : null],
    ]))
  );
  grid.append(disp);

  // Laufwerke
  const totalDisk = i.disks.reduce((s, d) => s + (d.size || 0), 0);
  const disks = hwCard("◉", i.disks.length > 1 ? `Laufwerke (${i.disks.length})` : "Laufwerk", `${fmtBytes(totalDisk, 1)} gesamt`);
  i.disks.forEach((d) =>
    disks.append(subItem(d.name, [
      ["Größe", fmtBytes(d.size)],
      ["Typ", [d.type, d.iface].filter(Boolean).join(", ")],
      ["Hersteller", d.vendor],
      ["Zustand (SMART)", d.smart === "Ok" ? "OK ✓" : d.smart],
    ]))
  );
  grid.append(disks);

  // Netzwerk
  const def = i.network.find((n) => n.isDefault) ?? i.network[0];
  const net = hwCard("⇄", "Netzwerk", def?.name ?? "—");
  i.network.forEach((n) =>
    net.append(subItem(`${n.name}${n.isDefault ? " (aktiv)" : ""}`, [
      ["Typ", n.type],
      ["IPv4", n.ip4],
      ["MAC", n.mac],
      ["Geschwindigkeit", n.speed ? `${n.speed} Mbit/s` : null],
      ["Status", n.up ? "Verbunden" : "Getrennt"],
    ]))
  );
  grid.append(net);

  // Akku (nur Laptops)
  if (i.battery) {
    const bat = hwCard("▮", "Akku", slow?.battery ? `${slow.battery.percent}%${slow.battery.charging ? ", lädt" : ""}` : "—");
    bat.append(infoList([
      ["Hersteller", i.battery.manufacturer],
      ["Modell", i.battery.model],
      ["Ladezyklen", i.battery.cycleCount],
    ]));
    grid.append(bat);
  }
}

function renderHero() {
  $("hero-host").textContent = hw.os.hostname || "Dein PC";
  const mod = hw.memory.modules[0];
  const spec = $("hero-spec");
  spec.replaceChildren();
  [
    ["Prozessor", hw.cpu.name],
    ["Grafik", hw.gpus[0]?.model],
    ["Speicher", `${fmtBytes(hw.memory.total, 0)}${mod?.type ? " " + mod.type : ""}${mod?.clock ? ", " + mod.clock + " MHz" : ""}`],
    ["Mainboard", [shortBrand(hw.board.manufacturer), hw.board.model].filter(Boolean).join(" ")],
    ["System", hw.os.name],
  ].forEach(([k, v]) => {
    if (!has(v)) return;
    const dd = el("dd", null, v);
    dd.title = v;
    spec.append(el("dt", null, k), dd);
  });
  const net = hw.network.find((n) => n.isDefault) ?? hw.network[0];
  $("net-detail").textContent = net ? [net.name, net.ip4].filter(Boolean).join(", ") : "—";
}

async function loadHardware(refresh = false) {
  try {
    hw = await api.hw.static(refresh);
    renderHero();
    renderHardware();
    tickClock();
    $("version").textContent = `Nebula v${hw.appVersion}`;
  } catch (err) {
    console.error(err);
    $("hw-grid").replaceChildren(el("div", "card glass loading", "Hardware konnte nicht gelesen werden."));
  }
}

$("btn-refresh").addEventListener("click", async () => {
  toast("Hardware wird neu eingelesen…");
  await loadHardware(true);
  toast("Aktualisiert ✓");
});
$("btn-copy").addEventListener("click", async () => {
  await api.report.copy();
  toast("Systembericht in die Zwischenablage kopiert ✓");
});
$("btn-export").addEventListener("click", async () => {
  if (await api.report.save()) toast("Bericht gespeichert ✓");
});

// =====================================================================
// Notizen
// =====================================================================
let saveTimer;
$("notes").addEventListener("input", (e) => {
  $("notes-count").textContent = `${e.target.value.length} Zeichen`;
  $("notes-status").textContent = "Speichert…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const ok = await api.store.saveNotes(e.target.value);
    $("notes-status").textContent = ok ? "Gespeichert ✓" : "Fehler beim Speichern";
  }, 600);
});

// =====================================================================
// Einstellungen
// =====================================================================
function buildSwatches() {
  THEMES.forEach((theme, i) => {
    const s = el("button", "swatch", theme.name);
    s.title = `Palette ${theme.name}`;
    s.style.background = `linear-gradient(90deg, ${theme.ramp.join(", ")})`;
    s.addEventListener("click", async () => {
      applyTheme(i);
      await api.store.saveSettings({ accent: i });
      redrawCharts();
    });
    $("swatches").append(s);
  });
}

function bindSwitch(id, key, label) {
  $(id).addEventListener("change", async (e) => {
    await api.store.saveSettings({ [key]: e.target.checked });
    toast(`${label} ${e.target.checked ? "an" : "aus"}`);
  });
}

$("s-port").addEventListener("change", async (e) => {
  const port = Math.min(65535, Math.max(1, parseInt(e.target.value, 10) || 8085));
  e.target.value = port;
  await api.store.saveSettings({ lhmPort: port });
  toast(`Port ${port} gespeichert`);
  updateSlow();
});

// =====================================================================
// Start
// =====================================================================
async function init() {
  buildSwatches();

  const data = await api.store.get();
  settings = { ...data.settings };
  applyTheme(settings.accent ?? 0);

  $("notes").value = data.notes ?? "";
  $("notes-count").textContent = `${$("notes").value.length} Zeichen`;
  $("s-top").checked = Boolean(settings.alwaysOnTop);
  $("s-tray").checked = settings.minimizeToTray !== false;
  $("s-auto").checked = await api.store.getAutostart();
  $("s-port").value = settings.lhmPort ?? 8085;

  bindSwitch("s-top", "alwaysOnTop", "Immer im Vordergrund");
  bindSwitch("s-tray", "minimizeToTray", "In Tray minimieren");
  bindSwitch("s-auto", "autostart", "Autostart");

  tickClock();
  setInterval(tickClock, 10_000);

  updateFast();
  setInterval(updateFast, FAST_MS);

  updateProcs();
  setInterval(updateProcs, 4000);

  await loadHardware();
  await updateSlow();
  setInterval(updateSlow, SLOW_MS);

  refreshSensorStatus();
  setInterval(refreshSensorStatus, 20000);
}

// Erst starten, wenn auch processes.js und details.js geladen sind
window.addEventListener("DOMContentLoaded", init);
