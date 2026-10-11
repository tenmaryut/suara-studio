import { type AudioData, createAudioData, frameCount } from '../audio/audio-data'
import { peakLevel } from '../audio/effects'
import type { Layer } from './project'

/** Peak level the mix is scaled to when it would otherwise clip (about -0.1 dBFS). */
const SAFE_PEAK = 0.99

/** Layers that can be heard: not muted, and soloed when any layer is soloed. */
export function audibleLayers(layers: readonly Layer[]): Layer[] {
  const soloing = layers.some((layer) => layer.solo && !layer.muted)
  return layers.filter((layer) => !layer.muted && (!soloing || layer.solo) && frameCount(layer.audio) > 0)
}

export interface MixOptions {
  /** Turn the whole mix down when it would peak above 0 dBFS. */
  preventClipping: boolean
}

export interface MixResult {
  audio: AudioData
  /** Peak of the summed layers before any clipping protection (1.0 = 0 dBFS). */
  peak: number
  /** True when the mix was turned down to avoid clipping. */
  scaled: boolean
  /** Number of layers that went into the mix. */
  layerCount: number
}

/**
 * Merges the audible layers into one sound, applying each layer's volume. Mono layers play in
 * both channels of a stereo mix; the mix is mono only when every audible layer is mono.
 */
export function mixLayers(layers: readonly Layer[], sampleRate: number, options: MixOptions): MixResult {
  const sources = audibleLayers(layers)
  const channelCount = sources.some((layer) => layer.audio.channels.length > 1) ? 2 : 1
  const length = sources.reduce((max, layer) => Math.max(max, frameCount(layer.audio)), 0)
  const channels = Array.from({ length: channelCount }, () => new Float32Array(length))
  for (const layer of sources) {
    const input = layer.audio.channels
    const gain = layer.volume
    if (gain === 0) continue
    for (let c = 0; c < channelCount; c++) {
      const source = input[Math.min(c, input.length - 1)]!
      const target = channels[c]!
      for (let i = 0; i < source.length; i++) target[i] = target[i]! + source[i]! * gain
    }
  }
  const audio = createAudioData(sampleRate, channels)
  const peak = peakLevel(audio)
  const scaled = options.preventClipping && peak > 1
  if (scaled) {
    const scale = SAFE_PEAK / peak
    for (const channel of channels) {
      for (let i = 0; i < channel.length; i++) channel[i] = channel[i]! * scale
    }
  }
  return { audio, peak, scaled, layerCount: sources.length }
}
