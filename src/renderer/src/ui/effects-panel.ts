import {
  ArrowLeft,
  Bird,
  Bot,
  Check,
  Church,
  Drum,
  Eraser,
  FlipHorizontal2,
  Gauge,
  type IconNode,
  Mountain,
  Phone,
  Play,
  Rabbit,
  SlidersHorizontal,
  Square,
  Timer,
  TrendingDown,
  TrendingUp,
  Volume2,
  VolumeX,
  Waves,
  Wind,
  X
} from 'lucide'
import { EFFECTS, EFFECT_CATEGORIES, type EffectId } from '../../../shared/effects'
import type { Translate } from '../../../shared/i18n'
import {
  type EffectDefinition,
  type EffectParam,
  type EffectValues,
  defaultValues,
  effectDefinition
} from '../effects/catalog'
import { button, h, icon, setButtonIcon, setButtonText } from './dom'

export const EFFECT_ICONS: Record<EffectId, IconNode> = {
  volume: Volume2,
  normalize: Gauge,
  fadeIn: TrendingUp,
  fadeOut: TrendingDown,
  silence: VolumeX,
  rumble: Wind,
  gate: Eraser,
  compress: SlidersHorizontal,
  truncateSilence: Timer,
  bass: Drum,
  treble: Bird,
  telephone: Phone,
  echo: Mountain,
  reverb: Church,
  speed: Rabbit,
  robot: Bot,
  tremolo: Waves,
  reverse: FlipHorizontal2
}

export interface EffectsPanelHandlers {
  /** The panel now shows this effect (or the list, with null). */
  onSelect(id: EffectId | null): void
  onPreview(id: EffectId, values: EffectValues): void
  onStopPreview(): void
  onApply(id: EffectId, values: EffectValues): void
  onClose(): void
}

/**
 * The effects side panel: effects grouped by what they are for, each with a plain-language
 * description, a few sliders and presets, a Listen button and an Apply button.
 */
export class EffectsPanel {
  readonly element: HTMLElement
  private readonly list: HTMLElement
  private readonly detail: HTMLElement
  private readonly target: HTMLElement
  private readonly number: Intl.NumberFormat
  private current: EffectDefinition | null = null
  private values: EffectValues = {}
  private previewButton: HTMLButtonElement | null = null
  private applyButton: HTMLButtonElement | null = null
  private targetEnabled = false
  private previewing = false

  constructor(
    private readonly handlers: EffectsPanelHandlers,
    private readonly t: Translate,
    locale: string
  ) {
    this.number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
    this.target = h('p', { class: 'effects-target', 'data-testid': 'effects-target' })
    this.list = h('div', { class: 'effects-list' })
    this.detail = h('div', { class: 'effects-detail', hidden: true })
    const close = button({ icon: X, title: t('effects.close'), className: 'btn-small', onClick: () => handlers.onClose() })
    this.element = h(
      'aside',
      { class: 'effects-panel', hidden: true, 'aria-label': t('effects.title') },
      h('header', { class: 'effects-header' }, h('h2', { class: 'effects-title' }, t('effects.title')), close),
      this.target,
      h('div', { class: 'effects-body' }, this.list, this.detail)
    )
    this.renderList()
  }

  get isOpen(): boolean {
    return !this.element.hidden
  }

  /** The effect being shown, or null on the list. */
  get effect(): EffectId | null {
    return this.isOpen ? (this.current?.id ?? null) : null
  }

  /** Opens the panel on the list, or straight on one effect. */
  open(effect?: EffectId): void {
    this.element.hidden = false
    if (effect) this.showEffect(effect)
    else this.showList()
  }

  close(): void {
    this.element.hidden = true
    this.setPreviewing(false)
  }

  /** Says what the effect will change, e.g. "The selected part of “Voice”". */
  setTarget(text: string, enabled: boolean): void {
    this.target.textContent = text
    this.target.classList.toggle('is-warning', !enabled)
    this.targetEnabled = enabled
    this.updateButtons()
  }

  setPreviewing(previewing: boolean): void {
    this.previewing = previewing
    if (!this.previewButton) return
    setButtonIcon(this.previewButton, previewing ? Square : Play)
    const label = previewing ? this.t('effects.stopPreview') : this.t('effects.preview')
    setButtonText(this.previewButton, label, label)
  }

