import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Finding, SecurityReport, Severity, StaticInfo } from '@shared/types'
import { AtlasLogo } from '../components/AtlasLogo'
import { ContourMap } from '../components/ContourMap'
import { Icon } from '../components/Icon'
import { OrbitGauge } from '../components/OrbitGauge'
import { Bar, Button, Skel } from '../components/ui'
import { bytes, duration, pct, rate } from '../lib/format'
import { ago, seconds } from '../lib/time'
import { useApp } from '../state/app'
import { useChat } from '../state/chat'
import { useLive } from '../state/live'
import { useReports } from '../state/reports'

const QUICK = [
  'Mein PC ist langsam. Finde heraus, warum.',
  'Überprüfe meinen PC auf Sicherheitsprobleme.',
  'Wo kann ich am meisten Speicherplatz freigeben?',
  'Welche Programme starten automatisch?'
]

const WEIGHT: Record<Severity, number> = { critical: 25, high: 12, medium: 5, low: 1 }

function healthScore(report: SecurityReport, memPct: number, worstDiskPct: number): number {
  let s = 100
  for (const f of report.findings) s -= WEIGHT[f.severity]
  if (worstDiskPct > 95) s -= 12
  else if (worstDiskPct > 90) s -= 6
  if (memPct > 90) s -= 6
  return Math.max(0, Math.min(100, Math.round(s)))
}

const verdict = (score: number): string =>
  score >= 90 ? 'Alles im grünen Bereich.' : score >= 75 ? 'Gut – ein paar Dinge kannst du verbessern.' : score >= 50 ? 'Hier gibt es einiges zu tun.' : 'Dein PC braucht Aufmerksamkeit.'

const toneOf = (list: Finding[]): 'good' | 'warn' | 'bad' =>
  list.some((f) => f.severity === 'critical' || f.severity === 'high') ? 'bad' : list.some((f) => f.severity === 'medium') ? 'warn' : 'good'

/** Halbkreis-Skala für den Zustandswert; ohne Wert ein ruhiger Platzhalter. */
function HealthDial({ score }: { score: number | null }): JSX.Element {
  const c = Math.PI * 70
  return (
    <div className="dial">
      <svg viewBox="0 0 160 92" aria-hidden="true">
        <path d="M10 82 A70 70 0 0 1 150 82" className="dial-track" />
        {score !== null && <path d="M10 82 A70 70 0 0 1 150 82" className="dial-arc" strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} />}
      </svg>
      <span className="dial-value">{score ?? <Skel w={54} h={30} />}</span>
      <span className="dial-label">Zustand</span>
    </div>
  )
}

function Tile({ icon, title, tone, headline, detail, foot, action, onAction, loading }: {
  icon: 'security' | 'optimize' | 'storage'
  title: string
  tone: 'good' | 'warn' | 'bad' | 'idle'
  headline: ReactNode
  detail: ReactNode
  foot: ReactNode
  action: string
  onAction: () => void
  loading: boolean
}): JSX.Element {
  return (
    <article className={`tile tile-${tone}`}>
      <header><span className="tile-icon"><Icon name={icon} size={18} /></span><h2>{title}</h2></header>
      {loading ? <><Skel w="62%" h={24} block /><Skel w="90%" h={13} block /></> : <><p className="tile-headline">{headline}</p><p className="tile-detail">{detail}</p></>}
      <footer><span className="tile-foot">{foot}</span><Button variant="quiet" onClick={onAction}>{action}</Button></footer>
    </article>
  )
}

