import { describe, expect, it } from 'vitest'
import { frameCount } from '../../src/renderer/src/audio/audio-data'
import { decodeWav, encodeWav, isWav, readWavInfo } from '../../src/renderer/src/audio/wav'
import { audio, samples } from './helpers'

const stereo = audio(44100, [0, 0.5, -0.5, 1, -1, 0.25], [0.1, -0.1, 0.2, -0.2, 0.3, -0.3])

describe('encodeWav', () => {
  it('writes a canonical 16-bit header', () => {
    const buffer = encodeWav(stereo, 'pcm16')
    const view = new DataView(buffer)
    expect(isWav(buffer)).toBe(true)
    expect(buffer.byteLength).toBe(44 + 6 * 2 * 2)
    expect(view.getUint32(4, true)).toBe(buffer.byteLength - 8)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(28, true)).toBe(44100 * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(24)
  })

  it('clips integer formats at full scale', () => {
    const decoded = decodeWav(encodeWav(audio(8000, [1.5, -2]), 'pcm16'))
    expect(samples(decoded)).toEqual([1, -1])
  })

  it('pads odd-sized data chunks', () => {
    const buffer = encodeWav(audio(8000, [0.1]), 'pcm24')
    expect(buffer.byteLength % 2).toBe(0)
    expect(readWavInfo(buffer).dataBytes).toBe(3)
  })

  it('writes float files with a fact chunk', () => {
    const info = readWavInfo(encodeWav(stereo, 'float32'))
    expect(info.formatTag).toBe(3)
    expect(info.bitsPerSample).toBe(32)
  })
})

describe('decodeWav round trips', () => {
  it.each([
    ['pcm16', 1 / 0x7fff],
    ['pcm24', 1 / 0x7fffff],
    ['float32', 1e-7]
  ] as const)('%s keeps samples within one quantisation step', (format, tolerance) => {
    const decoded = decodeWav(encodeWav(stereo, format))
    expect(decoded.sampleRate).toBe(44100)
    expect(decoded.channels).toHaveLength(2)
    expect(frameCount(decoded)).toBe(6)
    for (let c = 0; c < 2; c++) {
      samples(decoded, c).forEach((value, i) => {
        expect(Math.abs(value - stereo.channels[c]![i]!)).toBeLessThanOrEqual(tolerance)
      })
    }
  })
})

function wavWithFormat(formatTag: number, bits: number, body: number[], extensible = false): ArrayBuffer {
  const fmtSize = extensible ? 40 : 16
  const blockAlign = bits / 8
  const buffer = new ArrayBuffer(12 + 8 + fmtSize + 8 + body.length)
  const view = new DataView(buffer)
  const tag = (offset: number, text: string): void =>
    [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)))
  tag(0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  tag(8, 'WAVE')
  tag(12, 'fmt ')
  view.setUint32(16, fmtSize, true)
  view.setUint16(20, extensible ? 0xfffe : formatTag, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 22050, true)
  view.setUint32(28, 22050 * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bits, true)
  if (extensible) {
    view.setUint16(36, 22, true)
    view.setUint16(44, formatTag, true)
  }
  const dataOffset = 20 + fmtSize
  tag(dataOffset, 'data')
  view.setUint32(dataOffset + 4, body.length, true)
  body.forEach((byte, i) => view.setUint8(dataOffset + 8 + i, byte))
  return buffer
}

describe('decodeWav formats', () => {
  it('decodes unsigned 8-bit PCM', () => {
    const decoded = decodeWav(wavWithFormat(1, 8, [128, 255, 1]))
    expect(decoded.sampleRate).toBe(22050)
    expect(samples(decoded)).toEqual([0, 1, -1])
  })

  it('decodes WAVE_FORMAT_EXTENSIBLE', () => {
    const decoded = decodeWav(wavWithFormat(1, 16, [0xff, 0x7f, 0x01, 0x80], true))
    expect(samples(decoded)).toEqual([1, -1])
  })

  it('rejects unsupported encodings and non-WAV data', () => {
    expect(() => decodeWav(wavWithFormat(2, 4, [0, 0]))).toThrow(/Unsupported/)
    expect(() => decodeWav(new ArrayBuffer(8))).toThrow(/Not a WAV/)
  })
})
