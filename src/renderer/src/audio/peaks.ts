import { type AudioData, frameCount } from './audio-data'

/** Frames summarised by one entry of the finest peak level. */
export const BASE_BLOCK = 64

interface PeakLevel {
  /** Frames per entry. */
  block: number
  min: Float32Array
  max: Float32Array
}

/**
 * Min/max summaries of audio at block sizes 64, 128, 256…, all channels combined, so a
 * waveform can be drawn at any zoom level without scanning every sample.
 */
export interface PeakPyramid {
  readonly length: number
  readonly levels: readonly PeakLevel[]
}

export function buildPeaks(audio: AudioData): PeakPyramid {
  const length = frameCount(audio)
  const count = Math.ceil(length / BASE_BLOCK)
  const min = new Float32Array(count).fill(Infinity)
  const max = new Float32Array(count).fill(-Infinity)
  for (const channel of audio.channels) {
    for (let b = 0; b < count; b++) {
      const end = Math.min(length, (b + 1) * BASE_BLOCK)
      let lo = min[b]!
      let hi = max[b]!
      for (let i = b * BASE_BLOCK; i < end; i++) {
        const value = channel[i]!
        if (value < lo) lo = value
        if (value > hi) hi = value
      }
      min[b] = lo
      max[b] = hi
    }
  }
  const levels: PeakLevel[] = [{ block: BASE_BLOCK, min, max }]
  while (levels.at(-1)!.min.length > 1) {
    const previous = levels.at(-1)!
    const size = Math.ceil(previous.min.length / 2)
    const nextMin = new Float32Array(size)
    const nextMax = new Float32Array(size)
    for (let i = 0; i < size; i++) {
      const a = 2 * i
      const b = Math.min(a + 1, previous.min.length - 1)
      nextMin[i] = Math.min(previous.min[a]!, previous.min[b]!)
      nextMax[i] = Math.max(previous.max[a]!, previous.max[b]!)
    }
    levels.push({ block: previous.block * 2, min: nextMin, max: nextMax })
  }
  return { length, levels }
}

/** Lowest and highest sample in frames [start, end) across all channels; [0, 0] when empty. */
export function peakRange(audio: AudioData, peaks: PeakPyramid, start: number, end: number): [number, number] {
  const from = Math.max(0, Math.floor(start))
  const to = Math.min(peaks.length, Math.ceil(end))
  if (to <= from) return [0, 0]
  let lo = Infinity
  let hi = -Infinity
  if (to - from < BASE_BLOCK * 2) {
    for (const channel of audio.channels) {
      for (let i = from; i < to; i++) {
        const value = channel[i]!
        if (value < lo) lo = value
        if (value > hi) hi = value
      }
    }
    return [lo, hi]
  }
  // Use the coarsest level whose blocks still fit the range at least twice.
  let level = peaks.levels[0]!
  for (const candidate of peaks.levels) {
    if (candidate.block * 2 > to - from) break
    level = candidate
  }
  const first = Math.floor(from / level.block)
  const last = Math.min(level.min.length, Math.ceil(to / level.block))
  for (let b = first; b < last; b++) {
    if (level.min[b]! < lo) lo = level.min[b]!
    if (level.max[b]! > hi) hi = level.max[b]!
  }
  return [lo, hi]
}
