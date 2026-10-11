import { type AudioData, createAudioData, frameCount } from '../audio-data'
import { dbToGain } from '../effects'

export interface CompressorOptions {
  /** Level in dBFS (-120..0) where compression starts, at the middle of the knee. */
  thresholdDb: number
  /** dB over the threshold in for each dB over it out; values below 1 count as 1. */
  ratio: number
  /** Time for the level detector to follow a rise (0 = instant). */
  attackSeconds: number
  /** Time for the level detector to follow a fall (0 = instant). */
  releaseSeconds: number
  /** Gain added after compression, in dB (-60..60). */
  makeupDb: number
  /** Width of the soft knee in dB (0..48, default 6; 0 is a hard knee). */
  kneeDb?: number
}

export interface GateOptions {
  /** Level in dBFS (-120..0) below which the gate closes. */
  thresholdDb: number
  /** Time for the gain to rise to unity when the gate opens. */
  attackSeconds: number
  /** Time the gate stays open after the level falls below the threshold. */
  holdSeconds: number
  /** Time for the gain to fall to the floor once the hold has passed. */
  releaseSeconds: number
  /** Gain of the closed gate in dB (at most 0; -Infinity silences completely). */
  floorDb: number
}

const MIN_DB = -120
const DEFAULT_KNEE_DB = 6
const MAX_KNEE_DB = 48
const MAX_MAKEUP_DB = 60
/** Release time of the gate's level detector, which rises instantly. */
const GATE_DETECTOR_RELEASE_SECONDS = 0.01
/** Detector and gain state below this is flushed to zero so it never turns into slow denormals. */
const DENORMAL_LIMIT = 1e-20

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

/** One-pole smoothing coefficient for a time constant; 0 seconds is instant. */
function smoothing(seconds: number, sampleRate: number): number {
  return seconds > 0 ? Math.exp(-1 / (seconds * sampleRate)) : 0
}

/** The largest absolute sample across channels, per frame. */
function framePeaks(data: AudioData): Float64Array {
  const peaks = new Float64Array(frameCount(data))
  for (const channel of data.channels) {
    for (let i = 0; i < peaks.length; i++) {
      const value = Math.abs(channel[i]!)
      if (value > peaks[i]!) peaks[i] = value
    }
  }
  return peaks
}

/** Multiplies every channel by the same gain per frame. */
function applyFrameGains(data: AudioData, gains: Float64Array): AudioData {
  const channels = data.channels.map((input) => {
    const out = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) out[i] = input[i]! * gains[i]!
    return out
  })
  return createAudioData(data.sampleRate, channels)
}

/** Feed-forward compressor; channels share one gain so the stereo image stays put. */
export function compress(data: AudioData, options: CompressorOptions): AudioData {
  const { sampleRate } = data
  const threshold = clamp(options.thresholdDb, MIN_DB, 0)
  const slope = 1 / clamp(options.ratio, 1, Infinity) - 1
  const knee = clamp(options.kneeDb ?? DEFAULT_KNEE_DB, 0, MAX_KNEE_DB)
  const halfKnee = knee / 2
  const kneeScale = knee > 0 ? slope / (2 * knee) : 0
  const makeupDb = clamp(options.makeupDb, -MAX_MAKEUP_DB, MAX_MAKEUP_DB)
  const makeup = dbToGain(makeupDb)
  const attack = smoothing(options.attackSeconds, sampleRate)
  const release = smoothing(options.releaseSeconds, sampleRate)
  // Below the knee only the makeup applies, so quiet frames skip the log/exp maths.
  const kneeStart = dbToGain(threshold - halfKnee)
  const gains = framePeaks(data)
  let envelope = 0
  for (let i = 0; i < gains.length; i++) {
    const level = gains[i]!
    envelope = level + (level > envelope ? attack : release) * (envelope - level)
    if (envelope < DENORMAL_LIMIT) envelope = 0
    if (envelope <= kneeStart) {
      gains[i] = makeup
      continue
    }
    // Static curve in dB with a quadratic soft knee (Giannoulis, Massberg & Reiss 2012).
    const over = 20 * Math.log10(envelope) - threshold
    const reduction =
      over < halfKnee && knee > 0 ? kneeScale * (over + halfKnee) * (over + halfKnee) : slope * over
    gains[i] = dbToGain(reduction + makeupDb)
  }
  return applyFrameGains(data, gains)
}

/** Noise gate: lowers everything quieter than the threshold to floorDb; channels share one gain. */
export function noiseGate(data: AudioData, options: GateOptions): AudioData {
  const { sampleRate } = data
  const threshold = dbToGain(clamp(options.thresholdDb, MIN_DB, 0))
  const floor = dbToGain(clamp(options.floorDb, -Infinity, 0))
  const attack = smoothing(options.attackSeconds, sampleRate)
  const release = smoothing(options.releaseSeconds, sampleRate)
  const detector = smoothing(GATE_DETECTOR_RELEASE_SECONDS, sampleRate)
  const holdFrames = Math.round(clamp(options.holdSeconds * sampleRate, 0, Number.MAX_SAFE_INTEGER))
  const gains = framePeaks(data)
  let envelope = 0
  // Frames since the envelope fell below the threshold; the gate starts closed.
  let quiet = holdFrames + 1
  let gain = floor
  for (let i = 0; i < gains.length; i++) {
    const level = gains[i]!
    envelope = level >= envelope ? level : level + detector * (envelope - level)
    if (envelope < DENORMAL_LIMIT) envelope = 0
    if (envelope >= threshold) quiet = 0
    else if (quiet <= holdFrames) quiet++
    const target = quiet <= holdFrames ? 1 : floor
    gain = target + (target > gain ? attack : release) * (gain - target)
    if (gain < DENORMAL_LIMIT) gain = 0
    gains[i] = gain
  }
  return applyFrameGains(data, gains)
}
