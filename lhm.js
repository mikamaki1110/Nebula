// =====================================================================
// Nebula – Sensor-Dienst (LibreHardwareMonitor)
//
// Windows gibt CPU-Temperaturen nur an Programme mit eigenem Treiber heraus.
// Nebula richtet dafür einmalig LibreHardwareMonitor ein (Open Source):
//   1. herunterladen & entpacken (in den Nebula-Datenordner)
//   2. Webserver in der LHM-Konfiguration einschalten
//   3. geplante Aufgabe mit Admin-Rechten anlegen → startet bei jeder
//      Anmeldung automatisch, ohne weitere UAC-Abfrage
// Danach liest Nebula alle Sensoren über http://127.0.0.1:<port>/data.json
// =====================================================================
const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { execFile } = require("child_process");

const TASK_NAME = "Nebula Sensoren";
const DOWNLOAD_URLS = [
  "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/latest/download/LibreHardwareMonitor.zip",
  "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/v0.9.6/LibreHardwareMonitor.zip",
];

const isWindows = process.platform === "win32";
const baseDir = () => path.join(app.getPath("userData"), "LibreHardwareMonitor");
// Mit der Setup-EXE mitgelieferte Dateien (siehe build/fetch-sensors.ps1)
const resources = () => (app.isPackaged ? process.resourcesPath : path.join(__dirname, "vendor"));
const bundledLhmDir = () => path.join(resources(), "lhm");
const bundledPawnIo = () => path.join(resources(), "PawnIO_setup.exe");
const bundledScript = (name) => path.join(process.resourcesPath, "sensors", name);
// Installierte Version (nicht portable): Der Installer hat den Dienst bereits eingerichtet
const isInstalledBuild = () =>
  app.isPackaged && fs.existsSync(path.join(path.dirname(process.execPath), `Uninstall ${app.getName()}.exe`)) &&
  fs.existsSync(path.join(bundledLhmDir(), "LibreHardwareMonitor.exe"));

// Merker, dass die geplante Aufgabe erfolgreich angelegt wurde
const markerFile = () => path.join(baseDir(), "nebula-task.json");
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------- PowerShell ausführen ----------
// Das Skript wird als Base64 (UTF-16LE) übergeben: keine Probleme mit Anführungszeichen,
// Zeilenumbrüchen oder Umlauten in Pfaden.
function powershell(script, timeout = 120000) {
  const full = `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n${script}`;
  const encoded = Buffer.from(full, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { windowsHide: true, timeout, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.trim());
        const e = new Error(stderr?.trim() || `PowerShell-Fehler (Code ${err.code ?? "?"})`);
        e.code = err.code;
        reject(e);
      }
    );
  });
}

// Skript mit Admin-Rechten ausführen (zeigt eine UAC-Abfrage)
async function powershellElevated(scriptBody) {
  const file = path.join(baseDir(), "nebula-elevated.ps1");
  const log = path.join(baseDir(), "nebula-elevated.log");
  fs.mkdirSync(baseDir(), { recursive: true });
  fs.rmSync(log, { force: true });
  // Fehler im Admin-Fenster landen in einer Logdatei, die Nebula danach ausliest
  const wrapped =
    `$ErrorActionPreference = 'Stop'\r\ntry {\r\n${scriptBody}\r\n} catch {\r\n` +
    `  ($_ | Out-String) | Set-Content -LiteralPath ${psQuote(log)} -Encoding UTF8\r\n  exit 2\r\n}\r\nexit 0\r\n`;
  // UTF-8 mit BOM, damit Windows PowerShell 5.1 Umlaute in Pfaden korrekt liest
  fs.writeFileSync(file, "\uFEFF" + wrapped, "utf8");
  const outer =
    `try { $p = Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -PassThru ` +
    `-ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(`"${file}"`)}; exit $p.ExitCode } ` +
    `catch { Write-Error 'UAC_CANCELLED'; exit 1223 }`;
  try {
    await powershell(outer, 180000);
  } catch (err) {
    if (err.code === 1223 || /UAC_CANCELLED/.test(err.message)) {
      throw new Error("Die Windows-Abfrage für Admin-Rechte wurde abgebrochen.");
    }
    if (fs.existsSync(log)) {
      const detail = fs.readFileSync(log, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).find((l) => l.trim()) ?? "";
      throw new Error(`Einrichtung fehlgeschlagen: ${detail.trim()}`);
    }
    throw err;
  }
}

