/**
 * ATLAS als Modul innerhalb von Nebula.
 * Nebula ruft openAtlas() auf; ATLAS initialisiert sich beim ersten Öffnen
 * (Datenbank, Protokoll, IPC) und läuft in einem eigenen Fenster mit eigener,
 * abgeschotteter Sitzung. Den App-Lebenszyklus steuert weiterhin Nebula.
 */
import { app, BrowserWindow, session } from 'electron'
import { join } from 'path'
import { resolveSource } from './ai/anthropic'
import { cancelChat } from './ai/agents'
import { unloadModel, warmUpModel } from './ai/ollama'
import { setConfirmWindow } from './core/confirm'
import { getSettings } from './core/settings'
import { flushDb, openDb } from './core/db'
import { setAuditLog } from './core/execute'
import { setLogSink } from './core/log'
import { AuditLog } from './core/policy'
import { registerIpc } from './ipc'
import { setBridge, type NebulaBridge } from './services/system'

export interface AtlasOptions {
  icon?: string
  /** Nebulas fertige Messwerte – ATLAS fragt dort nach, statt alles doppelt zu messen. */
  providers?: NebulaBridge
  log?: (level: 'info' | 'warn' | 'error', message: string) => void
}

const PARTITION = 'persist:atlas'
const devUrl = process.env['ELECTRON_RENDERER_URL']
let atlasWindow: BrowserWindow | null = null
let ready: Promise<void> | null = null
let options: AtlasOptions = {}

const isAllowedNavigation = (url: string): boolean =>
  (devUrl !== undefined && url.startsWith(devUrl)) || url.startsWith('file://')

export function initAtlas(opts: AtlasOptions = {}): Promise<void> {
  options = { ...options, ...opts }
  setLogSink(options.log ?? null)
  setBridge(options.providers ?? null)
  if (!ready) {
    ready = (async () => {
      const userData = app.getPath('userData')
      await openDb(join(userData, 'atlas.sqlite'))
      setAuditLog(new AuditLog(join(userData, 'atlas-audit.log')))
      setConfirmWindow(() => atlasWindow)
      // Kamera, Mikrofon usw. bleiben für ATLAS gesperrt.
      session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
      registerIpc(() => atlasWindow)
      app.on('before-quit', () => { flushDb(); void releaseLocalAi().catch(() => undefined) })
      options.log?.('info', 'ATLAS initialisiert')
    })().catch((err: unknown) => {
      ready = null
      throw err
    })
  }
  return ready
}

/** Öffnet das ATLAS-Fenster oder holt es in den Vordergrund. */
export async function openAtlas(opts: AtlasOptions = {}): Promise<void> {
  await initAtlas(opts)
  if (atlasWindow && !atlasWindow.isDestroyed()) {
    if (atlasWindow.isMinimized()) atlasWindow.restore()
    atlasWindow.show()
    atlasWindow.focus()
    return
  }
  atlasWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    title: 'ATLAS – Nebula',
    icon: options.icon,
    backgroundColor: '#05071a',
    autoHideMenuBar: true,
    // Eigene Titelleiste: Die Fensterknöpfe von Windows liegen über der ATLAS-Statusleiste, kein grauer Rahmen.
    // Zum Zurückstellen auf den normalen Rahmen diese drei Zeilen entfernen.
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#0e1015', symbolColor: '#e8ebf0', height: 62 } }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  atlasWindow.once('ready-to-show', () => atlasWindow?.show())
  atlasWindow.on('closed', () => {
    atlasWindow = null
    flushDb()
    void releaseLocalAi().catch(() => undefined)
  })
  atlasWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  atlasWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault()
  })
  void warmUpLocalAi().catch(() => undefined)
  if (devUrl) await atlasWindow.loadURL(devUrl)
  else await atlasWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

/** Lädt die lokale KI vor, damit die erste Frage schnell beantwortet wird. */
async function warmUpLocalAi(): Promise<void> {
  if ((await resolveSource()) !== 'local') return
  const { ollamaModel, aiContext } = getSettings()
  options.log?.('info', 'Lokale KI wird vorgeladen …')
  await warmUpModel(ollamaModel, aiContext)
}

/** ATLAS ist zu: laufende Aufgaben abbrechen und das lokale Modell aus dem Speicher nehmen. */
async function releaseLocalAi(): Promise<void> {
  cancelChat()
  if (await unloadModel(getSettings().ollamaModel)) options.log?.('info', 'Lokale KI aus dem Speicher genommen')
}

export function isAtlasOpen(): boolean {
  return !!atlasWindow && !atlasWindow.isDestroyed()
}
