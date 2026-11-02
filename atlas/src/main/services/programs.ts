import { stat } from 'fs/promises'
import { join } from 'path'
import type { FileEntry, Program } from '@shared/types'
import { ps } from '../core/powershell'
import { walkFiles } from './walk'

interface RawProgram {
  id: string; name: string; version: string | null; publisher: string | null; installDate: string | null
  sizeKB: number | null; installLocation: string | null; hasUninstall: boolean
}

const LIST_SCRIPT = `
$keys = @(
  'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
)
$out = @(Get-ItemProperty -Path $keys -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and $_.SystemComponent -ne 1 -and -not $_.ParentKeyName -and -not $_.ReleaseType } |
  ForEach-Object {
    [pscustomobject]@{
      id = [string]$_.PSPath
      name = [string]$_.DisplayName
      version = $_.DisplayVersion
      publisher = $_.Publisher
      installDate = $_.InstallDate
      sizeKB = $_.EstimatedSize
      installLocation = $_.InstallLocation
      hasUninstall = [bool]($_.UninstallString -or $_.QuietUninstallString)
    }
  })`

function formatDate(d: string | null): string | null {
  if (!d || !/^\d{8}$/.test(d)) return null
  return `${d.slice(6, 8)}.${d.slice(4, 6)}.${d.slice(0, 4)}`
}

export async function listPrograms(query?: string): Promise<Program[]> {
  const raw = (await ps<RawProgram[] | null>(LIST_SCRIPT)) ?? []
  const seen = new Set<string>()
  const q = query?.toLowerCase().trim()
  return raw
    .filter((r) => {
      const key = `${r.name}|${r.version ?? ''}`.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return !q || r.name.toLowerCase().includes(q) || (r.publisher ?? '').toLowerCase().includes(q)
    })
    .map((r) => ({
      id: r.id,
      name: r.name.trim(),
      version: r.version,
      publisher: r.publisher,
      installDate: formatDate(r.installDate),
      sizeBytes: typeof r.sizeKB === 'number' ? r.sizeKB * 1024 : null,
      installLocation: r.installLocation ? r.installLocation.replace(/"/g, '').trim() || null : null,
      canUninstall: r.hasUninstall
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

const ID_PATTERN = /^Microsoft\.PowerShell\.Core\\Registry::HKEY_(LOCAL_MACHINE|CURRENT_USER)\\SOFTWARE\\(WOW6432Node\\)?Microsoft\\Windows\\CurrentVersion\\Uninstall\\[^\\]+$/i

export function assertProgramId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error('Ungültige Programmkennung.')
  return id
}

/**
 * Startet das Deinstallationsprogramm des Herstellers und wartet darauf.
 * Der Hersteller-Dialog erscheint sichtbar; Windows fragt bei Bedarf nach Adminrechten.
 */
export async function uninstallProgram(id: string): Promise<{ exitCode: number | null; stillInstalled: boolean }> {
  assertProgramId(id)
  return ps<{ exitCode: number | null; stillInstalled: boolean }>(`
    $p = Get-ItemProperty -LiteralPath $A.id
    $cmd = if ($p.UninstallString) { [string]$p.UninstallString } else { [string]$p.QuietUninstallString }
    if (-not $cmd) { throw 'Für dieses Programm ist kein Deinstallationsbefehl hinterlegt.' }
    $cmd = [Environment]::ExpandEnvironmentVariables($cmd.Trim())
    if ($cmd -match '(?i)msiexec(\\.exe)?\\s+.*?(\\{[0-9A-F\\-]{36}\\})') {
      $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/x', $Matches[2]) -Wait -PassThru
    } else {
      if ($cmd.StartsWith('"')) {
        $end = $cmd.IndexOf('"', 1)
        $exe = $cmd.Substring(1, $end - 1); $rest = $cmd.Substring($end + 1).Trim()
      } else {
        $i = $cmd.ToLower().IndexOf('.exe')
        if ($i -lt 0) { throw 'Der Deinstallationsbefehl hat ein unbekanntes Format.' }
        $exe = $cmd.Substring(0, $i + 4); $rest = $cmd.Substring($i + 4).Trim()
      }
      if (-not (Test-Path -LiteralPath $exe)) { throw "Das Deinstallationsprogramm wurde nicht gefunden: $exe" }
      if ($rest) { $proc = Start-Process -FilePath $exe -ArgumentList $rest -Wait -PassThru }
      else { $proc = Start-Process -FilePath $exe -Wait -PassThru }
    }
    Start-Sleep -Seconds 2
    $out = [pscustomobject]@{ exitCode = $proc.ExitCode; stillInstalled = (Test-Path -LiteralPath $A.id) }`,
  { id }, { timeoutMs: 30 * 60_000 })
}

/**
 * Sucht Ordner, die nach einer Deinstallation übrig geblieben sein könnten.
 * Es wird nur gesucht – entfernt wird erst nach Auswahl und Bestätigung.
 */
export async function findLeftovers(name: string, publisher?: string, installLocation?: string): Promise<FileEntry[]> {
  const words = [name, publisher]
    .filter((x): x is string => !!x)
    .map((x) => x.replace(/\(.*?\)|\b(inc|ltd|gmbh|llc|corporation|corp|version|x64|x86|64-bit|32-bit)\b\.?|[\d.]+$/gi, '').trim())
    .filter((x) => x.length >= 4)
  const needles = [...new Set(words.map((w) => w.toLowerCase()))]
  const env = process.env
  const roots = [env['APPDATA'], env['LOCALAPPDATA'], env['ProgramData'], env['ProgramFiles'], env['ProgramFiles(x86)'],
    env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Programs') : undefined].filter((x): x is string => !!x)

  const hits = new Map<string, FileEntry>()
  const add = async (path: string, entryName: string): Promise<void> => {
    try {
      const s = await stat(path)
      let size = 0
      await walkFiles(path, (_p, _n, sz) => (size += sz), { maxSeconds: 5 })
      hits.set(path.toLowerCase(), { path, name: entryName, size, mtime: s.mtimeMs, isDir: s.isDirectory() })
    } catch {
      /* nicht vorhanden */
    }
  }
  if (installLocation) await add(installLocation, installLocation)
  if (needles.length > 0) {
    for (const root of roots) {
      const { readdir } = await import('fs/promises')
      let entries: string[] = []
      try {
        entries = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        continue
      }
      for (const entry of entries) {
        if (needles.some((n) => entry.toLowerCase() === n || entry.toLowerCase().startsWith(n + ' '))) {
          await add(join(root, entry), entry)
        }
      }
    }
  }
  return [...hits.values()]
}
