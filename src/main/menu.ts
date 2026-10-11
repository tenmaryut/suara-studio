import { Menu, type MenuItemConstructorOptions, app, shell } from 'electron'
import { ISSUES_URL, REPO_URL } from '../shared/app-info'
import { EFFECTS, EFFECT_CATEGORIES } from '../shared/effects'
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
const withLayers: Rule = (s) => idle(s) && s.hasLayers
const withSelection: Rule = (s) => idle(s) && s.hasSelection

/** Enabled-state rules for menu items, keyed by MenuCommand (also used as the item id). */
const RULES: Partial<Record<MenuCommand, Rule>> = {
  'file.new': idle,
  'file.open': idle,
  'file.import': idle,
  'file.save': withLayers,
  'file.saveAs': withLayers,
  'file.export': withAudio,
  'edit.undo': (s) => s.canUndo,
  'edit.redo': (s) => s.canRedo,
  'edit.cut': withSelection,
  'edit.copy': withSelection,
  'edit.paste': (s) => s.canPaste,
  'edit.delete': withSelection,
  'edit.selectAll': withAudio,
  'edit.trim': withSelection,
  'layer.add': idle,
  'layer.record': idle,
  'layer.duplicate': withLayers,
  'layer.remove': withLayers,
  'layer.previous': withLayers,
  'layer.next': withLayers,
  'effects.open': withAudio,
  ...Object.fromEntries(EFFECTS.map((effect) => [`effect.${effect.id}`, withAudio])),
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

  const effectItems: MenuItemConstructorOptions[] = [item('menu.effectsPanel', 'effects.open', 'CmdOrCtrl+Shift+E')]
  for (const category of EFFECT_CATEGORIES) {
    effectItems.push(separator)
    for (const effect of EFFECTS.filter((candidate) => candidate.category === category)) {
      effectItems.push(item(`fx.${effect.id}.name`, `effect.${effect.id}`))
    }
  }

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
        item('menu.import', 'file.import', 'CmdOrCtrl+I'),
        separator,
        item('menu.save', 'file.save', 'CmdOrCtrl+S'),
        item('menu.saveAs', 'file.saveAs', 'Shift+CmdOrCtrl+S'),
        separator,
        item('menu.export', 'file.export', 'CmdOrCtrl+E'),
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
      label: t('menu.layer'),
      submenu: [
        item('menu.layerAdd', 'layer.add', 'Shift+CmdOrCtrl+N'),
        item('menu.layerRecord', 'layer.record', 'Shift+CmdOrCtrl+R'),
        item('menu.import', 'file.import'),
        separator,
        item('menu.layerDuplicate', 'layer.duplicate', 'CmdOrCtrl+D'),
        item('menu.layerRemove', 'layer.remove'),
        separator,
        // Up and Down arrows also work in the page.
        item('menu.layerPrevious', 'layer.previous'),
        item('menu.layerNext', 'layer.next')
      ]
    },
    {
      label: t('menu.effects'),
      submenu: effectItems
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
        { ...item('menu.guide', 'help.guide', 'F1'), enabled: true },
        separator,
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
