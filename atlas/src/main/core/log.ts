/**
 * Protokoll von ATLAS. Nebula reicht beim Start eine Funktion durch, deshalb erscheinen
 * alle Meldungen in Nebula unter „Debug“ – dort sieht man, wenn eine Abfrage klemmt.
 */
type Level = 'info' | 'warn' | 'error'
let sink: ((level: Level, message: string) => void) | null = null

export function setLogSink(fn: ((level: Level, message: string) => void) | null): void {
  sink = fn
}

export function log(level: Level, source: string, message: string): void {
  const text = `${source}: ${message}`
  if (sink) sink(level, text)
  else if (level !== 'info') console.warn(`[atlas] ${text}`)
}
