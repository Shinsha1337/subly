# Subly (DaVinci Resolve Workflow Integration)

Turn subtitle tracks into beautifully formatted Fusion **Text+** captions — with
live preview, smart phrase regrouping, and a built-in editor. Runs **inside
DaVinci Resolve Studio** as a Workflow Integration plugin (Electron).

<img width="1140" height="1008" alt="Subly" src="https://github.com/user-attachments/assets/ca99c8ba-f6de-41f6-8132-f797c5e35b42" />


## Requirements

- **DaVinci Resolve Studio** (Workflow Integrations require Studio, not the free
  version; the exact version needed depends on which Resolve features you use)
- **Windows or macOS** — the same code and installer support both
- **Node.js 22.12+** — only if you build the UI from source (end users don't need it)

## Install

### Option 1 — Pre-built release (recommended for users)

1. Download the latest version of Subly from the page
   [Releases](https://github.com/Shinsha1337/subly/releases) page.
2. Unzip it anywhere.
3. In DaVinci Resolve, open **Workspace → Console**, set the language to **Lua**.
4. Drag **`install.lua`** into the Console (or paste its contents) and run it.
5. When prompted, restart DaVinci Resolve.
6. Open **Workspace → Workflow Integrations → Subly**.

### Option 2 — From source (for developers)

1. Clone this repository: `git clone https://github.com/Shinsha1337/subly`
2. Open **Workspace → Console** in Resolve, language = **Lua**.
3. Drag **`install.lua`** into the Console and run it.
4. When prompted, restart DaVinci Resolve.
5. Open **Workspace → Workflow Integrations → Subly**.

The release zip and the repository both ship a pre-built `plugin/dist`, so
neither users nor developers need Node.js to install. You only need
Node.js 22.12+ to **modify** the UI (see [Building from source](#building-from-source)).

The installer copies the pre-built plugin (it does **not** run npm) into:

```
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\subly\   (Windows)
/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/subly/   (macOS)
```

The proprietary `WorkflowIntegration` native module is **not** bundled with this
project (it belongs to Blackmagic Design). The installer copies it from your
local DaVinci Resolve SDK — on Windows from
`%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node`,
on macOS from the matching path under
`/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/...`.
It is already present on any machine with DaVinci Resolve Studio installed.

To uninstall, run **`uninstall.lua`** the same way (it removes the plugin folder
and optionally your settings).

## Building from source

Only needed if you change the UI (`plugin/src/`). Everything in `node_modules`
(Vite, React, Electron) is for building / running locally only — end users never
need it; they get the pre-built `plugin/dist`.

```
cd plugin
npm ci           # restores node_modules from package-lock.json
npm test         # runs subtitle logic tests
npm run build    # rebuilds plugin/dist (the bundle the plugin actually runs)
```

`plugin/dist` is the built UI and must be present for the installer to succeed.
`node_modules` and the `WorkflowIntegration.*.node` files are git-ignored.

## How it works

Subly works in three tabs, in order: **Template → Transcription → Deliver**.

- **Template** — pick a Text+ generator from the Media Pool as the caption
  style. Optionally import the bundled `Subly.drb` starter bin.
- **Transcription** — run DaVinci's built-in audio transcription (one word per
  caption), then regroup into phrases via *Whole Sentence* / *Single Word* /
  *Custom* modes. Manual text fixes are done in the right-hand editor.
- **Deliver** — fine-tune size/position/case/punctuation on a live preview,
  then **Create Captions** to bake every phrase as a Text+ clip on a new
  timeline track.

The right-hand panel is a shared subtitle editor. Settings/presets (modes,
case, punctuation, theme) are stored in `settings.json` under `%APPDATA%\subly`
(Windows) / `~/Library/Application Support/subly` (macOS).

## Architecture

- **Electron** (bundled with DaVinci Resolve) — `plugin/main.js`, `preload.js`,
  Windows gets a custom titlebar, macOS uses native traffic lights.
- **React + Vite** UI in `plugin/src/`, built to `plugin/dist/`.
- **Resolve API** via `plugin/ipc/resolve.js` and the `WorkflowIntegration`
  native module (copied from your local Resolve SDK at install time).
- **Fusion Text+ bridge** — `plugin/ipc/luaBridge.js` spawns `fuscript` with
  `plugin/lua/subly_bridge_launcher.lua` for tool-level Text+ operations
  (slider live preview); the bridge is local-only and token-authenticated.
- **Settings** in `settings.json` under `%APPDATA%\subly` /
  `~/Library/Application Support/subly`.

> **Note on templates:** applying a Text+ template runs the template's own
> embedded Fusion/Lua. Only import `.drb` / Text+ templates you trust — the
> bundled `Subly.drb` is safe.

## Support
Subly is free and open source. If you'd like to support its development:
- 💜 [Boosty](https://boosty.to/shinsha)

## Credits

Subly by [shinsha](https://github.com/Shinsha1337).

## License

[MIT](LICENSE) © 2026 [shinsha](https://github.com/Shinsha1337).

The DaVinci Resolve `WorkflowIntegration` native module is proprietary to
Blackmagic Design, is not part of this project, and is not covered by the MIT
license — see the note at the bottom of [LICENSE](LICENSE).

