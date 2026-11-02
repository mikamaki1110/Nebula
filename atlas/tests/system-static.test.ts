import si from 'systeminformation'
import { describe, expect, it, vi } from 'vitest'
import { getStaticInfo } from '../src/main/services/system'

vi.mock('electron', () => ({ app: { getPath: () => 'C:\\Users\\test' } }))
vi.mock('systeminformation', () => ({ default: {} }))

const mock = si as unknown as Record<string, unknown>

describe('Systeminformationen mit Details', () => {
  it('nutzt Details von systeminformation, wenn sie rechtzeitig kommen', async () => {
    mock['osInfo'] = async () => ({ distro: 'Microsoft Windows 11 Pro', release: '10.0.26100', build: '26100', hostname: 'MAX-PC' })
    mock['cpu'] = async () => ({ manufacturer: 'AMD', brand: 'Ryzen 7 7800X3D', cores: 16, physicalCores: 8, speed: 4.2 })
    mock['system'] = async () => ({ manufacturer: 'Micro-Star', model: 'MS-7D76' })
    const info = await getStaticInfo()
    expect(info.os.distro).toBe('Microsoft Windows 11 Pro')
    expect(info.os.hostname).toBe('MAX-PC')
    expect(info.cpu.brand).toBe('AMD Ryzen 7 7800X3D')
    expect(info.cpu.physicalCores).toBe(8)
    expect(info.machine.model).toBe('MS-7D76')
    expect(info.paths.home).toBe('C:\\Users\\test')
  })
})
