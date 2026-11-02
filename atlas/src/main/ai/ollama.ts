/**
 * Lokale KI über Ollama (läuft auf dem PC des Nutzers, kostenlos und offline).
 * ATLAS spricht intern das Anthropic-Format; dieses Modul übersetzt Nachrichten
 * und Werkzeugaufrufe ins Ollama-Format und die Antworten zurück.
 */
import type { Benchmark } from '@shared/types'
import { log } from '../core/log'
import type { ClaudeResponse, ContentBlock, LocalStats, Message, Tool } from './anthropic'

/**
 * Adresse von Ollama. Wer die Umgebungsvariable OLLAMA_HOST selbst gesetzt hat, schreibt sie oft ohne
 * „http://“ oder als „0.0.0.0“ – beides wird hier zurechtgebogen.
 */
export function ollamaUrl(): string {
  let host = (process.env['OLLAMA_HOST'] ?? '').trim() || '127.0.0.1:11434'
  if (!/^https?:\/\//i.test(host)) host = `http://${host}`
  host = host.replace('//0.0.0.0', '//127.0.0.1').replace(/\/+$/, '')
  return /^https?:\/\/[a-z0-9.\-]+(:\d+)?$/i.test(host) ? host : 'http://127.0.0.1:11434'
}

/**
 * Kontextlänge: je größer, desto mehr Grafikspeicher braucht die KI. Passt sie nicht komplett auf die
 * Grafikkarte, läuft ein Teil auf dem Prozessor – und alles wird sehr langsam. 8k passt mit qwen3:8b
 * in 8 GB; der Wert ist in den Einstellungen änderbar.
 */
export const DEFAULT_CONTEXT = 8_192
/** Wie lange Ollama das Modell nach der letzten Anfrage im Speicher hält (Standard wäre 5 Minuten). */
export const KEEP_ALIVE = '30m'
export const RECOMMENDED_MODELS = [
  { name: 'qwen3:8b', size: '5,2 GB', hint: 'Standard – zuverlässig bei Werkzeugen, braucht ca. 7 GB Grafikspeicher' },
  { name: 'qwen3:4b-instruct-2507-q4_K_M', size: '2,5 GB', hint: 'Am schnellsten – antwortet eigens ohne Nachdenken und passt komplett auf kleine Grafikkarten' },
  { name: 'gpt-oss:20b', size: 'ca. 14 GB', hint: 'Klüger – läuft auf 8-GB-Grafikkarten nur teilweise auf der Karte, daher langsamer' }
]

interface OllamaToolCall { function: { name: string; arguments: Record<string, unknown> | string } }
interface OllamaMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_calls?: OllamaToolCall[]; tool_name?: string }

export function isValidModelName(name: string): boolean {
  return /^[a-z0-9][a-z0-9._\-/]{0,80}(:[a-z0-9._\-]{1,40})?$/i.test(name)
}

/** Anthropic-Nachrichten → Ollama-Nachrichten (inkl. Werkzeugaufrufe und -ergebnisse). */
export function toOllamaMessages(system: string, messages: Message[]): OllamaMessage[] {
  const out: OllamaMessage[] = [{ role: 'system', content: system }]
  const toolNames = new Map<string, string>()
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content })
      continue
    }
    if (m.role === 'assistant') {
      const text = m.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n')
      const calls = m.content.filter((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use')
      for (const c of calls) toolNames.set(c.id, c.name)
      out.push({ role: 'assistant', content: text, ...(calls.length ? { tool_calls: calls.map((c) => ({ function: { name: c.name, arguments: c.input } })) } : {}) })
    } else {
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          out.push({ role: 'tool', content: b.is_error ? `FEHLER: ${b.content}` : b.content, tool_name: toolNames.get(b.tool_use_id) })
        } else if (b.type === 'text') {
          out.push({ role: 'user', content: b.text })
        }
      }
    }
  }
  return out
}

export function toOllamaTools(tools: Tool[] | undefined): unknown[] | undefined {
  if (!tools?.length) return undefined
  return tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }))
}