// ---------- Hilfen ----------
function findExe(dir) {
  if (!fs.existsSync(dir)) return null;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.toLowerCase() === "librehardwaremonitor.exe") return full;
    }
  }
  return null;
}

async function taskExists() {
  if (!isWindows) return false;
  if (fs.existsSync(markerFile())) return true;
  try {
    await powershell(`Get-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction Stop | Out-Null; 'ok'`, 20000);
    return true;
  } catch {
    return false;
  }
}

async function isProcessRunning() {
  if (!isWindows) return false;
  try {
    const out = await powershell(`(Get-Process -Name LibreHardwareMonitor -ErrorAction SilentlyContinue | Measure-Object).Count`, 15000);
    return Number(out) > 0;
  } catch {
    return false;
  }
}

// LHM-Konfiguration: Webserver an, minimiert im Tray starten
function writeConfig(exe, port) {
  const configPath = exe.replace(/\.exe$/i, ".config");
  const settings = new Map();

  // vorhandene Einstellungen behalten
  if (fs.existsSync(configPath)) {
    const xml = fs.readFileSync(configPath, "utf8");
    for (const m of xml.matchAll(/<add\s+key="([^"]*)"\s+value="([^"]*)"\s*\/>/g)) settings.set(m[1], m[2]);
  }
  settings.set("runWebServerMenuItem", "true");
  settings.set("listenerIp", "127.0.0.1");   // nur auf diesem PC erreichbar, keine Firewall-Abfrage
  settings.set("listenerPort", String(port));
  settings.set("startMinMenuItem", "true");
  settings.set("minTrayMenuItem", "true");
  settings.set("minCloseMenuItem", "true");

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const lines = [...settings].map(([k, v]) => `    <add key="${esc(k)}" value="${esc(v)}" />`);
  const xml = `<?xml version="1.0" encoding="utf-8"?>\r\n<configuration>\r\n  <appSettings>\r\n${lines.join("\r\n")}\r\n  </appSettings>\r\n</configuration>\r\n`;
  fs.writeFileSync(configPath, xml, "utf8");
}

async function download(dest) {
  let lastError;
  for (const url of DOWNLOAD_URLS) {
    try {
      const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100000) throw new Error("Download unvollständig");
      fs.writeFileSync(dest, buf);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Download fehlgeschlagen (${lastError?.message}). Ist der PC online?`);
}

// =====================================================================
// Öffentliche Funktionen
// =====================================================================
async function status() {
  if (isWindows && isInstalledBuild()) {
    return { supported: true, installed: true, bundled: true, task: true, running: await isProcessRunning() };
  }
  const exe = findExe(baseDir());
  return {
    supported: isWindows,
    installed: Boolean(exe),
    task: exe ? await taskExists() : false,
    running: exe ? await isProcessRunning() : false,
  };
}

async function setup(port, progress) {
  if (!isWindows) throw new Error("Die Sensor-Einrichtung gibt es nur unter Windows.");
  const dir = baseDir();
  fs.mkdirSync(dir, { recursive: true });

  // Installierte Version: Dienst mit den mitgelieferten Dateien neu einrichten (Reparatur)
  if (isInstalledBuild()) {
    progress("task", "Bitte die Windows-Abfrage mit „Ja“ bestätigen…");
    await powershellElevated(`
Start-Process -FilePath ${psQuote(bundledPawnIo())} -ArgumentList '-install','-silent' -Wait
& ${psQuote(bundledScript("install-sensors.ps1"))} -LhmDir ${psQuote(bundledLhmDir())}
`);
    progress("wait", "Sensoren starten…");
    return;
  }

  // 1. Mitgelieferte Dateien nutzen (portable Version), sonst herunterladen
  let exe = findExe(dir);
  if (!exe && fs.existsSync(path.join(bundledLhmDir(), "LibreHardwareMonitor.exe"))) {
    progress("extract", "Sensor-Dienst wird vorbereitet…");
    fs.cpSync(bundledLhmDir(), path.join(dir, "LHM"), { recursive: true });
    exe = findExe(dir);
  }
  if (!exe) {
    progress("download", "LibreHardwareMonitor wird heruntergeladen…");
    const zip = path.join(dir, "LibreHardwareMonitor.zip");
    await download(zip);

    progress("extract", "Wird entpackt…");
    await powershell(`Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dir)} -Force`);
    fs.rmSync(zip, { force: true });
    exe = findExe(dir);
    if (!exe) throw new Error("LibreHardwareMonitor.exe wurde im Download nicht gefunden.");
  }

  // 2. Konfiguration
  progress("config", "Webserver wird eingeschaltet…");
  writeConfig(exe, port);

  // 3. Geplante Aufgabe mit Admin-Rechten + sofort starten (eine UAC-Abfrage)
  progress("task", "Bitte die Windows-Abfrage mit „Ja“ bestätigen…");
  const user = `${process.env.USERDOMAIN || os.hostname()}\\${os.userInfo().username}`;
  // Treiber still mitinstallieren, falls er mitgeliefert wurde (sonst fragt LHM beim ersten Start danach)
  const pawnIo = fs.existsSync(bundledPawnIo())
    ? `Start-Process -FilePath ${psQuote(bundledPawnIo())} -ArgumentList '-install','-silent' -Wait\n`
    : "";
  await powershellElevated(`${pawnIo}
