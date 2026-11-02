import { execFile } from 'child_process'
import { uptime } from 'os'
import type { Finding, OptimizeReport, Snapshot } from '@shared/types'
import { all, run } from '../core/db'
import { log } from '../core/log'
import { loadJson, saveJson } from '../core/store'
import { listAutostart } from './autostart'
import { storageOverview } from './storage'
import { getLiveMetrics, readProcesses } from './system'

const GB = 1024 ** 3

const REPORT_KEY = 'optimize-report'

/** Der zuletzt gespeicherte Bericht – erscheint beim Start sofort. */
export function optimizeCached(): OptimizeReport | null {
  return loadJson<OptimizeReport>(REPORT_KEY)
}

/** Aktiver Energieplan – direkt über powercfg, ohne PowerShell-Start. */
function activePowerPlan(): Promise<string | null> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null)
    execFile('powercfg', ['/getactivescheme'], { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : /\(([^)]+)\)/.exec(stdout)?.[1] ?? null)
    })
  })
}

const settled = <T>(p: Promise<T>, what: string, fallback: T): Promise<T> =>
  p.catch((e: unknown) => { log('warn', 'Optimierung', `${what} nicht lesbar – ${e instanceof Error ? e.message : String(e)}`); return fallback })

export async function optimizeReport(): Promise<OptimizeReport> {
  const started = Date.now()
  // Alles gleichzeitig, jedes für sich abgesichert; Autostart ohne die langsame Signaturprüfung.
  const [live, autostart, storage, power] = await Promise.all([
    getLiveMetrics(),
    settled(listAutostart({ signatures: false }), 'Autostart', []),
    settled(storageOverview({ quick: true }), 'Speicher', null),
    activePowerPlan()
  ])
  const uptimeDays = uptime() / 86400
  const s: Finding[] = []

  const enabled = autostart.filter((a) => a.enabled)
  if (enabled.length > 8) {
    s.push({ id: 'autostart-many', severity: 'medium', title: `${enabled.length} Programme starten mit Windows`,
      explanation: 'Jedes Autostart-Programm verlängert den Systemstart und belegt im Hintergrund Arbeitsspeicher.',
      recommendation: 'Deaktiviere den Autostart von Programmen, die du nicht sofort nach dem Anmelden brauchst. Das ist jederzeit umkehrbar.',
      action: { kind: 'page', page: 'programs', label: 'Autostart ansehen' } })
  }
  const orphaned = autostart.filter((a) => a.enabled && a.signature === 'Missing')
  if (orphaned.length > 0) {
    s.push({ id: 'autostart-orphans', severity: 'low', title: `${orphaned.length} verwaiste Autostart-Einträge`,
      explanation: `Diese Einträge zeigen auf Dateien, die es nicht mehr gibt: ${orphaned.map((o) => o.name).join(', ')}.`,
      recommendation: 'Gefahrlos deaktivieren.', action: { kind: 'page', page: 'programs', label: 'Autostart ansehen' } })
  }

  const memPct = (live.memory.used / live.memory.total) * 100
  if (memPct > 85) {
    const { rows } = await readProcesses()
    const top = [...rows].sort((a, b) => b.memBytes - a.memBytes).slice(0, 3)
    s.push({ id: 'ram-high', severity: 'medium', title: `Arbeitsspeicher zu ${Math.round(memPct)} % belegt`,
      explanation: `Die größten Verbraucher: ${top.map((p) => `${p.name} (${(p.memBytes / GB).toFixed(1)} GB)`).join(', ')}. Wird der Speicher knapp, lagert Windows auf die Festplatte aus und alles wird träge.`,
      recommendation: 'Schließe Programme, die du gerade nicht brauchst – besonders Browser mit vielen Tabs.',
      action: { kind: 'page', page: 'monitor', label: 'Prozesse ansehen' } })
  }

  const busy = (await readProcesses()).rows.filter((p) => p.cpu > 25 && !/^(system|idle|system idle process)$/i.test(p.name))
  for (const p of busy.slice(0, 2)) {
    s.push({ id: `cpu-${p.pid}`, severity: 'low', title: `${p.name} belastet den Prozessor (${Math.round(p.cpu)} %)`,
      explanation: 'Ein einzelnes Programm beansprucht gerade viel Rechenleistung.',
      recommendation: 'Wenn das unerwartet ist: Programm schließen oder neu starten.', action: { kind: 'page', page: 'monitor', label: 'Prozesse ansehen' } })
  }

  for (const d of live.disks) {
    const free = d.size - d.used
    if (free / d.size < 0.1) {
      s.push({ id: `disk-${d.mount}`, severity: free < 5 * GB ? 'high' : 'medium', title: `Laufwerk ${d.mount} ist fast voll`,
        explanation: `Nur noch ${(free / GB).toFixed(1)} GB frei. Windows braucht freien Platz für Updates und Auslagerung.`,
        recommendation: 'Große Dateien und Duplikate suchen, temporäre Dateien bereinigen.', action: { kind: 'page', page: 'storage', label: 'Speicher analysieren' } })
    }
  }

  const tempBytes = storage?.temp.reduce((n, t) => n + t.bytes, 0) ?? 0
  if (tempBytes > 1 * GB) {
    s.push({ id: 'temp', severity: 'low', title: `${(tempBytes / GB).toFixed(1)} GB temporäre Dateien`,
      explanation: 'Programme legen hier Zwischendateien ab und räumen sie oft nicht weg.',
      recommendation: 'Temporäre Dateien bereinigen (nur Dateien älter als 24 Stunden).',
      action: { kind: 'cap', capId: 'storage.cleanTemp', input: {}, label: 'Jetzt bereinigen' } })
  }
  if ((storage?.recycleBin?.bytes ?? 0) > 2 * GB) {
    s.push({ id: 'recycle', severity: 'low', title: `Papierkorb enthält ${((storage?.recycleBin?.bytes ?? 0) / GB).toFixed(1)} GB`,
      explanation: 'Gelöschte Dateien belegen weiter Platz, bis der Papierkorb geleert wird.',
      recommendation: 'Papierkorb prüfen und leeren.', action: { kind: 'page', page: 'storage', label: 'Zum Speicher' } })
  }
  if (uptimeDays > 7) {
    s.push({ id: 'uptime', severity: 'low', title: `Seit ${Math.floor(uptimeDays)} Tagen nicht neu gestartet`,
      explanation: 'Ein Neustart beendet hängende Hintergrundprozesse und schließt ausstehende Updates ab. „Herunterfahren“ zählt bei aktivem Schnellstart nicht als Neustart.',
      recommendation: 'Starte den PC bei Gelegenheit neu.' })
  }
  if (power && /energiespar|power saver/i.test(power)) {
    s.push({ id: 'power', severity: 'low', title: `Energieplan „${power}“ aktiv`,
      explanation: 'Der Energiesparplan drosselt den Prozessor. Am Netzteil kostet das spürbar Leistung.',
      recommendation: 'In den Energieoptionen „Ausbalanciert“ wählen, wenn der PC am Strom hängt.' })
  }
  const order = { critical: 0, high: 1, medium: 2, low: 3 }
  const report: OptimizeReport = { suggestions: s.sort((a, b) => order[a.severity] - order[b.severity]), powerPlan: power, uptimeDays, time: Date.now(), tookMs: Date.now() - started }
  saveJson(REPORT_KEY, report)
  return report
}

