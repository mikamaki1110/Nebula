import { useState } from 'react'
import type { RepairResult } from '@shared/types'
import { Button, Empty, FindingList, PageHeader, Panel, Working } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { dateTime } from '../lib/format'
import { useApp } from '../state/app'

function ResultBlock({ r }: { r: RepairResult }): JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className={`repair-result ${r.ok === null ? '' : r.ok ? 'ok' : 'bad'}`}>
      <p>{r.summary}</p>
      <button type="button" className="link" onClick={() => setOpen((o) => !o)}>{open ? 'Ausgabe ausblenden' : 'Vollständige Ausgabe'}</button>
      {open && <pre>{r.output || '(keine Ausgabe)'}</pre>}
    </div>
  )
}

export function Repair(): JSX.Element {
  const sfc = useCap('repair.sfc')
  const dism = useCap('repair.dism')
  const net = useCap('repair.network')
  const drivers = useCap('repair.drivers')
  const events = useCap('repair.events')
  const { askAtlas } = useApp()

  return (
    <section className="page">
      <PageHeader title="Reparatur" lead="Windows-eigene Diagnose- und Reparaturwerkzeuge – verständlich erklärt." />
      <div className="grid">
        <Panel title="Systemdateien (SFC)">
          <p className="meta">Prüft, ob Windows-Systemdateien beschädigt sind, und ersetzt sie bei Bedarf durch Originale. Dauert 5–20 Minuten.</p>
          <div className="btn-row">
            <Button busy={sfc.busy} onClick={() => void sfc.run({ mode: 'verify' })}>Nur prüfen</Button>
            <Button variant="primary" busy={sfc.busy} onClick={() => void sfc.run({ mode: 'repair' })}>Prüfen und reparieren</Button>
          </div>
          {sfc.busy && <Working text="SFC läuft im Hintergrund …" />}
          {sfc.data && <ResultBlock r={sfc.data} />}
        </Panel>
        <Panel title="Windows-Abbild (DISM)">
          <p className="meta">Repariert die Quelle, aus der SFC Originaldateien nimmt. Wenn SFC scheitert: erst DISM „Wiederherstellen“, dann SFC.</p>
          <div className="btn-row">
            <Button busy={dism.busy} onClick={() => void dism.run({ mode: 'check' })}>Schnell</Button>
            <Button busy={dism.busy} onClick={() => void dism.run({ mode: 'scan' })}>Gründlich</Button>
            <Button variant="primary" busy={dism.busy} onClick={() => void dism.run({ mode: 'restore' })}>Wiederherstellen</Button>
          </div>
          {dism.busy && <Working text="DISM läuft – das kann dauern …" />}
          {dism.data && <ResultBlock r={dism.data} />}
        </Panel>

        <Panel title="Netzwerk" aside={<Button busy={net.busy} onClick={() => void net.run({})}>Diagnose starten</Button>}>
          {!net.data && !net.busy && <p className="meta">Prüft Adapter, Router, Internet und Namensauflösung nacheinander.</p>}
          {net.busy && <Working text="Teste Verbindung …" />}
          {net.data && (
            <>
              <ol className="chain">
                <li className={net.data.adapters.some((a) => a.status === 'Up') ? 'ok' : 'bad'}>Adapter</li>
                <li className={net.data.gatewayReachable ? 'ok' : 'bad'}>Router</li>
                <li className={net.data.internetReachable ? 'ok' : 'bad'}>Internet</li>
                <li className={net.data.dnsWorks ? 'ok' : 'bad'}>DNS</li>
              </ol>
              <p className="verdict">{net.data.verdict}</p>
              <FindingList findings={net.data.findings} emptyText="Alles in Ordnung." />
            </>
          )}
        </Panel>

        <Panel title="Treiber" aside={<Button busy={drivers.busy} onClick={() => void drivers.run({})}>Prüfen</Button>}>
          {!drivers.data && !drivers.busy && <p className="meta">Findet Geräte, die Windows mit einem Fehler meldet.</p>}
          {drivers.busy && <Working text="Prüfe Geräte …" />}
          {drivers.data && (drivers.data.length === 0
            ? <div className="all-clear"><span className="all-clear-mark" aria-hidden="true" />Alle Geräte arbeiten fehlerfrei.</div>
            : <ul className="findings">{drivers.data.map((d) => (
                <li key={d.deviceId} className="finding sev-medium"><div className="finding-head"><span className="sev-badge">Code {d.code}</span><h3>{d.name}</h3></div><p>{d.explanation}</p></li>
              ))}</ul>)}
        </Panel>

        <Panel title="Fehlerprotokoll der letzten 3 Tage" wide aside={<Button busy={events.busy} onClick={() => void events.run({ days: 3 })}>Auswerten</Button>}>
          {!events.data && !events.busy && <p className="meta">Fasst kritische Ereignisse und Fehler aus der Windows-Ereignisanzeige zusammen. Viele Einträge sind harmlos – ATLAS kann sie dir erklären.</p>}
          {events.busy && <Working text="Lese Ereignisprotokolle …" />}
          {events.data && (events.data.length === 0 ? <Empty>Keine Fehler protokolliert.</Empty> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Quelle</th><th className="num">Anzahl</th><th>Zuletzt</th><th>Meldung</th><th /></tr></thead>
              <tbody>{events.data.map((e) => (
                <tr key={`${e.provider}-${e.id}`}>
                  <td>{e.provider}<span className="path">ID {e.id} · {e.level}</span></td><td className="num">{e.count}</td>
                  <td className="dim">{dateTime(Date.parse(e.lastTime))}</td><td className="msg">{e.message}</td>
                  <td><Button variant="quiet" onClick={() => askAtlas(`Erkläre mir diesen Windows-Fehler und ob er wichtig ist: Quelle ${e.provider}, Ereignis-ID ${e.id}, ${e.count}× in 3 Tagen. Meldung: ${e.message}`)}>Erklären</Button></td>
                </tr>))}</tbody>
            </table></div>
          ))}
        </Panel>
      </div>
    </section>
  )
}
