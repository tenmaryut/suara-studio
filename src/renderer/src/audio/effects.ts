import { type AudioData, createAudioData, frameCount } from './audio-data'

export type FadeCurve = 'linear' | 'sine'

function mapChannels(data: AudioData, fn: (input: Float32Array) => Float32Array): AudioData {
  return createAudioData(data.sampleRate, data.channels.map(fn))
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(gain: number): number {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity
}

/** Largest absolute sample value across all channels (1.0 = 0 dBFS). */
export function peakLevel(data: AudioData): number {
  let peak = 0
  for (const channel of data.channels) {
    for (let i = 0; i < channel.length; i++) {
      const value = Math.abs(channel[i]!)
      if (value > peak) peak = value
    }
  }
  return peak
}

export function applyGain(data: AudioData, db: number): AudioData {
  const gain = dbToGain(db)
  return mapChannels(data, (input) => {
    const out = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) out[i] = input[i]! * gain
    return out
  })
}

/** Scales audio so its highest peak sits at `targetDb` dBFS. Silent audio is returned unchanged. */
export function normalize(data: AudioData, targetDb = -1): AudioData {
  const peak = peakLevel(data)
  if (peak === 0) return mapChannels(data, (input) => input.slice())
  return applyGain(data, targetDb - gainToDb(peak))
}

function fadeGain(position: number, curve: FadeCurve): number {
  return curve === 'sine' ? Math.sin((position * Math.PI) / 2) : position
}

function fade(data: AudioData, direction: 'in' | 'out', curve: FadeCurve): AudioData {
  const length = frameCount(data)
  const last = Math.max(length - 1, 1)
  return mapChannels(data, (input) => {
    const out = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      const position = direction === 'in' ? i / last : 1 - i / last
      out[i] = input[i]! * fadeGain(position, curve)
    }
    return out
  })
}

export function fadeIn(data: AudioData, curve: FadeCurve = 'sine'): AudioData {
  return fade(data, 'in', curve)
}

export function fadeOut(data: AudioData, curve: FadeCurve = 'sine'): AudioData {
  return fade(data, 'out', curve)
}

export function silence(data: AudioData): AudioData {
  return mapChannels(data, (input) => new Float32Array(input.length))
}

export function reverse(data: AudioData): AudioData {
  return mapChannels(data, (input) => input.slice().reverse())
}
