import { describe, expect, it } from 'vitest'
import {
  type AudioData,
  cloneAudio,
  createAudioData,
  durationOf,
  frameCount
} from '../../src/renderer/src/audio/audio-data'
import {
  type BiquadSpec,
  applyFilters,
  changeSpeed,
  compress,
  echo,
  noiseGate,
  reverb,
  ringModulate,
  tremolo,
  truncateSilence
} from '../../src/renderer/src/audio/dsp'
import { dbToGain } from '../../src/renderer/src/audio/effects'
import { samples } from './helpers'

/** `seconds` of a sine wave. */
function sine(frequency: number, seconds: number, sampleRate: number, amplitude = 1): Float32Array {
  return Float32Array.from(
    { length: Math.round(seconds * sampleRate) },
    (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
  )
}

/** Repeatable white noise in [-amplitude, amplitude). */
function noise(length: number, amplitude: number, seed = 1): Float32Array {
  let state = seed
  return Float32Array.from({ length }, () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return amplitude * (state / 2 ** 31 - 1)
  })
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function mono(sampleRate: number, channel: Float32Array): AudioData {
  return createAudioData(sampleRate, [channel])
}

function rms(channel: Float32Array, start = 0, end = channel.length): number {
  let sum = 0
  for (let i = start; i < end; i++) sum += channel[i]! * channel[i]!
  return Math.sqrt(sum / (end - start))
}

function peak(channel: Float32Array, start = 0, end = channel.length): number {
  let max = 0
  for (let i = start; i < end; i++) max = Math.max(max, Math.abs(channel[i]!))
  return max
}

function zeroCrossings(channel: Float32Array): number {
  let count = 0
  for (let i = 1; i < channel.length; i++) {
    if ((channel[i - 1]! < 0) !== (channel[i]! < 0)) count++
  }
  return count
}

function allFinite(data: AudioData): boolean {
  return data.channels.every((channel) => channel.every((value) => Number.isFinite(value)))
}

/** RMS gain of the filters for a sine, once the first 2048 samples have settled. */
function filterGain(specs: BiquadSpec[], frequency: number, sampleRate = 48000): number {
  const input = sine(frequency, 1, sampleRate)
  const output = applyFilters(mono(sampleRate, input), specs).channels[0]!
  return rms(output, 2048) / rms(input, 2048)
}

describe('every effect', () => {
  const effects: [string, (data: AudioData) => AudioData, boolean][] = [
    ['applyFilters', (data) => applyFilters(data, [{ type: 'lowpass', frequency: 1000 }]), true],
    ['echo', (data) => echo(data, { delaySeconds: 0.01, feedback: 0.5, mix: 0.5 }), true],
    ['reverb', (data) => reverb(data, { roomSize: 0.5, damping: 0.5, mix: 0.3 }), true],
    [
      'compress',
      (data) =>
        compress(data, {
          thresholdDb: -20,
          ratio: 4,
          attackSeconds: 0.005,
          releaseSeconds: 0.05,
          makeupDb: 3
        }),
      true
    ],
    [
      'noiseGate',
      (data) =>
        noiseGate(data, {
          thresholdDb: -40,
          attackSeconds: 0.001,
          holdSeconds: 0.01,
          releaseSeconds: 0.02,
          floorDb: -60
        }),
      true
    ],
    ['ringModulate', (data) => ringModulate(data, { frequency: 30, mix: 0.7 }), true],
    ['tremolo', (data) => tremolo(data, { rate: 5, depth: 0.5 }), true],
    ['changeSpeed', (data) => changeSpeed(data, 1.5), false],
    [
      'truncateSilence',
      (data) => truncateSilence(data, { thresholdDb: -40, minSilenceSeconds: 0.05, keepSeconds: 0.02 }),
      false
    ]
  ]

  // A tone, a pause and some noise, with each channel a little different.
  const fixture = (channelCount: number): AudioData =>
    createAudioData(
      8000,
      Array.from({ length: channelCount }, (_, c) =>
        concat(sine(220 * (c + 1), 0.1, 8000, 0.8), new Float32Array(800), noise(800, 0.3, c + 1))
      )
    )

  it.each(effects)('%s keeps the format, stays finite and leaves the input alone', (_, effect, sameLength) => {
    for (const channelCount of [1, 2, 3]) {
      const input = fixture(channelCount)
      const before = cloneAudio(input)
      const output = effect(input)
      expect(output).not.toBe(input)
      expect(output.sampleRate).toBe(8000)
      expect(output.channels).toHaveLength(channelCount)
      if (sameLength) expect(frameCount(output)).toBe(frameCount(input))
      expect(allFinite(output)).toBe(true)
      expect(input).toEqual(before)
    }
  })

  it.each(effects)('%s accepts empty audio', (_, effect) => {
    const output = effect(createAudioData(44100, [new Float32Array(0), new Float32Array(0)]))
    expect(output.sampleRate).toBe(44100)
    expect(output.channels).toHaveLength(2)
    expect(frameCount(output)).toBe(0)
  })
})

describe('applyFilters', () => {
  it('lowpass keeps lows and cuts highs', () => {
    const lowpass: BiquadSpec[] = [{ type: 'lowpass', frequency: 1000 }]
    expect(filterGain(lowpass, 100)).toBeGreaterThan(0.9)
    expect(filterGain(lowpass, 8000)).toBeLessThan(0.1)
  })

  it('highpass keeps highs and cuts lows', () => {
    const highpass: BiquadSpec[] = [{ type: 'highpass', frequency: 1000 }]
    expect(filterGain(highpass, 8000)).toBeGreaterThan(0.9)
    expect(filterGain(highpass, 100)).toBeLessThan(0.1)
  })

  it('shelves boost or cut one end of the spectrum', () => {
    const lowShelf: BiquadSpec[] = [{ type: 'lowshelf', frequency: 200, gainDb: 6 }]
    const bass = filterGain(lowShelf, 50)
    expect(bass).toBeGreaterThan(1.8)
    expect(bass).toBeLessThan(2.05)
    expect(Math.abs(filterGain(lowShelf, 5000) - 1)).toBeLessThan(0.1)
    const highShelf: BiquadSpec[] = [{ type: 'highshelf', frequency: 2000, gainDb: -6 }]
    expect(Math.abs(filterGain(highShelf, 15000) - 0.5)).toBeLessThan(0.05)
    expect(Math.abs(filterGain(highShelf, 100) - 1)).toBeLessThan(0.05)
  })

  it('bandpass, peaking and notch act around their centre frequency', () => {
    const bandpass: BiquadSpec[] = [{ type: 'bandpass', frequency: 1000 }]
    expect(filterGain(bandpass, 1000)).toBeCloseTo(1, 2)
    expect(filterGain(bandpass, 100)).toBeLessThan(0.15)
    expect(filterGain(bandpass, 10000)).toBeLessThan(0.15)
    const peaking: BiquadSpec[] = [{ type: 'peaking', frequency: 1000, gainDb: 6 }]
    expect(filterGain(peaking, 1000)).toBeCloseTo(dbToGain(6), 2)
    expect(Math.abs(filterGain(peaking, 100) - 1)).toBeLessThan(0.05)
    const notch: BiquadSpec[] = [{ type: 'notch', frequency: 1000 }]
    expect(filterGain(notch, 1000)).toBeLessThan(0.01)
    expect(filterGain(notch, 5000)).toBeGreaterThan(0.9)
  })

  it('runs sections in series', () => {
    const once = filterGain([{ type: 'lowpass', frequency: 1000 }], 4000)
    const twice = filterGain(
      [
        { type: 'lowpass', frequency: 1000 },
        { type: 'lowpass', frequency: 1000 }
      ],
      4000
    )
    expect(twice).toBeCloseTo(once * once, 3)
  })

  it('filters each channel on its own, starting from silence', () => {
    const tone = sine(440, 0.1, 48000)
    const specs: BiquadSpec[] = [{ type: 'highpass', frequency: 300, q: 2 }]
    const stereo = applyFilters(createAudioData(48000, [tone, new Float32Array(tone.length)]), specs)
    expect(samples(stereo, 0)).toEqual(samples(applyFilters(mono(48000, tone), specs)))
    expect(samples(stereo, 1).every((value) => value === 0)).toBe(true)
  })

  it('copies the audio when there are no sections and clamps wild settings', () => {
    const input = mono(48000, noise(4800, 0.5))
    expect(applyFilters(input, [])).toEqual(input)
    const wild = applyFilters(input, [
      { type: 'lowpass', frequency: 1e6, q: 0 },
      { type: 'peaking', frequency: -10, q: 1e9, gainDb: 1e4 },
      { type: 'highshelf', frequency: Number.NaN, gainDb: -1e4 }
    ])
    expect(allFinite(wild)).toBe(true)
  })
})

describe('echo', () => {
  const impulse = (): AudioData => mono(1000, concat(Float32Array.of(1), new Float32Array(999)))

  it('repeats an impulse every delay, each repeat scaled by the feedback', () => {
    const output = echo(impulse(), { delaySeconds: 0.1, feedback: 0.5, mix: 0.8 })
    const out = samples(output)
    expect(out).toHaveLength(1000)
    expect(out[0]).toBe(1)
    expect(out[100]).toBeCloseTo(0.8, 6)
    expect(out[200]).toBeCloseTo(0.4, 6)
    expect(out[300]).toBeCloseTo(0.2, 6)
    const others = out.filter((_, i) => i % 100 !== 0)
    expect(others.every((value) => value === 0)).toBe(true)
  })

  it('returns an exact copy when mix is 0', () => {
    const input = mono(8000, noise(2000, 0.5))
    const output = echo(input, { delaySeconds: 0.05, feedback: 0.7, mix: 0 })
    expect(output).not.toBe(input)
    expect(output).toEqual(input)
  })

  it('clamps feedback and keeps the delay at least one sample', () => {
    const loud = samples(echo(impulse(), { delaySeconds: 0.1, feedback: 3, mix: 1 }))
    expect(loud[200]).toBeCloseTo(0.95, 6)
    const tiny = samples(echo(impulse(), { delaySeconds: 0, feedback: 0, mix: 0.5 }))
    expect(tiny.slice(0, 3)).toEqual([1, 0.5, 0])
  })
})

describe('reverb', () => {
  const sampleRate = 22050
  const impulse = (channelCount: number): AudioData =>
    createAudioData(
      sampleRate,
      Array.from({ length: channelCount }, () => concat(Float32Array.of(1), new Float32Array(3 * sampleRate)))
    )
  const energy = (channel: Float32Array, from: number, to: number): number =>
    rms(channel, Math.round(from * sampleRate), Math.round(to * sampleRate)) ** 2

  it('returns an exact copy when mix is 0', () => {
    const input = mono(8000, noise(2000, 0.5))
    expect(reverb(input, { roomSize: 0.8, damping: 0.2, mix: 0 })).toEqual(input)
  })

  it('turns an impulse into a finite, decaying tail', () => {
    const output = reverb(impulse(1), { roomSize: 0.7, damping: 0.5, mix: 1 })
    const tail = output.channels[0]!
    expect(allFinite(output)).toBe(true)
    // The dry impulse is at half level and the reverb has not arrived yet.
    expect(tail[0]).toBe(0.5)
    const early = energy(tail, 0.05, 0.5)
    const middle = energy(tail, 1, 1.5)
    const late = energy(tail, 2.5, 3)
    expect(early).toBeGreaterThan(0)
    expect(middle).toBeLessThan(early)
    expect(late).toBeLessThan(middle)
  })

  it('rings longer in a bigger room', () => {
    const small = reverb(impulse(1), { roomSize: 0.3, damping: 0.5, mix: 1 }).channels[0]!
    const large = reverb(impulse(1), { roomSize: 0.9, damping: 0.5, mix: 1 }).channels[0]!
    expect(energy(large, 1, 2)).toBeGreaterThan(100 * energy(small, 1, 2))
  })

  it('keeps mono as mono and gives stereo two different tails', () => {
    expect(reverb(impulse(1), { roomSize: 0.5, damping: 0.5, mix: 0.5 }).channels).toHaveLength(1)
    const stereo = reverb(impulse(2), { roomSize: 0.5, damping: 0.5, mix: 0.5 })
    expect(stereo.channels).toHaveLength(2)
    expect(samples(stereo, 0)).not.toEqual(samples(stereo, 1))
  })
})

describe('compress', () => {
  const options = {
    thresholdDb: -20,
    ratio: 4,
    attackSeconds: 0.005,
    releaseSeconds: 0.1,
    makeupDb: 0
  }

  it('turns loud audio down once the attack has passed', () => {
    const output = compress(mono(48000, sine(440, 0.5, 48000, 0.9)), options).channels[0]!
    // 0.9 is 19.1 dB over the threshold, so ratio 4 leaves 4.8 dB over it: a peak of about 0.17.
    const level = peak(output, 4800)
    expect(level).toBeLessThan(0.25)
    expect(level).toBeCloseTo(0.9 * dbToGain(-0.75 * (20 * Math.log10(0.9) + 20)), 1)
  })

  it('passes quiet audio through, plus makeup gain', () => {
    const quiet = sine(440, 0.5, 48000, 0.01)
    const plain = compress(mono(48000, quiet), options).channels[0]!
    expect(Math.abs(rms(plain) / rms(quiet) - 1)).toBeLessThan(0.01)
    const boosted = compress(mono(48000, quiet), { ...options, makeupDb: 6 }).channels[0]!
    expect(rms(boosted) / rms(quiet)).toBeCloseTo(dbToGain(6), 4)
  })

  it('applies the same gain to every channel', () => {
    const left = sine(440, 0.3, 48000, 0.9)
    const right = sine(440, 0.3, 48000, 0.3)
    const output = compress(createAudioData(48000, [left, right]), options)
    for (let i = 1000; i < left.length; i += 37) {
      if (Math.abs(left[i]!) > 0.1) {
        expect(output.channels[1]![i]! / output.channels[0]![i]!).toBeCloseTo(1 / 3, 5)
      }
    }
  })

  it('treats ratios below 1 as 1 and limits with an infinite ratio', () => {
    const loud = sine(440, 0.3, 48000, 0.9)
    const unchanged = compress(mono(48000, loud), { ...options, ratio: 0.5 })
    expect(samples(unchanged)).toEqual(Array.from(loud))
    const limited = compress(mono(48000, loud), {
      ...options,
      thresholdDb: -12,
      ratio: Infinity,
      attackSeconds: 0,
      kneeDb: 0
    }).channels[0]!
    expect(peak(limited)).toBeLessThanOrEqual(dbToGain(-12) + 1e-6)
    expect(peak(limited, 4800)).toBeGreaterThan(0.24)
  })
})

describe('noiseGate', () => {
  const sampleRate = 16000
  const half = sampleRate / 2
  const options = {
    thresholdDb: -40,
    attackSeconds: 0.001,
    holdSeconds: 0.05,
    releaseSeconds: 0.02,
    floorDb: -60
  }
  // Noise, burst, noise, burst, noise: half a second each.
  const hiss = noise(5 * half, 0.001)
  const bursts = hiss.slice()
  for (const start of [half, 3 * half]) bursts.set(sine(300, 0.5, sampleRate, 0.5), start)

  it('pushes noise between bursts down to the floor and keeps the bursts', () => {
    const output = noiseGate(mono(sampleRate, bursts), options).channels[0]!
    const gain = (from: number, to: number): number => rms(output, from, to) / rms(bursts, from, to)
    // The gate starts closed and stays closed until the first burst.
    expect(gain(0, half)).toBeCloseTo(dbToGain(-60), 5)
    // Hold and release are over well within 0.3 s of the end of a burst.
    expect(gain(2 * half + 0.3 * sampleRate, 3 * half)).toBeLessThan(2 * dbToGain(-60))
    expect(gain(4 * half + 0.3 * sampleRate, 5 * half)).toBeLessThan(2 * dbToGain(-60))
    for (const start of [half, 3 * half]) {
      expect(gain(start + 0.01 * sampleRate, start + half)).toBeCloseTo(1, 3)
      expect(peak(output, start, start + half)).toBeCloseTo(0.5, 3)
    }
  })

  it('holds the gate open after the level drops', () => {
    const after = 2 * half + 0.1 * sampleRate
    const window = (holdSeconds: number): number => {
      const output = noiseGate(mono(sampleRate, bursts), { ...options, holdSeconds }).channels[0]!
      return rms(output, after, after + 160) / rms(bursts, after, after + 160)
    }
    expect(window(0.2)).toBeCloseTo(1, 5)
    expect(window(0)).toBeLessThan(0.1)
  })

  it('silences completely with a floor of -Infinity dB', () => {
    const output = noiseGate(mono(sampleRate, bursts), { ...options, floorDb: -Infinity }).channels[0]!
    expect(peak(output, 0, half)).toBe(0)
  })
})

describe('ringModulate and tremolo', () => {
  const steady = (value: number, length: number): AudioData => mono(8000, new Float32Array(length).fill(value))

  it('return exact copies with no mix or depth', () => {
    const input = mono(8000, noise(800, 0.5))
    expect(ringModulate(input, { frequency: 200, mix: 0 })).toEqual(input)
    expect(tremolo(input, { rate: 4, depth: 0 })).toEqual(input)
  })

  it('ring modulation multiplies by a sine carrier', () => {
    const full = samples(ringModulate(steady(0.5, 800), { frequency: 100, mix: 1 }))
    expect(full[0]).toBe(0)
    expect(full[20]).toBeCloseTo(0.5, 6)
    expect(full[60]).toBeCloseTo(-0.5, 6)
    const blend = samples(ringModulate(steady(0.5, 800), { frequency: 100, mix: 0.25 }))
    for (const i of [7, 13, 333, 799]) {
      const carrier = Math.sin((2 * Math.PI * 100 * i) / 8000)
      expect(blend[i]).toBeCloseTo(0.75 * 0.5 + 0.25 * 0.5 * carrier, 6)
    }
  })

  it('tremolo dips the volume by depth once per cycle', () => {
    const out = samples(tremolo(steady(1, 8000), { rate: 2, depth: 0.6 }))
    expect(out[0]).toBe(1)
    expect(out[1000]).toBeCloseTo(0.7, 6)
    expect(out[2000]).toBeCloseTo(0.4, 6)
    expect(out[4000]).toBeCloseTo(1, 6)
    for (const i of [123, 2500, 7777]) {
      const gain = 1 - 0.6 * (0.5 - 0.5 * Math.cos((2 * Math.PI * 2 * i) / 8000))
      expect(out[i]).toBeCloseTo(gain, 6)
    }
  })
})

describe('changeSpeed', () => {
  const sampleRate = 48000
  const tone = sine(440, 1, sampleRate, 0.8)
  const crossingRate = (channel: Float32Array): number => zeroCrossings(channel) / channel.length

  it('doubling the speed halves the length and doubles the pitch', () => {
    const output = changeSpeed(mono(sampleRate, tone), 2).channels[0]!
    expect(output).toHaveLength(24000)
    expect(Math.abs(crossingRate(output) / crossingRate(tone) - 2)).toBeLessThan(0.04)
    expect(peak(output, 100, 23900)).toBeCloseTo(0.8, 2)
  })

  it('halving the speed doubles the length and halves the pitch', () => {
    const output = changeSpeed(mono(sampleRate, tone), 0.5).channels[0]!
    expect(output).toHaveLength(96000)
    expect(Math.abs(crossingRate(output) / crossingRate(tone) - 0.5)).toBeLessThan(0.01)
    expect(peak(output, 100, 95900)).toBeCloseTo(0.8, 2)
  })

  it('returns an exact copy at factor 1 and clamps the factor to 0.25..4', () => {
    const input = mono(8000, noise(1000, 0.5))
    const same = changeSpeed(input, 1)
    expect(same).not.toBe(input)
    expect(same).toEqual(input)
    expect(changeSpeed(input, Number.NaN)).toEqual(input)
    expect(frameCount(changeSpeed(input, 10))).toBe(250)
    expect(frameCount(changeSpeed(input, 0.1))).toBe(4000)
  })

  it('filters out what would alias when speeding up', () => {
    // 15 kHz played twice as fast would be 30 kHz, above the 24 kHz Nyquist frequency.
    const output = changeSpeed(mono(sampleRate, sine(15000, 0.25, sampleRate)), 2).channels[0]!
    expect(rms(output, 100, output.length - 100)).toBeLessThan(0.001)
  })

  it('treats every channel the same', () => {
    const stereo = changeSpeed(createAudioData(sampleRate, [tone, tone.slice()]), 0.8)
    expect(stereo.channels).toHaveLength(2)
    expect(samples(stereo, 0)).toEqual(samples(stereo, 1))
  })
})

describe('truncateSilence', () => {
  const sampleRate = 8000
  const tone = (seconds: number): Float32Array => sine(440, seconds, sampleRate, 0.5)
  const gap = (seconds: number): Float32Array => new Float32Array(seconds * sampleRate)
  const options = { thresholdDb: -40, minSilenceSeconds: 1, keepSeconds: 0.3 }

  it('shortens a long pause to the kept length and leaves the sound intact', () => {
    const input = concat(tone(1), gap(3), tone(1))
    const output = truncateSilence(mono(sampleRate, input), options)
    expect(durationOf(output)).toBeCloseTo(2.3, 2)
    const out = output.channels[0]!
    expect(Array.from(out.subarray(0, sampleRate))).toEqual(Array.from(input.subarray(0, sampleRate)))
    expect(Array.from(out.subarray(-sampleRate))).toEqual(Array.from(input.subarray(-sampleRate)))
  })

  it('leaves shorter pauses alone', () => {
    const input = mono(sampleRate, concat(tone(1), gap(0.5), tone(1)))
    expect(truncateSilence(input, options)).toEqual(input)
  })

  it('shortens leading and trailing pauses too', () => {
    const output = truncateSilence(mono(sampleRate, concat(gap(2), tone(1), gap(2))), options)
    expect(durationOf(output)).toBeCloseTo(1.6, 2)
    expect(frameCount(truncateSilence(mono(sampleRate, gap(2)), options))).toBe(2400)
    expect(frameCount(truncateSilence(mono(sampleRate, gap(2)), { ...options, keepSeconds: 0 }))).toBe(0)
  })

  it('crossfades the cut so a quiet hum stays smooth', () => {
    // A 47 Hz hum under the threshold: a plain splice would jump between unrelated phases.
    const input = concat(tone(1), sine(47, 3, sampleRate, 0.005), tone(1))
    const out = truncateSilence(mono(sampleRate, input), options).channels[0]!
    let largestStep = 0
    for (let i = sampleRate + 100; i < sampleRate + 2300; i++) {
      largestStep = Math.max(largestStep, Math.abs(out[i]! - out[i - 1]!))
    }
    expect(largestStep).toBeLessThan(0.001)
  })

  it('only counts frames where every channel is quiet', () => {
    const input = createAudioData(sampleRate, [tone(3), concat(tone(0.5), gap(2.5))])
    expect(truncateSilence(input, options)).toEqual(input)
  })
})
