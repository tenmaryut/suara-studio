// Runs on the audio rendering thread. Copies microphone input into fixed-size chunks and
// posts them, with per-channel peak levels, to the main thread.

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}
/** Frame index (in the AudioContext's timeline) of the first sample of the current block. */
declare const currentFrame: number
declare function registerProcessor(
  name: string,
  processor: new (options: ProcessorOptions) => AudioWorkletProcessor
): void

interface ProcessorOptions {
  processorOptions?: { chunkFrames?: number; channelCount?: number }
}

export interface ChunkMessage {
  type: 'chunk'
  channels: Float32Array[]
  peaks: number[]
  /** Context frame of the chunk's first sample, used to line takes up with playback. */
  startFrame: number
}

export interface FlushedMessage {
  type: 'flushed'
}

class SuaraRecorderProcessor extends AudioWorkletProcessor {
  private readonly chunkFrames: number
  private readonly channelCount: number
  private buffers: Float32Array[]
  private peaks: number[]
  private filled = 0
  private chunkStart = 0

  constructor(options: ProcessorOptions) {
    super()
    this.chunkFrames = options.processorOptions?.chunkFrames ?? 2048
    this.channelCount = options.processorOptions?.channelCount ?? 1
    this.buffers = this.allocate()
    this.peaks = new Array<number>(this.channelCount).fill(0)
    this.port.onmessage = (event: MessageEvent<{ type: string }>) => {
      if (event.data?.type === 'flush') {
        this.flush()
        this.port.postMessage({ type: 'flushed' } satisfies FlushedMessage)
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0]
    if (!input || input.length === 0) return true
    const frames = input[0]!.length
    let read = 0
    while (read < frames) {
      if (this.filled === 0) this.chunkStart = currentFrame + read
      const count = Math.min(frames - read, this.chunkFrames - this.filled)
      for (let c = 0; c < this.channelCount; c++) {
        const source = input[c] ?? input[0]!
        const target = this.buffers[c]!
        let peak = this.peaks[c]!
        for (let i = 0; i < count; i++) {
          const sample = source[read + i]!
          target[this.filled + i] = sample
          const magnitude = sample < 0 ? -sample : sample
          if (magnitude > peak) peak = magnitude
        }
        this.peaks[c] = peak
      }
      this.filled += count
      read += count
      if (this.filled === this.chunkFrames) this.flush()
    }
    return true
  }

  private allocate(): Float32Array[] {
    return Array.from({ length: this.channelCount }, () => new Float32Array(this.chunkFrames))
  }

  private flush(): void {
    if (this.filled === 0) return
    const channels =
      this.filled === this.chunkFrames
        ? this.buffers
        : this.buffers.map((buffer) => buffer.slice(0, this.filled))
    const message: ChunkMessage = { type: 'chunk', channels, peaks: this.peaks, startFrame: this.chunkStart }
    this.port.postMessage(
      message,
      channels.map((channel) => channel.buffer as ArrayBuffer)
    )
    this.buffers = this.allocate()
    this.peaks = new Array<number>(this.channelCount).fill(0)
    this.filled = 0
  }
}

registerProcessor('suara-recorder', SuaraRecorderProcessor)
