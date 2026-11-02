import { shell } from 'electron'
import { cp, mkdir, readdir, rename as fsRename, rm, stat } from 'fs/promises'
import { basename, dirname, extname, join, parse } from 'path'
import type { FileEntry, MoveRecord, ScanResult } from '@shared/types'
import { assertModifiable, assertValidName, toAbsolute } from '../core/paths'
import { walkFiles } from './walk'

export async function listDir(dir: string): Promise<FileEntry[]> {
  const abs = toAbsolute(dir)
  const entries = await readdir(abs, { withFileTypes: true })
  const rows = await Promise.all(entries.map(async (e): Promise<FileEntry | null> => {
    const path = join(abs, e.name)
    try {
      const s = await stat(path)
      return { path, name: e.name, size: s.isDirectory() ? 0 : s.size, mtime: s.mtimeMs, isDir: s.isDirectory() }
    } catch {
      return null
    }
  }))
  return rows
    .filter((r): r is FileEntry => r !== null)
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, 'de'))
}

/** Suche nach Namensteilen; „*“ und „?“ funktionieren als Platzhalter. */
export async function searchFiles(root: string, query: string, limit = 200): Promise<ScanResult<FileEntry>> {
  const abs = toAbsolute(root)
  const q = query.trim().toLowerCase()
  if (!q) throw new Error('Bitte einen Suchbegriff angeben.')
  const hasWildcard = /[*?]/.test(q)
  const re = hasWildcard
    ? new RegExp('^' + q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
    : null
  const match = (name: string): boolean => (re ? re.test(name.toLowerCase()) : name.toLowerCase().includes(q))
  const cap = Math.min(1000, Math.max(1, limit))
  const items: FileEntry[] = []
  const stats = await walkFiles(
    abs,
    (path, name, size, mtime) => { if (items.length < cap && match(name)) items.push({ path, name, size, mtime, isDir: false }) },
    { maxSeconds: 45 },
    (path, name) => { if (items.length < cap && match(name)) items.push({ path, name, size: 0, mtime: 0, isDir: true }) }
  )
  return { items, ...stats, truncated: stats.truncated || items.length >= cap }
}

/** Verschiebt in den Papierkorb – über den Windows-Papierkorb wiederherstellbar. */
export async function trashPaths(paths: string[]): Promise<{ trashed: number; failed: string[] }> {
  let trashed = 0
  const failed: string[] = []
  for (const p of paths) {
    try {
      await shell.trashItem(assertModifiable(p))
      trashed++
    } catch (e) {
      failed.push(`${p}: ${e instanceof Error ? e.message : 'Fehler'}`)
    }
  }
  return { trashed, failed }
}

/** Wie rename, aber auch über Laufwerksgrenzen (kopieren, dann Original entfernen). */
async function rename(from: string, to: string): Promise<void> {
  try {
    await fsRename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'EXDEV') throw e
    await cp(from, to, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
    await rm(from, { recursive: true })
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** Findet einen freien Namen: „Bericht.pdf“ → „Bericht (2).pdf“. */
async function freeTarget(dir: string, name: string): Promise<string> {
  const { name: stem, ext } = parse(name)
  let candidate = join(dir, name)
  for (let i = 2; await exists(candidate); i++) candidate = join(dir, `${stem} (${i})${ext}`)
  return candidate
}

export async function movePaths(paths: string[], targetDir: string): Promise<{ moved: MoveRecord[]; failed: string[] }> {
  const target = assertModifiable(targetDir)
  await mkdir(target, { recursive: true })
  const moved: MoveRecord[] = []
  const failed: string[] = []
  for (const p of paths) {
    try {
      const from = assertModifiable(p)
      const to = await freeTarget(target, basename(from))
      await rename(from, to)
      moved.push({ from, to })
    } catch (e) {
      failed.push(`${p}: ${describeFsError(e)}`)
    }
  }
  return { moved, failed }
}

export async function renamePath(path: string, newName: string): Promise<MoveRecord> {
  const from = assertModifiable(path)
  const name = assertValidName(newName)
  const to = join(dirname(from), name)
  if (await exists(to)) throw new Error(`Im Ordner gibt es bereits „${name}“.`)
  await rename(from, to)
  return { from, to }
}

export async function makeDir(parent: string, name: string): Promise<{ path: string }> {
  const dir = join(assertModifiable(parent), assertValidName(name))
  if (await exists(dir)) throw new Error(`„${name}“ existiert bereits.`)
  await mkdir(dir)
  return { path: dir }
}

/** Macht Verschiebungen rückgängig (für den Verlauf). */
export async function restoreMoves(moves: MoveRecord[]): Promise<{ restored: number; failed: string[] }> {
  let restored = 0
  const failed: string[] = []
  for (const m of [...moves].reverse()) {
    try {
      const to = assertModifiable(m.to)
      const from = assertModifiable(m.from)
      if (await exists(from)) throw new Error('Am ursprünglichen Ort liegt inzwischen eine andere Datei.')
      await mkdir(dirname(from), { recursive: true })
      await rename(to, from)
      restored++
    } catch (e) {
      failed.push(`${m.to}: ${describeFsError(e)}`)
    }
  }
  return { restored, failed }
}

const CATEGORIES: Record<string, string[]> = {
  Bilder: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'tif', 'tiff', 'svg', 'raw', 'cr2', 'nef', 'psd'],
  Dokumente: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub'],
  Videos: ['mp4', 'mkv', 'mov', 'avi', 'wmv', 'webm', 'm4v'],
  Musik: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma'],
  Archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
  Installationsprogramme: ['exe', 'msi', 'msix', 'appx'],
  Code: ['js', 'ts', 'tsx', 'py', 'java', 'cs', 'cpp', 'c', 'h', 'html', 'css', 'json', 'xml', 'yml', 'yaml', 'sh', 'ps1', 'bat']
}

function categoryOf(name: string): string {
  const ext = extname(name).slice(1).toLowerCase()
  for (const [cat, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return cat
  return 'Sonstiges'
}

/** Plan: lose Dateien eines Ordners in Unterordner nach Typ einsortieren. Nichts wird verändert. */
export async function organizePlan(dir: string): Promise<MoveRecord[]> {
  const abs = assertModifiable(dir)
  const entries = await readdir(abs, { withFileTypes: true })
  const taken = new Set<string>()
  const plan: MoveRecord[] = []
  for (const e of entries) {
    if (!e.isFile() || e.name.toLowerCase() === 'desktop.ini' || e.name.startsWith('~$')) continue
    const category = categoryOf(e.name)
    const targetDir = join(abs, category)
    const { name: stem, ext } = parse(e.name)
    let to = join(targetDir, e.name)
    for (let i = 2; taken.has(to.toLowerCase()) || (await exists(to)); i++) to = join(targetDir, `${stem} (${i})${ext}`)
    taken.add(to.toLowerCase())
    plan.push({ from: join(abs, e.name), to, category })
  }
  return plan
}

export async function organizeApply(dir: string): Promise<{ moved: MoveRecord[]; failed: string[] }> {
  const plan = await organizePlan(dir)
  const moved: MoveRecord[] = []
  const failed: string[] = []
  for (const m of plan) {
    try {
      await mkdir(dirname(m.to), { recursive: true })
      if (await exists(m.to)) throw new Error('Ziel existiert bereits.')
      await rename(m.from, m.to)
      moved.push(m)
    } catch (e) {
      failed.push(`${m.from}: ${describeFsError(e)}`)
    }
  }
  return { moved, failed }
}

function describeFsError(e: unknown): string {
  const code = (e as NodeJS.ErrnoException)?.code
  if (code === 'EBUSY' || code === 'EPERM') return 'Datei ist gerade geöffnet oder geschützt.'
  if (code === 'EACCES') return 'Zugriff verweigert.'
  if (code === 'ENOENT') return 'Nicht mehr vorhanden.'
  return e instanceof Error ? e.message : 'Unbekannter Fehler'
}
