import { describe, expect, it } from 'vitest'
import { decodeProject, encodeProject, isProjectFile } from '../../src/renderer/src/project/project-file'
import type { ProjectData } from '../../src/renderer/src/project/project'
import { encodeWav } from '../../src/renderer/src/audio/wav'
import { audio, samples } from './helpers'

function sampleProject(): ProjectData {
  return {
    sampleRate: 44100,
    activeLayer: 1,
    layers: [
      { name: 'Vokal', volume: 1.25, muted: false, solo: true, color: 3, audio: audio(44100, [0.5, -1.5, 0.25]) },
      { name: 'Musik ♪', volume: 0.5, muted: true, solo: false, color: 1, audio: audio(44100, [1, 2], [-3, 4]) },
      { name: 'Kosong', volume: 1, muted: false, solo: false, color: 0, audio: audio(44100, []) }
    ]
  }
}

describe('project files', () => {
  it('round-trips layers, settings and exact samples', () => {
    const decoded = decodeProject(encodeProject(sampleProject()))
    expect(decoded.sampleRate).toBe(44100)
    expect(decoded.activeLayer).toBe(1)
    expect(decoded.layers.map(({ name, volume, muted, solo, color }) => ({ name, volume, muted, solo, color }))).toEqual(
      sampleProject().layers.map(({ name, volume, muted, solo, color }) => ({ name, volume, muted, solo, color }))
    )
    expect(samples(decoded.layers[0]!.audio)).toEqual([0.5, -1.5, 0.25])
    expect(samples(decoded.layers[1]!.audio, 1)).toEqual([-3, 4])
    expect(decoded.layers[2]!.audio.channels[0]).toHaveLength(0)
  })

  it('recognises project files', () => {
    expect(isProjectFile(encodeProject(sampleProject()))).toBe(true)
    expect(isProjectFile(encodeWav(audio(8000, [0.1]), 'pcm16'))).toBe(false)
    expect(isProjectFile(new ArrayBuffer(4))).toBe(false)
  })

  it('rejects truncated and unknown files', () => {
    const encoded = encodeProject(sampleProject())
    expect(() => decodeProject(encoded.slice(0, encoded.byteLength - 4))).toThrow(/Damaged/)
    const future = encoded.slice(0)
    new DataView(future).setUint32(8, 99, true)
    expect(() => decodeProject(future)).toThrow(/version/)
    expect(() => decodeProject(encodeWav(audio(8000, [0.1]), 'pcm16'))).toThrow(/Not a Suara Studio project/)
  })
})
