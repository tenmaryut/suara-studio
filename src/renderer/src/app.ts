import {
  AudioWaveform,
  ChevronDown,
  Circle,
  ClipboardPaste,
  Copy,
  Crop,
  FilePlus2,
  FolderOpen,
  Maximize2,
  Mic,
  Pause,
  Play,
  Redo2,
  Save,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide'
import type { Translate } from '../../shared/i18n'
import type { AppInfo, MenuCommand, OpenedFile, SuaraApi, TextEditAction } from '../../shared/ipc'
import { durationOf, frameCount } from './audio/audio-data'
import { convertAudio, decodeAudioFile } from './audio/convert'
import { Recorder, listMicrophones } from './audio/recorder'
import { type WavFormat, WAV_FORMATS, isWav, readWavInfo } from './audio/wav'
import { type ChangeKind, type EditResult, type EditorSnapshot, Editor, EditorError } from './editor/editor'
import { Dialogs } from './ui/dialogs'
import { button, h, icon, isEditableTarget, setButtonIcon, setButtonText, shortcut } from './ui/dom'
import { LevelMeter } from './ui/meter'
import { Toaster } from './ui/toast'
import { type TimeRange, WaveformView } from './ui/waveform'
import { baseName, formatClock, formatSampleRate, formatTime } from './util/format'

const TEXT_EDIT_COMMANDS: Partial<Record<MenuCommand, TextEditAction>> = {
  'edit.undo': 'undo',
  'edit.redo': 'redo',
  'edit.cut': 'cut',
  'edit.copy': 'copy',
  'edit.paste': 'paste',
  'edit.delete': 'delete',
  'edit.selectAll': 'selectAll'
}

const STORAGE_MICROPHONE = 'suara.microphone'
const STORAGE_WAV_FORMAT = 'suara.wavFormat'

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable; preferences then simply aren't remembered.
  }
}

/** Maps an opened WAV file to the format its data was stored in. */
function wavFormatOf(data: ArrayBuffer): WavFormat | null {
  if (!isWav(data)) return null
  try {
    const { formatTag, bitsPerSample } = readWavInfo(data)
    if (formatTag === 3) return 'float32'
    if (bitsPerSample === 24) return 'pcm24'
    if (bitsPerSample === 32) return 'float32'
    return 'pcm16'
  } catch {
    return null
  }
}

interface Controls {
  newFile: HTMLButtonElement
  open: HTMLButtonElement
  save: HTMLButtonElement
  record: HTMLButtonElement
  play: HTMLButtonElement
  stop: HTMLButtonElement
  undo: HTMLButtonElement
  redo: HTMLButtonElement
  cut: HTMLButtonElement
  copy: HTMLButtonElement
  paste: HTMLButtonElement
  remove: HTMLButtonElement
  trim: HTMLButtonElement
  effects: HTMLButtonElement
  zoomIn: HTMLButtonElement
  zoomOut: HTMLButtonElement
  zoomFit: HTMLButtonElement
  microphone: HTMLSelectElement
}

export class App {
  private readonly editor: Editor
  private readonly recorder = new Recorder()
  private readonly waveform: WaveformView
  private readonly dialogs: Dialogs
  private readonly toaster = new Toaster()
  private readonly meter: LevelMeter
  private readonly controls: Controls
  private readonly effectsMenu: HTMLElement
  private readonly recordPanel: HTMLElement
  private readonly recordStatus: HTMLElement
  private readonly recordClock: HTMLElement
  private readonly recordHint: HTMLElement
  private readonly recordPause: HTMLButtonElement
  private readonly emptyState: HTMLElement
  private readonly dropOverlay: HTMLElement
  private readonly busyOverlay: HTMLElement
  private readonly busyText: HTMLElement
  private readonly status: {
    position: HTMLElement
    selection: HTMLElement
    dirty: HTMLElement
    format: HTMLElement
  }
  private wavFormat: WavFormat
  private loadedRevision = -1
  private viewQueue: Promise<void> = Promise.resolve()
  private clockHandle = 0
  private busy = false
  private playing = false

