import { cpus } from 'os'
import si from 'systeminformation'
import { describe, expect, it, vi } from 'vitest'
import { getLiveMetrics, loadBetween, tuning } from '../src/main/services/system'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('systeminformation', () => ({ default: {} }))

const mock = si as unknown as Record<string, unknown>
const never = (): Promise<never> => new Promise(() => undefined)
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('Live-Messwerte', () => {
  it('liefert CPU, Arbeitsspeicher und Laufwerke sofort – auch wenn alles andere hängt oder abstürzt', async () => {
    mock['graphics'] = never                                        // hängt für immer
    mock['networkStats'] = never
    mock['cpuTemperature'] = never
    mock['processes'] = () => Promise.reject(new Error('boom'))     // schlägt fehl
    mock['battery'] = () => { throw new Error('sofort kaputt') }    // wirft synchron
    tuning.retryMs = 0
    tuning.timeoutMs = { gpu: 5000, network: 200, battery: 200, processes: 200, temperature: 200 }

    const started = Date.now()
    const m = await getLiveMetrics()
    expect(Date.now() - started < 2000).toBe(true)
    expect(m.cpu.load >= 0 && m.cpu.load <= 100).toBe(true)
    expect(m.cpu.perCore).toHaveLength(cpus().length)
    expect(m.memory.total > 0 && m.memory.used > 0 && m.memory.used <= m.memory.total).toBe(true)
    expect(m.disks.length >= 1).toBe(true)
    expect(m.disks[0]!.size > 0 && m.disks[0]!.used >= 0).toBe(true)
    // Die langsamen Quellen werden ehrlich als „lädt“ bzw. „nicht verfügbar“ gemeldet, nicht verschwiegen
    expect(m.sources.gpu).toBe('loading')
    expect(m.sources.processes).toBe('failed')
    expect(m.sources.battery).toBe('failed')
    expect(m.sources.network).toBe('failed')
  })

  it('lädt langsame Werte nach, sobald sie verfügbar sind', async () => {
    mock['battery'] = async () => ({ hasBattery: true, percent: 80, isCharging: false, designedCapacity: 100, maxCapacity: 90 })
    mock['processes'] = async () => ({ all: 123, list: [{ pid: 1, name: 'a.exe', cpu: 5, memRss: 1000, path: 'C:\\x', user: 'u' }] })
    mock['networkStats'] = async () => [{ iface: 'WLAN', rx_sec: 1000, tx_sec: 50 }]
    await getLiveMetrics() // stößt das Nachladen an
    await sleep(150)
    const m = await getLiveMetrics()
    expect(m.battery.percent).toBe(80)
    expect(m.battery.healthPercent).toBe(90)
    expect(m.processes.total).toBe(123)
    expect(m.processes.top[0]!.name).toBe('a.exe')
    expect(m.network[0]!.rxPerSec).toBe(1000)
    expect(m.sources.battery).toBeUndefined()
    expect(m.sources.processes).toBeUndefined()
  })
})

describe('CPU-Auslastung aus Zeitdifferenzen', () => {
  it('rechnet je Kern und gesamt', () => {
    const prev = [{ idle: 100, total: 200 }, { idle: 0, total: 100 }]
    const next = [{ idle: 150, total: 300 }, { idle: 0, total: 200 }]
    const r = loadBetween(prev, next)
    expect(r.perCore).toEqual([50, 100])
    expect(r.load).toBe(75)
  })
  it('liefert 0 statt NaN, wenn sich nichts verändert hat', () => {
    const same = [{ idle: 10, total: 20 }]
    expect(loadBetween(same, same)).toEqual({ load: 0, perCore: [0] })
  })
})