  private renderList(): void {
    const sections = EFFECT_CATEGORIES.map((category) => {
      const cards = EFFECTS.filter((effect) => effect.category === category).map((effect) => {
        const card = h(
          'button',
          { type: 'button', class: 'effect-card', 'data-effect': effect.id },
          h('span', { class: 'effect-card-icon' }, icon(EFFECT_ICONS[effect.id], 20)),
          h(
            'span',
            { class: 'effect-card-text' },
            h('span', { class: 'effect-card-name' }, this.t(`fx.${effect.id}.name`)),
            h('span', { class: 'effect-card-desc' }, this.t(`fx.${effect.id}.short`))
          )
        )
        card.addEventListener('click', () => this.showEffect(effect.id))
        return card
      })
      return h(
        'section',
        { class: 'effects-section' },
        h('h3', { class: 'effects-category' }, this.t(`fx.cat.${category}`)),
        h('div', { class: 'effect-cards' }, ...cards)
      )
    })
    this.list.replaceChildren(...sections)
  }

  private showList(): void {
    this.handlers.onStopPreview()
    this.current = null
    this.previewButton = null
    this.applyButton = null
    this.detail.hidden = true
    this.list.hidden = false
    this.handlers.onSelect(null)
  }

  private showEffect(id: EffectId): void {
    this.handlers.onStopPreview()
    const definition = effectDefinition(id)
    this.current = definition
    this.values = defaultValues(definition)
    const t = this.t
    const sliders = definition.params.map((param) => this.slider(param))
    const presets = definition.presets.map((preset) => {
      const chip = h('button', { type: 'button', class: 'preset-chip' }, t(preset.label))
      chip.addEventListener('click', () => {
        for (const [key, value] of Object.entries(preset.values)) this.values[key] = value
        this.syncSliders()
      })
      return chip
    })
    this.previewButton = button({
      icon: Play,
      label: t('effects.preview'),
      title: t('effects.preview'),
      onClick: () => {
        if (this.previewing) this.handlers.onStopPreview()
        else this.handlers.onPreview(id, { ...this.values })
      }
    })
    this.applyButton = button({
      icon: Check,
      label: t('effects.apply'),
      title: t('effects.apply'),
      className: 'btn-primary',
      onClick: () => this.handlers.onApply(id, { ...this.values })
    })
    const back = button({ icon: ArrowLeft, label: t('effects.back'), title: t('effects.back'), className: 'btn-link', onClick: () => this.showList() })
    const children: (Node | null)[] = [
      back,
      h(
        'div',
        { class: 'effect-heading' },
        h('span', { class: 'effect-card-icon' }, icon(EFFECT_ICONS[id], 22)),
        h('h3', { class: 'effect-name' }, t(`fx.${id}.name`))
      ),
      h('p', { class: 'effect-desc' }, t(`fx.${id}.desc`)),
      presets.length > 0 ? h('div', { class: 'preset-chips', role: 'group', 'aria-label': t('effects.presets') }, ...presets) : null,
      ...sliders,
      definition.defaultRange !== 'all' ? h('p', { class: 'effect-note' }, t('effects.fadeNote')) : null,
      h('div', { class: 'effect-actions' }, this.previewButton, this.applyButton)
    ]
    this.detail.replaceChildren(...children.filter((child): child is Node => child !== null))
    this.list.hidden = true
    this.detail.hidden = false
    this.setPreviewing(false)
    this.updateButtons()
    this.detail.scrollTop = 0
    this.handlers.onSelect(id)
  }

  private slider(param: EffectParam): HTMLElement {
    const inputId = `fx-param-${param.id}`
    const input = h('input', {
      id: inputId,
      class: 'effect-slider',
      type: 'range',
      min: param.min,
      max: param.max,
      step: param.step,
      value: this.values[param.id] ?? param.default,
      'data-param': param.id
    })
    const value = h('output', { class: 'effect-value', for: inputId })
    value.textContent = this.formatValue(param, Number(input.value))
    input.addEventListener('input', () => {
      this.values[param.id] = Number(input.value)
      value.textContent = this.formatValue(param, Number(input.value))
    })
    return h(
      'div',
      { class: 'effect-param' },
      h('label', { class: 'effect-param-label', for: inputId }, this.t(param.label)),
      input,
      value
    )
  }

  private syncSliders(): void {
    for (const input of this.detail.querySelectorAll<HTMLInputElement>('input[data-param]')) {
      const id = input.dataset.param!
      const param = this.current?.params.find((candidate) => candidate.id === id)
      if (!param) continue
      input.value = String(this.values[id] ?? param.default)
      const output = input.parentElement?.querySelector('output')
      if (output) output.textContent = this.formatValue(param, Number(input.value))
    }
  }

  private formatValue(param: EffectParam, value: number): string {
    const number = this.number.format(value)
    switch (param.unit) {
      case 'percent':
        return `${number}%`
      case 'db':
        return `${value > 0 ? '+' : ''}${number} dB`
      case 'hz':
        return `${number} Hz`
      case 'seconds':
        return this.t('unit.seconds', { value: number })
    }
  }

  private updateButtons(): void {
    if (this.previewButton) this.previewButton.disabled = !this.targetEnabled
    if (this.applyButton) this.applyButton.disabled = !this.targetEnabled
  }
}
