import { useEffect, useRef, useState } from 'react'
import { AtlasLogo } from './AtlasLogo'

const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
/** So lange läuft die Zeichen-Animation mindestens – danach blendet der Startbildschirm aus, sobald Daten da sind. */
const MIN_MS = reduced ? 250 : 1500

let shown = false

/** Startbildschirm beim Öffnen von ATLAS: Das Zeichen wird gezeichnet, dann blendet alles zum Dashboard über. */
export function Splash({ ready }: { ready: boolean }): JSX.Element | null {
  const [visible, setVisible] = useState(!shown)
  const [leaving, setLeaving] = useState(false)
  const started = useRef(Date.now())

  const close = (): void => {
    setLeaving(true)
    setTimeout(() => { shown = true; setVisible(false) }, reduced ? 0 : 450)
  }

  useEffect(() => {
    if (!visible || !ready || leaving) return
    const timer = setTimeout(close, Math.max(0, MIN_MS - (Date.now() - started.current)))
    return () => clearTimeout(timer)
  }, [ready, visible, leaving]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null
  return (
    <div className={leaving ? 'splash leaving' : 'splash'} onClick={ready ? close : undefined} role="presentation">
      <AtlasLogo size={132} reveal />
      <p className="splash-word">ATLAS</p>
      <p className="splash-sub">in Nebula</p>
    </div>
  )
}
