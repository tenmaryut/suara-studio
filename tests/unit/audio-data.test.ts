import { describe, expect, it } from 'vitest'
import {
  byteSize,
  clampRange,
  concatChunks,
  createAudioData,
  durationOf,
  emptyAudio,
  frameCount,
  remixChannels,
  sliceAudio
} from '../../src/renderer/src/audio/audio-data'
import { audio, samples } from './helpers'

describe('createAudioData', () => {
  it('rejects invalid input', () => {
    expect(() => createAudioData(0, [new Float32Array(1)])).toThrow(RangeError)
    expect(() => createAudioData(44100, [])).toThrow(RangeError)
    expect(() => createAudioData(44100, [new Float32Array(2), new Float32Array(3)])).toThrow(
      RangeError
    )
  })

  it('reports length, duration and memory size', () => {
    const data = audio(4, [0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0])
    expect(frameCount(data)).toBe(8)
    expect(durationOf(data)).toBe(2)
    expect(byteSize(data)).toBe(8 * 2 * 4)
    expect(frameCount(emptyAudio(48000, 2))).toBe(0)
  })
})

describe('clampRange and sliceAudio', () => {
  const data = audio(10, [1, 2, 3, 4, 5])

  it('orders and clamps ranges', () => {
    expect(clampRange(data, 4, 1)).toEqual([1, 4])
    expect(clampRange(data, -3, 99)).toEqual([0, 5])
  })

  it('copies a range', () => {
    const part = sliceAudio(data, 1, 3)
    expect(samples(part)).toEqual([2, 3])
    part.channels[0]![0] = 99
    expect(samples(data)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('concatChunks', () => {
  it('joins recorder chunks in order', () => {
    const joined = concatChunks(8000, [
      [Float32Array.from([1, 2]), Float32Array.from([5, 6])],
      [Float32Array.from([3]), Float32Array.from([7])]
    ])
    expect(joined.sampleRate).toBe(8000)
    expect(samples(joined, 0)).toEqual([1, 2, 3])
    expect(samples(joined, 1)).toEqual([5, 6, 7])
  })
})

describe('remixChannels', () => {
  it('duplicates mono into stereo', () => {
    const stereo = remixChannels(audio(8000, [0.5, -0.5]), 2)
    expect(samples(stereo, 0)).toEqual([0.5, -0.5])
    expect(samples(stereo, 1)).toEqual([0.5, -0.5])
  })

  it('averages stereo into mono', () => {
    const mono = remixChannels(audio(8000, [1, 0], [0, 1]), 1)
    expect(samples(mono)).toEqual([0.5, 0.5])
  })

  it('returns the same object when nothing changes', () => {
    const data = audio(8000, [1])
    expect(remixChannels(data, 1)).toBe(data)
  })
})