export async function takeSnapshot(label?: string): Promise<Snapshot> {
  const [live, autostart, storage] = await Promise.all([getLiveMetrics(), listAutostart({ signatures: false }).catch(() => []), storageOverview({ quick: true }).catch(() => null)])
  const sysDrive = (process.env['SystemDrive'] ?? 'C:').toUpperCase()
  const disk = live.disks.find((d) => d.mount.toUpperCase().startsWith(sysDrive)) ?? live.disks[0]
  const snap: Omit<Snapshot, 'id'> = {
    time: Date.now(),
    label: (label ?? '').trim().slice(0, 80) || new Date().toLocaleString('de-DE'),
    ramUsedPct: Math.round((live.memory.used / live.memory.total) * 1000) / 10,
    freeSystemBytes: disk ? disk.size - disk.used : 0,
    autostartEnabled: autostart.filter((a) => a.enabled).length,
    processCount: live.processes.total,
    tempBytes: storage?.temp.reduce((n, t) => n + t.bytes, 0) ?? 0
  }
  const id = run(
    'INSERT INTO snapshots (time, label, ram_used_pct, free_system_bytes, autostart_enabled, process_count, temp_bytes) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [snap.time, snap.label, snap.ramUsedPct, snap.freeSystemBytes, snap.autostartEnabled, snap.processCount, snap.tempBytes]
  )
  return { id, ...snap }
}

export function listSnapshots(): Snapshot[] {
  return all<Record<string, number | string>>('SELECT * FROM snapshots ORDER BY time DESC LIMIT 50').map((r) => ({
    id: Number(r['id']), time: Number(r['time']), label: String(r['label']), ramUsedPct: Number(r['ram_used_pct']),
    freeSystemBytes: Number(r['free_system_bytes']), autostartEnabled: Number(r['autostart_enabled']),
    processCount: Number(r['process_count']), tempBytes: Number(r['temp_bytes'])
  }))
}
