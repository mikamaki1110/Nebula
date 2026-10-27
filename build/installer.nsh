; =====================================================================
; Nebula - Zusatzschritte fuer den Windows-Installer (NSIS)
; electron-builder bindet diese Datei automatisch ein.
; Der Installer laeuft mit Admin-Rechten (perMachine), daher klappt hier
; alles ohne weitere Abfragen.
; =====================================================================

; Vor dem Kopieren: laufenden Sensor-Dienst beenden, damit seine Dateien
; bei einem Update ersetzt werden koennen
!macro customInit
  nsExec::Exec 'schtasks.exe /End /TN "Nebula Sensoren"'
  Pop $0
  nsExec::Exec 'taskkill.exe /F /IM LibreHardwareMonitor.exe'
  Pop $0
!macroend

!macro customInstall
  DetailPrint "Sensor-Treiber (PawnIO) wird installiert..."
  nsExec::ExecToLog '"$INSTDIR\resources\PawnIO_setup.exe" -install -silent'
  Pop $0
  DetailPrint "PawnIO: Rueckgabewert $0"

  DetailPrint "Sensor-Dienst wird eingerichtet..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\sensors\install-sensors.ps1" -LhmDir "$INSTDIR\resources\lhm"'
  Pop $0
  DetailPrint "Sensor-Dienst: Rueckgabewert $0"
!macroend

!macro customUnInstall
  DetailPrint "Sensor-Dienst wird entfernt..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\sensors\uninstall-sensors.ps1"'
  Pop $0
!macroend
