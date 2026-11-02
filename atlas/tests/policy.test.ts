import { mkdtemp, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { AuditLog, authorize, requiresConfirmation, type ActionDescriptor } from '../src/main/core/policy'

const read: ActionDescriptor = { id: 'r', risk: 'read', requiresAdmin: false, description: '' }
const modify: ActionDescriptor = { id: 'm', risk: 'modify', requiresAdmin: false, description: '' }
const critical: ActionDescriptor = { id: 'c', risk: 'critical', requiresAdmin: false, description: '' }

describe('authorize', () => {
  it('lehnt unbekannte Aktionen ab', () => {
    expect(authorize(undefined, 'ui')).toEqual({ allowed: false, reason: 'unknown-action' })
  })
  it('lässt Leseaktionen ohne Bestätigung zu', () => {
    expect(authorize(read, 'agent')).toEqual({ allowed: true, needsConfirmation: false })
  })
  it('verlangt für Änderungen immer eine Bestätigung – auch von Agenten', () => {
    expect(authorize(modify, 'agent')).toEqual({ allowed: true, needsConfirmation: true })
    expect(authorize(critical, 'ui')).toEqual({ allowed: true, needsConfirmation: true })
  })
  it('sperrt nicht freigegebene Aktionen für Agenten', () => {
    expect(authorize({ ...modify, exposeToAgent: false }, 'agent')).toEqual({ allowed: false, reason: 'not-permitted-for-origin' })
  })
})

describe('requiresConfirmation', () => {
  it('nur rein lesende Aktionen laufen ohne Rückfrage', () => {
    expect(requiresConfirmation(read)).toBe(false)
    expect(requiresConfirmation(modify)).toBe(true)
    expect(requiresConfirmation(critical)).toBe(true)
  })
})

describe('AuditLog', () => {
  it('protokolliert nur nicht lesende Aktionen, inklusive Ablehnungen', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atlas-'))
    const log = new AuditLog(join(dir, 'audit.log'))
    await log.record(read, 'success')
    await log.record(modify, 'declined', 'Test', 'agent')
    await log.record(critical, 'success', 'Test', 'ui')
    const lines = (await readFile(join(dir, 'audit.log'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ action: 'm', outcome: 'declined', origin: 'agent' })
  })
})
