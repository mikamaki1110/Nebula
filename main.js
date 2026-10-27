// =====================================================================
// Nebula Desktop – Electron Hauptprozess
// Fenster, Tray, Tastenkürzel, Hardware-Abfragen, Sensoren, Speichern
// =====================================================================
const {
  app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage,
  shell, dialog, clipboard,
} = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const si = require("systeminformation");
const lhm = require("./lhm");

let win = null;
let tray = null;
let isQuitting = false;

// ---------- Nur eine Instanz erlauben ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

// =====================================================================
// Speicher (Notizen + Einstellungen)
// =====================================================================
const DEFAULT_SETTINGS = { accent: 0, alwaysOnTop: false, minimizeToTray: true, lhmPort: 8085 };
const storePath = () => path.join(app.getPath("userData"), "nebula-data.json");

function readStore() {
  try {
    const data = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return { notes: data.notes ?? "", settings: { ...DEFAULT_SETTINGS, ...data.settings } };
  } catch {
    return { notes: "", settings: { ...DEFAULT_SETTINGS } };
  }
}

function writeStore(data) {
  try {
    fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    console.error("Speichern fehlgeschlagen:", err);
    return false;
  }
}

let store = null;

// =====================================================================
// Hardware-Abfragen
// =====================================================================
// Ein Promise, das bei Fehler einen Ersatzwert liefert statt abzustürzen
const settle = (promise, fallback) => promise.then((v) => v ?? fallback, () => fallback);
const sum = (arr, key) => arr.reduce((s, x) => s + (Number(x?.[key]) || 0), 0);
const clean = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : s);
const IGNORED_GPU = /basic display|basic render|remote display|virtual|parsec|meta |spacedesk|citrix/i;

// ---------- Statische Infos (einmalig, aufwendig) ----------
let staticInfo = null;

async function loadStaticInfo(refresh = false) {
  if (staticInfo && !refresh) return staticInfo;

  const [cpu, mem, memLayout, graphics, board, bios, system, osInfo, disks, nets, battery] =
    await Promise.all([
      settle(si.cpu(), {}),
      settle(si.mem(), {}),
      settle(si.memLayout(), []),
      settle(si.graphics(), { controllers: [], displays: [] }),
      settle(si.baseboard(), {}),
      settle(si.bios(), {}),
      settle(si.system(), {}),
      settle(si.osInfo(), {}),
      settle(si.diskLayout(), []),
      settle(si.networkInterfaces(), []),
      settle(si.battery(), {}),
    ]);

  const cpuName = clean(`${cpu.manufacturer ?? ""} ${cpu.brand ?? ""}`) || os.cpus()[0]?.model || "Unbekannt";

  staticInfo = {
    user: os.userInfo().username,
    appVersion: app.getVersion(),
    cpu: {
      name: cpuName,
      manufacturer: cpu.manufacturer,
      socket: cpu.socket,
      cores: cpu.physicalCores,
      threads: cpu.cores,
      baseGHz: cpu.speed,
      maxGHz: cpu.speedMax,
      l2: cpu.cache?.l2,
      l3: cpu.cache?.l3,
      virtualization: cpu.virtualization,
    },
    gpus: (graphics.controllers ?? [])
      .filter((c) => c.model && !IGNORED_GPU.test(c.model))
      .map((c) => ({
        model: clean(c.model),
        vendor: clean(c.vendor),
        vramMB: c.vram,
        driver: c.driverVersion,
        bus: c.bus,
      })),
    displays: (graphics.displays ?? []).map((d) => ({
      model: clean(d.model || d.deviceName || "Bildschirm"),
      main: d.main,
      resX: d.currentResX || d.resolutionX,
      resY: d.currentResY || d.resolutionY,
      hz: d.currentRefreshRate,
      connection: d.connection,
      builtin: d.builtin,
    })),
    memory: {
      total: mem.total ?? os.totalmem(),
      modules: (memLayout ?? [])
        .filter((m) => m.size > 0)
        .map((m) => ({
          bank: clean(m.bank),
          size: m.size,
          type: m.type,
          clock: m.clockSpeed,
          manufacturer: clean(m.manufacturer),
          part: clean(m.partNum),
          formFactor: m.formFactor,
        })),
    },
    board: { manufacturer: clean(board.manufacturer), model: clean(board.model), version: clean(board.version) },
    bios: { vendor: clean(bios.vendor), version: clean(bios.version), releaseDate: bios.releaseDate },
    system: { manufacturer: clean(system.manufacturer), model: clean(system.model) },
    os: {
      name: clean(osInfo.distro) || `${os.type()} ${os.release()}`,
      release: osInfo.release,
      build: osInfo.build,
      arch: osInfo.arch || os.arch(),
      hostname: osInfo.hostname || os.hostname(),
      kernel: osInfo.kernel,
    },
    disks: (disks ?? []).map((d) => ({
      name: clean(d.name) || "Laufwerk",
      type: d.type,
      iface: d.interfaceType,
      size: d.size,
      vendor: clean(d.vendor),
      smart: d.smartStatus,
    })),
    network: (Array.isArray(nets) ? nets : [nets])
      .filter((n) => n && !n.virtual && !n.internal)
      .map((n) => ({
        name: clean(n.ifaceName || n.iface),
        type: n.type,
        ip4: n.ip4,
        mac: n.mac,
        speed: n.speed,
        isDefault: n.default,
        up: n.operstate === "up",
      })),
    battery: battery?.hasBattery
      ? { manufacturer: clean(battery.manufacturer), model: clean(battery.model), cycleCount: battery.cycleCount }
      : null,
  };
  return staticInfo;
}

