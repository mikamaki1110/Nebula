import { useEffect, useState } from 'react'
import type { Accent, AiStatus } from '@shared/types'
import { Button, PageHeader, Panel } from '../components/ui'
import { useApp } from '../state/app'
import { useChat } from '../state/chat'
import { LocalAiPanel } from '../components/LocalAiPanel'

const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']
const ACCENTS: Array<{ id: Accent; label: string; hint: string }> = [
  { id: 'ironbow', label: 'Ironbow', hint: 'Wie Nebula: Orange auf Graphit' },
  { id: 'arctic', label: 'Arktis', hint: 'Eisblau' },
  { id: 'lava', label: 'Lava', hint: 'Glühendes Rot-Orange' },
  { id: 'white', label: 'Weiß-heiß', hint: 'Zurückhaltend, nahezu farblos' }
]

export function Settings(): JSX.Element {
  const { settings, saveSettings, speak } = useChat()
  const { toast } = useApp()
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => { void window.atlas.ai.status().then(setStatus) }, [])
  useEffect(() => { if (settings) setName(settings.userName) }, [settings])
  useEffect(() => {
    const load = (): void => setVoices(window.speechSynthesis?.getVoices().filter((v) => v.lang.startsWith('de')) ?? [])
    load()
    window.speechSynthesis?.addEventListener('voiceschanged', load)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', load)
  }, [])

  if (!settings) return <section className="page" />

  return (
    <section className="page">
      <PageHeader title="Einstellungen" />
      <div className="grid">
        <Panel title="Erscheinungsbild" wide>
          <div className="appearance">
            <div>
              <p className="field-label">Akzentfarbe</p>
              <div className="swatches" role="radiogroup" aria-label="Akzentfarbe">
                {ACCENTS.map((a) => (
                  <button key={a.id} type="button" role="radio" aria-checked={settings.accent === a.id} className={`swatch swatch-${a.id}`}
                    onClick={() => void saveSettings({ accent: a.id })} title={a.hint}>
                    <span className="swatch-dot" aria-hidden="true" />{a.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="field-label">Dichte</p>
              <div className="tabs">
                {(['comfortable', 'compact'] as const).map((d) => (
                  <button key={d} type="button" className={settings.density === d ? 'tab active' : 'tab'} onClick={() => void saveSettings({ density: d })}>
                    {d === 'comfortable' ? 'Großzügig' : 'Kompakt'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="field-label">Effekte</p>
              <label className="check"><input type="checkbox" checked={settings.effects} onChange={(e) => void saveSettings({ effects: e.target.checked })} />Leuchten, Sternenhimmel und Animationen</label>
            </div>
          </div>
        </Panel>

        <LocalAiPanel status={status} onStatus={setStatus} settings={settings} saveSettings={saveSettings} />

        <Panel title="KI-Verbindung (Cloud)">
          <p className="meta">
            {status?.source === 'local' && 'Gerade nicht in Benutzung – ATLAS denkt lokal. Ein eigener Schlüssel hätte Vorrang.'}
            {status?.source === 'free' && 'Kostenlos über Nebula verbunden – du musst nichts einrichten. Optional kannst du einen eigenen Schlüssel eintragen, dann gilt keine Begrenzung.'}
            {status?.source === 'env' && 'Verbunden über die Umgebungsvariable ANTHROPIC_API_KEY.'}
            {status?.source === 'session' && 'Verbunden mit deinem eigenen Schlüssel (für diese Sitzung).'}
            {!status?.configured && 'Noch kein KI-Zugang. Richte oben die lokale KI ein oder trage einen Anthropic-API-Schlüssel ein.'}
          </p>
          <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (!key.trim()) return; setStatus(await window.atlas.ai.setKey(key)); setKey(''); toast('Schlüssel für diese Sitzung gesetzt.', 'ok') }}>
            <label className="field"><span>{status?.source === 'free' ? 'Eigener API-Schlüssel (optional)' : 'API-Schlüssel'}</span>
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-ant-…" autoComplete="off" spellCheck={false} />
            </label>
            <div className="btn-row">
              <Button variant="primary" disabled={!key.trim()} onClick={async () => { setStatus(await window.atlas.ai.setKey(key)); setKey(''); toast('Schlüssel für diese Sitzung gesetzt.', 'ok') }}>Verwenden</Button>
              {status?.source === 'session' && <Button variant="quiet" onClick={async () => setStatus(await window.atlas.ai.setKey(null))}>Entfernen</Button>}
            </div>
          </form>
          <p className="meta subtle">ATLAS speichert keine Zugangsdaten. Der Schlüssel gilt nur bis zum Schließen. Dauerhaft: Umgebungsvariable ANTHROPIC_API_KEY in Windows setzen.</p>
          {status?.source === 'free'
            ? <p className="meta">Modell: vom Gratis-Zugang festgelegt.</p>
            : (
              <label className="field"><span>Modell</span>
                <select value={settings.aiModel} onChange={(e) => void saveSettings({ aiModel: e.target.value })}>
                  {[...new Set([settings.aiModel, ...MODELS])].map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
        </Panel>

        <Panel title="Persönlich">
          <label className="field"><span>Wie soll ATLAS dich nennen?</span>
            <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== settings.userName && void saveSettings({ userName: name })} />
          </label>
        </Panel>

        <Panel title="Stimme">
          <label className="check"><input type="checkbox" checked={settings.voiceOutput} onChange={(e) => void saveSettings({ voiceOutput: e.target.checked })} />Antworten vorlesen</label>
          <label className="field"><span>Stimme</span>
            <select value={settings.voiceName} onChange={(e) => void saveSettings({ voiceName: e.target.value })}>
              <option value="">Automatisch (Deutsch)</option>
              {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
            </select>
          </label>
          <label className="field"><span>Tempo: {settings.voiceRate.toFixed(1).replace('.', ',')}×</span>
            <input type="range" min={0.7} max={1.5} step={0.1} value={settings.voiceRate} onChange={(e) => void saveSettings({ voiceRate: Number(e.target.value) })} />
          </label>
          <Button variant="quiet" onClick={() => speak('Hallo, ich bin ATLAS. So klinge ich.')}>Probe hören</Button>
          <p className="meta subtle">Die Sprachausgabe nutzt die Windows-Stimmen und läuft lokal. Spracheingabe und das Aktivierungswort „Hey ATLAS“ sind noch nicht implementiert.</p>
        </Panel>

        <Panel title="Sicherheit und Protokoll">
          <p className="meta">Jede Änderung an deinem PC wird mit Zeitpunkt, Auslöser und Ergebnis protokolliert – auch abgelehnte Anfragen.</p>
          <Button variant="quiet" onClick={() => void window.atlas.openAuditLog()}>Protokoll öffnen</Button>
        </Panel>
      </div>
    </section>
  )
}
