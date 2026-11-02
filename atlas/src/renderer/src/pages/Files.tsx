import { useEffect, useState } from 'react'
import type { FileEntry } from '@shared/types'
import { Button, Empty, PageHeader, Panel, Working } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { useApp } from '../state/app'
import { bytes, date } from '../lib/format'


export function Files(): JSX.Element {
  const [dir, setDir] = useState('')
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const list = useCap('files.list')
  const search = useCap('files.search')
  const plan = useCap('files.organizePlan')
  const organize = useCap('files.organizeApply')
  const trash = useCap('files.trash')
  const move = useCap('files.move')
  const rename = useCap('files.rename')
  const mkdir = useCap('files.mkdir')
  const { ask } = useApp()
  const [places, setPlaces] = useState<Array<{ label: string; path: string }>>([])

  const open = async (d: string): Promise<void> => {
    const r = await list.run({ dir: d })
    if (r) { setDir(d); setInput(d); setSelected(new Set()); search.setData(null); plan.setData(null) }
  }
  useEffect(() => {
    void window.atlas.call('system.static', {}).then((r) => {
      if (!r.ok) return
      const p = r.data.paths
      setPlaces([{ label: 'Benutzerordner', path: p.home }, { label: 'Desktop', path: p.desktop }, { label: 'Downloads', path: p.downloads },
        { label: 'Dokumente', path: p.documents }, { label: 'Bilder', path: p.pictures }])
      void open(p.home)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (): void => void open(dir)
  const up = (): void => { const parent = dir.replace(/\\[^\\]+\\?$/, ''); if (parent && parent !== dir) void open(parent.endsWith(':') ? `${parent}\\` : parent) }
  const rows: FileEntry[] = search.data ? search.data.items : list.data ?? []
  const toggle = (p: string): void => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const single = selected.size === 1 ? [...selected][0]! : null

  return (
    <section className="page">
      <PageHeader title="Dateimanager" lead="Suchen, sortieren, verschieben und umbenennen. Verschieben, Umbenennen und Sortieren lassen sich im Verlauf rückgängig machen; Gelöschtes landet im Papierkorb." />
      <Panel wide>
        <div className="file-toolbar">
          <Button variant="quiet" onClick={up} disabled={!dir}>Nach oben</Button>
          <form className="path-form" onSubmit={(e) => { e.preventDefault(); void open(input) }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} aria-label="Pfad" />
          </form>
          <Button variant="quiet" onClick={async () => { const p = await window.atlas.pickFolder(); if (p) void open(p) }}>Ordner wählen …</Button>
          <form className="path-form search-form" onSubmit={(e) => { e.preventDefault(); if (query.trim()) void search.run({ root: dir, query, limit: 300 }) }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="In diesem Ordner suchen (auch *.pdf)" aria-label="Suchen" />
          </form>
        </div>
        <div className="places">
          {places.map((pl) => <button key={pl.path} type="button" className={pl.path === dir ? 'place active' : 'place'} onClick={() => void open(pl.path)}>{pl.label}</button>)}
        </div>
        <div className="file-actions">
          <Button variant="quiet" onClick={async () => { const n = await ask('Name des neuen Ordners'); if (n && await mkdir.run({ parent: dir, name: n })) refresh() }} disabled={!dir}>Neuer Ordner</Button>
          <Button variant="quiet" busy={plan.busy} onClick={() => void plan.run({ dir })} disabled={!dir}>Nach Typ sortieren …</Button>
          <span className="spacer" />
          {selected.size > 0 && <span className="dim">{selected.size} ausgewählt</span>}
          <Button variant="quiet" disabled={!single} onClick={async () => {
            const current = single!.split('\\').pop() ?? ''
            const n = await ask('Neuer Name', current)
            if (n && n !== current && await rename.run({ path: single!, newName: n }, { successToast: 'Umbenannt.' })) refresh()
          }}>Umbenennen</Button>
          <Button variant="quiet" disabled={selected.size === 0} onClick={async () => {
            const target = await window.atlas.pickFolder()
            if (target && await move.run({ paths: [...selected], targetDir: target }, { successToast: (o) => `${o.moved.length} verschoben.` })) refresh()
          }}>Verschieben …</Button>
          <Button variant="quiet" disabled={selected.size === 0} busy={trash.busy}
            onClick={async () => { if (await trash.run({ paths: [...selected] }, { successToast: (o) => `${o.trashed} im Papierkorb.` })) refresh() }}>Papierkorb</Button>
        </div>

        {plan.data && (
          <div className="plan">
            {plan.data.length === 0 ? <p className="meta">Hier liegen keine losen Dateien zum Sortieren.</p> : (
              <>
                <p className="row-title">Sortierplan: {plan.data.length} Dateien</p>
                <div className="plan-cats">
                  {Object.entries(plan.data.reduce<Record<string, number>>((m, p) => ({ ...m, [p.category ?? '?']: (m[p.category ?? '?'] ?? 0) + 1 }), {}))
                    .map(([c, n]) => <span key={c} className="tag">{c} · {n}</span>)}
                </div>
                <div className="btn-row">
                  <Button variant="primary" busy={organize.busy} onClick={async () => { if (await organize.run({ dir }, { successToast: (o) => `${o.moved.length} Dateien einsortiert.` })) refresh() }}>Sortieren</Button>
                  <Button variant="quiet" onClick={() => plan.setData(null)}>Verwerfen</Button>
                </div>
              </>
            )}
          </div>
        )}

        {search.data && <p className="meta">{search.data.items.length} Treffer{search.data.truncated && ' (gekürzt)'} · <button type="button" className="link" onClick={() => search.setData(null)}>Suche schließen</button></p>}
        {(list.busy || search.busy) && <Working text={search.busy ? 'Suche …' : 'Lade …'} />}
        {list.error && !list.data && <Empty>{list.error}</Empty>}
        {!list.busy && rows.length === 0 && list.data && <Empty>Dieser Ordner ist leer.</Empty>}
        {rows.length > 0 && (
          <div className="table-wrap files-table"><table>
            <thead><tr><th /><th>Name</th><th className="num">Größe</th><th>Geändert</th></tr></thead>
            <tbody>{rows.map((f) => (
              <tr key={f.path} className={selected.has(f.path) ? 'selected' : ''} onDoubleClick={() => f.isDir && void open(f.path)}>
                <td><input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} aria-label={`${f.name} auswählen`} /></td>
                <td>{f.isDir ? <button type="button" className="link dir" onClick={() => void open(f.path)}><span className="dir-mark" aria-hidden="true" />{f.name}</button> : <span className="file-name">{f.name}</span>}
                  {search.data && <span className="path">{f.path}</span>}</td>
                <td className="num">{f.isDir ? '' : bytes(f.size)}</td><td className="dim">{f.mtime ? date(f.mtime) : ''}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </section>
  )
}
