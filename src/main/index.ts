import {
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  Menu,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
  systemPreferences
} from 'electron'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { APP_ORIGIN, RELEASES_URL } from '../shared/app-info'
import { type Locale, type Translate, createTranslator, resolveLocale } from '../shared/i18n'
import {
  type AppInfo,
  type DiscardChoice,
  type DocumentState,
  IpcChannel,
  type MenuCommand,
  type MicAccess,
  type OpenedFile,
  type SaveRequest,
  type SavedFile,
  type TextEditAction
} from '../shared/ipc'
import { isNewerVersion } from '../shared/version'
import { applyMenuState, buildMenu } from './menu'
import { isAppUrl, registerAppScheme, serveRenderer } from './protocol'
import { fetchLatestRelease } from './updates'

const APP_USER_MODEL_ID = 'io.github.tenmaryut.suarastudio'
const OPENABLE_EXTENSIONS = ['wav', 'wave', 'mp3', 'm4a', 'aac', 'mp4', 'flac', 'ogg', 'oga', 'opus', 'webm']
const MAX_OPEN_BYTES = 2 * 1024 ** 3
const TEXT_ACTIONS: readonly TextEditAction[] = ['undo', 'redo', 'cut', 'copy', 'paste', 'delete', 'selectAll']

const devServerUrl = !app.isPackaged ? (process.env['ELECTRON_RENDERER_URL'] ?? null) : null
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null

let mainWindow: BrowserWindow | null = null
let appMenu: Menu | null = null
let locale: Locale = 'en'
let t: Translate = createTranslator('en')
let documentState: DocumentState = {
  title: '',
  dirty: false,
  filePath: null,
  hasAudio: false,
  hasSelection: false,
  canUndo: false,
  canRedo: false,
  canPaste: false,
  isRecording: false
}
let allowClose = false
let quitRequested = false
let lastDirectory: string | null = null
/** Files the user picked or saved; only these may be overwritten without a save dialog. */
const knownPaths = new Set<string>()

registerAppScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(start).catch((error: unknown) => {
    console.error(error)
    app.exit(1)
  })
}

function start(): void {
  if (process.platform === 'win32') app.setAppUserModelId(APP_USER_MODEL_ID)
  locale = resolveLocale(app.getLocale())
  t = createTranslator(locale)
  serveRenderer(join(__dirname, '../renderer'))
  configurePermissions()
  registerIpc()
  appMenu = buildMenu(
    t,
    { command: sendCommand, checkForUpdates: () => void checkForUpdates(true), about: showAbout },
    !app.isPackaged
  )
  applyMenuState(appMenu, documentState)
  Menu.setApplicationMenu(appMenu)
  createWindow()
  if (app.isPackaged && !process.env['SUARA_DISABLE_UPDATE_CHECK']) {
    setTimeout(() => void checkForUpdates(false), 5000)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('before-quit', () => {
  quitRequested = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, devOrigin)) event.preventDefault()
  })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-attach-webview', (event) => event.preventDefault())
})

function createWindow(): void {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build/icon.png')
  const window = new BrowserWindow({
    width: 1200,
    height: 760,
    minWidth: 760,
    minHeight: 480,
    show: false,
    title: 'Suara Studio',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e1015' : '#eef0f4',
    icon: process.platform === 'linux' ? iconPath : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })
  mainWindow = window
  allowClose = false
  window.once('ready-to-show', () => window.show())
  window.on('close', (event) => {
    if (allowClose) return
    if (documentState.isRecording) {
      // Keep the take: finish the recording first; closing again then offers to save it.
      event.preventDefault()
      quitRequested = false
      sendCommand('transport.record')
      return
    }
    if (!documentState.dirty) return
    event.preventDefault()
    const choice = dialog.showMessageBoxSync(window, {
      type: 'warning',
      buttons: [t('dialog.save'), t('dialog.dontSave'), t('dialog.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: t('dialog.unsaved.message', { name: documentState.title }),
      detail: t('dialog.unsaved.detail')
    })
    if (choice === 0) {
      window.webContents.send(IpcChannel.menuCommand, 'file.saveAndClose' satisfies MenuCommand)
    } else if (choice === 1) {
      allowClose = true
      window.close()
    } else {
      quitRequested = false
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
  if (devServerUrl) void window.loadURL(devServerUrl)
  else void window.loadURL(`${APP_ORIGIN}/index.html`)
}

function sendCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IpcChannel.menuCommand, command)
}

// ---- Permissions -------------------------------------------------------------------------

function configurePermissions(): void {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    if (permission === 'media' && isAppUrl(details.requestingUrl, devOrigin)) {
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      callback(mediaTypes.length > 0 && mediaTypes.every((type) => type === 'audio'))
      return
    }
    callback(false)
  })
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    if (permission !== 'media' || !isAppUrl(requestingOrigin, devOrigin)) return false
    return (details as { mediaType?: string }).mediaType !== 'video'
  })
}

