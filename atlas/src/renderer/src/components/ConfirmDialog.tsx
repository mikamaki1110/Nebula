import { useEffect, useRef, useState } from 'react'
import type { ConfirmRequest } from '@shared/types'

const RISK_TEXT = { read: '', modify: 'Änderung', critical: 'Kritische Änderung' } as const

/** Zentraler Bestätigungsdialog – jede verändernde Aktion landet hier, egal ob von Klick oder KI. */
export function ConfirmDialog(): JSX.Element | null {
  const [queue, setQueue] = useState<ConfirmRequest[]>([])
  const confirmRef = useRef<HTMLButtonElement>(null)
  const current = queue[0]

  useEffect(() => window.atlas.confirm.onRequest((r) => setQueue((q) => [...q, r])), [])
  useEffect(() => { if (current) confirmRef.current?.focus() }, [current])

  const answer = (approved: boolean): void => {
    if (!current) return
    void window.atlas.confirm.respond(current.id, approved)
    setQueue((q) => q.slice(1))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && current) answer(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!current) return null
  return (
    <div className="modal-backdrop" role="presentation">
      <div className={`modal risk-${current.risk}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <p className="modal-meta">{RISK_TEXT[current.risk]} · angefordert von {current.requestedBy}</p>
        <h2 id="confirm-title">{current.title}</h2>
        {current.details.length > 0 && <ul className="modal-details">{current.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
        {current.requiresAdmin && <p className="modal-admin">Windows wird anschließend nach Administratorrechten fragen.</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={() => answer(false)}>Abbrechen</button>
          <button type="button" ref={confirmRef} className={current.risk === 'critical' ? 'btn btn-danger' : 'btn btn-primary'} onClick={() => answer(true)}>
            {current.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
