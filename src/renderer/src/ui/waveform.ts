import WaveSurfer from 'wavesurfer.js'
import HoverPlugin from 'wavesurfer.js/plugins/hover'
import RegionsPlugin, { type Region } from 'wavesurfer.js/plugins/regions'
import TimelinePlugin from 'wavesurfer.js/plugins/timeline'
import { type AudioData, durationOf, frameCount } from '../audio/audio-data'
import { encodeWav } from '../audio/wav'
import { formatTime } from '../util/format'

/** A time range in seconds. */
export interface TimeRange {
  start: number
  end: number
}

export interface WaveformHandlers {
  /** The user selected (or cleared) a range on the waveform. */
  onSelection(range: TimeRange | null): void
  /** The user clicked to place the cursor. */
  onCursor(time: number): void
  /** Playback position changed. */
  onTime(time: number): void
  onPlayingChange(playing: boolean): void
}

type Regions = ReturnType<typeof RegionsPlugin.create>

const TIMELINE_HEIGHT = 22
const SCROLLBAR_ALLOWANCE = 14
const MAX_PX_PER_SEC = 8000
const SAME_TIME_EPSILON = 1e-4

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function shortTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const minutes = Math.floor(s / 60)
  const rest = s - minutes * 60
  const text = rest % 1 === 0 ? String(rest).padStart(2, '0') : rest.toFixed(1).padStart(4, '0')
  return `${minutes}:${text}`
}

/**
 * Wraps wavesurfer.js: draws the document, handles selection, cursor, zoom and playback.
 * Audio is handed over as raw channel data (no decoding) plus a 16-bit WAV blob for playback.
 */
export class WaveformView {
  private readonly ws: WaveSurfer
  private readonly regions: Regions
  private region: Region | null = null
  private duration = 0
  private channelCount = 1
  private playOrigin: number | null = null
  private applyingSelection = false
  private readonly resizeObserver: ResizeObserver

