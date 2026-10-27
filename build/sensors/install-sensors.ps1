# =====================================================================
# Wird vom Nebula-Installer (mit Admin-Rechten) ausgeführt.
# Legt eine geplante Aufgabe an, die den Sensor-Dienst als SYSTEM beim
# Hochfahren startet: unsichtbar, ohne UAC-Abfrage, für alle Benutzer.
# =====================================================================
param(
  [Parameter(Mandatory = $true)][string]$LhmDir
)
$ErrorActionPreference = 'Stop'
$TaskName = 'Nebula Sensoren'
$exe = Join-Path $LhmDir 'LibreHardwareMonitor.exe'
if (-not (Test-Path $exe)) { throw "Nicht gefunden: $exe" }

# Laufende Instanz beenden (z. B. bei einem Update)
Get-Process -Name LibreHardwareMonitor -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 500

$action    = New-ScheduledTaskAction -Execute $exe -WorkingDirectory $LhmDir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
               -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew `
               -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Principal $principal -Settings $settings -Force | Out-Null

# Normalen Benutzern erlauben, die Aufgabe zu sehen und zu starten (ohne Admin).
# So kann Nebula den Dienst selbst neu starten, falls er einmal beendet wurde.
try {
  $service = New-Object -ComObject 'Schedule.Service'
  $service.Connect()
  $task = $service.GetFolder('\').GetTask($TaskName)
  $sddl = $task.GetSecurityDescriptor(0xF)
  if ($sddl -notmatch '\(A;;GRGX;;;AU\)') {
    $task.SetSecurityDescriptor($sddl + '(A;;GRGX;;;AU)', 0)
  }
} catch {
  Write-Warning "Berechtigung für Benutzer konnte nicht gesetzt werden: $_"
}

Start-ScheduledTask -TaskName $TaskName
Write-Host 'Sensor-Dienst eingerichtet und gestartet.'
