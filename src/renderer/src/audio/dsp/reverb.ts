import { type AudioData, cloneAudio, createAudioData, frameCount } from '../audio-data'

export interface ReverbOptions {
  /** 0..1: bigger rooms ring for longer. */
  roomSize: number
  /** 0..1: how quickly high frequencies die away in the tail. */
  damping: number
  /** 0..1: 0 leaves the audio dry; 1 adds the full reverb to the dry signal at half level. */
  mix: number
}

// Jezar's Freeverb tuning (public domain). Delay lengths are in samples at 44.1 kHz.
const TUNING_RATE = 44100
const COMB_LENGTHS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_LENGTHS = [556, 441, 341, 225]
const STEREO_SPREAD = 23
const FIXED_GAIN = 0.015
const SCALE_WET = 3
const SCALE_DAMP = 0.4
const SCALE_ROOM = 0.28
const OFFSET_ROOM = 0.7
const ALLPASS_FEEDBACK = 0.5
/** Tail state below this is flushed to zero so the decay never turns into slow denormals. */
const DENORMAL_LIMIT = 1e-20

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

/** Delay length in samples for a tuning value given at 44.1 kHz. */
function tuned(length: number, sampleRate: number): number {
  return Math.max(1, Math.round((length * sampleRate) / TUNING_RATE))
}

/**
 * One Freeverb channel: 8 lowpass-feedback combs in parallel, then 4 allpasses in series.
 * Each filter runs over the whole signal in turn, which keeps the inner loops tight.
 */
function freeverb(
  input: Float64Array,
  spread: number,
  sampleRate: number,
  feedback: number,
  damp: number
): Float64Array {
  const length = input.length
  const out = new Float64Array(length)
  const keep = 1 - damp
  for (const tuning of COMB_LENGTHS) {
    const size = tuned(tuning + spread, sampleRate)
    const buffer = new Float64Array(size)
    let index = 0
    let store = 0
    for (let i = 0; i < length; i++) {
      const delayed = buffer[index]!
      store = delayed * keep + store * damp
      if (store < DENORMAL_LIMIT && store > -DENORMAL_LIMIT) store = 0
      buffer[index] = input[i]! + store * feedback
      if (++index === size) index = 0
      out[i]! += delayed
    }
  }
  for (const tuning of ALLPASS_LENGTHS) {
    const size = tuned(tuning + spread, sampleRate)
    const buffer = new Float64Array(size)
    let index = 0
    for (let i = 0; i < length; i++) {
      let delayed = buffer[index]!
      if (delayed < DENORMAL_LIMIT && delayed > -DENORMAL_LIMIT) delayed = 0
      const x = out[i]!
      buffer[index] = x + delayed * ALLPASS_FEEDBACK
      if (++index === size) index = 0
      out[i] = delayed - x
    }
  }
  return out
}

/** Freeverb-style room reverb (8 damped comb filters + 4 allpasses per channel). */
export function reverb(data: AudioData, options: ReverbOptions): AudioData {
  const mix = clamp(options.mix, 0, 1)
  if (mix === 0) return cloneAudio(data)
  const { sampleRate } = data
  const length = frameCount(data)
  const feedback = clamp(options.roomSize, 0, 1) * SCALE_ROOM + OFFSET_ROOM
  const damp = clamp(options.damping, 0, 1) * SCALE_DAMP
  // Every tail is fed the same mono sum, as in Freeverb. Scaling by the channel count makes a
  // mono file reverberate as loudly as the same sound in both channels of a stereo file.
  const input = new Float64Array(length)
  for (const channel of data.channels) {
    for (let i = 0; i < length; i++) input[i]! += channel[i]!
  }
  const gain = (FIXED_GAIN * 2) / data.channels.length
  for (let i = 0; i < length; i++) input[i]! *= gain
  const left = freeverb(input, 0, sampleRate, feedback, damp)
  // Mono uses the left tuning; with more than two channels, even ones get the left tail.
  const right =
    data.channels.length > 1 ? freeverb(input, STEREO_SPREAD, sampleRate, feedback, damp) : left
  const dry = 1 - 0.5 * mix
  const wet = mix * SCALE_WET
  const channels = data.channels.map((source, c) => {
    const tail = c % 2 === 0 ? left : right
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) out[i] = source[i]! * dry + wet * tail[i]!
    return out
  })
  return createAudioData(sampleRate, channels)
}
