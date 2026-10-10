import {
  type AudioData,
  byteSize,
  clampRange,
  emptyAudio,
  frameCount,
  sliceAudio
} from '../audio/audio-data'
import { type Edit, applyEdit, replaceRange, revertEdit } from '../audio/edits'
import { applyGain, fadeIn, fadeOut, normalize, peakLevel, reverse, silence } from '../audio/effects'
import { History } from '../audio/history'
import { type WavFormat, encodeWav } from '../audio/wav'

export type EditKind =
  | 'record'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'trim'
  | 'silence'
  | 'fadeIn'
  | 'fadeOut'
  | 'normalize'
  | 'amplify'
  | 'reverse'

/** A frame range with start < end. */
export interface Selection {
  start: number
  end: number
}

export type ChangeKind = 'audio' | 'selection' | 'cursor' | 'file' | 'history' | 'clipboard'

export interface EditorSnapshot {
  audio: AudioData | null
  fileName: string | null
  filePath: string | null
  dirty: boolean
  selection: Selection | null
  cursor: number
  canUndo: boolean
  canRedo: boolean
  undoKind: EditKind | undefined
  redoKind: EditKind | undefined
  hasClipboard: boolean
  /** Increments whenever the audio samples change, so views know when to redraw. */
  audioRevision: number
}

export interface EditResult {
  /** True when the result has peaks above 0 dBFS that integer WAV formats will clip. */
  clipped: boolean
}

export interface EditorDependencies {
  /** Converts audio to the given sample rate and channel count (resampling as needed). */
  convert(audio: AudioData, sampleRate: number, channelCount: number): Promise<AudioData>
  historyBytes?: number
}

interface Step {
  kind: EditKind
  id: number
  edits: Edit[]
  /** Selection to restore after undoing (null clears it). */
  selectionBefore: Selection | null
  /** Selection to restore after redoing. */
  selectionAfter: Selection | null
}

export class EditorError extends Error {
  constructor(readonly code: 'no-audio' | 'no-selection' | 'empty-clipboard' | 'silent') {
    super(code)
  }
}

/**
 * The open document: audio samples, selection, cursor, clipboard and undo history.
 * Positions are in sample frames. All editing goes through `commit`, which records the
 * Edits needed to undo it.
 */
export class Editor {
  private audio: AudioData | null = null
  private selection: Selection | null = null
  private cursor = 0
  private clipboard: AudioData | null = null
  private fileName: string | null = null
  private filePath: string | null = null
  private readonly history: History<Step>
  private nextStepId = 1
  private savedStepId = 0
  private audioRevision = 0
  private readonly listeners = new Set<(changes: ReadonlySet<ChangeKind>) => void>()

  constructor(private readonly deps: EditorDependencies) {
    this.history = new History<Step>(deps.historyBytes)
  }

