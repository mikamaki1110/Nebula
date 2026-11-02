import { spawn } from 'child_process'
import { BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { IPC, OLLAMA_INSTALL_COMMAND, type AiStatus, type Benchmark, type Result, type Settings } from '@shared/contract'
import { cancelChat, chat, resetChat } from './ai/agents'
import { resolveSource, setSessionKey } from './ai/anthropic'
import { benchmarkModel, hasModel, isValidModelName, ollamaInfo, ollamaLoad, pullModel, RECOMMENDED_MODELS } from './ai/ollama'
import { resolveConfirmation } from './core/confirm'
import { auditPath, execute, listHistory, undoHistory } from './core/execute'
import { getSettings, updateSettings } from './core/settings'

let currentWindow: () => BrowserWindow | null = () => null

/** Nur das ATLAS-Fenster selbst darf diese Kanäle benutzen – nicht das Nebula-Fenster, nicht fremde Seiten. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const win = currentWindow()
  return !!win && !win.isDestroyed() && event.sender.id === win.webContents.id
}

function handle<A extends unknown[], R>(channel: string, fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<R> | R): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrustedSender(event)) throw new Error('Unbekannter Absender abgelehnt.')
    return fn(event, ...(args as A))
  })
}

async function aiStatus(force = false): Promise<AiStatus> {
  const settings = getSettings()
  const info = await ollamaInfo(force)
  const source = await resolveSource()
  return {
    configured: source !== null,
    source,
    model: source === 'local' ? settings.ollamaModel : settings.aiModel,
    provider: settings.aiProvider,
    ollama: { ...info, selected: settings.ollamaModel, installed: hasModel(info, settings.ollamaModel), recommended: RECOMMENDED_MODELS, context: settings.aiContext, load: info.running ? await ollamaLoad() : null }
  }
}

let pulling = false
let benchmarking = false

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  currentWindow = getWindow
  handle(IPC.execute, (_e, capId: unknown, input: unknown): Promise<Result<unknown>> => {
    if (typeof capId !== 'string') return Promise.resolve({ ok: false, error: 'Ungültige Aktion.' })
    return execute(capId, input, 'ui')
  })
  handle(IPC.pickFolder, async () => {
    const win = getWindow()
    const r = win ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] }) : null
    return r && !r.canceled ? r.filePaths[0] ?? null : null
  })
  handle(IPC.openAuditLog, async () => {
    const p = auditPath()
    if (p) await shell.openPath(p)
  })
  handle(IPC.historyList, () => listHistory())
  handle(IPC.historyUndo, (_e, id: unknown) => (typeof id === 'number' ? undoHistory(id) : { ok: false, error: 'Ungültige ID.' }))
  handle(IPC.settingsGet, () => getSettings())
  handle(IPC.settingsSet, (_e, patch: unknown) => updateSettings((patch ?? {}) as Partial<Settings>))
  handle(IPC.aiStatus, () => aiStatus(true))
  // Kein frei wählbarer Text: Es wird ausschließlich der feste, angezeigte Installationsbefehl kopiert.
  handle(IPC.ollamaCopyCommand, () => { clipboard.writeText(OLLAMA_INSTALL_COMMAND) })
  // Öffnet nur ein leeres PowerShell-Fenster; eingefügt und ausgeführt wird vom Nutzer selbst.
  handle(IPC.openPowerShell, () => {
    if (process.platform !== 'win32') return
    spawn('cmd.exe', ['/c', 'start', '', 'powershell.exe'], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  })
  handle(IPC.ollamaBenchmark, async (): Promise<Result<Benchmark>> => {
    if (benchmarking) return { ok: false, error: 'Der Test läuft bereits.' }
    benchmarking = true
    try {
      const { ollamaModel, aiContext } = getSettings()
      return { ok: true, data: await benchmarkModel(ollamaModel, aiContext) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Test fehlgeschlagen.' }
    } finally {
      benchmarking = false
    }
  })
  handle(IPC.ollamaDownloadPage, async () => { await shell.openExternal('https://ollama.com/download') })
  handle(IPC.ollamaPull, async (event, model: unknown): Promise<Result<AiStatus>> => {
    if (typeof model !== 'string' || !isValidModelName(model)) return { ok: false, error: 'Ungültiger Modellname.' }
    if (pulling) return { ok: false, error: 'Es läuft bereits ein Download.' }
    pulling = true
    try {
      await pullModel(model, (p) => { if (!event.sender.isDestroyed()) event.sender.send(IPC.ollamaProgress, { model, ...p }) })
      updateSettings({ ollamaModel: model })
      return { ok: true, data: await aiStatus(true) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Download fehlgeschlagen.' }
    } finally {
      pulling = false
    }
  })
  handle(IPC.aiSetKey, (_e, key: unknown) => {
    setSessionKey(typeof key === 'string' && key.length < 300 ? key : null)
    return aiStatus()
  })
  handle(IPC.chatSend, (_e, text: unknown) => {
    if (typeof text !== 'string' || !text.trim() || text.length > 8000) return
    void chat(text.trim(), getWindow())
  })
  handle(IPC.chatCancel, () => cancelChat())
  handle(IPC.chatReset, () => resetChat())
  handle(IPC.confirmRespond, (_e, id: unknown, approved: unknown) => {
    if (typeof id === 'string') resolveConfirmation(id, approved === true)
  })
}
