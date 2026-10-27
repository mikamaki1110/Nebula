// Sichere Brücke zwischen Oberfläche und Hauptprozess.
// Die Oberfläche bekommt NUR diese Funktionen, keinen direkten Node-Zugriff.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nebula", {
  window: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximize: () => ipcRenderer.send("window:maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
  hw: {
    static: (refresh = false) => ipcRenderer.invoke("hw:static", refresh),
    fast: () => ipcRenderer.invoke("hw:fast"),
    slow: () => ipcRenderer.invoke("hw:slow"),
    procs: () => ipcRenderer.invoke("hw:procs"),
    kill: (pids, elevated = false) => ipcRenderer.invoke("proc:kill", pids, elevated),
  },
  sensors: {
    test: () => ipcRenderer.invoke("lhm:test"),
    status: () => ipcRenderer.invoke("lhm:status"),
    setup: () => ipcRenderer.invoke("lhm:setup"),
    start: () => ipcRenderer.invoke("lhm:start"),
    remove: () => ipcRenderer.invoke("lhm:remove"),
    onProgress: (cb) => ipcRenderer.on("lhm:progress", (_e, data) => cb(data)),
  },
  report: {
    copy: () => ipcRenderer.invoke("report:copy"),
    save: () => ipcRenderer.invoke("report:save"),
  },
  debug: {
    toggleDevTools: () => ipcRenderer.send("debug:toggleDevTools"),
    metrics: () => ipcRenderer.invoke("debug:metrics"),
    getErrors: (limit) => ipcRenderer.invoke("debug:getErrors", limit),
    getDrivers: () => ipcRenderer.invoke("debug:getDrivers"),
    checkDriverUpdates: () => ipcRenderer.invoke("debug:checkDriverUpdates"),
    installDriverUpdates: () => ipcRenderer.invoke("debug:installDriverUpdates"),
    openDeviceManager: () => ipcRenderer.send("debug:openDeviceManager"),
    openWindowsUpdate: () => ipcRenderer.send("debug:openWindowsUpdate"),
  },
  store: {
    get: () => ipcRenderer.invoke("store:get"),
    saveNotes: (text) => ipcRenderer.invoke("notes:save", text),
    saveSettings: (s) => ipcRenderer.invoke("settings:save", s),
    getAutostart: () => ipcRenderer.invoke("settings:autostart"),
  },
});