Get-Process -Name LibreHardwareMonitor -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500
$action    = New-ScheduledTaskAction -Execute ${psQuote(exe)} -WorkingDirectory ${psQuote(path.dirname(exe))}
$trigger   = New-ScheduledTaskTrigger -AtLogOn -User ${psQuote(user)}
$principal = New-ScheduledTaskPrincipal -UserId ${psQuote(user)} -LogonType Interactive -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName ${psQuote(TASK_NAME)}
`);
  fs.writeFileSync(markerFile(), JSON.stringify({ task: TASK_NAME, exe, created: new Date().toISOString() }), "utf8");

  // 4. Warten bis der Webserver antwortet (beim ersten Start fragt LHM nach dem PawnIO-Treiber)
  progress("wait", "Sensoren starten… Falls LibreHardwareMonitor nach „PawnIO“ fragt: mit OK bestätigen.");
}

// Dienst starten (ohne UAC, über die geplante Aufgabe)
async function start() {
  if (!isWindows) return false;
  if (await taskExists()) {
    try {
      await powershell(`Start-ScheduledTask -TaskName ${psQuote(TASK_NAME)}`, 20000);
      return true;
    } catch {
      /* Fallback unten */
    }
  }
  // Fallback: direkt mit Admin-Rechten starten
  const exe = findExe(baseDir());
  if (!exe) return false;
  await powershellElevated(`Start-Process -FilePath ${psQuote(exe)} -WorkingDirectory ${psQuote(path.dirname(exe))} -WindowStyle Minimized`);
  return true;
}

async function remove() {
  if (!isWindows) return;
  if (isInstalledBuild()) {
    // Dateien bleiben im Programmordner, nur Dienst und Autostart werden entfernt
    await powershellElevated(`& ${psQuote(bundledScript("uninstall-sensors.ps1"))}`);
    return;
  }
  await powershellElevated(`
Get-Process -Name LibreHardwareMonitor -ErrorAction SilentlyContinue | Stop-Process -Force
Unregister-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Confirm:$false -ErrorAction SilentlyContinue
`);
  await new Promise((r) => setTimeout(r, 800));
  fs.rmSync(baseDir(), { recursive: true, force: true });
}

// Beim Start von Nebula: Dienst automatisch hochfahren, falls eingerichtet
async function ensureRunning() {
  try {
    // Nur über die geplante Aufgabe starten, damit beim Programmstart keine UAC-Abfrage erscheint
    const s = await status();
    if (s.installed && s.task && !s.running) {
      // installierte Version: Aufgabe läuft als SYSTEM, Benutzer dürfen sie starten (siehe install-sensors.ps1)
      await powershell(`Start-ScheduledTask -TaskName ${psQuote(TASK_NAME)}`, 20000);
    }
  } catch {
    /* still – Nebula läuft auch ohne Sensoren */
  }
}

module.exports = { status, setup, start, remove, ensureRunning, writeConfig, findExe, powershell, powershellElevated };
