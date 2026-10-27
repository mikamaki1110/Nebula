# =====================================================================
# Lädt beim BAUEN den Sensor-Dienst herunter, damit er in die Setup-EXE
# gepackt wird. Deine Nutzer müssen dadurch nichts extra herunterladen.
#
#   vendor/lhm/              -> LibreHardwareMonitor (MPL-2.0)
#   vendor/PawnIO_setup.exe  -> Treiber für Temperatursensoren
#
# Wird automatisch von GitHub Actions und EXE-BAUEN.bat aufgerufen.
# =====================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # macht Invoke-WebRequest deutlich schneller

$LhmVersion = 'v0.9.6'
$LhmUrl     = "https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases/download/$LhmVersion/LibreHardwareMonitor.zip"
$PawnIoUrl  = 'https://github.com/namazso/PawnIO.Setup/releases/latest/download/PawnIO_setup.exe'

$root   = Split-Path -Parent $PSScriptRoot
$vendor = Join-Path $root 'vendor'
$lhmDir = Join-Path $vendor 'lhm'

if (Test-Path $vendor) { Remove-Item $vendor -Recurse -Force }
New-Item -ItemType Directory -Force -Path $lhmDir | Out-Null

Write-Host "LibreHardwareMonitor $LhmVersion wird geladen..."
$zip = Join-Path $vendor 'lhm.zip'
Invoke-WebRequest -Uri $LhmUrl -OutFile $zip -UseBasicParsing
Expand-Archive -LiteralPath $zip -DestinationPath $lhmDir -Force
Remove-Item $zip -Force

# Falls das Archiv einen Unterordner hat: Inhalt nach vendor/lhm hochziehen
$exe = Get-ChildItem -Path $lhmDir -Recurse -Filter 'LibreHardwareMonitor.exe' | Select-Object -First 1
if (-not $exe) { throw 'LibreHardwareMonitor.exe wurde im Download nicht gefunden.' }
if ($exe.DirectoryName -ne (Resolve-Path $lhmDir).Path) {
  Get-ChildItem -Path $exe.DirectoryName -Force | Move-Item -Destination $lhmDir -Force
}

# Vorkonfiguration: Webserver an, nur lokal erreichbar, Fenster unsichtbar
Copy-Item -Path (Join-Path $PSScriptRoot 'sensors\LibreHardwareMonitor.config') -Destination $lhmDir -Force

Write-Host 'PawnIO-Treiber wird geladen...'
Invoke-WebRequest -Uri $PawnIoUrl -OutFile (Join-Path $vendor 'PawnIO_setup.exe') -UseBasicParsing

Write-Host 'Sensor-Dienst ist bereit zum Einpacken.'
