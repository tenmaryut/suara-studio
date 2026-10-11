import {
  AudioWaveform,
  Circle,
  CircleHelp,
  ClipboardPaste,
  Copy,
  Crop,
  FilePlus2,
  FolderOpen,
  Headphones,
  Layers,
  Maximize2,
  Merge,
  Mic,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Sparkles,
  Square,
  Trash2,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut
} from 'lucide'
import { type EffectId, isEffectId } from '../../shared/effects'
import type { Translate } from '../../shared/i18n'
import type { AppInfo, MenuCommand, OpenedFile, SuaraApi, TextEditAction } from '../../shared/ipc'
import { type AudioData, createAudioData, frameCount, sliceAudio } from './audio/audio-data'
import { convertAudio, decodeAudioFile } from './audio/convert'
import { peakLevel } from './audio/effects'
import { type PlaybackLayer, Player } from './audio/player'
import { Recorder, listMicrophones } from './audio/recorder'
import { type WavFormat, WAV_FORMATS, encodeWav } from './audio/wav'
import { type EffectDefinition, type EffectValues, effectDefinition } from './effects/catalog'
import { audibleLayers, mixLayers } from './project/mix'
import {
  type ChangeKind,
  type EditResult,
  type Layer,
  Project,
  ProjectError,
  type ProjectSnapshot,
  type Selection,
  type StepLabel
} from './project/project'
import { decodeProject, encodeProject, isProjectFile } from './project/project-file'
import { Dialogs } from './ui/dialogs'
import { button, h, icon, isEditableTarget, setButtonIcon, setButtonText, shortcut } from './ui/dom'
import { EffectsPanel } from './ui/effects-panel'
import { LevelMeter } from './ui/meter'
import { Toaster } from './ui/toast'
import { TracksView } from './ui/tracks'
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
const STORAGE_MONITOR = 'suara.monitor'
/** Effect previews play at most this many seconds. */
const PREVIEW_SECONDS = 10

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

/** Lets the browser paint (e.g. a busy overlay) before long synchronous work. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
}

function appendSilence(audio: AudioData, frames: number): AudioData {
  if (frames <= 0) return audio
  return createAudioData(
    audio.sampleRate,
    audio.channels.map((channel) => {
      const out = new Float32Array(channel.length + frames)
      out.set(channel)
      return out
    })
  )
}

interface Controls {
  newFile: HTMLButtonElement
  open: HTMLButtonElement
  save: HTMLButtonElement
  help: HTMLButtonElement
  exportAudio: HTMLButtonElement
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
  addLayer: HTMLButtonElement
  monitor: HTMLButtonElement
  zoomIn: HTMLButtonElement
  zoomOut: HTMLButtonElement
  zoomFit: HTMLButtonElement
  microphone: HTMLSelectElement
}

interface RecordingPlan {
  newLayer: boolean
  /** Timeline frame where a take for a new layer starts. */
  at: number
}

/** Where an effect will be applied. */
interface EffectTarget {
  layer: Layer
  range: Selection
}

export class App {
  private readonly project: Project
  private readonly recorder = new Recorder()
  private readonly player = new Player()
  private readonly tracks: TracksView
  private readonly effectsPanel: EffectsPanel
  private readonly dialogs: Dialogs
  private readonly toaster = new Toaster()
  private readonly meter: LevelMeter
  private readonly controls: Controls
  private readonly title: HTMLElement
  private readonly workspace: HTMLElement
  private readonly recordPanel: HTMLElement
  private readonly recordStatus: HTMLElement
  private readonly recordClock: HTMLElement
  private readonly recordHint: HTMLElement
  private readonly recordPause: HTMLButtonElement
  private readonly emptyState: HTMLElement
  private readonly dropOverlay: HTMLElement
  private readonly busyOverlay: HTMLElement
  private readonly busyText: HTMLElement
  private readonly hint: HTMLElement
  private readonly status: {
    position: HTMLElement
    selection: HTMLElement
    dirty: HTMLElement
    format: HTMLElement
  }
  private wavFormat: WavFormat
  private monitorEnabled: boolean
  private recordingPlan: RecordingPlan | null = null
  private playMode: 'timeline' | 'preview' | null = null
  private playOrigin = 0
  private playheadHandle = 0
  private clockHandle = 0
  private busy = false

