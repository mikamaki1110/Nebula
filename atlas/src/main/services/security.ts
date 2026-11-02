import type { Finding, PendingUpdate, SecurityReport, SuspiciousProcess } from '@shared/types'
import { log } from '../core/log'
import { ps } from '../core/powershell'
import { loadJson, saveJson } from '../core/store'
import { arr } from '../core/util'
import { listAutostart, verifySignatures } from './autostart'
import { readProcessPaths } from './system'

export { arr }

interface RawStatus {
  defender: SecurityReport['defender']
  firewall: Array<{ name: string; enabled: boolean }> | { name: string; enabled: boolean } | null
  uacEnabled: boolean | null
  antivirus: string[] | string | null
}

/**
 * Defender, Firewall, UAC und Virenschutz in EINEM Skript – aber ohne die trägen Module:
 *  - Defender direkt über die WMI-Klasse (spart das Laden des Defender-Moduls)
 *  - Firewall und UAC direkt aus der Registrierung (Millisekunden statt Sekunden)
 */
const STATUS_SCRIPT = `
function New-Def($m) {
  [pscustomobject]@{
    serviceEnabled = [bool]$m.AMServiceEnabled; antivirusEnabled = [bool]$m.AntivirusEnabled
    realTimeProtection = [bool]$m.RealTimeProtectionEnabled; signatureAgeDays = $m.AntivirusSignatureAge
    quickScanAgeDays = $m.QuickScanAge; tamperProtected = $m.IsTamperProtected
  }
}
$def = $null
try { $def = New-Def (Get-CimInstance -Namespace 'root/Microsoft/Windows/Defender' -ClassName MSFT_MpComputerStatus -ErrorAction Stop) } catch {}
if (-not $def) { try { $def = New-Def (Get-MpComputerStatus -ErrorAction Stop) } catch {} }
$base = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy'
$fw = @()
foreach ($p in @(@('Domain', 'DomainProfile'), @('Private', 'StandardProfile'), @('Public', 'PublicProfile'))) {
  try {
    $v = (Get-ItemProperty -LiteralPath ($base + '\\' + $p[1]) -Name EnableFirewall -ErrorAction Stop).EnableFirewall
    $fw += [pscustomobject]@{ name = $p[0]; enabled = ([int]$v -eq 1) }
  } catch {}
}
if ($fw.Count -eq 0) {
  try { $fw = @(Get-NetFirewallProfile -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; enabled = [bool]$_.Enabled } }) } catch {}
}
$uac = $null
try { $uac = ((Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System' -ErrorAction Stop).EnableLUA -eq 1) } catch {}
$av = @()
try { $av = @(Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct -ErrorAction Stop | ForEach-Object { [string]$_.displayName }) } catch {}
$out = [pscustomobject]@{ defender = $def; firewall = @($fw); uacEnabled = $uac; antivirus = $av }`

/**
 * Letztes Windows-Update aus dem Update-Verlauf (schnell) statt Get-HotFix (sehr langsam).
 * Definitions-Updates von Defender zählen nicht – sonst wäre das Datum immer „gestern“.
 */
const UPDATE_SCRIPT = `
$last = $null
try {
  $session = New-Object -ComObject Microsoft.Update.Session
  $history = $session.CreateUpdateSearcher().QueryHistory(0, 200)
  $e = $history | Where-Object { $_.Operation -eq 1 -and $_.ResultCode -eq 2 -and $_.Title -notmatch 'Defender|Intelligence|Antimalware|Malicious Software|Sicherheitsintelligenz' } |
    Sort-Object Date -Descending | Select-Object -First 1
  if ($e) { $last = $e.Date.ToUniversalTime().ToString('o') }
} catch {}
$out = $null
if ($last) { $out = [pscustomobject]@{ id = 'Windows Update'; installedOn = $last } }`


const SYSTEM_NAMES = ['svchost.exe', 'lsass.exe', 'csrss.exe', 'winlogon.exe', 'services.exe', 'smss.exe', 'explorer.exe', 'wininit.exe', 'dwm.exe']
const RISKY_DIR = /\\(temp|tmp|downloads)\\|\\appdata\\local\\temp\\|\\users\\public\\|\\\$recycle\.bin\\/i

