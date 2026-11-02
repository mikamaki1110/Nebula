import { ps } from '../core/powershell'

/**
 * „Turbo“ für Ollama: Flash Attention und ein auf 8 Bit komprimierter Zwischenspeicher für den Gesprächsverlauf
 * (OLLAMA_KV_CACHE_TYPE=q8_0). Das halbiert den Grafikspeicher, den der Verlauf braucht – oft der Unterschied zwischen
 * „läuft komplett auf der Grafikkarte“ und „ein Teil läuft auf dem Prozessor“. Ollama übernimmt die Werte erst nach einem
 * Neustart; unterstützt ein Modell oder eine Grafikkarte das nicht, fällt Ollama selbst auf den Standard zurück.
 *
 * Es werden nur Benutzer-Umgebungsvariablen gesetzt (keine Administratorrechte nötig) und beim Ausschalten wieder entfernt.
 */
export const TURBO_VARS = { OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' } as const

const STATUS_SCRIPT = `
$fa = [Environment]::GetEnvironmentVariable('OLLAMA_FLASH_ATTENTION', 'User')
$kv = [Environment]::GetEnvironmentVariable('OLLAMA_KV_CACHE_TYPE', 'User')
$out = [pscustomobject]@{ enabled = (($fa -eq '1') -and ($kv -eq 'q8_0')) }`

const SET_SCRIPT = `
$vars = @{ OLLAMA_FLASH_ATTENTION = '1'; OLLAMA_KV_CACHE_TYPE = 'q8_0' }
foreach ($k in $vars.Keys) {
  if ($A.enable) {
    [Environment]::SetEnvironmentVariable($k, $vars[$k], 'User')
    Set-Item -Path ('Env:' + $k) -Value $vars[$k]
  } else {
    [Environment]::SetEnvironmentVariable($k, $null, 'User')
    Remove-Item -Path ('Env:' + $k) -ErrorAction SilentlyContinue
  }
}
# Ollama neu starten, damit es die Werte übernimmt (nur, wenn es gerade läuft)
$running = @(Get-Process -Name 'ollama app', 'ollama' -ErrorAction SilentlyContinue)
$restarted = $false
if ($running.Count -gt 0) {
  $running | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  $app = Join-Path $env:LOCALAPPDATA 'Programs\\Ollama\\ollama app.exe'
  if (Test-Path -LiteralPath $app) {
    Start-Process -FilePath $app
    $restarted = $true
  } else {
    $exe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if ($exe) { Start-Process -FilePath $exe -ArgumentList 'serve' -WindowStyle Hidden; $restarted = $true }
  }
}
$out = [pscustomobject]@{ enabled = [bool]$A.enable; wasRunning = ($running.Count -gt 0); restarted = $restarted }`

export async function turboStatus(): Promise<{ enabled: boolean }> {
  const r = await ps<{ enabled: boolean }>(STATUS_SCRIPT, {}, { timeoutMs: 15_000 })
  return { enabled: !!r?.enabled }
}

export async function setTurbo(enable: boolean): Promise<{ enabled: boolean; wasRunning: boolean; restarted: boolean }> {
  return ps<{ enabled: boolean; wasRunning: boolean; restarted: boolean }>(SET_SCRIPT, { enable }, { timeoutMs: 40_000 })
}
