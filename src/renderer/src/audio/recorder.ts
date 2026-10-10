import { type AudioData, concatChunks } from './audio-data'
import workletUrl from './recorder-worklet.ts?worker&url'
import type { ChunkMessage, FlushedMessage } from './recorder-worklet'

export type RecorderState = 'idle' | 'starting' | 'recording' | 'paused' | 'stopping'

export interface MicrophoneOption {
  deviceId: string
  label: string
}

const CHUNK_FRAMES = 2048
const FLUSH_TIMEOUT_MS = 1500

/** Lists audio inputs. Labels stay empty until microphone permission has been granted once. */
export async function listMicrophones(): Promise<MicrophoneOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter(
      (device) =>
        device.kind === 'audioinput' &&
        device.deviceId !== 'default' &&
        device.deviceId !== 'communications' &&
        device.deviceId !== ''
    )
    .map((device) => ({ deviceId: device.deviceId, label: device.label }))
}

/**
 * Captures raw PCM from a microphone through an AudioWorklet. Browser processing
 * (echo cancellation, noise suppression, auto gain) is turned off so the recording is
 * what the microphone actually hears.
 */
export class Recorder {
  state: RecorderState = 'idle'
  /** Called about 20 times a second with per-channel peaks (1.0 = 0 dBFS). */
  onLevel: ((peaks: number[]) => void) | null = null
  /** Called when the input device disappears while recording. */
  onDeviceLost: (() => void) | null = null

  private context: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private sink: GainNode | null = null
  private chunks: Float32Array[][] = []
  private frames = 0
  private flushWaiter: (() => void) | null = null

  get sampleRate(): number {
    return this.context?.sampleRate ?? 0
  }

  get elapsedSeconds(): number {
    return this.context ? this.frames / this.context.sampleRate : 0
  }

  async start(deviceId?: string): Promise<void> {
    if (this.state !== 'idle') throw new Error(`Recorder is ${this.state}`)
    this.state = 'starting'
    this.chunks = []
    this.frames = 0
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 2 }
        }
      })
      const track = this.stream.getAudioTracks()[0]
      if (!track) throw new DOMException('No audio track', 'NotFoundError')
      const channelCount = Math.min(2, Math.max(1, track.getSettings().channelCount ?? 1))
      track.addEventListener('ended', () => {
        if (this.state === 'recording' || this.state === 'paused') this.onDeviceLost?.()
      })

      this.context = new AudioContext({ latencyHint: 'interactive' })
      await this.context.audioWorklet.addModule(workletUrl)
      this.source = this.context.createMediaStreamSource(this.stream)
      this.node = new AudioWorkletNode(this.context, 'suara-recorder', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { chunkFrames: CHUNK_FRAMES, channelCount }
      })
      this.node.port.onmessage = (event: MessageEvent<ChunkMessage | FlushedMessage>) =>
        this.handleMessage(event.data)
      // The worklet must reach the destination to be processed; a muted gain keeps it silent.
      this.sink = this.context.createGain()
      this.sink.gain.value = 0
      this.source.connect(this.node)
      this.node.connect(this.sink)
      this.sink.connect(this.context.destination)
      if (this.context.state === 'suspended') await this.context.resume()
      this.state = 'recording'
    } catch (error) {
      await this.teardown()
      throw error
    }
  }

  pause(): void {
    if (this.state === 'recording') this.state = 'paused'
  }

  resume(): void {
    if (this.state === 'paused') this.state = 'recording'
  }

  /** Stops recording and returns the captured audio, or null if nothing was captured. */
  async stop(): Promise<AudioData | null> {
    if (this.state !== 'recording' && this.state !== 'paused') return null
    const wasPaused = this.state === 'paused'
    this.state = 'stopping'
    if (!wasPaused) await this.flush()
    const sampleRate = this.context?.sampleRate ?? 48000
    const chunks = this.chunks
    await this.teardown()
    if (this.frames === 0 || chunks.length === 0) return null
    return concatChunks(sampleRate, chunks)
  }

  async cancel(): Promise<void> {
    await this.teardown()
  }

  private handleMessage(message: ChunkMessage | FlushedMessage): void {
    if (message.type === 'flushed') {
      this.flushWaiter?.()
      return
    }
    this.onLevel?.(message.peaks)
    // While paused (or stopping after a pause) the input keeps flowing for the meter only.
    if (this.state === 'recording' || (this.state === 'stopping' && this.flushWaiter)) {
      this.chunks.push(message.channels)
      this.frames += message.channels[0]?.length ?? 0
    }
  }

  private flush(): Promise<void> {
    const node = this.node
    if (!node) return Promise.resolve()
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.flushWaiter = null
        resolve()
      }
      // Fall back to what has arrived so far if the audio thread never answers.
      const timer = setTimeout(done, FLUSH_TIMEOUT_MS)
      this.flushWaiter = done
      node.port.postMessage({ type: 'flush' })
    })
  }

  private async teardown(): Promise<void> {
    this.source?.disconnect()
    this.node?.disconnect()
    this.sink?.disconnect()
    if (this.node) this.node.port.onmessage = null
    this.stream?.getTracks().forEach((track) => track.stop())
    const context = this.context
    this.source = null
    this.node = null
    this.sink = null
    this.stream = null
    this.context = null
    this.flushWaiter = null
    this.state = 'idle'
    if (context && context.state !== 'closed') await context.close().catch(() => undefined)
  }
}
