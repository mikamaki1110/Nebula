import { useEffect, useState } from 'react'
import { rate } from '../lib/format'
import { useApp } from '../state/app'
import { useChat } from '../state/chat'
import { useLive, type Sample } from '../state/live'
import { Icon } from './Icon'

function Spark({ values, max }: { values: number[]; max?: number }): JSX.Element {
  const W = 64
  const H = 20
  const peak = max ?? Math.max(1, ...values) * 1.1
  const pts = values.slice(-30).map((v, i, a) => `${(i / Math.max(1, a.length - 1)) * W},${H - (Math.min(v, peak) / peak) * (H - 2) - 1}`)
  return <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">{pts.length > 1 && <polyline points={pts.join(' ')} />}</svg>
}

function Readout({ label, value, samples, pick, max, warn }: { label: string; value: string; samples: Sample[]; pick: (s: Sample) => number; max?: number; warn?: boolean }): JSX.Element {
  return (
    <div className={warn ? 'readout warn' : 'readout'}>
      <span className="readout-label">{label}</span>
      <span className="readout-value">{value}</span>
      <Spark values={samples.map(pick)} max={max} />
    </div>
  )
}

/** Statusleiste: Live-Instrumente, KI-Status und Auftragsfeld – immer sichtbar. */
export function Topbar(): JSX.Element {
  const { samples } = useLive()
  const { openCommand } = useApp()
  const { busy, speaking } = useChat()
  const [ai, setAi] = useState<boolean | null>(null)
  const [local, setLocal] = useState(false)
  const last = samples[samples.length - 1]

  useEffect(() => {
    const load = (): void => void window.atlas.ai.status().then((s) => { setAi(s.configured); setLocal(s.source === 'local') })
    load()
    const t = setInterval(load, 15_000)
    return () => clearInterval(t)
  }, [])

  const aiText = busy ? 'ATLAS arbeitet' : speaking ? 'ATLAS spricht' : ai ? (local ? 'Lokale KI bereit' : 'KI bereit') : ai === false ? 'KI nicht verbunden' : '…'
  return (
    <header className="topbar">
      <div className="readouts">
        <Readout label="CPU" value={last ? `${Math.round(last.cpu)} %` : '–'} samples={samples} pick={(s) => s.cpu} max={100} warn={!!last && last.cpu > 90} />
        <Readout label="RAM" value={last ? `${Math.round(last.ram)} %` : '–'} samples={samples} pick={(s) => s.ram} max={100} warn={!!last && last.ram > 90} />
        <Readout label="Netz" value={last ? rate(last.rx) : '–'} samples={samples} pick={(s) => s.rx} />
      </div>
      <button type="button" className="ask-field" onClick={openCommand}>
        <Icon name="search" size={17} />
        <span>ATLAS fragen …</span>
        <kbd>Strg K</kbd>
      </button>
      <div className={`ai-state ${busy ? 'busy' : ai ? 'ready' : 'off'}`}>
        <span className="ai-dot" aria-hidden="true" />{aiText}
      </div>
    </header>
  )
}
