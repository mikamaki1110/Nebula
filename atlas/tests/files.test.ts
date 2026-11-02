import { mkdtemp, readdir, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { movePaths, organizeApply, organizePlan, renamePath, restoreMoves } from '../src/main/services/files'
import { duplicates, largeFiles } from '../src/main/services/storage'

vi.mock('electron', () => ({ app: { getPath: () => '' }, shell: {} }))

async function sandbox(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-files-'))
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content)
  return dir
}

describe('Ordner sortieren', () => {
  it('plant nach Typ, ohne etwas zu verändern', async () => {
    const dir = await sandbox({ 'a.jpg': 'x', 'b.pdf': 'x', 'c.mp3': 'x', 'd.xyz': 'x' })
    const plan = await organizePlan(dir)
    expect(plan.map((p) => p.category).sort()).toEqual(['Bilder', 'Dokumente', 'Musik', 'Sonstiges'])
    expect((await readdir(dir)).sort()).toEqual(['a.jpg', 'b.pdf', 'c.mp3', 'd.xyz'])
  })
  it('sortiert ein und lässt sich vollständig rückgängig machen', async () => {
    const dir = await sandbox({ 'foto.png': '1', 'brief.docx': '2' })
    const { moved, failed } = await organizeApply(dir)
    expect(failed).toEqual([])
    expect((await readdir(dir)).sort()).toEqual(['Bilder', 'Dokumente'])
    const back = await restoreMoves(moved)
    expect(back.restored).toBe(2)
    expect((await readdir(dir)).filter((n) => n.includes('.')).sort()).toEqual(['brief.docx', 'foto.png'])
  })
})

describe('Verschieben und Umbenennen', () => {
  it('löst Namenskonflikte mit (2)', async () => {
    const a = await sandbox({ 'x.txt': 'a' })
    const b = await sandbox({ 'x.txt': 'b' })
    const { moved } = await movePaths([join(a, 'x.txt')], b)
    expect(moved[0]?.to).toBe(join(b, 'x (2).txt'))
  })
  it('verweigert ungültige Namen und belegte Ziele', async () => {
    const dir = await sandbox({ 'a.txt': '', 'b.txt': '' })
    let err = ''
    try { await renamePath(join(dir, 'a.txt'), 'b.txt') } catch (e) { err = (e as Error).message }
    expect(err.length > 0).toBe(true)
    err = ''
    try { await renamePath(join(dir, 'a.txt'), 'x/y') } catch (e) { err = (e as Error).message }
    expect(err.length > 0).toBe(true)
  })
})

describe('Speicheranalyse', () => {
  it('findet große Dateien sortiert nach Größe', async () => {
    const mb = 1024 * 1024
    const dir = await sandbox({ 'klein.bin': Buffer.alloc(10), 'gross.bin': Buffer.alloc(3 * mb), 'mittel.bin': Buffer.alloc(2 * mb) })
    const r = await largeFiles(dir, 1)
    expect(r.items.map((i) => i.name)).toEqual(['gross.bin', 'mittel.bin'])
  })
  it('erkennt inhaltsgleiche Dateien, aber nicht bloß gleich große', async () => {
    const mb = 1024 * 1024
    const same = Buffer.alloc(mb * 1.5, 7)
    const other = Buffer.alloc(mb * 1.5, 7); other[mb + 5] = 1
    const dir = await sandbox({ 'a.bin': same, 'b.bin': same, 'c.bin': other })
    const r = await duplicates(dir, 1)
    expect(r.items).toHaveLength(1)
    expect(r.items[0]!.paths.map((p) => p.slice(-5)).sort()).toEqual(['a.bin', 'b.bin'])
  })
})
