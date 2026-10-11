import type { Translate } from '../../../shared/i18n'
import { type WavFormat, WAV_FORMATS } from '../audio/wav'
import { h } from './dom'

export interface ExportChoice {
  format: WavFormat
  preventClipping: boolean
}

export interface HelpSection {
  title: string
  text: string
}

export interface ShortcutHelp {
  keys: string
  action: string
}

/** In-app modal dialogs built on <dialog>, so they follow the app language and theme. */
export class Dialogs {
  constructor(
    private readonly root: HTMLElement,
    private readonly t: Translate
  ) {}

  get isOpen(): boolean {
    return this.root.querySelector('dialog[open]') !== null
  }

  /** Asks how to export the merged layers: WAV format and clipping protection. */
  chooseExport(current: WavFormat, summary: string): Promise<ExportChoice | null> {
    const options = WAV_FORMATS.map((format) => {
      const radio = h('input', {
        type: 'radio',
        name: 'wav-format',
        value: format,
        checked: format === current
      })
      return h('label', { class: 'choice' }, radio, h('span', {}, this.t(`format.${format}`)))
    })
    const fieldset = h(
      'fieldset',
      { class: 'choices' },
      h('legend', { class: 'field-label' }, this.t('dialog.export.format')),
      ...options
    )
    const protect = h('input', { type: 'checkbox', checked: true, id: 'dialog-protect' })
    return this.open<ExportChoice>(
      this.t('dialog.export.title'),
      [
        h('p', { class: 'dialog-help', 'data-testid': 'export-summary' }, summary),
        fieldset,
        h(
          'label',
          { class: 'check', for: 'dialog-protect' },
          protect,
          h('span', {}, this.t('dialog.export.protect'))
        )
      ],
      () => {
        const checked = fieldset.querySelector<HTMLInputElement>('input[name="wav-format"]:checked')
        return { format: (checked?.value as WavFormat | undefined) ?? current, preventClipping: protect.checked }
      },
      this.t('dialog.export.continue'),
      fieldset.querySelector<HTMLInputElement>('input:checked') ?? undefined
    )
  }

  /** The "How to use" guide with keyboard shortcuts. */
  showHelp(title: string, sections: HelpSection[], shortcuts: ShortcutHelp[]): Promise<void> {
    const steps = h(
      'ol',
      { class: 'help-steps' },
      ...sections.map((section) =>
        h('li', {}, h('strong', {}, section.title), h('span', {}, section.text))
      )
    )
    const table = h(
      'table',
      { class: 'help-shortcuts' },
      h(
        'tbody',
        {},
        ...shortcuts.map((shortcut) =>
          h('tr', {}, h('td', {}, h('kbd', {}, shortcut.keys)), h('td', {}, shortcut.action))
        )
      )
    )
    return this.open<true>(
      title,
      [steps, h('h3', { class: 'help-subtitle' }, this.t('help.shortcuts')), table],
      () => true,
      this.t('help.close'),
      undefined,
      { wide: true, cancel: false }
    ).then(() => undefined)
  }

  private open<T>(
    title: string,
    body: Node[],
    submit: () => T | undefined,
    submitLabel: string,
    focusTarget?: HTMLElement,
    options: { wide?: boolean; cancel?: boolean } = {}
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const cancel = h('button', { type: 'button', class: 'btn' }, this.t('dialog.cancel'))
      const confirm = h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel)
      const form = h(
        'form',
        { method: 'dialog', class: 'dialog-body', novalidate: true },
        h('h2', { class: 'dialog-title' }, title),
        ...body,
        h('div', { class: 'dialog-actions' }, options.cancel === false ? null : cancel, confirm)
      )
      const dialog = h('dialog', { class: options.wide ? 'dialog dialog-wide' : 'dialog', 'aria-label': title }, form)
      let settled = false
      const finish = (value: T | null): void => {
        if (settled) return
        settled = true
        dialog.close()
        dialog.remove()
        resolve(value)
      }
      form.addEventListener('submit', (event) => {
        event.preventDefault()
        const value = submit()
        if (value !== undefined) finish(value)
      })
      cancel.addEventListener('click', () => finish(null))
      dialog.addEventListener('cancel', (event) => {
        event.preventDefault()
        finish(null)
      })
      this.root.append(dialog)
      dialog.showModal()
      ;(focusTarget ?? confirm).focus({ preventScroll: true })
      dialog.scrollTop = 0
    })
  }
}
