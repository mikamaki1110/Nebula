import '@fontsource-variable/instrument-sans'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')!

if (!window.atlas) {
  // Der Preload konnte nicht geladen werden – ohne ihn kann ATLAS nichts anzeigen.
  root.innerHTML = '<div style="padding:48px;max-width:620px;font:15px/1.6 system-ui;color:#eef0fb">' +
    '<h2 style="font-weight:500">ATLAS konnte keine Verbindung zu Nebula aufbauen.</h2>' +
    '<p style="color:#959ac6">Die Brücke zum Hauptprogramm wurde nicht geladen. Bitte ATLAS neu bauen ' +
    '(<code>npm run build:atlas</code>) und Nebula neu starten. Danach sollte alles funktionieren.</p></div>'
} else createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
