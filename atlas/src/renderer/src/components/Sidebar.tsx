import type { PageId } from '@shared/types'
import { FOOTER_IDS, NAV_BY_ID, NAV_GROUPS } from '../lib/nav'
import { useApp } from '../state/app'
import { useReports } from '../state/reports'
import { AtlasLogo } from './AtlasLogo'
import { Icon } from './Icon'

export function Sidebar(): JSX.Element {
  const { page, navigate } = useApp()
  const { security, optimize } = useReports()

  /** Kleine Zahl neben „Sicherheit“ und „Optimierung“, damit man sieht, wo etwas ansteht. */
  const badge = (id: PageId): JSX.Element | null => {
    if (id === 'security' && security && security.findings.length > 0) {
      const bad = security.findings.some((f) => f.severity === 'critical' || f.severity === 'high')
      return <em className={bad ? 'nav-badge bad' : 'nav-badge'} aria-label={`${security.findings.length} Befunde`}>{security.findings.length}</em>
    }
    if (id === 'optimize' && optimize && optimize.suggestions.length > 0) {
      return <em className="nav-badge" aria-label={`${optimize.suggestions.length} Vorschläge`}>{optimize.suggestions.length}</em>
    }
    return null
  }

  const item = (id: PageId): JSX.Element => {
    const n = NAV_BY_ID.get(id)!
    return (
      <li key={id}>
        <button type="button" className={id === page ? 'nav-item active' : 'nav-item'} aria-current={id === page ? 'page' : undefined}
          onClick={() => navigate(id)} title={n.hint}>
          <Icon name={id} />
          <span>{n.label}</span>
          {badge(id)}
        </button>
      </li>
    )
  }

  return (
    <nav className="sidebar" aria-label="Hauptnavigation">
      <div className="brand">
        <AtlasLogo size={40} />
        <div>
          <span className="brand-name">ATLAS</span>
          <span className="brand-sub">in Nebula</span>
        </div>
      </div>
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="nav-group">
          <p className="nav-label">{g.label}</p>
          <ul>{g.ids.map(item)}</ul>
        </div>
      ))}
      <ul className="nav-foot">{FOOTER_IDS.map(item)}</ul>
    </nav>
  )
}
