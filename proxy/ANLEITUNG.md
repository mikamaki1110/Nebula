# Gratis-KI für alle Nebula-Nutzer einrichten

Deine Nutzer sollen ATLAS ohne eigenen API-Schlüssel nutzen können. Dafür läuft dein Schlüssel auf einem
kleinen Vermittler-Server (Proxy) bei Cloudflare – **nicht** in der Nebula-App. Alles, was in der EXE steckt,
kann jeder auslesen; ein dort eingebauter Schlüssel wäre schnell gestohlen und du würdest fremde Nutzung bezahlen.

```
Nebula/ATLAS  ──►  dein Proxy (Cloudflare, hält den Schlüssel)  ──►  Anthropic
```

## Einmalig einrichten (ca. 10 Minuten)

1. **Anthropic-Konto:** Auf https://console.anthropic.com einen API-Schlüssel erstellen und Guthaben aufladen.
2. **Kostengrenze setzen (wichtig!):** In der Anthropic Console unter *Limits* ein monatliches Ausgabenlimit
   eintragen, z. B. 20 €. Das ist deine harte Grenze – mehr kann der Gratis-Zugang nie kosten.
3. **Cloudflare-Konto:** Kostenlos auf https://dash.cloudflare.com anlegen.
4. **Proxy veröffentlichen:** Doppelklick auf `PROXY-EINRICHTEN.bat` in diesem Ordner.
   Es meldet dich bei Cloudflare an, fragt nach deinem API-Schlüssel und veröffentlicht den Proxy.
   Am Ende steht eine Adresse wie `https://nebula-ki-proxy.deinname.workers.dev`.
5. **Prüfen:** Die Adresse im Browser öffnen – dort muss „Nebula KI-Proxy läuft.“ stehen.
6. **In Nebula eintragen:** `atlas/src/main/ai/config.ts` öffnen und die Adresse eintragen:
   ```ts
   export const FREE_AI_PROXY_URL = 'https://nebula-ki-proxy.deinname.workers.dev'
   ```
   Dort **nur die Adresse**, niemals den Schlüssel.
7. **Neue Version veröffentlichen:** Version in `package.json` erhöhen (falls 1.7.0 schon draußen ist → 1.7.1),
   pushen, Workflow starten. Alle Nutzer bekommen das Update und können ATLAS sofort gratis nutzen.

## Was deine Nutzer sehen
- Der KI-Chat funktioniert sofort, ohne Einrichtung.
- Einstellungen → KI-Verbindung zeigt „Kostenlos über Nebula verbunden“.
- Wer will, kann trotzdem einen eigenen Schlüssel eintragen; dann läuft alles direkt über dessen Konto, ohne Proxy.

## Kosten steuern
In `wrangler.toml`:
- `MODEL` – welches Modell gratis genutzt wird. `claude-haiku-5-5` ist am günstigsten.
- `MAX_TOKENS` – maximale Antwortlänge pro Anfrage.
- `[[ratelimits]]` – Anfragen pro Minute je Installation (30) und je IP-Adresse (60).

Nach Änderungen erneut `npx wrangler deploy` im Ordner `proxy` ausführen (oder die BAT-Datei starten).
Den aktuellen Verbrauch siehst du in der Anthropic Console unter *Usage*.

## Gut zu wissen
- **Kostenlos bei Cloudflare:** bis 100.000 Anfragen pro Tag im kostenlosen Tarif.
- **Die Ratenbegrenzung ist ein Bremsklotz, kein Schloss:** Wer es darauf anlegt, kann neue Installations-IDs
  erfinden. Die echte Obergrenze ist das Ausgabenlimit aus Schritt 2 – setz es unbedingt.
- **Schlüssel austauschen:** jederzeit mit `npx wrangler secret put ANTHROPIC_API_KEY` – ohne Nebula-Update.
- **Gratis-Zugang abschalten:** im Cloudflare-Dashboard den Worker deaktivieren. ATLAS zeigt den Nutzern dann
  eine verständliche Meldung und den Hinweis auf einen eigenen Schlüssel.
- Du bietest den Dienst über dein Anthropic-Konto an und bist für die Nutzung verantwortlich.
  Lies dafür einmal die Nutzungsbedingungen von Anthropic.
- Falls `wrangler deploy` die Zeilen `[[ratelimits]]` nicht kennt, hilft `npx wrangler@latest deploy`.
