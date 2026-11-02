import { useEffect } from 'react'
import { Button, Empty, FindingList, PageHeader, Panel, Working } from '../components/ui'
import { useCap } from '../hooks/useCap'
import { dateTime } from '../lib/format'
import { ago, seconds } from '../lib/time'
import { useReports } from '../state/reports'

function Status({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }): JSX.Element {
  return (
    <li className={`status-row ${ok === null ? 'unknown' : ok ? 'ok' : 'bad'}`}>
      <span className="status-dot" aria-hidden="true" />
      <span>{label}</span>
      <span className="dim">{detail ?? (ok === null ? 'unbekannt' : ok ? 'aktiv' : 'aus')}</span>
    </li>
  )
}

export function Security(): JSX.Element {
  const { security: r, securityBusy, securityError, refreshSecurity } = useReports()
  const updates = useCap('security.pendingUpdates')
  const scan = useCap('security.quickScan')
  useEffect(() => { void refreshSecurity(false) }, [refreshSecurity]) // nur neu prüfen, wenn der Stand älter als 10 Minuten ist
  const thirdParty = r?.antivirus.filter((a) => !/defender/i.test(a)) ?? []

  return (
    <section className="page">
      <PageHeader title="Sicherheit" lead="ATLAS prüft und erklärt – Schutzmechanismen werden niemals abgeschaltet."
        actions={<>
          <Button busy={scan.busy} onClick={() => void scan.run({}, { successToast: (o) => o.message })}>Schnellscan</Button>
          <Button variant="primary" busy={securityBusy} onClick={() => void refreshSecurity(true)}>Erneut prüfen</Button>
        </>} />
      {securityBusy && !r && <Working text="Prüfe Defender, Firewall, Updates, Autostart und laufende Prozesse – alles gleichzeitig …" />}
      {securityError && !r && <Empty>{securityError}</Empty>}
      {r && securityBusy && <p className="refresh-note"><span className="spinner" aria-hidden="true" />Zeige den letzten Stand ({ago(r.time)}) und prüfe im Hintergrund erneut …</p>}
      {r && r.incomplete.length > 0 && (
        <p className="alert">Nicht alles ließ sich prüfen: {r.incomplete.join(' · ')}. Das kann an fehlenden Rechten liegen – Details stehen in Nebula unter „Debug“.</p>
      )}
      {r && (
        <div className="grid">
          <Panel title="Schutzstatus">
            <ul className="status-list">
              <Status ok={r.defender ? r.defender.realTimeProtection : thirdParty.length > 0 ? true : null} label="Echtzeitschutz"
                detail={thirdParty.length > 0 && !r.defender?.realTimeProtection ? thirdParty.join(', ') : undefined} />
              <Status ok={r.defender?.signatureAgeDays != null ? r.defender.signatureAgeDays <= 7 : null} label="Virendefinitionen"
                detail={r.defender?.signatureAgeDays != null ? `${r.defender.signatureAgeDays} Tage alt` : undefined} />
              <Status ok={r.defender?.tamperProtected ?? null} label="Manipulationsschutz" />
              {r.firewall.map((f) => <Status key={f.name} ok={f.enabled} label={`Firewall ${({ Domain: 'Domäne', Private: 'Privat', Public: 'Öffentlich' } as Record<string, string>)[f.name] ?? f.name}`} />)}
              <Status ok={r.uacEnabled} label="Benutzerkontensteuerung" />
              <Status ok={r.lastUpdate?.installedOn ? Date.now() - Date.parse(r.lastUpdate.installedOn) < 45 * 86_400_000 : null} label="Letztes Update"
                detail={r.lastUpdate?.installedOn ? new Date(r.lastUpdate.installedOn).toLocaleDateString('de-DE') : undefined} />
            </ul>
            <p className="meta subtle">Geprüft: {dateTime(r.time)} · dauerte {seconds(r.tookMs)}</p>
          </Panel>
          <Panel title="Windows Update">
            {!updates.data && !updates.busy && <p className="meta">Die Abfrage bei Windows Update dauert 1–3 Minuten.</p>}
            {updates.busy && <Working text="Frage Windows Update …" />}
            {updates.data && (updates.data.length === 0
              ? <div className="all-clear"><span className="all-clear-mark" aria-hidden="true" />Alles aktuell.</div>
              : <ul className="mini-list">{updates.data.map((u) => <li key={u.title}><span>{u.title}</span><span className="dim">{u.severity ?? ''}</span></li>)}</ul>)}
            <div className="btn-row">
              <Button busy={updates.busy} onClick={() => void updates.run({})}>Nach Updates suchen</Button>
              {updates.data && updates.data.length > 0 && <Button variant="quiet" onClick={() => void window.atlas.call('system.openWindowsPage', { target: 'windowsUpdate' })}>Installieren in Windows Update</Button>}
            </div>
          </Panel>
          <Panel title={r.findings.length ? `Befunde nach Priorität (${r.findings.length})` : 'Befunde'} wide>
            <FindingList findings={r.findings} emptyText="Keine Sicherheitsprobleme gefunden." />
          </Panel>
        </div>
      )}
    </section>
  )
}
