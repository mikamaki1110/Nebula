import { useEffect, useMemo, useState } from 'react'
import type { AutostartEntry, FileEntry, Program } from '@shared/types'
import { Button, Empty, PageHeader, Panel, Tabs, Working } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { bytes } from '../lib/format'
import { useApp } from '../state/app'

export function Programs(): JSX.Element {
  const [tab, setTab] = useState<'installed' | 'autostart'>('installed')
  return (
    <section className="page">
      <PageHeader title="Programme" lead="Installierte Software vollständig entfernen und bestimmen, was mit Windows startet." />
      <Tabs value={tab} onChange={setTab} options={[{ id: 'installed', label: 'Installiert' }, { id: 'autostart', label: 'Autostart' }]} />
      {tab === 'installed' ? <Installed /> : <Autostart />}
    </section>
  )
}

function Installed(): JSX.Element {
  const list = useCap('programs.list')
  const uninstall = useCap('programs.uninstall')
  const leftovers = useCap('programs.leftovers')
  const trash = useCap('files.trash')
  const { askAtlas } = useApp()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<'name' | 'size'>('name')
  const [active, setActive] = useState<Program | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())

  useEffect(() => { void list.run({}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    const q = query.toLowerCase()
    const filtered = (list.data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || (p.publisher ?? '').toLowerCase().includes(q))
    return sort === 'size' ? [...filtered].sort((a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)) : filtered
  }, [list.data, query, sort])

  const remove = async (p: Program): Promise<void> => {
    setActive(p)
    leftovers.setData(null)
    const r = await uninstall.run({ id: p.id })
    if (!r) return
    if (r.stillInstalled) return
    const found = await leftovers.run({ name: p.name, publisher: p.publisher ?? undefined, installLocation: p.installLocation ?? undefined })
    setPicked(new Set((found ?? []).map((f) => f.path)))
    void list.run({})
  }

  return (
    <div className="grid">
      {active && (uninstall.busy || uninstall.data || leftovers.data) && (
        <Panel title={`Deinstallation: ${active.name}`} wide>
          {uninstall.busy && <Working text="Der Deinstaller des Herstellers läuft. Folge dessen Fenster – ATLAS wartet." />}
          {uninstall.data?.stillInstalled && <p className="meta">Das Programm ist noch installiert. Vielleicht wurde der Deinstaller abgebrochen?</p>}
          {leftovers.busy && <Working text="Suche nach Resten …" />}
          {leftovers.data && <Leftovers items={leftovers.data} picked={picked} setPicked={setPicked} busy={trash.busy}
            onRemove={async () => { const r = await trash.run({ paths: [...picked] }, { successToast: (o) => `${o.trashed} Rest(e) in den Papierkorb verschoben.` }); if (r) leftovers.setData(leftovers.data!.filter((l) => !picked.has(l.path))) }} />}
        </Panel>
      )}
      <Panel title={list.data ? `${rows.length} Programme` : 'Programme'} wide aside={
        <div className="inline-controls">
          <input className="search" placeholder="Suchen …" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Programme durchsuchen" />
          <Tabs value={sort} onChange={setSort} options={[{ id: 'name', label: 'A–Z' }, { id: 'size', label: 'Größe' }]} />
        </div>
      }>
        {list.busy && !list.data && <Working text="Lese installierte Programme …" />}
        {list.error && !list.data && <Empty>{list.error}</Empty>}
        {list.data && (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Hersteller</th><th>Version</th><th className="num">Größe</th><th>Installiert</th><th /></tr></thead>
            <tbody>{rows.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td><td className="dim">{p.publisher ?? '–'}</td><td className="dim">{p.version ?? '–'}</td>
                <td className="num">{p.sizeBytes ? bytes(p.sizeBytes) : '–'}</td><td className="dim">{p.installDate ?? '–'}</td>
                <td className="row-actions">
                  <Button variant="quiet" onClick={() => askAtlas(`Was ist „${p.name}“${p.publisher ? ` von ${p.publisher}` : ''} und brauche ich das?`)}>Was ist das?</Button>
                  {p.canUninstall && <Button variant="quiet" busy={uninstall.busy && active?.id === p.id} disabled={uninstall.busy} onClick={() => void remove(p)}>Deinstallieren</Button>}
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
        <p className="meta subtle">Apps aus dem Microsoft Store erscheinen hier noch nicht – entferne sie über die Windows-Einstellungen.</p>
      </Panel>
    </div>
  )
}

function Leftovers({ items, picked, setPicked, onRemove, busy }: { items: FileEntry[]; picked: Set<string>; setPicked: (s: Set<string>) => void; onRemove: () => void; busy: boolean }): JSX.Element {
  if (items.length === 0) return <div className="all-clear"><span className="all-clear-mark" aria-hidden="true" />Keine Reste gefunden – sauber entfernt.</div>
  return (
    <>
      <p className="meta">Diese Ordner gehören vermutlich zum entfernten Programm. Prüfe die Auswahl – sie landet im Papierkorb.</p>
      <ul className="mini-list checks">{items.map((l) => (
        <li key={l.path}><label>
          <input type="checkbox" checked={picked.has(l.path)} onChange={() => { const n = new Set(picked); if (n.has(l.path)) n.delete(l.path); else n.add(l.path); setPicked(n) }} />
          <span className="path">{l.path}</span></label><span>{bytes(l.size)}</span></li>))}</ul>
      <Button variant="primary" busy={busy} disabled={picked.size === 0} onClick={onRemove}>Ausgewählte Reste entfernen</Button>
    </>
  )
}

function Autostart(): JSX.Element {
  const list = useCap('autostart.list')
  const set = useCap('autostart.set')
  const { askAtlas } = useApp()
  useEffect(() => { void list.run({}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (e: AutostartEntry): Promise<void> => {
    const r = await set.run({ hive: e.hive, approvedKey: e.approvedKey, name: e.name, enable: !e.enabled },
      { successToast: `${e.name}: Autostart ${e.enabled ? 'deaktiviert' : 'aktiviert'}.` })
    if (r && list.data) list.setData(list.data.map((x) => (x === e ? { ...x, enabled: r.enabled } : x)))
  }

  const enabled = (list.data ?? []).filter((e) => e.enabled).length
  return (
    <Panel title={list.data ? `${enabled} von ${list.data.length} Einträgen aktiv` : 'Autostart'} wide
      aside={<Button variant="quiet" busy={list.busy} onClick={() => void list.run({})}>Neu laden</Button>}>
      {list.busy && !list.data && <Working text="Lese Autostart-Einträge und prüfe Signaturen …" />}
      {list.data?.length === 0 && <Empty>Keine Autostart-Einträge gefunden.</Empty>}
      <ul className="autostart">{(list.data ?? []).map((e) => (
        <li key={`${e.hive}${e.approvedKey}${e.name}`} className={e.enabled ? '' : 'off'}>
          <div className="as-main">
            <p className="row-title">{e.name}{e.signer && <span>{e.signer}</span>}</p>
            <p className="path" title={e.command}>{e.command}</p>
            <p className="meta">{e.source}{e.signature !== 'Valid' && e.signature !== 'Missing' && ' · nicht signiert'}{e.signature === 'Missing' && ' · Datei fehlt'}</p>
            {e.suspicious.length > 0 && e.signature !== 'Missing' && <p className="as-warn">{e.suspicious.join(' ')}</p>}
          </div>
          <div className="as-actions">
            <Button variant="quiet" onClick={() => askAtlas(`Was ist der Autostart-Eintrag „${e.name}“ (${e.command})? Brauche ich ihn beim Start?`)}>Was ist das?</Button>
            <button type="button" role="switch" aria-checked={e.enabled} className="switch" onClick={() => void toggle(e)} disabled={set.busy} aria-label={`Autostart ${e.name}`}>
              <span />
            </button>
          </div>
        </li>))}</ul>
      <p className="meta subtle">ATLAS deaktiviert Einträge wie der Task-Manager: Nichts wird gelöscht, alles ist jederzeit umkehrbar.</p>
    </Panel>
  )
}
