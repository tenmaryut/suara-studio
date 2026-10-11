import { type AudioData, createAudioData, frameCount } from '../audio-data'

export type BiquadType =
  | 'lowpass'
  | 'highpass'
  | 'bandpass'
  | 'lowshelf'
  | 'highshelf'
  | 'peaking'
  | 'notch'

/** One second-order filter section. */
export interface BiquadSpec {
  type: BiquadType
  /** Cutoff, centre or shelf midpoint in Hz, clamped to 1 Hz..0.49 × the sample rate. */
  frequency: number
  /** Defaults to 0.7071 for lowpass, highpass and shelves and to 1 for the other types. */
  q?: number
  /** Boost (positive) or cut in dB for shelves and peaking sections. Defaults to 0. */
  gainDb?: number
}

interface Section {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

const MIN_Q = 0.01
const MAX_Q = 100
const MAX_GAIN_DB = 60
/** Filter state below this is flushed to zero so decaying tails never turn into slow denormals. */
const DENORMAL_LIMIT = 1e-20

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

function normalise(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Section {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

/** Coefficients from Robert Bristow-Johnson's Audio EQ Cookbook, normalised so a0 = 1. */
function designSection(spec: BiquadSpec, sampleRate: number): Section {
  const { type } = spec
  const nyquistLimit = 0.49 * sampleRate
  const frequency = clamp(spec.frequency, Math.min(1, nyquistLimit), nyquistLimit)
  const butterworth =
    type === 'lowpass' || type === 'highpass' || type === 'lowshelf' || type === 'highshelf'
  const q = clamp(spec.q ?? (butterworth ? Math.SQRT1_2 : 1), MIN_Q, MAX_Q)
  const a = Math.pow(10, clamp(spec.gainDb ?? 0, -MAX_GAIN_DB, MAX_GAIN_DB) / 40)
  const w0 = (2 * Math.PI * frequency) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * q)
  const shelf = 2 * Math.sqrt(a) * alpha
  switch (type) {
    case 'lowpass':
      return normalise((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
    case 'highpass':
      return normalise((1 + cos) / 2, -(1 + cos), (1 + cos) / 2, 1 + alpha, -2 * cos, 1 - alpha)
    case 'bandpass':
      return normalise(alpha, 0, -alpha, 1 + alpha, -2 * cos, 1 - alpha)
    case 'notch':
      return normalise(1, -2 * cos, 1, 1 + alpha, -2 * cos, 1 - alpha)
    case 'peaking':
      return normalise(1 + alpha * a, -2 * cos, 1 - alpha * a, 1 + alpha / a, -2 * cos, 1 - alpha / a)
    case 'lowshelf':
      return normalise(
        a * (a + 1 - (a - 1) * cos + shelf),
        2 * a * (a - 1 - (a + 1) * cos),
        a * (a + 1 - (a - 1) * cos - shelf),
        a + 1 + (a - 1) * cos + shelf,
        -2 * (a - 1 + (a + 1) * cos),
        a + 1 + (a - 1) * cos - shelf
      )
    case 'highshelf':
      return normalise(
        a * (a + 1 + (a - 1) * cos + shelf),
        -2 * a * (a - 1 + (a + 1) * cos),
        a * (a + 1 + (a - 1) * cos - shelf),
        a + 1 - (a - 1) * cos + shelf,
        2 * (a - 1 - (a + 1) * cos),
        a + 1 - (a - 1) * cos - shelf
      )
    default:
      throw new RangeError(`Unknown filter type: ${String(type)}`)
  }
}

/** Filters `buffer` in place (transposed direct form II), starting from silence. */
function runSection(buffer: Float64Array, { b0, b1, b2, a1, a2 }: Section): void {
  let z1 = 0
  let z2 = 0
  for (let i = 0; i < buffer.length; i++) {
    const x = buffer[i]!
    const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    if (z1 < DENORMAL_LIMIT && z1 > -DENORMAL_LIMIT) z1 = 0
    if (z2 < DENORMAL_LIMIT && z2 > -DENORMAL_LIMIT) z2 = 0
    buffer[i] = y
  }
}

/** Runs biquad sections in series over every channel (RBJ Audio EQ Cookbook coefficients). */
export function applyFilters(data: AudioData, specs: readonly BiquadSpec[]): AudioData {
  const sections = specs.map((spec) => designSection(spec, data.sampleRate))
  // Sections run in double precision; the result is rounded to 32 bits once at the end.
  const work = new Float64Array(frameCount(data))
  const channels = data.channels.map((input) => {
    work.set(input)
    for (const section of sections) runSection(work, section)
    const out = new Float32Array(work.length)
    out.set(work)
    return out
  })
  return createAudioData(data.sampleRate, channels)
}
