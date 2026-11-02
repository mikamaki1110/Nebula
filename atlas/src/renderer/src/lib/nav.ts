import type { PageId } from '@shared/types'
export type { PageId }

export interface NavItem { id: PageId; label: string; hint: string }

export const NAV: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', hint: 'Überblick und Zustand' },
  { id: 'chat', label: 'KI-Chat', hint: 'Mit ATLAS sprechen' },
  { id: 'monitor', label: 'PC-Überwachung', hint: 'Verläufe und Prozesse' },
  { id: 'storage', label: 'Speicher', hint: 'Platz finden und aufräumen' },
  { id: 'programs', label: 'Programme', hint: 'Software und Autostart' },
  { id: 'security', label: 'Sicherheit', hint: 'Schutzstatus prüfen' },
  { id: 'optimize', label: 'Optimierung', hint: 'Schneller machen' },
  { id: 'repair', label: 'Reparatur', hint: 'Windows-Probleme beheben' },
  { id: 'files', label: 'Dateimanager', hint: 'Suchen und organisieren' },
  { id: 'settings', label: 'Einstellungen', hint: 'KI, Stimme, Name' }
]

export const HISTORY_ITEM: NavItem = { id: 'history', label: 'Verlauf', hint: 'Änderungen und Rückgängig' }

/** Gruppen der Seitenleiste. */
export const NAV_GROUPS: Array<{ label: string; ids: PageId[] }> = [
  { label: 'Überblick', ids: ['dashboard', 'chat', 'monitor'] },
  { label: 'Schutz & Pflege', ids: ['security', 'optimize', 'repair'] },
  { label: 'Daten', ids: ['storage', 'programs', 'files'] }
]
export const FOOTER_IDS: PageId[] = ['history', 'settings']
export const NAV_BY_ID = new Map<PageId, NavItem>([...NAV, HISTORY_ITEM].map((n) => [n.id, n]))
