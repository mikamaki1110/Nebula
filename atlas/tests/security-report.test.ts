import { describe, expect, it, vi } from 'vitest'
import { securityReport } from '../src/main/services/security'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('systeminformation', () => ({ default: {} }))

describe('Sicherheitsbericht', () => {
  it('bricht nicht ab, wenn Prüfungen nicht möglich sind, sondern benennt die Lücken (hier: kein Windows)', async () => {
    const started = Date.now()
    const r = await securityReport(true)
    expect(Date.now() - started < 3000).toBe(true)
    expect(r.incomplete.length >= 3).toBe(true) // Schutzstatus, Update-Verlauf, Autostart …
    expect(r.incomplete.some((x) => x.startsWith('Schutzstatus'))).toBe(true)
    expect(r.findings.find((f) => f.id === 'no-av')).toBeUndefined() // keine falsche Warnung
    expect(r.tookMs >= 0).toBe(true)
  })
  it('liefert denselben Bericht aus dem Zwischenspeicher, statt noch einmal zu prüfen', async () => {
    const a = await securityReport(false)
    const b = await securityReport(false)
    expect(b.time).toBe(a.time)
  })
})
