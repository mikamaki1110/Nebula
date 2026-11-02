import { describe, expect, it, vi } from 'vitest'
import { assessAutostart } from '../src/main/services/autostart'
import { buildFindings } from '../src/main/services/security'

// vitest zieht vi.mock automatisch vor die Importe.
vi.mock('electron', () => ({ app: { getPath: () => '' }, shell: {} }))
vi.mock('systeminformation', () => ({ default: {} }))

const base = {
  time: 0, firewall: [{ name: 'Public', enabled: true }], lastUpdate: null, uacEnabled: true,
  antivirus: ['Windows Defender'], suspiciousAutostart: [], suspiciousProcesses: [], incomplete: [] as string[], tookMs: 0,
  defender: { serviceEnabled: true, antivirusEnabled: true, realTimeProtection: true, signatureAgeDays: 1, quickScanAgeDays: 1, tamperProtected: true }
}

describe('buildFindings', () => {
  it('meldet nichts bei gesundem System', () => {
    expect(buildFindings(base)).toEqual([])
  })
  it('stuft ausgeschalteten Echtzeitschutz als kritisch ein und sortiert ihn nach vorn', () => {
    const f = buildFindings({ ...base, firewall: [{ name: 'Private', enabled: false }], defender: { ...base.defender, realTimeProtection: false } })
    expect(f[0]?.severity).toBe('critical')
    expect(f.map((x) => x.id)).toContain('fw-Private')
  })
  it('wertet fremden Virenschutz als Schutz', () => {
    const f = buildFindings({ ...base, antivirus: ['Windows Defender', 'ESET'], defender: { ...base.defender, realTimeProtection: false } })
    expect(f.find((x) => x.id === 'rtp-off')).toBeUndefined()
  })
})

describe('Lücken in der Prüfung', () => {
  it('behauptet nicht „Virenschutz unbekannt“, wenn die Statusabfrage selbst gescheitert ist', () => {
    const f = buildFindings({ ...base, defender: null, antivirus: [], incomplete: ['Schutzstatus (Defender, Firewall, Benutzerkontensteuerung)'] })
    expect(f.find((x) => x.id === 'no-av')).toBeUndefined()
  })
  it('meldet „Virenschutz unbekannt“, wenn Windows wirklich keinen kennt', () => {
    const f = buildFindings({ ...base, defender: null, antivirus: [] })
    expect(f.find((x) => x.id === 'no-av')?.severity).toBe('high')
  })
})

describe('Defender gemeldet, Details nicht lesbar', () => {
  it('meldet dann keinen „Virenschutz unbekannt“-Fehlalarm', () => {
    const f = buildFindings({ ...base, defender: null, antivirus: ['Windows Defender'] })
    expect(f.find((x) => x.id === 'no-av')).toBeUndefined()
  })
})

describe('assessAutostart', () => {
  const entry = { name: 'x', source: '', scope: 'user' as const, hive: 'HKCU:' as const, approvedKey: 'Run' as const, signer: null, enabled: true }
  it('markiert unsignierte Programme aus Temp mit codiertem PowerShell-Befehl', () => {
    const r = assessAutostart({ ...entry, command: 'powershell -enc AAAA', exePath: 'C:\\Users\\a\\AppData\\Local\\Temp\\x.exe', signature: 'NotSigned' })
    expect(r.length).toBeGreaterThanOrEqual(3)
  })
  it('wirft ungeprüfte Signaturen nicht als „unsigniert“ vor (schnelle Liste ohne Prüfung)', () => {
    expect(assessAutostart({ ...entry, command: '"C:\\Program Files\\App\\app.exe"', exePath: 'C:\\Program Files\\App\\app.exe', signature: 'Unchecked' })).toEqual([])
  })
  it('lässt gültig signierte Programme aus Program Files in Ruhe', () => {
    expect(assessAutostart({ ...entry, command: '"C:\\Program Files\\App\\app.exe"', exePath: 'C:\\Program Files\\App\\app.exe', signature: 'Valid' })).toEqual([])
  })
})