async function microphoneAccess(): Promise<MicAccess> {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'not-determined') {
      return (await systemPreferences.askForMediaAccess('microphone')) ? 'granted' : 'denied'
    }
    return status
  }
  if (process.platform === 'win32') {
    const status = systemPreferences.getMediaAccessStatus('microphone')
    return status === 'denied' ? 'denied' : 'granted'
  }
  return 'granted'
}

// ---- IPC -------------------------------------------------------------------------------------

function assertTrusted(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow {
  const url = event.senderFrame?.url ?? ''
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || !isAppUrl(url, devOrigin)) throw new Error('Untrusted IPC sender')
  return window
}

function registerIpc(): void {
  ipcMain.handle(IpcChannel.appInfo, (event): AppInfo => {
    assertTrusted(event)
    return { version: app.getVersion(), platform: process.platform, locale }
  })

  ipcMain.handle(IpcChannel.openFile, async (event): Promise<OpenedFile | null> => {
    const window = assertTrusted(event)
    const result = await dialog.showOpenDialog(window, {
      defaultPath: lastDirectory ?? undefined,
      properties: ['openFile'],
      filters: [
        { name: t('filter.audio'), extensions: OPENABLE_EXTENSIONS },
        { name: t('filter.all'), extensions: ['*'] }
      ]
    })
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    return readAudioFile(path)
  })

  ipcMain.handle(IpcChannel.openDroppedFile, async (event, path: unknown): Promise<OpenedFile> => {
    assertTrusted(event)
    if (typeof path !== 'string' || path === '') throw new Error('Invalid file')
    const extension = extname(path).slice(1).toLowerCase()
    if (!OPENABLE_EXTENSIONS.includes(extension)) throw new Error('Unsupported file type')
    return readAudioFile(path)
  })

  ipcMain.handle(IpcChannel.saveFile, async (event, request: unknown): Promise<SavedFile | null> => {
    const window = assertTrusted(event)
    const { data, suggestedName, path } = (request ?? {}) as Partial<SaveRequest>
    if (!(data instanceof ArrayBuffer) || typeof suggestedName !== 'string') {
      throw new Error('Invalid save request')
    }
    let target = typeof path === 'string' && knownPaths.has(path) ? path : null
    if (!target) {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: join(lastDirectory ?? defaultDirectory(), sanitizeFileName(suggestedName)),
        filters: [{ name: t('filter.wav'), extensions: ['wav'] }]
      })
      if (result.canceled || !result.filePath) return null
      target = extname(result.filePath).toLowerCase() === '.wav' ? result.filePath : `${result.filePath}.wav`
    }
    await writeFileAtomic(target, Buffer.from(data))
    knownPaths.add(target)
    lastDirectory = dirname(target)
    return { path: target, name: basename(target) }
  })

  ipcMain.handle(IpcChannel.requestMic, (event) => {
    assertTrusted(event)
    return microphoneAccess()
  })

  ipcMain.handle(IpcChannel.confirmDiscard, async (event, name: unknown): Promise<DiscardChoice> => {
    const window = assertTrusted(event)
    const { response } = await dialog.showMessageBox(window, {
      type: 'warning',
      buttons: [t('dialog.save'), t('dialog.dontSave'), t('dialog.cancel')],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
      message: t('dialog.unsaved.message', { name: typeof name === 'string' ? name : t('dialog.untitled') }),
      detail: t('dialog.unsaved.detail')
    })
    return (['save', 'discard', 'cancel'] as const)[response] ?? 'cancel'
  })

  ipcMain.on(IpcChannel.documentState, (event, state: DocumentState) => {
    const window = assertTrusted(event)
    if (!state || typeof state !== 'object') return
    documentState = state
    if (appMenu) applyMenuState(appMenu, state)
    if (process.platform === 'darwin') {
      window.setDocumentEdited(state.dirty)
      window.setRepresentedFilename(state.filePath ?? '')
    }
  })

  ipcMain.on(IpcChannel.editText, (event, action: unknown) => {
    assertTrusted(event)
    if (!TEXT_ACTIONS.includes(action as TextEditAction)) return
    const contents = event.sender
    switch (action as TextEditAction) {
      case 'undo':
        return contents.undo()
      case 'redo':
        return contents.redo()
      case 'cut':
        return contents.cut()
      case 'copy':
        return contents.copy()
      case 'paste':
        return contents.paste()
      case 'delete':
        return contents.delete()
      case 'selectAll':
        return contents.selectAll()
    }
  })

  ipcMain.on(IpcChannel.confirmClose, (event) => {
    const window = assertTrusted(event)
    allowClose = true
    window.close()
    if (quitRequested) app.quit()
  })

  ipcMain.handle(IpcChannel.openRelease, async (event, url: unknown) => {
    assertTrusted(event)
    if (typeof url === 'string' && (url === RELEASES_URL || url.startsWith(`${RELEASES_URL}/`))) {
      await shell.openExternal(url)
    }
  })
}

