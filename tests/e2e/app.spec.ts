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

function toneWav(seconds: number, sampleRate: number, channels: number): ArrayBuffer {
  const frames = Math.round(seconds * sampleRate)
  const data = Array.from({ length: channels }, (_, c) =>
    Float32Array.from({ length: frames }, (_, i) => (0.5 / (c + 1)) * Math.sin((2 * Math.PI * (440 + 220 * c) * i) / sampleRate))
  )
  return encodeWav(createAudioData(sampleRate, data), 'pcm16')
}

/** Makes the next open dialog pick `filePath`. */
async function nextOpen(filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, filePath)
}

/** Makes the next save dialog write to `filePath`. */
async function nextSave(filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
  }, filePath)
}

async function record(button: string, seconds: number): Promise<void> {
  await page.locator(button).click()
  await expect(page.locator('.record-panel')).toBeVisible()
  await expect(page.locator('.rec-clock')).toHaveText(new RegExp(`0:0[${seconds}-9]`), { timeout: 10_000 })
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.record-panel')).toBeHidden()
}

async function dragOnLane(index: number, fromRatio: number, toRatio: number): Promise<void> {
  const lane = page.getByTestId('lane').nth(index)
  const box = await lane.boundingBox()
  if (!box) throw new Error('lane not visible')
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width * fromRatio, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * ((fromRatio + toRatio) / 2), y, { steps: 5 })
  await page.mouse.move(box.x + box.width * toRatio, y, { steps: 5 })
  await page.mouse.up()
}

/** Reads the project length from the status bar ("48 kHz · 2 layers · 0:02.345"). */
function durationFromStatus(text: string): number {
  const match = /(\d+):(\d+)\.(\d+)$/.exec(text.trim())
  return match ? Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 1000 : Number.NaN
}

function arrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
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

