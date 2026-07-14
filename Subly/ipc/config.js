// Subly — Config IPC
// Persists settings.json (language, presets) in the OS appData dir (subly).

const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULT_EMPHASIS_COLORS = ['#6C5CE7'];
const HEX_COLOR = /^#[0-9A-F]{6}$/i;

function normalizeColorList(value) {
    if (!Array.isArray(value)) return [...DEFAULT_EMPHASIS_COLORS];
    return Array.from(new Set(
        value
            .filter(color => typeof color === 'string' && HEX_COLOR.test(color))
            .map(color => color.toUpperCase())
    )).slice(0, 24);
}

function normalizeFontList(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.reduce((fonts, font) => {
        const cleaned = typeof font === 'string' ? font.trim() : '';
        const key = cleaned.toLocaleLowerCase();
        if (cleaned && !seen.has(key) && fonts.length < 64) {
            seen.add(key);
            fonts.push(cleaned);
        }
        return fonts;
    }, []);
}

const DEFAULT_PRESET = {
    mode_idx: 1,
    ws_chars: 30,
    max_words: 1,
    max_chars: 6,
    size: 0.07,
    x: 0.5,
    y: 0.5,
    text_case: 'Auto',
    rm_punct: false,
    p_all: false,
    p_comma: false,
    p_period: false,
    p_excl: false,
    p_quest: false,
    p_dash: false,
    fill_gaps: false,
    max_frames: 10
};

function settingsDir() {
    return path.join(app.getPath('appData'), 'subly');
}

function legacySettingsDir() {
    return path.join(app.getPath('appData'), 'com.subly');
}

function settingsFile() {
    return path.join(settingsDir(), 'settings.json');
}

function migrateLegacySettings() {
    const file = settingsFile();
    const legacy = path.join(legacySettingsDir(), 'settings.json');
    if (fs.existsSync(file) || !fs.existsSync(legacy)) return;
    try {
        fs.mkdirSync(settingsDir(), { recursive: true });
        fs.copyFileSync(legacy, file);
    } catch { /* best-effort */ }
}

// Read + parse settings.json. Returns null when the file is simply absent.
// A parse failure (corrupt / partial write) is preserved aside as a .corrupt-*
// copy so the user's presets aren't silently destroyed by the next save.
function readStored() {
    migrateLegacySettings();
    const file = settingsFile();
    if (!fs.existsSync(file)) return null;
    const txt = fs.readFileSync(file, 'utf-8');
    try {
        return JSON.parse(txt);
    } catch (e) {
        try { fs.renameSync(file, file + '.corrupt-' + Date.now()); } catch { /* */ }
        throw e;
    }
}

function loadCfg() {
    const cfg = {
        language: 'Auto',
        theme: 'dark',
        active_preset: 'Default',
        presets: { Default: { ...DEFAULT_PRESET } },
        emphasis_colors: [...DEFAULT_EMPHASIS_COLORS],
        favorite_fonts: [],
        left_panel_width: 400,
        window_width: null,
        window_height: null
    };
    let data = null;
    try { data = readStored(); } catch { data = null; }
    if (data) {
        cfg.language = data.language ?? 'Auto';
        cfg.theme = ['dark', 'light', 'auto'].includes(data.theme) ? data.theme : 'dark';
        if (data.presets && typeof data.presets === 'object' && Object.keys(data.presets).length) {
            const merged = {};
            for (const [name, p] of Object.entries(data.presets)) {
                merged[name] = { ...DEFAULT_PRESET, ...(p && typeof p === 'object' ? p : {}) };
            }
            cfg.presets = merged;
            cfg.active_preset = (data.active_preset && merged[data.active_preset])
                ? data.active_preset
                : Object.keys(merged)[0];
        }
        cfg.left_panel_width = data.left_panel_width ?? 400;
        cfg.emphasis_colors = normalizeColorList(data.emphasis_colors);
        cfg.favorite_fonts = normalizeFontList(data.favorite_fonts);
        cfg.window_width = data.window_width ?? null;
        cfg.window_height = data.window_height ?? null;

        if (cfg.left_panel_width == null && cfg.presets[cfg.active_preset]) {
            cfg.left_panel_width = cfg.presets[cfg.active_preset].left_panel_width ?? 400;
        }
        if (cfg.window_width == null && cfg.presets[cfg.active_preset]) {
            cfg.window_width = cfg.presets[cfg.active_preset].window_width ?? null;
        }
        if (cfg.window_height == null && cfg.presets[cfg.active_preset]) {
            cfg.window_height = cfg.presets[cfg.active_preset].window_height ?? null;
        }
    }
    return cfg;
}

function saveCfg(partial) {
    const current = loadCfg();
    const next = {
        language: partial.language ?? current.language,
        theme: ['dark', 'light', 'auto'].includes(partial.theme) ? partial.theme : current.theme,
        active_preset: partial.active_preset ?? current.active_preset,
        presets: partial.presets ?? current.presets,
        emphasis_colors: normalizeColorList(partial.emphasis_colors ?? current.emphasis_colors),
        favorite_fonts: normalizeFontList(partial.favorite_fonts ?? current.favorite_fonts),
        left_panel_width: partial.left_panel_width ?? current.left_panel_width,
        window_width: partial.window_width ?? current.window_width,
        window_height: partial.window_height ?? current.window_height
    };
    try {
        fs.mkdirSync(settingsDir(), { recursive: true });
        const file = settingsFile();
        const tmp = file + '.tmp';
        // Atomic: write to a temp file, back up the last good copy, then rename
        // over the target (rename replaces atomically on the same volume). A
        // crash mid-write can no longer truncate settings.json and lose presets.
        fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf-8');
        try { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak'); } catch { /* */ }
        fs.renameSync(tmp, file);
    } catch { /* best-effort */ }
    return next;
}

function setupConfigHandlers(ipcMain) {
    ipcMain.handle('config:get', () => loadCfg());
    ipcMain.handle('config:set', (_e, partial) => saveCfg(partial || {}));
}

module.exports = { setupConfigHandlers, DEFAULT_PRESET };
