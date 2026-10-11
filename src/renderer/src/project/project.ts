import {
  type AudioData,
  byteSize,
  clampRange,
  createAudioData,
  emptyAudio,
  frameCount,
  remixChannels,
  sliceAudio
} from '../audio/audio-data'
import { type Edit, applyEdit, replaceRange, revertEdit } from '../audio/edits'
import { peakLevel } from '../audio/effects'
import { History } from '../audio/history'

export type EditKind =
  | 'record'
  | 'cut'
  | 'paste'
  | 'delete'
  | 'trim'
  | 'effect'
  | 'addLayer'
  | 'removeLayer'
  | 'importLayer'
  | 'duplicateLayer'

/** A frame range on the shared timeline, with start < end. */
export interface Selection {
  start: number
  end: number
}

/** One layer (track). Layers all start at time 0 and play on top of each other. */
export interface Layer {
  readonly id: string
  readonly name: string
  readonly audio: AudioData
  /** Linear volume: 1 = as recorded, 0 = silent, 2 = twice as loud (+6 dB). */
  readonly volume: number
  readonly muted: boolean
  readonly solo: boolean
  /** Index into the layer colour palette. */
  readonly color: number
}

export type LayerProps = Pick<Layer, 'name' | 'volume' | 'muted' | 'solo' | 'color'>

export interface StepLabel {
  kind: EditKind
  /** Effect id for 'effect' steps, layer name for layer steps. */
  detail?: string
}

export type ChangeKind =
  | 'audio'
  | 'layers'
  | 'mix'
  | 'active'
  | 'selection'
  | 'cursor'
  | 'file'
  | 'history'
  | 'clipboard'

export interface ProjectSnapshot {
  layers: readonly Layer[]
  activeLayerId: string | null
  sampleRate: number
  /** Length of the longest layer in frames. */
  length: number
  hasAudio: boolean
  fileName: string | null
  filePath: string | null
  dirty: boolean
  selection: Selection | null
  cursor: number
  canUndo: boolean
  canRedo: boolean
  undoLabel: StepLabel | undefined
  redoLabel: StepLabel | undefined
  hasClipboard: boolean
  /** Increments whenever samples or layers change, so views know when to redraw. */
  revision: number
}

export interface EditResult {
  /** True when the result has peaks above 0 dBFS that integer WAV formats will clip. */
  clipped: boolean
}

/** Everything a .suara project file stores. */
export interface ProjectData {
  sampleRate: number
  activeLayer: number
  layers: (LayerProps & { audio: AudioData })[]
}

export interface ProjectDependencies {
  /** Converts audio to the given sample rate and channel count (resampling as needed). */
  convert(audio: AudioData, sampleRate: number, channelCount: number): Promise<AudioData>
  /** Name for a new, unnamed layer: "Layer 3". */
  layerName(index: number): string
  historyBytes?: number
  defaultSampleRate?: number
}

export const LAYER_COLORS = 8
export const MAX_LAYER_VOLUME = 2
const MAX_CHANNELS = 2

export class ProjectError extends Error {
  constructor(
    readonly code: 'no-layer' | 'no-audio' | 'no-selection' | 'empty-clipboard' | 'silent' | 'outside-layer'
  ) {
    super(code)
  }
}

type Change =
  | { type: 'audio'; layerId: string; edits: Edit[] }
  | { type: 'add'; layer: Layer; index: number }
  | { type: 'remove'; layer: Layer; index: number }

interface Step {
  label: StepLabel
  id: number
  changes: Change[]
  selectionBefore: Selection | null
  selectionAfter: Selection | null
  activeBefore: string | null
  activeAfter: string | null
  cursorAfter: number
}

export interface RecordingTarget {
  /** Record into a brand new layer instead of the active one. */
  newLayer?: boolean
  /** Timeline frame where the take starts; defaults to the cursor (or the selection). */
  at?: number
}

