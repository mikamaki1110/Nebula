interface Ring { label: string; value: number; tone: 'brass' | 'lilac' | 'sage' }
const RADII = [118, 94, 70]

/** Orbit-Anzeige: jede Messgröße ist eine Umlaufbahn, der „Mond“ markiert den aktuellen Wert. */
export function OrbitGauge({ rings, center, caption }: { rings: Ring[]; center: string; caption: string }): JSX.Element {
  return (
    <figure className="orbit">
      <svg viewBox="0 0 280 280" role="img" aria-label={rings.map((r) => `${r.label} ${Math.round(r.value)} Prozent`).join(', ')}>
        <g className="orbit-ticks">
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2
            const long = i % 5 === 0
            const r1 = 134
            const r2 = long ? 127 : 131
            return <line key={i} x1={140 + r1 * Math.cos(a)} y1={140 + r1 * Math.sin(a)} x2={140 + r2 * Math.cos(a)} y2={140 + r2 * Math.sin(a)} className={long ? 'tick long' : 'tick'} />
          })}
        </g>
        {rings.map((ring, i) => {
          const r = RADII[i] ?? 50
          const c = 2 * Math.PI * r
          const v = Math.min(100, Math.max(0, ring.value))
          const angle = (v / 100) * 2 * Math.PI - Math.PI / 2
          return (
            <g key={ring.label} className="orbit-ring" style={{ animationDelay: `${i * 120}ms` }}>
              <circle className="orbit-track" cx="140" cy="140" r={r} />
              <circle className={`orbit-arc tone-${ring.tone}`} cx="140" cy="140" r={r} strokeDasharray={c}
                strokeDashoffset={c * (1 - v / 100)} transform="rotate(-90 140 140)" />
              <circle className={`orbit-moon tone-${ring.tone}`} r="5" cx={140 + r * Math.cos(angle)} cy={140 + r * Math.sin(angle)} />
            </g>
          )
        })}
        <text x="140" y="146" className="orbit-value">{center}</text>
        <text x="140" y="170" className="orbit-caption">{caption}</text>
      </svg>
      <figcaption>
        {rings.map((ring) => (
          <span key={ring.label} className="legend">
            <i className={`dot tone-${ring.tone}`} />{ring.label}<strong>{Math.round(ring.value)} %</strong>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
