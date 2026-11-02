import type { DriverProblem, EventGroup, Finding, NetworkDiagnosis, RepairResult } from '@shared/types'
import { ps, psElevated } from '../core/powershell'
import { arr } from '../core/util'

const SFC = `
[Console]::OutputEncoding = [System.Text.Encoding]::Unicode
$o = & sfc.exe $A.flag
$script:code = $LASTEXITCODE
$o -join [Environment]::NewLine`

function summarizeSfc(output: string, code: number | null): { summary: string; ok: boolean | null } {
  const t = output.toLowerCase()
  if (/keine integritätsverletzungen|did not find any integrity violations/.test(t)) return { summary: 'Keine beschädigten Systemdateien gefunden.', ok: true }
  if (/erfolgreich repariert|successfully repaired/.test(t)) return { summary: 'Beschädigte Systemdateien wurden gefunden und repariert. Ein Neustart wird empfohlen.', ok: true }
  if (/konnte einige|unable to fix|nicht reparieren/.test(t)) return { summary: 'Beschädigte Dateien gefunden, die SFC nicht reparieren konnte. Als Nächstes DISM „Abbild wiederherstellen“ ausführen, dann SFC erneut.', ok: false }
  if (/integritätsverletzungen|integrity violations/.test(t)) return { summary: 'SFC hat Integritätsverletzungen gefunden. Eine Reparatur mit „sfc /scannow“ wird empfohlen.', ok: false }
  if (/ausstehende|pending/.test(t)) return { summary: 'Eine Systemreparatur wartet auf einen Neustart. Bitte neu starten und erneut prüfen.', ok: null }
  return { summary: code === 0 ? 'Prüfung abgeschlossen.' : 'Prüfung beendet – das Ergebnis ist unklar, siehe Ausgabe.', ok: code === 0 ? null : false }
}

export async function runSfc(mode: 'verify' | 'repair'): Promise<RepairResult> {
  const { output, exitCode } = await psElevated(SFC, { flag: mode === 'verify' ? '/verifyonly' : '/scannow' }, 60 * 60_000)
  return { kind: `sfc-${mode}`, exitCode, output: tidy(output), ...summarizeSfc(output, exitCode) }
}

const DISM = `
$o = & dism.exe /Online /Cleanup-Image $A.flag /English
$script:code = $LASTEXITCODE
$o -join [Environment]::NewLine`

export async function runDism(mode: 'check' | 'scan' | 'restore'): Promise<RepairResult> {
  const flag = { check: '/CheckHealth', scan: '/ScanHealth', restore: '/RestoreHealth' }[mode]
  const { output, exitCode } = await psElevated(DISM, { flag }, 90 * 60_000)
  const t = output.toLowerCase()
  let summary = 'DISM ist fertig.'
  let ok: boolean | null = exitCode === 0
  if (/no component store corruption detected/.test(t)) summary = 'Das Windows-Komponentenabbild ist in Ordnung.'
  else if (/component store is repairable/.test(t)) { summary = 'Das Abbild ist beschädigt, aber reparierbar. Führe „Abbild wiederherstellen“ aus.'; ok = false }
  else if (/restore operation completed successfully/.test(t)) summary = 'Das Abbild wurde repariert. Führe danach SFC aus.'
  else if (/source files could not be found/.test(t)) { summary = 'DISM fand keine Quelldateien. Prüfe die Internetverbindung und versuche es erneut.'; ok = false }
  else if (exitCode !== 0) summary = `DISM meldet einen Fehler (Code ${exitCode}).`
  return { kind: `dism-${mode}`, exitCode, output: tidy(output), summary, ok }
}

function tidy(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trimEnd()).filter((l, i, a) => l || a[i - 1]).join('\n').slice(-12_000)
}

interface RawNetwork {
  adapters: NetworkDiagnosis['adapters'] | NetworkDiagnosis['adapters'][number] | null
  configs: NetworkDiagnosis['configs'] | NetworkDiagnosis['configs'][number] | null
  gatewayReachable: boolean
  internetReachable: boolean
  dnsWorks: boolean
}