  constructor(
    private readonly root: HTMLElement,
    private readonly api: SuaraApi,
    private readonly info: AppInfo,
    private readonly t: Translate
  ) {
    const stored = readStorage(STORAGE_WAV_FORMAT) as WavFormat | null
    this.wavFormat = stored && WAV_FORMATS.includes(stored) ? stored : 'pcm16'
    this.monitorEnabled = readStorage(STORAGE_MONITOR) !== 'false'
    this.project = new Project({ convert: convertAudio, layerName: (n) => t('layer.defaultName', { n }) })
    this.dialogs = new Dialogs(root, t)
    this.meter = new LevelMeter(t('rec.clip'))

    const key = (keys: string): string => shortcut(keys, info.platform)
    const tip = (label: string, keys?: string): string => (keys ? `${label} (${key(keys)})` : label)
    const run = (command: MenuCommand) => () => this.run(command)

    this.controls = {
      newFile: button({ icon: FilePlus2, title: tip(t('toolbar.new'), 'Mod+N'), onClick: run('file.new') }),
      open: button({ icon: FolderOpen, label: t('toolbar.open'), title: tip(t('toolbar.openHint'), 'Mod+O'), onClick: run('file.open') }),
      save: button({ icon: Save, label: t('toolbar.save'), title: tip(t('toolbar.saveHint'), 'Mod+S'), onClick: run('file.save') }),
      help: button({ icon: CircleHelp, label: t('toolbar.help'), title: tip(t('toolbar.help'), 'F1'), onClick: run('help.guide') }),
      exportAudio: button({
        icon: Merge,
        label: t('toolbar.export'),
        title: tip(t('toolbar.exportHint'), 'Mod+E'),
        className: 'btn-primary',
        onClick: run('file.export')
      }),
      record: button({
        icon: Circle,
        label: t('toolbar.record'),
        title: tip(t('toolbar.recordHint'), 'R'),
        className: 'btn-record',
        onClick: run('transport.record')
      }),
      play: button({ icon: Play, label: t('toolbar.play'), title: tip(t('toolbar.play'), 'Space'), onClick: run('transport.playPause') }),
      stop: button({ icon: Square, title: tip(t('toolbar.stop'), 'Esc'), onClick: run('transport.stop') }),
      undo: button({ icon: Undo2, title: tip(t('toolbar.undo'), 'Mod+Z'), onClick: run('edit.undo') }),
      redo: button({ icon: Redo2, title: tip(t('toolbar.redo'), 'Mod+Shift+Z'), onClick: run('edit.redo') }),
      cut: button({ icon: Scissors, label: t('menu.cut'), title: tip(t('menu.cut'), 'Mod+X'), className: 'btn-secondary-label', onClick: run('edit.cut') }),
      copy: button({ icon: Copy, label: t('menu.copy'), title: tip(t('menu.copy'), 'Mod+C'), className: 'btn-secondary-label', onClick: run('edit.copy') }),
      paste: button({ icon: ClipboardPaste, label: t('menu.paste'), title: tip(t('menu.paste'), 'Mod+V'), className: 'btn-secondary-label', onClick: run('edit.paste') }),
      remove: button({ icon: Trash2, label: t('menu.delete'), title: tip(t('menu.delete'), 'Del'), className: 'btn-secondary-label', onClick: run('edit.delete') }),
      trim: button({ icon: Crop, label: t('toolbar.trim'), title: tip(t('menu.trim'), 'Mod+T'), className: 'btn-secondary-label', onClick: run('edit.trim') }),
      effects: button({ icon: Sparkles, label: t('toolbar.effects'), title: tip(t('toolbar.effectsHint'), 'Mod+Shift+E'), className: 'btn-effects', onClick: () => this.toggleEffects() }),
      addLayer: button({ icon: Plus, label: t('toolbar.addLayer'), title: tip(t('menu.layerAdd'), 'Mod+Shift+N'), onClick: run('layer.add') }),
      monitor: button({ icon: Headphones, title: t('toolbar.monitor'), className: 'btn-toggle', onClick: () => this.toggleMonitor() }),
      zoomOut: button({ icon: ZoomOut, title: tip(t('menu.zoomOut'), 'Mod+-'), onClick: run('view.zoomOut') }),
      zoomIn: button({ icon: ZoomIn, title: tip(t('menu.zoomIn'), 'Mod+='), onClick: run('view.zoomIn') }),
      zoomFit: button({ icon: Maximize2, title: tip(t('menu.zoomFit'), 'Mod+0'), onClick: run('view.zoomFit') }),
      microphone: h('select', { class: 'select', 'aria-label': t('toolbar.microphone'), title: t('toolbar.microphone') })
    }
    this.controls.effects.setAttribute('aria-expanded', 'false')
    this.controls.monitor.setAttribute('aria-pressed', String(this.monitorEnabled))
    this.controls.microphone.addEventListener('change', () =>
      writeStorage(STORAGE_MICROPHONE, this.controls.microphone.value)
    )

    const c = this.controls
    const group = (...children: Node[]): HTMLElement => h('div', { class: 'toolbar-group' }, ...children)
    this.title = h('span', { class: 'appbar-title' })
    const appbar = h(
      'header',
      { class: 'appbar' },
      h('div', { class: 'appbar-brand' }, icon(AudioWaveform, 20), h('span', {}, t('app.name'))),
      group(c.newFile, c.open, c.save),
      this.title,
      h('div', { class: 'toolbar-spacer' }),
      c.help,
      c.exportAudio
    )
    const toolbar = h(
      'div',
      { class: 'toolbar', role: 'toolbar', 'aria-label': t('app.name') },
      group(c.record, c.play, c.stop),
      group(c.undo, c.redo),
      group(c.cut, c.copy, c.paste, c.remove, c.trim),
      group(c.effects, c.addLayer),
      h('div', { class: 'toolbar-spacer' }),
      h('label', { class: 'toolbar-group mic-picker' }, icon(Mic, 16), c.microphone, c.monitor)
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

    this.tracks = new TracksView(
      {
        onActivate: (id) => this.project.setActiveLayer(id),
        onSelection: (selection) => this.project.setSelection(selection),
        onCursor: (frame) => {
          this.stopPlayback(false)
          this.project.setCursor(frame)
        },
        onVolumeInput: (id, volume) => this.player.setGain(id, volume),
        onVolumeChange: (id, volume) => this.project.setLayerVolume(id, volume),
        onMute: (id, muted) => {
          this.project.setLayerMuted(id, muted)
          this.restartPlayback()
        },
        onSolo: (id, solo) => {
          this.project.setLayerSolo(id, solo)
          this.restartPlayback()
        },
        onRename: (id, name) => this.project.renameLayer(id, name),
        onDuplicate: (id) => this.duplicateLayer(id),
        onRemove: (id) => this.removeLayer(id)
      },
      t
    )
    this.tracks.corner.append(c.zoomOut, c.zoomIn, c.zoomFit)
    this.tracks.footer.append(
      button({ icon: Plus, label: t('tracks.addEmpty'), title: tip(t('menu.layerAdd'), 'Mod+Shift+N'), className: 'btn-outline', onClick: run('layer.add') }),
      button({ icon: Circle, label: t('tracks.recordNew'), title: tip(t('menu.layerRecord'), 'Mod+Shift+R'), className: 'btn-outline btn-record', onClick: run('layer.record') }),
      button({ icon: Upload, label: t('tracks.import'), title: tip(t('menu.import'), 'Mod+I'), className: 'btn-outline', onClick: run('file.import') })
    )

    this.effectsPanel = new EffectsPanel(
      {
        onSelect: () => this.updateEffectsTarget(),
        onPreview: (id, values) => void this.previewEffect(id, values),
        onStopPreview: () => this.stopPreview(),
        onApply: (id, values) => void this.applyEffect(id, values),
        onClose: () => this.closeEffects()
      },
      t,
      info.locale
    )

    const emptyRecord = button({ icon: Circle, label: t('empty.record'), title: tip(t('toolbar.record'), 'R'), className: 'btn-record btn-large', onClick: run('transport.record') })
    const emptyOpen = button({ icon: FolderOpen, label: t('empty.open'), title: tip(t('toolbar.openHint'), 'Mod+O'), className: 'btn-large', onClick: run('file.open') })
    this.emptyState = h(
      'div',
      { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, icon(Layers, 40)),
      h('h1', { class: 'empty-title' }, t('empty.title')),
      h('p', { class: 'empty-subtitle' }, t('empty.subtitle')),
      h('div', { class: 'empty-actions' }, emptyRecord, emptyOpen),
      h(
        'ol',
        { class: 'empty-steps' },
        h('li', {}, t('empty.step1')),
        h('li', {}, t('empty.step2')),
        h('li', {}, t('empty.step3'))
      ),
      h('p', { class: 'empty-hint' }, t('empty.hint')),
      h('p', { class: 'empty-formats' }, t('empty.formats'))
    )
    this.dropOverlay = h('div', { class: 'drop-overlay', hidden: true }, h('span', {}, t('drop.title')))
    this.busyText = h('span', {})
    this.busyOverlay = h('div', { class: 'busy-overlay', hidden: true }, h('div', { class: 'spinner' }), this.busyText)

    this.hint = h('div', { class: 'hintbar', 'data-testid': 'hint' })
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

    const stage = h('main', { class: 'stage' }, this.tracks.element, this.emptyState, this.dropOverlay, this.busyOverlay)
    this.workspace = h('div', { class: 'workspace' }, stage, this.effectsPanel.element)
    root.replaceChildren(appbar, toolbar, this.recordPanel, this.workspace, this.hint, statusbar, this.toaster.element)

    this.player.onEnded = () => this.handlePlaybackEnded()
    this.recorder.onLevel = (peaks) => this.meter.update(peaks)
    this.recorder.onDeviceLost = () => {
      void this.finishRecording()
      this.notify(this.t('toast.micBusy'), 'error')
    }
    this.project.onChange((changes) => this.render(changes))
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
    this.installDropTarget()
    navigator.mediaDevices?.addEventListener('devicechange', () => void this.refreshMicrophones())
    void this.refreshMicrophones()
    this.render(new Set<ChangeKind>(['audio', 'layers', 'file', 'history', 'selection', 'cursor']))
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
    if (command.startsWith('effect.')) {
      const id = command.slice('effect.'.length)
      if (isEffectId(id)) this.openEffects(id)
      return
    }
    switch (command) {
      case 'file.new':
        if (await this.confirmDiscard()) {
          this.stopPlayback(false)
          this.project.newProject()
        }
        return
      case 'file.open':
        return this.openFromDialog()
      case 'file.import':
        return this.importFromDialog()
      case 'file.save':
        await this.saveProject(false)
        return
      case 'file.saveAs':
        await this.saveProject(true)
        return
      case 'file.saveAndClose':
        if (await this.saveProject(false)) this.api.confirmClose()
        return
      case 'file.export':
        await this.exportAudio()
        return
      case 'edit.undo':
        this.stopPlayback(false)
        this.project.undo()
        return
      case 'edit.redo':
        this.stopPlayback(false)
        this.project.redo()
        return
      case 'edit.cut':
        return this.edit(() => this.project.cut())
      case 'edit.copy':
        return this.edit(() => this.project.copy(), false)
      case 'edit.paste':
        return this.edit(() => this.project.paste())
      case 'edit.delete':
        return this.edit(() => this.project.deleteSelection())
      case 'edit.selectAll':
        this.project.selectAll()
        return
      case 'edit.trim':
        return this.edit(() => this.project.trimToSelection())
      case 'layer.add':
        this.stopPlayback(false)
        this.project.addLayer()
        return
      case 'layer.record':
        return this.startRecording(true)
      case 'layer.duplicate': {
        const active = this.project.activeLayer()
        if (active) this.duplicateLayer(active.id)
        return
      }
      case 'layer.remove': {
        const active = this.project.activeLayer()
        if (active) this.removeLayer(active.id)
        return
      }
      case 'layer.previous':
        return this.stepLayer(-1)
      case 'layer.next':
        return this.stepLayer(1)
      case 'effects.open':
        this.openEffects()
        return
      case 'transport.playPause':
        return this.togglePlay()
      case 'transport.stop':
        this.stopPlayback(true)
        return
      case 'transport.record':
        return this.toggleRecord()
      case 'view.zoomIn':
        this.tracks.zoomIn()
        return
      case 'view.zoomOut':
        this.tracks.zoomOut()
        return
      case 'view.zoomFit':
        this.tracks.zoomToFit()
        return
      case 'help.guide':
        return this.showHelp()
    }
  }

  private async edit(action: () => EditResult | void | Promise<EditResult | void>, stopsPlayback = true): Promise<void> {
    if (stopsPlayback) this.stopPlayback(false)
    try {
      const result = await action()
      if (result?.clipped) this.notify(this.t('toast.clipWarning'), 'warning')
    } catch (error) {
      this.handleError(error)
    }
  }

  private handleError(error: unknown): void {
    if (error instanceof ProjectError) {
      const message = {
        'no-layer': this.t('toast.noLayer'),
        'no-audio': this.t('toast.layerEmpty'),
        'no-selection': this.t('toast.selectFirst'),
        'empty-clipboard': this.t('toast.clipboardEmpty'),
        silent: this.t('toast.silentAudio'),
        'outside-layer': this.t('toast.outsideLayer')
      }[error.code]
      this.notify(message, 'info')
      return
    }
    console.error(error)
    this.notify(error instanceof Error ? error.message : String(error), 'error')
  }

  // ---- Layers ---------------------------------------------------------------------------

  private duplicateLayer(id: string): void {
    const layer = this.project.getLayer(id)
    if (!layer) return
    this.stopPlayback(false)
    this.project.duplicateLayer(id, this.t('layer.copyName', { name: layer.name }))
  }

  private removeLayer(id: string): void {
    const layer = this.project.getLayer(id)
    if (!layer) return
    this.stopPlayback(false)
    this.project.removeLayer(id)
    this.toaster.show(this.t('toast.layerRemoved', { name: layer.name }), {
      kind: 'info',
      dismissLabel: this.t('toast.dismiss'),
      action: { label: this.t('toolbar.undo'), run: () => this.run('edit.undo') }
    })
  }

  private stepLayer(delta: number): void {
    const layers = this.project.getLayers()
    if (layers.length === 0) return
    const index = layers.findIndex((layer) => layer.id === this.project.activeLayer()?.id)
    const next = layers[Math.min(Math.max(index + delta, 0), layers.length - 1)]
    if (next) this.project.setActiveLayer(next.id)
  }

  // ---- Files ----------------------------------------------------------------------------

  private documentName(): string {
    return this.project.snapshot().fileName ?? this.t('dialog.untitled')
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.project.isDirty() || this.project.getLayers().length === 0) return true
    const choice = await this.api.confirmDiscardChanges(this.documentName())
    if (choice === 'cancel') return false
    if (choice === 'save') return this.saveProject(false)
    return true
  }

