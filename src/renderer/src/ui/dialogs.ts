import type { Translate } from '../../../shared/i18n'
import { type WavFormat, WAV_FORMATS } from '../audio/wav'
import { h } from './dom'

export interface NumberPrompt {
  title: string
  label: string
  help: string
  value: number
  min: number
  max: number
  step: number
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

  promptNumber(prompt: NumberPrompt): Promise<number | null> {
    const input = h('input', {
      type: 'number',
      class: 'input',
      value: prompt.value,
      min: prompt.min,
      max: prompt.max,
      step: prompt.step,
      required: true,
      id: 'dialog-number'
    })
    const error = h('p', { class: 'dialog-error', hidden: true, role: 'alert' })
    return this.open<number>(
      prompt.title,
      [
        h('label', { class: 'field-label', for: 'dialog-number' }, prompt.label),
        input,
        h('p', { class: 'dialog-help' }, prompt.help),
        error
      ],
      () => {
        const value = Number(input.value)
        if (input.value.trim() === '' || !Number.isFinite(value) || value < prompt.min || value > prompt.max) {
          error.textContent = this.t('dialog.invalidNumber', { min: prompt.min, max: prompt.max })
          error.hidden = false
          input.focus()
          return undefined
        }
        return value
      },
      this.t('dialog.apply'),
      input
    )
  }

  chooseWavFormat(current: WavFormat): Promise<WavFormat | null> {
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
    return this.open<WavFormat>(
      this.t('dialog.export.title'),
      [fieldset],
      () => {
        const checked = fieldset.querySelector<HTMLInputElement>('input[name="wav-format"]:checked')
        return (checked?.value as WavFormat | undefined) ?? current
      },
      this.t('dialog.export.continue'),
      fieldset.querySelector<HTMLInputElement>('input:checked') ?? undefined
    )
  }

  private open<T>(
    title: string,
    body: Node[],
    submit: () => T | undefined,
    submitLabel: string,
    focusTarget?: HTMLElement
  ): Promise<T | null> {
    return new Promise((resolve) => {
      const cancel = h('button', { type: 'button', class: 'btn' }, this.t('dialog.cancel'))
      const confirm = h('button', { type: 'submit', class: 'btn btn-primary' }, submitLabel)
      const form = h(
        'form',
        { method: 'dialog', class: 'dialog-body', novalidate: true },
        h('h2', { class: 'dialog-title' }, title),
        ...body,
        h('div', { class: 'dialog-actions' }, cancel, confirm)
      )
      const dialog = h('dialog', { class: 'dialog', 'aria-label': title }, form)
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
      ;(focusTarget ?? confirm).focus()
      if (focusTarget instanceof HTMLInputElement && focusTarget.type === 'number') focusTarget.select()
    })
  }
}
