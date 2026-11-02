# Nebula Desktop 1.7.4 – Anleitung

## So bekommen alle 1.6-Nutzer die Version 1.7

Nebula 1.6 prüft bei jedem Start automatisch die **Releases deines GitHub-Repositorys**.
Damit das Update dort ankommt, gilt:

1. **Dasselbe Repository wie bei 1.6 verwenden.** Die installierte 1.6 sucht nur dort.
   Alle Dateien aus diesem Ordner in deinen bestehenden, geklonten Repository-Ordner kopieren
   (vorhandene Dateien überschreiben, den versteckten Ordner `.github` und den neuen Ordner `atlas` mitnehmen).
2. In GitHub Desktop: „Commit to main“ → „Push origin“.
3. Auf github.com → **Actions** → **Nebula veröffentlichen** → **Run workflow**.
4. Nach ca. 10 Minuten liegt unter **Releases** die Version **1.7.4** – als normales Release,
   nicht als Entwurf. Daran nichts mehr ändern (vor allem die Datei `latest.yml` nicht löschen).

**Was 1.6-Nutzer dann sehen:**
- Version 1.6 hat noch keinen Update-Knopf (der kann nachträglich nicht in eine bereits installierte Version kommen).
  Sie lädt 1.7 beim nächsten Start still im Hintergrund, zeigt eine **Windows-Benachrichtigung**
  und installiert das Update **beim Beenden** von Nebula (Tray-Symbol → Beenden oder PC herunterfahren).
- Beim ersten Start von 1.7 erscheint der Dialog **„Neu: ATLAS – deine KI-Zentrale“** mit dem Knopf „ATLAS öffnen“.
- **Ab 1.7 gibt es den Update-Knopf:** Bei jeder weiteren Version (1.7.1, 1.8 …) erscheint oben rechts
  „Update auf x.y.z“. Klick → wird geladen (mit Fortschritt) → „Neu starten & aktualisieren“.
- **Portable Version:** aktualisiert sich nie selbst (auch 1.6 nicht). Ab 1.7 zeigt sie den Knopf trotzdem an
  und öffnet damit die Download-Seite. 1.6-Portable-Nutzer müssen 1.7 einmalig selbst herunterladen.

Nebula prüft beim Start (nach ca. 8 Sekunden) und danach alle 4 Stunden.

## Lokale KI mit Ollama (kostenlos, unbegrenzt, offline)
ATLAS kann komplett auf dem PC des Nutzers denken – ohne API-Schlüssel, ohne Kosten, ohne Internet.
Einrichtung in ATLAS: **Einstellungen → Lokale KI (Ollama)** – die App führt in 3 Schritten durch:
1. „Ollama herunterladen“ → Installer von ollama.com ausführen (läuft danach unsichtbar im Hintergrund)
2. Beim Modell `qwen3:8b` auf „Herunterladen“ klicken (5,2 GB, einmalig)
3. Fertig – oben rechts steht „Lokale KI bereit“

Hardware: ab 16 GB RAM gut nutzbar; mit einer Grafikkarte ab 6–8 GB VRAM (z. B. RTX 3050 Desktop mit 8 GB)
deutlich schneller. ATLAS stellt den Kontext automatisch auf 16k Tokens (Ollama-Standard wäre zu klein).
Modelle: `qwen3:8b` (empfohlen), `gpt-oss:20b` (klüger, langsamer, ~14 GB, braucht viel RAM), `qwen3:4b` (für schwache PCs).
Unter „Welche KI soll ATLAS benutzen?“: **Automatisch** (eigener Schlüssel → lokal → Gratis-Zugang),
**Nur lokal** (nichts verlässt den PC) oder **Nur Cloud**.
Hinweis: Lokale 8B-Modelle sind weniger zuverlässig als Claude – bei verschachtelten Aufgaben
kann ein Werkzeugaufruf schiefgehen. Für Alltagsfragen reichen sie gut.

