import { type AudioData, clampRange, createAudioData, frameCount, sliceAudio } from './audio-data'

/**
 * One reversible change to a document: the frames removed at `start` and the frames put
 * in their place. Every editing operation (cut, paste, effects, recording) is expressed
 * as an Edit, so undo and redo are the same primitive run in opposite directions.
 */
export interface Edit {
  readonly start: number
  readonly removed: AudioData
  readonly inserted: AudioData
}

function assertCompatible(data: AudioData, segment: AudioData): void {
  if (segment.sampleRate !== data.sampleRate) {
    throw new RangeError(
      `Sample rate mismatch: document ${data.sampleRate} Hz, segment ${segment.sampleRate} Hz`
    )
  }
  if (segment.channels.length !== data.channels.length) {
    throw new RangeError(
      `Channel count mismatch: document ${data.channels.length}, segment ${segment.channels.length}`
    )
  }
}

/** Replaces frames [start, end) of `data` with `segment`, returning the new audio and the Edit. */
export function replaceRange(
  data: AudioData,
  start: number,
  end: number,
  segment: AudioData
): { data: AudioData; edit: Edit } {
  assertCompatible(data, segment)
  const [a, b] = clampRange(data, start, end)
  const removed = sliceAudio(data, a, b)
  const insertLength = frameCount(segment)
  const length = frameCount(data) - (b - a) + insertLength
  const channels = data.channels.map((source, c) => {
    const out = new Float32Array(length)
    out.set(source.subarray(0, a), 0)
    out.set(segment.channels[c]!, a)
    out.set(source.subarray(b), a + insertLength)
    return out
  })
  return {
    data: createAudioData(data.sampleRate, channels),
    edit: { start: a, removed, inserted: segment }
  }
}

export function applyEdit(data: AudioData, edit: Edit): AudioData {
  return replaceRange(data, edit.start, edit.start + frameCount(edit.removed), edit.inserted).data
}

export function revertEdit(data: AudioData, edit: Edit): AudioData {
  return replaceRange(data, edit.start, edit.start + frameCount(edit.inserted), edit.removed).data
}
