import { describe, expect, it } from 'vitest'
import { emptyAudio, frameCount } from '../../src/renderer/src/audio/audio-data'
import { applyEdit, replaceRange, revertEdit } from '../../src/renderer/src/audio/edits'
import { audio, samples } from './helpers'

describe('replaceRange', () => {
  const base = audio(8000, [1, 2, 3, 4, 5], [10, 20, 30, 40, 50])

  it('deletes a range', () => {
    const { data, edit } = replaceRange(base, 1, 3, emptyAudio(8000, 2))
    expect(samples(data, 0)).toEqual([1, 4, 5])
    expect(samples(data, 1)).toEqual([10, 40, 50])
    expect(edit.start).toBe(1)
    expect(samples(edit.removed, 0)).toEqual([2, 3])
  })

  it('inserts without removing', () => {
    const { data } = replaceRange(base, 2, 2, audio(8000, [7, 8], [70, 80]))
    expect(samples(data, 0)).toEqual([1, 2, 7, 8, 3, 4, 5])
    expect(samples(data, 1)).toEqual([10, 20, 70, 80, 30, 40, 50])
  })

  it('replaces a range with a segment of a different length', () => {
    const { data } = replaceRange(base, 0, 4, audio(8000, [9], [90]))
    expect(samples(data, 0)).toEqual([9, 5])
  })

  it('appends at the end', () => {
    const { data } = replaceRange(base, 5, 5, audio(8000, [6], [60]))
    expect(frameCount(data)).toBe(6)
    expect(samples(data, 0).at(-1)).toBe(6)
  })

  it('does not modify the input', () => {
    replaceRange(base, 0, 5, emptyAudio(8000, 2))
    expect(samples(base, 0)).toEqual([1, 2, 3, 4, 5])
  })

  it('rejects incompatible segments', () => {
    expect(() => replaceRange(base, 0, 0, audio(44100, [1], [1]))).toThrow(/Sample rate/)
    expect(() => replaceRange(base, 0, 0, audio(8000, [1]))).toThrow(/Channel count/)
  })
})

describe('applyEdit and revertEdit', () => {
  it('round-trips an edit', () => {
    const original = audio(8000, [1, 2, 3, 4])
    const { data, edit } = replaceRange(original, 1, 2, audio(8000, [7, 7, 7]))
    expect(samples(revertEdit(data, edit))).toEqual([1, 2, 3, 4])
    expect(samples(applyEdit(original, edit))).toEqual(samples(data))
  })
})
