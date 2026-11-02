import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { OptimizeReport, SecurityReport } from '@shared/types'

const STALE_MS = 10 * 60_000

interface ReportsState {
  security: SecurityReport | null
  securityBusy: boolean
  securityError: string | null
  optimize: OptimizeReport | null
  optimizeBusy: boolean
  optimizeError: string | null
  /** force = true: immer neu prüfen; sonst nur, wenn der Stand älter als 10 Minuten ist. */
  refreshSecurity: (force?: boolean) => Promise<void>
  refreshOptimize: (force?: boolean) => Promise<void>
}

const Ctx = createContext<ReportsState | null>(null)

/**
 * Hält die letzten Sicherheits- und Optimierungsberichte für die ganze App.
 * Beim Start erscheint sofort der zuletzt gespeicherte Stand; die neue Prüfung läuft im Hintergrund.
 */
export function ReportsProvider({ children }: { children: ReactNode }): JSX.Element {
  const [security, setSecurity] = useState<SecurityReport | null>(null)
  const [securityBusy, setSecurityBusy] = useState(false)
  const [securityError, setSecurityError] = useState<string | null>(null)
  const [optimize, setOptimize] = useState<OptimizeReport | null>(null)
  const [optimizeBusy, setOptimizeBusy] = useState(false)
  const [optimizeError, setOptimizeError] = useState<string | null>(null)
  const latest = useRef({ security, optimize })
  latest.current = { security, optimize }
  const running = useRef({ security: false, optimize: false })

  const refreshSecurity = useCallback(async (force = false): Promise<void> => {
    const current = latest.current.security
    if (running.current.security) return
    if (!force && current && Date.now() - current.time < STALE_MS) return
    running.current.security = true
    setSecurityBusy(true)
    const res = await window.atlas.call('security.report', { refresh: force || !!current })
    running.current.security = false
    setSecurityBusy(false)
    if (res.ok) { setSecurity(res.data); setSecurityError(null) } else setSecurityError(res.error)
  }, [])

  const refreshOptimize = useCallback(async (force = false): Promise<void> => {
    const current = latest.current.optimize
    if (running.current.optimize) return
    if (!force && current && Date.now() - current.time < STALE_MS) return
    running.current.optimize = true
    setOptimizeBusy(true)
    const res = await window.atlas.call('optimize.report', {})
    running.current.optimize = false
    setOptimizeBusy(false)
    if (res.ok) { setOptimize(res.data); setOptimizeError(null) } else setOptimizeError(res.error)
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      // 1) Letzter gespeicherter Stand – erscheint sofort
      const [sc, oc] = await Promise.all([window.atlas.call('security.cached', {}), window.atlas.call('optimize.cached', {})])
      if (!alive) return
      if (sc.ok && sc.data) setSecurity(sc.data)
      if (oc.ok && oc.data) setOptimize(oc.data)
      // 2) Danach im Hintergrund aktualisieren – die Optimierung leicht versetzt, damit der Start nicht stockt
      latest.current = { security: sc.ok ? sc.data : null, optimize: oc.ok ? oc.data : null }
      void refreshSecurity(true)
      setTimeout(() => { if (alive) void refreshOptimize(true) }, 1500)
    })()
    return () => { alive = false }
  }, [refreshSecurity, refreshOptimize])

  return (
    <Ctx.Provider value={{ security, securityBusy, securityError, optimize, optimizeBusy, optimizeError, refreshSecurity, refreshOptimize }}>
      {children}
    </Ctx.Provider>
  )
}

export function useReports(): ReportsState {
  const v = useContext(Ctx)
  if (!v) throw new Error('ReportsProvider fehlt')
  return v
}
