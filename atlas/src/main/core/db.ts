import { createRequire } from 'module'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import initSqlJs, { type Database, type SqlValue } from 'sql.js'

/**
 * Lokale SQLite-Datenbank (sql.js, kein natives Modul nötig).
 * Wird nach Änderungen verzögert auf die Festplatte geschrieben.
 */
let db: Database | null = null
let filePath = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

export async function openDb(path: string): Promise<void> {
  const req = createRequire(__filename)
  const distDir = dirname(req.resolve('sql.js'))
  const SQL = await initSqlJs({ locateFile: (f: string) => join(distDir, f) })
  filePath = path
  db = existsSync(path) ? new SQL.Database(readFileSync(path)) : new SQL.Database()
  db.run(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, cap_id TEXT NOT NULL,
      summary TEXT NOT NULL, undo_cap TEXT, undo_input TEXT, undone INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, label TEXT NOT NULL,
      ram_used_pct REAL, free_system_bytes REAL, autostart_enabled INTEGER, process_count INTEGER, temp_bytes REAL
    );
  `)
}

function handle(): Database {
  if (!db) throw new Error('Datenbank ist nicht geöffnet.')
  return db
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(flushDb, 400)
}

export function flushDb(): void {
  if (!db || !filePath) return
  writeFileSync(filePath, Buffer.from(db.export()))
}

export function run(sql: string, params: SqlValue[] = []): number {
  const d = handle()
  d.run(sql, params)
  scheduleSave()
  const r = d.exec('SELECT last_insert_rowid()')
  return Number(r[0]?.values[0]?.[0] ?? 0)
}

export function all<T>(sql: string, params: SqlValue[] = []): T[] {
  const stmt = handle().prepare(sql)
  stmt.bind(params)
  const rows: T[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as T)
  stmt.free()
  return rows
}
