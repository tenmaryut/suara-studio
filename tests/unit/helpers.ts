import { type AudioData, createAudioData, frameCount, remixChannels } from '../../src/renderer/src/audio/audio-data'

/** Builds audio from per-channel sample lists. */
export function audio(sampleRate: number, ...channels: number[][]): AudioData {
  return createAudioData(
    sampleRate,
    channels.map((samples) => Float32Array.from(samples))
  )
}

export function ramp(length: number, sampleRate = 8000, channelCount = 1): AudioData {
  return createAudioData(
    sampleRate,
    Array.from({ length: channelCount }, (_, c) =>
      Float32Array.from({ length }, (_, i) => (i + 1) / 1000 + c)
    )
  )
}

export function samples(data: AudioData, channel = 0): number[] {
  return Array.from(data.channels[channel] ?? [])
}

/** Nearest-neighbour resampling: enough to exercise the editor without Web Audio. */
export async function testConvert(
  data: AudioData,
  sampleRate: number,
  channelCount: number
): Promise<AudioData> {
  let out = data
  if (data.sampleRate !== sampleRate) {
    const length = Math.round((frameCount(data) * sampleRate) / data.sampleRate)
    out = createAudioData(
      sampleRate,
      data.channels.map((channel) =>
        Float32Array.from({ length }, (_, i) =>
          channel[Math.min(channel.length - 1, Math.floor((i * data.sampleRate) / sampleRate))]!
        )
      )
    )
  }
  return remixChannels(out, channelCount)
}
