import { useEffect, useRef, useState } from 'react'
import { AtlasLogo } from '../components/AtlasLogo'
import { RichText } from '../components/RichText'
import { Button } from '../components/ui'
import { useApp } from '../state/app'
import { useChat } from '../state/chat'

const EXAMPLES = [
  'Wie viel Speicherplatz habe ich noch?',
  'Mein PC ist langsam. Finde heraus, warum.',
  'Überprüfe meinen PC auf Sicherheitsprobleme.',
  'Welche Programme starten automatisch?',
  'Räume meine Festplatte auf.',
  'Sortiere meinen Downloads-Ordner.'
]

/** Sekunden seit Beginn der Arbeit – zeigt, dass ATLAS nicht hängt. */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) { setSeconds(0); return }
    const started = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  return seconds
}

export function Chat(): JSX.Element {
  const { items, busy, send, cancel, reset, speaking, stopSpeaking, settings, saveSettings } = useChat()
  const { consumePrompt, navigate } = useApp()
  const [text, setText] = useState('')
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [source, setSource] = useState<string | null>(null)
  const elapsed = useElapsed(busy)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void window.atlas.ai.status().then((s) => {
      setConfigured(s.configured)
      setSource(s.source)
      const p = consumePrompt()
      if (p && s.configured) send(p)
      else if (p) setText(p)
    })
    inputRef.current?.focus()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [items, busy])

  const submit = (): void => {
    const t = text.trim()
    if (!t || busy) return
    setText('')
    send(t)
  }
  const orbState = busy ? 'thinking' : speaking ? 'speaking' : 'idle'
  const empty = items.length === 0

  return (
    <section className={empty ? 'chat-page is-empty' : 'chat-page'}>
      <header className="chat-head">
        <div className="chat-ident">
          {!empty && <AtlasLogo state={orbState} size={38} />}
          {!empty && <span className="chat-name">ATLAS</span>}
        </div>
        <div className="header-actions">
          <button type="button" role="switch" aria-checked={!!settings?.voiceOutput} className="voice-toggle"
            onClick={() => { if (settings?.voiceOutput) stopSpeaking(); void saveSettings({ voiceOutput: !settings?.voiceOutput }) }}>
            <span className="voice-bars" aria-hidden="true"><i /><i /><i /></span>
            Vorlesen {settings?.voiceOutput ? 'an' : 'aus'}
          </button>
          {!empty && <Button variant="quiet" onClick={reset}>Neues Gespräch</Button>}
        </div>
      </header>

      <div className="chat-scroll">
        {empty && (
          <div className="chat-empty">
            <AtlasLogo state={orbState} size={150} />
            {configured === false ? (
              <>
                <p className="chat-empty-title">Ich brauche noch ein Gehirn.</p>
                <p className="chat-empty-sub">Richte die kostenlose lokale KI ein (dauert ein paar Minuten) oder trage einen API-Schlüssel ein. Alle anderen Bereiche funktionieren auch ohne.</p>
                <Button variant="primary" onClick={() => navigate('settings')}>KI einrichten</Button>
              </>
            ) : (
              <>
                <p className="chat-empty-title">Was soll ich für dich tun{settings?.userName ? `, ${settings.userName}` : ''}?</p>
                <p className="chat-empty-sub">Ich sehe deinen ganzen PC – und frage nach, bevor ich etwas verändere.</p>
                <div className="quick">{EXAMPLES.map((e) => <button key={e} type="button" className="quick-ask" onClick={() => send(e)}>{e}</button>)}</div>
              </>
            )}
          </div>
        )}
        <ol className="chat-log">
          {items.map((it, idx) => {
            if (it.kind === 'user') return <li key={it.id} className="msg user">{it.text}</li>
            if (it.kind === 'atlas') return <li key={it.id} className={it.streaming ? 'msg atlas streaming' : 'msg atlas'}><RichText text={it.text} /></li>
            if (it.kind === 'error') return <li key={it.id} className="msg error">{it.text}</li>
            const prev = items[idx - 1]
            const sameAgent = prev?.kind === 'step' && prev.agent === it.agent
            return (
              <li key={it.id} className={sameAgent ? 'step cont' : 'step'}>
                {!sameAgent && <span className="step-agent">{it.agent}</span>}
                <span className="step-text">{it.text}</span>
              </li>
            )
          })}
          {busy && !items.some((x) => x.kind === 'atlas' && x.streaming) && <li className="step thinking"><span className="pulse" aria-hidden="true" /><span className="step-text">ATLAS arbeitet … {elapsed > 2 && `${elapsed} s`}{source === 'local' && elapsed > 20 && ' – die lokale KI braucht auf diesem PC etwas länger'}</span></li>}
        </ol>
        <div ref={endRef} />
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <textarea ref={inputRef} value={text} rows={1} placeholder="Schreib ATLAS einen Auftrag …" aria-label="Nachricht an ATLAS"
          onChange={(e) => { setText(e.target.value); if (speaking) stopSpeaking() }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }} />
        <div className="composer-actions">
          <button type="button" className="mic" disabled title="Spracheingabe und „Hey ATLAS“ sind noch nicht implementiert" aria-label="Mikrofon (noch nicht verfügbar)">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><rect x="9" y="3.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" /></svg>
          </button>
          {speaking && <Button variant="quiet" onClick={stopSpeaking}>Stopp</Button>}
          {busy ? <Button onClick={cancel}>Abbrechen</Button> : <Button variant="primary" disabled={!text.trim()} onClick={submit}>Senden</Button>}
        </div>
      </form>
      <p className="composer-hint">Enter sendet · Umschalt+Enter für neue Zeile · Jede Änderung musst du selbst bestätigen</p>
    </section>
  )
}
