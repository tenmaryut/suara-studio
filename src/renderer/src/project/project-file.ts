import { type AudioData, createAudioData, frameCount } from '../audio/audio-data'
import type { ProjectData } from './project'

/**
 * .suara project files: an 8-byte magic, a format version, a JSON header describing the layers,
 * then every layer's samples as little-endian 32-bit floats (channel after channel), so a project
 * reopens exactly as it was saved.
 *
 *   "SUARAPRJ" | u32 version | u32 header length | header JSON (UTF-8) | padding to 4 bytes | samples
 */
export const PROJECT_EXTENSION = 'suara'
const MAGIC = 'SUARAPRJ'
const VERSION = 1
const PREAMBLE_BYTES = MAGIC.length + 8

interface StoredLayer {
  name: string
  volume: number
  muted: boolean
  solo: boolean
  color: number
  channels: number
  frames: number
}

interface Header {
  app: string
  sampleRate: number
  activeLayer: number
  layers: StoredLayer[]
}

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export function isProjectFile(data: ArrayBuffer): boolean {
  if (data.byteLength < PREAMBLE_BYTES) return false
  const bytes = new Uint8Array(data, 0, MAGIC.length)
  return String.fromCharCode(...bytes) === MAGIC
}

export function encodeProject(project: ProjectData): ArrayBuffer {
  const header: Header = {
    app: 'Suara Studio',
    sampleRate: project.sampleRate,
    activeLayer: project.activeLayer,
    layers: project.layers.map((layer) => ({
      name: layer.name,
      volume: layer.volume,
      muted: layer.muted,
      solo: layer.solo,
      color: layer.color,
      channels: layer.audio.channels.length,
      frames: frameCount(layer.audio)
    }))
  }
  const json = new TextEncoder().encode(JSON.stringify(header))
  const dataStart = align4(PREAMBLE_BYTES + json.byteLength)
  const sampleCount = header.layers.reduce((sum, layer) => sum + layer.channels * layer.frames, 0)
  const buffer = new ArrayBuffer(dataStart + sampleCount * 4)
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  for (let i = 0; i < MAGIC.length; i++) bytes[i] = MAGIC.charCodeAt(i)
  view.setUint32(MAGIC.length, VERSION, true)
  view.setUint32(MAGIC.length + 4, json.byteLength, true)
  bytes.set(json, PREAMBLE_BYTES)
  let offset = dataStart
  for (const layer of project.layers) {
    for (const channel of layer.audio.channels) {
      writeFloats(view, offset, channel)
      offset += channel.length * 4
    }
  }
  return buffer
}

export function decodeProject(data: ArrayBuffer): ProjectData {
  if (!isProjectFile(data)) throw new Error('Not a Suara Studio project')
  const view = new DataView(data)
  const version = view.getUint32(MAGIC.length, true)
  if (version !== VERSION) throw new Error(`Unsupported project version ${version}`)
  const jsonLength = view.getUint32(MAGIC.length + 4, true)
  if (PREAMBLE_BYTES + jsonLength > data.byteLength) throw new Error('Damaged project file')
  const header = parseHeader(new TextDecoder().decode(new Uint8Array(data, PREAMBLE_BYTES, jsonLength)))
  let offset = align4(PREAMBLE_BYTES + jsonLength)
  const layers = header.layers.map((layer) => {
    const channels: Float32Array[] = []
    for (let c = 0; c < layer.channels; c++) {
      const bytes = layer.frames * 4
      if (offset + bytes > data.byteLength) throw new Error('Damaged project file')
      channels.push(readFloats(view, offset, layer.frames))
      offset += bytes
    }
    const audio: AudioData = createAudioData(header.sampleRate, channels)
    return { name: layer.name, volume: layer.volume, muted: layer.muted, solo: layer.solo, color: layer.color, audio }
  })
  return {
    sampleRate: header.sampleRate,
    activeLayer: Math.min(Math.max(0, header.activeLayer), Math.max(0, layers.length - 1)),
    layers
  }
}

function parseHeader(text: string): Header {
  const raw = JSON.parse(text) as Partial<Header>
  const sampleRate = Number(raw.sampleRate)
  if (!Number.isFinite(sampleRate) || sampleRate < 1000 || sampleRate > 768000) {
    throw new Error('Damaged project file')
  }
  if (!Array.isArray(raw.layers)) throw new Error('Damaged project file')
  const layers = raw.layers.map((layer: Partial<StoredLayer>): StoredLayer => {
    const channels = Number(layer.channels)
    const frames = Number(layer.frames)
    if (!Number.isInteger(channels) || channels < 1 || channels > 8 || !Number.isInteger(frames) || frames < 0) {
      throw new Error('Damaged project file')
    }
    return {
      name: typeof layer.name === 'string' && layer.name.trim() !== '' ? layer.name : 'Layer',
      volume: Number.isFinite(layer.volume) ? Number(layer.volume) : 1,
      muted: layer.muted === true,
      solo: layer.solo === true,
      color: Number.isInteger(layer.color) ? Number(layer.color) : 0,
      channels,
      frames
    }
  })
  return {
    app: String(raw.app ?? ''),
    sampleRate,
    activeLayer: Number.isInteger(raw.activeLayer) ? Number(raw.activeLayer) : 0,
    layers
  }
}

function align4(value: number): number {
  return (value + 3) & ~3
}

function writeFloats(view: DataView, offset: number, samples: Float32Array): void {
  if (LITTLE_ENDIAN) {
    new Float32Array(view.buffer, offset, samples.length).set(samples)
    return
  }
  for (let i = 0; i < samples.length; i++) view.setFloat32(offset + i * 4, samples[i]!, true)
}

function readFloats(view: DataView, offset: number, count: number): Float32Array {
  if (LITTLE_ENDIAN) return new Float32Array(view.buffer.slice(offset, offset + count * 4))
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(offset + i * 4, true)
  return out
}
