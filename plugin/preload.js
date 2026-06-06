// Subly — Preload Bridge
// Exposes a safe API surface to the renderer via contextBridge.
// Each method maps 1:1 to an ipcMain.handle channel in main.js / ipc modules.

const { contextBridge, ipcRenderer, webFrame } = require('electron/renderer');

contextBridge.exposeInMainWorld('resolveAPI', {
    // Connection / status
    connect: () => ipcRenderer.invoke('resolve:connect'),
    ping: () => ipcRenderer.invoke('resolve:ping'),

    // Templates
    getFusionTemplates: () => ipcRenderer.invoke('resolve:getFusionTemplates'),
    importTemplateBin: () => ipcRenderer.invoke('resolve:importTemplateBin'),

    // Subtitle tracks
    getSubtitleTracks: () => ipcRenderer.invoke('resolve:getSubtitleTracks'),
    getSubtitlesFromTrack: (trackIndex) => ipcRenderer.invoke('resolve:getSubtitlesFromTrack', trackIndex),
    applySubtitlesToTrack: (trackIndex, blocks) => ipcRenderer.invoke('resolve:applySubtitlesToTrack', { trackIndex, blocks }),

    // Transcription
    transcribeAudio: (language, charsPerLine) => ipcRenderer.invoke('resolve:transcribeAudio', { language, charsPerLine }),

    // Preview caption
    createPreviewCaption: (templateName) => ipcRenderer.invoke('resolve:createPreviewCaption', templateName),
    updatePreviewCaption: (payload) => ipcRenderer.invoke('resolve:updatePreviewCaption', payload),
    deletePreviewCaption: () => ipcRenderer.invoke('resolve:deletePreviewCaption'),

    // Titles
    sendFusionTextTitles: (payload) => ipcRenderer.invoke('resolve:sendFusionTextTitles', payload),

    // Playhead
    setPlayhead: (tc) => ipcRenderer.invoke('resolve:setPlayhead', tc),

    // Diagnostics
    diagnoseFusion: () => ipcRenderer.invoke('resolve:diagnoseFusion'),

    // Timeline info
    getTimelineSettings: () => ipcRenderer.invoke('resolve:getTimelineSettings')
});

contextBridge.exposeInMainWorld('configAPI', {
    get: () => ipcRenderer.invoke('config:get'),
    set: (partial) => ipcRenderer.invoke('config:set', partial)
});

contextBridge.exposeInMainWorld('windowAPI', {
    platform: process.platform,
    resize: ({ width, height }) => ipcRenderer.invoke('window:resize', { width, height }),
    setMinSize: ({ width, height }) => ipcRenderer.invoke('window:setMinSize', { width, height }),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggleMaximize'),
    close: () => ipcRenderer.invoke('window:close'),
    getState: () => ipcRenderer.invoke('window:getState'),
    // Pin the page zoom to native DPI (1.0) and clamp the zoom range to [1,1] so
    // pinch/Ctrl-wheel can't change it. We render at the monitor's DPI like the
    // PyQt build — no artificial zoom. Ctrl +/-/0 are blocked in main.js too.
    resetZoom: () => {
        try {
            webFrame.setZoomFactor(1);
            webFrame.setVisualZoomLevelLimits(1, 1);
        } catch { /* noop */ }
    },
    // Subscribe to maximize/unmaximize so the titlebar button can toggle icons.
    onMaximizeChange: (cb) => {
        const fn = (_e, isMax) => cb(isMax);
        ipcRenderer.on('window:maximized', fn);
        return () => ipcRenderer.removeListener('window:maximized', fn);
    },
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openPath: (p) => ipcRenderer.invoke('shell:openPath', p)
});