let callCounter = 0
/** Ollama-Antwort → ATLAS-Format (Text- und Werkzeugblöcke). */
export function fromOllamaResponse(msg: { content?: string; tool_calls?: OllamaToolCall[] }): ClaudeResponse {
  const content: ContentBlock[] = []
  // Denkspuren mancher Modelle (<think>…</think>) nicht anzeigen
  const text = (msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
  if (text) content.push({ type: 'text', text })
  for (const call of msg.tool_calls ?? []) {
    let input: Record<string, unknown> = {}
    const args = call.function?.arguments
    if (typeof args === 'string') {
      try { input = JSON.parse(args) as Record<string, unknown> } catch { input = {} }
    } else if (args && typeof args === 'object') {
      input = args
    }
    content.push({ type: 'tool_use', id: `local_${Date.now()}_${++callCounter}`, name: call.function.name, input })
  }
  const hasTools = content.some((b) => b.type === 'tool_use')
  return { content, stop_reason: hasTools ? 'tool_use' : 'end_turn' }
}

interface ChatOpts { model: string; system: string; messages: Message[]; tools?: Tool[]; signal?: AbortSignal; maxTokens?: number; numCtx?: number; onText?: (delta: string) => void }

/** Der Anfragetext an Ollama. think:false schaltet das lange „Nachdenken“ von Qwen3 & Co. ab. */
export function buildChatBody(opts: ChatOpts, think: boolean): Record<string, unknown> {
  return {
    model: opts.model,
    messages: toOllamaMessages(opts.system, opts.messages),
    tools: toOllamaTools(opts.tools),
    stream: Boolean(opts.onText),
    ...(think ? {} : { think: false }),
    keep_alive: KEEP_ALIVE,
    options: { num_ctx: opts.numCtx ?? DEFAULT_CONTEXT, temperature: 0.3, num_predict: opts.maxTokens ?? 1024 }
  }
}

interface OllamaChunk {
  message?: { content?: string; tool_calls?: OllamaToolCall[] }
  done?: boolean
  error?: string
  total_duration?: number
  load_duration?: number
  prompt_eval_count?: number
  prompt_eval_duration?: number
  eval_count?: number
  eval_duration?: number
}

/** Ollama meldet Zeiten in Nanosekunden. */
export function statsFrom(c: OllamaChunk): LocalStats | undefined {
  if (c.eval_count === undefined && c.prompt_eval_count === undefined) return undefined
  const ms = (ns?: number): number => Math.round((ns ?? 0) / 1e6)
  return {
    promptTokens: c.prompt_eval_count ?? 0, promptMs: ms(c.prompt_eval_duration),
    genTokens: c.eval_count ?? 0, genMs: ms(c.eval_duration),
    totalMs: ms(c.total_duration), loadMs: ms(c.load_duration)
  }
}

const num = (n: number): string => n.toLocaleString('de-DE')
const rate = (tokens: number, ms: number): string => (ms > 0 ? (tokens / (ms / 1000)).toFixed(1).replace('.', ',') : '–')

/** Eine Zeile fürs Debug-Protokoll: So sieht man, wo die Zeit hingeht. */
export function describeStats(st: LocalStats): string {
  return `Antwort: ${num(st.genTokens)} Token in ${(st.genMs / 1000).toFixed(1).replace('.', ',')} s (${rate(st.genTokens, st.genMs)} Token/s) · `
    + `Frage verarbeiten: ${num(st.promptTokens)} Token in ${(st.promptMs / 1000).toFixed(1).replace('.', ',')} s`
    + (st.loadMs > 1500 ? ` · Modell laden: ${(st.loadMs / 1000).toFixed(1).replace('.', ',')} s` : '')
}

/** Liest die Antwort Stück für Stück (NDJSON). Jedes Textstück geht sofort an onText. */
async function readChatStream(res: Response, onText: (delta: string) => void): Promise<{ message: { content: string; tool_calls: OllamaToolCall[] }; stats?: LocalStats }> {
  if (!res.body) throw new Error('Die lokale KI hat keine Antwort geliefert.')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  const toolCalls: OllamaToolCall[] = []
  let stats: LocalStats | undefined
  const handle = (line: string): void => {
    if (!line.trim()) return
    const c = JSON.parse(line) as OllamaChunk
    if (c.error) throw new Error(`Lokale KI-Fehler: ${c.error}`)
    const delta = c.message?.content
    if (delta) { content += delta; onText(delta) }
    if (c.message?.tool_calls) toolCalls.push(...c.message.tool_calls)
    if (c.done) stats = statsFrom(c)
  }
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) handle(line)
  }
  handle(buffer)
  return { message: { content, tool_calls: toolCalls }, stats }
}

