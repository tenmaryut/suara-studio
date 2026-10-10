// Captures README screenshots of the built app: `npm run build && xvfb-run node scripts/screenshot.mjs`.
import { _electron as electron } from '@playwright/test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const outDir = process.argv[2] ?? 'docs'
const lang = process.argv[3] ?? 'en-US'
const theme = process.argv[4] ?? 'dark'

/** A short stereo phrase: a few tone bursts with decaying envelopes. */
function demoWav(seconds = 6, sampleRate = 48000) {
  const frames = seconds * sampleRate
  const channels = [new Float32Array(frames), new Float32Array(frames)]
  const notes = [220, 277, 330, 440, 330, 392, 294, 247]
  const noteLength = frames / notes.length
  for (let i = 0; i < frames; i++) {
    const note = Math.floor(i / noteLength)
    const t = (i % noteLength) / sampleRate
    const envelope = Math.exp(-t * 2.2) * Math.min(1, t * 80)
    const f = notes[note]
    const value = envelope * (0.55 * Math.sin(2 * Math.PI * f * t) + 0.2 * Math.sin(4 * Math.PI * f * t))
    channels[0][i] = value
    channels[1][i] = value * (0.7 + 0.3 * Math.sin((2 * Math.PI * i) / frames))
  }
  const dataBytes = frames * 4
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(2, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 4, 28)
  buffer.writeUInt16LE(4, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < frames; i++) {
    buffer.writeInt16LE(Math.round(channels[0][i] * 32767), 44 + i * 4)
    buffer.writeInt16LE(Math.round(channels[1][i] * 32767), 46 + i * 4)
  }
  return buffer
}

const workDir = await mkdtemp(join(tmpdir(), 'suara-shot-'))
const source = join(workDir, 'demo.wav')
await writeFile(source, demoWav())

const args = ['.', `--lang=${lang}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
if (process.getuid?.() === 0 || process.env.CI) args.push('--no-sandbox')
const app = await electron.launch({ args, env: { ...process.env, SUARA_DISABLE_UPDATE_CHECK: '1' } })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1180, 640))
  await page.emulateMedia({ colorScheme: theme })
  await page.waitForSelector('.toolbar')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, `empty-${lang}-${theme}.png`) })

  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, source)
  await page.locator('.toolbar button').nth(1).click()
  await page.waitForSelector('[data-testid="waveform"][data-state="ready"]')
  const box = await page.getByTestId('waveform').boundingBox()
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * 0.38, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.62, y, { steps: 8 })
  await page.mouse.up()
  await page.mouse.move(box.x + box.width * 0.8, y)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(outDir, `editor-${lang}-${theme}.png`) })

  await page.locator('.toolbar .btn-record').click()
  await page.waitForSelector('.record-panel:not([hidden])')
  await page.waitForTimeout(1600)
  await page.screenshot({ path: join(outDir, `recording-${lang}-${theme}.png`) })
  await page.locator('.record-panel button').nth(2).click()
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
  await app.close()
  await rm(workDir, { recursive: true, force: true })
}
