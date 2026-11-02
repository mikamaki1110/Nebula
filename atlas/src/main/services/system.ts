import { app } from 'electron'
import { promises as fsp } from 'fs'
import { arch, cpus, freemem, hostname, platform, release, totalmem, uptime } from 'os'
import si from 'systeminformation'
import type { LiveMetrics, LiveSource, ProcessRow, StaticInfo } from '@shared/types'
import { log } from '../core/log'
import { ps } from '../core/powershell'

/**
 * Leitung zu Nebula. Nebula misst Grafik, Prozesse, Netzwerk, Akku und Temperatur ohnehin ständig
 * (und hat dafür robuste Wege: Windows-Leistungsindikatoren, LibreHardwareMonitor, nvidia-smi).
 * ATLAS fragt dort nach, statt dieselben schweren Abfragen noch einmal zu starten und sich in
 * Nebulas PowerShell-Warteschlange hinten anzustellen.
 */
export interface NebulaBridge {
  fast?: () => Promise<{ netRx?: number; netTx?: number }>
  slow?: () => Promise<NebulaSlow>
  procs?: () => Promise<{ processes?: NebulaGroup[]; processCount?: number }>
  info?: () => Promise<NebulaInfo>
}
interface NebulaSlow {
  cpuTemp?: number | null
  gpus?: Array<{ model?: string; temp?: number | null; load?: number | null; memUsed?: number | null; memTotal?: number | null }>
  battery?: { percent?: number; charging?: boolean } | null
}
interface NebulaGroup { name: string; instances?: Array<{ pid: number | null; cpu: number; mem: number }> }
interface NebulaInfo {
  os?: { name?: string; release?: string; build?: string; hostname?: string }
  cpu?: { name?: string; cores?: number; threads?: number; baseGHz?: number }
  system?: { manufacturer?: string; model?: string }
}

/** Ergebnis kurz zwischenspeichern; gleichzeitige Aufrufe teilen sich eine Abfrage. */
function cachedFeed<T>(read: () => Promise<T>, defaultMaxAgeMs: number): (maxAgeMs?: number) => Promise<T> {
  let value: T | undefined
  let at = 0
  let pending: Promise<T> | null = null
  return (maxAgeMs = defaultMaxAgeMs) => {
    if (value !== undefined && Date.now() - at < maxAgeMs) return Promise.resolve(value)
    if (!pending) {
      pending = read().then((v) => { value = v; at = Date.now(); return v }).finally(() => { pending = null })
    }
    return pending
  }
}

let bridge: NebulaBridge | null = null
let slowFeed: ReturnType<typeof cachedFeed<NebulaSlow>> | null = null
let fastFeed: ReturnType<typeof cachedFeed<{ netRx?: number; netTx?: number }>> | null = null
let procsFeed: ReturnType<typeof cachedFeed<{ processes?: NebulaGroup[]; processCount?: number }>> | null = null

export function setBridge(b: NebulaBridge | null): void {
  bridge = b
  slowFeed = b?.slow ? cachedFeed(b.slow, 4500) : null
  fastFeed = b?.fast ? cachedFeed(b.fast, 1500) : null
  procsFeed = b?.procs ? cachedFeed(b.procs, 8000) : null
  enrichment = null
  enriched = {}
}

/**
 * Live-Messwerte in zwei Geschwindigkeiten:
 *  - schnell (sofort, ohne PowerShell): CPU, Arbeitsspeicher, Laufwerke – direkt aus Node/Windows
 *  - langsam (im Hintergrund, jeweils einzeln, mit Zeitlimit): Grafik, Netzwerk, Akku, Prozesse, Temperatur
 * Eine hängende oder fehlschlagende Abfrage kann deshalb nie mehr CPU/RAM blockieren.
 */
export const tuning = {
  retryMs: 15_000,
  timeoutMs: { gpu: 40_000, network: 15_000, battery: 40_000, processes: 25_000, temperature: 40_000 } as Record<LiveSource, number>
}

const validTemp = (t: number | null | undefined): number | null =>
  typeof t === 'number' && t > 0 && t < 150 ? t : null
const numOrNull = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null
const clamp = (n: number): number => Math.min(100, Math.max(0, n))
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n')[0] ?? 'Fehler'

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: keine Antwort nach ${ms < 1000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`}`)), ms)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ── Schnell: Prozessor ───────────────────────────────────────────────
interface CpuSnap { idle: number; total: number }

