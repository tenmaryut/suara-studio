import { h } from './dom'

const FLOOR_DB = -60
const CLIP_LEVEL = 0.999
const HOLD_MS = 1200
const CLIP_HOLD_MS = 2000

function levelToPercent(level: number): number {
  if (level <= 0) return 0
  const db = 20 * Math.log10(level)
  return Math.min(100, Math.max(0, ((db - FLOOR_DB) / -FLOOR_DB) * 100))
}

/** Per-channel peak meter with peak hold and a clip indicator. */
export class LevelMeter {
  readonly element: HTMLElement
  private bars: { fill: HTMLElement; hold: HTMLElement }[] = []
  private holds: { percent: number; at: number }[] = []
  private readonly clip: HTMLElement
  private clipUntil = 0

  constructor(clipLabel: string) {
    this.clip = h('span', { class: 'meter-clip', hidden: true }, clipLabel)
    this.element = h('div', { class: 'meter', role: 'meter', 'aria-valuemin': FLOOR_DB, 'aria-valuemax': 0 })
    this.element.append(h('div', { class: 'meter-bars' }), this.clip)
    this.setChannels(1)
  }

  setChannels(count: number): void {
    const container = this.element.querySelector('.meter-bars')!
    container.replaceChildren()
    this.bars = []
    this.holds = []
    for (let i = 0; i < count; i++) {
      const fill = h('div', { class: 'meter-fill' })
      const hold = h('div', { class: 'meter-hold' })
      container.append(h('div', { class: 'meter-bar' }, fill, hold))
      this.bars.push({ fill, hold })
      this.holds.push({ percent: 0, at: 0 })
    }
  }

  update(peaks: number[]): void {
    if (peaks.length !== this.bars.length) this.setChannels(peaks.length)
    const now = performance.now()
    peaks.forEach((peak, i) => {
      const percent = levelToPercent(peak)
      const bar = this.bars[i]!
      const hold = this.holds[i]!
      bar.fill.style.width = `${percent}%`
      if (percent >= hold.percent || now - hold.at > HOLD_MS) {
        hold.percent = percent
        hold.at = now
      }
      bar.hold.style.left = `${hold.percent}%`
      if (peak >= CLIP_LEVEL) this.clipUntil = now + CLIP_HOLD_MS
    })
    const loudest = Math.max(0, ...peaks)
    this.element.setAttribute('aria-valuenow', loudest > 0 ? (20 * Math.log10(loudest)).toFixed(1) : String(FLOOR_DB))
    this.clip.hidden = now > this.clipUntil
  }

  reset(): void {
    this.update(this.bars.map(() => 0))
    for (const hold of this.holds) hold.percent = 0
    this.clipUntil = 0
    this.clip.hidden = true
  }
}
