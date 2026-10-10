import { describe, expect, it } from 'vitest'
import { probeSampleRate } from '../../src/renderer/src/audio/probe'
import { encodeWav } from '../../src/renderer/src/audio/wav'
import { audio } from './helpers'

function bytes(...parts: (string | number[])[]): ArrayBuffer {
  const out: number[] = []
  for (const part of parts) {
    if (typeof part === 'string') out.push(...[...part].map((ch) => ch.charCodeAt(0)))
    else out.push(...part)
  }
  return Uint8Array.from(out).buffer
}

function zeros(count: number): number[] {
  return new Array<number>(count).fill(0)
}

describe('probeSampleRate', () => {
  it('reads WAV headers', () => {
    expect(probeSampleRate(encodeWav(audio(32000, [0]), 'pcm16'))).toBe(32000)
  })

  it('reads FLAC STREAMINFO', () => {
    // 44100 Hz is 0x0AC44, stored in the 20 bits that start at STREAMINFO byte 10.
    const header = bytes('fLaC', [0x80, 0, 0, 34], zeros(10), [0x0a, 0xc4, 0x42], zeros(21))
    expect(probeSampleRate(header)).toBe(44100)
  })

  it('reads Ogg Vorbis identification headers', () => {
    const page = bytes('OggS', zeros(22), [1, 30], [0x01], 'vorbis', zeros(4), [2], [0x80, 0xbb, 0, 0])
    expect(probeSampleRate(page)).toBe(48000)
  })

  it('treats Ogg Opus as 48 kHz', () => {
    expect(probeSampleRate(bytes('OggS', zeros(22), [1, 19], 'OpusHead', zeros(11)))).toBe(48000)
  })

  it('reads the mp4a sample entry of M4A files', () => {
    const entry = bytes(zeros(4), 'ftyp', 'M4A ', zeros(8), 'mp4a', zeros(24), [0xac, 0x44, 0, 0])
    expect(probeSampleRate(entry)).toBe(44100)
  })

  it('reads MPEG audio frame headers, skipping ID3 tags', () => {
    expect(probeSampleRate(bytes([0xff, 0xfb, 0x90, 0x00], zeros(64)))).toBe(44100)
    expect(probeSampleRate(bytes([0xff, 0xf3, 0x80, 0x00], zeros(64)))).toBe(22050)
    const tagged = bytes('ID3', [4, 0, 0, 0, 0, 0, 5], zeros(5), [0xff, 0xfb, 0x94, 0x00], zeros(64))
    expect(probeSampleRate(tagged)).toBe(48000)
  })

  it('returns null for unknown data', () => {
    expect(probeSampleRate(bytes('hello world', zeros(64)))).toBeNull()
    expect(probeSampleRate(new ArrayBuffer(0))).toBeNull()
  })
})