export function Dashboard(): JSX.Element {
  const { data, error } = useLive()
  const { askAtlas, navigate } = useApp()
  const { settings } = useChat()
  const { security, securityBusy, securityError, optimize, optimizeBusy } = useReports()
  const [info, setInfo] = useState<StaticInfo | null>(null)

  // Details (Hersteller, Kerne …) kommen eventuell erst nach einigen Sekunden – deshalb ein paar Mal nachfragen
  useEffect(() => {
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = async (): Promise<void> => {
      const r = await window.atlas.call('system.static', {})
      if (!alive || !r.ok) return
      setInfo(r.data)
      if (!r.data.detailsLoaded && ++tries < 8) timer = setTimeout(() => void load(), 4000)
    }
    void load()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  const memPct = data ? (data.memory.used / data.memory.total) * 100 : 0
  const fullestDisk = useMemo(() => (data ? [...data.disks].sort((a, b) => b.used / b.size - a.used / a.size)[0] : undefined), [data])
  const diskPct = fullestDisk ? (fullestDisk.used / fullestDisk.size) * 100 : 0
  const score = security ? healthScore(security, memPct, diskPct) : null
  const hour = new Date().getHours()
  const greeting = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend'

  if (!data) {
    return (
      <section className="page">
        <div className="boot">
          <AtlasLogo size={84} state="thinking" />
          <p>{error ? `Systemwerte konnten nicht gelesen werden: ${error} – ATLAS versucht es automatisch weiter. Details stehen in Nebula unter „Debug“.` : 'ATLAS liest die Systemwerte …'}</p>
        </div>
      </section>
    )
  }

  const src = data.sources ?? {}
  const errs = data.sourceErrors ?? {}
  const topSecurity = security?.findings[0]
  const topTip = optimize?.suggestions[0]

  /** Ladezustand oder Fehlerursache für einen langsamen Messwert. */
  const pending = (key: keyof typeof src): ReactNode =>
    src[key] === 'loading' ? <Skel w="70%" h={14} block /> : src[key] === 'failed' ? <p className="meta">Nicht lesbar{errs[key] ? `: ${errs[key]}` : ''}</p> : null

  return (
    <section className="page dashboard">
      <div className="observatory">
        <ContourMap heat={data.cpu.load / 100} />
        <OrbitGauge center={pct(data.cpu.load)} caption="Prozessor" rings={[
          { label: 'Prozessor', value: data.cpu.load, tone: 'brass' },
          { label: 'Arbeitsspeicher', value: memPct, tone: 'lilac' },
          { label: fullestDisk ? `Laufwerk ${fullestDisk.mount}` : 'Laufwerk', value: diskPct, tone: 'sage' }
        ]} />
        <div className="obs-main">
          <p className="obs-greeting">{greeting}{settings?.userName ? `, ${settings.userName}` : ''}</p>
          <h1 className="obs-title">{info?.os.hostname ?? <Skel w={220} h={38} />}</h1>
          <div className="obs-health">
            <HealthDial score={score} />
            <div>
              <p className="obs-verdict">{score === null ? (securityError ? 'Sicherheitsstatus nicht lesbar.' : 'Prüfe Sicherheit …') : verdict(score)}</p>
              {security && security.findings.length > 0 && <button type="button" className="link" onClick={() => navigate('security')}>{security.findings.length} Punkt(e) ansehen</button>}
            </div>
          </div>
        </div>
        <dl className="obs-facts">
          <div><dt>System</dt><dd>{info ? info.os.distro.replace('Microsoft ', '') : <Skel w={110} />}</dd></div>
          <div><dt>Build</dt><dd>{info ? info.os.build : <Skel w={50} />}</dd></div>
          <div><dt>Prozessor</dt><dd>{info ? info.cpu.brand : <Skel w={170} />}</dd></div>
          <div><dt>Kerne</dt><dd>{info ? `${info.cpu.physicalCores} / ${info.cpu.cores} Threads` : <Skel w={90} />}</dd></div>
          <div><dt>Laufzeit</dt><dd>{info ? duration(info.uptimeSec) : <Skel w={70} />}</dd></div>
          <div><dt>Prozesse</dt><dd>{src.processes ? <Skel w={36} /> : data.processes.total}</dd></div>
        </dl>
      </div>

      <div className="tiles">
        <Tile icon="security" title="Sicherheit" loading={!security}
          tone={!security ? 'idle' : toneOf(security.findings)}
          headline={security && (security.findings.length === 0 ? 'Keine Auffälligkeiten' : `${security.findings.length} Befund${security.findings.length > 1 ? 'e' : ''}`)}
          detail={topSecurity ? topSecurity.title : security && security.incomplete.length > 0 ? `Nicht alles prüfbar: ${security.incomplete[0]}` : 'Defender, Firewall, Updates und Autostart sind in Ordnung.'}
          foot={security ? `${securityBusy ? 'Wird aktualisiert …' : `Geprüft ${ago(security.time)}`}${!securityBusy ? ` · ${seconds(security.tookMs)}` : ''}` : 'Prüfung läuft …'}
          action="Details" onAction={() => navigate('security')} />
        <Tile icon="optimize" title="Optimierung" loading={!optimize}
          tone={!optimize ? 'idle' : optimize.suggestions.length === 0 ? 'good' : toneOf(optimize.suggestions)}
          headline={optimize && (optimize.suggestions.length === 0 ? 'Gut eingestellt' : `${optimize.suggestions.length} Vorschlag${optimize.suggestions.length > 1 ? 'e' : ''}`)}
          detail={topTip ? topTip.title : 'Nichts zu tun.'}
          foot={optimize ? (optimizeBusy ? 'Wird aktualisiert …' : `Analysiert ${ago(optimize.time)} · ${seconds(optimize.tookMs)}`) : 'Analyse läuft …'}
          action="Details" onAction={() => navigate('optimize')} />
        <Tile icon="storage" title="Speicher" loading={!fullestDisk}
          tone={diskPct > 90 ? 'bad' : diskPct > 80 ? 'warn' : 'good'}
          headline={fullestDisk && `${bytes(fullestDisk.size - fullestDisk.used)} frei`}
          detail={fullestDisk && <><span>Laufwerk {fullestDisk.mount} ist zu {Math.round(diskPct)} % belegt.</span><Bar value={diskPct} warnAt={90} /></>}
          foot={`${data.disks.length} Laufwerk${data.disks.length === 1 ? '' : 'e'}`}
          action="Analysieren" onAction={() => navigate('storage')} />
      </div>

      <div className="ask-strip">
        <span className="ask-label"><Icon name="spark" size={16} />Frag ATLAS</span>
        {QUICK.map((q) => <button key={q} type="button" className="quick-ask" onClick={() => askAtlas(q)}>{q}</button>)}
      </div>

      <section className="console" aria-label="Instrumente">
        <div className="instrument">
          <h2>Prozessorkerne</h2>
          <div className="cores">
            {data.cpu.perCore.map((load, i) => (
              <div key={i} className="core" title={`Kern ${i + 1}: ${Math.round(load)} %`}><div className="core-fill" style={{ height: `${Math.min(100, load)}%` }} /></div>
            ))}
          </div>
          <p className="meta">Temperatur {data.cpu.tempC !== null ? `${Math.round(data.cpu.tempC)} °C` : src.temperature === 'loading' ? 'wird gelesen …' : 'nicht gemeldet'}</p>
        </div>
        <div className="instrument">
          <h2>Arbeitsspeicher</h2>
          <p className="figure">{bytes(data.memory.used)}<span> / {bytes(data.memory.total)}</span></p>
          <Bar value={memPct} />
          <p className="meta">{bytes(data.memory.available)} verfügbar</p>
        </div>
        <div className="instrument">
          <h2>Grafik</h2>
          {pending('gpu')}
          {!src.gpu && data.gpus.length === 0 && <p className="meta">Keine Grafikkarte erkannt.</p>}
          {!src.gpu && data.gpus.slice(0, 2).map((g, i) => (
            <div key={`${g.name}-${i}`} className="row-block">
              <p className="row-title">{g.name}</p>
              {g.load !== null && <Bar value={g.load} />}
              <p className="meta">{pct(g.load)}{g.tempC !== null && ` · ${Math.round(g.tempC)} °C`}{g.vramTotalMB !== null && ` · ${g.vramUsedMB ?? '–'} / ${g.vramTotalMB} MB`}</p>
            </div>
          ))}
        </div>
        <div className="instrument">
          <h2>Laufwerke <button type="button" className="link small" onClick={() => navigate('storage')}>Analysieren</button></h2>
          {data.disks.map((d) => (
            <div key={d.mount} className="row-block">
              <p className="row-title">{d.mount}<span>{bytes(d.size - d.used)} frei</span></p>
              <Bar value={(d.used / d.size) * 100} warnAt={90} />
            </div>
          ))}
        </div>
        <div className="instrument">
          <h2>Netzwerk</h2>
          {pending('network')}
          {!src.network && data.network.map((n) => (
            <div key={n.iface} className="row-block net">
              <p className="row-title">{n.iface}</p>
              <p className="net-rates"><span>↓ {rate(n.rxPerSec)}</span><span>↑ {rate(n.txPerSec)}</span></p>
            </div>
          ))}
          {!src.network && data.network.length === 0 && <p className="meta">Keine Netzwerkdaten.</p>}
        </div>
        <div className="instrument">
          <h2>Akku</h2>
          {pending('battery')}
          {!src.battery && (data.battery.hasBattery ? (
            <>
              <p className="figure">{pct(data.battery.percent)}<span> {data.battery.charging ? 'lädt' : 'Akkubetrieb'}</span></p>
              <Bar value={data.battery.percent ?? 0} warnAt={101} />
              {data.battery.healthPercent !== null && <p className="meta">Kapazität {data.battery.healthPercent} % des Neuzustands</p>}
            </>
          ) : <p className="meta">Kein Akku – läuft am Netz.</p>)}
        </div>
      </section>
    </section>
  )
}
