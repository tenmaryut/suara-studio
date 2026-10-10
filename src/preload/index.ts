import { type IpcRendererEvent, contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannel, type MenuCommand, type SuaraApi, type UpdateInfo } from '../shared/ipc'

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T): void => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const api: SuaraApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.appInfo),
  openAudioFile: () => ipcRenderer.invoke(IpcChannel.openFile),
  openDroppedFile: (file) => ipcRenderer.invoke(IpcChannel.openDroppedFile, webUtils.getPathForFile(file)),
  saveAudioFile: (request) => ipcRenderer.invoke(IpcChannel.saveFile, request),
  requestMicrophoneAccess: () => ipcRenderer.invoke(IpcChannel.requestMic),
  confirmDiscardChanges: (documentName) => ipcRenderer.invoke(IpcChannel.confirmDiscard, documentName),
  setDocumentState: (state) => ipcRenderer.send(IpcChannel.documentState, state),
  onMenuCommand: (listener) => subscribe<MenuCommand>(IpcChannel.menuCommand, listener),
  onUpdateAvailable: (listener) => subscribe<UpdateInfo>(IpcChannel.updateAvailable, listener),
  openReleasePage: (url) => ipcRenderer.invoke(IpcChannel.openRelease, url),
  editText: (action) => ipcRenderer.send(IpcChannel.editText, action),
  confirmClose: () => ipcRenderer.send(IpcChannel.confirmClose)
}

contextBridge.exposeInMainWorld('suara', api)