async function suspiciousProcesses(): Promise<SuspiciousProcess[]> {
  const list = await readProcessPaths(30_000)
  const winDir = (process.env['SystemRoot'] ?? 'C:\\Windows').toLowerCase()
  const flagged: SuspiciousProcess[] = []
  for (const p of list) {
    if (!p.path) continue
    const lower = p.path.toLowerCase()
    if (SYSTEM_NAMES.includes(p.name.toLowerCase()) && !lower.startsWith(winDir)) {
      flagged.push({ pid: p.pid, name: p.name, path: p.path, reason: 'Trägt den Namen eines Windows-Systemprozesses, läuft aber außerhalb des Windows-Ordners.' })
    } else if (RISKY_DIR.test(lower)) {
      flagged.push({ pid: p.pid, name: p.name, path: p.path, reason: 'Läuft aus einem Temp-, Download- oder öffentlichen Ordner.' })
    }
  }
  if (flagged.length === 0) return []
  // Gültig signierte Programme aus Downloads sind meist harmlose Installer – Namensfälschungen bleiben immer markiert.
  const sigs = await verifySignatures(flagged.map((f) => f.path))
  const valid = (path: string): boolean => sigs.get(path)?.status === 'Valid'
  return flagged
    .filter((f) => f.reason.startsWith('Trägt') || !valid(f.path))
    .map((f) => (valid(f.path) ? f : { ...f, reason: `${f.reason} Zudem nicht gültig signiert.` }))
}

const REPORT_KEY = 'security-report'
let cache: SecurityReport | null = null
let inflight: Promise<SecurityReport> | null = null
const CACHE_MS = 10 * 60_000

/** Der zuletzt gespeicherte Bericht (auch aus früheren Sitzungen) – erscheint beim Start sofort. */
export function securityCached(): SecurityReport | null {
  return cache ?? loadJson<SecurityReport>(REPORT_KEY)
}

const failure = (what: string, reason: unknown): string => {
  log('warn', 'Sicherheit', `${what} nicht lesbar – ${reason instanceof Error ? reason.message : String(reason)}`)
  return what
}

async function build(): Promise<SecurityReport> {
  const started = Date.now()
  // Alle Prüfungen gleichzeitig: die Gesamtzeit ist die der langsamsten, nicht die Summe aller.
  const [status, update, autostart, procs] = await Promise.allSettled([
    ps<RawStatus>(STATUS_SCRIPT, {}, { timeoutMs: 40_000 }),
    ps<{ id: string; installedOn: string | null } | null>(UPDATE_SCRIPT, {}, { timeoutMs: 60_000 }),
    listAutostart({ signatures: true }),
    suspiciousProcesses()
  ])
  const incomplete: string[] = []
  if (status.status === 'rejected') incomplete.push(failure('Schutzstatus (Defender, Firewall, Benutzerkontensteuerung)', status.reason))
  if (update.status === 'rejected') incomplete.push(failure('Update-Verlauf', update.reason))
  if (autostart.status === 'rejected') incomplete.push(failure('Autostart-Einträge', autostart.reason))
  if (procs.status === 'rejected') incomplete.push(failure('Laufende Prozesse', procs.reason))

  const raw = status.status === 'fulfilled' ? status.value : null
  const base: Omit<SecurityReport, 'findings'> = {
    time: Date.now(),
    defender: raw?.defender ?? null,
    firewall: arr(raw?.firewall),
    lastUpdate: update.status === 'fulfilled' ? update.value : null,
    uacEnabled: raw?.uacEnabled ?? null,
    antivirus: arr(raw?.antivirus),
    suspiciousAutostart: autostart.status === 'fulfilled'
      ? autostart.value.filter((a) => a.enabled && a.suspicious.length > 0 && a.signature !== 'Missing')
      : [],
    suspiciousProcesses: procs.status === 'fulfilled' ? procs.value : [],
    incomplete,
    tookMs: Date.now() - started
  }
  const report: SecurityReport = { ...base, findings: buildFindings(base) }
  cache = report
  saveJson(REPORT_KEY, report)
  return report
}

export async function securityReport(refresh = false): Promise<SecurityReport> {
  if (!refresh && cache && Date.now() - cache.time < CACHE_MS) return cache
  if (!inflight) inflight = build().finally(() => { inflight = null })
  return inflight
}

const ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const

