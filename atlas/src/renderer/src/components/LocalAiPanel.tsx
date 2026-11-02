import { useEffect, useRef, useState } from 'react'
import { OLLAMA_INSTALL_COMMAND } from '@shared/contract'
import type { AiStatus, PullProgress, Settings } from '@shared/types'
import { useApp } from '../state/app'
import { Bar, Button, Panel, Tabs } from './ui'

const PROVIDERS = [
  { id: 'auto' as const, label: 'Automatisch' },
  { id: 'local' as const, label: 'Nur lokal' },
  { id: 'cloud' as const, label: 'Nur Cloud' }
]

const SPEEDS = [
  { id: '8192', label: 'Schnell' },
  { id: '12288', label: 'Ausgewogen' },
  { id: '16384', label: 'Gründlich' }
]

/** Geschätzte Restzeit eines Downloads aus dem bisherigen Tempo. */
function eta(startedAt: number, percent: number | null): string | null {
  if (percent === null || percent < 3 || percent >= 100) return null
  const seconds = ((Date.now() - startedAt) / 1000) * ((100 - percent) / percent)
  return seconds < 90 ? 'noch etwa eine Minute' : `noch etwa ${Math.round(seconds / 60)} Minuten`
}

const SOURCE_TEXT: Record<NonNullable<AiStatus['source']>, string> = {
  local: 'ATLAS denkt gerade lokal auf deinem PC – kostenlos und ohne Internet.',
  session: 'ATLAS nutzt gerade deinen eigenen API-Schlüssel.',
  env: 'ATLAS nutzt gerade den Schlüssel aus der Umgebungsvariable.',
  free: 'ATLAS nutzt gerade den Gratis-Zugang von Nebula.'
}

/** Ollama meldet seinen Fortschritt auf Englisch – hier auf Deutsch. */
function statusText(s: string): string {
  if (/^pulling manifest/i.test(s)) return 'Lade Modellbeschreibung'
  if (/^(pulling|downloading)/i.test(s)) return 'Wird heruntergeladen'
  if (/verifying/i.test(s)) return 'Prüfe Download'
  if (/writing manifest|removing/i.test(s)) return 'Richte Modell ein'
  if (/success/i.test(s)) return 'Fertig'
  return s
}

