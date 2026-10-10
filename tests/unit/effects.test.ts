import { describe, expect, it } from 'vitest'
import {
  applyGain,
  dbToGain,
  fadeIn,
  fadeOut,
  gainToDb,
  normalize,
  peakLevel,
  reverse,
  silence
} from '../../src/renderer/src/audio/effects'
import { audio, samples } from './helpers'

describe('gain helpers', () => {
  it('converts between dB and linear gain', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(-6)).toBeCloseTo(0.501, 3)
    expect(gainToDb(1)).toBe(0)
    expect(gainToDb(0)).toBe(-Infinity)
  })

  it('finds the peak across channels', () => {
    expect(peakLevel(audio(8000, [0.1, -0.8], [0.5, 0.2]))).toBeCloseTo(0.8)
  })
})

describe('applyGain and normalize', () => {
  it('amplifies by decibels', () => {
    const louder = applyGain(audio(8000, [0.25, -0.25]), 6.0206)
    expect(samples(louder)[0]).toBeCloseTo(0.5, 4)
    expect(samples(louder)[1]).toBeCloseTo(-0.5, 4)
  })

  it('normalizes the peak to the target level', () => {
    const result = normalize(audio(8000, [0.1, -0.2, 0.05]), 0)
    expect(peakLevel(result)).toBeCloseTo(1, 5)
    expect(samples(result)[0]).toBeCloseTo(0.5, 5)
  })

  it('leaves silence untouched', () => {
    expect(samples(normalize(audio(8000, [0, 0]), -1))).toEqual([0, 0])
  })
})

describe('fades', () => {
  const flat = audio(8000, [1, 1, 1, 1, 1])

  it('fades in from silence to full level', () => {
    const result = samples(fadeIn(flat, 'linear'))
    expect(result[0]).toBe(0)
    expect(result[2]).toBeCloseTo(0.5)
    expect(result[4]).toBe(1)
  })

  it('fades out from full level to silence', () => {
    const result = samples(fadeOut(flat, 'sine'))
    expect(result[0]).toBe(1)
    expect(result[4]).toBeCloseTo(0, 6)
    expect(result[2]).toBeCloseTo(Math.SQRT1_2, 5)
  })
})

describe('silence and reverse', () => {
  it('silences every channel', () => {
    const result = silence(audio(8000, [0.3, 0.4], [0.5, 0.6]))
    expect(samples(result, 0)).toEqual([0, 0])
    expect(samples(result, 1)).toEqual([0, 0])
  })

  it('reverses samples without touching the input', () => {
    const input = audio(8000, [1, 2, 3])
    expect(samples(reverse(input))).toEqual([3, 2, 1])
    expect(samples(input)).toEqual([1, 2, 3])
  })
})