test('records two layers, edits them and merges them into one WAV', async () => {
  await launch('en-US')
  await expect(page.getByText('Start a new sound project')).toBeVisible()

  await record('.toolbar .btn-record', 2)
  const format = page.getByTestId('status-format')
  await expect(format).toContainText('1 layer ·')
  const first = durationFromStatus(await format.innerText())
  expect(first).toBeGreaterThan(1.5)
  await expect(page.locator('.status-dirty')).toBeVisible()
  // After recording nothing is selected, so Delete cannot remove the whole take by accident.
  await expect(page.getByTestId('status-selection')).toHaveText('—')

  // A second take on its own layer, recorded while the first one plays.
  await record('.tracks-footer button:has-text("Record on a new layer")', 1)
  await expect(format).toContainText('2 layers ·')
  const rows = page.locator('.track-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toHaveClass(/is-active/)

  // Edit the first layer only.
  await rows.nth(0).locator('.track-header').click()
  await expect(rows.nth(0)).toHaveClass(/is-active/)
  await dragOnLane(0, 0.1, 0.3)
  await expect(page.getByTestId('status-selection')).not.toHaveText('—')
  await page.locator('.toolbar button[title^="Cut"]').click()
  await expect(page.locator('.toolbar button[title="Undo Cut"]')).toBeVisible()
  await page.locator('.toolbar button[title="Undo Cut"]').click()
  await expect(page.locator('.toolbar button[title="Redo Cut"]')).toBeVisible()

  // Volume and mute on the second layer.
  await rows.nth(1).locator('.track-volume-slider').fill('50')
  await expect(rows.nth(1).locator('.track-volume-value')).toHaveText('50%')
  await rows.nth(1).locator('.track-mute').click()
  await expect(rows.nth(1).locator('.track-mute')).toHaveAttribute('aria-pressed', 'true')

  // An effect from the effects panel, on the part that Undo selected again.
  await rows.nth(0).locator('.track-header').click()
  await page.getByRole('button', { name: /Open sound effects/ }).click()
  await page.locator('.effect-card[data-effect="echo"]').click()
  await expect(page.getByTestId('effects-target')).toContainText('of “Layer 1”')
  await page.locator('.effect-actions .btn-primary').click()
  await expect(page.locator('.toolbar button[title="Undo Echo"]')).toBeVisible()

  // Merge & export: the muted layer is left out.
  const mixPath = join(workDir, 'mix.wav')
  await nextSave(mixPath)
  await page.locator('.appbar button:has-text("Merge & Export")').click()
  await expect(page.getByTestId('export-summary')).toContainText('1 layer(s) will be merged')
  await expect(page.getByTestId('export-summary')).toContainText('Muted layers (1) are left out.')
  await page.getByText('16-bit PCM').click()
  await page.getByRole('button', { name: 'Choose location…' }).click()
  await expect(page.getByText('Exported mix.wav')).toBeVisible()
  const info = readWavInfo(arrayBuffer(await readFile(mixPath)))
  expect(info.bitsPerSample).toBe(16)

  // Save the project, start over, and open it again.
  const projectPath = join(workDir, 'song.suara')
  await nextSave(projectPath)
  await page.locator('.appbar button[title^="Save the project"]').click()
  await expect(page.getByText('Project saved: song.suara')).toBeVisible()
  await expect(page.locator('.status-dirty')).toBeHidden()
  expect((await readFile(projectPath)).subarray(0, 8).toString('latin1')).toBe('SUARAPRJ')
  expect(await page.title()).toBe('song.suara — Suara Studio')

  await page.locator('.appbar button[title^="New project"]').click()
  await expect(page.getByText('Start a new sound project')).toBeVisible()
  await nextOpen(projectPath)
  await page.locator('.appbar button[title^="Open"]').click()
  await expect(page.locator('.track-row')).toHaveCount(2)
  await expect(page.locator('.track-row').nth(1).locator('.track-mute')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.track-row').nth(1).locator('.track-volume-value')).toHaveText('50%')
})

test('opens a WAV file and adds another file as a layer', async () => {
  await launch('en-US')
  const tone = join(workDir, 'tone.wav')
  const second = join(workDir, 'second.wav')
  await writeFile(tone, Buffer.from(toneWav(1, 44100, 2)))
  await writeFile(second, Buffer.from(toneWav(2, 22050, 1)))

  await nextOpen(tone)
  await page.locator('.appbar button[title^="Open"]').click()
  const format = page.getByTestId('status-format')
  await expect(format).toHaveText('44.1 kHz · 1 layer · 0:01.000')
  await expect(page.locator('.empty-state')).toBeHidden()
  await expect(page.locator('.track-name').first()).toHaveValue('tone')

  // A second file joins as a new layer at the project's sample rate.
  await nextOpen(second)
  await page.locator('.tracks-footer button:has-text("Add audio file")').click()
  await expect(format).toHaveText('44.1 kHz · 2 layers · 0:02.000')
  await expect(page.locator('.track-name').nth(1)).toHaveValue('second')

  // Trimming one layer keeps the timeline in step with the other.
  await page.locator('.track-row').first().locator('.track-header').click()
  await dragOnLane(0, 0.05, 0.4)
  await page.locator('.toolbar button[title^="Trim"]').click()
  await expect(page.locator('.toolbar button[title="Undo Trim"]')).toBeVisible()
  await expect(format).toHaveText('44.1 kHz · 2 layers · 0:02.000')

  await page.locator('.toolbar button[title="Play (Space)"]').click()
  await expect(page.locator('.app')).toHaveClass(/is-playing/)
  await page.keyboard.press('Space')
  await expect(page.locator('.app')).not.toHaveClass(/is-playing/)

  // Deleting a layer can be undone from the notification.
  await page.locator('.track-row').nth(1).locator('button[title="Delete layer"]').click()
  await expect(format).toContainText('44.1 kHz · 1 layer ·')
  // Only the trimmed first layer is left.
  expect(durationFromStatus(await format.innerText())).toBeLessThan(1)
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).click()
  await expect(format).toHaveText('44.1 kHz · 2 layers · 0:02.000')
})

test('previews an effect before applying it', async () => {
  await launch('en-US')
  const tone = join(workDir, 'tone.wav')
  await writeFile(tone, Buffer.from(toneWav(3, 48000, 1)))
  await nextOpen(tone)
  await page.locator('.appbar button[title^="Open"]').click()
  await expect(page.locator('.track-row')).toHaveCount(1)

  await page.getByRole('button', { name: /Open sound effects/ }).click()
  await page.locator('.effect-card[data-effect="reverb"]').click()
  await expect(page.getByTestId('effects-target')).toContainText('Applies to all of “tone”')
  await page.getByRole('button', { name: 'Cathedral' }).click()
  await expect(page.locator('.effect-value').first()).toHaveText('95%')
  await page.getByRole('button', { name: 'Listen' }).click()
  await expect(page.locator('.effect-actions button').first()).toHaveAttribute('aria-label', 'Stop')
  await page.locator('.effect-actions button').first().click()
  await expect(page.locator('.effect-actions button').first()).toHaveAttribute('aria-label', 'Listen')
  // Previewing changes nothing.
  await expect(page.locator('.toolbar button[title^="Undo"]')).toBeDisabled()
})

test('shows the Indonesian interface for Indonesian systems', async () => {
  await launch('id')
  await expect(page.getByText('Mulai proyek suara baru')).toBeVisible()
  await expect(page.locator('.toolbar .btn-record')).toContainText('Rekam')
  await expect(page.locator('.appbar .btn-primary')).toContainText('Gabungkan & Ekspor')
})
