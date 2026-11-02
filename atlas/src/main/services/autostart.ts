import type { AutostartEntry, AutostartHive, AutostartKey } from '@shared/types'
import { log } from '../core/log'
import { ps, psElevated } from '../core/powershell'
import { arr } from '../core/util'

/** Gemeinsame Hilfsfunktionen: Pfad aus Befehl ziehen, Signatur prüfen. */
export const PS_HELPERS = `
function Get-ExePath([string]$cmd) {
  if (-not $cmd) { return $null }
  $c = [Environment]::ExpandEnvironmentVariables($cmd.Trim())
  if ($c.StartsWith('"')) { $e = $c.IndexOf('"', 1); if ($e -gt 1) { return $c.Substring(1, $e - 1) } }
  $i = $c.ToLower().IndexOf('.exe'); if ($i -gt 0) { return $c.Substring(0, $i + 4) }
  return ($c -split ' ')[0]
}
function Get-Sig([string]$p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { return @{ status = 'Missing'; signer = $null } }
  try {
    $s = Get-AuthenticodeSignature -LiteralPath $p
    $signer = $null
    if ($s.SignerCertificate) { $signer = ($s.SignerCertificate.Subject -replace '^CN="?([^",]+).*', '$1') }
    return @{ status = [string]$s.Status; signer = $signer }
  } catch { return @{ status = 'Unknown'; signer = $null } }
}
`

const LIST_SCRIPT = `
${PS_HELPERS}
function Get-Quick([string]$p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { return @{ status = 'Missing'; signer = $null } }
  return @{ status = 'Unchecked'; signer = $null }
}
function Get-Enabled($hive, $sub, $name) {
  $k = "$hive\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\$sub"
  try { $v = (Get-ItemProperty -LiteralPath $k -Name $name -ErrorAction Stop).$name; return (($v[0] % 2) -eq 0) } catch { return $true }
}
$out = @()
$sources = @(
  @{ path = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; hive = 'HKCU:'; key = 'Run'; scope = 'user'; label = 'Registrierung (Benutzer)' },
  @{ path = 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'; hive = 'HKLM:'; key = 'Run'; scope = 'machine'; label = 'Registrierung (alle Benutzer)' },
  @{ path = 'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; hive = 'HKLM:'; key = 'Run32'; scope = 'machine'; label = 'Registrierung (32-Bit)' }
)
foreach ($s in $sources) {
  if (-not (Test-Path -LiteralPath $s.path)) { continue }
  $item = Get-Item -LiteralPath $s.path
  foreach ($n in $item.GetValueNames()) {
    if (-not $n) { continue }
    $cmd = [string]$item.GetValue($n)
    $exe = Get-ExePath $cmd
    $sig = Get-Quick $exe
    $out += [pscustomobject]@{ name = $n; command = $cmd; source = $s.label; scope = $s.scope; hive = $s.hive; approvedKey = $s.key;
      exePath = $exe; signature = $sig.status; signer = $sig.signer; enabled = (Get-Enabled $s.hive $s.key $n) }
  }
}
$folders = @(
  @{ path = [Environment]::GetFolderPath('Startup'); hive = 'HKCU:'; scope = 'user'; label = 'Autostart-Ordner (Benutzer)' },
  @{ path = [Environment]::GetFolderPath('CommonStartup'); hive = 'HKLM:'; scope = 'machine'; label = 'Autostart-Ordner (alle Benutzer)' }
)
$shell = New-Object -ComObject WScript.Shell
foreach ($f in $folders) {
  if (-not $f.path -or -not (Test-Path -LiteralPath $f.path)) { continue }
  foreach ($file in (Get-ChildItem -LiteralPath $f.path -File -Force)) {
    if ($file.Name -eq 'desktop.ini') { continue }
    $target = $file.FullName
    if ($file.Extension -eq '.lnk') { $t = $shell.CreateShortcut($file.FullName).TargetPath; if ($t) { $target = $t } }
    $sig = Get-Quick $target
    $out += [pscustomobject]@{ name = $file.Name; command = $target; source = $f.label; scope = $f.scope; hive = $f.hive; approvedKey = 'StartupFolder';
      exePath = $target; signature = $sig.status; signer = $sig.signer; enabled = (Get-Enabled $f.hive 'StartupFolder' $file.Name) }
  }
}`

const SUSPICIOUS_PATH = /\\(temp|tmp|downloads)\\|\\appdata\\local\\temp\\|\\users\\public\\/i
const SCRIPT_HOSTS = /\b(powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32)(\.exe)?\b/i

