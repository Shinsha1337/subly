# Subly (DaVinci Resolve Workflow Integration)



Turn subtitle tracks into beautifully formatted Fusion **Text+** captions — with
live preview, smart phrase regrouping, and a built-in editor. Runs **inside
DaVinci Resolve Studio** as a Workflow Integration plugin (Electron).

## Requirements

- **DaVinci Resolve Studio** (Workflow Integrations require Studio, not the free
  version; the exact version needed depends on which Resolve features you use)
- **Windows or macOS** — the same code and installer support both
- **Node.js 22.12+** — only if you build the UI from source (end users don't need it)

## Install

### Option 1 — Pre-built release (recommended for users)

1. Download the latest `Subly-X.Y.Z.zip` from the
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

## Repository layout

- `install.lua` / `uninstall.lua` — Resolve Console scripts for installing and
  removing Subly
- `plugin/manifest.xml` — Workflow Integration plugin metadata
- `plugin/main.js`, `plugin/preload.js`, `plugin/ipc/` — Electron shell and
  Resolve IPC layer
- `plugin/src/` — React/Vite source UI
- `plugin/dist/` — pre-built UI used by the installer and required in releases
- `plugin/lua/` — Resolve/Fusion Lua bridge code
- `plugin/data/Subly.drb` — bundled starter template bin
- `plugin/test/` — Vitest unit tests for subtitle logic

## Development checks

GitHub Actions runs the same basic checks on every pull request and push to
`main`:

```
cd plugin
npm ci
npm test
npm run build
```

Do not commit `node_modules`, local `.env` files, `settings.json`, logs, test
coverage, or Blackmagic's proprietary `WorkflowIntegration.*.node` binaries.
Keep `plugin/dist` committed because end-user installation depends on it.

## How it works

Subly takes you from raw audio to baked Text+ captions in three tabs, **Template
→ Transcription → Deliver**, in that order. The right side of the window is a
shared **subtitle editor** that shows whatever the current tab is working on.

### 1. Template tab — pick the look

This is where you choose the Fusion **Text+** template that every caption will
inherit (font, color, outline, animation, the SmartSubs word-timing macro,
etc.).

- **Select Template from Media Pool** — dropdown lists every Text+ generator
  found in the open project's Media Pool.
- **📁 Import bundled bin** — drops the included `Subly.drb` bin (a starter
  template set) into the Media Pool so you have something to choose from on a
  fresh project.
- **🔄 Refresh** — re-scan the Media Pool after you've added or renamed
  templates in Resolve.
- **Set Preview Caption** — places a single short Text+ clip at the playhead so
  you can see what the template looks like before committing. The Deliver tab's
  size/position sliders write live changes into this preview clip.

After setting a preview, the app auto-switches to **Transcription**.

### 2. Transcription tab — get the words

Generate or load a subtitle track, then regroup it into the phrasing you want
for the final captions.

- **Language + Transcribe Audio** — runs DaVinci's built-in transcription on the
  current timeline's audio. Subly forces the finest possible granularity
  (one word per caption); the regrouping in the next step is what decides the
  actual phrase shape. When transcription finishes, the new subtitle track is
  auto-selected **and** auto-loaded into the editor on the right — no need to
  click "Pull from Resolve".
- **Subtitle Track + 🔄 Refresh** — if you already have subtitle tracks (e.g.
  from a previous Subly run or imported `.srt`), pick one here.
- **Timeline Sync**
  - **Pull from Resolve** — load the currently-selected track into the editor;
    use it again after manual text/timing fixes in Resolve.
  - **Apply to Resolve** — send the editor's current text/timings to Resolve,
    importing an SRT media item into the `Subly_sync` Media Pool bin and moving
    the timeline playhead to the first caption's start. It does not add or
    delete subtitle tracks; drag/import the SRT from `Subly_sync` if you want a
    timeline subtitle track. Text case and punctuation settings from the Deliver
    tab are applied to the exported SRT.
- **Subtitle Mode** — controls how single words get regrouped into phrases:
  - *Whole Sentence* — groups by punctuation, with a configurable max chars per
    line.
  - *Single Word* — one word per caption.
  - *Custom* — tune max words and max characters per phrase independently.
- **Create Phrases** — runs the regrouping, fills the Deliver tab's editor with
  the result, and seeds the Preview Caption with the longest phrase (so you can
  size/position against a realistic worst-case line).

The editor on this tab is **the raw transcript** — you can fix typos and delete
bad captions, but merge/split are intentionally hidden here. Final phrasing
lives on the Deliver tab.

### 3. Deliver tab — style and bake

Tune the visual look, do the final text cleanup, and write the captions onto
the timeline.

- **Text Size / X / Y** sliders — live preview: changes are coalesced and sent
  through a small `fuscript` preview pool, so the Preview Caption follows slider
  movement without replaying stale intermediate values. Snap-to-center on 0.5
  for X / Y.
- **Text case** — Auto / lowercase / UPPERCASE applied at bake time.
- **Remove punctuation** — toggle plus a multi-select of which punctuation
  marks to strip (so you can keep, say, `?` and `!` while removing `,` `.` `…`).
- **Fill Gaps + Max Frames** — when on, short silences between captions are
  extended onto the previous caption (up to *Max Frames* frames) so the text
  doesn't visibly flicker between near-adjacent phrases. Max Frames is clamped
  to 1–100.
- **Create Captions** — bakes every phrase as a separate Text+ clip on a new
  video track, each clip inheriting the chosen template. This is the final
  output step.

The editor on this tab is the **phrases** view (the result of *Create Phrases*).
All editor tools are available here — merge ↓, split ✂, delete ✕, per-word edit,
undo/redo (Ctrl+Z / Ctrl+Y), find (Ctrl+F), and a per-block "sync playhead"
button (`#N`) that jumps the Resolve playhead to that caption.

### Presets and settings

The ⚙️ Settings dialog lets you save the current Subtitle Mode, text case,
punctuation selection, Fill Gaps / Max Frames choice, and other formatting as a
named **preset**, then switch between presets per project. The selected UI theme
(dark / light / auto) is stored with the same app settings. Settings live in
`settings.json` under `%APPDATA%\subly` (Windows) /
`~/Library/Application Support/subly` (macOS) and are auto-created on
first run.

### Typical end-to-end flow

1. Open a project, drop your footage and audio on a timeline.
2. **Template tab** → Import bundled bin → pick a template → Set Preview Caption.
3. **Transcription tab** → pick language → Transcribe Audio → wait for the track
   to load → pick a Subtitle Mode → Create Phrases.
4. **Deliver tab** → tweak Text Size / X / Y against the live preview → toggle
   case/punctuation/fill-gaps → optionally clean up phrases in the editor →
   Create Captions.

The editor panel on the right is always visible. Before subtitles are loaded it
shows contextual guidance / empty states; after Transcribe / Pull from Resolve /
Create Phrases it becomes the subtitle editor.

## Architecture

- **Electron** (bundled with DaVinci Resolve) — `plugin/main.js`, `preload.js`;
  plugin id / install folder: `subly`
- **React + Vite** UI — `plugin/src/`, built to `plugin/dist/`; `App.jsx` owns
  state and Resolve actions while `ControlPanel.jsx`, `EditorPane.jsx`, and
  `TitleBar.jsx` render the main UI regions
- **Resolve API** — `plugin/ipc/resolve.js` drives most of Resolve directly
  through the `WorkflowIntegration` native module (copied from the Resolve SDK at
  install time, not shipped with this repo)
- **Fusion Text+ bridge** — `plugin/ipc/luaBridge.js` spawns `fuscript` running
  `plugin/lua/subly_bridge_launcher.lua`, which serves JSON-RPC on
  `127.0.0.1`. Normal Resolve/Lua operations use port `56003`; live preview uses
  a tiny latest-only worker pool on `56004`/`56005` so slider updates don't queue
  stale values. This is used only for tool-level Fusion operations
  (`tool:SetInput` on Text+) that the native module can't reach reliably; workers
  are started lazily and killed when idle / on window close. The bridge is
  authenticated with a random per-launch token (passed to `fuscript` via the
  `SUBLY_TOKEN` env var and required on every non-Exit request), so no other
  local process — or web page — can drive it.

> **Note on templates:** applying a Text+ template runs the template's own
> embedded Fusion/Lua (the SmartSubs word-timing macro). Only import `.drb` /
> Text+ templates you trust — the bundled `Subly.drb` is safe.
- **Subtitle logic** — `plugin/src/logic/subtitle.js` (regrouping, formatting)
- **Settings/presets** — `plugin/ipc/config.js` → `settings.json` in
  `%APPDATA%\subly` (Windows) / `~/Library/Application Support/subly`
  (macOS), auto-created; removed by the uninstaller
- **Window chrome** — Windows uses Subly's custom titlebar buttons; macOS uses
  native traffic-light controls with the settings menu on the right.

## Support the project

Subly is free and open source. If you'd like to support its development:

- 💜 [Boosty](https://boosty.to/shinsha)

## Credits

Subly by [shinsha](https://github.com/Shinsha1337).

## License

[MIT](LICENSE) © 2026 [shinsha](https://github.com/Shinsha1337).

The DaVinci Resolve `WorkflowIntegration` native module is proprietary to
Blackmagic Design, is not part of this project, and is not covered by the MIT
license — see the note at the bottom of [LICENSE](LICENSE).