/** Einrichtung der lokalen KI (Ollama): Status, Modell-Download, Wahl des Wegs. */
export function LocalAiPanel({ status, onStatus, settings, saveSettings }: {
  status: AiStatus | null
  onStatus: (s: AiStatus) => void
  settings: Settings
  saveSettings: (p: Partial<Settings>) => Promise<void>
}): JSX.Element {
  const { toast } = useApp()
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const [pulling, setPulling] = useState(false)
  const startedAt = useRef(Date.now())

  useEffect(() => window.atlas.ai.onPullProgress(setProgress), [])
  const refresh = async (): Promise<void> => onStatus(await window.atlas.ai.status())
  const [copied, setCopied] = useState(false)

  // Solange Ollama noch nicht läuft, schaut ATLAS alle 4 Sekunden nach – nach der Installation geht es von selbst weiter.
  const running = status?.ollama.running ?? false
  useEffect(() => {
    if (running) return
    const timer = setInterval(() => { void window.atlas.ai.status().then(onStatus) }, 4000)
    return () => clearInterval(timer)
  }, [running, onStatus])

  const copyCommand = async (): Promise<void> => {
    await window.atlas.ai.copyInstallCommand()
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  const pull = async (model: string): Promise<void> => {
    setPulling(true)
    startedAt.current = Date.now()
    setProgress({ model, status: 'Starte Download …', percent: null })
    const r = await window.atlas.ai.pullModel(model)
    setPulling(false)
    setProgress(null)
    if (r.ok) { onStatus(r.data); toast(`${model} ist installiert. ATLAS kann jetzt lokal denken.`, 'ok') }
    else toast(r.error, 'error')
  }

  const o = status?.ollama
  const step = !o ? 0 : !o.running ? 1 : !o.installed ? 2 : 3

  return (
    <Panel title="Lokale KI (Ollama)" wide aside={<Button variant="quiet" onClick={() => void refresh()}>Neu prüfen</Button>}>
      <p className="meta">Läuft direkt auf deinem PC: kostenlos, unbegrenzt und ohne dass Texte deinen Rechner verlassen.
        Gut geeignet ab 16 GB Arbeitsspeicher; mit einer Grafikkarte ab 6–8 GB wird es deutlich schneller.</p>

      <ol className="setup-steps">
        <li className={step > 1 ? 'done' : step === 1 ? 'current' : ''}>
          <span className="step-num">1</span>
          <div>
            <strong>Ollama installieren und starten</strong>
            {step <= 1 && (
              <div className="install-guide">
                <p className="meta">Ollama ist ein kostenloses Programm, das die KI auf deinem PC ausführt. Du installierst es mit einem einzigen Befehl in Windows PowerShell – ganz ohne Webseite:</p>
                <ol className="guide-steps">
                  <li>
                    <span>Öffne <strong>PowerShell</strong>: <kbd>Windows</kbd>-Taste drücken, <strong>PowerShell</strong> tippen, <kbd>Enter</kbd>.</span>
                    <Button variant="quiet" onClick={() => void window.atlas.ai.openPowerShell()}>PowerShell für mich öffnen</Button>
                  </li>
                  <li>
                    <span>Kopiere diesen Befehl, füge ihn in PowerShell ein (<kbd>Strg</kbd>+<kbd>V</kbd>) und drücke <kbd>Enter</kbd>:</span>
                    <div className="codebox">
                      <code>{OLLAMA_INSTALL_COMMAND}</code>
                      <Button variant={copied ? 'default' : 'primary'} onClick={() => void copyCommand()}>{copied ? 'Kopiert ✓' : 'Befehl kopieren'}</Button>
                    </div>
                  </li>
                  <li><span>Warte 1–3 Minuten, bis die Installation fertig ist. ATLAS erkennt Ollama dann <strong>automatisch</strong> und macht hier weiter.</span></li>
                </ol>
                <p className="meta subtle">Das ist der offizielle Installationsbefehl von ollama.com. Er lädt Ollama herunter und richtet es ein. Wird Ollama danach nicht erkannt, öffne es einmal über das Startmenü („Ollama“).
                  Lieber mit einem normalen Installer? <button type="button" className="link" onClick={() => void window.atlas.ai.openOllamaDownload()}>Installer von ollama.com laden</button></p>
                <p className="meta"><span className="spinner" aria-hidden="true" /> Warte auf Ollama … <button type="button" className="link" onClick={() => void refresh()}>Jetzt prüfen</button></p>
              </div>
            )}
            {step > 1 && <p className="meta">Ollama läuft.</p>}
          </div>
        </li>
        <li className={step > 2 ? 'done' : step === 2 ? 'current' : ''}>
          <span className="step-num">2</span>
          <div>
            <strong>Modell herunterladen</strong>
            {step >= 2 && (
              <ul className="model-list">
                {o!.recommended.map((m) => {
                  const installed = o!.models.some((x) => x === m.name)
                  const selected = settings.ollamaModel === m.name
                  return (
                    <li key={m.name} className={selected ? 'selected' : ''}>
                      <div>
                        <p className="row-title">{m.name}<span>{m.size}</span></p>
                        <p className="meta">{m.hint}</p>
                      </div>
                      {installed
                        ? <Button variant={selected ? 'default' : 'quiet'} disabled={selected}
                            onClick={async () => { await saveSettings({ ollamaModel: m.name }); await refresh() }}>{selected ? 'Aktiv' : 'Verwenden'}</Button>
                        : <Button variant={m.name === 'qwen3:8b' ? 'primary' : 'quiet'} busy={pulling && progress?.model === m.name} disabled={pulling}
                            onClick={() => void pull(m.name)}>Herunterladen</Button>}
                    </li>
                  )
                })}
              </ul>
            )}
            {progress && (
              <div className="pull-progress">
                <p className="meta">{progress.model}: {statusText(progress.status)}{progress.percent !== null && ` – ${progress.percent} %`}{eta(startedAt.current, progress.percent) && ` – ${eta(startedAt.current, progress.percent)}`}</p>
                <p className="meta subtle">Der Download lässt sich jederzeit abbrechen (Fenster schließen) und später fortsetzen – bereits geladene Teile bleiben erhalten.</p>
                {progress.percent !== null && <Bar value={progress.percent} warnAt={101} />}
              </div>
            )}
          </div>
        </li>
        <li className={step === 3 ? 'done' : ''}>
          <span className="step-num">3</span>
          <div>
            <strong>Fertig</strong>
            {step === 3 && <p className="meta">ATLAS benutzt {settings.ollamaModel}.</p>}
          </div>
        </li>
      </ol>

      <div className="provider-row">
        <p className="field-label">Welche KI soll ATLAS benutzen?</p>
        <Tabs value={settings.aiProvider} options={PROVIDERS} onChange={async (v) => { await saveSettings({ aiProvider: v }); await refresh() }} />
        <p className="meta subtle">
          {settings.aiProvider === 'auto' && 'Eigener Schlüssel, sonst lokale KI, sonst der Gratis-Zugang.'}
          {settings.aiProvider === 'local' && 'Nur die lokale KI – nichts verlässt deinen PC.'}
          {settings.aiProvider === 'cloud' && 'Nie lokal – nur eigener Schlüssel oder Gratis-Zugang.'}
        </p>
        {status?.source && <p className="meta">{SOURCE_TEXT[status.source]}</p>}
      </div>

      <div className="provider-row">
        <p className="field-label">Geschwindigkeit der lokalen KI</p>
        <Tabs value={String(settings.aiContext)} options={SPEEDS} onChange={async (v) => { await saveSettings({ aiContext: Number(v) }); await refresh() }} />
        <p className="meta subtle">Weniger Kontext braucht weniger Grafikspeicher und antwortet schneller. „Schnell“ passt gut zu Grafikkarten mit 6–8 GB;
          „Gründlich“ nur mit 12 GB oder mehr.</p>
        {o?.load && (
          <p className={o.load.percentGpu >= 90 ? 'meta' : 'meta warn-text'}>
            {o.load.model} läuft zu {o.load.percentGpu} % auf der Grafikkarte.
            {o.load.percentGpu < 90 && ' Der Rest läuft auf dem Prozessor – das ist deutlich langsamer. Wähle „Schnell“ oder das kleinere Modell qwen3:4b.'}
          </p>
        )}
      </div>
    </Panel>
  )
}
