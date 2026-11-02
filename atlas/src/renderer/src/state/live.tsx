import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { LiveMetrics } from '@shared/types'

const INTERVAL_MS = 2000
export const HISTORY_POINTS = 90

export interface Sample { t: number; cpu: number; ram: number; rx: number; tx: number; gpu: number | null }
interface LiveState { data: LiveMetrics | null; error: string | null; samples: Sample[] }

const Ctx = createContext<LiveState>({ data: null, error: null, samples: [] })

/** Ein einziger Abfrage-Takt für die ganze App; pausiert bei verborgenem Fenster. */
export function LiveProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<LiveState>({ data: null, error: null, samples: [] })

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async (): Promise<void> => {
      if (!document.hidden) {
        const res = await window.atlas.call('system.live', {})
        if (cancelled) return
        if (res.ok) {
          const d = res.data
          const sample: Sample = {
            t: d.timestamp,
            cpu: d.cpu.load,
            ram: (d.memory.used / d.memory.total) * 100,
            rx: d.network.reduce((n, x) => n + (x.rxPerSec ?? 0), 0),
            tx: d.network.reduce((n, x) => n + (x.txPerSec ?? 0), 0),
            gpu: d.gpus[0]?.load ?? null
          }
          setState((s) => ({ data: d, error: null, samples: [...s.samples, sample].slice(-HISTORY_POINTS) }))
        } else {
          setState((s) => ({ ...s, error: res.error }))
        }
      }
      timer = setTimeout(tick, INTERVAL_MS)
    }
    void tick()
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [])

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}

export const useLive = (): LiveState => useContext(Ctx)
