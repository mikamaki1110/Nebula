import { describe, expect, it, vi } from 'vitest'
import { flattenProcesses, getLiveMetrics, getStaticInfo, readProcesses, setBridge } from '../src/main/services/system'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\test' } }))
vi.mock('systeminformation', () => ({ default: {} })) // darf mit Nebula-Leitung gar nicht gebraucht werden

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Daten in genau der Form, in der Nebulas main.js sie liefert. */
const nebula = {
  fast: async () => ({ cpu: 12, netRx: 125_000, netTx: 4_000 }),
  slow: async () => ({
    cpuTemp: 62,
    gpus: [{ model: 'NVIDIA GeForce RTX 3050', temp: 55, load: 12, memUsed: 1200, memTotal: 8192 }],
    battery: null
  }),
  procs: async () => ({
    processCount: 210,
    processes: [
      { name: 'chrome', count: 2, instances: [{ pid: 11, cpu: 8.5, mem: 500e6 }, { pid: 12, cpu: 1, mem: 100e6 }] },
      { name: 'code', count: 1, instances: [{ pid: 20, cpu: 3, mem: 300e6 }] }
    ]
  }),
  info: async () => ({
    os: { name: 'Microsoft Windows 11 Pro', release: '10.0.26300', build: '26300', hostname: 'MAX-PC' },
    cpu: { name: 'AMD Ryzen 9 3900X', cores: 12, threads: 24, baseGHz: 3.8 },
    system: { manufacturer: 'ASUS', model: 'X570' }
  })
}

describe('Messwerte über Nebulas Leitung', () => {
  it('übernimmt Grafik, Netzwerk, Temperatur und Prozesse von Nebula – ohne systeminformation', async () => {
    setBridge(nebula)
    await getLiveMetrics() // stößt das Nachladen an
    await sleep(120)
    const m = await getLiveMetrics()
    expect(m.gpus[0]!.name).toBe('NVIDIA GeForce RTX 3050')
    expect(m.gpus[0]!.load).toBe(12)
    expect(m.gpus[0]!.tempC).toBe(55)
    expect(m.gpus[0]!.vramTotalMB).toBe(8192)
    expect(m.cpu.tempC).toBe(62)
    expect(m.network[0]!.rxPerSec).toBe(125_000)
    expect(m.processes.total).toBe(210)
    expect(m.processes.top[0]!.name).toBe('chrome.exe')
    expect(m.battery.hasBattery).toBe(false) // Desktop-PC: Nebula meldet null
    expect(Object.keys(m.sources)).toHaveLength(0) // nichts mehr „lädt“ oder „fehlt“
  })

  it('macht aus Nebulas Prozessgruppen einzelne Zeilen', async () => {
    expect(flattenProcesses(nebula.procs ? (await nebula.procs()).processes : [])).toHaveLength(3)
    const { rows, total } = await readProcesses(0)
    expect(total).toBe(210)
    expect(rows.find((r) => r.pid === 20)).toMatchObject({ name: 'code.exe', cpu: 3 })
    expect(flattenProcesses(undefined)).toEqual([])
  })

  it('liest die Systeminformationen von Nebula, sobald sie da sind', async () => {
    const info = await getStaticInfo()
    expect(info.os.distro).toBe('Microsoft Windows 11 Pro')
    expect(info.os.hostname).toBe('MAX-PC')
    expect(info.cpu.brand).toBe('AMD Ryzen 9 3900X')
    expect(info.cpu.physicalCores).toBe(12)
    expect(info.cpu.cores).toBe(24)
    expect(info.machine.manufacturer).toBe('ASUS')
    expect(info.detailsLoaded).toBe(true)
  })
})
