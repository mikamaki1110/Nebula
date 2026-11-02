import { describe, expect, it, vi } from 'vitest'
import { AGENTS, compactSchema, mainSystem, routeAgent, shortDescription, specialistSystem } from '../src/main/ai/agents'

vi.mock('electron', () => ({ app: { getPath: () => '' }, shell: {}, Notification: class {}, BrowserWindow: class {}, clipboard: {}, ipcMain: {}, dialog: {}, session: {} }))
vi.mock('systeminformation', () => ({ default: {} }))

const id = (text: string, prev: string | null = null): string | null => routeAgent(text, prev)?.id ?? null

describe('Direktroute: welcher Fachagent ist zuständig?', () => {
  it('erkennt die typischen Aufträge', () => {
    expect(id('Wie viel Speicherplatz habe ich noch?')).toBe('storage')
    expect(id('Räume meine Festplatte auf.')).toBe('storage')
    expect(id('Sortiere meinen Downloads-Ordner.')).toBe('storage')
    expect(id('Mein PC ist langsam. Finde heraus, warum.')).toBe('performance')
    expect(id('Überprüfe meinen PC auf Sicherheitsprobleme.')).toBe('security')
    expect(id('Welche Programme starten automatisch?')).toBe('software')
    expect(id('Deinstalliere Discord vollständig.')).toBe('software')
    expect(id('Mein Internet geht nicht, kannst du das reparieren?')).toBe('repair')
    expect(id('Wie warm ist meine Grafikkarte?')).toBe('system')
  })

  it('verwechselt Arbeitsspeicher nicht mit Speicherplatz', () => {
    expect(id('Wie viel Arbeitsspeicher ist frei?')).toBe('performance')
    expect(id('Wie viel Speicher ist auf C: frei?')).toBe('storage')
  })

  it('überlässt unklare oder gemischte Aufträge dem Hauptagenten', () => {
    expect(id('Hallo, wer bist du?')).toBeNull()
    expect(id('Prüfe die Sicherheit und räume die Festplatte auf.')).toBeNull() // Gleichstand
  })

  it('lässt kurze Anschlussfragen beim letzten Fachbereich', () => {
    expect(id('ja, bitte', 'software')).toBe('software')
    expect(id('Hallo, wer bist du?', 'software')).toBe('software') // kurz → bleibt
    expect(id('Erzähl mir bitte eine ausführliche Geschichte darüber, wie du entstanden bist und wer dich gebaut hat.', 'software')).toBeNull()
  })

  it('kennt nur existierende Agenten', () => {
    for (const q of ['festplatte', 'virus', 'treiber', 'cpu', 'programm', 'gpu']) expect(AGENTS.some((a) => a.id === id(q))).toBe(true)
  })
})

describe('Kompakte Werkzeuge für lokale Modelle', () => {
  it('entfernt Erklärtexte aus dem Schema, behält aber Typen und Pflichtfelder', () => {
    const full = { type: 'object', title: 'X', description: 'lang', additionalProperties: false, properties: { mode: { type: 'string', enum: ['a', 'b'], description: 'Welcher Modus' }, n: { type: 'integer', minimum: 1, default: 3 } }, required: ['mode'] }
    const c = compactSchema(full) as any
    expect(c).toEqual({ type: 'object', properties: { mode: { type: 'string', enum: ['a', 'b'] }, n: { type: 'integer', minimum: 1 } }, required: ['mode'] })
    expect(JSON.stringify(c).length < JSON.stringify(full).length * 0.7).toBe(true)
  })

  it('kürzt Beschreibungen auf den ersten Satz', () => {
    expect(shortDescription('Listet Dateien. Mehr Erklärung, die niemand braucht.')).toBe('Listet Dateien.')
    const long = shortDescription('Ein sehr langer Satz ohne Punkt '.repeat(12))
    expect(long.length <= 142).toBe(true)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('Gleichbleibender Vorspann (damit Ollama seinen Zwischenspeicher nutzen kann)', () => {
  it('der Systemtext hängt nicht vom PC-Stand ab und ist bei jedem Aufruf identisch', () => {
    expect(mainSystem('Max', true)).toBe(mainSystem('Max', true))
    const storage = AGENTS.find((a) => a.id === 'storage')!
    expect(specialistSystem(storage, 'direct', 'Max', true)).toBe(specialistSystem(storage, 'direct', 'Max', true))
    expect(mainSystem('Max', true).includes('Aktueller PC-Kontext')).toBe(false) // früher stand hier die wechselnde Auslastung
  })

  it('die kompakte Fassung ist deutlich kürzer', () => {
    expect(mainSystem('Max', true).length < mainSystem('Max', false).length * 0.8).toBe(true)
  })

  it('im Direktmodus antwortet der Spezialist dem Benutzer, im Berichtsmodus dem Hauptagenten', () => {
    const a = AGENTS[0]!
    expect(specialistSystem(a, 'direct', '', true)).toContain('antworte dem Benutzer direkt')
    expect(specialistSystem(a, 'report', '', true)).toContain('Main-Agent')
  })
})