export async function diagnoseNetwork(): Promise<NetworkDiagnosis> {
  const r = await ps<RawNetwork>(`
    $ad = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne 'Disabled' } | ForEach-Object {
      [pscustomobject]@{ name = [string]$_.Name; description = [string]$_.InterfaceDescription; status = [string]$_.Status; linkSpeed = [string]$_.LinkSpeed } })
    $cfg = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object {
      [pscustomobject]@{ alias = [string]$_.InterfaceAlias; ipv4 = (@($_.IPv4Address.IPAddress) -join ', '); gateway = [string]@($_.IPv4DefaultGateway.NextHop)[0]; dns = (@($_.DNSServer.ServerAddresses) -join ', ') } })
    $gwOk = $false
    if ($cfg.Count -gt 0) { $gwOk = Test-Connection -ComputerName $cfg[0].gateway -Count 2 -Quiet -ErrorAction SilentlyContinue }
    $netOk = Test-Connection -ComputerName '1.1.1.1' -Count 2 -Quiet -ErrorAction SilentlyContinue
    if (-not $netOk) { $netOk = Test-Connection -ComputerName '8.8.8.8' -Count 2 -Quiet -ErrorAction SilentlyContinue }
    $dnsOk = $false
    try { Resolve-DnsName -Name 'www.microsoft.com' -DnsOnly -ErrorAction Stop | Out-Null; $dnsOk = $true } catch {}
    $out = [pscustomobject]@{ adapters = $ad; configs = $cfg; gatewayReachable = [bool]$gwOk; internetReachable = [bool]$netOk; dnsWorks = $dnsOk }`,
  {}, { timeoutMs: 60_000 })

  const adapters = arr(r.adapters)
  const configs = arr(r.configs)
  const findings: Finding[] = []
  let verdict: string
  const up = adapters.filter((a) => a.status === 'Up')

  if (up.length === 0) {
    verdict = 'Kein Netzwerkadapter ist verbunden.'
    findings.push({ id: 'no-link', severity: 'high', title: 'Keine Verbindung', explanation: 'Weder WLAN noch Kabel sind aktuell verbunden.',
      recommendation: 'Prüfe, ob das WLAN eingeschaltet ist (Flugmodus?) oder das Netzwerkkabel steckt.' })
  } else if (configs.length === 0) {
    verdict = 'Verbunden, aber ohne Router-Adresse.'
    findings.push({ id: 'no-gw', severity: 'high', title: 'Keine IP-Konfiguration vom Router',
      explanation: 'Der Adapter ist verbunden, hat aber keinen Standardgateway erhalten. Meist liefert der Router keine Adresse (DHCP).',
      recommendation: 'Router neu starten oder die WLAN-Verbindung trennen und neu verbinden.' })
  } else if (!r.gatewayReachable && !r.internetReachable) {
    verdict = 'Der Router antwortet nicht.'
    findings.push({ id: 'gw-down', severity: 'high', title: 'Router nicht erreichbar',
      explanation: `Der Router (${configs[0]?.gateway}) antwortet nicht. Manche Router ignorieren Pings – wenn das Internet trotzdem geht, ist alles in Ordnung.`,
      recommendation: 'Router neu starten und die Verbindung prüfen.' })
  } else if (!r.internetReachable) {
    verdict = 'Das lokale Netz funktioniert, das Internet nicht.'
    findings.push({ id: 'isp', severity: 'high', title: 'Kein Internetzugang hinter dem Router',
      explanation: 'Dein PC erreicht den Router, aber nicht das Internet. Das Problem liegt meist beim Router oder Anbieter.',
      recommendation: 'Router neu starten. Hilft das nicht, Störungsmeldungen deines Anbieters prüfen.' })
  } else if (!r.dnsWorks) {
    verdict = 'Internet funktioniert, aber Namen werden nicht aufgelöst (DNS).'
    findings.push({ id: 'dns', severity: 'medium', title: 'DNS-Problem',
      explanation: 'Webseiten-Adressen können nicht in IP-Adressen übersetzt werden. Oft hilft das Leeren des DNS-Zwischenspeichers.',
      recommendation: 'DNS-Cache leeren. Hilft das nicht, im Router einen anderen DNS-Server eintragen.',
      action: { kind: 'cap', capId: 'repair.flushDns', input: {}, label: 'DNS-Cache leeren' } })
  } else {
    verdict = 'Netzwerk und Internet funktionieren.'
  }
  return { adapters, configs, gatewayReachable: r.gatewayReachable, internetReachable: r.internetReachable, dnsWorks: r.dnsWorks, verdict, findings }
}

