import { cpus, hostname } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { getStaticInfo } from '../src/main/services/system'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\test' } }))
// systeminformation fällt komplett aus: kein einziger Aufruf funktioniert
vi.mock('systeminformation', () => ({ default: {} }))

describe('Systeminformationen ohne systeminformation', () => {
  it('liefert trotzdem Rechnername, Prozessor, Kerne und Laufzeit direkt aus Node', async () => {
    const info = await getStaticInfo()
    expect(info.os.hostname).toBe(hostname())
    expect(info.cpu.cores).toBe(cpus().length)
    expect(info.cpu.brand.length > 0).toBe(true)
    expect(info.os.distro.length > 0).toBe(true)
    expect(info.uptimeSec > 0).toBe(true)
  })
})
