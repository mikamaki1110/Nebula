/** Gemeinsame Datentypen für Main-Prozess und Oberfläche. */
export type RiskLevel = 'read' | 'modify' | 'critical'
export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/** Messwerte, die langsam sind und deshalb im Hintergrund nachgeladen werden. */
export type LiveSource = 'gpu' | 'network' | 'battery' | 'processes' | 'temperature'

export interface LiveMetrics {
  timestamp: number
  cpu: { load: number; perCore: number[]; tempC: number | null }
  memory: { total: number; used: number; available: number }
  gpus: Array<{ name: string; load: number | null; tempC: number | null; vramUsedMB: number | null; vramTotalMB: number | null }>
  disks: Array<{ mount: string; fsType: string; size: number; used: number }>
  network: Array<{ iface: string; rxPerSec: number | null; txPerSec: number | null }>
  battery: { hasBattery: boolean; percent: number | null; charging: boolean | null; healthPercent: number | null }
  processes: { total: number; top: ProcessRow[] }
  /** Nur Quellen, die noch keinen Wert haben: loading = wird gelesen, failed = nicht verfügbar. */
  sources: Partial<Record<LiveSource, 'loading' | 'failed'>>
  /** Kurzer Fehlertext je ausgefallener Quelle – damit die Ursache sichtbar wird. */
  sourceErrors: Partial<Record<LiveSource, string>>
}

export interface StaticInfo {
  os: { distro: string; release: string; build: string; arch: string; hostname: string }
  cpu: { brand: string; cores: number; physicalCores: number; speedGHz: number }
  machine: { manufacturer: string; model: string }
  uptimeSec: number
  /** false = nur Grunddaten aus Windows; Details (Hersteller, Kerne …) werden noch geladen. */
  detailsLoaded: boolean
  paths: { home: string; desktop: string; downloads: string; documents: string; pictures: string }
}

export interface ProcessRow { pid: number; name: string; cpu: number; memBytes: number; path: string; user: string }

export interface FileEntry { path: string; name: string; size: number; mtime: number; isDir: boolean }
export interface ScanResult<T> { items: T[]; scanned: number; truncated: boolean; seconds: number }
export interface DuplicateGroup { size: number; hash: string; paths: string[] }
export interface TempLocation { label: string; path: string; bytes: number; files: number; accessible: boolean }
export interface StorageOverview { temp: TempLocation[]; recycleBin: { bytes: number; items: number } | null }

export interface Program {
  id: string
  name: string
  version: string | null
  publisher: string | null
  installDate: string | null
  sizeBytes: number | null
  installLocation: string | null
  canUninstall: boolean
}

export type AutostartHive = 'HKCU:' | 'HKLM:'
export type AutostartKey = 'Run' | 'Run32' | 'StartupFolder'
export interface AutostartEntry {
  name: string
  command: string
  source: string
  scope: 'user' | 'machine'
  hive: AutostartHive
  approvedKey: AutostartKey
  exePath: string | null
  signature: string
  signer: string | null
  enabled: boolean
  suspicious: string[]
}

export type WindowsPage = 'windowsSecurity' | 'windowsUpdate' | 'firewall' | 'storageSense' | 'apps'
export type PageId =
  | 'dashboard' | 'chat' | 'monitor' | 'storage' | 'programs' | 'security'
  | 'optimize' | 'repair' | 'files' | 'settings' | 'history'

export type FindingAction =
  | { kind: 'open'; target: WindowsPage; label: string }
  | { kind: 'page'; page: PageId; label: string }
  | { kind: 'cap'; capId: CapId; input: Record<string, unknown>; label: string }

export interface Finding {
  id: string
  severity: Severity
  title: string
  explanation: string
  recommendation: string
  action?: FindingAction
}

export interface SuspiciousProcess { pid: number; name: string; path: string; reason: string }

export interface SecurityReport {
  time: number
  defender: {
    serviceEnabled: boolean
    antivirusEnabled: boolean
    realTimeProtection: boolean
    signatureAgeDays: number | null
    quickScanAgeDays: number | null
    tamperProtected: boolean | null
  } | null
  firewall: Array<{ name: string; enabled: boolean }>
  lastUpdate: { id: string; installedOn: string | null } | null
  uacEnabled: boolean | null
  antivirus: string[]
  suspiciousAutostart: AutostartEntry[]
  suspiciousProcesses: SuspiciousProcess[]
  findings: Finding[]
  /** Prüfungen, die nicht möglich waren (z. B. Zugriff verweigert) – ehrlich statt „alles gut“. */
  incomplete: string[]
  tookMs: number
}

export interface PendingUpdate { title: string; severity: string | null; kb: string }

export interface RepairResult { kind: string; exitCode: number | null; output: string; summary: string; ok: boolean | null }

export interface NetworkDiagnosis {
  adapters: Array<{ name: string; description: string; status: string; linkSpeed: string }>
  configs: Array<{ alias: string; ipv4: string; gateway: string; dns: string }>
  gatewayReachable: boolean
  internetReachable: boolean
  dnsWorks: boolean
  verdict: string
  findings: Finding[]
}

export interface DriverProblem { name: string; deviceId: string; code: number; explanation: string }
export interface EventGroup { provider: string; id: number; level: string; count: number; lastTime: string; message: string }

export interface OptimizeReport { suggestions: Finding[]; powerPlan: string | null; uptimeDays: number; time: number; tookMs: number }

export interface Snapshot {
  id: number
  time: number
  label: string
  ramUsedPct: number
  freeSystemBytes: number
  autostartEnabled: number
  processCount: number
  tempBytes: number
}