export async function flushDns(): Promise<{ ok: boolean }> {
  await ps('Clear-DnsClientCache; $out = $true')
  return { ok: true }
}

const DEVICE_CODES: Record<number, string> = {
  1: 'Das Gerät ist nicht richtig konfiguriert. Treiber neu installieren.',
  3: 'Der Treiber ist beschädigt oder dem System fehlt Arbeitsspeicher.',
  10: 'Das Gerät kann nicht starten. Meist hilft ein aktueller Treiber vom Hersteller.',
  12: 'Das Gerät findet nicht genügend freie Ressourcen.',
  14: 'Das Gerät funktioniert erst nach einem Neustart richtig.',
  18: 'Treiber für dieses Gerät neu installieren.',
  19: 'Die Konfiguration in der Registrierung ist beschädigt.',
  21: 'Windows entfernt das Gerät gerade. Neustart abwarten.',
  22: 'Das Gerät wurde deaktiviert. Im Geräte-Manager wieder aktivieren, falls benötigt.',
  24: 'Das Gerät ist nicht vorhanden oder funktioniert nicht richtig.',
  28: 'Für das Gerät ist kein Treiber installiert.',
  31: 'Windows kann den Treiber nicht laden.',
  39: 'Der Treiber ist beschädigt oder fehlt.',
  43: 'Windows hat das Gerät angehalten, weil es Probleme gemeldet hat (häufig bei USB-Geräten und Grafikkarten).',
  48: 'Der Treiber wurde wegen bekannter Probleme blockiert. Aktuellere Version vom Hersteller installieren.',
  52: 'Die digitale Signatur des Treibers konnte nicht überprüft werden.'
}

export async function driverProblems(): Promise<DriverProblem[]> {
  const r = await ps<Array<{ name: string; deviceId: string; code: number }> | { name: string; deviceId: string; code: number } | null>(`
    $out = @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop | Where-Object { $_.ConfigManagerErrorCode -ne 0 -and $_.ConfigManagerErrorCode -ne 45 } | ForEach-Object {
      [pscustomobject]@{ name = $(if ($_.Name) { [string]$_.Name } else { [string]$_.DeviceID }); deviceId = [string]$_.DeviceID; code = [int]$_.ConfigManagerErrorCode } })`,
  {}, { timeoutMs: 60_000 })
  return arr(r).map((d) => ({ ...d, explanation: DEVICE_CODES[d.code] ?? `Fehlercode ${d.code} – Details im Geräte-Manager.` }))
}

export async function recentErrors(days = 3): Promise<EventGroup[]> {
  const r = await ps<EventGroup[] | EventGroup | null>(`
    $since = (Get-Date).AddDays(-[int]$A.days)
    $ev = @(Get-WinEvent -FilterHashtable @{ LogName = 'System','Application'; Level = 1,2; StartTime = $since } -MaxEvents 400 -ErrorAction SilentlyContinue)
    $out = @($ev | Group-Object ProviderName, Id | Sort-Object Count -Descending | Select-Object -First 25 | ForEach-Object {
      $e = $_.Group[0]
      $msg = if ($e.Message) { ($e.Message -split [Environment]::NewLine)[0] } else { '' }
      [pscustomobject]@{ provider = [string]$e.ProviderName; id = [int]$e.Id; level = [string]$e.LevelDisplayName; count = $_.Count; lastTime = $e.TimeCreated.ToString('o'); message = $msg.Substring(0, [Math]::Min(300, $msg.Length)) } })`,
  { days: Math.min(30, Math.max(1, days)) }, { timeoutMs: 90_000 })
  return arr(r)
}
