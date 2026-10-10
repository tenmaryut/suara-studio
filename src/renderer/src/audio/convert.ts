import { type AudioData, createAudioData, frameCount, remixChannels } from './audio-data'
import { probeSampleRate } from './probe'
import { decodeWav, isWav } from './wav'

/** Rate used for compressed files whose native sample rate could not be detected. */
const FALLBACK_SAMPLE_RATE = 48000

function fromAudioBuffer(buffer: AudioBuffer): AudioData {
  return createAudioData(
    buffer.sampleRate,
    Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c).slice())
  )
}

/** Resamples with the browser's built-in high-quality resampler. */
export async function resample(audio: AudioData, sampleRate: number): Promise<AudioData> {
  if (audio.sampleRate === sampleRate) return audio
  const inputFrames = frameCount(audio)
  const channelCount = audio.channels.length
  const outputFrames = Math.round((inputFrames * sampleRate) / audio.sampleRate)
  if (inputFrames === 0 || outputFrames === 0) {
    return createAudioData(
      sampleRate,
      Array.from({ length: channelCount }, () => new Float32Array(0))
    )
  }
  const context = new OfflineAudioContext({
    numberOfChannels: channelCount,
    length: outputFrames,
    sampleRate
  })
  const buffer = context.createBuffer(channelCount, inputFrames, audio.sampleRate)
  audio.channels.forEach((channel, c) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, c))
  const source = context.createBufferSource()
  source.buffer = buffer
  source.connect(context.destination)
  source.start()
  return fromAudioBuffer(await context.startRendering())
}

/** Converts audio to a target sample rate and channel layout. */
export async function convertAudio(
  audio: AudioData,
  sampleRate: number,
  channelCount: number
): Promise<AudioData> {
  return remixChannels(await resample(audio, sampleRate), channelCount)
}

/**
 * Decodes an audio file. WAV is parsed directly so samples stay bit-exact; other formats
 * use the browser decoder at the file's native sample rate when it can be detected.
 */
export async function decodeAudioFile(data: ArrayBuffer): Promise<AudioData> {
  if (isWav(data)) {
    try {
      return decodeWav(data)
    } catch {
      // Compressed WAV variants (ADPCM, µ-law…) fall through to the browser decoder.
    }
  }
  const sampleRate = probeSampleRate(data) ?? FALLBACK_SAMPLE_RATE
  const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate })
  // decodeAudioData detaches the buffer it is given, so pass a copy.
  const buffer = await context.decodeAudioData(data.slice(0))
  return fromAudioBuffer(buffer)
}