  constructor(
    private readonly root: HTMLElement,
    private readonly api: SuaraApi,
    private readonly info: AppInfo,
    private readonly t: Translate
  ) {
    const stored = readStorage(STORAGE_WAV_FORMAT) as WavFormat | null
    this.wavFormat = stored && WAV_FORMATS.includes(stored) ? stored : 'pcm16'
    this.editor = new Editor({ convert: convertAudio })
    this.dialogs = new Dialogs(root, t)
    this.meter = new LevelMeter(t('rec.clip'))

    const key = (keys: string): string => shortcut(keys, info.platform)
    const tip = (label: string, keys?: string): string => (keys ? `${label} (${key(keys)})` : label)

    this.controls = {
      newFile: button({ icon: FilePlus2, title: tip(t('toolbar.new'), 'Mod+N'), onClick: () => this.run('file.new') }),
      open: button({ icon: FolderOpen, title: tip(t('toolbar.open'), 'Mod+O'), onClick: () => this.run('file.open') }),
      save: button({ icon: Save, title: tip(t('toolbar.save'), 'Mod+S'), onClick: () => this.run('file.save') }),
      record: button({
        icon: Circle,
        label: t('toolbar.record'),
        title: tip(t('toolbar.record'), 'R'),
        className: 'btn-record',
        onClick: () => this.run('transport.record')
      }),
      play: button({ icon: Play, title: tip(t('toolbar.play'), 'Space'), onClick: () => this.run('transport.playPause') }),
      stop: button({ icon: Square, title: tip(t('toolbar.stop'), 'Esc'), onClick: () => this.run('transport.stop') }),
      undo: button({ icon: Undo2, title: tip(t('toolbar.undo'), 'Mod+Z'), onClick: () => this.run('edit.undo') }),
      redo: button({ icon: Redo2, title: tip(t('toolbar.redo'), 'Mod+Shift+Z'), onClick: () => this.run('edit.redo') }),
      cut: button({ icon: Scissors, title: tip(t('menu.cut'), 'Mod+X'), onClick: () => this.run('edit.cut') }),
      copy: button({ icon: Copy, title: tip(t('menu.copy'), 'Mod+C'), onClick: () => this.run('edit.copy') }),
      paste: button({ icon: ClipboardPaste, title: tip(t('menu.paste'), 'Mod+V'), onClick: () => this.run('edit.paste') }),
      remove: button({ icon: Trash2, title: tip(t('menu.delete'), 'Del'), onClick: () => this.run('edit.delete') }),
      trim: button({ icon: Crop, title: tip(t('menu.trim'), 'Mod+T'), onClick: () => this.run('edit.trim') }),
      effects: button({
        icon: Sparkles,
        label: t('toolbar.effects'),
        title: t('toolbar.effects'),
        className: 'btn-menu',
        onClick: () => this.toggleEffectsMenu()
      }),
      zoomOut: button({ icon: ZoomOut, title: tip(t('menu.zoomOut'), 'Mod+-'), onClick: () => this.run('view.zoomOut') }),
      zoomIn: button({ icon: ZoomIn, title: tip(t('menu.zoomIn'), 'Mod+='), onClick: () => this.run('view.zoomIn') }),
      zoomFit: button({ icon: Maximize2, title: tip(t('menu.zoomFit'), 'Mod+0'), onClick: () => this.run('view.zoomFit') }),
      microphone: h('select', { class: 'select', 'aria-label': t('toolbar.microphone'), title: t('toolbar.microphone') })
    }
    this.controls.effects.append(icon(ChevronDown, 14))
    this.controls.effects.setAttribute('aria-haspopup', 'menu')
    this.controls.effects.setAttribute('aria-expanded', 'false')
    this.controls.microphone.addEventListener('change', () =>
      writeStorage(STORAGE_MICROPHONE, this.controls.microphone.value)
    )

    const effectItem = (label: string, command: MenuCommand): HTMLButtonElement => {
      const item = h('button', { type: 'button', class: 'menu-item', role: 'menuitem' }, label)
      item.addEventListener('click', () => {
        this.closeEffectsMenu()
        this.run(command)
      })
      return item
    }
    this.effectsMenu = h(
      'div',
      { class: 'menu', role: 'menu', hidden: true },
      effectItem(t('menu.fadeIn'), 'effect.fadeIn'),
      effectItem(t('menu.fadeOut'), 'effect.fadeOut'),
      effectItem(t('menu.normalize'), 'effect.normalize'),
      effectItem(t('menu.amplify'), 'effect.amplify'),
      effectItem(t('menu.silence'), 'effect.silence'),
      effectItem(t('menu.reverse'), 'effect.reverse')
    )

    const c = this.controls
    const group = (...children: Node[]): HTMLElement => h('div', { class: 'toolbar-group' }, ...children)
    const toolbar = h(
      'header',
      { class: 'toolbar', role: 'toolbar', 'aria-label': t('app.name') },
      group(c.newFile, c.open, c.save),
      group(c.record, c.play, c.stop),
      group(c.undo, c.redo),
      group(c.cut, c.copy, c.paste, c.remove, c.trim),
      h('div', { class: 'toolbar-group menu-anchor' }, c.effects, this.effectsMenu),
      group(c.zoomOut, c.zoomIn, c.zoomFit),
      h('div', { class: 'toolbar-spacer' }),
      h('label', { class: 'toolbar-group mic-picker' }, icon(Mic, 16), c.microphone)
    )

    this.recordStatus = h('span', { class: 'rec-status' }, t('rec.recording'))
    this.recordClock = h('span', { class: 'rec-clock' }, '0:00')
    this.recordHint = h('span', { class: 'rec-hint' })
    this.recordPause = button({ icon: Pause, label: t('rec.pause'), title: t('rec.pause'), onClick: () => this.togglePauseRecording() })
    this.recordPanel = h(
      'section',
      { class: 'record-panel', hidden: true, 'aria-live': 'polite' },
      h('span', { class: 'rec-dot', 'aria-hidden': 'true' }),
      this.recordStatus,
      this.recordClock,
      this.meter.element,
      this.recordHint,
      h(
        'div',
        { class: 'record-actions' },
        this.recordPause,
        button({ icon: Square, label: t('rec.stop'), title: t('rec.stop'), className: 'btn-primary', onClick: () => void this.finishRecording() }),
        button({ icon: Trash2, label: t('rec.cancel'), title: t('rec.cancel'), onClick: () => void this.discardRecording() })
      )
    )

    const waveformHost = h('div', { class: 'waveform', 'data-testid': 'waveform' })
    const emptyRecord = button({ icon: Circle, label: t('toolbar.record'), title: t('toolbar.record'), className: 'btn-record btn-large', onClick: () => this.run('transport.record') })
    const emptyOpen = button({ icon: FolderOpen, label: t('toolbar.open'), title: t('toolbar.open'), className: 'btn-large', onClick: () => this.run('file.open') })
    this.emptyState = h(
      'div',
      { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, icon(AudioWaveform, 44)),
      h('h1', { class: 'empty-title' }, t('empty.title')),
      h('div', { class: 'empty-actions' }, emptyRecord, emptyOpen),
      h('p', { class: 'empty-hint' }, t('empty.hint')),
      h('p', { class: 'empty-formats' }, t('empty.formats'))
    )
    this.dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, h('span', {}, t('drop.title')))
    this.busyText = h('span', {})
    this.busyOverlay = h('div', { class: 'busy-overlay', hidden: true }, h('div', { class: 'spinner' }), this.busyText)

