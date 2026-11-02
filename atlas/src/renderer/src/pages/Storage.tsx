import { useEffect, useState } from 'react'
import { Bar, Button, Empty, FolderField, PageHeader, Panel, Tabs, Working } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { bytes, date } from '../lib/format'
import { useLive } from '../state/live'

export function Storage(): JSX.Element {
  const { data } = useLive()
  const overview = useCap('storage.overview')
  const clean = useCap('storage.cleanTemp')
  const empty = useCap('storage.emptyRecycleBin')
  const large = useCap('storage.largeFiles')
  const dups = useCap('storage.duplicates')
  const trash = useCap('files.trash')
  const [tab, setTab] = useState<'large' | 'old' | 'dups'>('large')
  const [root, setRoot] = useState('C:\\')
  const [minMB, setMinMB] = useState(200)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => { void overview.run({}) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (p: string): void => setSelected((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n })
  const scan = (): void => {
    setSelected(new Set())
    if (tab === 'dups') void dups.run({ root, minSizeMB: Math.max(1, minMB / 10) })
    else void large.run({ root, minSizeMB: minMB, olderThanDays: tab === 'old' ? 365 : undefined, limit: 150 })
  }
  const removeSelected = async (): Promise<void> => {
    const r = await trash.run({ paths: [...selected] }, { successToast: (o) => `${o.trashed} Element(e) im Papierkorb.` })
    if (r) {
      const gone = new Set([...selected].filter((p) => !r.failed.some((f) => f.startsWith(p))))
      if (large.data) large.setData({ ...large.data, items: large.data.items.filter((i) => !gone.has(i.path)) })
      if (dups.data) dups.setData({ ...dups.data, items: dups.data.items.map((g) => ({ ...g, paths: g.paths.filter((p) => !gone.has(p)) })).filter((g) => g.paths.length > 1) })
      setSelected(new Set())
      void overview.run({})
    }
  }
  const tempTotal = overview.data?.temp.reduce((n, t) => n + t.bytes, 0) ?? 0
  const scanning = large.busy || dups.busy
  const selectedBytes = [...selected].reduce((n, p) => n + (large.data?.items.find((i) => i.path === p)?.size ?? dups.data?.items.find((g) => g.paths.includes(p))?.size ?? 0), 0)

  return (
    <section className="page">
      <PageHeader title="Speicher" lead="Finde heraus, was Platz belegt. Gelöscht wird nur, was du auswählst – und zuerst in den Papierkorb." />
      <div className="grid">
        {data?.disks.map((d) => (
          <Panel key={d.mount} title={`Laufwerk ${d.mount}`}>
            <p className="figure">{bytes(d.size - d.used)} <span>frei von {bytes(d.size)}</span></p>
            <Bar value={(d.used / d.size) * 100} warnAt={90} />
            <Button variant="quiet" onClick={() => setRoot(d.mount.endsWith('\\') ? d.mount : `${d.mount}\\`)}>Dieses Laufwerk durchsuchen</Button>
          </Panel>
        ))}
        <Panel title="Temporäre Dateien">
          {overview.busy && !overview.data ? <Working text="Wird gemessen …" /> : (
            <>
              <p className="figure">{bytes(tempTotal)}</p>
              <ul className="mini-list">{overview.data?.temp.map((t) => <li key={t.path}><span>{t.label}</span><span>{t.accessible ? bytes(t.bytes) : 'kein Zugriff'}</span></li>)}</ul>
              <Button variant="primary" busy={clean.busy} disabled={tempTotal === 0}
                onClick={async () => { if (await clean.run({}, { successToast: (o) => `${bytes(o.freedBytes)} freigegeben.` })) void overview.run({}) }}>Bereinigen</Button>
            </>
          )}
        </Panel>
        <Panel title="Papierkorb">
          {overview.data?.recycleBin ? (
            <>
              <p className="figure">{bytes(overview.data.recycleBin.bytes)} <span>{overview.data.recycleBin.items} Elemente</span></p>
              <Button variant="danger" busy={empty.busy} disabled={overview.data.recycleBin.items === 0}
                onClick={async () => { if (await empty.run({}, { successToast: 'Papierkorb geleert.' })) void overview.run({}) }}>Endgültig leeren</Button>
            </>
          ) : <p className="meta">{overview.busy ? 'Wird gemessen …' : 'Größe nicht lesbar.'}</p>}
        </Panel>

        <Panel title="Speicherfresser finden" wide>
          <Tabs value={tab} onChange={(t) => { setTab(t); setSelected(new Set()) }} options={[
            { id: 'large', label: 'Große Dateien' }, { id: 'old', label: 'Groß und älter als 1 Jahr' }, { id: 'dups', label: 'Duplikate' }
          ]} />
          <div className="scan-controls">
            <FolderField value={root} onChange={setRoot} label="Durchsuchen" />
            <label className="num-field"><span>{tab === 'dups' ? 'Ab (MB)' : 'Mindestgröße (MB)'}</span>
              <input type="number" min={1} value={tab === 'dups' ? Math.max(1, minMB / 10) : minMB} onChange={(e) => setMinMB(tab === 'dups' ? Number(e.target.value) * 10 : Number(e.target.value))} />
            </label>
            <Button variant="primary" busy={scanning} onClick={scan}>Suchen</Button>
          </div>
          {scanning && <Working text="Durchsuche Ordner … das kann bis zu einer Minute dauern." />}

          {tab !== 'dups' && large.data && !scanning && (
            <>
              <p className="meta">{large.data.scanned.toLocaleString('de-DE')} Dateien in {large.data.seconds.toString().replace('.', ',')} s geprüft{large.data.truncated && ' – Zeitlimit erreicht, Ergebnis unvollständig'}.</p>
              {large.data.items.length === 0 ? <Empty>Keine Dateien über dieser Größe gefunden.</Empty> : (
                <div className="table-wrap"><table>
                  <thead><tr><th /><th>Datei</th><th className="num">Größe</th><th>Geändert</th></tr></thead>
                  <tbody>{large.data.items.map((f) => (
                    <tr key={f.path} className={selected.has(f.path) ? 'selected' : ''}>
                      <td><input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} aria-label={`${f.name} auswählen`} /></td>
                      <td><span className="file-name">{f.name}</span><span className="path">{f.path}</span></td>
                      <td className="num">{bytes(f.size)}</td><td className="dim">{date(f.mtime)}</td>
                    </tr>))}</tbody>
                </table></div>
              )}
            </>
          )}

          {tab === 'dups' && dups.data && !scanning && (
            <>
              <p className="meta">{dups.data.items.length} Gruppen identischer Dateien · mögliche Ersparnis {bytes(dups.data.items.reduce((n, g) => n + g.size * (g.paths.length - 1), 0))}{dups.data.truncated && ' · Ergebnis unvollständig (Zeitlimit)'}</p>
              {dups.data.items.length === 0 ? <Empty>Keine Duplikate gefunden.</Empty> : (
                <ul className="dup-groups">{dups.data.items.map((g) => (
                  <li key={g.hash}>
                    <p className="row-title">{g.paths.length} × {bytes(g.size)}</p>
                    {g.paths.map((p, i) => (
                      <label key={p} className="dup-path">
                        <input type="checkbox" checked={selected.has(p)} onChange={() => toggle(p)} disabled={!selected.has(p) && g.paths.filter((x) => !selected.has(x)).length <= 1} />
                        <span className="path">{p}</span>{i === 0 && <span className="tag">Original behalten</span>}
                      </label>
                    ))}
                  </li>))}</ul>
              )}
            </>
          )}
          {selected.size > 0 && (
            <div className="selection-bar">
              <span>{selected.size} ausgewählt · {bytes(selectedBytes)}</span>
              <Button variant="primary" busy={trash.busy} onClick={() => void removeSelected()}>In den Papierkorb</Button>
            </div>
          )}
        </Panel>
      </div>
    </section>
  )
}