export function buildFindings(r: Omit<SecurityReport, 'findings'>): Finding[] {
  const f: Finding[] = []
  const thirdPartyAv = r.antivirus.filter((n) => !/defender/i.test(n))
  const d = r.defender

  if (d && !d.realTimeProtection && thirdPartyAv.length === 0) {
    f.push({ id: 'rtp-off', severity: 'critical', title: 'Echtzeitschutz ist ausgeschaltet',
      explanation: 'Neue Dateien werden beim Öffnen nicht auf Schadsoftware geprüft, und es ist kein anderes Virenschutzprogramm aktiv.',
      recommendation: 'Schalte den Echtzeitschutz in der Windows-Sicherheit wieder ein.',
      action: { kind: 'open', target: 'windowsSecurity', label: 'Windows-Sicherheit öffnen' } })
  }
  const statusFailed = r.incomplete.some((x) => x.startsWith('Schutzstatus'))
  if (!d && r.antivirus.length === 0 && !statusFailed) {
    f.push({ id: 'no-av', severity: 'high', title: 'Virenschutz-Status unbekannt',
      explanation: 'Der Status von Microsoft Defender konnte nicht gelesen werden, und Windows meldet kein anderes Virenschutzprogramm.',
      recommendation: 'Prüfe in der Windows-Sicherheit, ob ein Virenschutz aktiv ist.',
      action: { kind: 'open', target: 'windowsSecurity', label: 'Windows-Sicherheit öffnen' } })
  }
  if (d && d.signatureAgeDays !== null && d.signatureAgeDays > 7) {
    f.push({ id: 'sig-old', severity: 'medium', title: `Virendefinitionen sind ${d.signatureAgeDays} Tage alt`,
      explanation: 'Mit veralteten Definitionen erkennt Defender neue Schadsoftware schlechter.',
      recommendation: 'Installiere die ausstehenden Updates über Windows Update.',
      action: { kind: 'open', target: 'windowsUpdate', label: 'Windows Update öffnen' } })
  }
  if (d && d.quickScanAgeDays !== null && d.quickScanAgeDays > 14) {
    f.push({ id: 'scan-old', severity: 'low', title: `Letzter Schnellscan vor ${d.quickScanAgeDays} Tagen`,
      explanation: 'Normalerweise scannt Windows regelmäßig von selbst. Ein manueller Schnellscan dauert nur wenige Minuten.',
      recommendation: 'Starte einen Schnellscan.',
      action: { kind: 'cap', capId: 'security.quickScan', input: {}, label: 'Schnellscan starten' } })
  }
  for (const p of r.firewall.filter((x) => !x.enabled)) {
    f.push({ id: `fw-${p.name}`, severity: p.name === 'Public' ? 'high' : 'medium', title: `Firewall-Profil „${p.name}“ ist aus`,
      explanation: 'Ohne Firewall sind Dienste deines PCs im Netzwerk direkt erreichbar – besonders riskant in öffentlichen WLANs.',
      recommendation: 'Schalte die Firewall für dieses Profil wieder ein.',
      action: { kind: 'open', target: 'firewall', label: 'Firewall-Einstellungen öffnen' } })
  }
  if (r.uacEnabled === false) {
    f.push({ id: 'uac-off', severity: 'high', title: 'Benutzerkontensteuerung ist deaktiviert',
      explanation: 'Programme erhalten ohne Rückfrage volle Administratorrechte. Schadsoftware hat so leichtes Spiel.',
      recommendation: 'Aktiviere die Benutzerkontensteuerung (UAC) wieder. Dafür ist ein Neustart nötig.' })
  }
  if (r.lastUpdate?.installedOn) {
    const days = Math.floor((Date.now() - Date.parse(r.lastUpdate.installedOn)) / 86_400_000)
    if (days > 45) {
      f.push({ id: 'updates-old', severity: 'medium', title: `Letztes Windows-Update vor ${days} Tagen`,
        explanation: 'Microsoft schließt monatlich Sicherheitslücken. Ein so langer Abstand deutet darauf hin, dass Updates hängen.',
        recommendation: 'Öffne Windows Update und suche nach Updates.',
        action: { kind: 'open', target: 'windowsUpdate', label: 'Windows Update öffnen' } })
    }
  }
  for (const a of r.suspiciousAutostart) {
    const strong = a.suspicious.some((s) => /Temp|codiert/.test(s))
    f.push({ id: `as-${a.name}`, severity: strong ? 'high' : 'low', title: `Autostart: ${a.name}`,
      explanation: `${a.suspicious.join(' ')} Befehl: ${a.command}`,
      recommendation: strong ? 'Wenn du das Programm nicht kennst: Autostart deaktivieren und einen Virenscan starten.'
        : 'Wenn du das Programm kennst und brauchst, ist alles in Ordnung.',
      action: { kind: 'page', page: 'programs', label: 'Autostart verwalten' } })
  }
  for (const p of r.suspiciousProcesses) {
    f.push({ id: `proc-${p.pid}`, severity: 'high', title: `Ungewöhnlicher Prozess: ${p.name}`,
      explanation: `${p.reason} Pfad: ${p.path}`,
      recommendation: 'Starte einen Virenscan. Beende den Prozess nur, wenn du sicher bist, dass du ihn nicht brauchst.',
      action: { kind: 'cap', capId: 'security.quickScan', input: {}, label: 'Schnellscan starten' } })
  }
  return f.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

export async function pendingUpdates(): Promise<PendingUpdate[]> {
  const r = await ps<PendingUpdate[] | PendingUpdate | null>(`
    $s = New-Object -ComObject Microsoft.Update.Session
    $res = $s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0")
    $out = @(foreach ($u in $res.Updates) { [pscustomobject]@{ title = [string]$u.Title; severity = $u.MsrcSeverity; kb = (@($u.KBArticleIDs) -join ', ') } })`,
  {}, { timeoutMs: 240_000 })
  return arr(r)
}

export async function startQuickScan(): Promise<{ started: boolean; message: string }> {
  await ps('Start-MpScan -ScanType QuickScan -AsJob | Out-Null; $out = $true')
  return { started: true, message: 'Der Schnellscan läuft im Hintergrund. Ergebnisse meldet die Windows-Sicherheit.' }
}