// ---------- Schnelle Live-Werte (ca. jede Sekunde) ----------
async function liveFast() {
  const [load, mem, speed, net] = await Promise.all([
    settle(si.currentLoad(), {}),
    settle(si.mem(), {}),
    settle(si.cpuCurrentSpeed(), {}),
    settle(si.networkStats(), []),
  ]);

  const total = mem.total || os.totalmem();
  const used = mem.active || total - os.freemem();
  const netArr = Array.isArray(net) ? net : [net];

  return {
    cpu: Math.round(load.currentLoad ?? 0),
    cores: (load.cpus ?? []).map((c) => Math.round(c.load ?? 0)),
    cpuSpeed: speed.avg || null,
    ramUsed: used,
    ramTotal: total,
    ramPercent: Math.round((used / total) * 100),
    swapUsed: mem.swapused,
    swapTotal: mem.swaptotal,
    netRx: Math.max(0, sum(netArr, "rx_sec")),
    netTx: Math.max(0, sum(netArr, "tx_sec")),
    uptime: os.uptime(),
  };
}

// ---------- LibreHardwareMonitor (echte Temperaturen) ----------
// LHM stellt mit aktiviertem Webserver alle Sensoren als JSON bereit.
// Jeder Sensor hat "Type" (Temperature, Load, Fan …) und "RawValue" (Zahl, unabhängig von der Sprache).
const UNITS = {
  Temperature: "°C", Load: "%", Fan: "RPM", Power: "W", Clock: "MHz", Voltage: "V", Current: "A", Control: "%", Level: "%",
  Frequency: "Hz", Data: "GB", SmallData: "MB", Throughput: "B/s", Energy: "mWh", Noise: "dBA", Flow: "L/h", TimeSpan: "s",
};

