# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Suara Studio is an Electron + TypeScript desktop app for recording and editing audio on Windows,
macOS and Linux. It is published through GitHub Releases and installed with
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
- `src/renderer/src/editor/editor.ts`: the document model. Every edit is a `replaceRange` `Edit`
  (`audio/edits.ts`), which keeps undo/redo a single primitive. Positions are sample frames.
- `src/renderer/src/audio/`: pure audio code (WAV codec, effects, history, format probing) plus the
  browser-only parts: `recorder.ts` with its AudioWorklet and `convert.ts` (decoding, resampling).
- `src/renderer/src/app.ts`: wires the editor to the UI (`ui/waveform.ts` wraps wavesurfer.js).
- `src/shared/i18n.ts`: English and Indonesian strings. Add every new key to both; a unit test
  checks they match.

## Conventions

- Keep `src/renderer/src/audio` and `src/renderer/src/editor` free of DOM and Electron imports
  (except `recorder.ts`, `recorder-worklet.ts` and `convert.ts`) so unit tests run in Node.
- Menu accelerators must use Ctrl/Cmd. Bare keys (Space, R, Delete, Esc) are handled in the page
  so they never take keystrokes away from text fields.
- Release asset names are matched by the install scripts (`-mac-<arch>.zip`, `_amd64.deb`,
  `.x86_64.rpm`, `-linux-x64.tar.gz`, `-win-x64-setup.exe`). Change `electron-builder.yml` and the
  scripts together.
- Releases: bump `package.json`, add a `## [x.y.z]` section to `CHANGELOG.md`, push tag `vx.y.z`.
  The release workflow creates a draft release that a maintainer publishes.
