import { useEffect, useState } from 'react'
import type { Snapshot } from '@shared/types'
import { Button, FindingList, PageHeader, Panel, Working } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { bytes, dateTime } from '../lib/format'
import { ago, seconds } from '../lib/time'
import { useReports } from '../state/reports'

function Delta({ before, after, kind, lowerIsBetter }: { before: number; after: number; kind: 'bytes' | 'pct' | 'count'; lowerIsBetter: boolean }): JSX.Element {
  const d = after - before
  const good = d === 0 ? null : lowerIsBetter ? d < 0 : d > 0
  const f = (v: number): string => (kind === 'bytes' ? bytes(Math.abs(v)) : kind === 'pct' ? `${Math.abs(v).toFixed(1).replace('.', ',')} %-Pkt.` : String(Math.abs(v)))
  return <span className={good === null ? 'delta' : good ? 'delta good' : 'delta bad'}>{d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${f(d)}`}</span>
}

export function Optimize(): JSX.Element {
  const { optimize, optimizeBusy, optimizeError, refreshOptimize } = useReports()
  const snap = useCap('optimize.snapshot')
  const snaps = useCap('optimize.snapshots')
  const [baseId, setBaseId] = useState<number | null>(null)

  useEffect(() => { void refreshOptimize(false); void snaps.run({}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const list = snaps.data ?? []
  const latest = list[0]
  const base: Snapshot | undefined = list.find((s) => s.id === baseId) ?? list[list.length - 1]

  return (
    <section className="page">
      <PageHeader title="Optimierung" lead="Gezielte Vorschläge statt pauschaler „Tuning“-Tricks. Keine Registry-Cleaner, nichts Fragwürdiges."
        actions={<Button variant="primary" busy={optimizeBusy} onClick={() => void refreshOptimize(true)}>Neu analysieren</Button>} />
      <div className="grid">
        <Panel title="Vorschläge" wide>
          {optimizeBusy && !optimize ? <Working text="Analysiere Autostart, Ressourcen, Speicherplatz und Energieplan – alles gleichzeitig …" />
            : optimize && <>
                {optimizeBusy && <p className="refresh-note"><span className="spinner" aria-hidden="true" />Zeige den letzten Stand ({ago(optimize.time)}) und analysiere im Hintergrund erneut …</p>}
                <FindingList findings={optimize.suggestions} emptyText="Dein PC ist gut eingestellt. Nichts zu tun." />
                <p className="meta subtle">Analysiert {ago(optimize.time)} · dauerte {seconds(optimize.tookMs)}</p>
              </>}
          {optimizeError && !optimize && <p className="meta">{optimizeError}</p>}
        </Panel>
        <Panel title="Vorher-Nachher" wide aside={
          <Button busy={snap.busy} onClick={async () => { if (await snap.run({}, { successToast: 'Messpunkt gespeichert.' })) void snaps.run({}) }}>Messpunkt speichern</Button>
        }>
          <p className="meta">Speichere vor dem Aufräumen einen Messpunkt und danach einen zweiten. ATLAS zeigt dir, was sich verändert hat.</p>
          {list.length >= 2 && latest && base && latest.id !== base.id && (
            <div className="compare">
              <label className="num-field"><span>Vergleichen mit</span>
                <select value={base.id} onChange={(e) => setBaseId(Number(e.target.value))}>
                  {list.slice(1).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <table>
                <thead><tr><th /><th className="num">Vorher</th><th className="num">Nachher</th><th className="num">Veränderung</th></tr></thead>
                <tbody>
                  <tr><td>Freier Platz (Systemlaufwerk)</td><td className="num">{bytes(base.freeSystemBytes)}</td><td className="num">{bytes(latest.freeSystemBytes)}</td><td className="num"><Delta before={base.freeSystemBytes} after={latest.freeSystemBytes} kind="bytes" lowerIsBetter={false} /></td></tr>
                  <tr><td>Arbeitsspeicher belegt</td><td className="num">{base.ramUsedPct} %</td><td className="num">{latest.ramUsedPct} %</td><td className="num"><Delta before={base.ramUsedPct} after={latest.ramUsedPct} kind="pct" lowerIsBetter /></td></tr>
                  <tr><td>Autostart-Programme</td><td className="num">{base.autostartEnabled}</td><td className="num">{latest.autostartEnabled}</td><td className="num"><Delta before={base.autostartEnabled} after={latest.autostartEnabled} kind="count" lowerIsBetter /></td></tr>
                  <tr><td>Laufende Prozesse</td><td className="num">{base.processCount}</td><td className="num">{latest.processCount}</td><td className="num"><Delta before={base.processCount} after={latest.processCount} kind="count" lowerIsBetter /></td></tr>
                  <tr><td>Temporäre Dateien</td><td className="num">{bytes(base.tempBytes)}</td><td className="num">{bytes(latest.tempBytes)}</td><td className="num"><Delta before={base.tempBytes} after={latest.tempBytes} kind="bytes" lowerIsBetter /></td></tr>
                </tbody>
              </table>
              <p className="meta subtle">Nachher: {dateTime(latest.time)}</p>
            </div>
          )}
          {list.length === 1 && <p className="meta">Ein Messpunkt gespeichert ({list[0]!.label}). Speichere nach deinen Änderungen einen zweiten.</p>}
        </Panel>
      </div>
    </section>
  )
}
