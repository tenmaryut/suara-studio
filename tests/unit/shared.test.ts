import { describe, expect, it } from 'vitest'
import { createTranslator, messages, resolveLocale } from '../../src/shared/i18n'
import { compareVersions, isNewerVersion } from '../../src/shared/version'
import {
  baseName,
  formatClock,
  formatDb,
  formatSampleRate,
  formatTime
} from '../../src/renderer/src/util/format'

describe('compareVersions', () => {
  it.each([
    ['1.0.0', '1.0.0', 0],
    ['v1.2.0', '1.10.0', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0-beta.1', '1.0.0', -1],
    ['1.0.0-beta.2', '1.0.0-beta.10', -1],
    ['1.0.0-rc.1', '1.0.0-beta.9', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1]
  ] as const)('compares %s with %s', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })

  it('rejects invalid versions', () => {
    expect(compareVersions('latest', '1.0.0')).toBeNull()
    expect(isNewerVersion('nope', '1.0.0')).toBe(false)
    expect(isNewerVersion('v0.2.0', '0.1.0')).toBe(true)
  })
})

describe('i18n', () => {
  it('has the same keys in every language', () => {
    expect(Object.keys(messages.id).sort()).toEqual(Object.keys(messages.en).sort())
    for (const [key, value] of Object.entries(messages.id)) {
      expect(value, key).not.toBe('')
    }
  })

  it('resolves locales from system tags', () => {
    expect(resolveLocale('id-ID')).toBe('id')
    expect(resolveLocale('in')).toBe('id')
    expect(resolveLocale('en-GB')).toBe('en')
    expect(resolveLocale('ja')).toBe('en')
    expect(resolveLocale(undefined)).toBe('en')
  })

  it('fills in parameters', () => {
    const t = createTranslator('id')
    expect(t('toast.saved', { name: 'take.wav' })).toBe('take.wav tersimpan')
    expect(t('dialog.invalidNumber', { min: -60 })).toBe('Masukkan angka antara -60 dan {max}.')
  })
})

describe('formatting', () => {
  it('formats positions', () => {
    expect(formatTime(0)).toBe('0:00.000')
    expect(formatTime(61.5)).toBe('1:01.500')
    expect(formatTime(3725.0004)).toBe('1:02:05.000')
    expect(formatTime(Number.NaN)).toBe('0:00.000')
  })

  it('formats the recording clock', () => {
    expect(formatClock(5.9)).toBe('0:05')
    expect(formatClock(3661)).toBe('1:01:01')
  })

  it('formats sample rates, decibels and names', () => {
    expect(formatSampleRate(48000)).toBe('48 kHz')
    expect(formatSampleRate(44100)).toBe('44.1 kHz')
    expect(formatSampleRate(22050)).toBe('22.05 kHz')
    expect(formatSampleRate(11025)).toBe('11.025 kHz')
    expect(formatDb(3)).toBe('+3.0 dB')
    expect(formatDb(-Infinity)).toBe('-∞ dB')
    expect(baseName('take 1.final.mp3')).toBe('take 1.final')
    expect(baseName('.hidden')).toBe('.hidden')
  })
})
