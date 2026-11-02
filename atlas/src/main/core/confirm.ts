import { randomUUID } from 'crypto'
import { Notification, type BrowserWindow } from 'electron'
import { IPC, type ConfirmRequest } from '@shared/contract'

const pending = new Map<string, (approved: boolean) => void>()
const TIMEOUT_MS = 5 * 60_000

let getWindow: () => BrowserWindow | null = () => null
export function setConfirmWindow(fn: () => BrowserWindow | null): void {
  getWindow = fn
}

type Notify = (title: string, body: string, onClick: () => void) => void
type AnnounceWindow = Pick<BrowserWindow, 'isFocused' | 'isMinimized' | 'flashFrame' | 'once' | 'restore' | 'show' | 'focus'>

const systemNotify: Notify = (title, body, onClick) => {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', onClick)
  n.show()
}

/**
 * Macht auf eine Rückfrage aufmerksam, OHNE sich in den Vordergrund zu drängen: Wer gerade in einem Spiel oder
 * einer anderen App arbeitet, soll dort bleiben. Das Taskleisten-Symbol blinkt und Windows zeigt eine
 * Benachrichtigung; erst ein Klick darauf holt ATLAS nach vorn. Ist ATLAS ohnehin im Vordergrund, passiert nichts.
 */
export function announceConfirmation(win: AnnounceWindow, title: string, notify: Notify = systemNotify): void {
  if (win.isFocused()) return
  win.flashFrame(true)
  win.once('focus', () => win.flashFrame(false))
  notify('ATLAS wartet auf deine Bestätigung', title, () => {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

/** Zeigt den Bestätigungsdialog in der Oberfläche und wartet auf die Entscheidung. */
export function requestConfirmation(req: Omit<ConfirmRequest, 'id'>): Promise<boolean> {
  const win = getWindow()
  if (!win || win.isDestroyed()) return Promise.resolve(false)
  const id = randomUUID()
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(false), TIMEOUT_MS)
    const finish = (approved: boolean): void => {
      clearTimeout(timer)
      pending.delete(id)
      resolve(approved)
    }
    pending.set(id, finish)
    announceConfirmation(win, req.title)
    win.webContents.send(IPC.confirmRequest, { ...req, id } satisfies ConfirmRequest)
  })
}

export function resolveConfirmation(id: string, approved: boolean): void {
  pending.get(id)?.(approved)
}
