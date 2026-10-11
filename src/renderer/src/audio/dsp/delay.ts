import { type AudioData, cloneAudio, createAudioData, frameCount } from '../audio-data'

export interface EchoOptions {
  /** Time between repeats in seconds (at least one sample). */
  delaySeconds: number
  /** Level of each repeat relative to the one before, clamped to 0..0.95. */
  feedback: number
  /** Level of the echoes added to the original, clamped to 0..1. */
  mix: number
}

const MAX_FEEDBACK = 0.95
/** Echo state below this is flushed to zero so decaying repeats never turn into slow denormals. */
const DENORMAL_LIMIT = 1e-20

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

/** Repeating echo: out = x + mix * w, where w[n] = x[n - D] + feedback * w[n - D]. */
export function echo(data: AudioData, options: EchoOptions): AudioData {
  const length = frameCount(data)
  const mix = clamp(options.mix, 0, 1)
  const feedback = clamp(options.feedback, 0, MAX_FEEDBACK)
  const delay = clamp(Math.round(options.delaySeconds * data.sampleRate), 1, Number.MAX_SAFE_INTEGER)
  // Without mix, or with the first repeat past the end, the output is the input.
  if (mix === 0 || delay >= length) return cloneAudio(data)
  // w[n - D] for the last D frames, as a ring buffer.
  const history = new Float64Array(delay)
  const channels = data.channels.map((input) => {
    const out = input.slice()
    history.fill(0)
    let index = 0
    for (let i = delay; i < length; i++) {
      let wet = input[i - delay]! + feedback * history[index]!
      if (wet < DENORMAL_LIMIT && wet > -DENORMAL_LIMIT) wet = 0
      history[index] = wet
      if (++index === delay) index = 0
      out[i] = input[i]! + mix * wet
    }
    return out
  })
  return createAudioData(data.sampleRate, channels)
}