const cpuSnapshot = (): CpuSnap[] =>
  cpus().map(({ times: t }) => ({ idle: t.idle, total: t.user + t.nice + t.sys + t.idle + t.irq }))

/** Auslastung in Prozent aus zwei Messungen (Differenz der CPU-Zeiten). */
export function loadBetween(prev: CpuSnap[], next: CpuSnap[]): { load: number; perCore: number[] } {
  let sumTotal = 0
  let sumIdle = 0
  const perCore = next.map((n, i) => {
    const p = prev[i]
    if (!p) return 0
    const dt = n.total - p.total
    const di = n.idle - p.idle
    sumTotal += dt
    sumIdle += di
    return dt > 0 ? clamp((1 - di / dt) * 100) : 0
  })
  return { load: sumTotal > 0 ? clamp((1 - sumIdle / sumTotal) * 100) : 0, perCore }
}

let prevCpu: CpuSnap[] | null = null
let lastCpu: { load: number; perCore: number[] } = { load: 0, perCore: cpus().map(() => 0) }

async function readCpu(): Promise<{ load: number; perCore: number[] }> {
  if (!prevCpu) {
    prevCpu = cpuSnapshot()
    await sleep(350) // erste Messung braucht einen zweiten Zeitpunkt
  }
  const next = cpuSnapshot()
  lastCpu = loadBetween(prevCpu, next)
  prevCpu = next
  return lastCpu
}

// ── Schnell: Laufwerke ───────────────────────────────────────────────
type Disk = LiveMetrics['disks'][number]
let diskCache: { at: number; value: Disk[] } | null = null

async function statDrive(root: string): Promise<Disk | null> {
  try {
    const s = await withTimeout(fsp.statfs(root), 1500, root)
    const bsize = Number(s.bsize)
    const size = Number(s.blocks) * bsize
    if (!(size > 0)) return null
    return { mount: root.replace(/[\\/]+$/, '') || root, fsType: '', size, used: size - Number(s.bfree) * bsize }
  } catch {
    return null // leeres Laufwerk, getrennte Netzwerkfreigabe …
  }
}

async function readDisks(): Promise<Disk[]> {
  if (diskCache && Date.now() - diskCache.at < 5000) return diskCache.value
  const roots = platform() === 'win32' ? [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) => `${l}:\\`) : ['/']
  const value = (await Promise.all(roots.map(statDrive))).filter((d): d is Disk => d !== null)
  diskCache = { at: Date.now(), value }
  return value
}

// ── Langsam: einzeln, im Hintergrund, mit Zeitlimit ─────────────────
class Slow<T> {
  value: T | undefined
  failed = false
  error = ''
  private at = 0
  private retryAt = 0
  private running = false

  constructor(
    readonly name: LiveSource,
    private readonly read: () => Promise<T>,
    private readonly everyMs: number
  ) {}


  /** Startet bei Bedarf eine Aktualisierung – wartet aber nie darauf. */
  poke(): void {
    const now = Date.now()
    if (this.running || now < this.retryAt || now - this.at < this.everyMs) return
    this.running = true
    withTimeout(Promise.resolve().then(this.read), tuning.timeoutMs[this.name], this.name)
      .then((v) => {
        this.value = v
        this.at = Date.now()
        if (this.failed) log('info', 'Messwerte', `${this.name}: wieder verfügbar`)
        this.failed = false
        this.error = ''
      })
      .catch((e: unknown) => {
        this.retryAt = Date.now() + tuning.retryMs
        if (!this.failed) log('warn', 'Messwerte', `${this.name} nicht lesbar – ${message(e)}`)
        this.failed = true
        this.error = message(e)
      })
      .finally(() => { this.running = false })
  }

  state(): 'ok' | 'loading' | 'failed' {
    return this.value !== undefined ? 'ok' : this.failed ? 'failed' : 'loading'
  }
}

// ── Prozesse ─────────────────────────────────────────────────────────
let lastProcs: { at: number; rows: ProcessRow[]; total: number } | null = null
let pathList: Array<{ pid: number; name: string; path: string }> = []
const pathMap = new Map<number, string>()
let pathsAt = 0
let pathsPending: Promise<typeof pathList> | null = null

