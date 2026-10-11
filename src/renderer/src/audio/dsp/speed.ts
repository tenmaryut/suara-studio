import { type AudioData, cloneAudio, createAudioData, frameCount } from '../audio-data'

const MIN_FACTOR = 0.25
const MAX_FACTOR = 4
/** Sinc zero crossings on each side of the kernel centre: 36 taps when slowing down. */
const ZERO_CROSSINGS = 16
/** Prototype table points per zero crossing; weights in between are interpolated linearly. */
const TABLE_RESOLUTION = 512
const KAISER_BETA = 8
/** Cutoff as a share of the lower of the two Nyquist frequencies, leaving room for the roll-off. */
const ROLLOFF = 0.9
/** Read positions are rounded to 1/PHASES of an input frame (timing error below -75 dB at 19 kHz). */
const PHASES = 4096

let prototypeTable: Float64Array | undefined

/** Limits `value` to [min, max]; NaN becomes `min`. */
function clamp(value: number, min: number, max: number): number {
  return value > max ? max : value >= min ? value : min
}

/** Zeroth-order modified Bessel function of the first kind, for the Kaiser window. */
function besselI0(x: number): number {
  const quarterSquare = (x * x) / 4
  let term = 1
  let sum = 1
  for (let k = 1; term > sum * 1e-17; k++) {
    term *= quarterSquare / (k * k)
    sum += term
  }
  return sum
}

/** Kaiser-windowed sinc from the centre out to the last zero crossing, plus a zero guard point. */
function prototype(): Float64Array {
  if (prototypeTable) return prototypeTable
  const size = ZERO_CROSSINGS * TABLE_RESOLUTION
  const table = new Float64Array(size + 2)
  const scale = 1 / besselI0(KAISER_BETA)
  for (let m = 0; m <= size; m++) {
    const x = (Math.PI * m) / TABLE_RESOLUTION
    const r = m / size
    const sinc = m === 0 ? 1 : Math.sin(x) / x
    table[m] = sinc * besselI0(KAISER_BETA * Math.sqrt(1 - r * r)) * scale
  }
  prototypeTable = table
  return table
}

/**
 * Interpolation weights for each fractional read position: row `p` holds the `2 * half` taps
 * starting at input frame floor(position) - half + 1 for a position p / PHASES past a frame.
 * `cutoff` is in units of the input Nyquist frequency. Rows sum to 1 so DC passes unchanged.
 */
function weightBank(cutoff: number, half: number): Float32Array {
  const table = prototype()
  const taps = 2 * half
  const end = ZERO_CROSSINGS * TABLE_RESOLUTION
  const step = cutoff * TABLE_RESOLUTION
  const bank = new Float32Array(PHASES * taps)
  const row = new Float64Array(taps)
  for (let p = 0; p < PHASES; p++) {
    const centre = half - 1 + p / PHASES
    let total = 0
    for (let t = 0; t < taps; t++) {
      const x = Math.abs(centre - t) * step
      const m = x | 0
      const weight = x < end ? table[m]! + (x - m) * (table[m + 1]! - table[m]!) : 0
      row[t] = weight
      total += weight
    }
    for (let t = 0; t < taps; t++) bank[p * taps + t] = row[t]! / total
  }
  return bank
}

/** Plays the audio faster (factor > 1) or slower (factor < 1); pitch changes with speed, like a tape. */
export function changeSpeed(data: AudioData, factor: number): AudioData {
  const speed = Number.isNaN(factor) ? 1 : clamp(factor, MIN_FACTOR, MAX_FACTOR)
  if (speed === 1) return cloneAudio(data)
  const inputLength = frameCount(data)
  const outputLength = Math.round(inputLength / speed)
  const inputs = data.channels
  const outputs = inputs.map(() => new Float32Array(outputLength))
  // Windowed-sinc interpolation. Speeding up lowers the cutoff by 1/speed and widens the kernel
  // to match, so nothing above the new Nyquist frequency folds back as aliasing.
  const cutoff = ROLLOFF * Math.min(1, 1 / speed)
  const half = Math.ceil(ZERO_CROSSINGS / cutoff)
  const taps = 2 * half
  const bank = weightBank(cutoff, half)
  const count = inputs.length
  for (let j = 0; j < outputLength; j++) {
    // Split the read position into a whole frame and the nearest phase (kept in int32 range).
    const position = j * speed
    let whole = Math.floor(position)
    let phase = Math.round((position - whole) * PHASES)
    if (phase === PHASES) {
      whole++
      phase = 0
    }
    const row = phase * taps
    const first = whole - half + 1
    // Taps outside the audio are skipped, which treats it as padded with silence.
    const from = first < 0 ? -first : 0
    const to = Math.min(taps, inputLength - first)
    // Channels go in pairs so each weight is loaded once for two independent running sums.
    let c = 0
    for (; c + 1 < count; c += 2) {
      const left = inputs[c]!
      const right = inputs[c + 1]!
      let sumLeft = 0
      let sumRight = 0
      for (let t = from; t < to; t++) {
        const weight = bank[row + t]!
        sumLeft += weight * left[first + t]!
        sumRight += weight * right[first + t]!
      }
      outputs[c]![j] = sumLeft
      outputs[c + 1]![j] = sumRight
    }
    if (c < count) {
      const input = inputs[c]!
      let sum = 0
      for (let t = from; t < to; t++) sum += bank[row + t]! * input[first + t]!
      outputs[c]![j] = sum
    }
  }
  return createAudioData(data.sampleRate, outputs)
}