export interface MoveRecord { from: string; to: string; category?: string }
export interface HistoryEntry { id: number; time: number; capId: string; summary: string; undoable: boolean; undone: boolean }

export type Accent = 'ironbow' | 'arctic' | 'lava' | 'white'
export interface Settings {
  userName: string
  aiModel: string
  voiceOutput: boolean
  voiceName: string
  voiceRate: number
  accent: Accent
  density: 'comfortable' | 'compact'
  effects: boolean
  /** auto = eigener Schlüssel → lokale KI → Gratis-Zugang; local = nur Ollama; cloud = nie lokal */
  aiProvider: 'auto' | 'local' | 'cloud'
  ollamaModel: string
  /** Kontextlänge der lokalen KI: kleiner = weniger Grafikspeicher = schneller */
  aiContext: number
}

export interface ConfirmRequest {
  id: string
  title: string
  details: string[]
  risk: RiskLevel
  requiresAdmin: boolean
  confirmLabel: string
  requestedBy: string
}

export type ChatEvent =
  | { type: 'step'; agent: string; text: string }
  | { type: 'message'; text: string }
  | { type: 'error'; text: string }
  | { type: 'done' }

export interface AiStatus {
  configured: boolean
  source: 'env' | 'session' | 'free' | 'local' | null
  model: string
  provider: 'auto' | 'local' | 'cloud'
  ollama: {
    running: boolean
    models: string[]
    selected: string
    installed: boolean
    recommended: Array<{ name: string; size: string; hint: string }>
    context: number
    /** Wie viel vom geladenen Modell auf der Grafikkarte liegt (null = nichts geladen) */
    load: { model: string; percentGpu: number } | null
  }
}
export interface PullProgress { model: string; status: string; percent: number | null }

/** Jede Fähigkeit von ATLAS mit Ein- und Ausgabetyp. */
export interface CapMap {
  'system.static': { in: Record<string, never>; out: StaticInfo }
  'system.live': { in: Record<string, never>; out: LiveMetrics }
  'system.processes': { in: { sortBy?: 'cpu' | 'memory'; limit?: number; query?: string }; out: ProcessRow[] }
  'system.openWindowsPage': { in: { target: WindowsPage }; out: { opened: boolean } }
  'process.kill': { in: { pid: number; name: string }; out: { killed: boolean } }
  'storage.overview': { in: Record<string, never>; out: StorageOverview }
  'storage.largeFiles': { in: { root: string; minSizeMB?: number; olderThanDays?: number; limit?: number }; out: ScanResult<FileEntry> }
  'storage.duplicates': { in: { root: string; minSizeMB?: number }; out: ScanResult<DuplicateGroup> }
  'storage.cleanTemp': { in: Record<string, never>; out: { freedBytes: number; deleted: number; skipped: number } }
  'storage.emptyRecycleBin': { in: Record<string, never>; out: { freedBytes: number } }
  'files.list': { in: { dir: string }; out: FileEntry[] }
  'files.search': { in: { root: string; query: string; limit?: number }; out: ScanResult<FileEntry> }
  'files.trash': { in: { paths: string[] }; out: { trashed: number; failed: string[] } }
  'files.move': { in: { paths: string[]; targetDir: string }; out: { moved: MoveRecord[]; failed: string[] } }
  'files.rename': { in: { path: string; newName: string }; out: MoveRecord }
  'files.mkdir': { in: { parent: string; name: string }; out: { path: string } }
  'files.organizePlan': { in: { dir: string }; out: MoveRecord[] }
  'files.organizeApply': { in: { dir: string }; out: { moved: MoveRecord[]; failed: string[] } }
  'programs.list': { in: { query?: string }; out: Program[] }
  'programs.uninstall': { in: { id: string }; out: { exitCode: number | null; stillInstalled: boolean } }
  'programs.leftovers': { in: { name: string; publisher?: string; installLocation?: string }; out: FileEntry[] }
  'autostart.list': { in: Record<string, never>; out: AutostartEntry[] }
  'autostart.set': { in: { hive: AutostartHive; approvedKey: AutostartKey; name: string; enable: boolean }; out: { enabled: boolean } }
  'security.report': { in: { refresh?: boolean }; out: SecurityReport }
  'security.cached': { in: Record<string, never>; out: SecurityReport | null }
  'security.pendingUpdates': { in: Record<string, never>; out: PendingUpdate[] }
  'security.quickScan': { in: Record<string, never>; out: { started: boolean; message: string } }
  'repair.sfc': { in: { mode: 'verify' | 'repair' }; out: RepairResult }
  'repair.dism': { in: { mode: 'check' | 'scan' | 'restore' }; out: RepairResult }
  'repair.network': { in: Record<string, never>; out: NetworkDiagnosis }
  'repair.flushDns': { in: Record<string, never>; out: { ok: boolean } }
  'repair.drivers': { in: Record<string, never>; out: DriverProblem[] }
  'repair.events': { in: { days?: number }; out: EventGroup[] }
  'optimize.report': { in: Record<string, never>; out: OptimizeReport }
  'optimize.cached': { in: Record<string, never>; out: OptimizeReport | null }
  'optimize.snapshot': { in: { label?: string }; out: Snapshot }
  'optimize.snapshots': { in: Record<string, never>; out: Snapshot[] }
}
export type CapId = keyof CapMap
export type CapIn<K extends CapId> = CapMap[K]['in']
export type CapOut<K extends CapId> = CapMap[K]['out']
