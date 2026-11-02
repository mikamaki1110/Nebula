import { all, run } from './db'

/** Kleine JSON-Ablage in der lokalen Datenbank (z. B. der letzte Sicherheitsbericht, damit er beim Start sofort da ist). */
export function loadJson<T>(key: string): T | null {
  try {
    const row = all<{ value: string }>('SELECT value FROM kv WHERE key = ?', [key])[0]
    return row ? (JSON.parse(row.value) as T) : null
  } catch {
    return null
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, JSON.stringify(value)])
  } catch {
    /* Datenbank nicht verfügbar – der Bericht gilt dann nur bis zum Schließen */
  }
}