async function readLhm(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/data.json`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const root = await res.json();

    // Baum: Ebene 0 = Wurzel, 1 = PC, 2 = Hardware, darunter Gruppen & Sensoren
    const sensors = [];
    const walk = (node, ancestors) => {
      const children = node.Children ?? [];
      if (!children.length && ancestors.length >= 3) {
        let value = typeof node.RawValue === "number" ? node.RawValue : null;
        let unit = node.Type ? UNITS[node.Type] ?? "" : "";
        if (value == null) {
          // ältere LHM-Versionen: formatierten Text auswerten ("61,3 °C")
          const m = String(node.Value ?? "").replace(",", ".").match(/(-?[\d.]+)\s*(.*)/);
          if (m) { value = parseFloat(m[1]); unit = unit || m[2].trim(); }
        }
        if (value != null && isFinite(value)) {
          const hw = ancestors[2];
          sensors.push({
            hw: hw.Text,
            hwIcon: hw.ImageURL ?? "",
            group: ancestors[ancestors.length - 1].Text,
            type: node.Type ?? "",
            name: node.Text,
            value,
            unit,
          });
        }
      }
      children.forEach((c) => walk(c, [...ancestors, node]));
    };
    walk(root, []);

    const isCpu = (s) => /\/cpu\.png$/i.test(s.hwIcon) || (!s.hwIcon && /ryzen|threadripper|xeon|core\(tm\)|intel.*core/i.test(s.hw));
    const isGpu = (s) => /\/(nvidia|ati|intel)\.png$/i.test(s.hwIcon) || /geforce|rtx|gtx|radeon|quadro|intel.*arc/i.test(s.hw);
    const isTemp = (s) => s.type === "Temperature" || s.unit === "°C";
    const pick = (list, ...patterns) => {
      for (const p of patterns) {
        const hit = list.find((s) => p.test(s.name) && s.value > 0);
        if (hit) return hit.value;
      }
      const valid = list.filter((s) => s.value > 0 && s.value < 150);
      return valid.length ? Math.max(...valid.map((s) => s.value)) : null;
    };

    const cpuTemps = sensors.filter((s) => isCpu(s) && isTemp(s));
    const gpuTemps = sensors.filter((s) => isGpu(s) && isTemp(s));
    const gpuLoads = sensors.filter((s) => isGpu(s) && (s.type === "Load" || /load/i.test(s.group)));

    return {
      cpuTemp: pick(cpuTemps, /package/i, /tctl|tdie/i, /^core \(tctl/i, /^cpu/i),
      gpuTemp: gpuTemps.length ? pick(gpuTemps, /^gpu core$/i, /core/i, /^gpu/i) : null,
      gpuHotspot: gpuTemps.find((s) => /hot ?spot/i.test(s.name))?.value ?? null,
      gpuLoad: gpuLoads.find((s) => /^(gpu core|d3d 3d|gpu)$/i.test(s.name))?.value ?? null,
      sensors,
    };
  } catch {
    return null;
  }
}

// ---------- Windows-Leistungsindikatoren (ohne Admin, alle Hersteller) ----------
// Liefert Prozesse wie im Task-Manager (mit PID), offene Fenster und die GPU-Auslastung.
const WIN_STATS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$p = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
  Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' } |
  Select-Object Name, IDProcess, PercentProcessorTime, WorkingSetPrivate
$w = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } |
  Select-Object Id, MainWindowTitle, Description
$g = (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine |
  Where-Object { $_.Name -like '*engtype_3D*' } |
  Measure-Object -Property UtilizationPercentage -Sum).Sum
[pscustomobject]@{ p = @($p); w = @($w); g = $g } | ConvertTo-Json -Compress -Depth 4
`;

// Diese Prozesse hält Windows am Leben – beenden würde einen Absturz/Bluescreen auslösen
const PROTECTED = new Set([
  "system", "registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "lsaiso",
  "memory compression", "secure system", "fontdrvhost", "svchost", "dwm", "sihost", "ctfmon",
  "librehardwaremonitor", "nebula",
]);
// Beenden erlaubt, aber mit deutlicher Warnung
const RISKY = new Set(["explorer", "searchhost", "startmenuexperiencehost", "shellexperiencehost", "runtimebroker"]);

let winGpuLoad = null;
let lastProcs = { processes: [], processCount: 0, source: null };
let procsBusy = false;

function groupProcesses(list, windows) {
  const winByPid = new Map(windows.map((w) => [Number(w.Id), w]));
  const groups = new Map();
  for (const p of list) {
    if (!p.name || /^(system idle process|idle|_total)$/i.test(p.name)) continue;
    const name = p.name.replace(/#\d+$/, "").replace(/\.exe$/i, "");
    const key = name.toLowerCase();
    const g = groups.get(key) ?? { key, name, count: 0, cpu: 0, mem: 0, instances: [], isApp: false, title: "", description: "" };
    const win = winByPid.get(Number(p.pid));
    g.count += 1;
    g.cpu += p.cpu || 0;
    g.mem += p.mem || 0;
    g.instances.push({ pid: Number(p.pid) || null, cpu: Math.round((p.cpu || 0) * 10) / 10, mem: p.mem || 0, title: win?.MainWindowTitle || "" });
    if (win) {
      g.isApp = true;
      g.title = g.title || win.MainWindowTitle || "";
      g.description = g.description || win.Description || "";
    }
    groups.set(key, g);
  }
  const ownPids = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
  return [...groups.values()].map((g) => ({
    ...g,
    cpu: Math.round(Math.min(100, g.cpu) * 10) / 10,
    instances: g.instances.sort((a, b) => b.cpu - a.cpu || b.mem - a.mem),
    protected: PROTECTED.has(g.key) || g.instances.some((i) => ownPids.has(i.pid)),
    risky: RISKY.has(g.key),
  }));
}

async function liveProcesses() {
  if (procsBusy) return lastProcs;
  procsBusy = true;
  try {
    let list = [];
    let windows = [];
    let source = null;

    if (process.platform === "win32") {
      try {
        const json = JSON.parse(await lhm.powershell(WIN_STATS_SCRIPT, 15000));
        const threads = os.cpus().length || 1;
        const arr = (v) => (Array.isArray(v) ? v : [v]).filter(Boolean);
        list = arr(json.p).map((p) => ({
          name: p.Name,
          pid: p.IDProcess,
          cpu: (Number(p.PercentProcessorTime) || 0) / threads, // Windows zählt pro Kern
          mem: Number(p.WorkingSetPrivate) || 0,
        }));
        windows = arr(json.w);
        winGpuLoad = json.g != null ? Math.min(100, Math.round(Number(json.g))) : null;
        source = "Windows-Leistungsindikatoren";
      } catch (err) {
        console.error("Leistungsindikatoren:", err.message);
      }
    }

    // Fallback: systeminformation
    if (!list.length) {
      const procs = await settle(si.processes(), { list: [] });
      list = (procs.list ?? []).map((p) => ({ name: p.name, pid: p.pid, cpu: p.cpu || 0, mem: (p.memRss || 0) * 1024 }));
      source = list.length ? "systeminformation" : null;
    }

    lastProcs = { processes: groupProcesses(list, windows), processCount: list.length, source };
    return lastProcs;
  } finally {
    procsBusy = false;
  }
}

// ---------- Prozesse beenden ----------
function killProcesses(pids, elevated = false) {
  const ids = [...new Set(pids.map(Number).filter((n) => Number.isInteger(n) && n > 4))];
  // Nie Nebula selbst oder geschützte Systemprozesse beenden
  const blocked = new Set(lastProcs.processes.filter((g) => g.protected).flatMap((g) => g.instances.map((i) => i.pid)));
  const ownPids = new Set([process.pid, ...app.getAppMetrics().map((m) => m.pid)]);
  const safe = ids.filter((id) => !blocked.has(id) && !ownPids.has(id));
  if (!safe.length) return Promise.resolve({ ok: false, error: "Dieser Prozess ist geschützt und kann nicht beendet werden." });

  if (elevated) {
    return lhm
      .powershellElevated(`Stop-Process -Id ${safe.join(",")} -Force -ErrorAction SilentlyContinue`)
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: err.message }));
  }

  return new Promise((resolve) => {
    const args = safe.flatMap((id) => ["/PID", String(id)]).concat("/F");
    require("child_process").execFile("taskkill.exe", args, { windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve({ ok: true });
      const text = `${stderr || ""}${stdout || ""}`;
      const denied = /zugriff|verweigert|access|denied/i.test(text);
      const gone = /nicht gefunden|not found/i.test(text);
      if (gone && !denied) return resolve({ ok: true });
      resolve({
        ok: false,
        needsAdmin: denied,
        error: denied ? "Dieser Prozess läuft mit Admin-Rechten." : text.trim().split(/\r?\n/)[0] || "Beenden fehlgeschlagen.",
      });
    });
  });
}

