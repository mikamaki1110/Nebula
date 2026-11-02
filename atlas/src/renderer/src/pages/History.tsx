import { useEffect, useState } from 'react'
import type { HistoryEntry } from '@shared/types'
import { Button, Empty, PageHeader, Panel } from '../components/ui'
import { dateTime } from '../lib/format'
import { useApp } from '../state/app'

export function History(): JSX.Element {
  const [items, setItems] = useState<HistoryEntry[] | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const { toast } = useApp()
  const load = (): void => void window.atlas.history.list().then(setItems)
  useEffect(load, [])

  return (
    <section className="page">
      <PageHeader title="Verlauf" lead="Alles, was ATLAS an deinem PC verändert hat. Verschieben, Umbenennen, Sortieren und Autostart lassen sich hier rückgängig machen." />
      <Panel wide>
        {items?.length === 0 && <Empty>Noch keine Änderungen. Sobald ATLAS etwas verändert, steht es hier.</Empty>}
        <ol className="timeline">
          {(items ?? []).map((h) => (
            <li key={h.id} className={h.undone ? 'undone' : ''}>
              <span className="tl-time">{dateTime(h.time)}</span>
              <span className="tl-text">{h.summary}{h.undone && <em> – rückgängig gemacht</em>}</span>
              {h.undoable && (
                <Button variant="quiet" busy={busyId === h.id} onClick={async () => {
                  setBusyId(h.id)
                  const r = await window.atlas.history.undo(h.id)
                  setBusyId(null)
                  if (r.ok) toast(r.data, 'ok')
                  else if (r.error !== 'Vom Benutzer abgelehnt.') toast(r.error, 'error')
                  load()
                }}>Rückgängig</Button>
              )}
            </li>
          ))}
        </ol>
      </Panel>
    </section>
  )
}