    this.status = {
      position: h('span', { class: 'status-value', 'data-testid': 'status-position' }),
      selection: h('span', { class: 'status-value', 'data-testid': 'status-selection' }),
      dirty: h('span', { class: 'status-dirty', hidden: true }, t('status.unsaved')),
      format: h('span', { class: 'status-value', 'data-testid': 'status-format' })
    }
    const statusbar = h(
      'footer',
      { class: 'statusbar' },
      h('span', { class: 'status-item' }, h('span', { class: 'status-label' }, t('status.position')), this.status.position),
      h('span', { class: 'status-item' }, h('span', { class: 'status-label' }, t('status.selection')), this.status.selection),
      h('span', { class: 'toolbar-spacer' }),
      this.status.dirty,
      this.status.format
    )

    const stage = h('main', { class: 'stage' }, waveformHost, this.emptyState, this.dropOverlay, this.busyOverlay)
    root.replaceChildren(toolbar, this.recordPanel, stage, statusbar, this.toaster.element)

    this.waveform = new WaveformView(waveformHost, {
      onSelection: (range) => this.handleWaveformSelection(range),
      onCursor: (time) => this.editor.setCursor(this.toFrames(time)),
      onTime: (time) => this.handlePlaybackTime(time),
      onPlayingChange: (playing) => this.handlePlayingChange(playing)
    })

