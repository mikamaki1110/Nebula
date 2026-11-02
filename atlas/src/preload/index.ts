import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC, type AtlasApi, type ChatEvent, type ConfirmRequest, type PullProgress } from '@shared/contract'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** Die Oberfläche sieht nur diese schmale, typisierte API – kein Node, kein ipcRenderer. */
const api: AtlasApi = {
  call: (id, input) => ipcRenderer.invoke(IPC.execute, id, input),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  openAuditLog: () => ipcRenderer.invoke(IPC.openAuditLog),
  history: {
    list: () => ipcRenderer.invoke(IPC.historyList),
    undo: (id) => ipcRenderer.invoke(IPC.historyUndo, id)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch)
  },
  ai: {
    status: () => ipcRenderer.invoke(IPC.aiStatus),
    setKey: (key) => ipcRenderer.invoke(IPC.aiSetKey, key),
    pullModel: (model) => ipcRenderer.invoke(IPC.ollamaPull, model),
    onPullProgress: (cb) => subscribe<PullProgress>(IPC.ollamaProgress, cb),
    openOllamaDownload: () => ipcRenderer.invoke(IPC.ollamaDownloadPage),
    copyInstallCommand: () => ipcRenderer.invoke(IPC.ollamaCopyCommand),
    benchmark: () => ipcRenderer.invoke(IPC.ollamaBenchmark),
    openPowerShell: () => ipcRenderer.invoke(IPC.openPowerShell)
  },
  chat: {
    send: (text) => ipcRenderer.invoke(IPC.chatSend, text),
    cancel: () => ipcRenderer.invoke(IPC.chatCancel),
    reset: () => ipcRenderer.invoke(IPC.chatReset),
    onEvent: (cb) => subscribe<ChatEvent>(IPC.chatEvent, cb)
  },
  confirm: {
    onRequest: (cb) => subscribe<ConfirmRequest>(IPC.confirmRequest, cb),
    respond: (id, approved) => ipcRenderer.invoke(IPC.confirmRespond, id, approved)
  }
}

contextBridge.exposeInMainWorld('atlas', api)
