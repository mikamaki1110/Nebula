// =====================================================================
// Nebula – Updates mit Knopf (ab 1.7)
// Prüft GitHub Releases, zeigt in der App einen Update-Knopf, lädt erst nach
// Klick herunter und installiert nach Klick (oder automatisch beim Beenden).
// =====================================================================
const { app, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");

const FIRST_CHECK_MS = 8000;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

let autoUpdater = null;
let getWindow = () => null;
let log = () => {};
let beforeInstall = () => {};
let state = {
  phase: "idle", // idle | checking | available | downloading | ready | uptodate | error | unsupported
  current: app.getVersion(),
  version: null,
  notes: null,
  percent: 0,
  error: null,
  portable: Boolean(process.env.PORTABLE_EXECUTABLE_DIR),
  checkedAt: null,
};

function send() {
  const w = getWindow();
  if (w && !w.isDestroyed()) w.webContents.send("update:state", state);
}

function set(patch) {
  state = { ...state, ...patch };
  send();
}

// Release-Seite aus der vom Installer mitgelieferten app-update.yml (für die portable Version)
function releasesUrl() {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = /owner:\s*["']?([\w.-]+)/.exec(yml)?.[1];
    const repo = /repo:\s*["']?([\w.-]+)/.exec(yml)?.[1];
    if (owner && repo) return `https://github.com/${owner}/${repo}/releases/latest`;
  } catch { /* nicht vorhanden */ }
  return null;
}

function plainNotes(notes) {
  if (!notes) return null;
  const text = Array.isArray(notes) ? notes.map((n) => n.note ?? "").join("\n") : String(notes);
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500) || null;
}

function friendly(err) {
  const msg = String(err?.message ?? err);
  if (/ERR_INTERNET_DISCONNECTED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET/i.test(msg)) return "Keine Verbindung zum Update-Server. Bist du online?";
  if (/app-update\.yml|ENOENT/i.test(msg)) return state.portable
    ? "Die portable Version kann nicht automatisch prüfen. Neue Versionen gibt es auf der Download-Seite."
    : "Diese Installation enthält keine Update-Informationen.";
  if (/404|latest\.yml/i.test(msg)) return "Auf dem Update-Server wurde keine passende Version gefunden.";
  if (/signature|sha512|checksum/i.test(msg)) return "Das heruntergeladene Update war beschädigt und wurde verworfen. Bitte erneut versuchen.";
  return msg.split("\n")[0].slice(0, 200);
}

async function check() {
  if (!autoUpdater || state.phase === "downloading" || state.phase === "ready") return state;
  try {
    await autoUpdater.checkForUpdates();
  } catch { /* wird über das "error"-Ereignis gemeldet */ }
  return state;
}

async function download() {
  if (state.phase !== "available" && state.phase !== "error") return state;
  if (state.portable) {
    const url = releasesUrl();
    if (url) await shell.openExternal(url);
    return state;
  }
  set({ phase: "downloading", percent: 0, error: null });
  try {
    await autoUpdater.downloadUpdate();
  } catch { /* wird über das "error"-Ereignis gemeldet */ }
  return state;
}

function install() {
  if (state.phase !== "ready") return false;
  log("info", "Update", `Installiere Version ${state.version} und starte neu`);
  beforeInstall();
  // isSilent=false: Windows zeigt bei Bedarf die Administrator-Abfrage; isForceRunAfter=true: danach neu starten
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

function registerIpc() {
  ipcMain.handle("update:get", () => state);
  ipcMain.handle("update:check", () => check());
  ipcMain.handle("update:download", () => download());
  ipcMain.handle("update:install", () => install());
}

function init(opts) {
  getWindow = opts.getWindow ?? getWindow;
  log = opts.log ?? log;
  beforeInstall = opts.beforeInstall ?? beforeInstall;
  registerIpc();

  if (!app.isPackaged) {
    state.phase = "unsupported";
    state.error = "Entwicklungsversion – Updates gibt es nur in der installierten App.";
    return;
  }
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch {
    state.phase = "unsupported";
    state.error = "Das Update-Modul fehlt.";
    return;
  }

  autoUpdater.autoDownload = false;        // erst nach Klick auf den Update-Knopf
  autoUpdater.autoInstallOnAppQuit = true; // fertig geladene Updates notfalls beim Beenden installieren

  autoUpdater.on("checking-for-update", () => set({ phase: "checking", error: null }));
  autoUpdater.on("update-available", (info) => {
    set({ phase: "available", version: info.version, notes: plainNotes(info.releaseNotes), checkedAt: Date.now() });
    log("info", "Update", `Version ${info.version} verfügbar`);
  });
  autoUpdater.on("update-not-available", () => set({ phase: "uptodate", checkedAt: Date.now() }));
  autoUpdater.on("download-progress", (p) => set({ phase: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (info) => {
    set({ phase: "ready", version: info.version, percent: 100 });
    log("info", "Update", `Version ${info.version} heruntergeladen`);
  });
  autoUpdater.on("error", (err) => {
    // Ein Fehler beim Prüfen soll einen bereits fertigen Download nicht verdecken
    if (state.phase === "ready") return;
    set({ phase: "error", error: friendly(err) });
    log("warn", "Update", String(err?.message ?? err));
  });

  setTimeout(check, FIRST_CHECK_MS);
  setInterval(check, CHECK_EVERY_MS);
}

module.exports = { init, check };