// ---- Files -------------------------------------------------------------------------------------

async function readAudioFile(path: string): Promise<OpenedFile> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Not a file')
  if (info.size > MAX_OPEN_BYTES) throw new Error('File is too large')
  const buffer = await readFile(path)
  knownPaths.add(path)
  lastDirectory = dirname(path)
  return {
    path,
    name: basename(path),
    data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  }
}

async function writeFileAtomic(path: string, data: Buffer): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporary, data)
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  return cleaned === '' || cleaned === '.wav' ? 'recording.wav' : cleaned
}

function defaultDirectory(): string {
  for (const name of ['music', 'documents', 'home'] as const) {
    try {
      return app.getPath(name)
    } catch {
      // Not every platform defines every folder.
    }
  }
  return '.'
}

// ---- Updates and about ------------------------------------------------------------------------

async function checkForUpdates(interactive: boolean): Promise<void> {
  const current = app.getVersion()
  try {
    const latest = await fetchLatestRelease()
    const newer = isNewerVersion(latest.version, current)
    if (!interactive) {
      if (newer) {
        mainWindow?.webContents.send(IpcChannel.updateAvailable, {
          currentVersion: current,
          latestVersion: latest.version,
          url: latest.url
        })
      }
      return
    }
    if (newer) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        buttons: [t('update.viewRelease'), t('update.later')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: t('update.available', { version: latest.version }),
        detail: t('update.availableDetail', { current })
      })
      if (response === 0) await shell.openExternal(latest.url)
    } else {
      await dialog.showMessageBox({
        type: 'info',
        buttons: [t('dialog.ok')],
        message: t('update.upToDate'),
        detail: t('update.upToDateDetail', { version: current })
      })
    }
  } catch {
    if (!interactive) return
    await dialog.showMessageBox({
      type: 'warning',
      buttons: [t('dialog.ok')],
      message: t('update.error'),
      detail: t('update.errorDetail')
    })
  }
}

function showAbout(): void {
  void dialog.showMessageBox({
    type: 'info',
    buttons: [t('dialog.ok')],
    title: t('menu.about'),
    message: 'Suara Studio',
    detail: t('about.detail', { version: app.getVersion() })
  })
}
