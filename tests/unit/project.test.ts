import { describe, expect, it } from 'vitest'
import { frameCount } from '../../src/renderer/src/audio/audio-data'
import { applyGain, reverse } from '../../src/renderer/src/audio/effects'
import { Project, ProjectError } from '../../src/renderer/src/project/project'
import { audio, samples, testConvert } from './helpers'

function newProject(): Project {
  return new Project({ convert: testConvert, layerName: (n) => `Layer ${n}`, defaultSampleRate: 10 })
}

/** A project with one 6-frame layer called "voice". */
function projectWith(data = audio(10, [1, 2, 3, 4, 5, 6])): Project {
  const project = newProject()
  project.loadAudio(data, 'voice', 'voice.wav')
  return project
}

function activeSamples(project: Project, channel = 0): number[] {
  return samples(project.activeLayer()!.audio, channel)
}

describe('Project state', () => {
  it('starts empty and clean', () => {
    const state = newProject().snapshot()
    expect(state.layers).toEqual([])
    expect(state.activeLayerId).toBeNull()
    expect(state.hasAudio).toBe(false)
    expect(state.dirty).toBe(false)
    expect(state.canUndo).toBe(false)
  })

  it('opens an audio file as a single active layer', () => {
    const project = projectWith()
    const state = project.snapshot()
    expect(state.layers.map((layer) => layer.name)).toEqual(['voice'])
    expect(state.activeLayerId).toBe(state.layers[0]!.id)
    expect(state.sampleRate).toBe(10)
    expect(state.length).toBe(6)
    expect(state.fileName).toBe('voice.wav')
    expect(state.filePath).toBeNull()
    expect(state.dirty).toBe(false)
  })

  it('tracks unsaved changes through undo, save and mixer changes', () => {
    const project = projectWith()
    project.setSelection({ start: 0, end: 2 })
    project.deleteSelection()
    expect(project.isDirty()).toBe(true)
    project.undo()
    expect(project.isDirty()).toBe(false)
    project.setLayerVolume(project.activeLayer()!.id, 0.5)
    expect(project.isDirty()).toBe(true)
    project.markSaved('song.suara', '/music/song.suara')
    expect(project.isDirty()).toBe(false)
    project.setLayerMuted(project.activeLayer()!.id, true)
    expect(project.isDirty()).toBe(true)
  })

  it('reports what changed to listeners', () => {
    const project = projectWith()
    const seen: string[][] = []
    project.onChange((changes) => seen.push([...changes]))
    project.setSelection({ start: 1, end: 3 })
    project.setSelection({ start: 1, end: 3 })
    project.setCursor(4)
    project.setLayerSolo(project.activeLayer()!.id, true)
    expect(seen).toEqual([['selection'], ['cursor'], ['mix', 'history']])
  })
})

