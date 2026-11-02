import { Fragment, type ReactNode } from 'react'

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>
  )
}

/** Minimaler, sicherer Text-Renderer: Absätze, „- “-Listen, **fett**. Kein HTML. */
export function RichText({ text }: { text: string }): JSX.Element {
  const blocks: ReactNode[] = []
  let list: string[] = []
  const flush = (): void => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>)
    list = []
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:[-•*]|\d+\.)\s+(.*)$/.exec(line)
    if (m) list.push(m[1]!)
    else {
      flush()
      if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>)
    }
  }
  flush()
  return <div className="rich">{blocks}</div>
}
