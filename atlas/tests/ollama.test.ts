import http from 'http'
import { describe, expect, it } from 'vitest'
import {
  buildChatBody, callOllama, fromOllamaResponse, hasModel, isValidModelName, ollamaLoad, ollamaUrl,
  pullModel, toOllamaMessages, unloadModel, warmUpModel
} from '../src/main/ai/ollama'

interface Seen { url: string; body: any }

/** Nachgebauter Ollama-Server; behavior steuert, wie er antwortet. */
async function fakeOllama(handler: (url: string, body: any, res: http.ServerResponse) => void): Promise<{ seen: Seen[]; close: () => void }> {
  const seen: Seen[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null
      seen.push({ url: req.url ?? '', body })
      handler(req.url ?? '', body, res)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  process.env['OLLAMA_HOST'] = `127.0.0.1:${(server.address() as { port: number }).port}` // bewusst ohne „http://“
  return { seen, close: () => server.close() }
}

const ask = { model: 'qwen3:8b', system: 'S', messages: [{ role: 'user' as const, content: 'Hi' }] }

describe('Adresse von Ollama', () => {
  it('ergänzt http:// und ersetzt 0.0.0.0', () => {
    process.env['OLLAMA_HOST'] = '0.0.0.0:11434'
    expect(ollamaUrl()).toBe('http://127.0.0.1:11434')
    process.env['OLLAMA_HOST'] = 'http://192.168.1.5:11500/'
    expect(ollamaUrl()).toBe('http://192.168.1.5:11500')
    process.env['OLLAMA_HOST'] = 'unsinn mit leerzeichen'
    expect(ollamaUrl()).toBe('http://127.0.0.1:11434')
    delete process.env['OLLAMA_HOST']
    expect(ollamaUrl()).toBe('http://127.0.0.1:11434')
  })
})

describe('Übersetzung', () => {
  it('übersetzt Werkzeugaufrufe und -ergebnisse in beide Richtungen', () => {
    const msgs = toOllamaMessages('SYS', [
      { role: 'user', content: 'Wie ausgelastet bin ich?' },
      { role: 'assistant', content: [{ type: 'text', text: 'Ich schaue nach.' }, { type: 'tool_use', id: 't1', name: 'system__live', input: { a: 1 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"cpu":23}' }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'kaputt', is_error: true }] }
    ])
    expect(msgs[0]).toEqual({ role: 'system', content: 'SYS' })
    expect(msgs[2]!.tool_calls).toEqual([{ function: { name: 'system__live', arguments: { a: 1 } } }])
    expect(msgs[3]).toEqual({ role: 'tool', content: '{"cpu":23}', tool_name: 'system__live' })
    expect(msgs[4]!.content).toBe('FEHLER: kaputt')
    const r = fromOllamaResponse({ content: '<think>x</think>Hallo', tool_calls: [{ function: { name: 'f', arguments: '{"x":2}' } }] })
    expect((r.content[0] as { text: string }).text).toBe('Hallo')
    expect((r.content[1] as { input: unknown }).input).toEqual({ x: 2 })
    expect(r.stop_reason).toBe('tool_use')
  })
})

describe('Tempo', () => {
  it('schaltet das Nachdenken ab, hält das Modell geladen und begrenzt den Kontext', () => {
    const body = buildChatBody({ ...ask, numCtx: 8192 }, false) as any
    expect(body.think).toBe(false)
    expect(body.keep_alive).toBe('30m')
    expect(body.options.num_ctx).toBe(8192)
    expect(body.stream).toBe(false)
    expect('think' in (buildChatBody(ask, true) as object)).toBe(false)
    expect((buildChatBody(ask, false) as any).options.num_ctx).toBe(8192) // Standard
  })

  it('sendet beim Chatten think:false, keep_alive und den eingestellten Kontext', async () => {
    const srv = await fakeOllama((_u, _b, res) => res.end(JSON.stringify({ message: { role: 'assistant', content: 'Hallo' } })))
    await callOllama({ ...ask, numCtx: 12288 })
    const b = srv.seen[0]!.body
    expect(srv.seen[0]!.url).toBe('/api/chat')
    expect(b.think).toBe(false)
    expect(b.keep_alive).toBe('30m')
    expect(b.options.num_ctx).toBe(12288)
    srv.close()
  })

  it('wiederholt ohne think, wenn das Modell den Parameter ablehnt', async () => {
    const srv = await fakeOllama((_u, body, res) => {
      if (body.think === false) { res.statusCode = 400; res.end(JSON.stringify({ error: '"gpt-oss" does not support think=false' })); return }
      res.end(JSON.stringify({ message: { role: 'assistant', content: 'Antwort ohne think' } }))
    })
    const r = await callOllama({ ...ask, model: 'gpt-oss:20b' })
    expect((r.content[0] as { text: string }).text).toBe('Antwort ohne think')
    expect(srv.seen).toHaveLength(2)
    expect('think' in srv.seen[1]!.body).toBe(false)
    srv.close()
  })

  it('lädt das Modell mit demselben Kontext vor (sonst lädt Ollama neu)', async () => {
    const srv = await fakeOllama((_u, _b, res) => res.end('{}'))
    await warmUpModel('qwen3:8b', 8192)
    const w = srv.seen[0]!
    expect(w.url).toBe('/api/generate')
    expect(w.body.prompt).toBe('')
    expect(w.body.keep_alive).toBe('30m')
    expect(w.body.options.num_ctx).toBe(8192)
    srv.close()
  })

  it('meldet, wie viel vom Modell auf der Grafikkarte liegt', async () => {
    let srv = await fakeOllama((_u, _b, res) => res.end(JSON.stringify({ models: [{ name: 'qwen3:8b', size: 6_000_000_000, size_vram: 4_500_000_000 }] })))
    expect(await ollamaLoad()).toEqual({ model: 'qwen3:8b', percentGpu: 75 })
    srv.close()
    srv = await fakeOllama((_u, _b, res) => res.end(JSON.stringify({ models: [] })))
    expect(await ollamaLoad()).toBeNull()
    srv.close()
  })
})

describe('Speicher wieder freigeben', () => {
  it('nimmt das Modell nur heraus, wenn ATLAS es auch geladen hat', async () => {
    const srv = await fakeOllama((_u, _b, res) => res.end('{}'))
    // ATLAS hat im Test zuvor schon Anfragen gestellt – deshalb gilt das Modell als „von ATLAS geladen“
    expect(await unloadModel('qwen3:8b')).toBe(true)
    const u = srv.seen[0]!
    expect(u.url).toBe('/api/generate')
    expect(u.body).toEqual({ model: 'qwen3:8b', keep_alive: 0 })
    // zweiter Aufruf: nichts mehr zu tun – es wird kein Modell eines anderen Programms angefasst
    expect(await unloadModel('qwen3:8b')).toBe(false)
    expect(srv.seen).toHaveLength(1)
    srv.close()
  })
})

describe('Fehler und Download', () => {
  it('erklärt fehlendes Modell und zu wenig Speicher verständlich', async () => {
    let srv = await fakeOllama((_u, _b, res) => { res.statusCode = 404; res.end(JSON.stringify({ error: 'model "x" not found' })) })
    let msg = ''
    try { await callOllama(ask) } catch (e) { msg = (e as Error).message }
    expect(msg.includes('nicht installiert')).toBe(true)
    srv.close()
    srv = await fakeOllama((_u, _b, res) => { res.statusCode = 500; res.end(JSON.stringify({ error: 'CUDA out of memory' })) })
    msg = ''
    try { await callOllama(ask) } catch (e) { msg = (e as Error).message }
    expect(msg.includes('Speicher')).toBe(true)
    srv.close()
  })

  it('lädt ein Modell herunter und meldet den Fortschritt', async () => {
    const srv = await fakeOllama((_u, _b, res) => {
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n')
      res.write(JSON.stringify({ status: 'downloading', total: 1000, completed: 250 }) + '\n')
      res.end(JSON.stringify({ status: 'success' }) + '\n')
    })
    const seen: Array<number | null> = []
    await pullModel('gpt-oss:20b', (p) => seen.push(p.percent))
    expect(seen).toEqual([null, 25, null])
    srv.close()
  })

  it('lehnt unsichere Modellnamen ab', () => {
    expect(isValidModelName('qwen3:8b')).toBe(true)
    expect(isValidModelName('hf.co/user/model:Q4_K_M')).toBe(true)
    expect(isValidModelName('rm -rf /')).toBe(false)
    expect(isValidModelName('a;b')).toBe(false)
    expect(hasModel({ running: true, models: ['qwen3:8b'] }, 'qwen3:8b')).toBe(true)
    expect(hasModel({ running: true, models: ['qwen3:8b'] }, 'qwen3:4b')).toBe(false)
  })
})