describe('Project layers', () => {
  it('adds, names and activates empty layers, undoably', () => {
    const project = projectWith()
    const added = project.addLayer()
    expect(added.name).toBe('Layer 2')
    expect(project.activeLayer()?.id).toBe(added.id)
    expect(project.snapshot().undoLabel).toEqual({ kind: 'addLayer', detail: 'Layer 2' })
    project.undo()
    expect(project.getLayers()).toHaveLength(1)
    expect(project.activeLayer()?.name).toBe('voice')
    project.redo()
    expect(project.getLayers().map((layer) => layer.name)).toEqual(['voice', 'Layer 2'])
  })

  it('removes a layer and brings it back with its settings on undo', () => {
    const project = projectWith()
    const second = project.addLayer('music')
    project.setLayerVolume(second.id, 0.25)
    project.removeLayer(second.id)
    expect(project.getLayers()).toHaveLength(1)
    expect(project.activeLayer()?.name).toBe('voice')
    project.undo()
    const restored = project.getLayer(second.id)
    expect(restored?.volume).toBe(0.25)
    expect(project.activeLayer()?.id).toBe(second.id)
    project.redo()
    expect(project.getLayer(second.id)).toBeUndefined()
  })

  it('imports a file as a new layer at the project sample rate', async () => {
    const project = projectWith()
    await project.importLayer(audio(20, [1, 1, 2, 2], [3, 3, 4, 4]), 'music')
    const layer = project.activeLayer()!
    expect(layer.name).toBe('music')
    expect(layer.audio.sampleRate).toBe(10)
    expect(frameCount(layer.audio)).toBe(2)
    expect(layer.audio.channels).toHaveLength(2)
    expect(project.snapshot().undoLabel).toEqual({ kind: 'importLayer', detail: 'music' })
  })

  it('keeps the sample rate of the first file imported into an empty project', async () => {
    const project = newProject()
    await project.importLayer(audio(44100, [0.1, 0.2]), 'a')
    expect(project.getSampleRate()).toBe(44100)
  })

  it('limits imported audio to two channels', async () => {
    const project = projectWith()
    await project.importLayer(audio(10, [1], [2], [3], [4]), 'surround')
    expect(project.activeLayer()!.audio.channels).toHaveLength(2)
  })

  it('duplicates a layer without copying its samples', () => {
    const project = projectWith()
    const source = project.activeLayer()!
    const copy = project.duplicateLayer(source.id, 'voice copy')
    expect(copy.audio).toBe(source.audio)
    expect(project.getLayers().map((layer) => layer.name)).toEqual(['voice', 'voice copy'])
    expect(copy.color).not.toBe(source.color)
  })

  it('renames layers and ignores blank names', () => {
    const project = projectWith()
    const id = project.activeLayer()!.id
    project.renameLayer(id, '  lead vocal ')
    project.renameLayer(id, '   ')
    expect(project.getLayer(id)?.name).toBe('lead vocal')
  })

  it('clamps layer volume', () => {
    const project = projectWith()
    const id = project.activeLayer()!.id
    project.setLayerVolume(id, 5)
    expect(project.getLayer(id)?.volume).toBe(2)
    project.setLayerVolume(id, -1)
    expect(project.getLayer(id)?.volume).toBe(0)
  })
})

