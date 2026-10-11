# Changelog

All notable changes to Suara Studio are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [0.2.0]

### Added

- Layers: stack as many recordings and audio files as you need, each with its own volume (0–200%),
  mute, solo, name and color. Adding, duplicating and deleting a layer can be undone.
- Record on a new layer while the other layers play along. The take is lined up with what was
  heard, allowing for the audio latency.
- Merge & Export: mixes every audible layer into one WAV file, with optional protection against
  clipping.
- Project files (`.suara`) that keep every layer with its volume, mute, solo and name.
- Add audio files as layers with the Import command, the Add audio file button or by dropping them
  on the window.
- Sound effects panel with 18 effects in five groups, presets, sliders and a Listen button to hear
  an effect before applying it. New effects: remove rumble, remove background hiss, even out
  volume, shorten long pauses, boost bass, boost treble, telephone voice, echo, room reverb, change
  speed, robot voice and tremolo.
- A start screen with the first steps, a hint bar that explains what to do next, and a built-in
  guide with the keyboard shortcuts (F1).
- Keyboard shortcuts for choosing layers (↑ and ↓), moving the cursor (← and →), adding,
  duplicating and recording layers, the effects panel and Merge & Export.

### Changed

- New timeline that shows every layer with a shared ruler, selection and zoom, replacing the
  single waveform view.
- Save now writes a project file. Use Merge & Export to write a WAV file.
- Amplify is now part of Change volume, which also lowers the volume.

## [0.1.0]

First release.

### Added

- Record from any microphone with a live level meter, clipping warning, and pause and resume.
- Insert a recording at the cursor or record over a selection.
- Waveform editor with selection, zoom and playback of the whole file or the selection.
- Cut, copy, paste, delete, trim, silence, fade in, fade out, normalize, amplify and reverse, all
  with undo and redo.
- Open WAV, MP3, FLAC, Ogg and M4A files; save as 16-bit, 24-bit or 32-bit float WAV.
- English and Indonesian interface, light and dark themes.
- Update notice when a newer release is published on GitHub.
- One-line install scripts for macOS, Linux and Windows that verify every download with SHA-256.
