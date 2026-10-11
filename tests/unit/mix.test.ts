import { describe, expect, it } from 'vitest'
import type { AudioData } from '../../src/renderer/src/audio/audio-data'
import { audibleLayers, mixLayers } from '../../src/renderer/src/project/mix'
import type { Layer } from '../../src/renderer/src/project/project'
import { audio, samples } from './helpers'

function layer(id: string, data: AudioData, props: Partial<Layer> = {}): Layer {
  return { id, name: id, audio: data, volume: 1, muted: false, solo: false, color: 0, ...props }
}

describe('audibleLayers', () => {
  it('skips muted and empty layers', () => {
    const layers = [
      layer('a', audio(10, [1])),
      layer('b', audio(10, [1]), { muted: true }),
      layer('c', audio(10, []))
    ]
    expect(audibleLayers(layers).map((l) => l.id)).toEqual(['a'])
  })

  it('plays only soloed layers while any layer is soloed', () => {
    const layers = [
      layer('a', audio(10, [1])),
      layer('b', audio(10, [1]), { solo: true }),
      layer('c', audio(10, [1]), { solo: true, muted: true })
    ]
    expect(audibleLayers(layers).map((l) => l.id)).toEqual(['b'])
  })
})

describe('mixLayers', () => {
  it('sums layers with their volumes over the longest length', () => {
    const result = mixLayers(
      [layer('a', audio(10, [0.1, 0.1, 0.1])), layer('b', audio(10, [0.2]), { volume: 0.5 })],
      10,
      { preventClipping: true }
    )
    expect(result.audio.channels).toHaveLength(1)
    expect(samples(result.audio).map((v) => Number(v.toFixed(4)))).toEqual([0.2, 0.1, 0.1])
    expect(result.layerCount).toBe(2)
    expect(result.scaled).toBe(false)
  })

  it('makes a stereo mix when any layer is stereo', () => {
    const result = mixLayers(
      [layer('mono', audio(10, [0.1, 0.1])), layer('stereo', audio(10, [0.2, 0.2], [0.4, 0.4]))],
      10,
      { preventClipping: false }
    )
    expect(result.audio.channels).toHaveLength(2)
    expect(samples(result.audio, 0)[0]).toBeCloseTo(0.3)
    expect(samples(result.audio, 1)[0]).toBeCloseTo(0.5)
  })

  it('turns the mix down instead of clipping when asked to', () => {
    const layers = [layer('a', audio(10, [0.8, -0.4])), layer('b', audio(10, [0.8, 0]))]
    const kept = mixLayers(layers, 10, { preventClipping: false })
    expect(kept.peak).toBeCloseTo(1.6)
    expect(samples(kept.audio)[0]).toBeCloseTo(1.6)
    const safe = mixLayers(layers, 10, { preventClipping: true })
    expect(safe.scaled).toBe(true)
    expect(samples(safe.audio)[0]).toBeCloseTo(0.99, 5)
    expect(samples(safe.audio)[1]).toBeCloseTo(-0.2475, 4)
  })

  it('returns silence-free empty audio when nothing is audible', () => {
    const result = mixLayers([layer('a', audio(10, [1]), { muted: true })], 10, { preventClipping: true })
    expect(result.layerCount).toBe(0)
    expect(result.audio.channels[0]).toHaveLength(0)
  })
})
