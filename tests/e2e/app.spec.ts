import { type ElectronApplication, type Page, _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAudioData } from '../../src/renderer/src/audio/audio-data'
import { encodeWav, readWavInfo } from '../../src/renderer/src/audio/wav'

let app: ElectronApplication
let page: Page
let workDir: string

async function launch(lang: string): Promise<void> {
  const args = [
    '.',
    `--lang=${lang}`,
    // Chromium's fake capture device plays a beep, so recording works without hardware.
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream'
  ]
  // Chromium's sandbox cannot start as root or under CI user-namespace restrictions.
  if (process.getuid?.() === 0 || process.env.CI) args.push('--no-sandbox')
  app = await electron.launch({
    args,
    env: { ...process.env, SUARA_DISABLE_UPDATE_CHECK: '1' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.toolbar')
}

function sineWav(seconds: number, sampleRate: number): ArrayBuffer {
  const frames = Math.round(seconds * sampleRate)
  const left = new Float32Array(frames)
  const right = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    left[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)
    right[i] = 0.25 * Math.sin((2 * Math.PI * 660 * i) / sampleRate)
  }
  return encodeWav(createAudioData(sampleRate, [left, right]), 'pcm16')
}

async function waveformReady(): Promise<void> {
  await expect(page.locator('[data-testid="waveform"][data-state="ready"]')).toBeVisible()
}

async function dragAcrossWaveform(fromRatio: number, toRatio: number): Promise<void> {
  await waveformReady()
  const box = await page.getByTestId('waveform').boundingBox()
  if (!box) throw new Error('waveform not visible')
  const y = box.y + box.height * 0.6
  await page.mouse.move(box.x + box.width * fromRatio, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * ((fromRatio + toRatio) / 2), y, { steps: 5 })
  await page.mouse.move(box.x + box.width * toRatio, y, { steps: 5 })
  await page.mouse.up()
}

/** Reads the document length from the status bar ("48 kHz · Mono · 0:02.345"); NaN when empty. */
function durationFromStatus(text: string): number {
  const match = /(\d+):(\d+)\.(\d+)$/.exec(text.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 : Number.NaN
}

test.beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'suara-e2e-'))
})

test.afterEach(async () => {
  // Destroying the windows skips the "save changes?" prompt that would block closing.
  await app?.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
  })
  await app?.close()
  await rm(workDir, { recursive: true, force: true })
})

test('records, edits and saves a WAV file', async () => {
  await launch('en-US')
  await expect(page.getByText('Start recording or open an audio file')).toBeVisible()

  await page.locator('.toolbar .btn-record').click()
  await expect(page.locator('.record-panel')).toBeVisible()
  await expect(page.locator('.rec-clock')).toHaveText(/0:0[2-9]/, { timeout: 10_000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.record-panel')).toBeHidden()

  const format = page.getByTestId('status-format')
  await expect(format).toContainText('kHz')
  const recorded = durationFromStatus(await format.innerText())
  expect(recorded).toBeGreaterThan(1.5)
  await expect(page.locator('.status-dirty')).toBeVisible()
  // After recording nothing is selected, so Delete cannot remove the whole take by accident.
  await expect(page.getByTestId('status-selection')).toHaveText('—')

  await dragAcrossWaveform(0.2, 0.5)
  await expect(page.getByTestId('status-selection')).not.toHaveText('—')

  await page.locator('.toolbar button[title^="Cut"]').click()
  await expect.poll(async () => durationFromStatus(await format.innerText())).toBeLessThan(recorded - 0.3)
  await waveformReady()
  await page.locator('.toolbar button[title^="Undo Cut"]').click()
  await expect.poll(async () => durationFromStatus(await format.innerText())).toBeCloseTo(recorded, 2)

  await waveformReady()
  await page.getByRole('button', { name: 'Effects' }).click()
  await page.getByRole('menuitem', { name: 'Normalize…' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Apply' }).click()
  await expect(page.locator('.toolbar button[title="Undo Normalize"]')).toBeVisible()

  const target = join(workDir, 'take.wav')
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, target)
  await page.locator('.toolbar button[title^="Save"]').click()
  await page.getByText('24-bit PCM').click()
  await page.getByRole('button', { name: 'Choose location…' }).click()
  await expect(page.getByText('Saved take.wav')).toBeVisible()
  await expect(page.locator('.status-dirty')).toBeHidden()

  const saved = await readFile(target)
  const info = readWavInfo(saved.buffer.slice(saved.byteOffset, saved.byteOffset + saved.byteLength))
  expect(info.bitsPerSample).toBe(24)
  expect(await page.title()).toBe('take.wav — Suara Studio')
})

test('opens a WAV file at its own sample rate', async () => {
  await launch('en-US')
  const source = join(workDir, 'tone.wav')
  await writeFile(source, Buffer.from(sineWav(1, 44100)))
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
  }, source)

  await page.locator('.toolbar button[title^="Open"]').click()
  await expect(page.getByTestId('status-format')).toHaveText('44.1 kHz · Stereo · 0:01.000')
  await expect(page.locator('.empty-state')).toBeHidden()

  await dragAcrossWaveform(0.1, 0.9)
  await page.locator('.toolbar button[title^="Trim"]').click()
  await expect
    .poll(async () => durationFromStatus(await page.getByTestId('status-format').innerText()))
    .toBeLessThan(0.95)

  await waveformReady()
  await page.locator('.toolbar button[title^="Play"]').click()
  await expect(page.locator('.app')).toHaveClass(/is-playing/)
  await page.keyboard.press('Space')
  await expect(page.locator('.app')).not.toHaveClass(/is-playing/)
})

test('shows the Indonesian interface for Indonesian systems', async () => {
  await launch('id')
  await expect(page.getByText('Mulai merekam atau buka file audio')).toBeVisible()
  await expect(page.locator('.toolbar .btn-record')).toContainText('Rekam')
})