/** Pfade aller laufenden Programme (für Sicherheitsprüfung und Prozessliste) – eigene, gecachte Abfrage. */
export function readProcessPaths(maxAgeMs = 60_000): Promise<Array<{ pid: number; name: string; path: string }>> {
  if (pathList.length > 0 && Date.now() - pathsAt < maxAgeMs) return Promise.resolve(pathList)
  if (!pathsPending) {
    pathsPending = ps<Array<{ pid: number; name: string; path: string }> | { pid: number; name: string; path: string } | null>(`
      $out = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath } | ForEach-Object {
        [pscustomobject]@{ pid = [int]$_.ProcessId; name = [string]$_.Name; path = [string]$_.ExecutablePath } })`, {}, { timeoutMs: 30_000 })
      .then((r) => {
        pathList = r == null ? [] : Array.isArray(r) ? r : [r]
        pathMap.clear()
        for (const p of pathList) pathMap.set(p.pid, p.path)
        pathsAt = Date.now()
        return pathList
      })
      .finally(() => { pathsPending = null })
  }
  return pathsPending
}

/** Nebulas gruppierte Prozessliste → einzelne Zeilen (eine je Prozess-ID). */
export function flattenProcesses(groups: NebulaGroup[] | undefined): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const g of groups ?? []) {
    for (const i of g.instances ?? []) {
      if (i.pid == null) continue
      rows.push({ pid: i.pid, name: `${g.name}.exe`, cpu: Number(i.cpu) || 0, memBytes: Number(i.mem) || 0, path: '', user: '' })
    }
  }
  return rows
}

/** Prozessliste, kurz gecacht. Mit Nebula-Leitung aus dessen Leistungsindikatoren, sonst über systeminformation. */
export async function readProcesses(maxAgeMs = 1500): Promise<{ rows: ProcessRow[]; total: number }> {
  if (lastProcs && Date.now() - lastProcs.at < maxAgeMs) return lastProcs
  let rows: ProcessRow[]
  let total: number
  if (procsFeed) {
    const p = await procsFeed(maxAgeMs)
    rows = flattenProcesses(p.processes)
    total = p.processCount ?? rows.length
  } else {
    const p = await si.processes()
    rows = p.list.map((x) => ({
      pid: x.pid,
      name: x.name,
      cpu: x.cpu,
      memBytes: x.memRss * 1024,
      path: x.path ? `${x.path}${x.path.endsWith('\\') ? '' : '\\'}${x.name}` : '',
      user: x.user ?? ''
    }))
    total = p.all
  }
  if (platform() === 'win32') void readProcessPaths().catch(() => undefined) // Pfade kommen im Hintergrund nach
  rows = rows.map((r) => ({ ...r, path: r.path || pathMap.get(r.pid) || '' }))
  lastProcs = { at: Date.now(), rows, total }
  return lastProcs
}

// ── Die langsamen Quellen ────────────────────────────────────────────
const mapGpus = (g: NebulaSlow['gpus']): LiveMetrics['gpus'] =>
  (g ?? []).map((x) => ({
    name: x.model || 'Grafikkarte',
    load: numOrNull(x.load),
    tempC: validTemp(x.temp),
    vramUsedMB: numOrNull(x.memUsed),
    vramTotalMB: numOrNull(x.memTotal)
  }))

/** So wird jede langsame Quelle gelesen – Nebula zuerst, systeminformation als Notlösung. Austauschbar für Tests. */
export const readers = {
  async gpu(): Promise<LiveMetrics['gpus']> {
    if (slowFeed) return mapGpus((await slowFeed()).gpus)
    const g = await si.graphics()
    return g.controllers.map((c) => ({
      name: c.model || c.vendor || 'Unbekannte GPU',
      load: numOrNull(c.utilizationGpu),
      tempC: validTemp(c.temperatureGpu),
      vramUsedMB: numOrNull(c.memoryUsed),
      vramTotalMB: numOrNull(c.memoryTotal ?? c.vram)
    }))
  },
  async network(): Promise<LiveMetrics['network']> {
    if (fastFeed) {
      const f = await fastFeed()
      return [{ iface: 'Gesamt', rxPerSec: numOrNull(f.netRx), txPerSec: numOrNull(f.netTx) }]
    }
    const net = await si.networkStats() // bewusst ohne „*“: das fragt jeden virtuellen Adapter einzeln ab und ist sehr langsam
    return net.map((n) => ({ iface: n.iface, rxPerSec: numOrNull(n.rx_sec), txPerSec: numOrNull(n.tx_sec) }))
  },
  async battery(): Promise<LiveMetrics['battery']> {
    if (slowFeed) {
      const b = (await slowFeed()).battery
      return b
        ? { hasBattery: true, percent: numOrNull(b.percent), charging: b.charging ?? null, healthPercent: null }
        : { hasBattery: false, percent: null, charging: null, healthPercent: null }
    }
    const b = await si.battery()
    return {
      hasBattery: b.hasBattery,
      percent: b.hasBattery ? b.percent : null,
      charging: b.hasBattery ? b.isCharging : null,
      healthPercent: b.hasBattery && b.designedCapacity > 0 ? Math.round((b.maxCapacity / b.designedCapacity) * 100) : null
    }
  },
  async processes(): Promise<LiveMetrics['processes']> {
    const p = await readProcesses(8000)
    return { total: p.total, top: [...p.rows].sort((a, b) => b.cpu - a.cpu).slice(0, 8) }
  },
  async temperature(): Promise<number | null> {
    if (slowFeed) return validTemp((await slowFeed()).cpuTemp)
    return validTemp((await si.cpuTemperature()).main)
  }
}

