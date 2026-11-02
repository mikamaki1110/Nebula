import { useMemo, type CSSProperties } from 'react'

interface Ring { d: string; o: number }

/** Verschachtelte, organisch geformte Ringe um einen Mittelpunkt – wie Höhenlinien auf einer Landkarte. */
function rings(cx: number, cy: number, count: number, start: number, step: number, wide: number, phase: number): Ring[] {
  const out: Ring[] = []
  for (let k = 0; k < count; k++) {
    const base = start + k * step
    const pts: string[] = []
    for (let i = 0; i <= 140; i++) {
      const t = (i / 140) * Math.PI * 2
      const wobble = 1 + 0.1 * Math.sin(2 * t + phase + k * 0.09) + 0.06 * Math.sin(3 * t + phase * 1.7 + k * 0.05) + 0.035 * Math.sin(5 * t + phase * 0.6 - k * 0.07)
      const r = base * wobble
      pts.push(`${i === 0 ? 'M' : 'L'}${(cx + r * wide * Math.cos(t)).toFixed(1)} ${(cy + r * Math.sin(t)).toFixed(1)}`)
    }
    out.push({ d: `${pts.join(' ')}Z`, o: Math.max(0.12, 0.62 - k * 0.032) })
  }
  return out
}

/**
 * Das Bildmotiv von ATLAS: Höhenlinien (die Isothermen aus Nebulas Wärmebild-Hintergrund, als „Atlas“-Karte).
 * heat (0–1) lässt die Linien bei hoher Prozessorlast heller werden.
 */
export function ContourMap({ heat }: { heat: number }): JSX.Element {
  const all = useMemo(() => [...rings(330, 215, 15, 26, 15, 1.45, 0.4), ...rings(980, 130, 11, 20, 14, 1.3, 2.1)], [])
  return (
    <svg className="contours" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"
      style={{ '--heat': Math.min(1, Math.max(0, heat)) } as CSSProperties}>
      {all.map((r, i) => <path key={i} d={r.d} style={{ opacity: r.o }} />)}
    </svg>
  )
}
