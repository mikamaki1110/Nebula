export function bytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n < 0) return '–'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let v = n
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0).replace('.', ',')} ${units[i]}`
}
export const rate = (n: number | null): string => (n === null ? '–' : `${bytes(n)}/s`)
export const pct = (n: number | null | undefined): string => (n == null ? '–' : `${Math.round(n)} %`)
export function duration(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return d > 0 ? `${d} T ${h} Std` : `${h} Std ${m} Min`
}
export const dateTime = (ms: number): string =>
  new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
export const date = (ms: number): string => new Date(ms).toLocaleDateString('de-DE')
export const SEVERITY_LABEL = { critical: 'Kritisch', high: 'Hoch', medium: 'Mittel', low: 'Hinweis' } as const