  constructor(
    private readonly host: HTMLElement,
    private readonly handlers: WaveformHandlers
  ) {
    this.regions = RegionsPlugin.create()
    this.ws = WaveSurfer.create({
      container: host,
      height: this.availableHeight(),
      waveColor: cssVar('--wave'),
      progressColor: cssVar('--wave-played'),
      cursorColor: cssVar('--cursor'),
      cursorWidth: 2,
      minPxPerSec: 0,
      fillParent: true,
      autoScroll: true,
      autoCenter: false,
      dragToSeek: false,
      normalize: false,
      plugins: [
        this.regions,
        TimelinePlugin.create({
          height: TIMELINE_HEIGHT,
          insertPosition: 'beforebegin',
          formatTimeCallback: shortTime,
          style: { color: cssVar('--text-muted'), fontSize: '11px' }
        }),
        HoverPlugin.create({
          lineColor: cssVar('--hover-line'),
          lineWidth: 1,
          labelBackground: cssVar('--surface-raised'),
          labelColor: cssVar('--text'),
          labelSize: '11px',
          formatTimeCallback: formatTime
        })
      ]
    })

    this.regions.enableDragSelection({ color: cssVar('--selection'), drag: false, resize: true })
    this.regions.on('region-created', (region) => this.handleRegionCreated(region))
    this.regions.on('region-updated', (region) => {
      if (region === this.region) this.emitSelection()
    })
    this.ws.on('click', (relativeX) => this.handleClick(relativeX))
    this.ws.on('timeupdate', (time) => this.handlers.onTime(time))
    this.ws.on('play', () => this.handlers.onPlayingChange(true))
    this.ws.on('pause', () => this.handlers.onPlayingChange(false))
    this.ws.on('finish', () => this.returnToOrigin())

    host.addEventListener('wheel', (event) => this.handleWheel(event), { passive: false })
    window
      .matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => this.applyTheme())
    this.resizeObserver = new ResizeObserver(() => this.fitHeight())
    this.resizeObserver.observe(host)
  }

  get isPlaying(): boolean {
    return this.ws.isPlaying()
  }

  get currentTime(): number {
    return this.ws.getCurrentTime()
  }

  /** Shows new audio. Zoom and scroll position are kept so edits don't jump around. */
  async load(audio: AudioData | null): Promise<void> {
    const scroll = this.ws.getScroll()
    this.playOrigin = null
    this.clearRegion()
    if (!audio || frameCount(audio) === 0) {
      this.duration = 0
      this.ws.empty()
      this.host.dataset.state = 'empty'
      return
    }
    this.host.dataset.state = 'loading'
    this.duration = durationOf(audio)
    this.channelCount = audio.channels.length
    this.ws.setOptions({
      height: this.availableHeight(),
      splitChannels:
        audio.channels.length > 1 ? audio.channels.map(() => ({ overlay: false })) : undefined
    })
    const blob = new Blob([encodeWav(audio, 'pcm16')], { type: 'audio/wav' })
    try {
      await this.ws.loadBlob(blob, audio.channels as Float32Array[], this.duration)
    } catch (error) {
      // A newer load superseded this one; nothing to do.
      if (error instanceof DOMException && error.name === 'AbortError') return
      this.host.dataset.state = 'error'
      throw error
    }
    this.ws.setScroll(scroll)
    this.host.dataset.state = 'ready'
  }

  setSelection(range: TimeRange | null): void {
    if (!range) {
      this.clearRegion()
      return
    }
    if (
      this.region &&
      Math.abs(this.region.start - range.start) < SAME_TIME_EPSILON &&
      Math.abs(this.region.end - range.end) < SAME_TIME_EPSILON
    ) {
      return
    }
    this.applyingSelection = true
    try {
      this.regions.clearRegions()
      this.region = this.regions.addRegion({
        start: range.start,
        end: range.end,
        color: cssVar('--selection'),
        drag: false,
        resize: true
      })
    } finally {
      this.applyingSelection = false
    }
  }

  setCursor(time: number): void {
    if (!this.ws.isPlaying()) this.ws.setTime(Math.min(Math.max(time, 0), this.duration))
  }

  play(start: number, end?: number): void {
    if (this.duration === 0) return
    this.playOrigin = start
    void this.ws.play(start, end).catch(() => undefined)
  }

  /** Pauses and returns the position where playback stopped. */
  pause(): number {
    this.ws.pause()
    this.playOrigin = null
    return this.ws.getCurrentTime()
  }

  /** Stops playback and returns the cursor to where playback started. */
  stop(): void {
    this.ws.pause()
    this.returnToOrigin()
  }

  setInteractive(interactive: boolean): void {
    this.ws.toggleInteraction(interactive)
    this.host.classList.toggle('is-locked', !interactive)
  }

  zoomIn(): void {
    this.zoomTo(this.pxPerSec() * 2)
  }

  zoomOut(): void {
    this.zoomTo(this.pxPerSec() / 2)
  }

  zoomToFit(): void {
    this.ws.zoom(0)
  }

  destroy(): void {
    this.resizeObserver.disconnect()
    this.ws.destroy()
  }

  /** Re-reads the theme colours, e.g. after the system switches between light and dark. */
  applyTheme(): void {
    this.ws.setOptions({
      waveColor: cssVar('--wave'),
      progressColor: cssVar('--wave-played'),
      cursorColor: cssVar('--cursor')
    })
    this.region?.setOptions({ color: cssVar('--selection') })
  }

  private pxPerSec(): number {
    const configured = this.ws.options.minPxPerSec
    if (configured > 0) return configured
    return this.duration > 0 ? this.ws.getWidth() / this.duration : 100
  }

  private zoomTo(pxPerSec: number, anchorTime?: number, anchorOffset?: number): void {
    if (this.duration === 0) return
    const fit = this.ws.getWidth() / this.duration
    const next = Math.min(pxPerSec, MAX_PX_PER_SEC)
    const anchor = anchorTime ?? this.ws.getCurrentTime()
    const offset = anchorOffset ?? this.ws.getWidth() / 2
    this.ws.zoom(next <= fit ? 0 : next)
    // Keep the anchor time under the same horizontal position after zooming.
    this.ws.setScroll(Math.max(0, anchor * this.pxPerSec() - offset))
  }

  private handleWheel(event: WheelEvent): void {
    if (this.duration === 0) return
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      const bounds = this.host.getBoundingClientRect()
      const offset = event.clientX - bounds.left
      const time = (this.ws.getScroll() + offset) / this.pxPerSec()
      this.zoomTo(this.pxPerSec() * (event.deltaY < 0 ? 1.25 : 0.8), time, offset)
    } else if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.preventDefault()
      this.ws.setScroll(this.ws.getScroll() + event.deltaY)
    }
  }

  private handleRegionCreated(region: Region): void {
    if (this.applyingSelection) return
    for (const other of this.regions.getRegions()) {
      if (other !== region) other.remove()
    }
    this.region = region
    this.emitSelection()
  }

  private handleClick(relativeX: number): void {
    if (this.duration === 0) return
    this.clearRegion()
    this.handlers.onSelection(null)
    this.handlers.onCursor(relativeX * this.duration)
  }

  private emitSelection(): void {
    const region = this.region
    this.handlers.onSelection(region && region.end > region.start ? { start: region.start, end: region.end } : null)
  }

  private clearRegion(): void {
    this.applyingSelection = true
    try {
      this.regions.clearRegions()
      this.region = null
    } finally {
      this.applyingSelection = false
    }
  }

  private returnToOrigin(): void {
    if (this.playOrigin !== null) this.ws.setTime(this.playOrigin)
    this.playOrigin = null
  }

  private availableHeight(): number {
    const height = Math.max(80, this.host.clientHeight - TIMELINE_HEIGHT - SCROLLBAR_ALLOWANCE)
    return Math.floor(height / Math.max(1, this.channelCount))
  }

  private fitHeight(): void {
    const height = this.availableHeight()
    if (height !== this.ws.options.height) this.ws.setOptions({ height })
  }
}
