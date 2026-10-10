import { type IconNode, createElement } from 'lucide'

type Child = Node | string | null | undefined | false

type Attributes = Record<string, string | number | boolean | null | undefined>

/** Small DOM builder: h('button', { class: 'x', title: 'y' }, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue
    element.setAttribute(name, value === true ? '' : String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    element.append(child)
  }
  return element
}

export function icon(node: IconNode, size = 18): SVGElement {
  return createElement(node, {
    width: size,
    height: size,
    'stroke-width': 2,
    'aria-hidden': 'true',
    focusable: 'false'
  })
}

export interface ButtonOptions {
  icon?: IconNode
  label?: string
  /** Accessible name and tooltip; defaults to the label. */
  title: string
  className?: string
  onClick: () => void
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const element = h(
    'button',
    {
      type: 'button',
      class: ['btn', options.className].filter(Boolean).join(' '),
      title: options.title,
      'aria-label': options.title
    },
    options.icon ? icon(options.icon) : null,
    options.label ? h('span', { class: 'btn-label' }, options.label) : null
  )
  element.addEventListener('click', () => options.onClick())
  // Keep focus where it was on mouse clicks, so Space still means play/pause afterwards.
  element.addEventListener('mousedown', (event) => event.preventDefault())
  return element
}

export function setButtonIcon(element: HTMLButtonElement, node: IconNode): void {
  const svg = element.querySelector('svg')
  const replacement = icon(node)
  if (svg) svg.replaceWith(replacement)
  else element.prepend(replacement)
}

export function setButtonText(element: HTMLButtonElement, title: string, label?: string): void {
  element.title = title
  element.setAttribute('aria-label', title)
  const labelElement = element.querySelector('.btn-label')
  if (labelElement && label !== undefined) labelElement.textContent = label
}

/** True when keyboard input should go to a form field instead of the editor. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(target.type)
  }
  return false
}

/** Shortcut label for the current platform, e.g. "Ctrl+Z" or "⌘Z". */
export function shortcut(keys: string, platform: string): string {
  if (platform !== 'darwin') return keys.replace('Mod', 'Ctrl')
  return keys
    .replace('Mod+', '⌘')
    .replace('Shift+', '⇧')
    .replace('Alt+', '⌥')
}
