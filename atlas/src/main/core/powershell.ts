import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

export class PowerShellError extends Error {}

interface RunOptions { timeoutMs?: number }

/**
 * Führt ein festes PowerShell-Skript aus. Benutzerwerte werden NIE in den
 * Skripttext eingesetzt, sondern als JSON über die Umgebungsvariable
 * ATLAS_ARGS übergeben und im Skript als $A gelesen. Das verhindert Injection.
 * Das Skript setzt sein Ergebnis in die Variable $out.
 */
export async function ps<T>(script: string, args: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<T> {
  const wrapped = [
    "$ErrorActionPreference = 'Stop'",
    '$ProgressPreference = "SilentlyContinue"',
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$A = $env:ATLAS_ARGS | ConvertFrom-Json',
    '$out = $null',
    script,
    'if ($null -eq $out) { "null" } else { ConvertTo-Json -InputObject $out -Depth 6 -Compress }'
  ].join('\n')
  const stdout = await runRaw(wrapped, JSON.stringify(args), opts.timeoutMs ?? 60_000)
  const text = stdout.trim()
  if (!text) return null as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new PowerShellError(`Unerwartete Ausgabe von PowerShell: ${text.slice(0, 200)}`)
  }
}

function runRaw(script: string, argsJson: string, timeoutMs: number): Promise<string> {
  if (process.platform !== 'win32') {
    return Promise.reject(new PowerShellError('Diese Funktion ist nur unter Windows verfügbar.'))
  }
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, env: { ...process.env, ATLAS_ARGS: argsJson } }
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new PowerShellError(`Zeitüberschreitung nach ${Math.round(timeoutMs / 1000)} Sekunden.`))
    }, timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d))
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new PowerShellError(`PowerShell konnte nicht gestartet werden: ${e.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new PowerShellError(cleanError(err) || `PowerShell beendet mit Code ${code}`))
    })
  })
}

function cleanError(s: string): string {
  const line = s.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('At ') && !l.startsWith('In '))
  return (line ?? s).trim().slice(0, 400)
}

/**
 * Führt ein Skript mit Administratorrechten aus. Windows zeigt dafür die
 * UAC-Abfrage – der Benutzer muss aktiv zustimmen. Rückgabe: Textausgabe.
 */
export async function psElevated(script: string, args: Record<string, unknown>, timeoutMs: number): Promise<{ output: string; exitCode: number | null }> {
  const id = randomUUID()
  const dir = tmpdir()
  const argsFile = join(dir, `atlas-${id}.json`)
  const outFile = join(dir, `atlas-${id}.out.txt`)
  const scriptFile = join(dir, `atlas-${id}.ps1`)
  const q = (p: string): string => `'${p.replace(/'/g, "''")}'`

  await writeFile(argsFile, JSON.stringify(args), 'utf8')
  const body = [
    `$A = Get-Content -Raw -LiteralPath ${q(argsFile)} | ConvertFrom-Json`,
    '$code = $null',
    '$text = & {',
    '  try {',
    script,
    '  } catch { $script:code = 1; "FEHLER: " + $_.Exception.Message }',
    '} 2>&1 | Out-String',
    `Set-Content -LiteralPath ${q(outFile)} -Value ("EXIT:" + $code + [Environment]::NewLine + $text) -Encoding UTF8`
  ].join('\n')
  // UTF-8 mit BOM, damit Windows PowerShell 5.1 Umlaute korrekt liest.
  await writeFile(scriptFile, '\ufeff' + body, 'utf8')

  try {
    await ps(
      "Start-Process -FilePath 'powershell.exe' -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File', $A.file)",
      { file: scriptFile },
      { timeoutMs }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/abgebrochen|canceled|cancelled/i.test(msg)) throw new PowerShellError('Die Administrator-Anfrage wurde abgelehnt.')
    throw e
  }

  try {
    const raw = (await readFile(outFile, 'utf8')).replace(/^\ufeff/, '')
    const [first, ...rest] = raw.split(/\r?\n/)
    const parsed = Number((first ?? '').replace('EXIT:', '').trim())
    return { output: rest.join('\n').replace(/\u0000/g, '').trim(), exitCode: Number.isFinite(parsed) && first !== 'EXIT:' ? parsed : null }
  } catch {
    throw new PowerShellError('Der Vorgang lieferte kein Ergebnis. Wurde die Administrator-Anfrage bestätigt?')
  } finally {
    await Promise.all([argsFile, outFile, scriptFile].map((f) => rm(f, { force: true })))
  }
}
