import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAudioData } from '../../src/renderer/src/audio/audio-data'
import { encodeWav } from '../../src/renderer/src/audio/wav'

// Smoke test for an installed build: SUARA_EXECUTABLE=/path/to/app npx playwright test packaged
const executablePath = process.env.SUARA_EXECUTABLE

test.skip(!executablePath, 'Set SUARA_EXECUTABLE to an installed Suara Studio to run this test')

test('the installed app starts, opens audio and records', async () => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string }
  const isLinux = process.platform === 'linux'
  const args = ['--lang=en-US']
  // The fake capture device needs no microphone and no permission prompt.
  if (isLinux) args.push('--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream')
  if (process.getuid?.() === 0) args.push('--no-sandbox')

  const workDir = await mkdtemp(join(tmpdir(), 'suara-packaged-'))
  const app = await electron.launch({
    executablePath,
    args,
    env: { ...process.env, SUARA_DISABLE_UPDATE_CHECK: '1' }
  })
  try {
    const page = await app.firstWindow()
    await expect(page.locator('.toolbar')).toBeVisible()
    expect(page.url()).toBe('app://suara-studio/index.html')
    const info = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, version: app.getVersion() }))
    expect(info).toEqual({ packaged: true, version: pkg.version })

    const frames = 22050
    const tone = Float32Array.from({ length: frames }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 22050))
    const source = join(workDir, 'tone.wav')
    await writeFile(source, Buffer.from(encodeWav(createAudioData(22050, [tone]), 'pcm16')))
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, source)
    await page.locator('.toolbar button[title^="Open"]').click()
    await expect(page.getByTestId('status-format')).toHaveText('22.05 kHz · Mono · 0:01.000')
    await expect(page.locator('[data-testid="waveform"][data-state="ready"]')).toBeVisible()

    if (isLinux) {
      await page.locator('.toolbar .btn-record').click()
      await expect(page.locator('.rec-clock')).toHaveText(/0:0[1-9]/, { timeout: 10_000 })
      await page.getByRole('button', { name: 'Done' }).click()
      await expect(page.locator('.toolbar button[title="Undo Recording"]')).toBeVisible()
    }
  } finally {
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await app.close()
    await rm(workDir, { recursive: true, force: true })
  }
})
