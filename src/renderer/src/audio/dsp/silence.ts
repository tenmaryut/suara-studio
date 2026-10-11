import { type AudioData, createAudioData, frameCount } from '../audio-data'
import { dbToGain } from '../effects'

export interface TruncateSilenceOptions {
  /** Level in dBFS (-120..0) below which audio counts as silence. */
  thresholdDb: number
  /** Pauses longer than this are shortened. */
  minSilenceSeconds: number
  /** Length a shortened pause keeps; pauses are never made longer. */
  keepSeconds: number
}

const MIN_DB = -120
/** Longest crossfade at a cut; it is shorter when less of the pause is kept. */
const CROSSFADE_SECONDS = 0.005

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

/** [start, end) ranges longer than `minFrames` where every channel stays below `threshold`. */
function findPauses(data: AudioData, threshold: number, minFrames: number): [number, number][] {
  const length = frameCount(data)
  const loud = new Uint8Array(length)
  for (const channel of data.channels) {
    for (let i = 0; i < length; i++) {
      if (Math.abs(channel[i]!) >= threshold) loud[i] = 1
    }
  }
  const pauses: [number, number][] = []
  let start = 0
  for (let i = 0; i <= length; i++) {
    if (i < length && loud[i] === 0) continue
    if (i - start > minFrames) pauses.push([start, i])
    start = i + 1
  }
  return pauses
}

/**
 * Shortens every pause longer than minSilenceSeconds to keepSeconds (pauses are where all
 * channels stay below the threshold).
 */
export function truncateSilence(data: AudioData, options: TruncateSilenceOptions): AudioData {
  const { sampleRate } = data
  const threshold = dbToGain(clamp(options.thresholdDb, MIN_DB, 0))
  const toFrames = (seconds: number): number =>
    Math.round(clamp(seconds * sampleRate, 0, Number.MAX_SAFE_INTEGER))
  const keep = toFrames(options.keepSeconds)
  const pauses = findPauses(data, threshold, Math.max(toFrames(options.minSilenceSeconds), keep))
  const removed = pauses.reduce((sum, [start, end]) => sum + end - start - keep, 0)
  // The first half of what is kept comes from the start of the pause and the rest from its end.
  // The crossfade between them is centred on the cut and borrows frames from the removed middle.
  const fade = Math.min(toFrames(CROSSFADE_SECONDS), keep)
  const fadeStart = Math.floor(keep / 2) - Math.floor(fade / 2)
  const fadeIn = Float64Array.from(
    { length: fade },
    (_, t) => 0.5 - 0.5 * Math.cos((Math.PI * (t + 0.5)) / fade)
  )
  const channels = data.channels.map((input) => {
    const out = new Float32Array(input.length - removed)
    let read = 0
    let write = 0
    for (const [start, end] of pauses) {
      const cut = start + fadeStart
      out.set(input.subarray(read, cut), write)
      write += cut - read
      // The frame near the end of the pause that follows `cut` in the output.
      const resume = end - keep + fadeStart
      for (let t = 0; t < fade; t++) {
        const w = fadeIn[t]!
        out[write++] = input[cut + t]! * (1 - w) + input[resume + t]! * w
      }
      read = resume + fade
    }
    out.set(input.subarray(read), write)
    return out
  })
  return createAudioData(sampleRate, channels)
}