  private async openFromDialog(): Promise<void> {
    if (!(await this.confirmDiscard())) return
    const file = await this.api.openFile('project').catch((error: unknown) => {
      this.handleError(error)
      return null
    })
    if (file) await this.openFile(file)
  }

  private async importFromDialog(): Promise<void> {
    const file = await this.api.openFile('audio').catch((error: unknown) => {
      this.handleError(error)
      return null
    })
    if (file) await this.importFile(file)
  }

  /** Opens a project, or starts a new project from an audio file. */
  private async openFile(file: OpenedFile): Promise<void> {
    this.stopPlayback(false)
    this.setBusy(this.t('loading.opening', { name: file.name }))
    try {
      if (isProjectFile(file.data)) {
        this.project.loadProject(decodeProject(file.data), file.name, file.path)
      } else {
        const audio = await decodeAudioFile(file.data)
        if (frameCount(audio) === 0) throw new Error('empty')
        this.project.loadAudio(audio, baseName(file.name), file.name)
      }
      this.tracks.zoomToFit()
    } catch (error) {
      console.error(error)
      this.notify(this.t('toast.openFailed', { name: file.name }), 'error')
    } finally {
      this.setBusy(null)
    }
  }

  /** Adds an audio file as a new layer. */
  private async importFile(file: OpenedFile): Promise<void> {
    if (isProjectFile(file.data)) {
      this.notify(this.t('toast.importProject'), 'info')
      return
    }
    this.stopPlayback(false)
    this.setBusy(this.t('loading.opening', { name: file.name }))
    try {
      const audio = await decodeAudioFile(file.data)
      if (frameCount(audio) === 0) throw new Error('empty')
      const result = await this.project.importLayer(audio, baseName(file.name))
      if (result.clipped) this.notify(this.t('toast.clipWarning'), 'warning')
    } catch (error) {
      console.error(error)
      this.notify(this.t('toast.openFailed', { name: file.name }), 'error')
    } finally {
      this.setBusy(null)
    }
  }

