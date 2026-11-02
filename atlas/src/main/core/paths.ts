import { homedir } from 'os'
import { isAbsolute, normalize, parse, resolve, sep } from 'path'

const winDir = process.env['SystemRoot'] ?? 'C:\\Windows'

/** Bereiche, in denen ATLAS niemals Dateien verändert. */
const PROTECTED = [
  winDir,
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
  'C:\\Recovery',
  'C:\\ProgramData\\Microsoft',
  'C:\\Boot'
].map((p) => normalize(p).toLowerCase())

export function toAbsolute(p: string): string {
  if (!p || !isAbsolute(p)) throw new Error(`Ungültiger Pfad: „${p}“. Es wird ein vollständiger Pfad benötigt.`)
  return resolve(normalize(p))
}

function isInside(child: string, parent: string): boolean {
  const c = child.toLowerCase()
  return c === parent || c.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/** Prüft, ob ein Pfad verändert (verschoben, umbenannt, gelöscht) werden darf. */
export function assertModifiable(p: string): string {
  const abs = toAbsolute(p)
  const lower = abs.toLowerCase()
  if (parse(abs).root.toLowerCase() === lower || parse(abs).root.toLowerCase() + sep === lower) {
    throw new Error(`Ein ganzes Laufwerk (${abs}) kann nicht verändert werden.`)
  }
  if (lower === normalize(homedir()).toLowerCase()) {
    throw new Error('Der Benutzerordner selbst kann nicht verändert werden.')
  }
  const hit = PROTECTED.find((root) => isInside(abs, root))
  if (hit) throw new Error(`${abs} liegt in einem geschützten Systembereich und wird nicht verändert.`)
  return abs
}

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

export function assertValidName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..' || ILLEGAL.test(n) || RESERVED.test(n) || n.endsWith('.') || n.length > 200) {
    throw new Error(`„${name}“ ist kein gültiger Datei- oder Ordnername.`)
  }
  return n
}
