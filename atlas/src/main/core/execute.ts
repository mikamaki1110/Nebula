import type { Result } from '@shared/types'
import { getCapability } from './capabilities'
import { requestConfirmation } from './confirm'
import { all, run } from './db'
import { log } from './log'
import { authorize, AuditLog, type Origin } from './policy'

let audit: AuditLog | null = null
export function setAuditLog(log: AuditLog): void {
  audit = log
}
export const auditPath = (): string | null => audit?.filePath ?? null

/**
 * Der einzige Weg, auf dem ATLAS etwas tut – egal ob Klick oder KI-Agent:
 * Register → Eingabe validieren → Berechtigung → Bestätigung → Ausführen → Protokoll/Verlauf.
 */
export async function execute(capId: string, rawInput: unknown, origin: Origin, requestedBy = 'Du'): Promise<Result<unknown>> {
  const c = getCapability(capId)
  if (c?.internal && origin !== 'undo') return { ok: false, error: 'Diese Aktion ist nur intern verfügbar.' }
  const decision = authorize(c, origin)
  if (!decision.allowed || !c) {
    return { ok: false, error: decision.allowed ? 'Unbekannte Aktion.' : `Aktion abgelehnt (${decision.reason}).` }
  }

  const parsed = c.input.safeParse(rawInput ?? {})
  if (!parsed.success) {
    return { ok: false, error: `Ungültige Eingabe: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'Eingabe'}: ${i.message}`).join('; ')}` }
  }
  const input = parsed.data

  if (decision.needsConfirmation) {
    let spec = { title: c.title, details: [] as string[], confirmLabel: 'Ausführen' }
    try {
      if (c.confirm) spec = await c.confirm(input)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Vorbereitung fehlgeschlagen.' }
    }
    const approved = await requestConfirmation({ ...spec, risk: c.risk, requiresAdmin: c.requiresAdmin, requestedBy })
    if (!approved) {
      await audit?.record(c, 'declined', JSON.stringify(input).slice(0, 500), origin).catch(() => undefined)
      return { ok: false, error: 'Vom Benutzer abgelehnt.' }
    }
  }

  try {
    const out = await c.run(input)
    if (c.risk !== 'read') {
      const rec = c.record?.(input, out) ?? { summary: c.title }
      await audit?.record(c, 'success', rec.summary, origin).catch(() => undefined)
      run('INSERT INTO history (time, cap_id, summary, undo_cap, undo_input) VALUES (?, ?, ?, ?, ?)', [
        Date.now(), c.id, rec.summary, rec.undo?.capId ?? null, rec.undo ? JSON.stringify(rec.undo.input) : null
      ])
    }
    return { ok: true, data: out }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unbekannter Fehler'
    if (c.risk !== 'read') await audit?.record(c, 'failure', msg, origin).catch(() => undefined)
    log('error', capId, msg)
    return { ok: false, error: msg }
  }
}

interface HistoryRow { id: number; time: number; cap_id: string; summary: string; undo_cap: string | null; undo_input: string | null; undone: number }

export function listHistory(): Array<{ id: number; time: number; capId: string; summary: string; undoable: boolean; undone: boolean }> {
  return all<HistoryRow>('SELECT * FROM history ORDER BY id DESC LIMIT 200').map((r) => ({
    id: Number(r.id), time: Number(r.time), capId: r.cap_id, summary: r.summary, undoable: !!r.undo_cap && !r.undone, undone: !!r.undone
  }))
}

export async function undoHistory(id: number): Promise<Result<string>> {
  const row = all<HistoryRow>('SELECT * FROM history WHERE id = ?', [id])[0]
  if (!row || !row.undo_cap || !row.undo_input) return { ok: false, error: 'Dieser Eintrag kann nicht rückgängig gemacht werden.' }
  if (row.undone) return { ok: false, error: 'Bereits rückgängig gemacht.' }
  const res = await execute(row.undo_cap, JSON.parse(row.undo_input), 'undo', 'Verlauf')
  if (!res.ok) return res
  run('UPDATE history SET undone = 1 WHERE id = ?', [id])
  return { ok: true, data: `Rückgängig gemacht: ${row.summary}` }
}