function localError(model: string, status: number, body: string): Error {
  if (status === 404 || /not found/i.test(body)) return new Error(`Das Modell „${model}“ ist nicht installiert. Lade es unter Einstellungen → Lokale KI herunter.`)
  if (/does not support tools/i.test(body)) return new Error(`Das Modell „${model}“ kann keine Werkzeuge benutzen. Wähle z. B. qwen3:8b.`)
  if (/memory|out of memory|cuda/i.test(body)) return new Error('Für dieses Modell reicht der Speicher nicht. Wähle ein kleineres Modell oder unter „Geschwindigkeit“ „Schnell“.')
  return new Error(`Lokale KI-Fehler: ${body.slice(0, 200)}`)
}

/** Hat ATLAS das Modell geladen? Nur dann gibt ATLAS es später auch wieder frei (nicht das eines anderen Programms). */
let loadedByAtlas = false

export async function callOllama(opts: ChatOpts): Promise<ClaudeResponse> {
  loadedByAtlas = true
  const post = (think: boolean): Promise<Response> => fetch(`${ollamaUrl()}/api/chat`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(buildChatBody(opts, think))
  })
  let res: Response
  try {
    res = await post(false)
    // Manche Modelle kennen den Parameter nicht – dann ohne ihn wiederholen
    if (!res.ok && res.status === 400) {
      const body = await res.clone().text().catch(() => '')
      if (/think/i.test(body)) res = await post(true)
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error('Die lokale KI (Ollama) antwortet nicht. Läuft Ollama?')
  }
  if (!res.ok) throw localError(opts.model, res.status, await res.text().catch(() => ''))
  if (opts.onText) {
    const streamed = await readChatStream(res, opts.onText)
    const out = fromOllamaResponse(streamed.message)
    if (streamed.stats) { out.stats = streamed.stats; log('info', 'Lokale KI', describeStats(streamed.stats)) }
    return out
  }
  const data = (await res.json()) as OllamaChunk
  const out = fromOllamaResponse(data.message ?? {})
  const stats = statsFrom(data)
  if (stats) { out.stats = stats; log('info', 'Lokale KI', describeStats(stats)) }
  return out
}

/**
 * Lädt das Modell schon beim Öffnen von ATLAS in den Speicher, damit die erste Frage nicht
 * erst auf das Laden warten muss. num_ctx muss mit dem Chat übereinstimmen, sonst lädt Ollama neu.
 */
export async function warmUpModel(model: string, numCtx: number): Promise<void> {
  loadedByAtlas = true
  try {
    await fetch(`${ollamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: KEEP_ALIVE, options: { num_ctx: numCtx } }),
      signal: AbortSignal.timeout(180_000)
    })
  } catch {
    /* nicht schlimm – das Modell wird dann bei der ersten Frage geladen */
  }
}

/**
 * Gibt das Modell sofort frei (Grafikspeicher und Arbeitsspeicher werden wieder frei) – damit Spiele und andere
 * Programme nicht auf ein KI-Modell warten müssen, das niemand mehr braucht. Ollama lädt es bei Bedarf neu.
 */
export async function unloadModel(model: string): Promise<boolean> {
  if (!loadedByAtlas) return false
  loadedByAtlas = false
  try {
    await fetch(`${ollamaUrl()}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
      signal: AbortSignal.timeout(5000)
    })
    return true
  } catch {
    return false
  }
}

