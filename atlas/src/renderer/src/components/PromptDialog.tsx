import { useEffect, useRef, useState } from 'react'
import { useApp } from '../state/app'

export function PromptDialog(): JSX.Element | null {
  const { question } = useApp()
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (question) {
      setValue(question.initial)
      setTimeout(() => { ref.current?.focus(); ref.current?.select() }, 0)
    }
  }, [question])
  if (!question) return null
  return (
    <div className="modal-backdrop" role="presentation" onKeyDown={(e) => e.key === 'Escape' && question.resolve(null)}>
      <form className="modal" role="dialog" aria-modal="true" aria-labelledby="prompt-title"
        onSubmit={(e) => { e.preventDefault(); question.resolve(value.trim() || null) }}>
        <h2 id="prompt-title">{question.label}</h2>
        <input ref={ref} className="modal-input" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="modal-actions">
          <button type="button" className="btn btn-quiet" onClick={() => question.resolve(null)}>Abbrechen</button>
          <button type="submit" className="btn btn-primary">OK</button>
        </div>
      </form>
    </div>
  )
}
