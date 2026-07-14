// Subly — Resolve IPC layer
// Ports the former Lua HTTP bridge (subly_resolve_core.lua) to direct
// WorkflowIntegration.node calls. The `resolve` object exposes the same
// DaVinci Resolve scripting API the Lua code used, so the call sequences match.

const path = require('path');
const luaBridge = require('./luaBridge');

const WorkflowIntegration = require('../WorkflowIntegration.node');

const PLUGIN_ID = 'subly';
const PREVIEW_NAME = 'Preview Caption';
const TEMPLATE_BIN = path.join(__dirname, '..', 'data', 'Subly.drb');

let resolveObj = null;

// ---------------------------------------------------------------- bootstrap

async function initResolve() {
    const ok = await WorkflowIntegration.Initialize(PLUGIN_ID);
    if (!ok) return null;
    return await WorkflowIntegration.GetResolve();
}

async function getResolve() {
    if (!resolveObj) resolveObj = await initResolve();
    return resolveObj;
}

async function cleanupResolveInterface() {
    try { await luaBridge.killServer(); } catch { /* best-effort */ }
    try { WorkflowIntegration.CleanUp(); } catch { /* best-effort */ }
    resolveObj = null;
    return true;
}

// Resolve the {resolve, pm, project, timeline} context, mirroring get_context().
async function getContext(requireTimeline = true) {
    const resolve = await getResolve();
    if (!resolve) return { error: 'Resolve not available', detail: 'Failed to initialize the Resolve interface' };
    const pm = await resolve.GetProjectManager();
    if (!pm) return { error: 'No project manager', detail: 'Could not get the Project Manager' };
    const project = await pm.GetCurrentProject();
    if (!project) return { error: 'No project open', detail: 'Open a project in DaVinci Resolve' };
    const timeline = await project.GetCurrentTimeline();
    if (requireTimeline && !timeline) return { error: 'No timeline open', detail: 'Open a timeline in DaVinci Resolve' };
    return { resolve, pm, project, timeline };
}

// ---------------------------------------------------------------- helpers

async function getFps(timeline) {
    try {
        const v = await timeline.GetSetting('timelineFrameRate');
        const n = parseFloat(v);
        if (!Number.isNaN(n) && n > 0) return n;
    } catch { /* fall through */ }
    return 25.0;
}

