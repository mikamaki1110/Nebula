import type { PageId } from '@shared/types'

type IconName = PageId | 'search' | 'spark' | 'arrow'

/** Eigene Linien-Icons, 24er Raster, 1,6 px Strich – passend zur Instrumenten-Optik. */
const PATHS: Record<IconName, JSX.Element> = {
  dashboard: <><circle cx="12" cy="12" r="8.5" /><ellipse cx="12" cy="12" rx="8.5" ry="3.2" transform="rotate(-25 12 12)" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  chat: <><path d="M4.5 6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3.5v-3.5h0a2 2 0 0 1-2-2z" /><path d="M8.5 10.5h7M8.5 13h4" /></>,
  monitor: <><path d="M3 12h3.5l2-5 3.5 10 2.5-7 1.5 2H21" /></>,
  storage: <><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" /><path d="M5 12v6c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-6" /></>,
  programs: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><path d="M16.75 13.5v6.5M13.5 16.75H20" /></>,
  security: <><path d="M12 3.5 19 6v5.5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  optimize: <><path d="M4.5 16a7.5 7.5 0 1 1 15 0" /><path d="m12 16 4-5" /><circle cx="12" cy="16" r="1.3" fill="currentColor" stroke="none" /><path d="M6 19.5h12" /></>,
  repair: <><path d="M14.5 5.5a4 4 0 0 0-4.9 5.2L4.5 15.8a1.9 1.9 0 0 0 2.7 2.7l5.1-5.1a4 4 0 0 0 5.2-4.9l-2.4 2.4-2.3-.4-.4-2.3z" /></>,
  files: <><path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /></>,
  settings: <><path d="M5 7h9M18 7h1M5 17h3M12 17h7" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /><path d="M5 12h1M10 12h9" /><circle cx="8" cy="12" r="2" /></>,
  history: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4 4.5v3.5h3.5" /><path d="M12 8v4.3l3 1.7" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></>,
  spark: <><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>
}

export function Icon({ name, size = 20 }: { name: IconName; size?: number }): JSX.Element {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}