## Neu in 1.7.4: eigenes ATLAS-Logo
- **Das ATLAS-Zeichen:** Ein „A“, das zugleich ein Berggipfel ist (Atlasgebirge, Karte), mit einer Umlaufbahn als Querbalken und einem
  Mond, der darauf kreist – hinter dem „A“ gedämpft, davor hell. Es ist überall animiert: in der Seitenleiste, im Chat (schneller beim
  Denken, pulsierend beim Sprechen), beim Laden und in Nebulas ATLAS-Knopf und Willkommensdialog.
- **Startbildschirm:** Beim Öffnen von ATLAS wird das Zeichen gezeichnet (ca. 1,5 Sekunden), dann blendet alles zum Dashboard über.
  Ein Klick überspringt ihn. Bei „Animationen reduzieren“ in Windows ist er fast sofort weg und der Mond steht still.
- **Eigenes Programmsymbol:** Das ATLAS-Fenster hat ein eigenes Symbol (`assets/atlas-icon.png`, dazu `atlas-icon.ico` in allen Größen).
  Die Logo-Dateien liegen in `atlas/assets/` (u. a. `atlas-logo-animiert.svg`, im Browser zu öffnen).
- **Eigene Titelleiste:** Die Fensterknöpfe von Windows liegen oben rechts über der ATLAS-Statusleiste, ohne grauen Rahmen.
  Falls das bei dir nicht passt: in `atlas/src/main/index.ts` die Zeilen `titleBarStyle`/`titleBarOverlay` entfernen.

## Neu in 1.7.3: andere Programme haben Vorrang
- **Kein Vordrängeln auf dem Bildschirm:** Braucht ATLAS eine Bestätigung, springt es nicht mehr in den Vordergrund.
  Stattdessen blinkt das Taskleisten-Symbol und Windows zeigt eine Benachrichtigung; erst ein Klick darauf holt ATLAS nach vorn.
- **Niedrigere Priorität:** Nebula, ATLAS und ihre Hilfsprozesse laufen mit „Niedriger als normal“. Spiele und andere
  Programme bekommen die Rechenzeit zuerst. Schalter: Nebula → Einstellungen → „Anderen Programmen den Vortritt lassen“ (Standard: an).
- **Seltener messen im Hintergrund:** Ist Nebula im Tray, minimiert oder verdeckt, misst es deutlich seltener. Die Hitze-Warnung
  bleibt aktiv und löst weiterhin nach 12 Sekunden aus (jetzt nach echter Zeit statt nach Anzahl der Messungen).
- **KI-Modell wird freigegeben:** Schließt du ATLAS, nimmt es das lokale Modell sofort aus Grafik- und Arbeitsspeicher, damit
  Spiele ihn bekommen. Beim nächsten Öffnen wird es wieder vorgeladen.
- „Immer im Vordergrund“ (Einstellungen) sollte aus bleiben, wenn andere Fenster vorn sein sollen.

## Neu in 1.7.2
- **Messwerte repariert:** ATLAS nutzt jetzt Nebulas eigene, bewährte Abfragen (Grafik, Prozesse, Netzwerk, Akku, Temperatur
  inklusive LibreHardwareMonitor) und stellt sich nicht mehr in dieselbe PowerShell-Warteschlange wie Nebula. Wo etwas
  trotzdem nicht lesbar ist, steht der Grund direkt im Dashboard.
- **Sicherheit und Optimierung schneller:** Die Prüfungen laufen gleichzeitig statt nacheinander, nutzen schnelle Abfragewege
  (Firewall/UAC aus der Registrierung, Update-Verlauf statt Get-HotFix) und merken sich Signaturprüfungen. Das letzte Ergebnis
  erscheint beim Start **sofort** und wird im Hintergrund aufgefrischt; Zahlen an „Sicherheit“ und „Optimierung“ in der Navigation.
- **Neues Design:** passend zu Nebula (Graphit, Wärmebild-Paletten, Chakra Petch) mit Höhenlinien als Karten-Motiv,
  Zustandskacheln auf dem Dashboard und Platzhaltern beim Laden. Die Akzentfarben sind jetzt Nebulas Paletten.
- **Ollama-Installation in der App:** Der Befehl `irm https://ollama.com/install.ps1 | iex` steht mit Anleitung direkt in
  ATLAS (Kopieren-Knopf, „PowerShell öffnen“); die Webseite muss nicht mehr geöffnet werden. ATLAS erkennt Ollama danach selbst.

