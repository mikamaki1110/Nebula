import { useId } from 'react'

export type LogoState = 'idle' | 'thinking' | 'speaking'

const reducedMotion = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Gesamte Umlaufbahn als Pfad: erst die obere Hälfte (hinter dem „A“), dann die untere (davor). */
const ORBIT = 'M10 40 A22 7.5 0 0 1 54 40 A22 7.5 0 0 1 10 40'

/**
 * Das ATLAS-Zeichen: ein „A“, das zugleich ein Berggipfel ist (das Atlasgebirge, die Karte), mit einer
 * Umlaufbahn als Querbalken und einem Mond darauf. Der Mond wandert auf der Bahn; hinter dem „A“ ist er
 * gedämpft, davor hell – das gibt Tiefe.
 *
 * state: idle = ruhig kreisend · thinking = schneller · speaking = Gipfelstern pulsiert
 * reveal: Zeichen wird beim Erscheinen „gezeichnet“ (für den Startbildschirm)
 */
export function AtlasLogo({ size = 40, state = 'idle', reveal = false, animated = true }: {
  size?: number
  state?: LogoState
  reveal?: boolean
  animated?: boolean
}): JSX.Element {
  const uid = useId().replace(/:/g, '')
  const move = animated && !reducedMotion
  const dur = state === 'thinking' ? '1.8s' : '8s'
  return (
    <svg className={`atlas-logo logo-${state}${reveal ? ' logo-reveal' : ''}`} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="ATLAS">
      <defs>
        <linearGradient id={`la${uid}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <circle className="logo-ring" cx="32" cy="32" r="29.5" />
      <g transform="rotate(-14 32 40)">
        <path className="logo-orbit logo-orbit-back" d="M10 40 A22 7.5 0 0 1 54 40" />
      </g>
      <path className="logo-a" d="M13 52 L32 10 L51 52" stroke={`url(#la${uid})`} />
      <g transform="rotate(-14 32 40)">
        <path className="logo-orbit" d="M54 40 A22 7.5 0 0 1 10 40" />
        <g className="logo-moon-wrap">
          <circle className="logo-moon" r="2.7" cx={move ? 0 : 54} cy={move ? 0 : 40}>
            {move && (
              <>
                <animateMotion dur={dur} repeatCount="indefinite" path={ORBIT} />
                {/* hinter dem „A“ (erste Hälfte der Bahn) gedämpft, davor hell */}
                <animate attributeName="opacity" dur={dur} repeatCount="indefinite" values="0.4;0.4;1;1" keyTimes="0;0.5;0.5;1" />
              </>
            )}
          </circle>
        </g>
      </g>
      <circle className="logo-star" cx="32" cy="10" r="3.3" />
    </svg>
  )
}
