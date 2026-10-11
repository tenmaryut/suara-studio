import type { EffectId } from './effects'
import type { Locale } from './i18n'

export const IpcChannel = {
  appInfo: 'app:info',
  openFile: 'file:open',
  openDroppedFile: 'file:open-dropped',
  saveFile: 'file:save',
  requestMic: 'mic:request',
  confirmDiscard: 'doc:confirm-discard',
  documentState: 'doc:state',
  menuCommand: 'menu:command',
  editText: 'edit:text',
  confirmClose: 'window:confirm-close',
  updateAvailable: 'update:available',
  openRelease: 'shell:open-release'
} as const

export type MenuCommand =
  | 'file.new'
  | 'file.open'
  | 'file.import'
  | 'file.save'
  | 'file.saveAs'
  | 'file.saveAndClose'
  | 'file.export'
  | 'edit.undo'
  | 'edit.redo'
  | 'edit.cut'
  | 'edit.copy'
  | 'edit.paste'
  | 'edit.delete'
  | 'edit.selectAll'
  | 'edit.trim'
  | 'layer.add'
  | 'layer.record'
  | 'layer.duplicate'
  | 'layer.remove'
  | 'layer.previous'
  | 'layer.next'
  | 'effects.open'
  | `effect.${EffectId}`
  | 'transport.playPause'
  | 'transport.stop'
  | 'transport.record'
  | 'view.zoomIn'
  | 'view.zoomOut'
  | 'view.zoomFit'
  | 'help.guide'

export type TextEditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'delete' | 'selectAll'

export interface AppInfo {
  version: string
  platform: string
  locale: Locale
}

export interface OpenedFile {
  path: string
  name: string
  data: ArrayBuffer
}

/** Which files an open or save dialog offers: projects and audio, or audio only. */
export type FileKind = 'project' | 'audio'

export interface SaveRequest {
  kind: FileKind
  data: ArrayBuffer
  suggestedName: string
  /** Overwrite this path without asking. Only honoured for paths the user opened or saved earlier. */
  path?: string
}

export interface SavedFile {
  path: string
  name: string
}

export type MicAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

export type DiscardChoice = 'save' | 'discard' | 'cancel'

/** Editor state mirrored to the main process for menus, the window title and the close guard. */
export interface DocumentState {
  title: string
  dirty: boolean
  filePath: string | null
  hasAudio: boolean
  hasLayers: boolean
  hasSelection: boolean
  canUndo: boolean
  canRedo: boolean
  canPaste: boolean
  isRecording: boolean
}

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  url: string
}

export interface SuaraApi {
  getAppInfo(): Promise<AppInfo>
  /** Shows an open dialog; 'project' offers projects and audio files, 'audio' audio files only. */
  openFile(kind: FileKind): Promise<OpenedFile | null>
  openDroppedFile(file: File): Promise<OpenedFile>
  saveFile(request: SaveRequest): Promise<SavedFile | null>
  requestMicrophoneAccess(): Promise<MicAccess>
  confirmDiscardChanges(documentName: string): Promise<DiscardChoice>
  setDocumentState(state: DocumentState): void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
  onUpdateAvailable(listener: (info: UpdateInfo) => void): () => void
  openReleasePage(url: string): Promise<void>
  editText(action: TextEditAction): void
  confirmClose(): void
}