export function assessAutostart(e: Omit<AutostartEntry, 'suspicious'>): string[] {
  const reasons: string[] = []
  if (e.signature === 'Missing') reasons.push('Die Zieldatei existiert nicht mehr (verwaister Eintrag).')
  else if (e.signature !== 'Valid' && e.signature !== 'Unchecked') reasons.push('Die Datei ist nicht gültig digital signiert.')
  if (e.exePath && SUSPICIOUS_PATH.test(e.exePath)) reasons.push('Startet aus einem Temp-, Download- oder öffentlichen Ordner.')
  if (SCRIPT_HOSTS.test(e.command)) reasons.push('Startet über einen Skript-Host – typisch für Schadsoftware, aber auch für manche Tools.')
  if (/-enc(odedcommand)?\s/i.test(e.command)) reasons.push('Enthält einen verschleierten (codierten) PowerShell-Befehl.')
  return reasons
}

interface SigResult { status: string; signer: string | null; at: number }
const sigCache = new Map<string, SigResult>()
const SIG_TTL_MS = 6 * 3_600_000

/**
 * Prüft digitale Signaturen – das ist langsam (Windows fragt teils online nach), deshalb werden
 * Ergebnisse 6 Stunden gemerkt und nur neue Dateien geprüft.
 */
export async function verifySignatures(paths: string[]): Promise<Map<string, SigResult>> {
  const unique = [...new Set(paths.filter(Boolean))]
  const fresh = (p: string): boolean => {
    const c = sigCache.get(p.toLowerCase())
    return !!c && Date.now() - c.at < SIG_TTL_MS
  }
  const need = unique.filter((p) => !fresh(p))
  if (need.length > 0) {
    const r = await ps<Array<{ path: string; status: string; signer: string | null }> | { path: string; status: string; signer: string | null } | null>(`
      ${PS_HELPERS}
      $out = @(foreach ($p in $A.paths) { $r = Get-Sig $p; [pscustomobject]@{ path = $p; status = $r.status; signer = $r.signer } })`,
    { paths: need }, { timeoutMs: 90_000 })
    for (const x of arr(r)) sigCache.set(x.path.toLowerCase(), { status: x.status, signer: x.signer, at: Date.now() })
  }
  const out = new Map<string, SigResult>()
  for (const p of unique) {
    const c = sigCache.get(p.toLowerCase())
    if (c) out.set(p, c)
  }
  return out
}

/**
 * Autostart-Einträge. Ohne Signaturprüfung dauert das nur Sekundenbruchteile (für Optimierung und
 * Messpunkte); mit Signaturprüfung (Standard) werden zusätzlich unsignierte Programme erkannt.
 */
export async function listAutostart(opts: { signatures?: boolean } = {}): Promise<AutostartEntry[]> {
  const raw = arr(await ps<Array<Omit<AutostartEntry, 'suspicious'>> | Omit<AutostartEntry, 'suspicious'> | null>(LIST_SCRIPT, {}, { timeoutMs: 60_000 }))
  if (opts.signatures ?? true) {
    const targets = raw.filter((e) => e.enabled && e.exePath && e.signature !== 'Missing').map((e) => e.exePath as string)
    try {
      const sigs = await verifySignatures(targets)
      for (const e of raw) {
        const r = e.exePath ? sigs.get(e.exePath) : undefined
        if (r) { e.signature = r.status; e.signer = r.signer }
      }
    } catch (err) {
      log('warn', 'Autostart', `Signaturprüfung nicht möglich – ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return raw.map((e) => ({ ...e, suspicious: assessAutostart(e) }))
}

const SET_SCRIPT = `
$ErrorActionPreference = 'Stop'
$k = "$($A.hive)\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\$($A.approvedKey)"
if (-not (Test-Path -LiteralPath $k)) { New-Item -Path $k -Force | Out-Null }
$bytes = New-Object byte[] 12
$bytes[0] = if ($A.enable) { 2 } else { 3 }
New-ItemProperty -LiteralPath $k -Name $A.name -PropertyType Binary -Value $bytes -Force | Out-Null
$out = $A.enable`

/**
 * Aktiviert/deaktiviert einen Autostart-Eintrag über denselben Mechanismus wie der
 * Task-Manager (StartupApproved). Der Eintrag selbst bleibt erhalten – voll umkehrbar.
 */
export async function setAutostart(hive: AutostartHive, approvedKey: AutostartKey, name: string, enable: boolean): Promise<{ enabled: boolean }> {
  const args = { hive, approvedKey, name, enable }
  if (hive === 'HKCU:') {
    await ps(SET_SCRIPT, args)
  } else {
    const r = await psElevated(SET_SCRIPT.replace('$out = $A.enable', '$script:code = 0; "ok"'), args, 120_000)
    if (r.exitCode !== 0) throw new Error(`Änderung fehlgeschlagen: ${r.output.slice(0, 300)}`)
  }
  return { enabled: enable }
}
