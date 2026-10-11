import { Copy, Trash2, Volume2 } from 'lucide'
import type { Translate } from '../../../shared/i18n'
import { type AudioData, frameCount } from '../audio/audio-data'
import { type PeakPyramid, buildPeaks, peakRange } from '../audio/peaks'
import { audibleLayers } from '../project/mix'
import type { Layer, Selection } from '../project/project'
import { formatTime } from '../util/format'
import { button, h, icon } from './dom'

export interface TracksState {
  layers: readonly Layer[]
  activeId: string | null
  sampleRate: number
  /** Timeline length in frames. */
  length: number
  selection: Selection | null
  cursor: number
}

export interface TracksHandlers {
  onActivate(id: string): void
  onSelection(selection: Selection | null): void
  onCursor(frame: number): void
  /** The volume slider moved (live, while dragging). */
  onVolumeInput(id: string, volume: number): void
  /** The volume slider was released. */
  onVolumeChange(id: string, volume: number): void
  onMute(id: string, muted: boolean): void
  onSolo(id: string, solo: boolean): void
  onRename(id: string, name: string): void
  onDuplicate(id: string): void
  onRemove(id: string): void
}

interface Row {
  id: string
  element: HTMLElement
  header: HTMLElement
  name: HTMLInputElement
  badge: HTMLElement
  mute: HTMLButtonElement
  solo: HTMLButtonElement
  volume: HTMLInputElement
  volumeValue: HTMLElement
  canvas: HTMLCanvasElement
  volumeDragging: boolean
}

const LANE_HEIGHT = 96
const MAX_PX_PER_SEC = 20000
const DRAG_THRESHOLD = 4
const EDGE_GRAB = 6
const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600]
const peakCache = new WeakMap<AudioData, PeakPyramid>()

