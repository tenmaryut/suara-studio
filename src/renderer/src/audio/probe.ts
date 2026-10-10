import { isWav, readWavInfo } from './wav'

/**
 * Best-effort detection of a compressed file's native sample rate, so it can be decoded
 * without resampling. Returns null when the format or header is not recognised; callers
 * then decode at a default rate, which still sounds right but changes the stored rate.
 */
export function probeSampleRate(buffer: ArrayBuffer): number | null {
  const bytes = new Uint8Array(buffer)
  try {
    if (isWav(buffer)) return readWavInfo(buffer).sampleRate
    const start = skipId3v2(bytes)
    return (
      probeFlac(bytes, start) ??
      probeOgg(bytes) ??
      probeMp4(bytes) ??
      probeMp3(bytes, start)
    )
  } catch {
    return null
  }
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length && offset + i < bytes.length; i++) {
    out += String.fromCharCode(bytes[offset + i]!)
  }
  return out
}

function plausible(rate: number): number | null {
  return rate >= 3000 && rate <= 768000 ? rate : null
}

/** Returns the offset just past an ID3v2 tag, or 0 when there is none. */
function skipId3v2(bytes: Uint8Array): number {
  if (ascii(bytes, 0, 3) !== 'ID3' || bytes.length < 10) return 0
  const size =
    ((bytes[6]! & 0x7f) << 21) |
    ((bytes[7]! & 0x7f) << 14) |
    ((bytes[8]! & 0x7f) << 7) |
    (bytes[9]! & 0x7f)
  const hasFooter = (bytes[5]! & 0x10) !== 0
  return 10 + size + (hasFooter ? 10 : 0)
}

function probeFlac(bytes: Uint8Array, start: number): number | null {
  if (ascii(bytes, start, 4) !== 'fLaC') return null
  // The first metadata block is always STREAMINFO; the sample rate is its 20 bits at offset 10.
  const o = start + 8 + 10
  if (o + 3 > bytes.length) return null
  return plausible((bytes[o]! << 12) | (bytes[o + 1]! << 4) | (bytes[o + 2]! >> 4))
}

function probeOgg(bytes: Uint8Array): number | null {
  if (ascii(bytes, 0, 4) !== 'OggS' || bytes.length < 28) return null
  const segments = bytes[26]!
  const payload = 27 + segments
  if (ascii(bytes, payload, 8) === 'OpusHead') return 48000
  if (bytes[payload] === 0x01 && ascii(bytes, payload + 1, 6) === 'vorbis') {
    const o = payload + 12
    if (o + 4 > bytes.length) return null
    const rate = bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16) | (bytes[o + 3]! << 24)
    return plausible(rate >>> 0)
  }
  return null
}

function probeMp4(bytes: Uint8Array): number | null {
  if (ascii(bytes, 4, 4) !== 'ftyp') return null
  // The audio sample entry ('mp4a') stores the rate as 16.16 fixed point, 28 bytes after its type.
  const limit = Math.min(bytes.length - 31, 8 * 1024 * 1024)
  for (let i = 8; i < limit; i++) {
    if (bytes[i] === 0x6d && bytes[i + 1] === 0x70 && bytes[i + 2] === 0x34 && bytes[i + 3] === 0x61) {
      return plausible((bytes[i + 28]! << 8) | bytes[i + 29]!)
    }
  }
  return null
}

const MP3_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000] // MPEG-2.5
}

function probeMp3(bytes: Uint8Array, start: number): number | null {
  const limit = Math.min(bytes.length - 3, start + 64 * 1024)
  for (let i = start; i < limit; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) continue
    const version = (bytes[i + 1]! >> 3) & 0x03
    const layer = (bytes[i + 1]! >> 1) & 0x03
    const bitrateIndex = bytes[i + 2]! >> 4
    const rateIndex = (bytes[i + 2]! >> 2) & 0x03
    if (version === 1 || layer === 0 || bitrateIndex === 0x0f || bitrateIndex === 0 || rateIndex === 3) {
      continue
    }
    return MP3_RATES[version]?.[rateIndex] ?? null
  }
  return null
}
