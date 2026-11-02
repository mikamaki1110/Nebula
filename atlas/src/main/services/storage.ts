import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { open, opendir, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { DuplicateGroup, FileEntry, ScanResult, StorageOverview, TempLocation } from '@shared/types'
import { ps } from '../core/powershell'
import { toAbsolute } from '../core/paths'
import { walkFiles } from './walk'

const MB = 1024 * 1024

function tempLocations(): Array<{ label: string; path: string; cleanable: boolean }> {
  const win = process.env['SystemRoot'] ?? 'C:\\Windows'
  const local = process.env['LOCALAPPDATA'] ?? ''
  return [
    { label: 'Temporäre Dateien (Benutzer)', path: tmpdir(), cleanable: true },
    { label: 'Temporäre Dateien (Windows)', path: join(win, 'Temp'), cleanable: true },
    { label: 'Absturzberichte', path: join(local, 'CrashDumps'), cleanable: true },
    { label: 'Windows-Fehlerberichte', path: join(local, 'Microsoft', 'Windows', 'WER'), cleanable: false }
  ].filter((l) => l.path)
}

async function dirSize(path: string, maxSeconds = 15): Promise<{ bytes: number; files: number; accessible: boolean }> {
  try {
    await stat(path)
  } catch {
    return { bytes: 0, files: 0, accessible: false }
  }
  let bytes = 0
  let files = 0
  await walkFiles(path, (_p, _n, size) => { bytes += size; files++ }, { maxSeconds })
  return { bytes, files, accessible: true }
}

let overviewCache: { at: number; value: StorageOverview } | null = null

/**
 * quick: für Optimierung und Messpunkte – misst höchstens 5 Sekunden pro Ordner und merkt sich das
 * Ergebnis 2 Minuten. Die Speicher-Seite misst dagegen gründlich (bis 15 Sekunden).
 */
export async function storageOverview(opts: { quick?: boolean } = {}): Promise<StorageOverview> {
  if (opts.quick && overviewCache && Date.now() - overviewCache.at < 120_000) return overviewCache.value
  const temp: TempLocation[] = await Promise.all(
    tempLocations().map(async (l) => ({ label: l.label, path: l.path, ...(await dirSize(l.path, opts.quick ? 5 : 15)) }))
  )
  let recycleBin: StorageOverview['recycleBin'] = null
  try {
    recycleBin = await ps<{ bytes: number; items: number }>(`
      $items = (New-Object -ComObject Shell.Application).NameSpace(10).Items()
      $bytes = 0
      foreach ($i in $items) { $bytes += [double]$i.ExtendedProperty('Size') }
      $out = [pscustomobject]@{ bytes = $bytes; items = $items.Count }`)
  } catch {
    recycleBin = null
  }
  const value = { temp, recycleBin }
  overviewCache = { at: Date.now(), value }
  return value
}

export async function largeFiles(root: string, minSizeMB = 100, olderThanDays?: number, limit = 100): Promise<ScanResult<FileEntry>> {
  const dir = toAbsolute(root)
  const min = Math.max(1, minSizeMB) * MB
  const cutoff = olderThanDays ? Date.now() - olderThanDays * 86_400_000 : Infinity
  const cap = Math.min(500, Math.max(1, limit))
  const found: FileEntry[] = []
  const stats = await walkFiles(dir, (path, name, size, mtime) => {
    if (size < min || mtime > cutoff) return
    found.push({ path, name, size, mtime, isDir: false })
    if (found.length > cap * 4) {
      found.sort((a, b) => b.size - a.size)
      found.length = cap
    }
  }, { maxSeconds: 60 })
  found.sort((a, b) => b.size - a.size)
  return { items: found.slice(0, cap), ...stats }
}

async function hashFile(path: string, partial: boolean): Promise<string> {
  const h = createHash('sha256')
  if (partial) {
    const fh = await open(path, 'r')
    try {
      const buf = Buffer.alloc(64 * 1024)
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
      h.update(buf.subarray(0, bytesRead))
    } finally {
      await fh.close()
    }
    return h.digest('hex')
  }
  await new Promise<void>((resolve, reject) => {
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve()).on('error', reject)
  })
  return h.digest('hex')
}

/** Dreistufig: gleiche Größe → gleicher Anfang → gleicher vollständiger Hash. */
export async function duplicates(root: string, minSizeMB = 1): Promise<ScanResult<DuplicateGroup>> {
  const dir = toAbsolute(root)
  const min = Math.max(0.01, minSizeMB) * MB
  const bySize = new Map<number, string[]>()
  const stats = await walkFiles(dir, (path, _n, size) => {
    if (size < min) return
    const list = bySize.get(size)
    if (list) list.push(path)
    else bySize.set(size, [path])
  }, { maxSeconds: 60 })

  const groups: DuplicateGroup[] = []
  const deadline = Date.now() + 90_000
  for (const [size, paths] of bySize) {
    if (paths.length < 2) continue
    if (Date.now() > deadline) { stats.truncated = true; break }
    const byPartial = await groupBy(paths, (p) => hashFile(p, true))
    for (const [partialHash, candidates] of byPartial) {
      if (candidates.length < 2) continue
      if (size <= 64 * 1024) {
        groups.push({ size, hash: partialHash, paths: candidates })
        continue
      }
      const byFull = await groupBy(candidates, (p) => hashFile(p, false))
      for (const [hash, same] of byFull) if (same.length > 1) groups.push({ size, hash, paths: same })
    }
  }
  groups.sort((a, b) => b.size * (b.paths.length - 1) - a.size * (a.paths.length - 1))
  return { items: groups.slice(0, 200), ...stats }
}

async function groupBy(paths: string[], key: (p: string) => Promise<string>): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>()
  for (const p of paths) {
    try {
      const k = await key(p)
      map.set(k, [...(map.get(k) ?? []), p])
    } catch {
      /* unlesbar */
    }
  }
  return map
}

/** Löscht nur Dateien, die älter als 24 Stunden sind; gesperrte Dateien werden übersprungen. */
export async function cleanTemp(): Promise<{ freedBytes: number; deleted: number; skipped: number }> {
  const cutoff = Date.now() - 86_400_000
  let freedBytes = 0
  let deleted = 0
  let skipped = 0
  for (const loc of tempLocations().filter((l) => l.cleanable)) {
    let dir
    try {
      dir = await opendir(loc.path)
    } catch {
      continue
    }
    for await (const ent of dir) {
      const full = join(loc.path, ent.name)
      try {
        const s = await stat(full)
        if (s.mtimeMs > cutoff) { skipped++; continue }
        let size = s.size
        if (s.isDirectory()) {
          size = 0
          await walkFiles(full, (_p, _n, sz) => (size += sz), { maxSeconds: 5 })
        }
        await rm(full, { recursive: true, force: false, maxRetries: 0 })
        freedBytes += size
        deleted++
      } catch {
        skipped++
      }
    }
  }
  return { freedBytes, deleted, skipped }
}

export async function emptyRecycleBin(): Promise<{ freedBytes: number }> {
  const before = (await storageOverview()).recycleBin?.bytes ?? 0
  await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue; $out = $true')
  return { freedBytes: before }
}

export const fileName = basename
