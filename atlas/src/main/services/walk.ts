import { opendir, stat } from 'fs/promises'
import { join } from 'path'

const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', 'windowsapps', 'winsxs', '$windows.~bt', '$windows.~ws'])

export interface WalkOptions {
  maxSeconds?: number
  maxFiles?: number
  concurrency?: number
}

export interface WalkStats { scanned: number; truncated: boolean; seconds: number }

/**
 * Durchläuft einen Ordner parallel, folgt keinen Verknüpfungen,
 * überspringt unlesbare Ordner und bricht nach Zeit- oder Dateilimit ab.
 */
export async function walkFiles(
  root: string,
  onFile: (path: string, name: string, size: number, mtimeMs: number) => void,
  opts: WalkOptions = {},
  onDir?: (path: string, name: string) => void
): Promise<WalkStats> {
  const started = Date.now()
  const deadline = started + (opts.maxSeconds ?? 45) * 1000
  const maxFiles = opts.maxFiles ?? 2_000_000
  const queue: string[] = [root]
  let scanned = 0
  let truncated = false

  const worker = async (): Promise<void> => {
    while (queue.length > 0) {
      if (Date.now() > deadline || scanned >= maxFiles) {
        truncated = true
        return
      }
      const dir = queue.pop()!
      let handle
      try {
        handle = await opendir(dir)
      } catch {
        continue
      }
      try {
        for await (const ent of handle) {
          const full = join(dir, ent.name)
          if (ent.isSymbolicLink()) continue
          if (ent.isDirectory()) {
            if (!SKIP_DIRS.has(ent.name.toLowerCase())) {
              onDir?.(full, ent.name)
              queue.push(full)
            }
          } else if (ent.isFile()) {
            try {
              const s = await stat(full)
              scanned++
              onFile(full, ent.name, s.size, s.mtimeMs)
            } catch {
              /* gesperrte Datei – überspringen */
            }
          }
        }
      } catch {
        /* Ordner während des Lesens verschwunden */
      }
    }
  }

  const n = opts.concurrency ?? 12
  // Mehrere Durchgänge, weil Worker enden können, während andere noch Ordner einreihen.
  while (queue.length > 0 && !truncated) {
    await Promise.all(Array.from({ length: n }, worker))
  }
  return { scanned, truncated, seconds: Math.round((Date.now() - started) / 100) / 10 }
}
