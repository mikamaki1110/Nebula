import { describe, expect, it, vi } from 'vitest'
import { setTurbo, TURBO_VARS, turboStatus } from '../src/main/services/ollamaTurbo'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))

describe('Ollama-Turbo', () => {
  it('setzt genau die beiden empfohlenen Werte', () => {
    expect(TURBO_VARS).toEqual({ OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' })
  })
  it('meldet außerhalb von Windows verständlich, dass es nicht möglich ist, statt etwas zu verändern', async () => {
    let msg = ''
    try { await setTurbo(true) } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('nur unter Windows')
    msg = ''
    try { await turboStatus() } catch (e) { msg = (e as Error).message }
    expect(msg).toContain('nur unter Windows')
  })
})
