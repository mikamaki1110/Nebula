import { appendFile } from 'fs/promises'
import type { RiskLevel } from '@shared/types'

export interface ActionDescriptor {
  id: string
  risk: RiskLevel
  requiresAdmin: boolean
  description: string
}

export type Decision =
  | { allowed: true; needsConfirmation: boolean }
  | { allowed: false; reason: 'unknown-action' | 'not-permitted-for-origin' }

export type Origin = 'ui' | 'agent' | 'undo'

/** Rein lesende Aktionen laufen ohne Rückfrage, alles andere braucht eine Bestätigung. */
export function requiresConfirmation(action: Pick<ActionDescriptor, 'risk'>): boolean {
  return action.risk !== 'read'
}

export function authorize(
  action: (ActionDescriptor & { exposeToAgent?: boolean }) | undefined,
  origin: Origin
): Decision {
  if (!action) return { allowed: false, reason: 'unknown-action' }
  if (origin === 'agent' && action.exposeToAgent === false) return { allowed: false, reason: 'not-permitted-for-origin' }
  return { allowed: true, needsConfirmation: requiresConfirmation(action) }
}

/** Unveränderliches Protokoll aller nicht lesenden Aktionen (eine JSON-Zeile je Eintrag). */
export class AuditLog {
  constructor(readonly filePath: string) {}

  async record(action: ActionDescriptor, outcome: 'success' | 'failure' | 'declined', detail?: string, origin?: Origin): Promise<void> {
    if (action.risk === 'read') return
    const entry = { time: new Date().toISOString(), action: action.id, risk: action.risk, origin, outcome, detail }
    await appendFile(this.filePath, JSON.stringify(entry) + '\n', 'utf8')
  }
}
