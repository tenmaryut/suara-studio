import { describe, expect, it } from 'vitest'
import { createAudioData } from '../../src/renderer/src/audio/audio-data'
import { BASE_BLOCK, buildPeaks, peakRange } from '../../src/renderer/src/audio/peaks'
import { audio } from './helpers'

function noise(length: number, seed = 1): Float32Array {
  let state = seed
  return Float32Array.from({ length }, () => {
    state = (state * 16807) % 2147483647
    return state / 2147483647 - 0.5
  })
}

function bruteForce(channels: Float32Array[], start: number, end: number): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const channel of channels) {
    for (let i = start; i < end; i++) {
      lo = Math.min(lo, channel[i]!)
      hi = Math.max(hi, channel[i]!)
    }
  }
  return [lo, hi]
}

describe('peaks', () => {
  it('summarises all channels at every level', () => {
    const peaks = buildPeaks(audio(10, [0.1, -0.5, 0.2], [0.9, 0, -0.1]))
    expect(peaks.length).toBe(3)
    expect(peaks.levels).toHaveLength(1)
    expect(peaks.levels[0]!.min[0]).toBeCloseTo(-0.5)
    expect(peaks.levels[0]!.max[0]).toBeCloseTo(0.9)
  })

  it('matches a brute-force scan for any range', () => {
    const channels = [noise(50_000, 7), noise(50_000, 11)]
    const data = createAudioData(48000, channels)
    const peaks = buildPeaks(data)
    expect(peaks.levels[1]!.block).toBe(BASE_BLOCK * 2)
    for (const [start, end] of [
      [0, 10],
      [5, 300],
      [1000, 1000 + BASE_BLOCK * 4],
      [0, 50_000],
      [12_345, 40_000]
    ] as const) {
      const [lo, hi] = peakRange(data, peaks, start, end)
      const [expectedLo, expectedHi] = bruteForce(channels, start, end)
      // Block summaries may include a few frames outside the range, never fewer.
      expect(lo).toBeLessThanOrEqual(expectedLo)
      expect(hi).toBeGreaterThanOrEqual(expectedHi)
      expect(expectedLo - lo).toBeLessThan(0.05)
      expect(hi - expectedHi).toBeLessThan(0.05)
    }
  })

  it('returns zero for empty ranges', () => {
    const data = audio(10, [1, 2, 3])
    expect(peakRange(data, buildPeaks(data), 5, 9)).toEqual([0, 0])
    const empty = audio(10, [])
    expect(peakRange(empty, buildPeaks(empty), 0, 10)).toEqual([0, 0])
  })
})