const gpuSource = new Slow<LiveMetrics['gpus']>('gpu', () => readers.gpu(), 5000)
const networkSource = new Slow<LiveMetrics['network']>('network', () => readers.network(), 2000)
const batterySource = new Slow<LiveMetrics['battery']>('battery', () => readers.battery(), 30_000)
const processSource = new Slow<LiveMetrics['processes']>('processes', () => readers.processes(), 10_000)
const temperatureSource = new Slow<number | null>('temperature', () => readers.temperature(), 5000)

const SLOW = [gpuSource, networkSource, batterySource, processSource, temperatureSource] as const

async function collect(): Promise<LiveMetrics> {
  for (const s of SLOW) s.poke()
  const [cpu, disks] = await Promise.all([readCpu(), readDisks()])
  const total = totalmem()
  const free = freemem()
  const sources: LiveMetrics['sources'] = {}
  const sourceErrors: LiveMetrics['sourceErrors'] = {}
  for (const s of SLOW) {
    const state = s.state()
    if (state !== 'ok') sources[s.name] = state
    if (state === 'failed' && s.error) sourceErrors[s.name] = s.error
  }
  return {
    timestamp: Date.now(),
    cpu: { load: cpu.load, perCore: cpu.perCore, tempC: temperatureSource.value ?? null },
    memory: { total, used: total - free, available: free },
    gpus: gpuSource.value ?? [],
    disks,
    network: networkSource.value ?? [],
    battery: batterySource.value ?? { hasBattery: false, percent: null, charging: null, healthPercent: null },
    processes: processSource.value ?? { total: 0, top: [] },
    sources,
    sourceErrors
  }
}

let inFlight: Promise<LiveMetrics> | null = null
export function getLiveMetrics(): Promise<LiveMetrics> {
  if (!inFlight) inFlight = collect().finally(() => (inFlight = null))
  return inFlight
}

// ── Systeminformationen: sofort aus Node, Details nachgeladen ────────
type Enrichment = Partial<{
  distro: string; release: string; build: string; hostname: string
  manufacturer: string; model: string; brand: string; cores: number; physicalCores: number; speedGHz: number
}>
let enrichment: Promise<void> | null = null
let enriched: Enrichment = {}
let enrichedAt = 0

function enrich(): Promise<void> {
  if (!enrichment) {
    enrichment = (async () => {
      const out: Enrichment = {}
      if (bridge?.info) {
        try {
          const i = await withTimeout(bridge.info(), 60_000, 'Systeminfo')
          Object.assign(out, {
            distro: i.os?.name, release: i.os?.release, build: i.os?.build, hostname: i.os?.hostname,
            brand: i.cpu?.name, cores: i.cpu?.threads, physicalCores: i.cpu?.cores, speedGHz: i.cpu?.baseGHz,
            manufacturer: i.system?.manufacturer, model: i.system?.model
          })
        } catch (e) {
          log('warn', 'Systeminfo', message(e))
        }
      } else {
        const [o, c, sy] = await Promise.allSettled([
          withTimeout(Promise.resolve().then(() => si.osInfo()), 30_000, 'Systeminfo'),
          withTimeout(Promise.resolve().then(() => si.cpu()), 30_000, 'Prozessorinfo'),
          withTimeout(Promise.resolve().then(() => si.system()), 30_000, 'Geräteinfo')
        ])
        if (o.status === 'fulfilled') Object.assign(out, { distro: o.value.distro, release: o.value.release, build: o.value.build, hostname: o.value.hostname })
        if (c.status === 'fulfilled') Object.assign(out, { brand: `${c.value.manufacturer} ${c.value.brand}`.trim(), cores: c.value.cores, physicalCores: c.value.physicalCores, speedGHz: c.value.speed })
        if (sy.status === 'fulfilled') Object.assign(out, { manufacturer: sy.value.manufacturer, model: sy.value.model })
        for (const r of [o, c, sy]) if (r.status === 'rejected') log('warn', 'Systeminfo', message(r.reason))
      }
      for (const k of Object.keys(out) as Array<keyof Enrichment>) if (out[k] === undefined || out[k] === '') delete out[k]
      enriched = out
      enrichedAt = Date.now()
    })()
  }
  return enrichment
}

