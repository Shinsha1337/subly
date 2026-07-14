# Subly — DaVinci Resolve Subtitle Toolkit

![License](https://img.shields.io/badge/license-MIT-blue)
![Release](https://img.shields.io/github/v/release/Shinsha1337/subly)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue)

Turn subtitle tracks into styled Fusion **Text+** captions with live preview,
phrase regrouping, per-word emphasis, and a built-in editor. Subly runs inside
**DaVinci Resolve Studio** as a Workflow Integration plugin.

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> ·
  <a href="#workflow"><strong>Workflow</strong></a> ·
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#manual-installation"><strong>Manual Installation</strong></a> ·
  <a href="#development"><strong>Development</strong></a>
</p>

<img width="1140" height="1008" alt="Subly running in DaVinci Resolve Studio" src="https://github.com/user-attachments/assets/ca99c8ba-f6de-41f6-8132-f797c5e35b42" />

## Features

- Convert a Resolve subtitle track into Fusion **Text+ clips**.
- Preview caption styling directly on the timeline before delivery.
- Regroup captions as Whole Sentence, Single Word, or Custom phrases.
- Send subtitles to Resolve for timeline edits and pull the result back into
  Subly.
- Edit, search, split, merge, and delete subtitles with undo and redo support.
- Apply any combination of per-word Emphasis color, size, and font style.
- Save Emphasis colors in a persistent palette.
- Search installed font families, expand their available styles, preview each
  face, and pin favorite families to the top.
- Create, rename, delete, and reuse caption presets between sessions.
- Use light, dark, or automatic system theme.
- Install on Windows or macOS with the same Lua installer.

## Requirements

- **DaVinci Resolve Studio 18.5 or later.** Workflow Integrations are not
  available in the free version of Resolve.
- **Windows or macOS.**
- **Node.js 22.12+ only for UI development.** End users do not need Node.js or
  npm.

## Quick Start

1. Download and extract the latest package from
   [Releases](https://github.com/Shinsha1337/subly/releases), or clone this
   repository.
2. In DaVinci Resolve Studio, open **Workspace → Console** and select **Lua**.
3. Run `install.lua` from the extracted project folder.
4. Restart Resolve after installation.
5. Open **Workspace → Workflow Integrations → Subly**.

The package already contains the built UI in `Subly/dist`. The installer never
runs npm: it copies the ready-to-use `Subly` folder and the native Resolve SDK
module into the Workflow Integration Plugins directory.

The installed plugin directory is:

**Windows**

```text
%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\Subly\
```

**macOS**

```text
/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/Subly/
```

The proprietary `WorkflowIntegration.node` module belongs to Blackmagic Design
and is not included in this repository. DaVinci Resolve Studio installs the
correct platform build in its local Developer SDK; `install.lua` copies that
file without renaming it.

## Manual Installation

If Resolve cannot write to the plugin directory automatically, the installer
shows the same source and destination paths used by these steps:

| Platform | Workflow Integration Plugins directory | SDK module source |
| --- | --- | --- |
| Windows | `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\` | `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Workflow Integrations\Examples\SamplePlugin\WorkflowIntegration.node` |
| macOS | `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/` | `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node` |

1. Copy the entire `Subly` folder next to `install.lua` into the Workflow
   Integration Plugins directory shown above.
2. Copy `WorkflowIntegration.node` from the matching SDK path into the installed
   `Subly` folder. Keep the filename `WorkflowIntegration.node` on both Windows
   and macOS.
3. Restart DaVinci Resolve Studio, then open
   **Workspace → Workflow Integrations → Subly**.

To uninstall, run `uninstall.lua` from the Resolve Lua Console. It removes the
plugin and can optionally remove the saved settings.

## Workflow

Subly follows three tabs in order: **Template → Transcription → Deliver**.

### 1. Template

Select a Text+ generator from the Media Pool as the caption style. You can also
import the bundled `Subly.drb` starter bin. Click **Set Preview Caption** to put
a temporary caption on the timeline for live size and position adjustments.

### 2. Transcription

Choose the transcription language and subtitle track, run Resolve's built-in
transcription, or pull an existing subtitle track into the editor. Use
**Apply to Resolve** to send edited subtitles back for timeline timing or text
corrections, then **Pull from Resolve** to load those changes into Subly.

Select Whole Sentence, Single Word, or Custom grouping and click
**Create Phrases**. Whole Sentence limits characters per line; Custom can limit
both words and characters.

### 3. Deliver

Review and correct phrases with search, undo, and redo. Phrases can be split,
merged, deleted, or corrected word by word. Adjust text size and position,
capitalization, punctuation removal, and gap filling before delivery.

Per-word Emphasis can combine color, relative size, and font. The color panel
includes a reusable palette; the font picker includes search, live previews,
favorites, and expandable installed styles such as Thin, Bold, or Black.
Clicking a word applies the enabled Emphasis tools. **Create Captions** writes
the result as Text+ clips on a new video track.

The settings menu provides light, dark, and automatic themes. Named presets can
be created, renamed, deleted, selected, and saved with **Save Settings**. Saved
colors and favorite font families persist between sessions.

## Development

Only UI changes in `Subly/src` require a rebuild:

```shell
cd Subly
npm ci
npm test
npm run build
```

`npm run build` updates `Subly/dist`, which must be present in installable
packages. `node_modules` and `WorkflowIntegration.node` are git-ignored.

### Architecture

- **Electron**, bundled with Resolve — `Subly/main.js` and `Subly/preload.js`.
  Windows uses custom window controls; macOS uses native traffic lights.
- **React + Vite** — UI source in `Subly/src`, built output in `Subly/dist`.
- **Resolve API** — `Subly/ipc/resolve.js` calls the platform-specific
  `WorkflowIntegration.node` copied from the local Resolve SDK.
- **Fusion Text+ bridge** — `Subly/ipc/luaBridge.js` starts `fuscript` with
  `Subly/lua/subly_bridge_launcher.lua` for tool-level Text+ operations that the
  native module does not expose. The bridge listens only on localhost and uses
  a random token for each run.

> Applying a Text+ template runs that template's embedded Fusion/Lua code. Only
> import `.drb` and Text+ templates you trust. The bundled `Subly.drb` is part of
> this project.

## Support

Subly is free and open source. If it saves you time, consider giving it a
⭐ on GitHub — it helps others find the project.

If you'd like to support development financially:
- 💜 [Boosty](https://boosty.to/shinsha)

## License

[MIT](LICENSE) © 2026 [shinsha](https://github.com/Shinsha1337).

The DaVinci Resolve `WorkflowIntegration.node` module is proprietary to
Blackmagic Design, is not part of this project, and is not covered by the MIT
license.
