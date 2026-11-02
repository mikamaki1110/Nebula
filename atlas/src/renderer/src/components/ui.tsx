import type { ReactNode } from 'react'
import type { Finding, FindingAction } from '@shared/types'
import { useApp } from '../state/app'
import { SEVERITY_LABEL } from '../lib/format'
import { Icon } from './Icon'

export function PageHeader({ title, lead, actions }: { title: string; lead?: string; actions?: ReactNode }): JSX.Element {
  const { page } = useApp()
  return (
    <header className="page-header">
      <div>
        <h1><span className="page-glyph"><Icon name={page} size={22} /></span>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </header>
  )
}

export function Panel({ title, children, wide, aside }: { title?: string; children: ReactNode; wide?: boolean; aside?: ReactNode }): JSX.Element {
  return (
    <article className={wide ? 'panel wide' : 'panel'}>
      {(title || aside) && (
        <div className="panel-head">
          {title && <h2>{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </article>
  )
}

export function Button({ children, onClick, busy, variant = 'default', disabled, title }: {
  children: ReactNode; onClick?: () => void; busy?: boolean; variant?: 'default' | 'primary' | 'quiet' | 'danger'; disabled?: boolean; title?: string
}): JSX.Element {
  return (
    <button type="button" className={`btn btn-${variant}`} onClick={onClick} disabled={disabled || busy} aria-busy={busy} title={title}>
      {busy && <span className="spinner" aria-hidden="true" />}
      {children}
    </button>
  )
}

export function Bar({ value, warnAt = 85 }: { value: number; warnAt?: number }): JSX.Element {
  const v = Math.min(100, Math.max(0, value))
  return (
    <div className="bar" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={v >= warnAt ? 'bar-fill warn' : 'bar-fill'} style={{ width: `${v}%` }} />
    </div>
  )
}

/** Platzhalter, solange ein Wert noch geladen wird – wirkt ruhiger und schneller als ein Text. */
export function Skel({ w = 80, h = 14, block }: { w?: number | string; h?: number; block?: boolean }): JSX.Element {
  return <span className={block ? 'skel skel-block' : 'skel'} style={{ width: typeof w === 'number' ? `${w}px` : w, height: h }} aria-hidden="true" />
}

export function Empty({ children }: { children: ReactNode }): JSX.Element {
  return <p className="empty">{children}</p>
}

export function Working({ text }: { text: string }): JSX.Element {
  return <p className="working"><span className="spinner" aria-hidden="true" />{text}</p>
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: Array<{ id: T; label: string }>; onChange: (v: T) => void }): JSX.Element {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={o.id === value} className={o.id === value ? 'tab active' : 'tab'} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Führt eine Befund-Aktion aus: Windows-Seite öffnen, Bereich wechseln oder Fähigkeit starten. */
export function useFindingAction(): (a: FindingAction) => Promise<void> {
  const { navigate, toast } = useApp()
  return async (a) => {
    if (a.kind === 'page') navigate(a.page)
    else if (a.kind === 'open') await window.atlas.call('system.openWindowsPage', { target: a.target })
    else {
      const res = await window.atlas.call(a.capId, a.input as never)
      if (res.ok) toast(`${a.label}: erledigt`, 'ok')
      else if (res.error !== 'Vom Benutzer abgelehnt.') toast(res.error, 'error')
    }
  }
}

export function FindingList({ findings, emptyText }: { findings: Finding[]; emptyText: string }): JSX.Element {
  const act = useFindingAction()
  if (findings.length === 0) return <div className="all-clear"><span className="all-clear-mark" aria-hidden="true" />{emptyText}</div>
  return (
    <ul className="findings">
      {findings.map((f) => (
        <li key={f.id} className={`finding sev-${f.severity}`}>
          <div className="finding-head">
            <span className="sev-badge">{SEVERITY_LABEL[f.severity]}</span>
            <h3>{f.title}</h3>
          </div>
          <p>{f.explanation}</p>
          <p className="finding-rec">{f.recommendation}</p>
          {f.action && <Button variant="quiet" onClick={() => void act(f.action!)}>{f.action.label}</Button>}
        </li>
      ))}
    </ul>
  )
}

export function FolderField({ value, onChange, label = 'Ordner' }: { value: string; onChange: (v: string) => void; label?: string }): JSX.Element {
  return (
    <div className="folder-field">
      <label>
        <span>{label}</span>
        <input value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </label>
      <Button variant="quiet" onClick={async () => { const p = await window.atlas.pickFolder(); if (p) onChange(p) }}>Auswählen …</Button>
    </div>
  )
}
