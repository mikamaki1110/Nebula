# Nebula Desktop 1.4 – Anleitung

## Öffentlich veröffentlichen (GitHub baut die EXE für dich)
Einmalig einrichten:
1. Kostenloses Konto auf https://github.com anlegen
2. Neues Repository anlegen: Name z. B. `nebula`, Sichtbarkeit **Public**
3. GitHub Desktop installieren (https://desktop.github.com), das Repository damit klonen
4. Alle Dateien aus diesem Ordner in den geklonten Ordner kopieren
   (inklusive des versteckten Ordners `.github`!)
5. In GitHub Desktop: „Commit to main“ → „Push origin“

Version veröffentlichen:
1. Auf github.com im Repository → **Actions** → **Nebula veröffentlichen** → **Run workflow**
2. Nach ca. 5–10 Minuten liegt unter **Releases** die `Nebula-Setup-1.4.0.exe`
3. Diesen Link teilst du: `https://github.com/DEIN-NAME/nebula/releases/latest`

Neue Version: in `package.json` die `version` erhöhen (z. B. 1.4.0), pushen, Workflow starten.
Alle Nutzer bekommen das Update automatisch.

## EXE lokal bauen (nur zum Testen)
Doppelklick auf `EXE-BAUEN.bat` → danach öffnet sich der Ordner `dist` mit:
- `Nebula-Setup-1.4.0.exe` (Installer mit Desktop- und Startmenü-Verknüpfung)
- `Nebula-Portable-1.4.0.exe` (portable Version, ohne Installation startbar)

## Zum Entwickeln starten
1. Terminal im Ordner `nebula-desktop` öffnen
2. `npm install`
3. `npm start`

## Funktionen
- Übersicht: CPU, GPU, RAM, Systemlaufwerk, Netzwerk, Threads, Top-Prozesse – alles anklickbar
- Detailseiten: Prozessor (jeder Kern), Grafikkarte, Arbeitsspeicher, Laufwerke, Netzwerk
- Hardware: Prozessor, Grafikkarte, RAM-Riegel, Mainboard, BIOS, Windows, Bildschirme, Laufwerke (inkl. SMART), Netzwerk
- Sensoren: alle Temperaturen, Lüfter, Takte und Leistungswerte
- Prozesse: Apps/Hintergrund, Suche, Sortierung per Klick auf die Spalte, aufklappen, Task beenden (Entf-Taste)
- Systembericht kopieren oder als .txt speichern
- Notizen, Akzentfarben, Tray-Icon, Autostart, Strg + Shift + N

## CPU- und GPU-Temperaturen
Funktionieren direkt nach der Installation. Der Installer richtet automatisch ein:
- den Sensor-Treiber PawnIO (still, ohne Fenster)
- LibreHardwareMonitor als unsichtbaren Hintergrunddienst (Aufgabe „Nebula Sensoren“, läuft als SYSTEM)

Falls die Temperaturen einmal fehlen: Sensoren → „Reparieren“.
Portable Version: Sensoren → „Sensoren einrichten“ (einmalig, eine Windows-Abfrage).

## Design
- Hintergrund: Isothermen wie auf einer Wärmebildkamera. Sie werden mit der CPU-Temperatur wärmer
  (ohne Temperatursensor folgen sie der CPU-Auslastung).
- Einstellungen → Wärmebild-Palette: Ironbow, Arktis, Lava, Weiß-heiß
- Schrift: Chakra Petch (SIL Open Font License, siehe renderer/fonts/OFL.txt)


## Debug-, Fehler- & Treiber-Manager
- **🛠️ Debug & Treiber** in der Seitenleiste:
  - **Treiber-Manager**: Scannt alle installierten Plug-and-Play-Gerätetreiber mit Version, Hersteller, Datum und Signatur.
  - **Treiber-Updates**: Sucht direkt über die Windows Update API nach neueren Treibern und installiert sie auf Knopfdruck.
  - **PC-Fehlerprotokoll**: Liest die Windows-Ereignisanzeige (System- und Anwendungsfehler, Bluescreens, WHEA-Fehler) mit Suchfilter aus.
  - **Live-Metriken**: Abfrage-Latenzen (Fast/Slow ms) und LibreHardwareMonitor-JSON.
- **Tastenkürzel**:
  - `F12` oder `Strg + Shift + D`: Floating HUD Overlay ein-/ausblenden
  - `Strg + Shift + I`: DevTools öffnen
