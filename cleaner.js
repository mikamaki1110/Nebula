// =====================================================================
// Speicher-Aufräumer: findet doppelte, alte und Installer-Dateien.
// Gelöscht wird NUR in den Papierkorb (wiederherstellbar), und nur
// Dateien, die ein vorheriger Scan tatsächlich gefunden hat.
// =====================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, shell } = require("electron");

const MAX_DEPTH = 10;
const MAX_FILES = 300000;
const MAX_ITEMS = 3000;
const CHUNK = 1024 * 1024;

const SKIP_DIRS = new Set([
  "node_modules", "appdata", "$recycle.bin", "system volume information", "windows",
  "program files", "program files (x86)", "programdata", "$windows.~bt", "$windows.~ws",
]);

const CATEGORY_EXT = {
  Bilder: [".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".heic", ".tif", ".tiff", ".raw", ".svg"],
  Videos: [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".webm", ".m4v"],
  Musik: [".mp3", ".flac", ".wav", ".aac", ".ogg", ".m4a"],
  Dokumente: [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt", ".odt", ".rtf", ".csv", ".md"],
  Archive: [".zip", ".rar", ".7z", ".tar", ".gz", ".iso"],
  Programme: [".exe", ".msi"],
};
const INSTALLER_EXT = new Set([".exe", ".msi"]);

function categoryOf(ext) {
  for (const [name, list] of Object.entries(CATEGORY_EXT)) if (list.includes(ext)) return name;
  return "Andere";
}

// Nur die persönlichen Ordner des Benutzers dürfen durchsucht werden
const FOLDER_KEYS = {
  downloads: "Downloads",
  documents: "Dokumente",
  desktop: "Desktop",
  pictures: "Bilder",
  videos: "Videos",
  music: "Musik",
};

function folderPath(key) {
  try { return app.getPath(key); } catch { return null; }
}

function folderList() {
  return Object.entries(FOLDER_KEYS).map(([key, label]) => ({ key, label, path: folderPath(key) })).filter((f) => f.path);
}

let scanAllowed = new Set();

async function* walkFiles(root, shouldStop) {
  const stack = [{ dir: root, depth: 0 }];
  let count = 0;
  while (stack.length) {
    if (shouldStop()) return;
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue; // kein Zugriff, überspringen
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const lower = e.name.toLowerCase();
        if (depth < MAX_DEPTH && !lower.startsWith(".") && !SKIP_DIRS.has(lower)) stack.push({ dir: full, depth: depth + 1 });
      } else if (e.isFile()) {
        if (++count > MAX_FILES) return;
        yield full;
      }
    }
    await new Promise((r) => setImmediate(r));
  }
}

// Schneller Vorab-Fingerprint: Anfang und Ende der Datei
async function quickHash(file, size) {
  const h = crypto.createHash("sha1");
  const fh = await fs.promises.open(file, "r");
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size));
    await fh.read(head, 0, head.length, 0);
    h.update(head);
    if (size > CHUNK * 2) {
      const tail = Buffer.alloc(CHUNK);
      await fh.read(tail, 0, CHUNK, size - CHUNK);
      h.update(tail);
    }
  } finally {
    await fh.close();
  }
  return h.digest("hex");
}

// Vollständiger Hash, nur für Kandidaten
async function fullHash(file) {
  const h = crypto.createHash("sha1");
  const stream = fs.createReadStream(file, { highWaterMark: CHUNK });
  for await (const chunk of stream) h.update(chunk);
  return h.digest("hex");
}

function baseItem(p, st, cat) {
  return { path: p, name: path.basename(p), dir: path.dirname(p), size: st.size, mtime: st.mtimeMs, cat };
}

async function scan(opts, progress, shouldStop) {
  const mode = opts.mode === "old" || opts.mode === "installers" ? opts.mode : "duplicates";
  const minSize = Math.max(0, Number(opts.minMB) || 1) * 1024 * 1024;
  const days = Math.max(1, Number(opts.days) || 365);
  const cutoff = Date.now() - days * 86400000;

  const wanted = new Set(opts.folders ?? []);
  const roots = folderList().filter((f) => wanted.has(f.key));

  let scanned = 0;
  const candidates = [];
  for (const root of roots) {
    for await (const p of walkFiles(root.path, shouldStop)) {
      if (shouldStop()) break;
      scanned++;
      if (scanned % 400 === 0) progress({ phase: "Dateien prüfen", scanned, folder: root.label });
      let st;
      try { st = await fs.promises.stat(p); } catch { continue; }
      if (st.size < minSize) continue;
      const ext = path.extname(p).toLowerCase();
      if (mode === "installers" && !INSTALLER_EXT.has(ext)) continue;
      if (mode === "old" && Math.max(st.atimeMs, st.mtimeMs) > cutoff) continue;
      candidates.push(baseItem(p, st, categoryOf(ext)));
    }
  }
  if (shouldStop()) return { cancelled: true, items: [], groups: [], scanned };

  let items = [];
  let groups = [];

  if (mode === "duplicates") {
    progress({ phase: "Doppelte suchen", scanned, folder: "" });
    // 1. nach Größe gruppieren, 2. Schnell-Hash, 3. vollständiger Hash
    const bySize = new Map();
    candidates.forEach((c) => {
      if (!bySize.has(c.size)) bySize.set(c.size, []);
      bySize.get(c.size).push(c);
    });
    let gid = 0;
    for (const [size, same] of bySize) {
      if (same.length < 2 || shouldStop()) continue;
      const byQuick = new Map();
      for (const c of same) {
        const q = await quickHash(c.path, size).catch(() => null);
        if (!q) continue;
        if (!byQuick.has(q)) byQuick.set(q, []);
        byQuick.get(q).push(c);
      }
      for (const cands of byQuick.values()) {
        if (cands.length < 2) continue;
        const byFull = new Map();
        for (const c of cands) {
          const f = await fullHash(c.path).catch(() => null);
          if (!f) continue;
          if (!byFull.has(f)) byFull.set(f, []);
          byFull.get(f).push(c);
        }
        for (const files of byFull.values()) {
          if (files.length < 2) continue;
          // Das älteste Exemplar bleibt erhalten
          files.sort((a, b) => a.mtime - b.mtime);
          const id = ++gid;
          const members = files.map((f, i) => ({ ...f, group: id, keep: i === 0 }));
          groups.push({ id, size, count: members.length, wasted: size * (members.length - 1), files: members });
          items.push(...members);
        }
      }
    }
    groups.sort((a, b) => b.wasted - a.wasted);
    groups = groups.slice(0, 500);
    items = groups.flatMap((g) => g.files);
  } else {
    items = candidates.sort((a, b) => b.size - a.size);
  }

  if (items.length > MAX_ITEMS) items = items.slice(0, MAX_ITEMS);
  scanAllowed = new Set(items.map((i) => i.path));
  return { cancelled: false, mode, items, groups, scanned, cutoff };
}

// Verschiebt ausgewählte Dateien in den Papierkorb (nur Dateien aus dem letzten Scan)
async function trash(paths) {
  let done = 0;
  let freed = 0;
  const failed = [];
  for (const p of paths) {
    if (!scanAllowed.has(p)) {
      failed.push({ path: p, error: "Nicht aus dem letzten Scan" });
      continue;
    }
    try {
      const st = await fs.promises.stat(p);
      await shell.trashItem(p);
      scanAllowed.delete(p);
      done++;
      freed += st.size;
    } catch (err) {
      failed.push({ path: p, error: err.message });
    }
  }
  return { done, freed, failed };
}

module.exports = { scan, trash, folderList, categoryOf };
