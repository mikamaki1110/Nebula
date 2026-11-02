interface Series { values: Array<number | null>; tone: 'brass' | 'lilac' | 'sage' | 'ember'; label: string }

/** Schlankes SVG-Liniendiagramm mit Flächenfüllung; max = feste Obergrenze oder automatisch. */
export function LineChart({ series, max, height = 120, format, capacity = 90 }: { series: Series[]; max?: number; height?: number; format: (v: number) => string; capacity?: number }): JSX.Element {
  const W = 600
  const H = height
  // Feste Zeitachse: neue Werte erscheinen rechts, die Kurve wächst nach links.
  const n = Math.max(capacity, ...series.map((s) => s.values.length))
  const peak = max ?? Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))) * 1.15
  const x = (i: number): number => (i / (n - 1)) * W
  const y = (v: number): number => H - (Math.min(v, peak) / peak) * (H - 6) - 3
  const last = series.map((s) => [...s.values].reverse().find((v) => v !== null) ?? null)

  return (
    <div className="linechart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={series.map((s, i) => `${s.label}: ${last[i] !== null ? format(last[i]!) : '–'}`).join(', ')}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} className="grid-line" />)}
        {series.map((s, si) => {
          const offset = n - s.values.length
          const pts = s.values.map((v, i) => (v === null ? null : `${x(i + offset)},${y(v)}`)).filter(Boolean) as string[]
          if (pts.length < 2) return null
          const first = pts[0]!.split(',')[0]
          const lastX = pts[pts.length - 1]!.split(',')[0]
          return (
            <g key={s.label}>
              {si === 0 && <polygon className={`area tone-${s.tone}`} points={`${first},${H} ${pts.join(' ')} ${lastX},${H}`} />}
              <polyline className={`line tone-${s.tone}`} points={pts.join(' ')} vectorEffect="non-scaling-stroke" />
            </g>
          )
        })}
      </svg>
      <div className="chart-legend">
        {series.map((s, i) => (
          <span key={s.label} className="legend"><i className={`dot tone-${s.tone}`} />{s.label}<strong>{last[i] !== null ? format(last[i]!) : '–'}</strong></span>
        ))}
      </div>
    </div>
  )
}