// ---------- Langsame Live-Werte (alle paar Sekunden) ----------
let lastSlow = null;
let slowBusy = false;

async function liveSlow() {
  if (slowBusy && lastSlow) return lastSlow;
  slowBusy = true;
  try {
    const [temp, gfx, fsSize, battery, lhmData] = await Promise.all([
      settle(si.cpuTemperature(), {}),
      settle(si.graphics(), { controllers: [] }),
      settle(si.fsSize(), []),
      settle(si.battery(), {}),
      readLhm(store.settings.lhmPort || 8085),
    ]);

    // Grafikkarten: Werte von LHM > nvidia-smi > Windows-Leistungsindikatoren
    const controllers = (gfx.controllers ?? []).filter((c) => c.model && !IGNORED_GPU.test(c.model));
    const gpus = controllers.map((c, i) => {
      const primary = i === 0;
      const t = primary && lhmData?.gpuTemp != null ? lhmData.gpuTemp : c.temperatureGpu;
      let l = primary && lhmData?.gpuLoad != null ? lhmData.gpuLoad : c.utilizationGpu;
      let loadSource = primary && lhmData?.gpuLoad != null ? "LibreHardwareMonitor" : l != null ? "NVIDIA-Treiber" : null;
      if ((l == null || l < 0) && primary && winGpuLoad != null) { l = winGpuLoad; loadSource = "Windows"; }
      return {
        model: clean(c.model),
        temp: t > 0 ? t : null,
        tempSource: primary && lhmData?.gpuTemp != null ? "LibreHardwareMonitor" : t > 0 ? "NVIDIA-Treiber" : null,
        hotspot: primary ? lhmData?.gpuHotspot ?? null : null,
        load: l != null && l >= 0 ? Math.round(l) : null,
        loadSource,
        memUsed: c.memoryUsed ?? null,
        memTotal: c.memoryTotal ?? c.vram ?? null,
        fan: c.fanSpeed ?? null,
        power: c.powerDraw ?? null,
        clock: c.clockCore ?? null,
      };
    });

    const cpuTemp = lhmData?.cpuTemp ?? (temp.main > 0 ? temp.main : null);

    lastSlow = {
      cpuTemp,
      cpuTempSource: lhmData?.cpuTemp != null ? "LibreHardwareMonitor" : cpuTemp != null ? "Windows" : null,
      coreTemps: (temp.cores ?? []).filter((t) => t > 0),
      gpus,
      volumes: (fsSize ?? [])
        .filter((v) => v.size > 0)
        .map((v) => ({ mount: v.mount || v.fs, type: v.type, size: v.size, used: v.used, use: v.use })),
      ...lastProcs,
      battery: battery?.hasBattery ? { percent: battery.percent, charging: battery.isCharging } : null,
      lhm: lhmData ? { connected: true, sensors: lhmData.sensors } : { connected: false, sensors: [] },
    };
    return lastSlow;
  } finally {
    slowBusy = false;
  }
}

