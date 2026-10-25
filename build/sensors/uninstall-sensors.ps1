# Wird beim Deinstallieren (und vor Updates) mit Admin-Rechten ausgeführt.
# Beendet den Sensor-Dienst und entfernt die geplante Aufgabe.
# Der PawnIO-Treiber bleibt installiert, weil ihn auch andere Programme nutzen können.
$ErrorActionPreference = 'SilentlyContinue'
Stop-ScheduledTask -TaskName 'Nebula Sensoren'
Get-Process -Name LibreHardwareMonitor | Stop-Process -Force
Unregister-ScheduledTask -TaskName 'Nebula Sensoren' -Confirm:$false
exit 0
