/** The sound effects, grouped the way the effects panel and the Effects menu show them. */
export const EFFECT_CATEGORIES = ['volume', 'repair', 'tone', 'space', 'creative'] as const

export type EffectCategory = (typeof EFFECT_CATEGORIES)[number]

export const EFFECTS = [
  { id: 'volume', category: 'volume' },
  { id: 'normalize', category: 'volume' },
  { id: 'fadeIn', category: 'volume' },
  { id: 'fadeOut', category: 'volume' },
  { id: 'silence', category: 'volume' },
  { id: 'rumble', category: 'repair' },
  { id: 'gate', category: 'repair' },
  { id: 'compress', category: 'repair' },
  { id: 'truncateSilence', category: 'repair' },
  { id: 'bass', category: 'tone' },
  { id: 'treble', category: 'tone' },
  { id: 'telephone', category: 'tone' },
  { id: 'echo', category: 'space' },
  { id: 'reverb', category: 'space' },
  { id: 'speed', category: 'creative' },
  { id: 'robot', category: 'creative' },
  { id: 'tremolo', category: 'creative' },
  { id: 'reverse', category: 'creative' }
] as const satisfies readonly { id: string; category: EffectCategory }[]

export type EffectId = (typeof EFFECTS)[number]['id']

export function isEffectId(value: string): value is EffectId {
  return EFFECTS.some((effect) => effect.id === value)
}