/**
 * The open project: layers, the active layer, selection, cursor, clipboard and undo history.
 * Positions are sample frames on the shared timeline. Edits apply to the active layer and go
 * through `commit`, which records what is needed to undo them, so undo and redo work across
 * every layer.
 */
export class Project {
  private layers: Layer[] = []
  private activeId: string | null = null
  private sampleRate: number
  private selection: Selection | null = null
  private cursor = 0
  private clipboard: AudioData | null = null
  private fileName: string | null = null
  private filePath: string | null = null
  private readonly history: History<Step>
  private nextStepId = 1
  private savedStepId = 0
  private mixRevision = 0
  private savedMixRevision = 0
  private revision = 0
  private nextLayerId = 1
  private namedLayers = 0
  private readonly listeners = new Set<(changes: ReadonlySet<ChangeKind>) => void>()

  constructor(private readonly deps: ProjectDependencies) {
    this.history = new History<Step>(deps.historyBytes)
    this.sampleRate = deps.defaultSampleRate ?? 48000
  }

  onChange(listener: (changes: ReadonlySet<ChangeKind>) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot(): ProjectSnapshot {
    return {
      layers: [...this.layers],
      activeLayerId: this.activeId,
      sampleRate: this.sampleRate,
      length: this.length(),
      hasAudio: this.hasAudio,
      fileName: this.fileName,
      filePath: this.filePath,
      dirty: this.isDirty(),
      selection: this.selection,
      cursor: this.cursor,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.nextUndo?.label,
      redoLabel: this.history.nextRedo?.label,
      hasClipboard: this.clipboard !== null,
      revision: this.revision
    }
  }

  get hasAudio(): boolean {
    return this.layers.some((layer) => frameCount(layer.audio) > 0)
  }

  getLayers(): readonly Layer[] {
    return this.layers
  }

  getLayer(id: string): Layer | undefined {
    return this.layers.find((layer) => layer.id === id)
  }

  activeLayer(): Layer | null {
    return this.activeId ? (this.getLayer(this.activeId) ?? null) : null
  }

  getSampleRate(): number {
    return this.sampleRate
  }

  getSelection(): Selection | null {
    return this.selection
  }

  getCursor(): number {
    return this.cursor
  }

  /** Length of the longest layer in frames. */
  length(): number {
    return this.layers.reduce((max, layer) => Math.max(max, frameCount(layer.audio)), 0)
  }

  isDirty(): boolean {
    return this.currentStepId() !== this.savedStepId || this.mixRevision !== this.savedMixRevision
  }

  // ---- Project lifecycle -----------------------------------------------------------------

  newProject(): void {
    this.reset(this.deps.defaultSampleRate ?? 48000, [], null, null)
  }

  /** Starts a new project with one layer holding audio read from a file. */
  loadAudio(audio: AudioData, layerName: string, fileName: string): void {
    const layer = this.createLayer(layerName, this.limitChannels(audio), 0)
    this.reset(audio.sampleRate, [layer], fileName, null)
  }

  /** Replaces the project with one read from a .suara file. */
  loadProject(data: ProjectData, fileName: string, filePath: string): void {
    const layers = data.layers.map((stored) => ({
      ...this.createLayer(stored.name, stored.audio, stored.color),
      volume: clampVolume(stored.volume),
      muted: stored.muted,
      solo: stored.solo
    }))
    this.reset(data.sampleRate, layers, fileName, filePath)
    const active = layers[data.activeLayer]
    if (active) this.activeId = active.id
  }

  /** The project as stored in a .suara file. */
  toProjectData(): ProjectData {
    return {
      sampleRate: this.sampleRate,
      activeLayer: Math.max(0, this.layers.findIndex((layer) => layer.id === this.activeId)),
      layers: this.layers.map(({ name, volume, muted, solo, color, audio }) => ({
        name,
        volume,
        muted,
        solo,
        color,
        audio
      }))
    }
  }

  markSaved(fileName: string, filePath: string): void {
    this.fileName = fileName
    this.filePath = filePath
    this.savedStepId = this.currentStepId()
    this.savedMixRevision = this.mixRevision
    this.emit('file', 'history')
  }

  // ---- Layers ------------------------------------------------------------------------------

  /** Adds an empty layer below the others and makes it active. */
  addLayer(name?: string): Layer {
    const layer = this.createLayer(name ?? this.nextDefaultName(), emptyAudio(this.sampleRate, 1))
    this.commit({ kind: 'addLayer', detail: layer.name }, [{ type: 'add', layer, index: this.layers.length }], {
      active: layer.id
    })
    return layer
  }

  /** Adds audio from a file as a new layer, converted to the project's sample rate. */
  async importLayer(audio: AudioData, name: string): Promise<EditResult> {
    const sampleRate = this.hasAudio ? this.sampleRate : audio.sampleRate
    const limited = this.limitChannels(audio)
    const converted = await this.deps.convert(limited, sampleRate, limited.channels.length)
    if (!this.hasAudio) this.sampleRate = sampleRate
    const layer = this.createLayer(name, converted)
    this.commit({ kind: 'importLayer', detail: name }, [{ type: 'add', layer, index: this.layers.length }], {
      active: layer.id,
      selection: null
    })
    return { clipped: peakLevel(converted) > 1 }
  }

  duplicateLayer(id: string, name: string): Layer {
    const index = this.indexOf(id)
    const source = this.layers[index]!
    const copy: Layer = { ...source, id: this.newLayerId(), name, color: this.nextColor(), solo: false }
    this.commit({ kind: 'duplicateLayer', detail: source.name }, [{ type: 'add', layer: copy, index: index + 1 }], {
      active: copy.id
    })
    return copy
  }

  removeLayer(id: string): void {
    const index = this.indexOf(id)
    const layer = this.layers[index]!
    const neighbour = this.layers[index + 1] ?? this.layers[index - 1] ?? null
    this.commit({ kind: 'removeLayer', detail: layer.name }, [{ type: 'remove', layer, index }], {
      active: this.activeId === id ? (neighbour?.id ?? null) : this.activeId
    })
  }

  setActiveLayer(id: string | null): void {
    if (id !== null) this.indexOf(id)
    if (id === this.activeId) return
    this.activeId = id
    this.emit('active')
  }

  renameLayer(id: string, name: string): void {
    const trimmed = name.trim()
    if (trimmed === '') return
    this.updateProps(id, { name: trimmed }, 'layers')
  }

  setLayerVolume(id: string, volume: number): void {
    this.updateProps(id, { volume: clampVolume(volume) }, 'mix')
  }

  setLayerMuted(id: string, muted: boolean): void {
    this.updateProps(id, { muted }, 'mix')
  }

  setLayerSolo(id: string, solo: boolean): void {
    this.updateProps(id, { solo }, 'mix')
  }

  // ---- Selection and cursor ------------------------------------------------------------------

  setSelection(selection: Selection | null): void {
    const next = this.normalizeSelection(selection)
    if (sameSelection(next, this.selection)) return
    this.selection = next
    this.emit('selection')
  }

  setCursor(frame: number): void {
    const next = Math.min(Math.max(Math.round(frame), 0), this.length())
    if (next === this.cursor) return
    this.cursor = next
    this.emit('cursor')
  }

  /** Selects the whole active layer (or the whole timeline when it is empty). */
  selectAll(): void {
    const active = this.activeLayer()
    const end = active && frameCount(active.audio) > 0 ? frameCount(active.audio) : this.length()
    if (end > 0) this.setSelection({ start: 0, end })
  }

  // ---- Editing the active layer ----------------------------------------------------------------

  /** Puts a recording into the active (or a new) layer at the cursor, replacing any selection. */
  async insertRecording(recording: AudioData, target: RecordingTarget = {}): Promise<EditResult> {
    if (frameCount(recording) === 0) return { clipped: false }
    const sampleRate = this.hasAudio ? this.sampleRate : recording.sampleRate
    let layer = target.newLayer ? null : this.activeLayer()
    const channels = layer && frameCount(layer.audio) > 0 ? layer.audio.channels.length : recording.channels.length
    const segment = await this.deps.convert(this.limitChannels(recording), sampleRate, Math.min(channels, MAX_CHANNELS))
    if (!this.hasAudio) this.sampleRate = sampleRate
    const changes: Change[] = []
    if (!layer) {
      layer = this.createLayer(this.nextDefaultName(), emptyAudio(sampleRate, segment.channels.length))
      changes.push({ type: 'add', layer, index: this.layers.length })
    }
    const range =
      target.at !== undefined ? { start: target.at, end: target.at } : (this.selection ?? { start: this.cursor, end: this.cursor })
    this.insertInto(layer, range, segment, { kind: 'record' }, changes, false)
    return { clipped: peakLevel(segment) > 1 }
  }

  cut(): void {
    const { layer, range } = this.requireSelectionInLayer()
    this.setClipboard(sliceAudio(layer.audio, range.start, range.end))
    this.removeRange(layer, range, { kind: 'cut' })
  }

  copy(): void {
    const { layer, range } = this.requireSelectionInLayer()
    this.setClipboard(sliceAudio(layer.audio, range.start, range.end))
  }

  async paste(): Promise<EditResult> {
    if (!this.clipboard) throw new ProjectError('empty-clipboard')
    let layer = this.activeLayer()
    const changes: Change[] = []
    const channels =
      layer && frameCount(layer.audio) > 0 ? layer.audio.channels.length : this.clipboard.channels.length
    const segment = await this.deps.convert(this.clipboard, this.sampleRate, channels)
    if (!layer) {
      layer = this.createLayer(this.nextDefaultName(), emptyAudio(this.sampleRate, channels))
      changes.push({ type: 'add', layer, index: this.layers.length })
    }
    const range = this.selection ?? { start: this.cursor, end: this.cursor }
    this.insertInto(layer, range, segment, { kind: 'paste' }, changes, true)
    return { clipped: peakLevel(segment) > 1 }
  }

  deleteSelection(): void {
    const { layer, range } = this.requireSelectionInLayer()
    this.removeRange(layer, range, { kind: 'delete' })
  }

  /**
   * Keeps only the selected part of the active layer. When other layers have audio the kept part
   * stays where it is (the start becomes silence) so the layers stay in sync; otherwise it moves
   * to the start.
   */
  trimToSelection(): void {
    const { layer, range } = this.requireSelectionInLayer()
    const audio = layer.audio
    const length = frameCount(audio)
    const keepPosition = this.layers.some((other) => other.id !== layer.id && frameCount(other.audio) > 0)
    if (range.start === 0 && range.end === length) return
    const empty = emptyAudio(audio.sampleRate, audio.channels.length)
    const tail = replaceRange(audio, range.end, length, empty)
    const head = keepPosition
      ? replaceRange(tail.data, 0, range.start, silentLike(audio, range.start))
      : replaceRange(tail.data, 0, range.start, empty)
    const selectionAfter = keepPosition ? range : { start: 0, end: range.end - range.start }
    this.commit({ kind: 'trim' }, [{ type: 'audio', layerId: layer.id, edits: [tail.edit, head.edit] }], {
      selection: selectionAfter,
      cursor: selectionAfter.start
    })
  }

  /**
   * Runs an effect over part of the active layer: `range`, else the selection, else the whole
   * layer. When the range reaches the end of the layer, `tailFrames` of silence are added first
   * so echoes and reverb can ring out instead of being cut off.
   */
  applyEffect(
    effectId: string,
    process: (segment: AudioData) => AudioData,
    options: { range?: Selection; tailFrames?: number } = {}
  ): EditResult {
    const layer = this.requireActiveWithAudio()
    const length = frameCount(layer.audio)
    const wanted = options.range ?? this.selection ?? { start: 0, end: length }
    const [start, end] = clampRange(layer.audio, wanted.start, wanted.end)
    if (end <= start) throw new ProjectError('outside-layer')
    let segment = sliceAudio(layer.audio, start, end)
    const tail = Math.max(0, Math.round(options.tailFrames ?? 0))
    if (tail > 0 && end === length) segment = appendSilence(segment, tail)
    const processed = process(segment)
    if (processed.channels.length !== segment.channels.length || processed.sampleRate !== segment.sampleRate) {
      throw new RangeError('An effect must keep the sample rate and channel count')
    }
    const { edit } = replaceRange(layer.audio, start, end, processed)
    const hadSelection = this.selection !== null
    const processedEnd = start + frameCount(processed)
    this.commit({ kind: 'effect', detail: effectId }, [{ type: 'audio', layerId: layer.id, edits: [edit] }], {
      selection: hadSelection && processedEnd > start ? { start, end: processedEnd } : null,
      cursor: this.cursor
    })
    return { clipped: peakLevel(processed) > 1 }
  }

  undo(): boolean {
    const step = this.history.undo()
    if (!step) return false
    for (const change of [...step.changes].reverse()) this.revertChange(change)
    this.activeId = this.existingLayerId(step.activeBefore)
    this.selection = this.normalizeSelection(step.selectionBefore)
    this.cursor = Math.min(this.selection?.start ?? this.cursor, this.length())
    this.revision++
    this.emit('audio', 'layers', 'active', 'history', 'selection', 'cursor')
    return true
  }

  redo(): boolean {
    const step = this.history.redo()
    if (!step) return false
    for (const change of step.changes) this.applyChange(change)
    this.activeId = this.existingLayerId(step.activeAfter)
    this.selection = this.normalizeSelection(step.selectionAfter)
    this.cursor = Math.min(this.selection?.start ?? step.cursorAfter, this.length())
    this.revision++
    this.emit('audio', 'layers', 'active', 'history', 'selection', 'cursor')
    return true
  }

  // ---- Internals ------------------------------------------------------------------------------

  /** Replaces `range` of the layer with `segment`, padding with silence when it starts past the end. */
  private insertInto(
    layer: Layer,
    range: Selection,
    segment: AudioData,
    label: StepLabel,
    changes: Change[],
    selectInserted: boolean
  ): void {
    let audio = layer.audio
    // An empty layer takes the layout of whatever goes into it first.
    if (
      frameCount(audio) === 0 &&
      (audio.channels.length !== segment.channels.length || audio.sampleRate !== segment.sampleRate)
    ) {
      audio = emptyAudio(segment.sampleRate, segment.channels.length)
      layer = { ...layer, audio }
      const added = changes.find((change) => change.type === 'add' && change.layer.id === layer.id)
      if (added && added.type === 'add') added.layer = layer
      else this.replaceLayer(layer)
    }
    const fitted = remixChannels(segment, audio.channels.length)
    const length = frameCount(audio)
    const start = Math.max(0, Math.round(range.start))
    let edit: Edit
    if (start > length) {
      // The take starts after the end of this layer: fill the gap with silence.
      const padded = prependSilence(fitted, start - length)
      edit = replaceRange(audio, length, length, padded).edit
    } else {
      edit = replaceRange(audio, start, Math.max(start, Math.round(range.end)), fitted).edit
    }
    const end = start + frameCount(fitted)
    changes.push({ type: 'audio', layerId: layer.id, edits: [edit] })
    this.commit(label, changes, {
      active: layer.id,
      // Pasted audio stays selected so it can be moved again; after recording the cursor simply
      // sits at the end of the take, so an accidental Delete can't wipe it.
      selection: selectInserted ? { start, end } : null,
      cursor: end
    })
  }

  private removeRange(layer: Layer, range: Selection, label: StepLabel): void {
    const empty = emptyAudio(layer.audio.sampleRate, layer.audio.channels.length)
    const { edit } = replaceRange(layer.audio, range.start, range.end, empty)
    this.commit(label, [{ type: 'audio', layerId: layer.id, edits: [edit] }], { selection: null, cursor: range.start })
  }

  private commit(
    label: StepLabel,
    changes: Change[],
    after: { selection?: Selection | null; cursor?: number; active?: string | null }
  ): void {
    const step: Step = {
      label,
      id: this.nextStepId++,
      changes,
      selectionBefore: this.selection,
      selectionAfter: null,
      activeBefore: this.activeId,
      activeAfter: after.active === undefined ? this.activeId : after.active,
      cursorAfter: 0
    }
    for (const change of changes) this.applyChange(change)
    this.activeId = this.existingLayerId(step.activeAfter)
    this.selection = this.normalizeSelection(after.selection === undefined ? this.selection : after.selection)
    step.selectionAfter = this.selection
    this.cursor = Math.min(Math.max(Math.round(after.cursor ?? this.cursor), 0), this.length())
    step.cursorAfter = this.cursor
    this.history.push(step, stepBytes(changes))
    this.revision++
    this.emit('audio', 'layers', 'active', 'history', 'selection', 'cursor')
  }

  private applyChange(change: Change): void {
    switch (change.type) {
      case 'audio': {
        const layer = this.getLayer(change.layerId)
        if (!layer) return
        let audio = layer.audio
        for (const edit of change.edits) audio = applyEdit(audio, edit)
        this.replaceLayer({ ...layer, audio })
        return
      }
      case 'add':
        this.layers.splice(Math.min(change.index, this.layers.length), 0, change.layer)
        return
      case 'remove': {
        const index = this.layers.findIndex((layer) => layer.id === change.layer.id)
        if (index < 0) return
        // Keep the latest props (volume, name…) so undoing the removal brings them back.
        change.layer = this.layers[index]!
        change.index = index
        this.layers.splice(index, 1)
        return
      }
    }
  }

  private revertChange(change: Change): void {
    switch (change.type) {
      case 'audio': {
        const layer = this.getLayer(change.layerId)
        if (!layer) return
        let audio = layer.audio
        for (const edit of [...change.edits].reverse()) audio = revertEdit(audio, edit)
        this.replaceLayer({ ...layer, audio })
        return
      }
      case 'add': {
        const index = this.layers.findIndex((layer) => layer.id === change.layer.id)
        if (index < 0) return
        change.layer = this.layers[index]!
        this.layers.splice(index, 1)
        return
      }
      case 'remove':
        this.layers.splice(Math.min(change.index, this.layers.length), 0, change.layer)
        return
    }
  }

  private updateProps(id: string, props: Partial<LayerProps>, change: ChangeKind): void {
    const layer = this.layers[this.indexOf(id)]!
    const next = { ...layer, ...props }
    if (
      next.name === layer.name &&
      next.volume === layer.volume &&
      next.muted === layer.muted &&
      next.solo === layer.solo &&
      next.color === layer.color
    ) {
      return
    }
    this.replaceLayer(next)
    this.mixRevision++
    this.emit(change, 'history')
  }

  private replaceLayer(layer: Layer): void {
    const index = this.layers.findIndex((existing) => existing.id === layer.id)
    if (index >= 0) this.layers[index] = layer
  }

  private reset(sampleRate: number, layers: Layer[], fileName: string | null, filePath: string | null): void {
    this.sampleRate = sampleRate
    this.layers = layers
    this.activeId = layers[0]?.id ?? null
    this.fileName = fileName
    this.filePath = filePath
    this.selection = null
    this.cursor = 0
    this.history.clear()
    this.savedStepId = 0
    this.mixRevision = 0
    this.savedMixRevision = 0
    this.namedLayers = layers.length
    this.revision++
    this.emit('audio', 'layers', 'mix', 'active', 'file', 'history', 'selection', 'cursor')
  }

  private createLayer(name: string, audio: AudioData, color = this.nextColor()): Layer {
    return { id: this.newLayerId(), name, audio, volume: 1, muted: false, solo: false, color }
  }

  private newLayerId(): string {
    return `layer-${this.nextLayerId++}`
  }

  private nextDefaultName(): string {
    this.namedLayers = Math.max(this.namedLayers, this.layers.length) + 1
    return this.deps.layerName(this.namedLayers)
  }

  private nextColor(): number {
    const used = new Set(this.layers.map((layer) => layer.color))
    for (let i = 0; i < LAYER_COLORS; i++) {
      const color = (this.layers.length + i) % LAYER_COLORS
      if (!used.has(color)) return color
    }
    return this.layers.length % LAYER_COLORS
  }

  private limitChannels(audio: AudioData): AudioData {
    return audio.channels.length > MAX_CHANNELS ? remixChannels(audio, MAX_CHANNELS) : audio
  }

  private indexOf(id: string): number {
    const index = this.layers.findIndex((layer) => layer.id === id)
    if (index < 0) throw new ProjectError('no-layer')
    return index
  }

  private existingLayerId(id: string | null): string | null {
    if (id && this.getLayer(id)) return id
    return this.layers[0]?.id ?? null
  }

  private requireActiveWithAudio(): Layer {
    const layer = this.activeLayer()
    if (!layer) throw new ProjectError('no-layer')
    if (frameCount(layer.audio) === 0) throw new ProjectError('no-audio')
    return layer
  }

  /** The selection clipped to the active layer. */
  private requireSelectionInLayer(): { layer: Layer; range: Selection } {
    const layer = this.requireActiveWithAudio()
    if (!this.selection) throw new ProjectError('no-selection')
    const [start, end] = clampRange(layer.audio, this.selection.start, this.selection.end)
    if (end <= start) throw new ProjectError('outside-layer')
    return { layer, range: { start, end } }
  }

  private normalizeSelection(selection: Selection | null): Selection | null {
    if (!selection) return null
    const length = this.length()
    const a = Math.min(Math.max(Math.round(selection.start), 0), length)
    const b = Math.min(Math.max(Math.round(selection.end), 0), length)
    const [start, end] = a <= b ? [a, b] : [b, a]
    return end > start ? { start, end } : null
  }

  private setClipboard(audio: AudioData): void {
    this.clipboard = audio
    this.emit('clipboard')
  }

  private currentStepId(): number {
    return this.history.nextUndo?.id ?? 0
  }

  private emit(...changes: ChangeKind[]): void {
    const set = new Set(changes)
    for (const listener of this.listeners) listener(set)
  }
}

function sameSelection(a: Selection | null, b: Selection | null): boolean {
  return a === b || (a !== null && b !== null && a.start === b.start && a.end === b.end)
}

function clampVolume(volume: number): number {
  return Number.isFinite(volume) ? Math.min(Math.max(volume, 0), MAX_LAYER_VOLUME) : 1
}

function silentLike(audio: AudioData, frames: number): AudioData {
  return createAudioData(
    audio.sampleRate,
    audio.channels.map(() => new Float32Array(Math.max(0, frames)))
  )
}

function prependSilence(audio: AudioData, frames: number): AudioData {
  return createAudioData(
    audio.sampleRate,
    audio.channels.map((channel) => {
      const out = new Float32Array(frames + channel.length)
      out.set(channel, frames)
      return out
    })
  )
}

function appendSilence(audio: AudioData, frames: number): AudioData {
  return createAudioData(
    audio.sampleRate,
    audio.channels.map((channel) => {
      const out = new Float32Array(channel.length + frames)
      out.set(channel, 0)
      return out
    })
  )
}

function stepBytes(changes: Change[]): number {
  return changes.reduce((sum, change) => {
    if (change.type === 'audio') {
      return sum + change.edits.reduce((total, edit) => total + byteSize(edit.removed) + byteSize(edit.inserted), 0)
    }
    return sum + byteSize(change.layer.audio)
  }, 0)
}
