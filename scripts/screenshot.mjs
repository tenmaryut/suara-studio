// Captures README screenshots of the built app:
// `npm run build && xvfb-run -a node scripts/screenshot.mjs [outDir] [lang] [dark|light]`.
import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'docs'
const lang = process.argv[3] ?? 'en-US'
const theme = process.argv[4] ?? 'dark'
const indonesian = lang.startsWith('id')

const SECONDS = 6
const RATE = 48000

/** Encodes planar float channels as a 16-bit PCM WAV file. */
function wav(channels, sampleRate = RATE) {
  const frames = channels[0].length
  const blockAlign = channels.length * 2
  const dataBytes = frames * blockAlign
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels.length, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * blockAlign, 28)
  buffer.writeUInt16LE(blockAlign, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    channels.forEach((channel, c) => {
      const sample = Math.max(-1, Math.min(1, channel[i]))
      buffer.writeInt16LE(Math.round(sample * 32767), 44 + i * blockAlign + c * 2)
    })
  }
  return buffer
}

/** A short mono phrase: a few tone bursts with decaying envelopes, like spoken syllables. */
function voice() {
  const frames = SECONDS * RATE
  const data = new Float32Array(frames)
  const notes = [220, 277, 0, 330, 440, 330, 0, 392, 294, 247]
  const noteLength = frames / notes.length
  for (let i = 0; i < frames; i++) {
    const f = notes[Math.floor(i / noteLength)]
    if (!f) continue
    const t = (i % noteLength) / RATE
    const envelope = Math.exp(-t * 2.6) * Math.min(1, t * 60)
    data[i] = envelope * (0.6 * Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t))
  }
  return [data]
}

/** A steady hum for the fake microphone, so the level meter shows a normal level. */
function microphone() {
  const data = new Float32Array(SECONDS * RATE)
  for (let i = 0; i < data.length; i++) {
    const t = i / RATE
    data[i] = (0.22 + 0.08 * Math.sin(2 * Math.PI * 3 * t)) * Math.sin(2 * Math.PI * 196 * t)
  }
  return [data]
}

/** Background music in stereo: a soft chord pad with a kick drum on every beat. */
function music() {
  const frames = SECONDS * RATE
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  const chords = [
    [130.8, 164.8, 196],
    [110, 130.8, 164.8],
    [87.3, 110, 130.8],
    [98, 123.5, 146.8]
  ]
  const chordLength = frames / chords.length
  const beat = RATE / 2
  for (let i = 0; i < frames; i++) {
    const t = i / RATE
    const chord = chords[Math.floor(i / chordLength)]
    const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i % chordLength)) / chordLength)
    let pad = 0
    for (const f of chord) pad += Math.sin(2 * Math.PI * f * t)
    pad *= 0.06 + 0.08 * swell
    const kickTime = (i % beat) / RATE
    const kick = 0.55 * Math.exp(-kickTime * 18) * Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-kickTime * 30)) * kickTime)
    left[i] = pad + kick
    right[i] = pad * 0.8 + kick
  }
  return [left, right]
}

const workDir = await mkdtemp(join(tmpdir(), 'suara-shot-'))
const voicePath = join(workDir, indonesian ? 'Vokal.wav' : 'Voice.wav')
const musicPath = join(workDir, indonesian ? 'Musik.wav' : 'Music.wav')
const microphonePath = join(workDir, 'microphone.wav')
await writeFile(voicePath, wav(voice()))
await writeFile(musicPath, wav(music()))
await writeFile(microphonePath, wav(microphone()))

const args = [
  '.',
  `--lang=${lang}`,
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  `--use-file-for-fake-audio-capture=${microphonePath}`
]
if (process.getuid?.() === 0 || process.env.CI) args.push('--no-sandbox')
const app = await electron.launch({ args, env: { ...process.env, SUARA_DISABLE_UPDATE_CHECK: '1' } })

async function nextOpen(filePath) {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, filePath)
}

try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 720))
  await page.emulateMedia({ colorScheme: theme })
  await page.waitForSelector('.toolbar')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, `empty-${lang}-${theme}.png`) })

  // Two layers: a voice, and background music turned down to 60%.
  await nextOpen(voicePath)
  await page.locator('.appbar .toolbar-group button').nth(1).click()
  await page.locator('.track-row').first().waitFor()
  await nextOpen(musicPath)
  await page.locator('.tracks-footer button').nth(2).click()
  await page.locator('.track-row').nth(1).waitFor()
  const musicVolume = page.locator('.track-row').nth(1).locator('.track-volume-slider')
  await musicVolume.fill('60')
  await musicVolume.blur()

  // Select part of the voice.
  const box = await page.getByTestId('lane').first().boundingBox()
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.42, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.66, y, { steps: 8 })
  await page.mouse.up()
  await page.mouse.move(box.x + box.width * 0.85, y)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, `editor-${lang}-${theme}.png`) })

  await page.locator('.toolbar .btn-effects').click()
  await page.locator('.effect-card').first().waitFor()
  await page.mouse.move(box.x + box.width * 0.2, y)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, `effects-${lang}-${theme}.png`) })
  await page.locator('.effect-card[data-effect="reverb"]').click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, `effect-reverb-${lang}-${theme}.png`) })
  await page.locator('.toolbar .btn-effects').click()

  // Record a third layer while the other two play.
  await page.keyboard.press('Escape')
  await page.locator('.tracks-footer button.btn-record').click()
  await page.waitForSelector('.record-panel:not([hidden])')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: join(outDir, `recording-${lang}-${theme}.png`) })
  await page.locator('.record-actions button').nth(2).click()
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
  await app.close()
  await rm(workDir, { recursive: true, force: true })
}
