import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Settings } from '@shared/types'

export type ChatItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'atlas'; id: number; text: string }
  | { kind: 'step'; id: number; agent: string; text: string }
  | { kind: 'error'; id: number; text: string }

interface ChatState {
  items: ChatItem[]
  busy: boolean
  send: (text: string) => void
  cancel: () => void
  reset: () => void
  speaking: boolean
  stopSpeaking: () => void
  speak: (text: string) => void
  settings: Settings | null
  saveSettings: (patch: Partial<Settings>) => Promise<void>
}

const Ctx = createContext<ChatState | null>(null)
let nextId = 1

/** Entfernt Markdown-Zeichen, damit die Sprachausgabe natürlich klingt. */
const forSpeech = (t: string): string => t.replace(/\*\*|__|`/g, '').replace(/^\s*-\s+/gm, '').replace(/[•→]/g, '')

export function ChatProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<ChatItem[]>([])
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const settingsRef = useRef<Settings | null>(null)
  settingsRef.current = settings

  useEffect(() => { void window.atlas.settings.get().then(setSettings) }, [])

  const stopSpeaking = useCallback(() => {
    window.speechSynthesis?.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback((text: string) => {
    const s = settingsRef.current
    if (!window.speechSynthesis) return
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(forSpeech(text))
    const voices = window.speechSynthesis.getVoices()
    u.voice = voices.find((v) => v.name === s?.voiceName) ?? voices.find((v) => v.lang.startsWith('de')) ?? null
    u.lang = u.voice?.lang ?? 'de-DE'
    u.rate = s?.voiceRate ?? 1
    u.onend = () => setSpeaking(false)
    u.onerror = () => setSpeaking(false)
    setSpeaking(true)
    window.speechSynthesis.speak(u)
  }, [])

  useEffect(() => window.atlas.chat.onEvent((e) => {
    if (e.type === 'step') setItems((i) => [...i, { kind: 'step', id: nextId++, agent: e.agent, text: e.text }])
    else if (e.type === 'message') {
      setItems((i) => [...i, { kind: 'atlas', id: nextId++, text: e.text }])
      if (settingsRef.current?.voiceOutput) speak(e.text)
    } else if (e.type === 'error') setItems((i) => [...i, { kind: 'error', id: nextId++, text: e.text }])
    else if (e.type === 'done') setBusy(false)
  }), [speak])

  const send = useCallback((text: string) => {
    stopSpeaking()
    setItems((i) => [...i, { kind: 'user', id: nextId++, text }])
    setBusy(true)
    void window.atlas.chat.send(text)
  }, [stopSpeaking])

  const cancel = useCallback(() => { void window.atlas.chat.cancel() }, [])
  const reset = useCallback(() => { stopSpeaking(); setItems([]); setBusy(false); void window.atlas.chat.reset() }, [stopSpeaking])
  const saveSettings = useCallback(async (patch: Partial<Settings>) => { setSettings(await window.atlas.settings.set(patch)) }, [])

  return (
    <Ctx.Provider value={{ items, busy, send, cancel, reset, speaking, stopSpeaking, speak, settings, saveSettings }}>
      {children}
    </Ctx.Provider>
  )
}

export function useChat(): ChatState {
  const v = useContext(Ctx)
  if (!v) throw new Error('ChatProvider fehlt')
  return v
}
