import { useApp } from '../state/app'

export function Toasts(): JSX.Element {
  const { toasts } = useApp()
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
    </div>
  )
}
