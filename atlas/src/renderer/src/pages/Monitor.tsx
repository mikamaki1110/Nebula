import { useEffect, useState } from 'react'
import type { ProcessRow } from '@shared/types'
import { LineChart } from '../components/LineChart'
import { Button, PageHeader, Panel, Tabs } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { bytes, rate } from '../lib/format'
import { useLive } from '../state/live'

const CRITICAL = ['system', 'registry', 'smss.exe', 'csrss.exe', 'wininit.exe', 'winlogon.exe', 'services.exe', 'lsass.exe', 'svchost.exe', 'dwm.exe', 'memory compression', 'msmpeng.exe']

export function Monitor(): JSX.Element {
  const { samples } = useLive()
  const [sortBy, setSortBy] = useState<'cpu' | 'memory'>('cpu')
  const [query, setQuery] = useState('')
  const procs = useCap('system.processes')
  const kill = useCap('process.kill')

  useEffect(() => {
    const load = (): void => void procs.run({ sortBy, limit: 60, query: query || undefined })
    load()
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortBy, query])

  const recentCpu = samples.slice(-15)
  const sustainedHigh = recentCpu.length >= 15 && recentCpu.every((s) => s.cpu > 90)
  const ramHigh = (samples[samples.length - 1]?.ram ?? 0) > 92

  const end = async (p: ProcessRow): Promise<void> => {
    const r = await kill.run({ pid: p.pid, name: p.name }, { successToast: `${p.name} wurde beendet.` })
    if (r) void procs.run({ sortBy, limit: 60, query: query || undefined })
  }

  return (
    <section className="page">
      <PageHeader title="PC-Überwachung" lead="Die letzten drei Minuten im Verlauf. Werte aktualisieren sich alle zwei Sekunden." />
      {(sustainedHigh || ramHigh) && (
        <p className="alert">
          {sustainedHigh && 'Der Prozessor ist seit 30 Sekunden durchgehend über 90 % ausgelastet. '}
          {ramHigh && 'Der Arbeitsspeicher ist fast voll – Windows lagert auf die Festplatte aus.'}
        </p>
      )}
      <div className="grid">
        <Panel title="Prozessor und Arbeitsspeicher" wide>
          <LineChart max={100} format={(v) => `${Math.round(v)} %`} series={[
            { label: 'Prozessor', tone: 'brass', values: samples.map((s) => s.cpu) },
            { label: 'Arbeitsspeicher', tone: 'lilac', values: samples.map((s) => s.ram) },
            ...(samples.some((s) => s.gpu !== null) ? [{ label: 'Grafik', tone: 'sage' as const, values: samples.map((s) => s.gpu) }] : [])
          ]} />
        </Panel>
        <Panel title="Netzwerk" wide>
          <LineChart height={90} format={(v) => rate(v)} series={[
            { label: 'Empfangen', tone: 'sage', values: samples.map((s) => s.rx) },
            { label: 'Gesendet', tone: 'ember', values: samples.map((s) => s.tx) }
          ]} />
        </Panel>
        <Panel title="Prozesse" wide aside={
          <div className="inline-controls">
            <input className="search" placeholder="Filtern …" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Prozesse filtern" />
            <Tabs value={sortBy} onChange={setSortBy} options={[{ id: 'cpu', label: 'Nach CPU' }, { id: 'memory', label: 'Nach Speicher' }]} />
          </div>
        }>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>PID</th><th className="num">CPU</th><th className="num">Speicher</th><th>Pfad</th><th /></tr></thead>
              <tbody>
                {(procs.data ?? []).map((p) => (
                  <tr key={p.pid}>
                    <td>{p.name}</td><td className="dim">{p.pid}</td>
                    <td className="num">{p.cpu.toFixed(1)} %</td><td className="num">{bytes(p.memBytes)}</td>
                    <td className="path" title={p.path}>{p.path || '–'}</td>
                    <td>{!CRITICAL.includes(p.name.toLowerCase()) && <Button variant="quiet" onClick={() => void end(p)}>Beenden</Button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </section>
  )
}