function frameToTc(frames, fps) {
    frames = Number(frames) || 0;
    fps = Number(fps) || 25;
    const totalSeconds = frames / fps;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = Math.floor(totalSeconds % 60);
    const ms = Math.floor((totalSeconds - Math.floor(totalSeconds)) * 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

function tcToFrame(tc, fps) {
    if (typeof tc !== 'string') return 0;
    const match = tc.match(/^(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!match) return 0;
    const [, h, m, s, ms] = match;
    return Math.floor(((Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000.0) * fps) + 0.5);
}

// Resolve timecode HH:MM:SS:FF -> frame. Accept the drop-frame ";" separator
// before the frame field too, else GetCurrentTimecode() on a 29.97/59.94
// timeline fails to match and the playhead/preview lands at frame 0.
function timelineTcToFrame(tc, fps) {
    if (typeof tc !== 'string') return 0;
    const match = tc.match(/^(\d+):(\d+):(\d+)([:;])(\d+)/);
    if (!match) return 0;
    const [, h, m, s, sep, f] = match;
    const rate = Math.max(1, Math.round(Number(fps) || 25));
    const hh = Number(h), mm = Number(m), ss = Number(s), ff = Number(f);
    if (sep === ';' && (rate === 30 || rate === 60)) {
        const drop = rate === 60 ? 4 : 2;
        const totalMinutes = hh * 60 + mm;
        return ((hh * 3600 + mm * 60 + ss) * rate + ff) - drop * (totalMinutes - Math.floor(totalMinutes / 10));
    }
    return (hh * 3600 + mm * 60 + ss) * rate + ff;
}

// frame -> Resolve timecode HH:MM:SS:FF. Use the nominal integer rate for the
// frame field so fractional rates (29.97/23.976/59.94) don't drift the FF part.
function frameToResolveTc(frames, fps, dropFrame = false) {
    frames = Math.round(Number(frames) || 0);
    const rate = Math.max(1, Math.round(Number(fps) || 25));
    if (dropFrame && (rate === 30 || rate === 60)) {
        const drop = rate === 60 ? 4 : 2;
        const framesPer10Minutes = rate * 60 * 10 - drop * 9;
        const framesPerMinute = rate * 60 - drop;
        const tenMinuteChunks = Math.floor(frames / framesPer10Minutes);
        const remainder = frames % framesPer10Minutes;
        frames += drop * 9 * tenMinuteChunks;
        if (remainder > drop) frames += drop * Math.floor((remainder - drop) / framesPerMinute);
        const f = frames % rate;
        const secs = Math.floor(frames / rate);
        return `${pad(Math.floor(secs / 3600))}:${pad(Math.floor(secs / 60) % 60)}:${pad(secs % 60)};${pad(f)}`;
    }
    const f = frames % rate;
    const secs = Math.floor(frames / rate);
    const s = secs % 60;
    const m = Math.floor(secs / 60) % 60;
    const h = Math.floor(secs / 3600);
    return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
}

function pad(n, width = 2) {
    return String(Math.floor(Math.abs(n))).padStart(width, '0');
}


async function clipName(clip) {
    try { const n = await clip.GetName(); if (n) return n; } catch { /* */ }
    try {
        const props = await clip.GetClipProperty();
        if (props) return props['Clip Name'] || props['Name'] || '';
    } catch { /* */ }
    return '';
}

// ---------------------------------------------------------------- templates

async function scanTemplates(bin, out) {
    if (!bin) return;
    let clips = [];
    try { clips = (await bin.GetClipList()) || []; } catch { clips = []; }
    for (const clip of clips) {
        try {
            const props = (await clip.GetClipProperty()) || {};
            const type = String(props['Type'] || props['Clip Type'] || '');
            // Match Text+/Fusion Title templates, but EXCLUDE saved "Fusion
            // Composition" clips (the leftover bug — they also contain "Fusion").
            const matches = type.includes('Title') || type.includes('Text+') || type.includes('Fusion') || type.includes('Титры');
            if (matches && !type.includes('Composition')) {
                out.add(await clipName(clip));
            }
        } catch { /* skip clip */ }
    }
    let subs = [];
    try { subs = (await bin.GetSubFolderList()) || []; } catch { subs = []; }
    for (const sub of subs) await scanTemplates(sub, out);
}

async function findTemplateClip(bin, name) {
    if (!bin) return null;
    let clips = [];
    try { clips = (await bin.GetClipList()) || []; } catch { clips = []; }
    for (const clip of clips) {
        if ((await clipName(clip)) === name) return clip;
    }
    let subs = [];
    try { subs = (await bin.GetSubFolderList()) || []; } catch { subs = []; }
    for (const sub of subs) {
        const found = await findTemplateClip(sub, name);
        if (found) return found;
    }
    return null;
}

async function getFusionTemplates() {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const mp = await ctx.project.GetMediaPool();
    const root = await mp.GetRootFolder();
    const out = new Set();
    await scanTemplates(root, out);
    return { templates: [...out].sort((a, b) => a.localeCompare(b)) };
}

// Import the bundled Subly.drb so its Text+ templates appear in the Media Pool.
async function importTemplateBin() {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const mp = await ctx.project.GetMediaPool();
    try {
        const ok = await mp.ImportFolderFromFile(TEMPLATE_BIN);
        if (!ok) {
            const storage = await ctx.resolve.GetMediaStorage();
            if (storage) await storage.AddItemListToMediaPool([TEMPLATE_BIN]);
        }
    } catch (e) {
        return { error: 'Failed to import template bin', detail: String(e) };
    }
    await new Promise(r => setTimeout(r, 500));
    return getFusionTemplates();
}

// ---------------------------------------------------------------- connect

async function connect() {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    let name = '<unknown timeline>';
    try { name = await ctx.timeline.GetName(); } catch { /* */ }
    return { ok: true, name };
}

async function ping() {
    const resolve = await getResolve();
    return resolve ? { ok: true, message: 'Pong' } : { error: 'Resolve not available' };
}

async function getTimelineSettings() {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const t = ctx.timeline;
    const get = async (k) => { try { return await t.GetSetting(k); } catch { return null; } };
    const [name, fps, width, height] = await Promise.all([
        t.GetName(),
        getFps(t),
        get('timelineResolutionWidth'),
        get('timelineResolutionHeight')
    ]);
    return { name, fps, width: parseInt(width, 10) || null, height: parseInt(height, 10) || null };
}

// ---------------------------------------------------------------- subtitle tracks

async function getSubtitleTracks() {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const count = (await ctx.timeline.GetTrackCount('subtitle')) || 0;
    const tracks = [];
    for (let i = 1; i <= count; i++) {
        let n;
        try { n = await ctx.timeline.GetTrackName('subtitle', i); } catch { n = null; }
        tracks.push({ idx: i, name: n || `Subtitle ${i}` });
    }
    return { tracks };
}

async function getSubtitlesFromTrack(trackIndex) {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const fps = await getFps(ctx.timeline);
    const items = (await ctx.timeline.GetItemListInTrack('subtitle', Number(trackIndex) || 1)) || [];
    const blocks = [];
    let idx = 1;
    for (const item of items) {
        let startFrame, endFrame;
        try {
            startFrame = await item.GetStart();
            endFrame = await item.GetEnd();
        } catch { continue; }
        if (startFrame == null || endFrame == null) continue;
        let text = '';
        try { text = (await item.GetName()) || ''; } catch { /* */ }
        blocks.push({
            idx,
            startFrame,
            endFrame,
            start: frameToTc(startFrame, fps),
            end: frameToTc(endFrame, fps),
            text
        });
        idx++;
    }
    return { blocks };
}

// Apply to Resolve: routed through the Lua bridge. The Lua side exports edited
// blocks as an SRT, imports it into the "Subly_sync" media-pool bin, and parks
// the playhead on the first caption. It does not add/delete timeline tracks.
async function applySubtitlesToTrack({ trackIndex, blocks }) {
    const res = await luaBridge.call('ApplySubtitlesToTrack', {
        trackIndex: Number(trackIndex) || 1,
        blocks: blocks || []
    }, { timeout: 120000, keepWarm: false });
    if (res && res.error) return res;
    if (res && res.ok === false) {
        return { error: res.message || 'Apply failed', detail: res.detail || '' };
    }
    return {
        ok: true,
        message: (res && res.message) || 'SRT imported into Subly_sync',
        imported: res && res.imported,
        srtPath: res && res.srtPath
    };
}

// ---------------------------------------------------------------- transcription

// Routed through the Lua bridge. CreateSubtitlesFromAudio needs the real
// resolve.SUBTITLE_*/AUTO_CAPTION_* enum values as dictionary keys/values;
// WorkflowIntegration.node does not expose those constants, so the node path
// fell back to string keys that Resolve rejects ("Invalid dictionary key").
// Inside fuscript the constants are available. One-shot: fuscript dies after.
async function transcribeAudio({ language, charsPerLine }) {
    const res = await luaBridge.call('TranscribeAudio', {
        language: language || 'Auto',
        charsPerLine: Math.max(1, Math.min(Number(charsPerLine) || 42, 60))
    }, { timeout: 300000, keepWarm: false });
    if (res && res.error) return res;
    return { ok: true };
}

// ---------------------------------------------------------------- preview caption

async function deletePreviewCaptionImpl(timeline) {
    const clips = [];
    const count = (await timeline.GetTrackCount('video')) || 0;
    for (let i = 1; i <= count; i++) {
        const items = (await timeline.GetItemListInTrack('video', i)) || [];
        for (const item of items) {
            if ((await item.GetName()) === PREVIEW_NAME) clips.push(item);
        }
    }
    if (clips.length > 0) await timeline.DeleteClips(clips);
    return clips.length;
}

async function createPreviewCaption(templateName) {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    try { await ctx.resolve.OpenPage('edit'); } catch { /* */ }
    const timeline = ctx.timeline;
    const mp = await ctx.project.GetMediaPool();
    const fps = await getFps(timeline);
    const root = await mp.GetRootFolder();
    const templateClip = await findTemplateClip(root, templateName);
    if (!templateClip) return { error: 'Template not found', detail: `Template '${templateName}' not found in Media Pool` };

    // FPS mismatch check
    try {
        const props = await templateClip.GetClipProperty();
        if (props) {
            const tfps = parseFloat(props['Clip Frame Rate'] || props['FPS']);
            if (!Number.isNaN(tfps) && Math.abs(tfps - fps) > 0.01) {
                return {
                    error: 'fps_mismatch',
                    title: 'FPS Mismatch',
                    detail: `Timeline: ${fps} fps — Template: ${tfps} fps\n\nDrag the template you want onto the timeline, then drag it back to the media pool.`
                };
            }
        }
    } catch { /* */ }

    if (!(await timeline.AddTrack('video'))) return { error: 'Failed to create a new video track', detail: 'Make sure the Edit page is open' };
    const textTrack = await timeline.GetTrackCount('video');
    const currentTc = await timeline.GetCurrentTimecode();
    const currentFrame = timelineTcToFrame(currentTc, fps);
    const dur = Math.max(Math.floor(fps), 1);

    const added = await mp.AppendToTimeline([{
        mediaPoolItem: templateClip,
        startFrame: 0,
        endFrame: dur,
        trackIndex: textTrack,
        recordFrame: currentFrame
    }]);
    if (!added || !added[0]) {
        try { await timeline.DeleteTrack('video', textTrack); } catch { /* */ }
        return { error: 'Failed to place template on the timeline', detail: 'AppendToTimeline returned no item' };
    }

    const item = added[0];
    try { await item.SetClipColor('Orange'); } catch { /* */ }
    try { await item.SetName(PREVIEW_NAME); } catch { /* */ }
    try { await item.SetClipProperty('Name', PREVIEW_NAME); } catch { /* */ }
    try { await timeline.SetCurrentTimecode(frameToResolveTc(currentFrame + Math.floor(dur / 2), fps, String(currentTc).includes(';'))); } catch { /* */ }
    return { ok: true };
}

// Realtime preview: routed through the Lua bridge (tool:SetInput on the Text+
// is not reliable via WorkflowIntegration.node). This uses the bridge's latest-
// only preview pool, so dragging sliders drops stale intermediate values instead
// of replaying a laggy queue.
async function updatePreviewCaption({ size, x, y, text }) {
    const payload = { size: Number(size) || 0.07, x: Number(x) || 0.5, y: Number(y) || 0.5 };
    if (text != null) payload.text = String(text);
    const res = await luaBridge.callPreviewLatest('UpdatePreviewCaption', payload, { timeout: 5000 });
    if (res && res.ok) return { ok: true, found: true };
    const msg = String((res && (res.error || res.detail)) || '');
    if (/not found/i.test(msg)) return { ok: false, found: false };
    return { ok: false, found: true, error: res && res.error, detail: res && res.detail };
}

async function deletePreviewCaption() {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const deleted = await deletePreviewCaptionImpl(ctx.timeline);
    return { ok: true, deleted };
}

// ---------------------------------------------------------------- send titles

// Create Captions: routed entirely through the Lua bridge. The Lua side places
// the templates, sets each clip's Text+/AutoSubs text (with per-word timing
// animation when blocks carry a `words` array), disables the source track and
// cleans up empty tracks — none of which WorkflowIntegration.node can do
// reliably. One-shot: fuscript is killed as soon as this returns.
async function sendFusionTextTitles({ blocks, templateName, sourceTrack, fillGaps, maxFrames, fallbackSize, fallbackX, fallbackY }) {
    return luaBridge.call('SendFusionTextTitles', {
        blocks: blocks || [],
        templateName,
        sourceTrack: sourceTrack != null ? sourceTrack : null,
        fillGaps: !!fillGaps,
        maxFrames: Number(maxFrames) || 100,
        fallbackSize: Number(fallbackSize) || 0.07,
        fallbackX: Number(fallbackX) || 0.5,
        fallbackY: Number(fallbackY) || 0.5
    }, { timeout: 300000, keepWarm: false });
}

// ---------------------------------------------------------------- playhead

async function setPlayhead(tc) {
    const ctx = await getContext(true);
    if (ctx.error) return ctx;
    const fps = await getFps(ctx.timeline);
    const frames = tcToFrame(tc, fps);
    let currentTc = '';
    try { currentTc = await ctx.timeline.GetCurrentTimecode(); } catch { /* */ }
    try { await ctx.timeline.SetCurrentTimecode(frameToResolveTc(frames, fps, String(currentTc).includes(';'))); } catch (e) { return { error: 'Failed to set playhead', detail: String(e) }; }
    return { ok: true };
}

// ---------------------------------------------------------------- diagnostics

// Probes the Lua bridge: is fuscript.exe found, does the HTTP server come up,
// and does Connect succeed. Returns a human-readable report.
async function diagnoseFusion() {
    return luaBridge.diagnose();
}

// ---------------------------------------------------------------- registration

function setupResolveHandlers(ipcMain) {
    ipcMain.handle('resolve:connect', () => connect());
    ipcMain.handle('resolve:ping', () => ping());
    ipcMain.handle('resolve:getTimelineSettings', () => getTimelineSettings());
    ipcMain.handle('resolve:getFusionTemplates', () => getFusionTemplates());
    ipcMain.handle('resolve:importTemplateBin', () => importTemplateBin());
    ipcMain.handle('resolve:getSubtitleTracks', () => getSubtitleTracks());
    ipcMain.handle('resolve:getSubtitlesFromTrack', (_e, trackIndex) => getSubtitlesFromTrack(trackIndex));
    ipcMain.handle('resolve:applySubtitlesToTrack', (_e, payload) => applySubtitlesToTrack(payload));
    ipcMain.handle('resolve:transcribeAudio', (_e, payload) => transcribeAudio(payload));
    ipcMain.handle('resolve:createPreviewCaption', (_e, name) => createPreviewCaption(name));
    ipcMain.handle('resolve:updatePreviewCaption', (_e, payload) => updatePreviewCaption(payload));
    ipcMain.handle('resolve:deletePreviewCaption', () => deletePreviewCaption());
    ipcMain.handle('resolve:sendFusionTextTitles', (_e, payload) => sendFusionTextTitles(payload));
    ipcMain.handle('resolve:setPlayhead', (_e, tc) => setPlayhead(tc));
    ipcMain.handle('resolve:diagnoseFusion', () => diagnoseFusion());
}

module.exports = { setupResolveHandlers, cleanupResolveInterface, killLuaBridge: luaBridge.killServer };
