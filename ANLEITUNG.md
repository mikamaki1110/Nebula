# Nebula Desktop 1.3 – Anleitung

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
2. Nach ca. 5–10 Minuten liegt unter **Releases** die `Nebula-Setup-1.3.0.exe`
3. Diesen Link teilst du: `https://github.com/DEIN-NAME/nebula/releases/latest`

Neue Version: in `package.json` die `version` erhöhen (z. B. 1.4.0), pushen, Workflow starten.
Alle Nutzer bekommen das Update automatisch.

## EXE lokal bauen (nur zum Testen)
Doppelklick auf `EXE-BAUEN.bat` → danach öffnet sich der Ordner `dist` mit:
- `Nebula-Setup-1.3.0.exe` (Installer mit Desktop- und Startmenü-Verknüpfung)
- `Nebula-Portable-1.3.0.exe` (portable Version, ohne Installation startbar)

## Zum Entwickeln starten
1. Terminal im Ordner `nebula-desktop` öffnen
2. `npm install`
3. `npm start`

## Funktionen
- Dashboard: CPU-/GPU-Auslastung und -Temperatur, RAM, Netzwerk, alle CPU-Threads, Laufwerke, Top-Prozesse
- Hardware: Prozessor, Grafikkarte, RAM-Riegel, Mainboard, BIOS, Windows, Bildschirme, Laufwerke (inkl. SMART), Netzwerk
- Sensoren: alle Temperaturen, Lüfter, Takte und Leistungswerte
- Prozesse: nach CPU oder RAM sortiert, gruppiert nach Programm
- Systembericht kopieren oder als .txt speichern
- Notizen, Akzentfarben, Tray-Icon, Autostart, Strg + Shift + N

## CPU- und GPU-Temperaturen freischalten (einmalig)
Windows gibt Temperaturen nur an Programme mit eigenem Treiber heraus. Nebula erledigt das selbst:
1. Nebula öffnen → **Sensoren** → **Sensoren einrichten**
2. Die Windows-Abfrage („Möchten Sie zulassen…“) mit **Ja** bestätigen
3. Beim allerersten Start fragt LibreHardwareMonitor nach dem Treiber **PawnIO** → **OK** klicken

Danach startet der Sensor-Dienst automatisch mit Windows, ohne weitere Abfragen.
Unter **Sensoren → Datenquellen** siehst du jederzeit, welcher Wert woher kommt.

Was ohne Einrichtung schon funktioniert:
- Prozesse (wie im Task-Manager)
- GPU-Auslastung (alle Hersteller)
- GPU-Temperatur bei NVIDIA-Grafikkarten

Entfernen: Einstellungen → Sensor-Dienst entfernen.

## Design
- Hintergrund: Isothermen wie auf einer Wärmebildkamera. Sie werden mit der CPU-Temperatur wärmer
  (ohne Temperatursensor folgen sie der CPU-Auslastung).
- Einstellungen → Wärmebild-Palette: Ironbow, Arktis, Lava, Weiß-heiß
- Schrift: Chakra Petch (SIL Open Font License, siehe renderer/fonts/OFL.txt)
