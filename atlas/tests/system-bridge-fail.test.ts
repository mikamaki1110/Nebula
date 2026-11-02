import { cpus } from 'os'
import { describe, expect, it, vi } from 'vitest'
import { getLiveMetrics, setBridge, tuning } from '../src/main/services/system'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('systeminformation', () => ({ default: {} }))

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('Wenn Nebulas Abfragen ausfallen', () => {
  it('zeigt CPU und RAM trotzdem sofort und nennt bei den übrigen den Grund', async () => {
    tuning.retryMs = 60_000
    tuning.timeoutMs = { gpu: 5000, network: 5000, battery: 5000, processes: 5000, temperature: 5000 }
    setBridge({
      slow: () => Promise.reject(new Error('PowerShell antwortet nicht')),
      fast: () => new Promise(() => undefined), // hängt für immer
      procs: () => Promise.reject(new Error('Leistungsindikatoren gesperrt'))
    })
    const started = Date.now()
    const m = await getLiveMetrics()
    expect(Date.now() - started < 2000).toBe(true)
    expect(m.cpu.perCore).toHaveLength(cpus().length)
    expect(m.memory.total > 0).toBe(true)
    await sleep(100)
    const m2 = await getLiveMetrics()
    expect(m2.sources.gpu).toBe('failed')
    expect(m2.sourceErrors.gpu).toContain('PowerShell antwortet nicht')
    expect(m2.sources.processes).toBe('failed')
    expect(m2.sourceErrors.processes).toContain('Leistungsindikatoren')
    expect(m2.sources.network).toBe('loading') // hängt noch – wird nicht als kaputt gemeldet, bevor das Zeitlimit abläuft
  })
})
