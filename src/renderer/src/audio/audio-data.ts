/** Planar PCM audio kept in memory as 32-bit floats, one array per channel. */
export interface AudioData {
  readonly sampleRate: number
  readonly channels: readonly Float32Array[]
}

export function createAudioData(sampleRate: number, channels: Float32Array[]): AudioData {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new RangeError(`Invalid sample rate: ${sampleRate}`)
  }
  if (channels.length === 0) {
    throw new RangeError('Audio needs at least one channel')
  }
  const length = channels[0]!.length
  if (channels.some((channel) => channel.length !== length)) {
    throw new RangeError('All channels must have the same length')
  }
  return { sampleRate, channels }
}

export function emptyAudio(sampleRate: number, channelCount: number): AudioData {
  return createAudioData(
    sampleRate,
    Array.from({ length: channelCount }, () => new Float32Array(0))
  )
}

export function silentAudio(sampleRate: number, channelCount: number, frames: number): AudioData {
  return createAudioData(
    sampleRate,
    Array.from({ length: channelCount }, () => new Float32Array(Math.max(0, Math.floor(frames))))
  )
}

/** Number of sample frames (samples per channel). */
export function frameCount(data: AudioData): number {
  return data.channels[0]?.length ?? 0
}

export function durationOf(data: AudioData): number {
  return frameCount(data) / data.sampleRate
}

export function byteSize(data: AudioData): number {
  return frameCount(data) * data.channels.length * Float32Array.BYTES_PER_ELEMENT
}

/** Clamps a frame range to the audio and orders it so start <= end. */
export function clampRange(data: AudioData, start: number, end: number): [number, number] {
  const length = frameCount(data)
  const a = Math.min(Math.max(Math.round(start), 0), length)
  const b = Math.min(Math.max(Math.round(end), 0), length)
  return a <= b ? [a, b] : [b, a]
}

/** Copies frames [start, end) into a new AudioData. */
export function sliceAudio(data: AudioData, start: number, end: number): AudioData {
  const [a, b] = clampRange(data, start, end)
  return createAudioData(
    data.sampleRate,
    data.channels.map((channel) => channel.slice(a, b))
  )
}

export function cloneAudio(data: AudioData): AudioData {
  return createAudioData(
    data.sampleRate,
    data.channels.map((channel) => channel.slice())
  )
}

/** Joins chunks of planar samples (as produced by the recorder) into one AudioData. */
export function concatChunks(sampleRate: number, chunks: readonly Float32Array[][]): AudioData {
  const channelCount = chunks[0]?.length ?? 1
  const total = chunks.reduce((sum, chunk) => sum + (chunk[0]?.length ?? 0), 0)
  const channels = Array.from({ length: channelCount }, () => new Float32Array(total))
  let offset = 0
  for (const chunk of chunks) {
    const length = chunk[0]?.length ?? 0
    for (let c = 0; c < channelCount; c++) {
      // Pad missing channels with the first one so a mid-recording layout change cannot crash.
      channels[c]!.set(chunk[c] ?? chunk[0]!, offset)
    }
    offset += length
  }
  return createAudioData(sampleRate, channels)
}

/**
 * Up- or down-mixes audio to the requested channel count.
 * Mono becomes identical channels; downmixing to mono averages all channels.
 */
export function remixChannels(data: AudioData, channelCount: number): AudioData {
  const source = data.channels
  if (source.length === channelCount) return data
  const length = frameCount(data)
  if (channelCount === 1) {
    const mono = new Float32Array(length)
    for (const channel of source) {
      for (let i = 0; i < length; i++) mono[i]! += channel[i]!
    }
    const scale = 1 / source.length
    for (let i = 0; i < length; i++) mono[i]! *= scale
    return createAudioData(data.sampleRate, [mono])
  }
  const channels = Array.from({ length: channelCount }, (_, c) =>
    source.length === 1 ? source[0]!.slice() : (source[c] ?? source[source.length - 1]!).slice()
  )
  return createAudioData(data.sampleRate, channels)
}
