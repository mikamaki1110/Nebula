import { shell } from 'electron'
import { basename } from 'path'
import { z } from 'zod'
import type { CapId, CapIn, CapOut, MoveRecord, RiskLevel, WindowsPage } from '@shared/types'
import { listAutostart, setAutostart } from '../services/autostart'
import { setTurbo, turboStatus } from '../services/ollamaTurbo'
import * as files from '../services/files'
import { listSnapshots, optimizeCached, optimizeReport, takeSnapshot } from '../services/optimize'
import { assertProgramId, findLeftovers, listPrograms, uninstallProgram } from '../services/programs'
import { diagnoseNetwork, driverProblems, flushDns, recentErrors, runDism, runSfc } from '../services/repair'
import { pendingUpdates, securityCached, securityReport, startQuickScan } from '../services/security'
import { cleanTemp, duplicates, emptyRecycleBin, largeFiles, storageOverview } from '../services/storage'
import { getLiveMetrics, getStaticInfo, killProcess, listProcesses } from '../services/system'

export interface UndoSpec { capId: string; input: unknown; summary: string }

export interface Capability<I = unknown, O = unknown> {
  id: string
  title: string
  /** Beschreibung für die KI – wann und wofür die Fähigkeit gedacht ist. */
  description: string
  risk: RiskLevel
  requiresAdmin: boolean
  input: z.ZodType<I, z.ZodTypeDef, unknown>
  exposeToAgent?: boolean
  internal?: boolean
  confirm?: (i: I) => Promise<{ title: string; details: string[]; confirmLabel: string }> | { title: string; details: string[]; confirmLabel: string }
  run: (i: I) => Promise<O>
  /** Zusammenfassung für Verlauf/Protokoll und optional ein Rückgängig-Schritt. */
  record?: (i: I, out: O) => { summary: string; undo?: UndoSpec }
}

function cap<K extends CapId>(def: Omit<Capability<CapIn<K>, CapOut<K>>, 'id' | 'requiresAdmin'> & { id: K; requiresAdmin?: boolean }): Capability {
  return { requiresAdmin: false, ...def } as unknown as Capability
}

const empty = z.object({}).strict()
const absPath = z.string().min(3).max(1000)
const paths = z.array(absPath).min(1).max(500)
const listLine = (ps: string[], max = 8): string[] =>
  ps.length <= max ? ps : [...ps.slice(0, max), `… und ${ps.length - max} weitere`]