## Wenn in ATLAS etwas nicht angezeigt wird
Seit 1.7.1 erscheinen CPU, Arbeitsspeicher und Laufwerke sofort und unabhängig von allem anderen; Grafikkarte, Netzwerk,
Akku, Prozesse und Temperatur werden einzeln im Hintergrund nachgeladen („Wird gelesen …“). Klemmt eine Abfrage,
steht der Grund in **Nebula → Debug** (Einträge mit „ATLAS: Messwerte: …“).

## Wenn die lokale KI langsam ist
- Unter **Einstellungen → Lokale KI → Geschwindigkeit** „Schnell“ wählen (Standard). Dort steht auch, wie viel des Modells
  auf der Grafikkarte liegt. Unter 90 % läuft ein Teil auf dem Prozessor – dann ist es deutlich langsamer.
- ATLAS schaltet das „Nachdenken“ der Modelle ab, hält das Modell 30 Minuten im Speicher und lädt es beim Öffnen vor.
- Die erste Antwort nach dem Start ist am langsamsten (Modell wird geladen). Danach geht es schneller.
- Der Modell-Download (5,2 GB) lässt sich abbrechen und später fortsetzen.

## Gratis-KI für alle Nutzer
ATLAS kann ohne eigenen API-Schlüssel laufen – über einen kleinen Proxy, der deinen Schlüssel sicher verwahrt.
Einrichtung: `proxy/ANLEITUNG.md` (Doppelklick auf `proxy/PROXY-EINRICHTEN.bat`), danach die Proxy-Adresse in
`atlas/src/main/ai/config.ts` eintragen. **Den API-Schlüssel nie in die App schreiben.**

## Neue Version veröffentlichen (ab jetzt)
1. In `package.json` die `version` erhöhen (z. B. 1.7.4 → 1.7.5). **Ohne höhere Nummer gibt es kein Update.**
2. Pushen, Workflow „Nebula veröffentlichen“ starten.
3. Optional: Im Release auf GitHub einen Beschreibungstext eintragen – er erscheint in Nebula unter
   Einstellungen → Updates als „Neu in x.y.z“.

## EXE lokal bauen (nur zum Testen)
Doppelklick auf `EXE-BAUEN.bat` → danach öffnet sich der Ordner `dist` mit:
- `Nebula-Setup-1.7.4.exe` (Installer)
- `Nebula-Portable-1.7.4.exe` (portable Version)

Lokal gebaute EXEs suchen keine Updates auf GitHub, nur die vom Workflow veröffentlichten.

## Zum Entwickeln starten
1. Terminal im Ordner `nebula-desktop` öffnen
2. `npm install`
3. `npm start` (baut zuerst ATLAS, dann startet Nebula) – danach reicht `npm run start:fast`, solange du ATLAS nicht änderst

ATLAS-Tests und Typprüfung: `npm run test:atlas` und `npm run typecheck:atlas`.

## Aufbau
- `main.js`, `preload.js`, `renderer/` – Nebula wie bisher
- `updater.js` – Update-Prüfung mit Knopf (neu in 1.7)
- `atlas/` – ATLAS (TypeScript + React). `npm run build:atlas` erzeugt `atlas/out/`, das Nebula beim Öffnen von ATLAS lädt.
  ATLAS läuft in einem eigenen Fenster mit eigener, abgeschotteter Sitzung und eigenen IPC-Kanälen (`atlas:…`).
  Daten: `%APPDATA%\Nebula\atlas.sqlite` (Verlauf, Einstellungen) und `atlas-audit.log` (Protokoll aller Änderungen).

## Funktionen von Nebula
- Übersicht, Detailseiten, Hardware, Sensoren, Prozesse, Treiber, Speicher, Notizen, Debug – wie in 1.6
- **Neu:** ATLAS · KI-Zentrale (Seitenleiste oder Tray)
- **Neu:** Update-Knopf in der Titelleiste und unter Einstellungen → Updates

## CPU- und GPU-Temperaturen
Unverändert: Der Installer richtet PawnIO und LibreHardwareMonitor als Hintergrunddienst ein.
Falls die Temperaturen fehlen: Sensoren → „Reparieren“.
