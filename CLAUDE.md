# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Suara Studio is an Electron + TypeScript desktop app for recording, layering and editing audio on
Windows, macOS and Linux. It is published through GitHub Releases and installed with
`scripts/install.sh` (macOS/Linux) or `scripts/install.ps1` (Windows).

## Commands

```sh
npm ci
npm run dev                      # electron-vite dev server with hot reload
npm run build                    # build main, preload and renderer into out/
npm test                         # Vitest unit tests (tests/unit)
xvfb-run -a npm run test:e2e     # Playwright drives the built app (run npm run build first)
npm run lint && npm run typecheck
sh tests/install/run.sh          # install.sh tests against a fake file:// release
pwsh -File tests/install/run.ps1 # install.ps1 tests (needs Python for a local HTTP server)
npm run dist:linux               # installers into dist/ (dist:mac, dist:win on those systems)
```

## Architecture

- `src/main/index.ts`: the window, the `app://suara-studio` protocol that serves the renderer
  (`protocol.ts`), microphone permissions, file dialogs, the unsaved-changes guard and the update
  check (`updates.ts`). Native menus are in `menu.ts`; they send `MenuCommand`s to the renderer.
- `src/preload/index.ts`: exposes `window.suara` (`SuaraApi` in `src/shared/ipc.ts`). The renderer
  is sandboxed with context isolation, so it has no other access to Node or Electron.
- `src/renderer/src/project/project.ts`: the document model. A project is a list of layers that all
  start at time 0, each with its own `AudioData`, volume, mute and solo. Every audio edit is a
  `replaceRange` `Edit` (`audio/edits.ts`) on one layer, and adding or removing a layer is a
  history step too, so one undo stack covers everything. Volume, mute, solo and names are not
  undoable. Positions are sample frames. `mix.ts` mixes the audible layers for Merge & Export, and
  `project-file.ts` reads and writes `.suara` project files.
- `src/renderer/src/effects/catalog.ts`: each effect's sliders, presets and processing, built on
  `audio/dsp/`. Effect ids live in `src/shared/effects.ts` so the main process can list them in the
  Effects menu.
- `src/renderer/src/audio/`: pure audio code (WAV codec, edits, history, format probing, waveform
  peaks, DSP in `dsp/`) plus the browser-only parts: `recorder.ts` with its AudioWorklet,
  `player.ts` (Web Audio playback of the layers) and `convert.ts` (decoding, resampling).
- `src/renderer/src/app.ts`: wires the project to the UI: `ui/tracks.ts` (the canvas timeline with
  a header per layer), `ui/effects-panel.ts` and `ui/dialogs.ts`.
- `src/shared/i18n.ts`: English and Indonesian strings. Add every new key to both; a unit test
  checks they match.

## Conventions

- Keep `src/renderer/src/audio`, `src/renderer/src/project` and `src/renderer/src/effects` free of
  DOM and Electron imports (except `recorder.ts`, `recorder-worklet.ts`, `player.ts` and
  `convert.ts`) so unit tests run in Node.
- Menu accelerators must use Ctrl/Cmd. Bare keys (Space, R, Delete, Esc, arrows) are handled in the
  page so they never take keystrokes away from text fields.
- Release asset names are matched by the install scripts (`-mac-<arch>.zip`, `_amd64.deb`,
  `.x86_64.rpm`, `-linux-x64.tar.gz`, `-win-x64-setup.exe`). Change `electron-builder.yml` and the
  scripts together, and update the file names in `docs/panduan-unduh.md` (the Indonesian download
  guide) and the install steps in `README.md`.
- Releases: bump `package.json` and add a `## [x.y.z]` section to `CHANGELOG.md`. Then either
  run the Release workflow on `main` from the Actions tab (it creates tag `vx.y.z`) or push the
  tag `vx.y.z`. The release workflow creates a draft release that a maintainer publishes.