    this.recorder.onLevel = (peaks) => this.meter.update(peaks)
    this.recorder.onDeviceLost = () => {
      void this.finishRecording()
      this.notify(this.t('toast.micBusy'), 'error')
    }
    this.editor.onChange((changes) => this.render(changes))
    api.onMenuCommand((command) => this.run(command))
    api.onUpdateAvailable((update) =>
      this.toaster.show(this.t('toast.updateAvailable', { version: update.latestVersion }), {
        kind: 'info',
        timeout: 0,
        dismissLabel: this.t('toast.dismiss'),
        action: { label: this.t('toast.viewRelease'), run: () => void this.api.openReleasePage(update.url) }
      })
    )
    window.addEventListener('keydown', (event) => this.handleKeydown(event))
    document.addEventListener('pointerdown', (event) => {
      if (!this.effectsMenu.hidden && !(event.target as Element).closest('.menu-anchor')) this.closeEffectsMenu()
    })
    this.installDropTarget()
    navigator.mediaDevices?.addEventListener('devicechange', () => void this.refreshMicrophones())
    void this.refreshMicrophones()
    this.render(new Set<ChangeKind>(['audio', 'file', 'history', 'selection', 'cursor']))
  }

  // ---- Commands -------------------------------------------------------------------------

  /** Entry point for menu items, toolbar buttons and shortcuts. */
  run(command: MenuCommand): void {
    const textAction = TEXT_EDIT_COMMANDS[command]
    if (textAction && isEditableTarget(document.activeElement)) {
      this.api.editText(textAction)
      return
    }
    if (this.dialogs.isOpen || this.busy) return
    if (this.isRecording() && command !== 'transport.record') return
    void this.execute(command)
  }

  private async execute(command: MenuCommand): Promise<void> {
    switch (command) {
      case 'file.new':
        if (await this.confirmDiscard()) this.editor.newDocument()
        return
      case 'file.open':
        return this.openFromDialog()
      case 'file.save':
        await this.save(false)
        return
      case 'file.saveAs':
        await this.save(true)
        return
      case 'file.saveAndClose':
        if (await this.save(false)) this.api.confirmClose()
        return
      case 'edit.undo':
        this.stopPlayback()
        this.editor.undo()
        return
      case 'edit.redo':
        this.stopPlayback()
        this.editor.redo()
        return
      case 'edit.cut':
        return this.edit(() => this.editor.cut())
      case 'edit.copy':
        return this.edit(() => this.editor.copy(), false)
      case 'edit.paste':
        return this.edit(() => this.editor.paste())
      case 'edit.delete':
        return this.edit(() => this.editor.deleteSelection())
      case 'edit.selectAll':
        this.editor.selectAll()
        return
      case 'edit.trim':
        return this.edit(() => this.editor.trimToSelection())
      case 'effect.fadeIn':
        return this.edit(() => this.editor.fadeIn())
      case 'effect.fadeOut':
        return this.edit(() => this.editor.fadeOut())
      case 'effect.silence':
        return this.edit(() => this.editor.silence())
      case 'effect.reverse':
        return this.edit(() => this.editor.reverse())
      case 'effect.normalize': {
        if (!this.editor.hasAudio) return
        const target = await this.dialogs.promptNumber({
          title: this.t('dialog.normalize.title'),
          label: this.t('dialog.normalize.label'),
          help: this.t('dialog.normalize.help'),
          value: -1,
          min: -60,
          max: 0,
          step: 0.1
        })
        if (target !== null) await this.edit(() => this.editor.normalize(target))
        return
      }
      case 'effect.amplify': {
        if (!this.editor.hasAudio) return
        const gain = await this.dialogs.promptNumber({
          title: this.t('dialog.amplify.title'),
          label: this.t('dialog.amplify.label'),
          help: this.t('dialog.amplify.help'),
          value: 3,
          min: -48,
          max: 48,
          step: 0.5
        })
        if (gain !== null) await this.edit(() => this.editor.amplify(gain))
        return
      }
      case 'transport.playPause':
        return this.togglePlay()
      case 'transport.stop':
        this.stopPlayback()
        return
      case 'transport.record':
        return this.toggleRecord()
      case 'view.zoomIn':
        this.waveform.zoomIn()
        return
      case 'view.zoomOut':
        this.waveform.zoomOut()
        return
      case 'view.zoomFit':
        this.waveform.zoomToFit()
        return
    }
  }

  private async edit(action: () => EditResult | void | Promise<EditResult | void>, stopsPlayback = true): Promise<void> {
    if (stopsPlayback) this.stopPlayback()
    try {
      const result = await action()
      if (result?.clipped) this.notify(this.t('toast.clipWarning'), 'warning')
    } catch (error) {
      this.handleError(error)
    }
  }

  private handleError(error: unknown): void {
    if (error instanceof EditorError) {
      const message = {
        'no-audio': null,
        'no-selection': this.t('toast.selectFirst'),
        'empty-clipboard': this.t('toast.clipboardEmpty'),
        silent: this.t('toast.silentAudio')
      }[error.code]
      if (message) this.notify(message, 'info')
      return
    }
    console.error(error)
    this.notify(error instanceof Error ? error.message : String(error), 'error')
  }

  // ---- Files ----------------------------------------------------------------------------

  private documentName(): string {
    return this.editor.snapshot().fileName ?? this.t('dialog.untitled')
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.editor.isDirty() || !this.editor.hasAudio) return true
    const choice = await this.api.confirmDiscardChanges(this.documentName())
    if (choice === 'cancel') return false
    if (choice === 'save') return this.save(false)
    return true
  }

  private async openFromDialog(): Promise<void> {
    if (!(await this.confirmDiscard())) return
    const file = await this.api.openAudioFile().catch((error: unknown) => {
      this.handleError(error)
      return null
    })
    if (file) await this.openFile(file)
  }

  private async openFile(file: OpenedFile): Promise<void> {
    this.stopPlayback()
    this.setBusy(this.t('loading.opening', { name: file.name }))
    try {
      const audio = await decodeAudioFile(file.data)
      if (frameCount(audio) === 0) throw new Error('empty')
      this.editor.load(audio, file.name, file.path)
      const format = wavFormatOf(file.data)
      if (format) this.wavFormat = format
    } catch (error) {
      console.error(error)
      this.notify(this.t('toast.openFailed', { name: file.name }), 'error')
    } finally {
      this.setBusy(null)
    }
  }

  /** Saves as WAV. Returns true when the file was written. */
  private async save(saveAs: boolean): Promise<boolean> {
    if (!this.editor.hasAudio) return false
    this.stopPlayback()
    const snapshot = this.editor.snapshot()
    const overwritePath =
      !saveAs && snapshot.filePath?.toLowerCase().endsWith('.wav') ? snapshot.filePath : undefined
    let format = this.wavFormat
    if (!overwritePath) {
      const chosen = await this.dialogs.chooseWavFormat(this.wavFormat)
      if (!chosen) return false
      format = chosen
    }
    this.setBusy(this.t('loading.saving'))
    try {
      const data = this.editor.exportWav(format)
      const saved = await this.api.saveAudioFile({
        data,
        suggestedName: `${baseName(this.documentName())}.wav`,
        path: overwritePath
      })
      if (!saved) return false
      this.wavFormat = format
      writeStorage(STORAGE_WAV_FORMAT, format)
      this.editor.markSaved(saved.name, saved.path)
      this.notify(this.t('toast.saved', { name: saved.name }), 'success')
      return true
    } catch (error) {
      this.notify(
        this.t('toast.saveFailed', { error: error instanceof Error ? error.message : String(error) }),
        'error'
      )
      return false
    } finally {
      this.setBusy(null)
    }
  }

  private installDropTarget(): void {
    const hasFiles = (event: DragEvent): boolean => event.dataTransfer?.types.includes('Files') ?? false
    window.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = this.isRecording() ? 'none' : 'copy'
      this.dropOverlay.hidden = this.isRecording()
    })
    window.addEventListener('dragleave', (event) => {
      if (event.relatedTarget === null) this.dropOverlay.hidden = true
    })
    window.addEventListener('drop', (event) => {
      event.preventDefault()
      this.dropOverlay.hidden = true
      const file = event.dataTransfer?.files[0]
      if (!file || this.isRecording() || this.busy || this.dialogs.isOpen) return
      void (async () => {
        if (!(await this.confirmDiscard())) return
        try {
          await this.openFile(await this.api.openDroppedFile(file))
        } catch {
          this.notify(this.t('toast.openFailed', { name: file.name }), 'error')
        }
      })()
    })
  }

  // ---- Playback -------------------------------------------------------------------------

  private togglePlay(): void {
    const snapshot = this.editor.snapshot()
    if (!snapshot.audio || frameCount(snapshot.audio) === 0) return
    if (this.waveform.isPlaying) {
      this.editor.setCursor(this.toFrames(this.waveform.pause()))
      return
    }
    const rate = snapshot.audio.sampleRate
    if (snapshot.selection) {
      this.waveform.play(snapshot.selection.start / rate, snapshot.selection.end / rate)
    } else {
      const atEnd = snapshot.cursor >= frameCount(snapshot.audio) - 1
      this.waveform.play(atEnd ? 0 : snapshot.cursor / rate)
    }
  }

  private stopPlayback(): void {
    if (this.waveform.isPlaying) this.waveform.stop()
  }

  private handlePlayingChange(playing: boolean): void {
    this.playing = playing
    setButtonIcon(this.controls.play, playing ? Pause : Play)
    setButtonText(this.controls.play, playing ? this.t('toolbar.pause') : this.t('toolbar.play'))
    this.root.classList.toggle('is-playing', playing)
    if (!playing) this.updateStatus(this.editor.snapshot())
  }

  private handlePlaybackTime(time: number): void {
    if (this.playing) this.status.position.textContent = formatTime(time)
  }

  // ---- Recording ------------------------------------------------------------------------

  private isRecording(): boolean {
    return this.recorder.state !== 'idle'
  }

  private async toggleRecord(): Promise<void> {
    if (this.recorder.state === 'recording' || this.recorder.state === 'paused') {
      return this.finishRecording()
    }
    if (this.recorder.state === 'idle') return this.startRecording()
  }

  private async startRecording(): Promise<void> {
    this.stopPlayback()
    const access = await this.api.requestMicrophoneAccess()
    if (access === 'denied' || access === 'restricted') {
      this.notify(this.t('toast.micDenied'), 'error')
      return
    }
    this.recordHint.textContent = this.recordingHint()
    this.recordStatus.textContent = this.t('rec.recording')
    this.recordPanel.classList.remove('is-paused')
    setButtonIcon(this.recordPause, Pause)
    setButtonText(this.recordPause, this.t('rec.pause'), this.t('rec.pause'))
    this.meter.reset()
    this.recordPanel.hidden = false
    this.root.classList.add('is-recording')
    try {
      await this.recorder.start(this.controls.microphone.value || undefined)
    } catch (error) {
      this.recordPanel.hidden = true
      this.root.classList.remove('is-recording')
      this.notify(this.microphoneErrorMessage(error), 'error')
      this.updateControls(this.editor.snapshot())
      return
    }
    this.waveform.setInteractive(false)
    this.startClock()
    this.updateControls(this.editor.snapshot())
    this.syncDocumentState(this.editor.snapshot())
    void this.refreshMicrophones()
  }

  private async finishRecording(): Promise<void> {
    if (this.recorder.state !== 'recording' && this.recorder.state !== 'paused') return
    this.stopClock()
    const recording = await this.recorder.stop()
    this.endRecordingUi()
    if (recording) await this.edit(() => this.editor.insertRecording(recording))
  }

  private async discardRecording(): Promise<void> {
    this.stopClock()
    await this.recorder.cancel()
    this.endRecordingUi()
  }

  private endRecordingUi(): void {
    this.recordPanel.hidden = true
    this.root.classList.remove('is-recording')
    this.waveform.setInteractive(true)
    this.meter.reset()
    const snapshot = this.editor.snapshot()
    this.updateControls(snapshot)
    this.syncDocumentState(snapshot)
  }

  private togglePauseRecording(): void {
    if (this.recorder.state === 'recording') {
      this.recorder.pause()
      this.recordStatus.textContent = this.t('rec.paused')
      this.recordPanel.classList.add('is-paused')
      setButtonIcon(this.recordPause, Circle)
      setButtonText(this.recordPause, this.t('rec.resume'), this.t('rec.resume'))
    } else if (this.recorder.state === 'paused') {
      this.recorder.resume()
      this.recordStatus.textContent = this.t('rec.recording')
      this.recordPanel.classList.remove('is-paused')
      setButtonIcon(this.recordPause, Pause)
      setButtonText(this.recordPause, this.t('rec.pause'), this.t('rec.pause'))
    }
  }

  private recordingHint(): string {
    const snapshot = this.editor.snapshot()
    if (!snapshot.audio || frameCount(snapshot.audio) === 0) return this.t('rec.newHint')
    if (snapshot.selection) return this.t('rec.replaceHint')
    return this.t('rec.insertHint', { time: formatTime(snapshot.cursor / snapshot.audio.sampleRate) })
  }

  private startClock(): void {
    const tick = (): void => {
      this.recordClock.textContent = formatClock(this.recorder.elapsedSeconds)
      this.clockHandle = requestAnimationFrame(tick)
    }
    tick()
  }

  private stopClock(): void {
    cancelAnimationFrame(this.clockHandle)
  }

  private microphoneErrorMessage(error: unknown): string {
    const name = error instanceof Error || error instanceof DOMException ? error.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') return this.t('toast.micDenied')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return this.t('toast.micNotFound')
    if (name === 'NotReadableError' || name === 'AbortError') return this.t('toast.micBusy')
    return this.t('toast.micError', { error: error instanceof Error ? error.message : String(error) })
  }

  private async refreshMicrophones(): Promise<void> {
    let microphones: Awaited<ReturnType<typeof listMicrophones>>
    try {
      microphones = await listMicrophones()
    } catch {
      return
    }
    const select = this.controls.microphone
    const wanted = select.value || readStorage(STORAGE_MICROPHONE) || ''
    const options = [h('option', { value: '' }, this.t('toolbar.defaultMicrophone'))]
    microphones.forEach((mic, index) => {
      options.push(
        h('option', { value: mic.deviceId }, mic.label || this.t('toolbar.microphoneN', { n: index + 1 }))
      )
    })
    select.replaceChildren(...options)
    select.value = microphones.some((mic) => mic.deviceId === wanted) ? wanted : ''
  }

  // ---- Effects menu ---------------------------------------------------------------------

  private toggleEffectsMenu(): void {
    if (this.effectsMenu.hidden) this.openEffectsMenu()
    else this.closeEffectsMenu()
  }

  private openEffectsMenu(): void {
    if (this.controls.effects.disabled) return
    this.effectsMenu.hidden = false
    this.controls.effects.setAttribute('aria-expanded', 'true')
    this.effectsMenu.querySelector<HTMLButtonElement>('.menu-item')?.focus()
  }

  private closeEffectsMenu(): void {
    this.effectsMenu.hidden = true
    this.controls.effects.setAttribute('aria-expanded', 'false')
  }

  // ---- Keyboard -------------------------------------------------------------------------

  private handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || this.dialogs.isOpen) return
    if (event.key === 'Escape' && !this.effectsMenu.hidden) {
      event.preventDefault()
      this.closeEffectsMenu()
      this.controls.effects.focus()
      return
    }
    if (isEditableTarget(event.target)) return
    // Keyboard users activate a focused button with Space or Enter as usual.
    if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return
    const mod = event.ctrlKey || event.metaKey
    if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'y' && this.info.platform !== 'darwin') {
      event.preventDefault()
      this.run('edit.redo')
      return
    }
    if (mod || event.altKey) return
    switch (event.key) {
      case ' ':
        event.preventDefault()
        if (this.isRecording()) this.togglePauseRecording()
        else this.run('transport.playPause')
        return
      case 'r':
      case 'R':
        event.preventDefault()
        this.run('transport.record')
        return
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        this.run('edit.delete')
        return
      case 'Home':
        event.preventDefault()
        if (!this.isRecording()) this.editor.setCursor(0)
        return
      case 'End': {
        event.preventDefault()
        const audio = this.editor.getAudio()
        if (audio && !this.isRecording()) this.editor.setCursor(frameCount(audio))
        return
      }
      case 'Escape':
        if (this.waveform.isPlaying) this.stopPlayback()
        else this.editor.setSelection(null)
        return
    }
  }

  // ---- Rendering ------------------------------------------------------------------------

  private toFrames(seconds: number): number {
    const audio = this.editor.getAudio()
    return audio ? Math.round(seconds * audio.sampleRate) : 0
  }

  private handleWaveformSelection(range: TimeRange | null): void {
    this.editor.setSelection(range ? { start: this.toFrames(range.start), end: this.toFrames(range.end) } : null)
  }

  private render(changes: ReadonlySet<ChangeKind>): void {
    const snapshot = this.editor.snapshot()
    if (changes.has('audio') && snapshot.audioRevision !== this.loadedRevision) {
      this.loadedRevision = snapshot.audioRevision
      const audio = snapshot.audio
      this.viewQueue = this.viewQueue
        .then(() => this.waveform.load(audio))
        .catch((error: unknown) => this.handleError(error))
        .then(() => this.applyViewState())
    } else if (changes.has('selection') || changes.has('cursor')) {
      this.viewQueue = this.viewQueue.then(() => this.applyViewState())
    }
    this.updateControls(snapshot)
    this.updateStatus(snapshot)
    this.syncDocumentState(snapshot)
  }

  /** Pushes the editor's selection and cursor into the waveform. */
  private applyViewState(): void {
    const snapshot = this.editor.snapshot()
    const audio = snapshot.audio
    if (!audio || frameCount(audio) === 0) return
    const rate = audio.sampleRate
    this.waveform.setSelection(
      snapshot.selection ? { start: snapshot.selection.start / rate, end: snapshot.selection.end / rate } : null
    )
    this.waveform.setCursor(snapshot.cursor / rate)
  }

  private updateControls(snapshot: EditorSnapshot): void {
    const c = this.controls
    const hasAudio = snapshot.audio !== null && frameCount(snapshot.audio) > 0
    const recording = this.isRecording()
    const idle = !recording && !this.busy
    c.save.disabled = !hasAudio || !idle
    c.newFile.disabled = !idle
    c.open.disabled = !idle
    c.play.disabled = !hasAudio || !idle
    c.stop.disabled = !hasAudio || !idle
    c.undo.disabled = !snapshot.canUndo || !idle
    c.redo.disabled = !snapshot.canRedo || !idle
    c.cut.disabled = !snapshot.selection || !idle
    c.copy.disabled = !snapshot.selection || !idle
    c.remove.disabled = !snapshot.selection || !idle
    c.trim.disabled = !snapshot.selection || !idle
    c.paste.disabled = !snapshot.hasClipboard || !idle
    c.effects.disabled = !hasAudio || !idle
    c.zoomIn.disabled = !hasAudio
    c.zoomOut.disabled = !hasAudio
    c.zoomFit.disabled = !hasAudio
    c.microphone.disabled = recording
    if (c.effects.disabled) this.closeEffectsMenu()

    const undoName = snapshot.undoKind ? this.t(`edit.${snapshot.undoKind}`) : null
    const redoName = snapshot.redoKind ? this.t(`edit.${snapshot.redoKind}`) : null
    setButtonText(c.undo, undoName ? this.t('toolbar.undoAction', { action: undoName }) : this.t('toolbar.undo'))
    setButtonText(c.redo, redoName ? this.t('toolbar.redoAction', { action: redoName }) : this.t('toolbar.redo'))

    setButtonIcon(c.record, recording ? Square : Circle)
    setButtonText(
      c.record,
      recording ? this.t('toolbar.stopRecording') : this.t('toolbar.record'),
      recording ? this.t('rec.stop') : this.t('toolbar.record')
    )
    c.record.classList.toggle('is-active', recording)

    this.emptyState.hidden = hasAudio || recording
    this.root.classList.toggle('has-audio', hasAudio)
  }

  private updateStatus(snapshot: EditorSnapshot): void {
    const audio = snapshot.audio
    const hasAudio = audio !== null && frameCount(audio) > 0
    const rate = audio?.sampleRate ?? 48000
    if (!this.playing) this.status.position.textContent = formatTime(snapshot.cursor / rate)
    if (snapshot.selection) {
      const start = snapshot.selection.start / rate
      const end = snapshot.selection.end / rate
      this.status.selection.textContent = `${formatTime(start)} – ${formatTime(end)} (${formatTime(end - start)})`
    } else {
      this.status.selection.textContent = '—'
    }
    if (hasAudio && audio) {
      const channels =
        audio.channels.length === 1
          ? this.t('status.mono')
          : audio.channels.length === 2
            ? this.t('status.stereo')
            : this.t('status.channels', { n: audio.channels.length })
      this.status.format.textContent = `${formatSampleRate(audio.sampleRate)} · ${channels} · ${formatTime(durationOf(audio))}`
    } else {
      this.status.format.textContent = ''
    }
    this.status.dirty.hidden = !(snapshot.dirty && hasAudio)
  }

  private syncDocumentState(snapshot: EditorSnapshot): void {
    const hasAudio = snapshot.audio !== null && frameCount(snapshot.audio) > 0
    const dirty = snapshot.dirty && hasAudio
    const name = this.documentName()
    document.title = `${name}${dirty ? ' •' : ''} — ${this.t('app.name')}`
    const idle = !this.isRecording()
    this.api.setDocumentState({
      title: name,
      dirty,
      filePath: snapshot.filePath,
      hasAudio,
      hasSelection: snapshot.selection !== null,
      canUndo: snapshot.canUndo && idle,
      canRedo: snapshot.canRedo && idle,
      canPaste: snapshot.hasClipboard && idle,
      isRecording: !idle
    })
  }

  private setBusy(message: string | null): void {
    this.busy = message !== null
    this.busyOverlay.hidden = message === null
    this.busyText.textContent = message ?? ''
    this.updateControls(this.editor.snapshot())
  }

  private notify(message: string, kind: 'info' | 'success' | 'warning' | 'error'): void {
    this.toaster.show(message, { kind, dismissLabel: this.t('toast.dismiss') })
  }
}
