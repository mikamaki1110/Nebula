import { useCallback, useRef, useState } from 'react'
import type { CapId, CapIn, CapOut } from '@shared/types'
import { useApp } from '../state/app'

interface CapState<K extends CapId> {
  data: CapOut<K> | null
  error: string | null
  busy: boolean
  run: (input: CapIn<K>, opts?: { successToast?: string | ((o: CapOut<K>) => string) }) => Promise<CapOut<K> | null>
  setData: (d: CapOut<K> | null) => void
}

/** Führt eine Fähigkeit aus und verwaltet Lade-, Fehler- und Ergebniszustand. */
export function useCap<K extends CapId>(id: K): CapState<K> {
  const { toast } = useApp()
  const [data, setData] = useState<CapOut<K> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const run = useCallback<CapState<K>['run']>(async (input, opts) => {
    const my = ++seq.current
    setBusy(true)
    setError(null)
    const res = await window.atlas.call(id, input)
    if (my !== seq.current) return null
    setBusy(false)
    if (res.ok) {
      setData(res.data)
      if (opts?.successToast) toast(typeof opts.successToast === 'function' ? opts.successToast(res.data) : opts.successToast, 'ok')
      return res.data
    }
    setError(res.error)
    if (res.error !== 'Vom Benutzer abgelehnt.') toast(res.error, 'error')
    return null
  }, [id, toast])

  return { data, error, busy, run, setData }
}
