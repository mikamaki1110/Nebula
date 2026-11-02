import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/app'
import { Icon } from './Icon'

const SUGGEST = ['Wie viel Speicherplatz habe ich noch?', 'Mein PC ist langsam. Finde heraus, warum.', 'Sortiere meinen Downloads-Ordner.']

/** Strg+K: Von überall aus einen Auftrag an ATLAS geben. */
export function CommandBar(): JSX.Element | null {
  const { askAtlas, commandOpen, openCommand, closeCommand } = useApp()
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (commandOpen) closeCommand(); else openCommand() }
      else if (e.key === 'Escape' && commandOpen) closeCommand()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [commandOpen, openCommand, closeCommand])
  useEffect(() => { if (commandOpen) inputRef.current?.focus() }, [commandOpen])

  if (!commandOpen) return null
  const submit = (t: string): void => { if (t.trim()) { askAtlas(t.trim()); setText(''); closeCommand() } }
  return (
    <div className="modal-backdrop command-backdrop" onMouseDown={closeCommand}>
      <div className="command-bar" onMouseDown={(e) => e.stopPropagation()}>
        <form onSubmit={(e) => { e.preventDefault(); submit(text) }}>
          <Icon name="spark" size={22} />
          <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Was soll ATLAS tun?" aria-label="Auftrag an ATLAS" />
          <kbd>Enter</kbd>
        </form>
        <ul>
          {SUGGEST.map((s) => <li key={s}><button type="button" onClick={() => submit(s)}><Icon name="arrow" size={15} />{s}</button></li>)}
        </ul>
      </div>
    </div>
  )
}
