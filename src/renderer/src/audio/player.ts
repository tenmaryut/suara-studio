import { type AudioData, frameCount } from './audio-data'

export interface PlaybackLayer {
  id: string
  audio: AudioData
  gain: number
}

interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
}

const buffers = new WeakMap<AudioData, AudioBuffer>()

/** Copies audio into a Web Audio buffer once; layers are immutable, so the copy stays valid. */
export function audioBufferFor(context: BaseAudioContext, audio: AudioData): AudioBuffer {
  const cached = buffers.get(audio)
  if (cached && cached.sampleRate === audio.sampleRate) return cached
  const buffer = context.createBuffer(audio.channels.length, Math.max(1, frameCount(audio)), audio.sampleRate)
  audio.channels.forEach((channel, c) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c))
  buffers.set(audio, buffer)
  return buffer
}

/**
 * Plays all layers together through Web Audio, each through its own gain so volume changes are
 * heard immediately. Positions are timeline seconds.
 */
export class Player {
  /** Called when playback reaches its end on its own (not after stop()). */
  onEnded: (() => void) | null = null

  private context: AudioContext | null = null
  private voices = new Map<string, Voice>()
  private startTime = 0
  private startOffset = 0
  private endOffset = 0
  private playing = false
  private endTimer = 0

  get isPlaying(): boolean {
    return this.playing
  }

  /** Current timeline position in seconds. */
  get position(): number {
    if (!this.playing || !this.context) return this.startOffset
    return Math.min(this.endOffset, this.startOffset + Math.max(0, this.context.currentTime - this.startTime))
  }

  /** Starts playing `layers` from `from` until `to` seconds. */
  async play(layers: PlaybackLayer[], from: number, to: number): Promise<void> {
    this.stop()
    const context = await this.ensureContext()
    const when = context.currentTime + 0.03
    const length = Math.max(0, to - from)
    for (const layer of layers) {
      const duration = frameCount(layer.audio) / layer.audio.sampleRate
      if (duration <= from) continue
      const gain = context.createGain()
      gain.gain.value = layer.gain
      gain.connect(context.destination)
      const source = context.createBufferSource()
      source.buffer = audioBufferFor(context, layer.audio)
      source.connect(gain)
      source.start(when, from, Math.min(length, duration - from))
      this.voices.set(layer.id, { source, gain })
    }
    this.startTime = when
    this.startOffset = from
    this.endOffset = to
    this.playing = true
    this.endTimer = window.setTimeout(() => this.finish(), (length + 0.05) * 1000)
  }

  /** Plays one piece of audio on its own, e.g. an effect preview. */
  async playClip(audio: AudioData): Promise<void> {
    await this.play([{ id: 'clip', audio, gain: 1 }], 0, frameCount(audio) / audio.sampleRate)
  }

  /** Stops playback; the position stays where it stopped. */
  stop(): void {
    const position = this.position
    window.clearTimeout(this.endTimer)
    for (const voice of this.voices.values()) {
      voice.source.onended = null
      try {
        voice.source.stop()
      } catch {
        // Sources that never started cannot be stopped.
      }
      voice.source.disconnect()
      voice.gain.disconnect()
    }
    this.voices.clear()
    this.startOffset = position
    this.playing = false
  }

  /** Changes a layer's volume while it plays. */
  setGain(id: string, gain: number): void {
    const voice = this.voices.get(id)
    if (voice && this.context) voice.gain.gain.setTargetAtTime(gain, this.context.currentTime, 0.015)
  }

  private finish(): void {
    if (!this.playing) return
    this.stop()
    this.startOffset = this.endOffset
    this.onEnded?.()
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.context || this.context.state === 'closed') {
      this.context = new AudioContext({ latencyHint: 'interactive' })
    }
    if (this.context.state === 'suspended') await this.context.resume()
    return this.context
  }
}
