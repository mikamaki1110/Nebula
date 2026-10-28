@echo off
title Nebula - EXE bauen
cd /d "%~dp0"

echo.
echo  ===========================================
echo   Nebula wird als Windows-Programm gebaut...
echo  ===========================================
echo.

where npm >nul 2>nul
if errorlevel 1 (
  echo  [FEHLER] Node.js ist nicht installiert.
  echo  Bitte installiere die LTS-Version von https://nodejs.org
  echo  und starte diese Datei danach erneut.
  echo.
  pause
  exit /b 1
)

echo  [1/3] Lade benoetigte Pakete herunter (einmalig, dauert etwas)...
call npm install --no-audit --no-fund
if errorlevel 1 goto fehler

echo.
echo  [2/3] Lade Sensor-Dienst zum Einpacken...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\fetch-sensors.ps1"
if errorlevel 1 goto fehler

echo.
echo  [3/3] Baue Installer und portable EXE...
call npm run dist
if errorlevel 1 goto fehler

echo.
echo  ===========================================
echo   FERTIG! Der Ordner "dist" wird geoeffnet.
echo  ===========================================
echo   Nebula-Setup-1.5.0.exe    = Installer
echo   Nebula-Portable-1.5.0.exe = Portable Version
echo.
start "" "%~dp0dist"
pause
exit /b 0

:fehler
echo.
echo  [FEHLER] Der Build ist fehlgeschlagen.
echo  Tipp: Rechtsklick auf EXE-BAUEN.bat und "Als Administrator ausfuehren".
echo.
pause
exit /b 1
