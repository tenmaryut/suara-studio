import { type AudioData, cloneAudio, createAudioData, frameCount } from '../audio-data'

export interface RingModOptions {
  /** Carrier frequency in Hz (0..half the sample rate). */
  frequency: number
  /** 0..1: share of the ring-modulated signal. */
  mix: number
}

export interface TremoloOptions {
  /** Wobbles per second (0..half the sample rate). */
  rate: number
  /** 0..1: how far the volume dips at the bottom of each wobble. */
  depth: number
}

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

/** Multiplies every channel by `gainAt(frame)`. */
function modulate(data: AudioData, gainAt: (frame: number) => number): AudioData {
  const length = frameCount(data)
  const gains = new Float64Array(length)
  for (let i = 0; i < length; i++) gains[i] = gainAt(i)
  const channels = data.channels.map((input) => {
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) out[i] = input[i]! * gains[i]!
    return out
  })
  return createAudioData(data.sampleRate, channels)
}

/** Angular frequency in radians per frame. */
function radiansPerFrame(frequency: number, sampleRate: number): number {
  return (2 * Math.PI * clamp(frequency, 0, sampleRate / 2)) / sampleRate
}

/** Ring modulation ("robot voice"): out = (1 - mix) * x + mix * x * sin(2*pi*f*t). */
export function ringModulate(data: AudioData, options: RingModOptions): AudioData {
  const mix = clamp(options.mix, 0, 1)
  if (mix === 0) return cloneAudio(data)
  const omega = radiansPerFrame(options.frequency, data.sampleRate)
  return modulate(data, (i) => 1 - mix + mix * Math.sin(omega * i))
}

/**
 * Tremolo: volume wobbles at `rate` Hz by `depth` (0..1):
 * gain = 1 - depth * (0.5 - 0.5 * cos(2*pi*rate*t)).
 */
export function tremolo(data: AudioData, options: TremoloOptions): AudioData {
  const depth = clamp(options.depth, 0, 1)
  if (depth === 0) return cloneAudio(data)
  const omega = radiansPerFrame(options.rate, data.sampleRate)
  return modulate(data, (i) => 1 - depth * (0.5 - 0.5 * Math.cos(omega * i)))
}
