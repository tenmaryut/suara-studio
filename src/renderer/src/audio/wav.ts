import { type AudioData, createAudioData, frameCount } from './audio-data'

export type WavFormat = 'pcm16' | 'pcm24' | 'float32'

export const WAV_FORMATS: readonly WavFormat[] = ['pcm16', 'pcm24', 'float32']

const FORMAT_PCM = 1
const FORMAT_FLOAT = 3
const FORMAT_EXTENSIBLE = 0xfffe
const MAX_RIFF_SIZE = 0xffffffff

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

function writeTag(view: DataView, offset: number, tag: string): void {
  for (let i = 0; i < 4; i++) view.setUint8(offset + i, tag.charCodeAt(i))
}

function readTag(view: DataView, offset: number): string {
  let tag = ''
  for (let i = 0; i < 4; i++) tag += String.fromCharCode(view.getUint8(offset + i))
  return tag
}

function bytesPerSample(format: WavFormat): number {
  return format === 'pcm16' ? 2 : format === 'pcm24' ? 3 : 4
}

/** Encodes planar float audio as a RIFF/WAVE file. Integer formats clip at ±1.0. */
export function encodeWav(data: AudioData, format: WavFormat = 'pcm16'): ArrayBuffer {
  const channelCount = data.channels.length
  const frames = frameCount(data)
  const sampleBytes = bytesPerSample(format)
  const blockAlign = channelCount * sampleBytes
  const dataBytes = frames * blockAlign
  const isFloat = format === 'float32'
  const fmtBytes = isFloat ? 18 : 16
  const factBytes = isFloat ? 12 : 0
  const headerBytes = 12 + 8 + fmtBytes + factBytes + 8
  const padByte = dataBytes % 2
  const totalBytes = headerBytes + dataBytes + padByte
  if (totalBytes - 8 > MAX_RIFF_SIZE) {
    throw new RangeError('The audio is too long to save as a single WAV file (4 GB limit).')
  }

  const buffer = new ArrayBuffer(totalBytes)
  const view = new DataView(buffer)
  writeTag(view, 0, 'RIFF')
  view.setUint32(4, totalBytes - 8, true)
  writeTag(view, 8, 'WAVE')

  let offset = 12
  writeTag(view, offset, 'fmt ')
  view.setUint32(offset + 4, fmtBytes, true)
  view.setUint16(offset + 8, isFloat ? FORMAT_FLOAT : FORMAT_PCM, true)
  view.setUint16(offset + 10, channelCount, true)
  view.setUint32(offset + 12, data.sampleRate, true)
  view.setUint32(offset + 16, data.sampleRate * blockAlign, true)
  view.setUint16(offset + 20, blockAlign, true)
  view.setUint16(offset + 22, sampleBytes * 8, true)
  if (isFloat) view.setUint16(offset + 24, 0, true)
  offset += 8 + fmtBytes

  if (isFloat) {
    writeTag(view, offset, 'fact')
    view.setUint32(offset + 4, 4, true)
    view.setUint32(offset + 8, frames, true)
    offset += factBytes
  }

  writeTag(view, offset, 'data')
  view.setUint32(offset + 4, dataBytes, true)
  offset += 8

  const channels = data.channels
  if (format === 'pcm16' && IS_LITTLE_ENDIAN && offset % 2 === 0) {
    // Fast path for playback previews: 16-bit samples written straight into an aligned view.
    const out = new Int16Array(buffer, offset, frames * channelCount)
    let k = 0
    for (let i = 0; i < frames; i++) {
      for (let c = 0; c < channelCount; c++) {
        const s = channels[c]![i]!
        out[k++] = Math.round((s > 1 ? 1 : s < -1 ? -1 : s) * 0x7fff)
      }
    }
    return buffer
  }

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const s = channels[c]![i]!
      if (format === 'float32') {
        view.setFloat32(offset, s, true)
      } else {
        const clamped = s > 1 ? 1 : s < -1 ? -1 : s
        if (format === 'pcm16') {
          view.setInt16(offset, Math.round(clamped * 0x7fff), true)
        } else {
          const v = Math.round(clamped * 0x7fffff)
          view.setUint8(offset, v & 0xff)
          view.setUint8(offset + 1, (v >> 8) & 0xff)
          view.setUint8(offset + 2, (v >> 16) & 0xff)
        }
      }
      offset += sampleBytes
    }
  }
  return buffer
}