export async function getStaticInfo(): Promise<StaticInfo> {
  // Hat der letzte Versuch nichts gebracht, wird er nach 30 Sekunden erneut gestartet.
  if (enrichment && enrichedAt > 0 && Object.keys(enriched).length === 0 && Date.now() - enrichedAt > 30_000) enrichment = null
  await Promise.race([enrich(), sleep(2500)]) // nicht länger als 2,5 s auf Details warten
  const e = enriched // leer, solange die Details noch geladen werden – dann gelten die Werte aus Node
  const processors = cpus()
  const build = /\.(\d+)$/.exec(release())?.[1] ?? release()
  const distro = platform() === 'win32' ? (Number(build) >= 22000 ? 'Windows 11' : 'Windows 10') : platform()
  return {
    os: { distro: e.distro ?? distro, release: e.release ?? release(), build: e.build ?? build, arch: arch(), hostname: e.hostname ?? hostname() },
    cpu: {
      brand: e.brand ?? (processors[0]?.model ?? 'Prozessor').trim(),
      cores: e.cores ?? processors.length,
      physicalCores: e.physicalCores ?? processors.length,
      speedGHz: e.speedGHz ?? (processors[0] ? processors[0].speed / 1000 : 0)
    },
    machine: { manufacturer: e.manufacturer ?? '', model: e.model ?? '' },
    uptimeSec: uptime(),
    detailsLoaded: Object.keys(e).length > 0,
    paths: {
      home: app.getPath('home'), desktop: app.getPath('desktop'), downloads: app.getPath('downloads'),
      documents: app.getPath('documents'), pictures: app.getPath('pictures')
    }
  }
}

export async function listProcesses(sortBy: 'cpu' | 'memory' = 'cpu', limit = 40, query?: string): Promise<ProcessRow[]> {
  const { rows } = await readProcesses()
  const q = query?.toLowerCase().trim()
  return rows
    .filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
    .sort((a, b) => (sortBy === 'cpu' ? b.cpu - a.cpu : b.memBytes - a.memBytes))
    .slice(0, Math.min(200, Math.max(1, limit)))
}

/** Diese Prozesse beendet ATLAS nie – Windows würde abstürzen oder instabil werden. */
const CRITICAL = new Set([
  'system', 'system idle process', 'idle', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe',
  'services.exe', 'lsass.exe', 'lsaiso.exe', 'svchost.exe', 'fontdrvhost.exe', 'dwm.exe', 'memory compression',
  'msmpeng.exe', 'securityhealthservice.exe', 'nissrv.exe', 'mssense.exe'
])

export function isCriticalProcess(name: string): boolean {
  return CRITICAL.has(name.toLowerCase())
}

export async function killProcess(pid: number, name: string): Promise<{ killed: boolean }> {
  if (pid === process.pid) throw new Error('ATLAS beendet sich nicht selbst.')
  if (isCriticalProcess(name)) throw new Error(`${name} ist ein Windows-Kernprozess und wird nicht beendet.`)
  const { rows } = await readProcesses(0)
  const current = rows.find((r) => r.pid === pid)
  if (!current) throw new Error(`Prozess ${pid} läuft nicht mehr.`)
  if (current.name.toLowerCase() !== name.toLowerCase()) {
    throw new Error(`Die Prozess-ID ${pid} gehört inzwischen zu ${current.name}, nicht zu ${name}. Abgebrochen.`)
  }
  if (isCriticalProcess(current.name)) throw new Error(`${current.name} ist ein Windows-Kernprozess.`)
  process.kill(pid)
  return { killed: true }
}
