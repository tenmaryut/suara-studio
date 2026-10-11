import type { EffectId } from '../../../shared/effects'
import type { MessageKey } from '../../../shared/i18n'
import type { AudioData } from '../audio/audio-data'
import {
  applyFilters,
  changeSpeed,
  compress,
  echo,
  noiseGate,
  reverb,
  ringModulate,
  tremolo,
  truncateSilence
} from '../audio/dsp'
import { applyGain, fadeIn, fadeOut, gainToDb, normalize, reverse, silence } from '../audio/effects'

export type ParamUnit = 'percent' | 'db' | 'seconds' | 'hz'

export interface EffectParam {
  id: string
  label: MessageKey
  unit: ParamUnit
  min: number
  max: number
  step: number
  default: number
}

export interface EffectPreset {
  label: MessageKey
  values: Record<string, number>
}

export type EffectValues = Record<string, number>

export interface EffectDefinition {
  id: EffectId
  params: EffectParam[]
  presets: EffectPreset[]
  /**
   * The part of the layer the effect works on when nothing is selected: all of it, or the first
   * or last `duration` seconds (fades).
   */
  defaultRange: 'all' | 'start' | 'end'
  /** True when the effect does nothing to silence, so silent parts can be reported instead. */
  needsSound: boolean
  /** Seconds of silence to add when the effect reaches the end of the layer, so it can ring out. */
  tailSeconds(values: EffectValues): number
  process(segment: AudioData, values: EffectValues): AudioData
}

const param = (
  id: string,
  label: MessageKey,
  unit: ParamUnit,
  min: number,
  max: number,
  step: number,
  value: number
): EffectParam => ({ id, label, unit, min, max, step, default: value })

const noTail = (): number => 0

