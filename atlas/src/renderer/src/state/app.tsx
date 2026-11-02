import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { PageId } from '@shared/types'

export interface Toast { id: number; text: string; tone: 'ok' | 'error' | 'info' }

interface AppState {
  page: PageId
  navigate: (p: PageId) => void
  toasts: Toast[]
  toast: (text: string, tone?: Toast['tone']) => void
  pendingPrompt: string | null
  askAtlas: (text: string) => void
  consumePrompt: () => string | null
  /** Eigener Eingabedialog (Electron unterstützt window.prompt nicht). */
  ask: (label: string, initial?: string) => Promise<string | null>
  question: { label: string; initial: string; resolve: (v: string | null) => void } | null
  commandOpen: boolean
  openCommand: () => void
  closeCommand: () => void
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }): JSX.Element {
  const [page, setPage] = useState<PageId>('dashboard')
  const [toasts, setToasts] = useState<Toast[]>([])
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null)

  const [commandOpen, setCommandOpen] = useState(false)
  const openCommand = useCallback(() => setCommandOpen(true), [])
  const closeCommand = useCallback(() => setCommandOpen(false), [])
  const [question, setQuestion] = useState<AppState['question']>(null)
  const ask = useCallback((label: string, initial = '') => new Promise<string | null>((resolve) => {
    setQuestion({ label, initial, resolve: (v) => { setQuestion(null); resolve(v) } })
  }), [])

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000)
  }, [])

  const askAtlas = useCallback((text: string) => {
    setPendingPrompt(text)
    setPage('chat')
  }, [])

  const consumePrompt = useCallback(() => {
    const p = pendingPrompt
    setPendingPrompt(null)
    return p
  }, [pendingPrompt])

  return (
    <Ctx.Provider value={{ page, navigate: setPage, toasts, toast, pendingPrompt, askAtlas, consumePrompt, ask, question, commandOpen, openCommand, closeCommand }}>
      {children}
    </Ctx.Provider>
  )
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppProvider fehlt')
  return v
}