// ---------- Systembericht als Text ----------
function buildReport() {
  const i = staticInfo;
  if (!i) return "Systeminfos werden noch geladen…";
  const s = lastSlow ?? {};
  const GB = (b) => (b ? `${(b / 1024 ** 3).toFixed(1)} GB` : "—");
  const L = [];
  const sec = (t) => L.push("", `== ${t} ==`);
  const row = (k, v) => v != null && v !== "" && L.push(`${k.padEnd(18)} ${v}`);

  L.push(`NEBULA SYSTEMBERICHT – ${new Date().toLocaleString("de-DE")}`);
  sec("System");
  row("Gerät", i.os.hostname);
  row("Betriebssystem", `${i.os.name} ${i.os.release ?? ""} (Build ${i.os.build ?? "?"})`);
  row("Architektur", i.os.arch);
  row("Hersteller", `${i.system.manufacturer ?? ""} ${i.system.model ?? ""}`.trim());
  sec("Prozessor");
  row("Modell", i.cpu.name);
  row("Kerne / Threads", `${i.cpu.cores} / ${i.cpu.threads}`);
  row("Takt", `${i.cpu.baseGHz} GHz (max. ${i.cpu.maxGHz || "?"} GHz)`);
  row("Sockel", i.cpu.socket);
  row("Temperatur", s.cpuTemp != null ? `${Math.round(s.cpuTemp)} °C` : "nicht verfügbar");
  sec("Grafik");
  i.gpus.forEach((g, n) => {
    row(`GPU ${n + 1}`, g.model);
    row("  VRAM", g.vramMB ? `${(g.vramMB / 1024).toFixed(1)} GB` : "—");
    row("  Treiber", g.driver);
    const t = s.gpus?.[n]?.temp;
    row("  Temperatur", t != null ? `${Math.round(t)} °C` : "nicht verfügbar");
  });
  sec("Arbeitsspeicher");
  row("Gesamt", GB(i.memory.total));
  i.memory.modules.forEach((m) =>
    row(m.bank || "Modul", `${GB(m.size)} ${m.type ?? ""} ${m.clock ? m.clock + " MHz" : ""} ${m.manufacturer ?? ""} ${m.part ?? ""}`.trim())
  );
  sec("Mainboard & BIOS");
  row("Mainboard", `${i.board.manufacturer ?? ""} ${i.board.model ?? ""}`.trim());
  row("BIOS", `${i.bios.vendor ?? ""} ${i.bios.version ?? ""} (${i.bios.releaseDate ?? "?"})`);
  sec("Laufwerke");
  i.disks.forEach((d) => row(d.name, `${GB(d.size)} ${d.type ?? ""} ${d.iface ?? ""} SMART: ${d.smart ?? "?"}`));
  (s.volumes ?? []).forEach((v) => row(`Partition ${v.mount}`, `${GB(v.used)} von ${GB(v.size)} belegt (${Math.round(v.use)}%)`));
  sec("Bildschirme");
  i.displays.forEach((d) => row(d.model, `${d.resX}x${d.resY} @ ${d.hz ?? "?"} Hz ${d.connection ?? ""}`));
  sec("Netzwerk");
  i.network.forEach((n) => row(n.name, `${n.type ?? ""} ${n.ip4 ?? ""} ${n.speed ? n.speed + " Mbit/s" : ""}`));
  return L.join("\r\n");
}