const GB = 1024 ** 3
const fmt = (b: number): string => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / 1024 / 1024)} MB`)

const WINDOWS_PAGES: Record<WindowsPage, string> = {
  windowsSecurity: 'windowsdefender:',
  windowsUpdate: 'ms-settings:windowsupdate',
  firewall: 'windowsdefender://network',
  storageSense: 'ms-settings:storagesense',
  apps: 'ms-settings:appsfeatures'
}

export const CAPABILITIES: Capability[] = [
  // ── System ────────────────────────────────────────────────
  cap({ id: 'system.static', title: 'Systeminformationen lesen', risk: 'read', input: empty,
    description: 'Betriebssystem, Build, Gerätemodell, Prozessor, Laufzeit seit dem letzten Start.',
    run: getStaticInfo }),
  cap({ id: 'system.live', title: 'Live-Werte lesen', risk: 'read', input: empty,
    description: 'Aktuelle Auslastung: CPU (gesamt/je Kern, Temperatur), RAM, GPU, Laufwerke mit Belegung, Netzwerkdurchsatz, Akku, aktivste Prozesse.',
    run: getLiveMetrics }),
  cap({ id: 'system.processes', title: 'Prozesse auflisten', risk: 'read',
    input: z.object({ sortBy: z.enum(['cpu', 'memory']).optional(), limit: z.number().int().min(1).max(200).optional(), query: z.string().max(100).optional() }),
    description: 'Laufende Prozesse mit CPU, Arbeitsspeicher und Pfad, sortierbar nach cpu oder memory, optional gefiltert.',
    run: (i) => listProcesses(i.sortBy, i.limit, i.query) }),
  cap({ id: 'system.openWindowsPage', title: 'Windows-Einstellungen öffnen', risk: 'read',
    input: z.object({ target: z.enum(['windowsSecurity', 'windowsUpdate', 'firewall', 'storageSense', 'apps']) }),
    description: 'Öffnet eine Windows-Einstellungsseite für den Benutzer (Windows-Sicherheit, Windows Update, Firewall, Speicheroptimierung, Apps).',
    run: async (i) => { await shell.openExternal(WINDOWS_PAGES[i.target]); return { opened: true } } }),
  cap({ id: 'process.kill', title: 'Prozess beenden', risk: 'modify',
    input: z.object({ pid: z.number().int().positive(), name: z.string().min(1).max(260) }),
    description: 'Beendet einen Prozess. Ungespeicherte Daten darin gehen verloren. Windows-Kernprozesse werden verweigert.',
    confirm: (i) => ({ title: `${i.name} beenden?`, details: [`Prozess-ID ${i.pid}`, 'Ungespeicherte Daten in diesem Programm gehen verloren.'], confirmLabel: 'Prozess beenden' }),
    run: (i) => killProcess(i.pid, i.name),
    record: (i) => ({ summary: `Prozess ${i.name} (PID ${i.pid}) beendet` }) }),

  // ── Speicher ──────────────────────────────────────────────
  cap({ id: 'storage.overview', title: 'Speicherübersicht', risk: 'read', input: empty,
    description: 'Größe der temporären Ordner und des Papierkorbs.',
    run: () => storageOverview() }),
  cap({ id: 'storage.largeFiles', title: 'Große Dateien suchen', risk: 'read',
    input: z.object({ root: absPath, minSizeMB: z.number().min(1).max(1_000_000).optional(), olderThanDays: z.number().int().min(1).max(10_000).optional(), limit: z.number().int().min(1).max(500).optional() }),
    description: 'Findet die größten Dateien unter einem Ordner oder Laufwerk (z. B. "C:\\\\" oder der Benutzerordner). Optional nur Dateien, die älter als X Tage sind.',
    run: (i) => largeFiles(i.root, i.minSizeMB, i.olderThanDays, i.limit) }),
  cap({ id: 'storage.duplicates', title: 'Doppelte Dateien suchen', risk: 'read',
    input: z.object({ root: absPath, minSizeMB: z.number().min(0.01).max(100_000).optional() }),
    description: 'Findet inhaltlich identische Dateien (per SHA-256) unter einem Ordner.',
    run: (i) => duplicates(i.root, i.minSizeMB) }),
  cap({ id: 'storage.cleanTemp', title: 'Temporäre Dateien bereinigen', risk: 'modify', input: empty,
    description: 'Löscht temporäre Dateien, die älter als 24 Stunden sind. Gesperrte Dateien werden übersprungen.',
    confirm: async () => {
      const o = await storageOverview()
      return { title: 'Temporäre Dateien bereinigen?', confirmLabel: 'Bereinigen',
        details: [...o.temp.filter((t) => t.accessible).map((t) => `${t.label}: ${fmt(t.bytes)}`),
          'Nur Dateien älter als 24 Stunden. Sie werden endgültig gelöscht, nicht in den Papierkorb.'] }
    },
    run: cleanTemp,
    record: (_i, o) => ({ summary: `Temporäre Dateien bereinigt: ${fmt(o.freedBytes)} freigegeben` }) }),
  cap({ id: 'storage.emptyRecycleBin', title: 'Papierkorb leeren', risk: 'critical', input: empty,
    description: 'Leert den Papierkorb endgültig. Danach sind die Dateien nicht wiederherstellbar.',
    confirm: async () => {
      const o = await storageOverview()
      return { title: 'Papierkorb endgültig leeren?', confirmLabel: 'Endgültig leeren',
        details: [o.recycleBin ? `${o.recycleBin.items} Elemente, ${fmt(o.recycleBin.bytes)}` : 'Größe unbekannt', 'Das kann nicht rückgängig gemacht werden.'] }
    },
    run: emptyRecycleBin,
    record: (_i, o) => ({ summary: `Papierkorb geleert (${fmt(o.freedBytes)})` }) }),

  // ── Dateien ───────────────────────────────────────────────
  cap({ id: 'files.list', title: 'Ordnerinhalt anzeigen', risk: 'read', input: z.object({ dir: absPath }),
    description: 'Listet Dateien und Unterordner eines Ordners.', run: (i) => files.listDir(i.dir) }),
  cap({ id: 'files.search', title: 'Dateien suchen', risk: 'read',
    input: z.object({ root: absPath, query: z.string().min(1).max(200), limit: z.number().int().min(1).max(1000).optional() }),
    description: 'Sucht Dateien und Ordner nach Namen unter einem Startordner. Platzhalter * und ? erlaubt, z. B. "*.pdf".',
    run: (i) => files.searchFiles(i.root, i.query, i.limit) }),
  cap({ id: 'files.trash', title: 'In den Papierkorb verschieben', risk: 'modify', input: z.object({ paths }),
    description: 'Verschiebt Dateien oder Ordner in den Windows-Papierkorb (dort wiederherstellbar). Geschützte Systemordner werden verweigert.',
    confirm: (i) => ({ title: `${i.paths.length === 1 ? '1 Element' : `${i.paths.length} Elemente`} in den Papierkorb verschieben?`,
      details: [...listLine(i.paths), 'Wiederherstellbar über den Papierkorb.'], confirmLabel: 'In den Papierkorb' }),
    run: (i) => files.trashPaths(i.paths),
    record: (i, o) => ({ summary: `${o.trashed} von ${i.paths.length} Elementen in den Papierkorb verschoben` }) }),
  cap({ id: 'files.move', title: 'Dateien verschieben', risk: 'modify', input: z.object({ paths, targetDir: absPath }),
    description: 'Verschiebt Dateien oder Ordner in einen Zielordner (wird bei Bedarf angelegt). Namenskonflikte werden durch (2), (3) … gelöst.',
    confirm: (i) => ({ title: `${i.paths.length} Element(e) nach ${basename(i.targetDir) || i.targetDir} verschieben?`, details: [...listLine(i.paths), `Ziel: ${i.targetDir}`], confirmLabel: 'Verschieben' }),
    run: (i) => files.movePaths(i.paths, i.targetDir),
    record: (i, o) => ({ summary: `${o.moved.length} Element(e) nach ${i.targetDir} verschoben`,
      undo: o.moved.length ? { capId: 'files.restoreMoves', input: { moves: o.moved }, summary: 'Verschiebung rückgängig machen' } : undefined }) }),
  cap({ id: 'files.rename', title: 'Umbenennen', risk: 'modify', input: z.object({ path: absPath, newName: z.string().min(1).max(200) }),
    description: 'Benennt eine Datei oder einen Ordner um (nur der Name, kein Pfad).',
    confirm: (i) => ({ title: 'Umbenennen?', details: [`${basename(i.path)} → ${i.newName}`, i.path], confirmLabel: 'Umbenennen' }),
    run: (i) => files.renamePath(i.path, i.newName),
    record: (_i, o) => ({ summary: `${basename(o.from)} in ${basename(o.to)} umbenannt`,
      undo: { capId: 'files.restoreMoves', input: { moves: [o] }, summary: 'Umbenennung rückgängig machen' } }) }),
  cap({ id: 'files.mkdir', title: 'Ordner erstellen', risk: 'modify', input: z.object({ parent: absPath, name: z.string().min(1).max(200) }),
    description: 'Erstellt einen neuen Ordner.',
    confirm: (i) => ({ title: `Ordner „${i.name}“ erstellen?`, details: [`In: ${i.parent}`], confirmLabel: 'Erstellen' }),
    run: (i) => files.makeDir(i.parent, i.name),
    record: (_i, o) => ({ summary: `Ordner ${o.path} erstellt` }) }),
  cap({ id: 'files.organizePlan', title: 'Sortierplan erstellen', risk: 'read', input: z.object({ dir: absPath }),
    description: 'Zeigt, wie lose Dateien eines Ordners in Unterordner nach Typ (Bilder, Dokumente, Videos, Musik, Archive, Installationsprogramme, Code, Sonstiges) einsortiert würden. Ändert nichts.',
    run: (i) => files.organizePlan(i.dir) }),
  cap({ id: 'files.organizeApply', title: 'Ordner sortieren', risk: 'modify', input: z.object({ dir: absPath }),
    description: 'Sortiert lose Dateien eines Ordners in Unterordner nach Typ. Rückgängig machbar. Vorher files.organizePlan zeigen.',
    confirm: async (i) => {
      const plan = await files.organizePlan(i.dir)
      const counts = Object.entries(plan.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category ?? '?']: (m[p.category ?? '?'] ?? 0) + 1 }), {}))
      return { title: `${plan.length} Dateien in ${basename(i.dir)} sortieren?`, confirmLabel: 'Sortieren',
        details: [...counts.map(([c, n]) => `${c}: ${n}`), 'Über den Verlauf rückgängig machbar.'] }
    },
    run: (i) => files.organizeApply(i.dir),
    record: (i, o) => ({ summary: `${o.moved.length} Dateien in ${i.dir} nach Typ sortiert`,
      undo: o.moved.length ? { capId: 'files.restoreMoves', input: { moves: o.moved }, summary: 'Sortierung rückgängig machen' } : undefined }) }),

  // ── Programme ─────────────────────────────────────────────
  cap({ id: 'programs.list', title: 'Installierte Programme', risk: 'read', input: z.object({ query: z.string().max(100).optional() }),
    description: 'Listet installierte Desktop-Programme (Name, Version, Hersteller, Größe). Optional gefiltert. Die id wird zum Deinstallieren gebraucht.',
    run: (i) => listPrograms(i.query) }),
  cap({ id: 'programs.uninstall', title: 'Programm deinstallieren', risk: 'critical',
    input: z.object({ id: z.string().min(10).max(500).refine((v) => { try { assertProgramId(v); return true } catch { return false } }, 'Ungültige Programmkennung') }),
    description: 'Startet den offiziellen Deinstaller des Programms. Der Hersteller-Dialog erscheint und muss ggf. vom Benutzer durchgeklickt werden. Danach programs.leftovers für Reste.',
    confirm: async (i) => {
      const p = (await listPrograms()).find((x) => x.id === i.id)
      return { title: `${p?.name ?? 'Programm'} deinstallieren?`, confirmLabel: 'Deinstallieren',
        details: [p?.publisher ? `Hersteller: ${p.publisher}` : '', p?.version ? `Version: ${p.version}` : '',
          'Der Deinstaller des Herstellers wird gestartet. Folge dessen Anweisungen.', 'Danach sucht ATLAS nach Resten.'].filter(Boolean) }
    },
    run: (i) => uninstallProgram(i.id),
    record: (i, o) => ({ summary: `Deinstallation gestartet (${i.id.split('\\').pop()}) – ${o.stillInstalled ? 'Programm noch vorhanden' : 'entfernt'}` }) }),
  cap({ id: 'programs.leftovers', title: 'Programmreste suchen', risk: 'read',
    input: z.object({ name: z.string().min(2).max(200), publisher: z.string().max(200).optional(), installLocation: z.string().max(1000).optional() }),
    description: 'Sucht nach einer Deinstallation übrig gebliebene Ordner in AppData, ProgramData und Program Files. Entfernen dann mit files.trash.',
    run: (i) => findLeftovers(i.name, i.publisher, i.installLocation) }),
  cap({ id: 'autostart.list', title: 'Autostart-Einträge', risk: 'read', input: empty,
    description: 'Alle Autostart-Einträge (Registrierung und Autostart-Ordner) mit Status, Signatur und Auffälligkeiten.',
    run: () => listAutostart() }),
  cap({ id: 'autostart.set', title: 'Autostart ändern', risk: 'modify',
    input: z.object({ hive: z.enum(['HKCU:', 'HKLM:']), approvedKey: z.enum(['Run', 'Run32', 'StartupFolder']), name: z.string().min(1).max(260), enable: z.boolean() }),
    description: 'Aktiviert oder deaktiviert einen Autostart-Eintrag wie der Task-Manager. Der Eintrag bleibt erhalten, voll umkehrbar. Werte aus autostart.list übernehmen.',
    confirm: (i) => ({ title: `Autostart von „${i.name}“ ${i.enable ? 'aktivieren' : 'deaktivieren'}?`, confirmLabel: i.enable ? 'Aktivieren' : 'Deaktivieren',
      details: [i.hive === 'HKLM:' ? 'Gilt für alle Benutzer – Windows fragt nach Administratorrechten.' : 'Gilt für dein Benutzerkonto.', 'Jederzeit umkehrbar.'] }),
    run: (i) => setAutostart(i.hive, i.approvedKey, i.name, i.enable),
    record: (i) => ({ summary: `Autostart von ${i.name} ${i.enable ? 'aktiviert' : 'deaktiviert'}`,
      undo: { capId: 'autostart.set', input: { ...i, enable: !i.enable }, summary: `Autostart von ${i.name} wieder ${i.enable ? 'deaktivieren' : 'aktivieren'}` } }) }),

  // ── Sicherheit ────────────────────────────────────────────
  cap({ id: 'security.report', title: 'Sicherheitsprüfung', risk: 'read', input: z.object({ refresh: z.boolean().optional() }),
    description: 'Prüft Defender, Firewall, UAC, letzte Updates, verdächtige Autostart-Einträge und ungewöhnliche Prozesse. Liefert nach Priorität sortierte Befunde.',
    run: (i) => securityReport(i.refresh) }),
  cap({ id: 'security.cached', title: 'Letzte Sicherheitsprüfung', risk: 'read', input: empty,
    description: 'Der zuletzt gespeicherte Sicherheitsbericht, sofort verfügbar (kann älter sein). Für aktuelle Werte security.report nutzen.',
    exposeToAgent: false, run: async () => securityCached() }),
  cap({ id: 'security.pendingUpdates', title: 'Ausstehende Updates', risk: 'read', input: empty,
    description: 'Fragt Windows Update nach ausstehenden Updates. Kann 1–3 Minuten dauern.', run: pendingUpdates }),
  cap({ id: 'security.quickScan', title: 'Defender-Schnellscan', risk: 'modify', input: empty,
    description: 'Startet einen Microsoft-Defender-Schnellscan im Hintergrund.',
    confirm: () => ({ title: 'Defender-Schnellscan starten?', details: ['Läuft im Hintergrund, dauert meist 5–15 Minuten.', 'Der PC kann währenddessen etwas langsamer sein.'], confirmLabel: 'Scan starten' }),
    run: startQuickScan, record: () => ({ summary: 'Defender-Schnellscan gestartet' }) }),

  // ── Reparatur ─────────────────────────────────────────────
  cap({ id: 'repair.sfc', title: 'Systemdateien prüfen (SFC)', risk: 'modify', requiresAdmin: true,
    input: z.object({ mode: z.enum(['verify', 'repair']) }),
    description: 'SFC prüft Windows-Systemdateien. mode "verify" nur prüfen, "repair" prüfen und reparieren. Braucht Adminrechte, dauert 5–20 Minuten.',
    confirm: (i) => ({ title: i.mode === 'verify' ? 'Systemdateien prüfen?' : 'Systemdateien prüfen und reparieren?', confirmLabel: 'Starten',
      details: ['Windows fragt nach Administratorrechten.', 'Dauert 5–20 Minuten.', i.mode === 'repair' ? 'Beschädigte Dateien werden durch Originale von Microsoft ersetzt.' : 'Es wird nichts verändert.'] }),
    run: (i) => runSfc(i.mode), record: (i, o) => ({ summary: `SFC (${i.mode}): ${o.summary}` }) }),
  cap({ id: 'repair.dism', title: 'Windows-Abbild prüfen (DISM)', risk: 'modify', requiresAdmin: true,
    input: z.object({ mode: z.enum(['check', 'scan', 'restore']) }),
    description: 'DISM prüft/repariert den Windows-Komponentenspeicher. check = schnell, scan = gründlich (≈10 min), restore = reparieren (bis 30 min, braucht Internet).',
    confirm: (i) => ({ title: `DISM: ${({ check: 'Schnellprüfung', scan: 'Gründliche Prüfung', restore: 'Abbild wiederherstellen' })[i.mode]}?`, confirmLabel: 'Starten',
      details: ['Windows fragt nach Administratorrechten.', i.mode === 'restore' ? 'Lädt bei Bedarf Originaldateien von Windows Update. Bis zu 30 Minuten.' : 'Es wird nichts verändert.'] }),
    run: (i) => runDism(i.mode), record: (i, o) => ({ summary: `DISM (${i.mode}): ${o.summary}` }) }),
  cap({ id: 'repair.network', title: 'Netzwerkdiagnose', risk: 'read', input: empty,
    description: 'Prüft Adapter, IP-Konfiguration, Router, Internet und DNS und benennt die wahrscheinliche Ursache.', run: diagnoseNetwork }),
  cap({ id: 'repair.flushDns', title: 'DNS-Cache leeren', risk: 'modify', input: empty,
    description: 'Leert den DNS-Zwischenspeicher. Harmlos, hilft bei Problemen mit der Namensauflösung.',
    confirm: () => ({ title: 'DNS-Cache leeren?', details: ['Harmlos. Adressen werden danach neu abgefragt.'], confirmLabel: 'Leeren' }),
    run: flushDns, record: () => ({ summary: 'DNS-Cache geleert' }) }),
  cap({ id: 'repair.drivers', title: 'Treiberprobleme', risk: 'read', input: empty,
    description: 'Listet Geräte mit Treiberproblemen samt verständlicher Erklärung des Fehlercodes.', run: driverProblems }),
  cap({ id: 'repair.events', title: 'Windows-Fehlerprotokoll', risk: 'read', input: z.object({ days: z.number().int().min(1).max(30).optional() }),
    description: 'Fasst kritische Ereignisse und Fehler aus dem System- und Anwendungsprotokoll der letzten Tage gruppiert zusammen.',
    run: (i) => recentErrors(i.days) }),

  // ── Lokale KI ─────────────────────────────────────────────
  cap({ id: 'ollama.turboStatus', title: 'Ollama-Turbo: Status', risk: 'read', input: empty,
    description: 'Ob der Turbo-Modus (Flash Attention, komprimierter Zwischenspeicher) für Ollama eingeschaltet ist.',
    exposeToAgent: false, run: turboStatus }),
  cap({ id: 'ollama.turbo', title: 'Ollama-Turbo', risk: 'modify', input: z.object({ enable: z.boolean() }),
    description: 'Schaltet den Turbo-Modus für Ollama ein oder aus und startet Ollama neu.',
    exposeToAgent: false,
    confirm: (i) => ({
      title: i.enable ? 'Turbo-Modus für Ollama einschalten?' : 'Turbo-Modus für Ollama ausschalten?',
      confirmLabel: i.enable ? 'Einschalten und Ollama neu starten' : 'Ausschalten und Ollama neu starten',
      details: [
        i.enable ? 'Setzt für dein Benutzerkonto OLLAMA_FLASH_ATTENTION=1 und OLLAMA_KV_CACHE_TYPE=q8_0.' : 'Entfernt diese beiden Umgebungsvariablen wieder.',
        i.enable ? 'Das halbiert den Grafikspeicher, den der Gesprächsverlauf braucht – die KI passt öfter komplett auf die Grafikkarte.' : 'Ollama arbeitet danach wieder mit den Standardwerten.',
        'Ollama wird dazu kurz beendet und neu gestartet. Läuft gerade etwas anderes mit Ollama, bricht es ab.',
        'Jederzeit umkehrbar (Verlauf).'
      ]
    }),
    run: (i) => setTurbo(i.enable),
    record: (i, o) => ({ summary: `Ollama-Turbo ${i.enable ? 'eingeschaltet' : 'ausgeschaltet'}${o.restarted ? ' (Ollama neu gestartet)' : ''}`,
      undo: { capId: 'ollama.turbo', input: { enable: !i.enable }, summary: `Ollama-Turbo wieder ${i.enable ? 'ausschalten' : 'einschalten'}` } }) }),

  // ── Optimierung ───────────────────────────────────────────
  cap({ id: 'optimize.report', title: 'Optimierungsanalyse', risk: 'read', input: empty,
    description: 'Analysiert Autostart, Ressourcenfresser, Speicherplatz, Laufzeit und Energieplan und gibt priorisierte Vorschläge.', run: optimizeReport }),
  cap({ id: 'optimize.cached', title: 'Letzte Optimierungsanalyse', risk: 'read', input: empty,
    description: 'Die zuletzt gespeicherte Optimierungsanalyse, sofort verfügbar.',
    exposeToAgent: false, run: async () => optimizeCached() }),
  cap({ id: 'optimize.snapshot', title: 'Messpunkt speichern', risk: 'read', input: z.object({ label: z.string().max(80).optional() }),
    description: 'Speichert einen Messpunkt (RAM, freier Platz, Autostart-Anzahl, Prozesse, Temp-Größe) für Vorher-Nachher-Vergleiche.',
    run: (i) => takeSnapshot(i.label) }),
  cap({ id: 'optimize.snapshots', title: 'Messpunkte', risk: 'read', input: empty,
    description: 'Gespeicherte Messpunkte, neueste zuerst.', run: async () => listSnapshots() })
]

/** Nur intern (z. B. für Rückgängig) – weder für die Oberfläche noch für die KI direkt aufrufbar. */
export const INTERNAL: Capability[] = [
  {
    id: 'files.restoreMoves', title: 'Verschiebung rückgängig machen', risk: 'modify', requiresAdmin: false, internal: true, exposeToAgent: false,
    description: '', input: z.object({ moves: z.array(z.object({ from: absPath, to: absPath, category: z.string().optional() })).min(1) }) as z.ZodType<{ moves: MoveRecord[] }, z.ZodTypeDef, unknown>,
    confirm: (i: { moves: MoveRecord[] }) => ({ title: `${i.moves.length} Element(e) an den ursprünglichen Ort zurückverschieben?`,
      details: listLine(i.moves.map((m) => `${basename(m.to)} → ${m.from}`)), confirmLabel: 'Rückgängig machen' }),
    run: (i: { moves: MoveRecord[] }) => files.restoreMoves(i.moves),
    record: (_i: { moves: MoveRecord[] }, o: { restored: number }) => ({ summary: `${o.restored} Element(e) zurückverschoben` })
  } as Capability
]

const REGISTRY = new Map<string, Capability>([...CAPABILITIES, ...INTERNAL].map((c) => [c.id, c]))
export const getCapability = (id: string): Capability | undefined => REGISTRY.get(id)