describe('Project editing', () => {
  it('edits only the active layer', () => {
    const project = projectWith()
    const voice = project.activeLayer()!
    project.addLayer('music')
    project.setActiveLayer(voice.id)
    project.setSelection({ start: 1, end: 3 })
    project.deleteSelection()
    expect(activeSamples(project)).toEqual([1, 4, 5, 6])
    expect(project.getLayers()[1]!.audio.channels[0]).toHaveLength(0)
  })

  it('cuts, copies and pastes within the active layer', async () => {
    const project = projectWith()
    project.setSelection({ start: 0, end: 2 })
    project.cut()
    expect(activeSamples(project)).toEqual([3, 4, 5, 6])
    expect(project.getSelection()).toBeNull()
    project.setCursor(4)
    await project.paste()
    expect(activeSamples(project)).toEqual([3, 4, 5, 6, 1, 2])
    expect(project.getSelection()).toEqual({ start: 4, end: 6 })
  })

  it('pastes into another layer, padding with silence past its end', async () => {
    const project = projectWith()
    project.setSelection({ start: 4, end: 6 })
    project.copy()
    const music = project.addLayer('music')
    project.setSelection(null)
    project.setCursor(3)
    await project.paste()
    expect(samples(project.getLayer(music.id)!.audio)).toEqual([0, 0, 0, 5, 6])
  })

  it('needs a selection inside the active layer', () => {
    const project = projectWith()
    const music = project.addLayer('music')
    project.setSelection({ start: 1, end: 2 })
    expect(() => project.deleteSelection()).toThrow(ProjectError)
    project.setActiveLayer(music.id)
    try {
      project.cut()
      expect.unreachable()
    } catch (error) {
      expect((error as ProjectError).code).toBe('no-audio')
    }
    project.setSelection(null)
    project.setActiveLayer(project.getLayers()[0]!.id)
    expect(() => project.copy()).toThrow(ProjectError)
  })

  it('trims a lone layer to the start of the timeline', () => {
    const project = projectWith()
    project.setSelection({ start: 2, end: 4 })
    project.trimToSelection()
    expect(activeSamples(project)).toEqual([3, 4])
    expect(project.getSelection()).toEqual({ start: 0, end: 2 })
    project.undo()
    expect(activeSamples(project)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps trimmed audio in place when other layers have audio', async () => {
    const project = projectWith()
    await project.importLayer(audio(10, [9, 9, 9, 9, 9, 9]), 'music')
    project.setActiveLayer(project.getLayers()[0]!.id)
    project.setSelection({ start: 2, end: 4 })
    project.trimToSelection()
    expect(activeSamples(project)).toEqual([0, 0, 3, 4])
    expect(project.getSelection()).toEqual({ start: 2, end: 4 })
  })

  it('applies effects to the selection, or the whole layer', () => {
    const project = projectWith()
    project.setSelection({ start: 0, end: 3 })
    project.applyEffect('reverse', reverse)
    expect(activeSamples(project)).toEqual([3, 2, 1, 4, 5, 6])
    expect(project.snapshot().undoLabel).toEqual({ kind: 'effect', detail: 'reverse' })
    project.setSelection(null)
    project.applyEffect('volume', (segment) => applyGain(segment, 6.0206))
    expect(activeSamples(project)[5]).toBeCloseTo(12, 3)
  })

  it('lets effects ring out past the end of the layer', () => {
    const project = projectWith()
    project.applyEffect('echo', (segment) => segment, { tailFrames: 4 })
    expect(activeSamples(project)).toEqual([1, 2, 3, 4, 5, 6, 0, 0, 0, 0])
    project.undo()
    project.setSelection({ start: 0, end: 3 })
    project.applyEffect('echo', (segment) => segment, { tailFrames: 4 })
    expect(activeSamples(project)).toHaveLength(6)
  })

  it('rejects effects that change the channel layout', () => {
    const project = projectWith()
    expect(() => project.applyEffect('bad', () => audio(10, [1], [1]))).toThrow(RangeError)
  })

  it('selects the active layer for select all', () => {
    const project = projectWith()
    project.selectAll()
    expect(project.getSelection()).toEqual({ start: 0, end: 6 })
  })
})

describe('Project recording', () => {
  it('creates the first layer and takes the recording sample rate', async () => {
    const project = newProject()
    await project.insertRecording(audio(8000, [0.1, 0.2, 0.3]))
    const state = project.snapshot()
    expect(state.layers.map((layer) => layer.name)).toEqual(['Layer 1'])
    expect(state.sampleRate).toBe(8000)
    expect(state.cursor).toBe(3)
    expect(state.selection).toBeNull()
    expect(state.undoLabel).toEqual({ kind: 'record' })
    project.undo()
    expect(project.getLayers()).toHaveLength(0)
  })

  it('inserts at the cursor of the active layer', async () => {
    const project = projectWith()
    project.setCursor(2)
    await project.insertRecording(audio(10, [9, 9]))
    expect(activeSamples(project)).toEqual([1, 2, 9, 9, 3, 4, 5, 6])
  })

  it('records into a new layer at a given time, padding the start', async () => {
    const project = projectWith()
    await project.insertRecording(audio(10, [7, 7], [8, 8]), { newLayer: true, at: 3 })
    const layers = project.getLayers()
    expect(layers).toHaveLength(2)
    const take = layers[1]!
    expect(project.activeLayer()?.id).toBe(take.id)
    expect(samples(take.audio, 0)).toEqual([0, 0, 0, 7, 7])
    expect(samples(take.audio, 1)).toEqual([0, 0, 0, 8, 8])
    expect(samples(layers[0]!.audio)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('records into an empty layer created earlier', async () => {
    const project = projectWith()
    const empty = project.addLayer()
    await project.insertRecording(audio(10, [5]), { at: 1 })
    expect(samples(project.getLayer(empty.id)!.audio)).toEqual([0, 5])
  })

  it('converts takes to the layer channel layout', async () => {
    const project = projectWith()
    await project.insertRecording(audio(10, [1, 1], [3, 3]))
    expect(project.activeLayer()!.audio.channels).toHaveLength(1)
    expect(activeSamples(project).slice(0, 2)).toEqual([2, 2])
  })
})

describe('Project files', () => {
  it('round-trips through project data', async () => {
    const project = projectWith()
    await project.importLayer(audio(10, [0.5, -0.5]), 'music')
    project.setLayerVolume(project.activeLayer()!.id, 1.5)
    project.setLayerMuted(project.activeLayer()!.id, true)
    const data = project.toProjectData()
    expect(data.activeLayer).toBe(1)

    const reopened = newProject()
    reopened.loadProject(data, 'song.suara', '/music/song.suara')
    const layers = reopened.getLayers()
    expect(layers.map((layer) => layer.name)).toEqual(['voice', 'music'])
    expect(layers[1]).toMatchObject({ volume: 1.5, muted: true, solo: false })
    expect(reopened.activeLayer()?.name).toBe('music')
    expect(reopened.isDirty()).toBe(false)
    expect(reopened.snapshot().filePath).toBe('/music/song.suara')
  })
})
