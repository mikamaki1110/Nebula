import type { Settings } from '@shared/types'
import { all, run } from './db'

const DEFAULTS: Settings = {
  userName: '',
  aiModel: 'claude-sonnet-5-5',
  voiceOutput: false,
  voiceName: '',
  voiceRate: 1,
  accent: 'ironbow',
  density: 'comfortable',
  effects: true,
  aiProvider: 'auto',
  ollamaModel: 'qwen3:8b',
  aiContext: 8192
}

export function getSettings(): Settings {
  const rows = all<{ value: string }>("SELECT value FROM kv WHERE key = 'settings'")
  const stored = rows[0] ? (JSON.parse(rows[0].value) as Partial<Settings>) : {}
  const merged = { ...DEFAULTS, ...stored }
  // Frühere Akzentnamen (bis 1.7.1) auf die Nebula-Paletten abbilden
  const legacy: Record<string, Settings['accent']> = { brass: 'ironbow', ember: 'lava', aurora: 'arctic', nebula: 'white' }
  merged.accent = legacy[merged.accent as string] ?? merged.accent
  return merged
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const next: Settings = { ...getSettings() }
  if (typeof patch.userName === 'string') next.userName = patch.userName.slice(0, 60)
  if (typeof patch.aiModel === 'string' && /^[a-z0-9.\-]{3,80}$/i.test(patch.aiModel)) next.aiModel = patch.aiModel
  if (typeof patch.voiceOutput === 'boolean') next.voiceOutput = patch.voiceOutput
  if (typeof patch.voiceName === 'string') next.voiceName = patch.voiceName.slice(0, 200)
  if (typeof patch.voiceRate === 'number' && patch.voiceRate >= 0.5 && patch.voiceRate <= 2) next.voiceRate = patch.voiceRate
  if (patch.accent && ['ironbow', 'arctic', 'lava', 'white'].includes(patch.accent)) next.accent = patch.accent
  if (patch.density === 'comfortable' || patch.density === 'compact') next.density = patch.density
  if (typeof patch.effects === 'boolean') next.effects = patch.effects
  if (patch.aiProvider === 'auto' || patch.aiProvider === 'local' || patch.aiProvider === 'cloud') next.aiProvider = patch.aiProvider
  if (typeof patch.ollamaModel === 'string' && /^[a-z0-9][a-z0-9._\-/]{0,80}(:[a-z0-9._\-]{1,40})?$/i.test(patch.ollamaModel)) next.ollamaModel = patch.ollamaModel
  if (typeof patch.aiContext === 'number' && [8192, 12288, 16384].includes(patch.aiContext)) next.aiContext = patch.aiContext
  run("INSERT INTO kv (key, value) VALUES ('settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(next)])
  return next
}