// =====================================================================
// Fenster & Tray
// =====================================================================
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    frame: false,
    backgroundColor: "#07070f",
    show: false,
    title: "Nebula",
    icon: path.join(__dirname, "assets", "icon.png"),
    alwaysOnTop: store.settings.alwaysOnTop,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  win.once("ready-to-show", () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.on("close", (e) => {
    if (!isQuitting && store.settings.minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

function createTray() {
  const icon = nativeImage
    .createFromPath(path.join(__dirname, "assets", "icon.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Nebula");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Nebula öffnen", click: showWindow },
      { type: "separator" },
      { label: "Beenden", click: () => { isQuitting = true; app.quit(); } },
    ])
  );
  tray.on("click", toggleWindow);
}

// =====================================================================
// IPC
// =====================================================================
function registerIpc() {
  ipcMain.on("window:minimize", () => win.minimize());
  ipcMain.on("window:maximize", () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  ipcMain.on("window:close", () => win.close());

  ipcMain.handle("hw:static", (_e, refresh) => loadStaticInfo(Boolean(refresh)));
  ipcMain.handle("hw:fast", () => liveFast());
  ipcMain.handle("hw:slow", () => liveSlow());

  ipcMain.handle("report:copy", () => {
    clipboard.writeText(buildReport());
    return true;
  });

  ipcMain.handle("report:save", async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: "Systembericht speichern",
      defaultPath: path.join(app.getPath("desktop"), `Nebula-Systembericht-${os.hostname()}.txt`),
      filters: [{ name: "Textdatei", extensions: ["txt"] }],
    });
    if (canceled || !filePath) return false;
    fs.writeFileSync(filePath, buildReport(), "utf8");
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("hw:procs", () => liveProcesses());
  ipcMain.handle("proc:kill", async (_e, pids, elevated) => {
    const result = await killProcesses(Array.isArray(pids) ? pids : [], Boolean(elevated));
    if (result.ok) await new Promise((r) => setTimeout(r, 400));
    return result;
  });

  // ---------- Sensor-Dienst ----------
  ipcMain.handle("lhm:test", async () => Boolean(await readLhm(store.settings.lhmPort || 8085)));
  ipcMain.handle("lhm:status", async () => ({
    ...(await lhm.status()),
    connected: Boolean(await readLhm(store.settings.lhmPort || 8085)),
  }));

  let setupRunning = false;
  ipcMain.handle("lhm:setup", async () => {
    if (setupRunning) return { ok: false, error: "Die Einrichtung läuft bereits." };
    setupRunning = true;
    const port = store.settings.lhmPort || 8085;
    const progress = (step, message) => win?.webContents.send("lhm:progress", { step, message });
    try {
      await lhm.setup(port, progress);
      // bis zu 2 Minuten warten, bis der Webserver antwortet (PawnIO-Abfrage beim ersten Start)
      for (let i = 0; i < 60; i++) {
        if (await readLhm(port)) {
          progress("done", "Sensoren verbunden");
          return { ok: true };
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      return { ok: false, error: "LibreHardwareMonitor läuft, antwortet aber nicht. Falls eine Frage zu PawnIO offen ist, bitte mit OK bestätigen und dann „Erneut verbinden“ klicken." };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      setupRunning = false;
    }
  });

  ipcMain.handle("lhm:start", async () => {
    try {
      await lhm.start();
      for (let i = 0; i < 20; i++) {
        if (await readLhm(store.settings.lhmPort || 8085)) return { ok: true };
        await new Promise((r) => setTimeout(r, 1500));
      }
      return { ok: false, error: "Der Sensor-Dienst antwortet nicht. Ist der Port in den Einstellungen richtig?" };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("lhm:remove", async () => {
    try {
      await lhm.remove();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("store:get", () => store);

  ipcMain.handle("notes:save", (_e, text) => {
    store.notes = String(text ?? "");
    return writeStore(store);
  });

  ipcMain.handle("settings:save", (_e, settings) => {
    const { autostart, ...rest } = settings ?? {};
    store.settings = { ...store.settings, ...rest };
    win.setAlwaysOnTop(Boolean(store.settings.alwaysOnTop));
    if (typeof autostart === "boolean") app.setLoginItemSettings({ openAtLogin: autostart });
    return writeStore(store);
  });

  ipcMain.handle("settings:autostart", () => app.getLoginItemSettings().openAtLogin);
}

// =====================================================================
// Lebenszyklus
// =====================================================================
app.whenReady().then(() => {
  store = readStore();

  // Hält eine PowerShell offen → Hardware-Abfragen unter Windows deutlich schneller
  if (process.platform === "win32" && typeof si.powerShellStart === "function") {
    try { si.powerShellStart(); } catch { /* optional */ }
  }

  registerIpc();
  createWindow();
  createTray();

  // Sensor-Dienst im Hintergrund hochfahren, falls er eingerichtet ist
  lhm.ensureRunning();

  // Automatische Updates (nur in der installierten Version):
  // prüft GitHub Releases, lädt neue Versionen im Hintergrund und installiert sie beim Beenden.
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.checkForUpdatesAndNotify().catch(() => { /* offline oder portable Version */ });
    } catch { /* optional */ }
  }
  globalShortcut.register("CommandOrControl+Shift+N", toggleWindow);
  app.on("activate", showWindow);
});

app.on("before-quit", () => { isQuitting = true; });
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (typeof si.powerShellRelease === "function") {
    try { si.powerShellRelease(); } catch { /* optional */ }
  }
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