  onChange(listener: (changes: ReadonlySet<ChangeKind>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): EditorSnapshot {
    return {
      audio: this.audio,
      fileName: this.fileName,
      filePath: this.filePath,
      dirty: this.isDirty(),
      selection: this.selection,
      cursor: this.cursor,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoKind: this.history.nextUndo?.kind,
      redoKind: this.history.nextRedo?.kind,
      hasClipboard: this.clipboard !== null,
      audioRevision: this.audioRevision
    }
  }

  get hasAudio(): boolean {
    return this.audio !== null && frameCount(this.audio) > 0
  }

  getAudio(): AudioData | null {
    return this.audio
  }

  getSelection(): Selection | null {
    return this.selection
  }

  getCursor(): number {
    return this.cursor
  }

  isDirty(): boolean {
    return this.currentStepId() !== this.savedStepId
  }

  // ---- Document lifecycle -------------------------------------------------------------

  newDocument(): void {
    this.audio = null
    this.fileName = null
    this.filePath = null
    this.resetHistory()
    this.selection = null
    this.cursor = 0
    this.audioRevision++
    this.emit('audio', 'file', 'history', 'selection', 'cursor')
  }

  /** Replaces the document with audio read from a file. */
  load(audio: AudioData, fileName: string, filePath: string | null): void {
    this.audio = audio
    this.fileName = fileName
    this.filePath = filePath
    this.resetHistory()
    this.selection = null
    this.cursor = 0
    this.audioRevision++
    this.emit('audio', 'file', 'history', 'selection', 'cursor')
  }

  markSaved(fileName: string, filePath: string): void {
    this.fileName = fileName
    this.filePath = filePath
    this.savedStepId = this.currentStepId()
    this.emit('file', 'history')
  }

  exportWav(format: WavFormat): ArrayBuffer {
    if (!this.audio) throw new EditorError('no-audio')
    return encodeWav(this.audio, format)
  }

  // ---- Selection and cursor ------------------------------------------------------------

  setSelection(selection: Selection | null): void {
    const next = this.normalizeSelection(selection)
    if (sameSelection(next, this.selection)) return
    this.selection = next
    this.emit('selection')
  }

  setCursor(frame: number): void {
    const length = this.audio ? frameCount(this.audio) : 0
    const next = Math.min(Math.max(Math.round(frame), 0), length)
    if (next === this.cursor) return
    this.cursor = next
    this.emit('cursor')
  }

  selectAll(): void {
    if (!this.audio || frameCount(this.audio) === 0) return
    this.setSelection({ start: 0, end: frameCount(this.audio) })
  }

  // ---- Editing ----------------------------------------------------------------------

  /** Inserts a recording at the cursor, or replaces the selection with it. */
  async insertRecording(recording: AudioData): Promise<EditResult> {
    if (frameCount(recording) === 0) return { clipped: false }
    if (!this.audio) {
      this.audio = emptyAudio(recording.sampleRate, recording.channels.length)
      this.cursor = 0
    }
    const segment = await this.deps.convert(
      recording,
      this.audio.sampleRate,
      this.audio.channels.length
    )
    return this.insertSegment('record', segment)
  }

  cut(): void {
    const { audio, selection } = this.requireSelection()
    this.setClipboard(sliceAudio(audio, selection.start, selection.end))
    this.removeRange('cut', selection)
  }

  copy(): void {
    const { audio, selection } = this.requireSelection()
    this.setClipboard(sliceAudio(audio, selection.start, selection.end))
  }

  async paste(): Promise<EditResult> {
    if (!this.clipboard) throw new EditorError('empty-clipboard')
    if (!this.audio) {
      this.audio = emptyAudio(this.clipboard.sampleRate, this.clipboard.channels.length)
      this.cursor = 0
    }
    const segment = await this.deps.convert(
      this.clipboard,
      this.audio.sampleRate,
      this.audio.channels.length
    )
    return this.insertSegment('paste', segment)
  }

  deleteSelection(): void {
    const { selection } = this.requireSelection()
    this.removeRange('delete', selection)
  }

  /** Keeps only the selection. */
  trimToSelection(): void {
    const { audio, selection } = this.requireSelection()
    const length = frameCount(audio)
    if (selection.start === 0 && selection.end === length) return
    const empty = emptyAudio(audio.sampleRate, audio.channels.length)
    const tail = replaceRange(audio, selection.end, length, empty)
    const head = replaceRange(tail.data, 0, selection.start, empty)
    const kept = selection.end - selection.start
    this.commit('trim', head.data, [tail.edit, head.edit], { start: 0, end: kept }, 0)
  }

  silence(): EditResult {
    return this.transformRange('silence', silence)
  }

  fadeIn(): EditResult {
    return this.transformRange('fadeIn', (segment) => fadeIn(segment))
  }

  fadeOut(): EditResult {
    return this.transformRange('fadeOut', (segment) => fadeOut(segment))
  }

  reverse(): EditResult {
    return this.transformRange('reverse', reverse)
  }

  amplify(db: number): EditResult {
    return this.transformRange('amplify', (segment) => applyGain(segment, db))
  }

  normalize(targetDb: number): EditResult {
    const audio = this.requireAudio()
    const [start, end] = this.effectRange(audio)
    if (peakLevel(sliceAudio(audio, start, end)) === 0) throw new EditorError('silent')
    return this.transformRange('normalize', (segment) => normalize(segment, targetDb))
  }

  undo(): boolean {
    const step = this.history.undo()
    if (!step || !this.audio) return false
    let audio = this.audio
    for (const edit of [...step.edits].reverse()) audio = revertEdit(audio, edit)
    this.audio = audio
    this.selection = this.normalizeSelection(step.selectionBefore)
    this.cursor = Math.min(this.selection?.start ?? this.cursor, frameCount(audio))
    this.audioRevision++
    this.emit('audio', 'history', 'selection', 'cursor')
    return true
  }

  redo(): boolean {
    const step = this.history.redo()
    if (!step || !this.audio) return false
    let audio = this.audio
    for (const edit of step.edits) audio = applyEdit(audio, edit)
    this.audio = audio
    this.selection = this.normalizeSelection(step.selectionAfter)
    this.cursor = Math.min(this.selection?.start ?? this.cursor, frameCount(audio))
    this.audioRevision++
    this.emit('audio', 'history', 'selection', 'cursor')
    return true
  }

  // ---- Internals ----------------------------------------------------------------------

  private insertSegment(kind: EditKind, segment: AudioData): EditResult {
    const audio = this.requireAudio(true)
    const target = this.selection ?? { start: this.cursor, end: this.cursor }
    const { data, edit } = replaceRange(audio, target.start, target.end, segment)
    const end = edit.start + frameCount(segment)
    // Pasted audio stays selected so it can be moved again; after recording the cursor simply
    // sits at the end of the take, so an accidental Delete can't wipe it.
    const selectionAfter = kind === 'paste' ? { start: edit.start, end } : null
    this.commit(kind, data, [edit], selectionAfter, end)
    return { clipped: peakLevel(segment) > 1 }
  }

  private removeRange(kind: EditKind, range: Selection): void {
    const audio = this.requireAudio()
    const empty = emptyAudio(audio.sampleRate, audio.channels.length)
    const { data, edit } = replaceRange(audio, range.start, range.end, empty)
    this.commit(kind, data, [edit], null, range.start)
  }

  private transformRange(kind: EditKind, transform: (segment: AudioData) => AudioData): EditResult {
    const audio = this.requireAudio()
    const [start, end] = this.effectRange(audio)
    const processed = transform(sliceAudio(audio, start, end))
    const { data, edit } = replaceRange(audio, start, end, processed)
    this.commit(kind, data, [edit], this.selection, this.cursor)
    return { clipped: peakLevel(processed) > 1 }
  }

  /** The selection, or the whole document when nothing is selected. */
  private effectRange(audio: AudioData): [number, number] {
    return this.selection
      ? clampRange(audio, this.selection.start, this.selection.end)
      : [0, frameCount(audio)]
  }

  private commit(
    kind: EditKind,
    audio: AudioData,
    edits: Edit[],
    selectionAfter: Selection | null,
    cursorAfter: number
  ): void {
    const step: Step = {
      kind,
      id: this.nextStepId++,
      edits,
      selectionBefore: this.selection,
      selectionAfter
    }
    const bytes = edits.reduce((sum, edit) => sum + byteSize(edit.removed) + byteSize(edit.inserted), 0)
    this.history.push(step, bytes)
    this.audio = audio
    this.selection = this.normalizeSelection(selectionAfter)
    this.cursor = Math.min(Math.max(cursorAfter, 0), frameCount(audio))
    this.audioRevision++
    this.emit('audio', 'history', 'selection', 'cursor')
  }

  private requireAudio(allowEmpty = false): AudioData {
    if (!this.audio || (!allowEmpty && frameCount(this.audio) === 0)) {
      throw new EditorError('no-audio')
    }
    return this.audio
  }

  private requireSelection(): { audio: AudioData; selection: Selection } {
    const audio = this.requireAudio()
    if (!this.selection) throw new EditorError('no-selection')
    return { audio, selection: this.selection }
  }

  private normalizeSelection(selection: Selection | null): Selection | null {
    if (!selection || !this.audio) return null
    const [start, end] = clampRange(this.audio, selection.start, selection.end)
    return end > start ? { start, end } : null
  }

  private setClipboard(audio: AudioData): void {
    this.clipboard = audio
    this.emit('clipboard')
  }

  private currentStepId(): number {
    return this.history.nextUndo?.id ?? 0
  }

  private resetHistory(): void {
    this.history.clear()
    this.savedStepId = 0
  }

  private emit(...changes: ChangeKind[]): void {
    const set = new Set(changes)
    for (const listener of this.listeners) listener(set)
  }
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end)
}
