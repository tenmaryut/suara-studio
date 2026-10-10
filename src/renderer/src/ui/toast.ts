import { h } from './dom'

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface ToastOptions {
  kind?: ToastKind
  /** Milliseconds before the toast closes itself; 0 keeps it open. */
  timeout?: number
  action?: { label: string; run: () => void }
  dismissLabel: string
}

export class Toaster {
  readonly element = h('div', { class: 'toasts', role: 'region', 'aria-live': 'polite' })

  show(message: string, options: ToastOptions): () => void {
    const kind = options.kind ?? 'info'
    const toast = h(
      'div',
      { class: `toast toast-${kind}`, role: kind === 'error' ? 'alert' : 'status' },
      h('span', { class: 'toast-message' }, message)
    )
    let timer: number | undefined
    const close = (): void => {
      if (timer !== undefined) window.clearTimeout(timer)
      toast.remove()
    }
    if (options.action) {
      const action = h('button', { type: 'button', class: 'btn btn-link' }, options.action.label)
      action.addEventListener('click', () => {
        options.action!.run()
        close()
      })
      toast.append(action)
    }
    const dismiss = h(
      'button',
      { type: 'button', class: 'toast-close', 'aria-label': options.dismissLabel, title: options.dismissLabel },
      '×'
    )
    dismiss.addEventListener('click', close)
    toast.append(dismiss)
    this.element.append(toast)
    const timeout = options.timeout ?? (kind === 'error' ? 8000 : 4000)
    if (timeout > 0) timer = window.setTimeout(close, timeout)
    return close
  }
}