const definitions: EffectDefinition[] = [
  {
    id: 'volume',
    params: [param('level', 'fx.param.level', 'percent', 0, 300, 5, 150)],
    presets: [
      { label: 'fx.preset.quieter', values: { level: 50 } },
      { label: 'fx.preset.louder', values: { level: 150 } },
      { label: 'fx.preset.double', values: { level: 200 } }
    ],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => applyGain(segment, gainToDb(v.level! / 100))
  },
  {
    id: 'normalize',
    params: [param('peak', 'fx.param.peak', 'db', -12, 0, 0.5, -1)],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => normalize(segment, v.peak!)
  },
  {
    id: 'fadeIn',
    params: [param('duration', 'fx.param.duration', 'seconds', 0.5, 10, 0.5, 2)],
    presets: [],
    defaultRange: 'start',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment) => fadeIn(segment)
  },
  {
    id: 'fadeOut',
    params: [param('duration', 'fx.param.duration', 'seconds', 0.5, 10, 0.5, 2)],
    presets: [],
    defaultRange: 'end',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment) => fadeOut(segment)
  },
  {
    id: 'silence',
    params: [],
    presets: [],
    defaultRange: 'all',
    needsSound: false,
    tailSeconds: noTail,
    process: (segment) => silence(segment)
  },
  {
    id: 'rumble',
    params: [param('cutoff', 'fx.param.cutoff', 'hz', 40, 300, 5, 80)],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) =>
      applyFilters(segment, [
        { type: 'highpass', frequency: v.cutoff! },
        { type: 'highpass', frequency: v.cutoff! }
      ])
  },
  {
    id: 'gate',
    params: [param('threshold', 'fx.param.threshold', 'db', -70, -20, 1, -45)],
    presets: [
      { label: 'fx.preset.gentle', values: { threshold: -55 } },
      { label: 'fx.preset.medium', values: { threshold: -45 } },
      { label: 'fx.preset.strong', values: { threshold: -35 } }
    ],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) =>
      noiseGate(segment, {
        thresholdDb: v.threshold!,
        attackSeconds: 0.002,
        holdSeconds: 0.08,
        releaseSeconds: 0.15,
        floorDb: -60
      })
  },
  {
    id: 'compress',
    params: [param('amount', 'fx.param.amount', 'percent', 0, 100, 5, 50)],
    presets: [
      { label: 'fx.preset.gentle', values: { amount: 25 } },
      { label: 'fx.preset.medium', values: { amount: 50 } },
      { label: 'fx.preset.strong', values: { amount: 85 } }
    ],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => {
      const amount = v.amount! / 100
      const thresholdDb = -8 - 24 * amount
      const ratio = 1.5 + 6.5 * amount
      return compress(segment, {
        thresholdDb,
        ratio,
        attackSeconds: 0.005,
        releaseSeconds: 0.12,
        // Bring back about half of the level the compressor takes away.
        makeupDb: -thresholdDb * (1 - 1 / ratio) * 0.5,
        kneeDb: 6
      })
    }
  },
  {
    id: 'truncateSilence',
    params: [param('longest', 'fx.param.longest', 'seconds', 0.3, 3, 0.1, 0.8)],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) =>
      truncateSilence(segment, { thresholdDb: -45, minSilenceSeconds: v.longest!, keepSeconds: v.longest! })
  },
  {
    id: 'bass',
    params: [param('boost', 'fx.param.boost', 'db', 1, 15, 1, 6)],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => applyFilters(segment, [{ type: 'lowshelf', frequency: 150, gainDb: v.boost! }])
  },
  {
    id: 'treble',
    params: [param('boost', 'fx.param.boost', 'db', 1, 15, 1, 5)],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => applyFilters(segment, [{ type: 'highshelf', frequency: 4000, gainDb: v.boost! }])
  },
  {
    id: 'telephone',
    params: [],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment) =>
      applyFilters(segment, [
        { type: 'highpass', frequency: 400 },
        { type: 'highpass', frequency: 400 },
        { type: 'lowpass', frequency: 3000 },
        { type: 'lowpass', frequency: 3000 },
        { type: 'peaking', frequency: 1500, q: 1, gainDb: 6 }
      ])
  },
  {
    id: 'echo',
    params: [
      param('delay', 'fx.param.delay', 'seconds', 0.05, 1, 0.05, 0.3),
      param('repeats', 'fx.param.repeats', 'percent', 0, 90, 5, 40)
    ],
    presets: [
      { label: 'fx.preset.slapback', values: { delay: 0.1, repeats: 10 } },
      { label: 'fx.preset.medium', values: { delay: 0.3, repeats: 40 } },
      { label: 'fx.preset.canyon', values: { delay: 0.6, repeats: 60 } }
    ],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: (v) => {
      const feedback = v.repeats! / 100
      // Long enough for the repeats to fall below -60 dB.
      const repeats = feedback > 0 ? Math.ceil(Math.log(0.001) / Math.log(feedback)) : 1
      return Math.min(12, v.delay! * Math.max(1, repeats))
    },
    process: (segment, v) => echo(segment, { delaySeconds: v.delay!, feedback: v.repeats! / 100, mix: 0.5 })
  },
  {
    id: 'reverb',
    params: [
      param('room', 'fx.param.room', 'percent', 0, 100, 5, 60),
      param('amount', 'fx.param.amount', 'percent', 0, 100, 5, 35)
    ],
    presets: [
      { label: 'fx.preset.smallRoom', values: { room: 30, amount: 25 } },
      { label: 'fx.preset.hall', values: { room: 70, amount: 35 } },
      { label: 'fx.preset.cathedral', values: { room: 95, amount: 45 } }
    ],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: (v) => 0.5 + 4.5 * (v.room! / 100),
    process: (segment, v) => reverb(segment, { roomSize: v.room! / 100, damping: 0.5, mix: v.amount! / 100 })
  },
  {
    id: 'speed',
    params: [param('speed', 'fx.param.speed', 'percent', 50, 200, 5, 125)],
    presets: [
      { label: 'fx.preset.deep', values: { speed: 75 } },
      { label: 'fx.preset.chipmunk', values: { speed: 160 } }
    ],
    defaultRange: 'all',
    needsSound: false,
    tailSeconds: noTail,
    process: (segment, v) => changeSpeed(segment, v.speed! / 100)
  },
  {
    id: 'robot',
    params: [param('tone', 'fx.param.tone', 'hz', 20, 120, 5, 50)],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => ringModulate(segment, { frequency: v.tone!, mix: 0.85 })
  },
  {
    id: 'tremolo',
    params: [
      param('rate', 'fx.param.rate', 'hz', 1, 15, 0.5, 5),
      param('depth', 'fx.param.depth', 'percent', 0, 100, 5, 60)
    ],
    presets: [],
    defaultRange: 'all',
    needsSound: true,
    tailSeconds: noTail,
    process: (segment, v) => tremolo(segment, { rate: v.rate!, depth: v.depth! / 100 })
  },
  {
    id: 'reverse',
    params: [],
    presets: [],
    defaultRange: 'all',
    needsSound: false,
    tailSeconds: noTail,
    process: (segment) => reverse(segment)
  }
]

const byId = new Map(definitions.map((definition) => [definition.id, definition]))

export function effectDefinition(id: EffectId): EffectDefinition {
  const definition = byId.get(id)
  if (!definition) throw new Error(`Unknown effect ${id}`)
  return definition
}

export function defaultValues(definition: EffectDefinition): EffectValues {
  return Object.fromEntries(definition.params.map((p) => [p.id, p.default]))
}
