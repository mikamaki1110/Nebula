/** „gerade eben“, „vor 5 Min“, „vor 2 Std“ – für den Stand von Berichten. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 45) return 'gerade eben'
  const m = Math.round(s / 60)
  if (m < 60) return `vor ${m} Min`
  const h = Math.round(m / 60)
  if (h < 36) return `vor ${h} Std`
  return `vor ${Math.round(h / 24)} Tagen`
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} s`