function peaksFor(audio: AudioData): PeakPyramid {
  let peaks = peakCache.get(audio)
  if (!peaks) {
    peaks = buildPeaks(audio)
    peakCache.set(audio, peaks)
  }
  return peaks
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function rulerLabel(seconds: number, step: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0
  const text = rest.toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0')
  return `${minutes}:${text}`
}

type Drag =
  | { mode: 'select'; anchor: number; startX: number; moved: boolean; pointerId: number; extend: boolean }
  | { mode: 'resize'; fixed: number; pointerId: number }

/**
 * The layer list and timeline: a header per layer (name, mute, solo, volume) next to its
 * waveform lane, a time ruler, a shared selection and cursor, and zoom and scrolling that
 * apply to every layer at once.
 */
export class TracksView {
  readonly element: HTMLElement
  /** Holds the "add layer" buttons below the last layer. */
  readonly footer: HTMLElement
  /** Holds the zoom buttons above the layer headers. */
  readonly corner: HTMLElement
  private readonly ruler: HTMLCanvasElement
  private readonly scroller: HTMLElement
  private readonly rowsHost: HTMLElement
  private readonly hscroll: HTMLElement
  private readonly hscrollContent: HTMLElement
  private readonly overlay: HTMLElement
  private readonly cursorLine: HTMLElement
  private readonly playheadLine: HTMLElement
  private readonly hoverLine: HTMLElement
  private readonly hoverTime: HTMLElement
  private readonly rows = new Map<string, Row>()
  private state: TracksState = { layers: [], activeId: null, sampleRate: 48000, length: 0, selection: null, cursor: 0 }
  private pxPerSec = 100
  private fitMode = true
  private laneWidth = 0
  private drawPending = false
  private drag: Drag | null = null
  private playhead: number | null = null
  private interactive = true

  constructor(
    private readonly handlers: TracksHandlers,
    private readonly t: Translate
  ) {
    this.ruler = h('canvas', { class: 'ruler', 'aria-hidden': 'true' })
    this.hoverTime = h('div', { class: 'hover-time', hidden: true })
    this.corner = h('div', { class: 'ruler-tools' })
    const rulerRow = h(
      'div',
      { class: 'ruler-row' },
      h('div', { class: 'ruler-corner' }, h('span', {}, t('tracks.layers')), this.corner),
      h('div', { class: 'ruler-host' }, this.ruler, this.hoverTime)
    )
    this.rowsHost = h('div', { class: 'track-rows' })
    this.footer = h('div', { class: 'tracks-footer' })
    this.scroller = h('div', { class: 'tracks-scroll' }, this.rowsHost, this.footer)
    this.hscrollContent = h('div', { class: 'hscroll-content' })
    this.hscroll = h('div', { class: 'hscroll', 'aria-label': t('tracks.scroll') }, this.hscrollContent)
    this.cursorLine = h('div', { class: 'cursor-line' })
    this.playheadLine = h('div', { class: 'playhead-line', hidden: true })
    this.hoverLine = h('div', { class: 'hover-line', hidden: true })
    this.overlay = h('div', { class: 'tracks-overlay' }, this.cursorLine, this.playheadLine, this.hoverLine)
    this.element = h(
      'div',
      { class: 'tracks', 'data-testid': 'tracks' },
      rulerRow,
      this.scroller,
      h('div', { class: 'hscroll-row' }, h('div', { class: 'hscroll-corner' }), this.hscroll),
      this.overlay
    )

    this.hscroll.addEventListener('scroll', () => this.scheduleDraw())
    this.scroller.addEventListener('scroll', () => this.positionOverlay())
    this.element.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false })
    this.ruler.addEventListener('pointerdown', (event) => this.startDrag(event, null))
    this.ruler.addEventListener('pointermove', (event) => this.handlePointerMove(event))
    this.ruler.addEventListener('pointerup', (event) => this.endDrag(event))
    this.ruler.addEventListener('pointerleave', () => this.hideHover())
    new ResizeObserver(() => this.handleResize()).observe(this.element)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.scheduleDraw())
  }

  get scrollLeft(): number {
    return this.hscroll.scrollLeft
  }

  update(state: TracksState): void {
    const previousLength = this.state.length
    this.state = state
    this.syncRows()
    if (this.fitMode || state.length !== previousLength) this.updateZoomBounds()
    this.scheduleDraw()
  }

  /** Shows the playback position (or hides it with null), scrolling to keep it in view. */
  setPlayhead(frame: number | null): void {
    this.playhead = frame
    if (frame !== null && this.laneWidth > 0) {
      const x = this.frameToContentX(frame) - this.hscroll.scrollLeft
      if (x > this.laneWidth * 0.92 || x < 0) {
        this.hscroll.scrollLeft = Math.max(0, this.frameToContentX(frame) - this.laneWidth * 0.1)
      }
    }
    this.positionOverlay()
  }

  setInteractive(interactive: boolean): void {
    this.interactive = interactive
    this.element.classList.toggle('is-locked', !interactive)
  }

  zoomIn(): void {
    this.zoomTo(this.pxPerSec * 2, this.anchorX())
  }

  zoomOut(): void {
    this.zoomTo(this.pxPerSec / 2, this.anchorX())
  }

  zoomToFit(): void {
    this.fitMode = true
    this.updateZoomBounds()
    this.hscroll.scrollLeft = 0
    this.scheduleDraw()
  }

  /** Re-reads theme colours. */
  applyTheme(): void {
    this.scheduleDraw()
  }

  // ---- Rows ----------------------------------------------------------------------------------

  private syncRows(): void {
    const seen = new Set<string>()
    const audible = new Set(audibleLayers(this.state.layers).map((layer) => layer.id))
    let previous: HTMLElement | null = null
    for (const layer of this.state.layers) {
      seen.add(layer.id)
      let row = this.rows.get(layer.id)
      if (!row) {
        row = this.createRow(layer.id)
        this.rows.set(layer.id, row)
      }
      // Keep DOM order in step with the layer order.
      const expectedNext: ChildNode | null = previous ? previous.nextSibling : this.rowsHost.firstChild
      if (expectedNext !== row.element) this.rowsHost.insertBefore(row.element, expectedNext)
      previous = row.element
      this.updateRow(row, layer, audible.has(layer.id) || frameCount(layer.audio) === 0)
    }
    for (const [id, row] of this.rows) {
      if (!seen.has(id)) {
        row.element.remove()
        this.rows.delete(id)
      }
    }
  }

  private createRow(id: string): Row {
    const t = this.t
    const name = h('input', {
      class: 'track-name',
      type: 'text',
      maxlength: 60,
      spellcheck: false,
      'aria-label': t('tracks.name'),
      title: t('tracks.renameHint')
    })
    const badge = h('span', { class: 'track-badge' })
    const mute = h('button', { type: 'button', class: 'track-toggle track-mute', title: t('tracks.mute'), 'aria-label': t('tracks.mute') }, 'M')
    const solo = h('button', { type: 'button', class: 'track-toggle track-solo', title: t('tracks.solo'), 'aria-label': t('tracks.solo') }, 'S')
    const volume = h('input', {
      class: 'track-volume-slider',
      type: 'range',
      min: 0,
      max: 200,
      step: 1,
      'aria-label': t('tracks.volume')
    })
    const volumeValue = h('span', { class: 'track-volume-value', title: t('tracks.volumeReset') })
    const duplicate = button({ icon: Copy, title: t('tracks.duplicate'), className: 'btn-small', onClick: () => this.handlers.onDuplicate(id) })
    const remove = button({ icon: Trash2, title: t('tracks.remove'), className: 'btn-small', onClick: () => this.handlers.onRemove(id) })
    const header = h(
      'div',
      { class: 'track-header' },
      h(
        'div',
        { class: 'track-top' },
        h('span', { class: 'track-dot', 'aria-hidden': 'true' }),
        name,
        badge,
        duplicate,
        remove
      ),
      h(
        'div',
        { class: 'track-bottom' },
        mute,
        solo,
        h('label', { class: 'track-volume', title: t('tracks.volume') }, icon(Volume2, 15), volume, volumeValue)
      )
    )
    const canvas = h('canvas', { class: 'track-lane', 'data-testid': 'lane' })
    const element = h('div', { class: 'track-row', 'data-layer': id }, header, h('div', { class: 'track-lane-host' }, canvas))
    const row: Row = { id, element, header, name, badge, mute, solo, volume, volumeValue, canvas, volumeDragging: false }

    for (const control of [mute, solo]) control.addEventListener('mousedown', (event) => event.preventDefault())
    header.addEventListener('pointerdown', () => {
      if (this.interactive) this.handlers.onActivate(id)
    })
    name.addEventListener('change', () => this.handlers.onRename(id, name.value))
    name.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') name.blur()
      if (event.key === 'Escape') {
        name.value = this.state.layers.find((layer) => layer.id === id)?.name ?? name.value
        name.blur()
      }
    })
    mute.addEventListener('click', () => this.handlers.onMute(id, mute.getAttribute('aria-pressed') !== 'true'))
    solo.addEventListener('click', () => this.handlers.onSolo(id, solo.getAttribute('aria-pressed') !== 'true'))
    volume.addEventListener('input', () => {
      row.volumeDragging = true
      volumeValue.textContent = `${volume.value}%`
      this.handlers.onVolumeInput(id, Number(volume.value) / 100)
    })
    volume.addEventListener('change', () => {
      row.volumeDragging = false
      this.handlers.onVolumeChange(id, Number(volume.value) / 100)
    })
    volumeValue.addEventListener('dblclick', () => {
      volume.value = '100'
      volumeValue.textContent = '100%'
      this.handlers.onVolumeChange(id, 1)
    })
    canvas.addEventListener('pointerdown', (event) => this.startDrag(event, id))
    canvas.addEventListener('pointermove', (event) => this.handlePointerMove(event))
    canvas.addEventListener('pointerup', (event) => this.endDrag(event))
    canvas.addEventListener('pointerleave', () => this.hideHover())
    canvas.addEventListener('dblclick', () => {
      const layer = this.state.layers.find((candidate) => candidate.id === id)
      if (layer && this.interactive && frameCount(layer.audio) > 0) {
        this.handlers.onSelection({ start: 0, end: frameCount(layer.audio) })
      }
    })
    return row
  }

  private updateRow(row: Row, layer: Layer, audible: boolean): void {
    const t = this.t
    const active = layer.id === this.state.activeId
    row.element.classList.toggle('is-active', active)
    row.element.classList.toggle('is-silent', !audible)
    row.element.style.setProperty('--layer-color', `var(--layer-${layer.color % 8})`)
    row.header.setAttribute('aria-current', active ? 'true' : 'false')
    if (document.activeElement !== row.name) row.name.value = layer.name
    const channels = layer.audio.channels.length
    row.badge.textContent = frameCount(layer.audio) === 0 ? t('tracks.empty') : channels === 1 ? t('status.mono') : t('status.stereo')
    row.mute.setAttribute('aria-pressed', String(layer.muted))
    row.solo.setAttribute('aria-pressed', String(layer.solo))
    if (!row.volumeDragging) {
      const percent = Math.round(layer.volume * 100)
      row.volume.value = String(percent)
      row.volumeValue.textContent = `${percent}%`
    }
  }

  // ---- Zoom and scrolling -------------------------------------------------------------------

  private duration(): number {
    return Math.max(this.state.length / this.state.sampleRate, 1)
  }

  private fitPxPerSec(): number {
    return this.laneWidth > 0 ? this.laneWidth / (this.duration() * 1.02) : 100
  }

  private updateZoomBounds(): void {
    const fit = this.fitPxPerSec()
    if (this.fitMode || this.pxPerSec < fit) {
      this.pxPerSec = fit
      this.fitMode = true
    }
    this.hscrollContent.style.width = `${Math.ceil(this.duration() * this.pxPerSec * 1.02)}px`
  }

  private zoomTo(pxPerSec: number, anchorX: number): void {
    if (this.laneWidth <= 0) return
    const fit = this.fitPxPerSec()
    const anchorSeconds = (this.hscroll.scrollLeft + anchorX) / this.pxPerSec
    const next = Math.min(Math.max(pxPerSec, fit), MAX_PX_PER_SEC)
    this.fitMode = next <= fit * 1.0001
    this.pxPerSec = next
    this.hscrollContent.style.width = `${Math.ceil(this.duration() * this.pxPerSec * 1.02)}px`
    this.hscroll.scrollLeft = Math.max(0, anchorSeconds * this.pxPerSec - anchorX)
    this.scheduleDraw()
  }

  /** Where to keep zooming centred: the playhead or cursor when visible, else the middle. */
  private anchorX(): number {
    const frame = this.playhead ?? this.state.cursor
    const x = this.frameToContentX(frame) - this.hscroll.scrollLeft
    return x >= 0 && x <= this.laneWidth ? x : this.laneWidth / 2
  }

  private handleWheel(event: WheelEvent): void {
    if (this.state.layers.length === 0) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const bounds = this.ruler.getBoundingClientRect()
      this.zoomTo(this.pxPerSec * (event.deltaY < 0 ? 1.25 : 0.8), event.clientX - bounds.left)
    } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault()
      this.hscroll.scrollLeft += event.shiftKey ? event.deltaY : event.deltaX
    }
  }

  private handleResize(): void {
    const width = this.ruler.parentElement?.clientWidth ?? 0
    if (width === this.laneWidth) return
    this.laneWidth = width
    this.updateZoomBounds()
    this.scheduleDraw()
  }

  // ---- Pointer interaction --------------------------------------------------------------------

  private frameToContentX(frame: number): number {
    return (frame / this.state.sampleRate) * this.pxPerSec
  }

  private frameAt(clientX: number): number {
    const bounds = this.ruler.getBoundingClientRect()
    const x = clientX - bounds.left + this.hscroll.scrollLeft
    const frame = Math.round((x / this.pxPerSec) * this.state.sampleRate)
    return Math.min(Math.max(frame, 0), this.state.length)
  }

  private startDrag(event: PointerEvent, layerId: string | null): void {
    if (!this.interactive || event.button !== 0 || this.state.length === 0) return
    event.preventDefault()
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    if (layerId && layerId !== this.state.activeId) this.handlers.onActivate(layerId)
    const frame = this.frameAt(event.clientX)
    const selection = this.state.selection
    if (selection && layerId === this.state.activeId && !event.shiftKey) {
      const startX = this.frameToContentX(selection.start) - this.hscroll.scrollLeft
      const endX = this.frameToContentX(selection.end) - this.hscroll.scrollLeft
      const x = event.clientX - this.ruler.getBoundingClientRect().left
      if (Math.abs(x - startX) <= EDGE_GRAB) {
        this.drag = { mode: 'resize', fixed: selection.end, pointerId: event.pointerId }
        return
      }
      if (Math.abs(x - endX) <= EDGE_GRAB) {
        this.drag = { mode: 'resize', fixed: selection.start, pointerId: event.pointerId }
        return
      }
    }
    const extend = event.shiftKey
    const anchor = extend ? (selection ? (Math.abs(frame - selection.start) < Math.abs(frame - selection.end) ? selection.end : selection.start) : this.state.cursor) : frame
    this.drag = { mode: 'select', anchor, startX: event.clientX, moved: extend, pointerId: event.pointerId, extend }
    if (extend) this.emitRange(anchor, frame)
  }

  private handlePointerMove(event: PointerEvent): void {
    this.showHover(event.clientX)
    const drag = this.drag
    if (!drag || drag.pointerId !== event.pointerId) return
    this.autoScroll(event.clientX)
    const frame = this.frameAt(event.clientX)
    if (drag.mode === 'resize') {
      this.emitRange(drag.fixed, frame)
      return
    }
    if (!drag.moved && Math.abs(event.clientX - drag.startX) < DRAG_THRESHOLD) return
    drag.moved = true
    this.emitRange(drag.anchor, frame)
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.drag
    if (!drag || drag.pointerId !== event.pointerId) return
    this.drag = null
    if (drag.mode === 'select' && !drag.moved) {
      this.handlers.onSelection(null)
      this.handlers.onCursor(this.frameAt(event.clientX))
    }
  }

  private emitRange(a: number, b: number): void {
    const start = Math.min(a, b)
    const end = Math.max(a, b)
    this.handlers.onSelection(end > start ? { start, end } : null)
  }

  private autoScroll(clientX: number): void {
    const bounds = this.ruler.getBoundingClientRect()
    if (clientX > bounds.right - 24) this.hscroll.scrollLeft += 24
    else if (clientX < bounds.left + 8) this.hscroll.scrollLeft -= 24
  }

  private showHover(clientX: number): void {
    if (this.state.length === 0) return
    const bounds = this.ruler.getBoundingClientRect()
    const x = clientX - bounds.left
    if (x < 0 || x > bounds.width) {
      this.hideHover()
      return
    }
    this.hoverLine.hidden = false
    this.hoverLine.style.transform = `translateX(${x}px)`
    this.hoverTime.hidden = false
    this.hoverTime.textContent = formatTime(this.frameAt(clientX) / this.state.sampleRate)
    this.hoverTime.style.transform = `translateX(${Math.min(x + 6, bounds.width - 80)}px)`
  }

  private hideHover(): void {
    this.hoverLine.hidden = true
    this.hoverTime.hidden = true
  }

  // ---- Drawing --------------------------------------------------------------------------------

  private scheduleDraw(): void {
    if (this.drawPending) return
    this.drawPending = true
    requestAnimationFrame(() => {
      this.drawPending = false
      this.draw()
    })
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1
    const width = this.laneWidth
    if (width <= 0) return
    const audible = new Set(audibleLayers(this.state.layers).map((layer) => layer.id))
    const colors = {
      lane: cssVar('--lane'),
      laneActive: cssVar('--lane-active'),
      selection: cssVar('--selection'),
      selectionFaint: cssVar('--selection-faint'),
      silent: cssVar('--wave-silent'),
      center: cssVar('--lane-center'),
      text: cssVar('--text-muted')
    }
    for (const layer of this.state.layers) {
      const row = this.rows.get(layer.id)
      if (!row) continue
      const canvas = row.canvas
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(LANE_HEIGHT * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(LANE_HEIGHT * dpr)
        canvas.style.height = `${LANE_HEIGHT}px`
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const active = layer.id === this.state.activeId
      ctx.fillStyle = active ? colors.laneActive : colors.lane
      ctx.fillRect(0, 0, width, LANE_HEIGHT)
      this.drawSelection(ctx, active ? colors.selection : colors.selectionFaint)
      const waveColor = audible.has(layer.id) ? cssVar(`--layer-${layer.color % 8}`) : colors.silent
      this.drawWave(ctx, layer.audio, waveColor, colors.center, colors.text)
    }
    this.drawRuler(dpr)
    this.positionOverlay()
  }

  private drawSelection(ctx: CanvasRenderingContext2D, color: string): void {
    const selection = this.state.selection
    if (!selection) return
    const scroll = this.hscroll.scrollLeft
    const x0 = this.frameToContentX(selection.start) - scroll
    const x1 = this.frameToContentX(selection.end) - scroll
    if (x1 < 0 || x0 > this.laneWidth) return
    ctx.fillStyle = color
    ctx.fillRect(Math.max(0, x0), 0, Math.min(this.laneWidth, x1) - Math.max(0, x0), LANE_HEIGHT)
  }

  private drawWave(ctx: CanvasRenderingContext2D, audio: AudioData, color: string, center: string, text: string): void {
    const width = this.laneWidth
    const mid = LANE_HEIGHT / 2
    const length = frameCount(audio)
    ctx.fillStyle = center
    ctx.fillRect(0, mid, width, 1)
    if (length === 0) {
      ctx.fillStyle = text
      ctx.font = `12px ${cssVar('--font')}`
      ctx.textBaseline = 'middle'
      ctx.fillText(this.t('tracks.emptyLane'), 12, mid - 12)
      return
    }
    const peaks = peaksFor(audio)
    const framesPerPx = this.state.sampleRate / this.pxPerSec
    const scroll = this.hscroll.scrollLeft
    const scale = mid - 4
    ctx.fillStyle = color
    const firstPx = Math.max(0, Math.floor(-scroll))
    const lastPx = Math.min(width, Math.ceil(this.frameToContentX(length) - scroll))
    for (let x = firstPx; x < lastPx; x++) {
      const start = (x + scroll) * framesPerPx
      const [lo, hi] = peakRange(audio, peaks, start, start + Math.max(1, framesPerPx))
      const top = mid - Math.min(1, Math.max(-1, hi)) * scale
      const bottom = mid - Math.min(1, Math.max(-1, lo)) * scale
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top))
    }
  }

  private drawRuler(dpr: number): void {
    const canvas = this.ruler
    const width = this.laneWidth
    const height = canvas.clientHeight || 26
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const scroll = this.hscroll.scrollLeft
    const selection = this.state.selection
    if (selection) {
      const x0 = this.frameToContentX(selection.start) - scroll
      const x1 = this.frameToContentX(selection.end) - scroll
      ctx.fillStyle = cssVar('--selection')
      ctx.fillRect(x0, 0, x1 - x0, height)
    }
    const step = TICK_STEPS.find((candidate) => candidate * this.pxPerSec >= 80) ?? 3600
    const first = Math.floor(scroll / this.pxPerSec / step) * step
    ctx.fillStyle = cssVar('--text-muted')
    ctx.strokeStyle = cssVar('--border')
    ctx.font = `11px ${cssVar('--font')}`
    ctx.textBaseline = 'top'
    for (let seconds = first; seconds * this.pxPerSec - scroll <= width; seconds += step) {
      const x = Math.round(seconds * this.pxPerSec - scroll) + 0.5
      ctx.beginPath()
      ctx.moveTo(x, height - 8)
      ctx.lineTo(x, height)
      ctx.stroke()
      const label = rulerLabel(seconds, step)
      // A label cut off at the right edge would read as a different time.
      if (x + 3 + ctx.measureText(label).width <= width) ctx.fillText(label, x + 3, 4)
      const minor = x + (step * this.pxPerSec) / 2
      ctx.beginPath()
      ctx.moveTo(minor, height - 4)
      ctx.lineTo(minor, height)
      ctx.stroke()
    }
  }

  private positionOverlay(): void {
    const rows = Math.max(0, Math.min(this.rowsHost.offsetHeight - this.scroller.scrollTop, this.scroller.clientHeight))
    this.overlay.style.height = `${this.ruler.offsetHeight + 1 + rows}px`
    const scroll = this.hscroll.scrollLeft
    const visible = this.state.layers.length > 0 && this.state.length > 0
    const cursorX = this.frameToContentX(this.state.cursor) - scroll
    this.cursorLine.hidden = !visible || cursorX < 0 || cursorX > this.laneWidth
    this.cursorLine.style.transform = `translateX(${cursorX}px)`
    if (this.playhead === null || !visible) {
      this.playheadLine.hidden = true
    } else {
      const x = this.frameToContentX(this.playhead) - scroll
      this.playheadLine.hidden = x < 0 || x > this.laneWidth
      this.playheadLine.style.transform = `translateX(${x}px)`
    }
  }
}
