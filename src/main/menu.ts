import { Menu, type MenuItemConstructorOptions, app, shell } from 'electron'
import { ISSUES_URL, REPO_URL } from '../shared/app-info'
import type { MessageKey, Translate } from '../shared/i18n'
import type { DocumentState, MenuCommand } from '../shared/ipc'

export interface MenuHandlers {
  command(command: MenuCommand): void
  checkForUpdates(): void
  about(): void
}

type Rule = (state: DocumentState) => boolean

const idle: Rule = (s) => !s.isRecording
const withAudio: Rule = (s) => idle(s) && s.hasAudio
const withSelection: Rule = (s) => idle(s) && s.hasSelection

/** Enabled-state rules for menu items, keyed by MenuCommand (also used as the item id). */
const RULES: Partial<Record<MenuCommand, Rule>> = {
  'file.new': idle,
  'file.open': idle,
  'file.save': withAudio,
  'file.saveAs': withAudio,
  'edit.undo': (s) => s.canUndo,
  'edit.redo': (s) => s.canRedo,
  'edit.cut': withSelection,
  'edit.copy': withSelection,
  'edit.paste': (s) => s.canPaste,
  'edit.delete': withSelection,
  'edit.selectAll': withAudio,
  'edit.trim': withSelection,
  'effect.fadeIn': withAudio,
  'effect.fadeOut': withAudio,
  'effect.normalize': withAudio,
  'effect.amplify': withAudio,
  'effect.silence': withAudio,
  'effect.reverse': withAudio,
  'transport.playPause': withAudio,
  'transport.stop': withAudio,
  'view.zoomIn': (s) => s.hasAudio,
  'view.zoomOut': (s) => s.hasAudio,
  'view.zoomFit': (s) => s.hasAudio
}

export function buildMenu(t: Translate, handlers: MenuHandlers, devTools: boolean): Menu {
  const isMac = process.platform === 'darwin'
  const item = (
    label: MessageKey,
    command: MenuCommand,
    accelerator?: string
  ): MenuItemConstructorOptions => ({
    id: command,
    label: t(label),
    accelerator,
    enabled: false,
    click: () => handlers.command(command)
  })
  const separator: MenuItemConstructorOptions = { type: 'separator' }

  const template: MenuItemConstructorOptions[] = []
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { label: t('menu.about'), click: () => handlers.about() },
        { label: t('menu.checkUpdates'), click: () => handlers.checkForUpdates() },
        separator,
        { role: 'services', label: t('menu.services') },
        separator,
        { role: 'hide', label: t('menu.hide') },
        { role: 'hideOthers', label: t('menu.hideOthers') },
        { role: 'unhide', label: t('menu.showAll') },
        separator,
        { role: 'quit', label: t('menu.quit') }
      ]
    })
  }
  template.push(
    {
      label: t('menu.file'),
      submenu: [
        item('menu.new', 'file.new', 'CmdOrCtrl+N'),
        item('menu.open', 'file.open', 'CmdOrCtrl+O'),
        separator,
        item('menu.save', 'file.save', 'CmdOrCtrl+S'),
        item('menu.saveAs', 'file.saveAs', 'Shift+CmdOrCtrl+S'),
        ...(isMac ? [] : [separator, { role: 'quit', label: t('menu.quit') } as MenuItemConstructorOptions])
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        item('menu.undo', 'edit.undo', 'CmdOrCtrl+Z'),
        item('menu.redo', 'edit.redo', 'Shift+CmdOrCtrl+Z'),
        separator,
        item('menu.cut', 'edit.cut', 'CmdOrCtrl+X'),
        item('menu.copy', 'edit.copy', 'CmdOrCtrl+C'),
        item('menu.paste', 'edit.paste', 'CmdOrCtrl+V'),
        item('menu.delete', 'edit.delete'),
        item('menu.selectAll', 'edit.selectAll', 'CmdOrCtrl+A'),
        separator,
        item('menu.trim', 'edit.trim', 'CmdOrCtrl+T')
      ]
    },
    {
      label: t('menu.effects'),
      submenu: [
        item('menu.fadeIn', 'effect.fadeIn'),
        item('menu.fadeOut', 'effect.fadeOut'),
        separator,
        item('menu.normalize', 'effect.normalize'),
        item('menu.amplify', 'effect.amplify'),
        separator,
        item('menu.silence', 'effect.silence'),
        item('menu.reverse', 'effect.reverse')
      ]
    },
    {
      label: t('menu.controls'),
      submenu: [
        // Space and Esc are handled by the page so they never steal keys from text fields.
        item('menu.playPause', 'transport.playPause'),
        item('menu.stop', 'transport.stop'),
        { ...item('menu.record', 'transport.record', 'CmdOrCtrl+R'), enabled: true }
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        item('menu.zoomIn', 'view.zoomIn', 'CmdOrCtrl+='),
        item('menu.zoomOut', 'view.zoomOut', 'CmdOrCtrl+-'),
        item('menu.zoomFit', 'view.zoomFit', 'CmdOrCtrl+0'),
        separator,
        { role: 'togglefullscreen', label: t('menu.fullscreen') },
        ...(devTools ? [{ role: 'toggleDevTools', label: t('menu.devtools') } as MenuItemConstructorOptions] : [])
      ]
    },
    {
      role: 'windowMenu',
      label: t('menu.window')
    },
    {
      role: 'help',
      label: t('menu.help'),
      submenu: [
        { label: t('menu.website'), click: () => void shell.openExternal(REPO_URL) },
        { label: t('menu.reportIssue'), click: () => void shell.openExternal(ISSUES_URL) },
        ...(isMac
          ? []
          : [
              separator,
              { label: t('menu.checkUpdates'), click: () => handlers.checkForUpdates() },
              { label: t('menu.about'), click: () => handlers.about() }
            ])
      ]
    }
  )
  return Menu.buildFromTemplate(template)
}

/** Enables or disables menu items to match the editor. */
export function applyMenuState(menu: Menu, state: DocumentState): void {
  for (const [command, rule] of Object.entries(RULES) as [MenuCommand, Rule][]) {
    const menuItem = menu.getMenuItemById(command)
    if (menuItem) menuItem.enabled = rule(state)
  }
}