/**
 * Geschwindigkeitstest: ein kurzer, fester Auftrag. Gemessen wird nur das Schreiben der Antwort
 * (ohne Laden des Modells, das wird getrennt gemeldet) – so lassen sich Modelle und Einstellungen vergleichen.
 */
export async function benchmarkModel(model: string, numCtx: number): Promise<Benchmark> {
  let res: Response
  try {
    res = await fetch(`${ollamaUrl()}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Zähle auf Deutsch von eins bis dreißig, durch Kommas getrennt.' }],
        stream: false,
        think: false,
        keep_alive: KEEP_ALIVE,
        options: { num_ctx: numCtx, temperature: 0, num_predict: 160 }
      }),
      signal: AbortSignal.timeout(300_000)
    })
  } catch {
    throw new Error('Die lokale KI (Ollama) antwortet nicht. Läuft Ollama?')
  }
  if (!res.ok) throw localError(model, res.status, await res.text().catch(() => ''))
  const data = (await res.json()) as OllamaChunk
  const st = statsFrom(data)
  if (!st || st.genMs <= 0) throw new Error('Ollama hat keine Messwerte geliefert.')
  const load = await ollamaLoad()
  return {
    model,
    tokensPerSecond: Math.round((st.genTokens / (st.genMs / 1000)) * 10) / 10,
    promptTokensPerSecond: st.promptMs > 0 ? Math.round((st.promptTokens / (st.promptMs / 1000)) * 10) / 10 : null,
    loadMs: st.loadMs,
    totalMs: st.totalMs,
    gpuPercent: load?.percentGpu ?? null
  }
}

/** Wie viel vom geladenen Modell liegt auf der Grafikkarte? (Ollama: /api/ps) */
export async function ollamaLoad(): Promise<{ model: string; percentGpu: number } | null> {
  try {
    const res = await fetch(`${ollamaUrl()}/api/ps`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const data = (await res.json()) as { models?: Array<{ name?: string; model?: string; size?: number; size_vram?: number }> }
    const m = data.models?.find((x) => typeof x.size === 'number' && x.size > 0)
    if (!m) return null
    return { model: m.name ?? m.model ?? '', percentGpu: Math.min(100, Math.round(((m.size_vram ?? 0) / (m.size ?? 1)) * 100)) }
  } catch {
    return null
  }
}

export interface OllamaInfo { running: boolean; models: string[] }
let infoCache: { at: number; value: OllamaInfo } | null = null

/** Läuft Ollama, und welche Modelle sind installiert? (kurz gecacht) */
export async function ollamaInfo(force = false): Promise<OllamaInfo> {
  if (!force && infoCache && Date.now() - infoCache.at < 10_000) return infoCache.value
  let value: OllamaInfo = { running: false, models: [] }
  try {
    const res = await fetch(`${ollamaUrl()}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (res.ok) {
      const data = (await res.json()) as { models?: Array<{ name: string }> }
      value = { running: true, models: (data.models ?? []).map((m) => m.name) }
    }
  } catch {
    /* nicht installiert oder nicht gestartet */
  }
  infoCache = { at: Date.now(), value }
  return value
}

export function hasModel(info: OllamaInfo, model: string): boolean {
  const want = model.includes(':') ? model : `${model}:latest`
  return info.models.some((m) => m === model || m === want)
}

/** Lädt ein Modell herunter und meldet den Fortschritt. */
export async function pullModel(model: string, onProgress: (p: { status: string; percent: number | null }) => void): Promise<void> {
  if (!isValidModelName(model)) throw new Error('Ungültiger Modellname.')
  let res: Response
  try {
    res = await fetch(`${ollamaUrl()}/api/pull`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, stream: true }) })
  } catch {
    throw new Error('Ollama ist nicht erreichbar. Bitte zuerst Ollama installieren und starten.')
  }
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen (${res.status}).`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const msg = JSON.parse(line) as { status?: string; total?: number; completed?: number; error?: string }
      if (msg.error) throw new Error(msg.error)
      const percent = msg.total && msg.completed ? Math.round((msg.completed / msg.total) * 100) : null
      onProgress({ status: msg.status ?? '', percent })
    }
  }
  infoCache = null
}