export interface WavInfo {
  formatTag: number
  channelCount: number
  sampleRate: number
  bitsPerSample: number
  blockAlign: number
  dataOffset: number
  dataBytes: number
}

export function isWav(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false
  const view = new DataView(buffer)
  return readTag(view, 0) === 'RIFF' && readTag(view, 8) === 'WAVE'
}

/** Reads the fmt and data chunk locations of a WAV file without decoding samples. */
export function readWavInfo(buffer: ArrayBuffer): WavInfo {
  if (!isWav(buffer)) throw new Error('Not a WAV file')
  const view = new DataView(buffer)
  let fmt: Omit<WavInfo, 'dataOffset' | 'dataBytes'> | null = null
  let dataOffset = -1
  let dataBytes = 0
  let offset = 12
  while (offset + 8 <= buffer.byteLength) {
    const id = readTag(view, offset)
    const size = view.getUint32(offset + 4, true)
    const body = offset + 8
    if (id === 'fmt ' && body + 16 <= buffer.byteLength) {
      let formatTag = view.getUint16(body, true)
      if (formatTag === FORMAT_EXTENSIBLE && size >= 40 && body + 26 <= buffer.byteLength) {
        // WAVE_FORMAT_EXTENSIBLE stores the real format in the first two bytes of the sub-format GUID.
        formatTag = view.getUint16(body + 24, true)
      }
      fmt = {
        formatTag,
        channelCount: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        blockAlign: view.getUint16(body + 12, true),
        bitsPerSample: view.getUint16(body + 14, true)
      }
    } else if (id === 'data') {
      dataOffset = body
      const remaining = buffer.byteLength - body
      // Streaming writers leave the size at 0 or 0xFFFFFFFF; fall back to the rest of the file.
      dataBytes = size === 0 || size > remaining ? remaining : size
      if (fmt) break
    }
    offset = body + size + (size % 2)
  }
  if (!fmt) throw new Error('WAV file has no format chunk')
  if (dataOffset < 0) throw new Error('WAV file has no audio data')
  if (fmt.channelCount < 1 || fmt.sampleRate < 1) throw new Error('WAV file has an invalid format')
  return { ...fmt, dataOffset, dataBytes }
}

/** Decodes 8/16/24/32-bit PCM and 32/64-bit float WAV files at their native sample rate. */
export function decodeWav(buffer: ArrayBuffer): AudioData {
  const info = readWavInfo(buffer)
  const { formatTag, channelCount, bitsPerSample } = info
  const sampleBytes = bitsPerSample / 8
  const supported =
    (formatTag === FORMAT_PCM && [8, 16, 24, 32].includes(bitsPerSample)) ||
    (formatTag === FORMAT_FLOAT && [32, 64].includes(bitsPerSample))
  if (!supported) {
    throw new Error(`Unsupported WAV encoding (format ${formatTag}, ${bitsPerSample}-bit)`)
  }
  const blockAlign = info.blockAlign || channelCount * sampleBytes
  const frames = Math.floor(info.dataBytes / blockAlign)
  const view = new DataView(buffer)
  const channels = Array.from({ length: channelCount }, () => new Float32Array(frames))

  for (let i = 0; i < frames; i++) {
    const frameOffset = info.dataOffset + i * blockAlign
    for (let c = 0; c < channelCount; c++) {
      const o = frameOffset + c * sampleBytes
      let value: number
      if (formatTag === FORMAT_FLOAT) {
        value = bitsPerSample === 32 ? view.getFloat32(o, true) : view.getFloat64(o, true)
      } else if (bitsPerSample === 8) {
        value = (view.getUint8(o) - 128) / 127
      } else if (bitsPerSample === 16) {
        value = view.getInt16(o, true) / 0x7fff
      } else if (bitsPerSample === 24) {
        const raw = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getInt8(o + 2) << 16)
        value = raw / 0x7fffff
      } else {
        value = view.getInt32(o, true) / 0x7fffffff
      }
      channels[c]![i] = value
    }
  }
  return createAudioData(info.sampleRate, channels)
}
