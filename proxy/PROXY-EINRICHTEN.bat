@echo off
chcp 65001 >nul
title Nebula KI-Proxy einrichten
cd /d "%~dp0"
where npx >nul 2>nul || (echo Node.js fehlt. Bitte von https://nodejs.org installieren. & pause & exit /b 1)
echo.
echo  [1/3] Bei Cloudflare anmelden (Browser oeffnet sich)...
call npx --yes wrangler@latest login || goto fehler
echo.
echo  [2/3] Jetzt deinen Anthropic-API-Schluessel einfuegen und Enter druecken.
echo        Er wird verschluesselt bei Cloudflare gespeichert - nicht in Nebula.
call npx --yes wrangler@latest secret put ANTHROPIC_API_KEY || goto fehler
echo.
echo  [3/3] Proxy veroeffentlichen...
call npx --yes wrangler@latest deploy || goto fehler
echo.
echo  FERTIG. Kopiere die oben angezeigte Adresse (https://...workers.dev)
echo  und trage sie in atlas\src\main\ai\config.ts bei FREE_AI_PROXY_URL ein.
pause
exit /b 0
:fehler
echo.
echo  [FEHLER] Etwas ist schiefgelaufen. Lies die Meldung oben.
pause
exit /b 1
