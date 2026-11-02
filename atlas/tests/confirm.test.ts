import { describe, expect, it, vi } from 'vitest'
import { announceConfirmation } from '../src/main/core/confirm'

vi.mock('electron', () => ({ Notification: class {} }))

/** Ein Fenster, das jeden Zugriff mitzählt. */
function fakeWindow(focused: boolean, minimized = false): any {
  const calls: Record<string, number> = { flash: 0, flashOff: 0, restore: 0, show: 0, focus: 0 }
  let onFocus: (() => void) | null = null
  return {
    calls,
    isFocused: () => focused,
    isMinimized: () => minimized,
    flashFrame: (on: boolean) => { calls[on ? 'flash' : 'flashOff']!++ },
    once: (_ev: string, cb: () => void) => { onFocus = cb },
    restore: () => { calls['restore']!++ },
    show: () => { calls['show']!++ },
    focus: () => { calls['focus']!++ },
    gainFocus: () => onFocus?.()
  }
}

describe('Rückfrage bei einer Änderung', () => {
  it('drängt sich nicht in den Vordergrund, wenn der Nutzer in einer anderen App ist', () => {
    const win = fakeWindow(false, true)
    const notes: Array<{ title: string; body: string; click: () => void }> = []
    announceConfirmation(win, 'Papierkorb leeren?', (title, body, click) => notes.push({ title, body, click }))
    expect(win.calls.focus).toBe(0)   // kein Fokusklau
    expect(win.calls.show).toBe(0)
    expect(win.calls.restore).toBe(0) // minimiertes Fenster bleibt minimiert
    expect(win.calls.flash).toBe(1)   // Taskleiste blinkt
    expect(notes).toHaveLength(1)
    expect(notes[0]!.body).toBe('Papierkorb leeren?')
  })

  it('holt ATLAS erst nach vorn, wenn der Nutzer die Benachrichtigung anklickt', () => {
    const win = fakeWindow(false, true)
    let click: () => void = () => undefined
    announceConfirmation(win, 'Test', (_t, _b, c) => { click = c })
    click()
    expect(win.calls.restore).toBe(1)
    expect(win.calls.show).toBe(1)
    expect(win.calls.focus).toBe(1)
  })

  it('beendet das Blinken, sobald das Fenster den Fokus bekommt', () => {
    const win = fakeWindow(false)
    announceConfirmation(win, 'Test', () => undefined)
    win.gainFocus()
    expect(win.calls.flashOff).toBe(1)
  })

  it('tut nichts, wenn ATLAS ohnehin im Vordergrund ist', () => {
    const win = fakeWindow(true)
    let notified = 0
    announceConfirmation(win, 'Test', () => { notified++ })
    expect(win.calls.flash).toBe(0)
    expect(notified).toBe(0)
  })
})
