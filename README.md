<p align="center">
  <img src="assets/icon.png" width="128" alt="Nebula Logo" />
</p>

<h1 align="center">Nebula</h1>

<p align="center">
  Hardware-Monitor für Windows: Temperaturen, Auslastung, Prozesse und alle Bauteile deines PCs auf einen Blick.
</p>

<p align="center">
  <a href="../../releases/latest"><strong>⬇ Nebula für Windows herunterladen</strong></a>
</p>

---

## Installieren

1. Unter [Releases](../../releases/latest) die Datei **`Nebula-Setup-x.x.x.exe`** herunterladen
2. Doppelklick und den Schritten folgen
3. Fertig, Nebula liegt auf dem Desktop und im Startmenü

Updates kommen automatisch: Nebula prüft beim Start, ob es eine neue Version gibt, und installiert sie beim nächsten Beenden.

> **„Der Computer wurde durch Windows geschützt“?**
> Windows warnt bei neuen Programmen ohne kostenpflichtige Signatur. Klicke auf **Weitere Informationen → Trotzdem ausführen**.

Lieber ohne Installation? Dann nimm **`Nebula-Portable-x.x.x.exe`** (ohne automatische Updates).

## Was Nebula zeigt

- **Dashboard**: CPU- und GPU-Auslastung, Temperaturen, Arbeitsspeicher, Netzwerk, jeder CPU-Thread, Laufwerke
- **Hardware**: Prozessor, Grafikkarte, jeder RAM-Riegel, Mainboard, BIOS, Bildschirme, SSDs/HDDs mit SMART-Zustand, Netzwerkkarten
- **Sensoren**: alle Temperaturen, Lüfterdrehzahlen, Takte und Leistungswerte
- **Prozesse**: wie im Task-Manager, nach CPU oder RAM sortiert
- **Systembericht** zum Kopieren oder Speichern, praktisch für Foren und Support
- Wärmebild-Design mit vier Paletten, Tray-Icon, Autostart, Tastenkürzel `Strg + Shift + N`

## CPU-Temperatur freischalten

Windows gibt Temperaturen nur an Programme mit eigenem Treiber heraus. Nebula richtet dafür auf Wunsch einmalig den Open-Source-Sensor-Dienst [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) ein:

**Sensoren → Sensoren einrichten** → Windows-Abfrage mit **Ja** bestätigen → bei der Frage nach **PawnIO** auf **OK** klicken.

Was dabei passiert, ganz transparent:
- LibreHardwareMonitor wird von der offiziellen GitHub-Seite in den Nebula-Datenordner geladen
- Sein lokaler Webserver wird eingeschaltet (nur auf deinem PC erreichbar, Port 8085)
- Eine geplante Windows-Aufgabe „Nebula Sensoren“ startet ihn bei jeder Anmeldung mit Admin-Rechten

Entfernen: **Einstellungen → Sensor-Dienst entfernen**.

Ohne Einrichtung funktionieren bereits: Prozesse, GPU-Auslastung (alle Hersteller) und GPU-Temperatur bei NVIDIA.

## Selbst bauen

```
npm install
npm start          # Entwicklungsmodus
npm run dist       # EXE lokal bauen (Ordner dist/)
```

Releases baut GitHub automatisch: **Actions → Nebula veröffentlichen → Run workflow**.

## Lizenzen

- Nebula: MIT
- [systeminformation](https://github.com/sebhildebrandt/systeminformation): MIT
- [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor): MPL-2.0 (wird bei Bedarf separat heruntergeladen)
- Schrift [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch): SIL Open Font License 1.1
