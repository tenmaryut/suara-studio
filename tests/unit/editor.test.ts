import { describe, expect, it } from 'vitest'
import { frameCount } from '../../src/renderer/src/audio/audio-data'
import { peakLevel } from '../../src/renderer/src/audio/effects'
import { decodeWav } from '../../src/renderer/src/audio/wav'
import { Editor, EditorError } from '../../src/renderer/src/editor/editor'
import { audio, samples, testConvert } from './helpers'

function editorWith(data = audio(10, [1, 2, 3, 4, 5, 6])): Editor {
  const editor = new Editor({ convert: testConvert })
  editor.load(data, 'take.wav', '/music/take.wav')
  return editor
}

describe('Editor document state', () => {
  it('starts empty and clean', () => {
    const editor = new Editor({ convert: testConvert })
    const state = editor.snapshot()
    expect(state.audio).toBeNull()
    expect(state.dirty).toBe(false)
    expect(state.canUndo).toBe(false)
  })

  it('tracks unsaved changes through undo and save', () => {
    const editor = editorWith()
    expect(editor.isDirty()).toBe(false)
    editor.setSelection({ start: 0, end: 2 })
    editor.deleteSelection()
    expect(editor.isDirty()).toBe(true)
    editor.undo()
    expect(editor.isDirty()).toBe(false)
    editor.redo()
    editor.markSaved('take.wav', '/music/take.wav')
    expect(editor.isDirty()).toBe(false)
    editor.undo()
    expect(editor.isDirty()).toBe(true)
  })

  it('notifies listeners about what changed', () => {
    const editor = editorWith()
    const seen: string[][] = []
    editor.onChange((changes) => seen.push([...changes]))
    editor.setSelection({ start: 1, end: 3 })
    editor.setSelection({ start: 1, end: 3 })
    editor.setCursor(4)
    expect(seen).toEqual([['selection'], ['cursor']])
  })
})

describe('Editor selection', () => {
  it('normalises and clamps selections', () => {
    const editor = editorWith()
    editor.setSelection({ start: 5, end: 2 })
    expect(editor.getSelection()).toEqual({ start: 2, end: 5 })
    editor.setSelection({ start: 3, end: 3 })
    expect(editor.getSelection()).toBeNull()
    editor.selectAll()
    expect(editor.getSelection()).toEqual({ start: 0, end: 6 })
  })

  it('requires a selection for cut, copy, delete and trim', () => {
    const editor = editorWith()
    for (const action of [
      () => editor.cut(),
      () => editor.copy(),
      () => editor.deleteSelection(),
      () => editor.trimToSelection()
    ]) {
      expect(action).toThrow(EditorError)
    }
  })
})

describe('Editor clipboard', () => {
  it('cuts and pastes at the cursor', async () => {
    const editor = editorWith()
    editor.setSelection({ start: 1, end: 3 })
    editor.cut()
    expect(samples(editor.getAudio()!)).toEqual([1, 4, 5, 6])
    expect(editor.getCursor()).toBe(1)
    expect(editor.getSelection()).toBeNull()

    editor.setCursor(4)
    await editor.paste()
    expect(samples(editor.getAudio()!)).toEqual([1, 4, 5, 6, 2, 3])
    expect(editor.getSelection()).toEqual({ start: 4, end: 6 })
  })

  it('pastes over a selection', async () => {
    const editor = editorWith()
    editor.setSelection({ start: 0, end: 1 })
    editor.copy()
    editor.setSelection({ start: 2, end: 5 })
    await editor.paste()
    expect(samples(editor.getAudio()!)).toEqual([1, 2, 1, 6])
  })

  it('refuses to paste an empty clipboard', async () => {
    await expect(editorWith().paste()).rejects.toThrow(EditorError)
  })
})

describe('Editor editing', () => {
  it('trims to the selection and undoes it in one step', () => {
    const editor = editorWith()
    editor.setSelection({ start: 2, end: 4 })
    editor.trimToSelection()
    expect(samples(editor.getAudio()!)).toEqual([3, 4])
    expect(editor.getSelection()).toEqual({ start: 0, end: 2 })
    editor.undo()
    expect(samples(editor.getAudio()!)).toEqual([1, 2, 3, 4, 5, 6])
    expect(editor.getSelection()).toEqual({ start: 2, end: 4 })
    editor.redo()
    expect(samples(editor.getAudio()!)).toEqual([3, 4])
  })

  it('applies effects to the selection only', () => {
    const editor = editorWith()
    editor.setSelection({ start: 0, end: 2 })
    editor.silence()
    expect(samples(editor.getAudio()!)).toEqual([0, 0, 3, 4, 5, 6])
    expect(editor.getSelection()).toEqual({ start: 0, end: 2 })
  })

  it('applies effects to everything when nothing is selected', () => {
    const editor = editorWith(audio(10, [0.1, -0.25, 0.2]))
    editor.normalize(0)
    expect(peakLevel(editor.getAudio()!)).toBeCloseTo(1, 5)
    editor.reverse()
    expect(samples(editor.getAudio()!)[0]).toBeCloseTo(0.8, 5)
    expect(editor.snapshot().undoKind).toBe('reverse')
  })

  it('reports clipping after amplifying', () => {
    const editor = editorWith(audio(10, [0.5, -0.5]))
    expect(editor.amplify(12).clipped).toBe(true)
    expect(editor.amplify(-24).clipped).toBe(false)
  })

  it('refuses to normalize silence', () => {
    const editor = editorWith(audio(10, [0, 0, 0]))
    expect(() => editor.normalize(-1)).toThrow(EditorError)
  })
})

describe('Editor recording', () => {
  it('creates a document from the first recording', async () => {
    const editor = new Editor({ convert: testConvert })
    await editor.insertRecording(audio(48000, [0.1, 0.2, 0.3]))
    const state = editor.snapshot()
    expect(frameCount(state.audio!)).toBe(3)
    expect(state.audio!.sampleRate).toBe(48000)
    expect(state.dirty).toBe(true)
    expect(state.undoKind).toBe('record')
    expect(state.selection).toBeNull()
    expect(state.cursor).toBe(3)
    editor.undo()
    expect(editor.hasAudio).toBe(false)
  })

  it('converts recordings to the document format', async () => {
    const editor = editorWith(audio(10, [1, 2], [1, 2]))
    editor.setCursor(1)
    await editor.insertRecording(audio(20, [9, 9, 9, 9]))
    const result = editor.getAudio()!
    expect(result.channels).toHaveLength(2)
    expect(samples(result, 0)).toEqual([1, 9, 9, 2])
    expect(samples(result, 1)).toEqual([1, 9, 9, 2])
  })
})

describe('Editor export', () => {
  it('exports the document as WAV', () => {
    const editor = editorWith(audio(8000, [0.5, -0.5]))
    const decoded = decodeWav(editor.exportWav('float32'))
    expect(decoded.sampleRate).toBe(8000)
    expect(samples(decoded)).toEqual([0.5, -0.5])
  })
})
