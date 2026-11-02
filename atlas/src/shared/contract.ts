import type {
  AiStatus, CapId, CapIn, CapOut, ChatEvent, ConfirmRequest, HistoryEntry, PullProgress, Result, Settings
} from './types'

export * from './types'

/** Der offizielle Windows-Installationsbefehl von Ollama – wird in ATLAS angezeigt und kann kopiert werden. */
export const OLLAMA_INSTALL_COMMAND = 'irm https://ollama.com/install.ps1 | iex'

/** Alle IPC-Kanäle – mit „atlas:“-Präfix, damit nichts mit Nebula kollidiert. */
export const IPC = {
  execute: 'atlas:execute',
  pickFolder: 'atlas:pick-folder',
  openAuditLog: 'atlas:open-audit-log',
  historyList: 'atlas:history-list',
  historyUndo: 'atlas:history-undo',
  settingsGet: 'atlas:settings-get',
  settingsSet: 'atlas:settings-set',
  aiStatus: 'atlas:ai-status',
  aiSetKey: 'atlas:ai-set-key',
  ollamaPull: 'atlas:ollama-pull',
  ollamaProgress: 'atlas:ollama-progress',
  ollamaDownloadPage: 'atlas:ollama-download-page',
  ollamaCopyCommand: 'atlas:ollama-copy-command',
  openPowerShell: 'atlas:open-powershell',
  chatSend: 'atlas:chat-send',
  chatCancel: 'atlas:chat-cancel',
  chatReset: 'atlas:chat-reset',
  chatEvent: 'atlas:chat-event',
  confirmRequest: 'atlas:confirm-request',
  confirmRespond: 'atlas:confirm-respond'
} as const

export interface AtlasApi {
  call<K extends CapId>(id: K, input: CapIn<K>): Promise<Result<CapOut<K>>>
  pickFolder(): Promise<string | null>
  openAuditLog(): Promise<void>
  history: {
    list(): Promise<HistoryEntry[]>
    undo(id: number): Promise<Result<string>>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
  }
  ai: {
    status(): Promise<AiStatus>
    setKey(key: string | null): Promise<AiStatus>
    pullModel(model: string): Promise<Result<AiStatus>>
    onPullProgress(cb: (p: PullProgress) => void): () => void
    openOllamaDownload(): Promise<void>
    copyInstallCommand(): Promise<void>
    openPowerShell(): Promise<void>
  }
  chat: {
    send(text: string): Promise<void>
    cancel(): Promise<void>
    reset(): Promise<void>
    onEvent(cb: (e: ChatEvent) => void): () => void
  }
  confirm: {
    onRequest(cb: (r: ConfirmRequest) => void): () => void
    respond(id: string, approved: boolean): Promise<void>
  }
}