  /** Saves the layers as a .suara project. Returns true when the file was written. */
  private async saveProject(saveAs: boolean): Promise<boolean> {
    const snapshot = this.project.snapshot()
    if (snapshot.layers.length === 0) return false
    this.stopPlayback(false)
    const overwritePath = !saveAs && snapshot.filePath?.toLowerCase().endsWith('.suara') ? snapshot.filePath : undefined
    this.setBusy(this.t('loading.saving'))
    try {
      await nextFrame()
      const saved = await this.api.saveFile({
        kind: 'project',
        data: encodeProject(this.project.toProjectData()),
        suggestedName: `${baseName(this.documentName())}.suara`,
        path: overwritePath
      })
      if (!saved) return false
      this.project.markSaved(saved.name, saved.path)
      this.notify(this.t('toast.projectSaved', { name: saved.name }), 'success')
      return true
    } catch (error) {
      this.notify(this.t('toast.saveFailed', { error: error instanceof Error ? error.message : String(error) }), 'error')
      return false
    } finally {
      this.setBusy(null)
    }
  }

  /** Merges the audible layers into one WAV file. */
  private async exportAudio(): Promise<void> {
    const snapshot = this.project.snapshot()
    if (!snapshot.hasAudio) return
    this.stopPlayback(false)
    const audible = audibleLayers(snapshot.layers)
    if (audible.length === 0) {
      this.notify(this.t('toast.nothingAudible'), 'info')
      return
    }
    const length = Math.max(...audible.map((layer) => frameCount(layer.audio)))
    const silent = snapshot.layers.filter((layer) => frameCount(layer.audio) > 0).length - audible.length
    const summary = [
      this.t('dialog.export.summary', { count: audible.length, duration: formatTime(length / snapshot.sampleRate) }),
      silent > 0 ? this.t('dialog.export.skipped', { count: silent }) : ''
    ].join(' ')
    const choice = await this.dialogs.chooseExport(this.wavFormat, summary.trim())
    if (!choice) return
    this.setBusy(this.t('loading.exporting'))
    try {
      await nextFrame()
      const mix = mixLayers(snapshot.layers, snapshot.sampleRate, { preventClipping: choice.preventClipping })
      const saved = await this.api.saveFile({
        kind: 'audio',
        data: encodeWav(mix.audio, choice.format),
        suggestedName: `${baseName(this.documentName())}.wav`
      })
      if (!saved) return
      this.wavFormat = choice.format
      writeStorage(STORAGE_WAV_FORMAT, choice.format)
      this.notify(this.t('toast.exported', { name: saved.name, count: mix.layerCount }), 'success')
      if (mix.scaled) this.notify(this.t('toast.exportScaled'), 'info')
      else if (mix.peak > 1 && choice.format !== 'float32') this.notify(this.t('toast.clipWarning'), 'warning')
    } catch (error) {
      this.notify(this.t('toast.saveFailed', { error: error instanceof Error ? error.message : String(error) }), 'error')
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
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0 || this.isRecording() || this.busy || this.dialogs.isOpen) return
      void (async () => {
        for (const file of files) {
          let opened: OpenedFile
          try {
            opened = await this.api.openDroppedFile(file)
          } catch {
            this.notify(this.t('toast.openFailed', { name: file.name }), 'error')
            continue
          }
          // A project replaces everything; audio files are added as layers.
          if (isProjectFile(opened.data)) {
            if (await this.confirmDiscard()) await this.openFile(opened)
          } else {
            await this.importFile(opened)
          }
        }
      })()
    })
  }

  // ---- Playback -------------------------------------------------------------------------

  private playbackLayers(snapshot: ProjectSnapshot, exclude?: string): PlaybackLayer[] {
    return audibleLayers(snapshot.layers)
      .filter((layer) => layer.id !== exclude)
      .map((layer) => ({ id: layer.id, audio: layer.audio, gain: layer.volume }))
  }

  private async togglePlay(): Promise<void> {
    if (this.playMode === 'timeline') {
      const position = this.player.position
      this.stopPlayback(false)
      this.project.setCursor(Math.round(position * this.project.getSampleRate()))
      return
    }
    const snapshot = this.project.snapshot()
    if (!snapshot.hasAudio) return
    const rate = snapshot.sampleRate
    let from = snapshot.cursor
    let to = snapshot.length
    if (snapshot.selection) {
      from = snapshot.selection.start
      to = snapshot.selection.end
    } else if (from >= snapshot.length - 1) {
      from = 0
    }
    await this.startPlayback(this.playbackLayers(snapshot), from, to, rate)
  }

  private async startPlayback(layers: PlaybackLayer[], from: number, to: number, rate: number): Promise<void> {
    this.stopPreview()
    if (layers.length === 0) {
      this.notify(this.t('toast.nothingAudible'), 'info')
      return
    }
    this.playOrigin = from
    await this.player.play(layers, from / rate, to / rate)
    this.playMode = 'timeline'
    this.setPlayingUi(true)
    const tick = (): void => {
      if (this.playMode !== 'timeline') return
      const frame = Math.round(this.player.position * rate)
      this.tracks.setPlayhead(frame)
      this.status.position.textContent = formatTime(this.player.position)
      this.playheadHandle = requestAnimationFrame(tick)
    }
    tick()
  }

  /** Restarts playback from where it is, e.g. after a layer was muted or soloed. */
  private restartPlayback(): void {
    if (this.playMode !== 'timeline') return
    const snapshot = this.project.snapshot()
    const rate = snapshot.sampleRate
    const position = Math.round(this.player.position * rate)
    const origin = this.playOrigin
    const end = snapshot.selection ? snapshot.selection.end : snapshot.length
    void this.startPlayback(this.playbackLayers(snapshot), position, end, rate).then(() => {
      this.playOrigin = origin
    })
  }

  /** Stops timeline playback; `returnToOrigin` puts the cursor back where playback started. */
  private stopPlayback(returnToOrigin: boolean): void {
    if (this.playMode !== 'timeline') return
    this.player.stop()
    this.playMode = null
    cancelAnimationFrame(this.playheadHandle)
    this.tracks.setPlayhead(null)
    this.setPlayingUi(false)
    if (returnToOrigin) this.project.setCursor(this.playOrigin)
    this.updateStatus(this.project.snapshot())
  }

  private handlePlaybackEnded(): void {
    if (this.playMode === 'preview') {
      this.playMode = null
      this.effectsPanel.setPreviewing(false)
      return
    }
    if (this.playMode !== 'timeline') return
    this.playMode = null
    cancelAnimationFrame(this.playheadHandle)
    this.tracks.setPlayhead(null)
    this.setPlayingUi(false)
    this.project.setCursor(this.playOrigin)
    this.updateStatus(this.project.snapshot())
  }

  private setPlayingUi(playing: boolean): void {
    setButtonIcon(this.controls.play, playing ? Pause : Play)
    setButtonText(this.controls.play, playing ? this.t('toolbar.pause') : this.t('toolbar.play'), playing ? this.t('toolbar.pause') : this.t('toolbar.play'))
    this.root.classList.toggle('is-playing', playing)
  }

  // ---- Recording ------------------------------------------------------------------------

  private isRecording(): boolean {
    return this.recorder.state !== 'idle'
  }

  private async toggleRecord(): Promise<void> {
    if (this.recorder.state === 'recording' || this.recorder.state === 'paused') {
      return this.finishRecording()
    }
    if (this.recorder.state === 'idle') return this.startRecording(false)
  }

  private toggleMonitor(): void {
    this.monitorEnabled = !this.monitorEnabled
    writeStorage(STORAGE_MONITOR, String(this.monitorEnabled))
    this.controls.monitor.setAttribute('aria-pressed', String(this.monitorEnabled))
  }

  private async startRecording(newLayer: boolean): Promise<void> {
    if (this.recorder.state !== 'idle') return
    this.stopPlayback(false)
    this.stopPreview()
    const access = await this.api.requestMicrophoneAccess()
    if (access === 'denied' || access === 'restricted') {
      this.notify(this.t('toast.micDenied'), 'error')
      return
    }
    const snapshot = this.project.snapshot()
    const active = newLayer ? null : this.project.activeLayer()
    const at = snapshot.selection && !newLayer ? snapshot.selection.start : snapshot.cursor
    this.recordingPlan = { newLayer: newLayer || active === null, at }
    const monitored = this.monitorEnabled ? this.playbackLayers(snapshot, active?.id) : []
    this.recordHint.textContent = this.recordingHint(active, at, snapshot, monitored.length > 0)
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
      this.recordingPlan = null
      this.notify(this.microphoneErrorMessage(error), 'error')
      this.render(new Set())
      return
    }
    if (monitored.length > 0) this.recorder.startMonitor(monitored, at / snapshot.sampleRate)
    this.recordPause.hidden = this.recorder.isMonitoring
    this.tracks.setInteractive(false)
    this.startClock()
    this.render(new Set())
    void this.refreshMicrophones()
  }

  private async finishRecording(): Promise<void> {
    if (this.recorder.state !== 'recording' && this.recorder.state !== 'paused') return
    this.stopClock()
    const plan = this.recordingPlan
    const recording = await this.recorder.stop()
    this.endRecordingUi()
    if (!recording || !plan) return
    await this.edit(() =>
      this.project.insertRecording(recording, plan.newLayer ? { newLayer: true, at: plan.at } : {})
    )
  }

  private async discardRecording(): Promise<void> {
    this.stopClock()
    await this.recorder.cancel()
    this.endRecordingUi()
  }

  private endRecordingUi(): void {
    this.recordingPlan = null
    this.recordPanel.hidden = true
    this.recordPause.hidden = false
    this.root.classList.remove('is-recording')
    this.tracks.setInteractive(true)
    this.meter.reset()
    this.render(new Set())
  }

  private togglePauseRecording(): void {
    if (this.recorder.isMonitoring) return
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

  private recordingHint(active: Layer | null, at: number, snapshot: ProjectSnapshot, monitoring: boolean): string {
    const time = formatTime(at / snapshot.sampleRate)
    let text = active
      ? snapshot.selection
        ? this.t('rec.replaceHint', { layer: active.name })
        : this.t('rec.intoLayer', { layer: active.name, time })
      : this.t('rec.newLayer', { time })
    if (monitoring) text += ` ${this.t('rec.monitoring')}`
    return text
  }

  private startClock(): void {
    const rate = this.project.getSampleRate()
    const tick = (): void => {
      this.recordClock.textContent = formatClock(this.recorder.elapsedSeconds)
      // While the other layers play along, the playhead shows where in them the singer is.
      const plan = this.recordingPlan
      if (plan && this.recorder.isMonitoring) {
        this.tracks.setPlayhead(plan.at + Math.round(this.recorder.monitorSeconds * rate))
      }
      this.clockHandle = requestAnimationFrame(tick)
    }
    tick()
  }

  private stopClock(): void {
    cancelAnimationFrame(this.clockHandle)
    this.tracks.setPlayhead(null)
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
      options.push(h('option', { value: mic.deviceId }, mic.label || this.t('toolbar.microphoneN', { n: index + 1 })))
    })
    select.replaceChildren(...options)
    select.value = microphones.some((mic) => mic.deviceId === wanted) ? wanted : ''
  }

  // ---- Effects ----------------------------------------------------------------------------

  private toggleEffects(): void {
    if (this.effectsPanel.isOpen) this.closeEffects()
    else this.openEffects()
  }

  private openEffects(effect?: EffectId): void {
    this.effectsPanel.open(effect)
    this.controls.effects.setAttribute('aria-expanded', 'true')
    this.workspace.classList.add('effects-open')
    this.updateEffectsTarget()
  }

  private closeEffects(): void {
    this.stopPreview()
    this.effectsPanel.close()
    this.controls.effects.setAttribute('aria-expanded', 'false')
    this.workspace.classList.remove('effects-open')
  }

  /** The part of the active layer an effect would change, or a reason why there is none. */
  private effectTarget(definition: EffectDefinition | null, values?: EffectValues): EffectTarget | string {
    const layer = this.project.activeLayer()
    if (!layer || !this.project.hasAudio) return this.t('effects.target.none')
    const length = frameCount(layer.audio)
    if (length === 0) return this.t('effects.target.emptyLayer', { layer: layer.name })
    const selection = this.project.getSelection()
    const rate = this.project.getSampleRate()
    if (selection) {
      const start = Math.min(selection.start, length)
      const end = Math.min(selection.end, length)
      if (end <= start) return this.t('effects.target.outside', { layer: layer.name })
      return { layer, range: { start, end } }
    }
    const duration = Math.round((values?.duration ?? 2) * rate)
    if (definition?.defaultRange === 'start') return { layer, range: { start: 0, end: Math.min(length, duration) } }
    if (definition?.defaultRange === 'end') return { layer, range: { start: Math.max(0, length - duration), end: length } }
    return { layer, range: { start: 0, end: length } }
  }

  private updateEffectsTarget(): void {
    if (!this.effectsPanel.isOpen) return
    const id = this.effectsPanel.effect
    const definition = id ? effectDefinition(id) : null
    const target = this.effectTarget(definition)
    if (typeof target === 'string') {
      this.effectsPanel.setTarget(target, false)
      return
    }
    const rate = this.project.getSampleRate()
    const { layer, range } = target
    const text = this.project.getSelection()
      ? this.t('effects.target.selection', {
          layer: layer.name,
          start: formatTime(range.start / rate),
          end: formatTime(range.end / rate)
        })
      : definition?.defaultRange === 'start'
        ? this.t('effects.target.start', { layer: layer.name })
        : definition?.defaultRange === 'end'
          ? this.t('effects.target.end', { layer: layer.name })
          : this.t('effects.target.layer', { layer: layer.name })
    this.effectsPanel.setTarget(text, !this.isRecording())
  }

  private async previewEffect(id: EffectId, values: EffectValues): Promise<void> {
    const definition = effectDefinition(id)
    const target = this.effectTarget(definition, values)
    if (typeof target === 'string') {
      this.notify(target, 'info')
      return
    }
    this.stopPlayback(false)
    const rate = this.project.getSampleRate()
    const { layer, range } = target
    const end = Math.min(range.end, range.start + PREVIEW_SECONDS * rate)
    let segment = sliceAudio(layer.audio, range.start, end)
    const tail = Math.round(definition.tailSeconds(values) * rate)
    if (tail > 0) segment = appendSilence(segment, Math.min(tail, 3 * rate))
    let processed: AudioData
    try {
      processed = definition.process(segment, values)
    } catch (error) {
      this.handleError(error)
      return
    }
    await this.player.play([{ id: 'preview', audio: processed, gain: layer.volume }], 0, frameCount(processed) / rate)
    this.playMode = 'preview'
    this.effectsPanel.setPreviewing(true)
  }

  private stopPreview(): void {
    if (this.playMode !== 'preview') return
    this.player.stop()
    this.playMode = null
    this.effectsPanel.setPreviewing(false)
  }

  private async applyEffect(id: EffectId, values: EffectValues): Promise<void> {
    if (this.busy || this.isRecording()) return
    const definition = effectDefinition(id)
    const target = this.effectTarget(definition, values)
    if (typeof target === 'string') {
      this.notify(target, 'info')
      return
    }
    this.stopPreview()
    this.stopPlayback(false)
    const { layer, range } = target
    if (definition.needsSound && peakLevel(sliceAudio(layer.audio, range.start, range.end)) === 0) {
      this.notify(this.t('toast.silentAudio'), 'info')
      return
    }
    const name = this.t(`fx.${id}.name`)
    this.setBusy(this.t('loading.effect', { name }))
    try {
      await nextFrame()
      const rate = this.project.getSampleRate()
      const result = this.project.applyEffect(id, (segment) => definition.process(segment, values), {
        range,
        tailFrames: Math.round(definition.tailSeconds(values) * rate)
      })
      this.toaster.show(this.t('toast.effectApplied', { name, layer: layer.name }), {
        kind: 'success',
        dismissLabel: this.t('toast.dismiss'),
        action: { label: this.t('toolbar.undo'), run: () => this.run('edit.undo') }
      })
      if (result.clipped) this.notify(this.t('toast.clipWarning'), 'warning')
    } catch (error) {
      this.handleError(error)
    } finally {
      this.setBusy(null)
    }
  }

  // ---- Help -------------------------------------------------------------------------------

  private async showHelp(): Promise<void> {
    const t = this.t
    const key = (keys: string): string => shortcut(keys, this.info.platform)
    await this.dialogs.showHelp(
      t('help.title'),
      [1, 2, 3, 4, 5].map((n) => ({
        title: t(`help.step${n as 1 | 2 | 3 | 4 | 5}.title`),
        text: t(`help.step${n as 1 | 2 | 3 | 4 | 5}.text`)
      })),
      [
        { keys: t('key.space'), action: t('help.key.play') },
        { keys: 'R', action: t('help.key.record') },
        { keys: `${t('key.delete')}`, action: t('help.key.delete') },
        { keys: `${key('Mod+Z')} / ${key('Mod+Shift+Z')}`, action: t('help.key.undo') },
        { keys: `${key('Mod+X')} · ${key('Mod+C')} · ${key('Mod+V')}`, action: t('help.key.clipboard') },
        { keys: key('Mod+A'), action: t('help.key.selectAll') },
        { keys: '↑ / ↓', action: t('help.key.layers') },
        { keys: '← / →', action: t('help.key.move') },
        { keys: `${key('Mod+')}${t('key.scroll')}`, action: t('help.key.zoom') },
        { keys: key('Mod+S'), action: t('help.key.save') },
        { keys: key('Mod+E'), action: t('help.key.export') }
      ]
    )
  }

  // ---- Keyboard -------------------------------------------------------------------------

  private handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || this.dialogs.isOpen) return
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
      case 'ArrowUp':
        event.preventDefault()
        this.run('layer.previous')
        return
      case 'ArrowDown':
        event.preventDefault()
        this.run('layer.next')
        return
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (this.isRecording() || !this.project.hasAudio) return
        event.preventDefault()
        const rate = this.project.getSampleRate()
        const step = (event.shiftKey ? 0.1 : 1) * rate * (event.key === 'ArrowLeft' ? -1 : 1)
        this.stopPlayback(false)
        this.project.setSelection(null)
        this.project.setCursor(this.project.getCursor() + step)
        return
      }
      case 'Home':
        event.preventDefault()
        if (!this.isRecording()) this.project.setCursor(0)
        return
      case 'End':
        event.preventDefault()
        if (!this.isRecording()) this.project.setCursor(this.project.length())
        return
      case 'Escape':
        if (this.playMode === 'timeline') this.stopPlayback(true)
        else if (this.playMode === 'preview') this.stopPreview()
        else if (this.project.getSelection()) this.project.setSelection(null)
        else if (this.effectsPanel.isOpen) this.closeEffects()
        return
    }
  }

  // ---- Rendering ------------------------------------------------------------------------

  private render(changes: ReadonlySet<ChangeKind>): void {
    const snapshot = this.project.snapshot()
    if (changes.has('audio') || changes.has('layers')) this.stopPreview()
    this.tracks.update({
      layers: snapshot.layers,
      activeId: snapshot.activeLayerId,
      sampleRate: snapshot.sampleRate,
      length: snapshot.length,
      selection: snapshot.selection,
      cursor: snapshot.cursor
    })
    this.updateControls(snapshot)
    this.updateStatus(snapshot)
    this.updateHint(snapshot)
    this.updateEffectsTarget()
    this.syncDocumentState(snapshot)
  }

  private stepName(label: StepLabel | undefined): string | null {
    if (!label) return null
    if (label.kind === 'effect' && label.detail && isEffectId(label.detail)) return this.t(`fx.${label.detail}.name`)
    return this.t(`edit.${label.kind}`)
  }

  private updateControls(snapshot: ProjectSnapshot): void {
    const c = this.controls
    const hasAudio = snapshot.hasAudio
    const hasLayers = snapshot.layers.length > 0
    const recording = this.isRecording()
    const idle = !recording && !this.busy
    c.save.disabled = !hasLayers || !idle
    c.exportAudio.disabled = !hasAudio || !idle
    c.newFile.disabled = !idle
    c.open.disabled = !idle
    c.help.disabled = recording
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
    c.addLayer.disabled = !idle
    c.zoomIn.disabled = !hasAudio
    c.zoomOut.disabled = !hasAudio
    c.zoomFit.disabled = !hasAudio
    c.microphone.disabled = recording
    c.monitor.disabled = recording
    if (!hasAudio && this.effectsPanel.isOpen) this.closeEffects()

    const undoName = this.stepName(snapshot.undoLabel)
    const redoName = this.stepName(snapshot.redoLabel)
    setButtonText(c.undo, undoName ? this.t('toolbar.undoAction', { action: undoName }) : this.t('toolbar.undo'))
    setButtonText(c.redo, redoName ? this.t('toolbar.redoAction', { action: redoName }) : this.t('toolbar.redo'))

    setButtonIcon(c.record, recording ? Square : Circle)
    setButtonText(
      c.record,
      recording ? this.t('toolbar.stopRecording') : this.t('toolbar.recordHint'),
      recording ? this.t('rec.stop') : this.t('toolbar.record')
    )
    c.record.classList.toggle('is-active', recording)

    this.emptyState.hidden = hasLayers || recording
    this.root.classList.toggle('has-layers', hasLayers)
    this.title.textContent = `${this.documentName()}${snapshot.dirty && hasLayers ? ' •' : ''}`
  }

  private updateStatus(snapshot: ProjectSnapshot): void {
    const rate = snapshot.sampleRate
    if (this.playMode !== 'timeline') this.status.position.textContent = formatTime(snapshot.cursor / rate)
    if (snapshot.selection) {
      const start = snapshot.selection.start / rate
      const end = snapshot.selection.end / rate
      this.status.selection.textContent = `${formatTime(start)} – ${formatTime(end)} (${formatTime(end - start)})`
    } else {
      this.status.selection.textContent = '—'
    }
    const layers = snapshot.layers.length
    this.status.format.textContent =
      layers > 0
        ? `${formatSampleRate(rate)} · ${this.t(layers === 1 ? 'status.layer' : 'status.layers', { count: layers })} · ${formatTime(snapshot.length / rate)}`
        : ''
    this.status.dirty.hidden = !(snapshot.dirty && layers > 0)
  }

  private updateHint(snapshot: ProjectSnapshot): void {
    const active = snapshot.layers.find((layer) => layer.id === snapshot.activeLayerId)
    const text = this.isRecording()
      ? this.t('hint.recording')
      : snapshot.layers.length === 0
        ? ''
        : !active || frameCount(active.audio) === 0
          ? this.t('hint.emptyLayer')
          : snapshot.selection
            ? this.t('hint.selection', { layer: active.name })
            : this.t('hint.default', { layer: active.name })
    this.hint.textContent = text
    this.hint.hidden = text === ''
  }

  private syncDocumentState(snapshot: ProjectSnapshot): void {
    const hasLayers = snapshot.layers.length > 0
    const dirty = snapshot.dirty && hasLayers
    const name = this.documentName()
    document.title = `${name}${dirty ? ' •' : ''} — ${this.t('app.name')}`
    const idle = !this.isRecording()
    this.api.setDocumentState({
      title: name,
      dirty,
      filePath: snapshot.filePath,
      hasAudio: snapshot.hasAudio,
      hasLayers,
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
    this.updateControls(this.project.snapshot())
  }

  private notify(message: string, kind: 'info' | 'success' | 'warning' | 'error'): void {
    this.toaster.show(message, { kind, dismissLabel: this.t('toast.dismiss') })
  }
}
