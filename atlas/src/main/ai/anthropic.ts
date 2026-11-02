/** Schlanker Client für die Anthropic Messages API (ohne SDK, nur fetch). */
import { randomUUID } from 'crypto'
import { all, run } from '../core/db'
import { getSettings } from '../core/settings'
import { FREE_AI_PROXY_URL } from './config'
import { callOllama, hasModel, ollamaInfo } from './ollama'

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }

export interface Message { role: 'user' | 'assistant'; content: string | ContentBlock[] }
export interface Tool { name: string; description: string; input_schema: Record<string, unknown> }

export interface ClaudeResponse { content: ContentBlock[]; stop_reason: string }

export type KeySource = 'session' | 'env' | 'free' | 'local' | null

let sessionKey: string | null = null
export function setSessionKey(key: string | null): void {
  sessionKey = key?.trim() || null
}

/** Adresse des Gratis-Proxys (Umgebungsvariable zum Testen, sonst config.ts). */
function proxyUrl(): string | null {
  const url = (process.env['NEBULA_AI_PROXY'] ?? FREE_AI_PROXY_URL).trim().replace(/\/+$/, '')
  return /^https:\/\/[^\s]+$/.test(url) ? url : null
}

/** Cloud-Quellen: eigener Schlüssel hat Vorrang, sonst der Gratis-Zugang über den Proxy. */
export function apiKeySource(): Exclude<KeySource, 'local'> {
  if (sessionKey) return 'session'
  if (process.env['ANTHROPIC_API_KEY']) return 'env'
  if (proxyUrl()) return 'free'
  return null
}

/**
 * Welcher Weg wird gerade benutzt?
 * auto:  eigener Schlüssel → lokale KI (falls Ollama läuft und das Modell da ist) → Gratis-Zugang
 * local: nur Ollama · cloud: nie Ollama
 */
export async function resolveSource(): Promise<KeySource> {
  const { aiProvider, ollamaModel } = getSettings()
  const cloud = apiKeySource()
  if (aiProvider === 'cloud') return cloud
  if (aiProvider === 'auto' && (cloud === 'session' || cloud === 'env')) return cloud
  const info = await ollamaInfo()
  if (info.running && hasModel(info, ollamaModel)) return 'local'
  return aiProvider === 'local' ? null : cloud
}

let lastSource: KeySource = null
/** Zuletzt benutzter Weg – damit Agenten Werkzeugergebnisse für kleine lokale Modelle kürzen können. */
export const currentSource = (): KeySource => lastSource

/** Zufällige, anonyme Kennung dieser Installation – nur für die Ratenbegrenzung des Proxys. */
function installId(): string {
  const row = all<{ value: string }>("SELECT value FROM kv WHERE key = 'install-id'")[0]
  if (row) return row.value
  const id = randomUUID()
  run("INSERT INTO kv (key, value) VALUES ('install-id', ?)", [id])
  return id
}

export async function callClaude(opts: {
  model: string
  system: string
  messages: Message[]
  tools?: Tool[]
  signal?: AbortSignal
  maxTokens?: number
}): Promise<ClaudeResponse> {
  const source = await resolveSource()
  lastSource = source
  if (!source) {
    throw new Error(getSettings().aiProvider === 'local'
      ? 'Die lokale KI ist nicht bereit. Starte Ollama und lade unter Einstellungen → Lokale KI ein Modell herunter.'
      : 'Kein KI-Zugang eingerichtet. Richte unter Einstellungen die lokale KI ein oder trage einen API-Schlüssel ein.')
  }
  if (source === 'local') {
    const settings = getSettings()
    return callOllama({ ...opts, model: settings.ollamaModel, numCtx: settings.aiContext })
  }
  const free = source === 'free'
  const key = sessionKey ?? process.env['ANTHROPIC_API_KEY']

  const url = free ? `${proxyUrl()}/v1/messages` : 'https://api.anthropic.com/v1/messages'
  const headers: Record<string, string> = free
    ? { 'content-type': 'application/json', 'x-nebula-install': installId() }
    : { 'content-type': 'application/json', 'x-api-key': key!, 'anthropic-version': '2023-06-01' }

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: opts.signal,
      headers,
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.system,
        messages: opts.messages,
        ...(opts.tools?.length ? { tools: opts.tools } : {})
      })
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new Error('Die KI ist nicht erreichbar. Besteht eine Internetverbindung?')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (free) {
      if (res.status === 429) throw new Error('Der Gratis-Zugang ist gerade stark gefragt. Bitte warte eine Minute und versuche es erneut.')
      if (res.status === 503) throw new Error('Der Gratis-Zugang ist gerade nicht verfügbar. Du kannst unter Einstellungen einen eigenen API-Schlüssel eintragen.')
      if (res.status === 413) throw new Error('Das Gespräch ist zu lang geworden. Starte bitte ein neues Gespräch.')
      throw new Error('Der Gratis-Zugang hat einen Fehler gemeldet. Bitte später erneut versuchen.')
    }
    if (res.status === 401) throw new Error('Der API-Schlüssel wurde abgelehnt. Bitte in den Einstellungen prüfen.')
    if (res.status === 404) throw new Error('Das eingestellte KI-Modell wurde nicht gefunden. Bitte in den Einstellungen ein anderes wählen.')
    if (res.status === 429) throw new Error('Zu viele Anfragen an die KI. Bitte kurz warten.')
    if (res.status >= 500) throw new Error('Der KI-Dienst hat gerade Probleme. Bitte später erneut versuchen.')
    throw new Error(`KI-Fehler ${res.status}: ${body.slice(0, 200)}`)
  }
  return (await res.json()) as ClaudeResponse
}
