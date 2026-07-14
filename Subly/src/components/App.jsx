import React, { useState, useEffect, useRef, useCallback } from 'react';
import SettingsModal from './SettingsModal';
import TitleBar from './TitleBar';
import ControlPanel from './ControlPanel';
import EditorPane from './EditorPane';
import { smartRegroupSubs, applyFormatting } from '../logic/subtitle';

export default function App() {
    const [status, setStatus] = useState('checking'); // checking | connected | disconnected
    const [timelineName, setTimelineName] = useState('');
    const [tab, setTab] = useState('template');
    const [showSettings, setShowSettings] = useState(false);
    const [theme, setTheme] = useState('dark');
    const [maximized, setMaximized] = useState(false);

    // config / presets
    const [cfg, setCfg] = useState(null);

    // template tab
    const [templates, setTemplates] = useState([]);
    const [template, setTemplate] = useState('');

    // transcription tab
    const [language, setLanguage] = useState('Auto');
    const [tracks, setTracks] = useState([]);
    const [track, setTrack] = useState(null);

    // deliver / editor - two separate states
    const [originalBlocks, setOriginalBlocks] = useState([]); // Transcription tab
    const [phrasesBlocks, setPhrasesBlocks] = useState([]); // Deliver tab
    const [phrasesMode, setPhrasesMode] = useState(null); // modeIdx used at last Create Phrases (controls Deliver editor UX)
    const [loadToken, setLoadToken] = useState(0); // bumped when blocks load from outside → resets editor undo history
    const [busy, setBusy] = useState('');
    const [errorModal, setErrorModal] = useState(null);

    // live-tunable settings (mirror preset, editable in Deliver)
    const [size, setSize] = useState(0.07);
    const [posX, setPosX] = useState(0.5);
    const [posY, setPosY] = useState(0.5);
    const [textCase, setTextCase] = useState('Auto');
    const [rmPunct, setRmPunct] = useState(false);
    const [punctSel, setPunctSel] = useState({ p_all: false, p_comma: false, p_period: false, p_excl: false, p_quest: false, p_dash: false });
    const [fillGaps, setFillGaps] = useState(false);
    const [maxFrames, setMaxFrames] = useState(10);

    // deliver editor sub-toolbar (Phrases: grouping/spelling, Emphasis: color/size/font)
    const [deliverSection, setDeliverSection] = useState('phrases');
    const [phrasesTool, setPhrasesTool] = useState('grouping');
    const [emph, setEmph] = useState({
        color: true,
        size: false,
        font: false,
        colorValue: '#6C5CE7',
        sizePreset: 20,
        sizeValue: 20,
        fontValue: '',
        fontStyleValue: 'Regular'
    });

    // subtitle mode
    const [modeIdx, setModeIdx] = useState(1);
    const [wsChars, setWsChars] = useState(30);
    const [maxWords, setMaxWords] = useState(1);
    const [maxChars, setMaxChars] = useState(6);

    const previewFrame = useRef(null);

    // drag-to-resize left panel
    const [leftPanelWidth, setLeftPanelWidth] = useState(400);
    const [isResizing, setIsResizing] = useState(false);
    const [isResizeHovered, setIsResizeHovered] = useState(false);

    const cfgRef = useRef(null);
    const leftPanelWidthRef = useRef(400);
    const originalBlocksRef = useRef([]);
    const phrasesBlocksRef = useRef([]);
    const currentBlocks = tab === 'deliver' ? phrasesBlocks : originalBlocks;

    const updateOriginalBlocks = useCallback((value) => {
        const next = typeof value === 'function' ? value(originalBlocksRef.current) : value;
        originalBlocksRef.current = next;
        setOriginalBlocks(next);
    }, []);

    const updatePhrasesBlocks = useCallback((value) => {
        const next = typeof value === 'function' ? value(phrasesBlocksRef.current) : value;
        phrasesBlocksRef.current = next;
        setPhrasesBlocks(next);
    }, []);

    useEffect(() => {
        cfgRef.current = cfg;
        leftPanelWidthRef.current = leftPanelWidth;
    }, [cfg, leftPanelWidth]);

    useEffect(() => { originalBlocksRef.current = originalBlocks; }, [originalBlocks]);
    useEffect(() => { phrasesBlocksRef.current = phrasesBlocks; }, [phrasesBlocks]);

    // ---- load config + connect on mount
    useEffect(() => {
        window.configAPI.get().then(applyConfig);
        checkConnection();
        const id = setInterval(checkConnection, 4000);
        refreshTemplates();
        refreshTracks();

        return () => {
            clearInterval(id);
            if (cfgRef.current) {
                window.windowAPI.getState?.().then(state => {
                    const next = {
                        ...cfgRef.current,
                        left_panel_width: leftPanelWidthRef.current,
                        window_width: state.width,
                        window_height: state.height
                    };
                    window.configAPI.set(next);
                }).catch(() => {});
            }
        };
    }, []);

    function applyTheme(t) {
        setTheme(t);
        document.documentElement.setAttribute('data-theme', t);
        if (t === 'auto') {
            const mq = window.matchMedia('(prefers-color-scheme: dark)');
            document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
        }
    }

    function handleThemeChange(t) {
        applyTheme(t);
        const next = { ...cfgRef.current, theme: t };
        setCfg(next);
        window.configAPI.set(next);
    }

    function applyConfig(loaded) {
        setCfg(loaded);
        const t = loaded.theme || 'dark';
        applyTheme(t);
        setLanguage(loaded.language || 'Auto');
        const p = loaded.presets[loaded.active_preset] || {};
        setModeIdx(p.mode_idx ?? 1);
        setWsChars(p.ws_chars ?? 30);
        setMaxWords(p.max_words ?? 1);
        setMaxChars(p.max_chars ?? 6);
        setSize(p.size ?? 0.07);
        setPosX(p.x ?? 0.5);
        setPosY(p.y ?? 0.5);
        setTextCase(p.text_case ?? 'Auto');
        setRmPunct(p.rm_punct ?? false);
        setPunctSel({
            p_all: p.p_all ?? false, p_comma: p.p_comma ?? false, p_period: p.p_period ?? false,
            p_excl: p.p_excl ?? false, p_quest: p.p_quest ?? false, p_dash: p.p_dash ?? false
        });
        setFillGaps(p.fill_gaps ?? false);
        setMaxFrames(p.max_frames ?? 10);
        setLeftPanelWidth(loaded.left_panel_width ?? 400);

        if (loaded.window_width && loaded.window_height) {
            window.windowAPI.resize?.({ width: loaded.window_width, height: loaded.window_height });
        }
    }

    // Keep auto theme in sync with OS preference
    useEffect(() => {
        if (theme !== 'auto') return;
        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const onChange = () => {
            document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
        };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, [theme]);

    // ---- lock the page zoom at 1.0 (native DPI). We deliberately do NOT zoom:
    // Electron renders at the monitor's DPI already, so the UI matches the PyQt
    // build physically. This also neutralizes any stray zoom and pairs with the
    // Ctrl +/-/0 shortcut block in main.js so the user can't shrink the UI.
    useEffect(() => {
        window.windowAPI.resetZoom?.();
    }, []);

    // ---- keep the titlebar Maximize/Restore button in sync with real state
    useEffect(() => {
        window.windowAPI.getState?.().then(s => setMaximized(!!(s && s.maximized))).catch(() => {});
        const off = window.windowAPI.onMaximizeChange?.((isMax) => setMaximized(isMax));
        return () => { if (off) off(); };
    }, []);

    async function checkConnection() {
        try {
            const res = await window.resolveAPI.connect();
            if (res && res.ok) {
                setStatus('connected');
                setTimelineName(res.name || '');
            } else {
                setStatus('disconnected');
            }
        } catch {
            setStatus('disconnected');
        }
    }

    function guard(res) {
        if (res && (res.error || res.ok === false)) {
            const title = res.title || res.error || res.message || 'Operation failed';
            const body = res.detail || res.message || res.error || 'DaVinci Resolve returned an error.';
            setErrorModal({ title, body });
            return false;
        }
        return true;
    }

    function getFmt() {
        let punctChars = '';
        if (rmPunct) {
            if (punctSel.p_all) punctChars = 'all';
            else {
                if (punctSel.p_comma) punctChars += ',';
                if (punctSel.p_period) punctChars += '.';
                if (punctSel.p_excl) punctChars += '!';
                if (punctSel.p_quest) punctChars += '?';
                if (punctSel.p_dash) punctChars += '-';
            }
        }
        return { text_case: textCase, remove_punct: rmPunct, punct_chars: punctChars };
    }

    // ---------------------------------------------------------------- resize
    const MIN_LEFT_PANEL = 280;
    const MIN_EDITOR_PANEL = 410;

    const getMaxLeftPanelWidth = useCallback(() => {
        const windowWidth = window.innerWidth;
        return Math.max(MIN_LEFT_PANEL, windowWidth - MIN_EDITOR_PANEL);
    }, []);

    const handleResizeStart = useCallback((event) => {
        event.preventDefault();
        setIsResizing(true);

        const startX = event.clientX;
        const startWidth = leftPanelWidth;

        const handlePointerMove = (moveEvent) => {
            const delta = moveEvent.clientX - startX;
            const nextWidth = startWidth + delta;
            setLeftPanelWidth(
                Math.min(getMaxLeftPanelWidth(), Math.max(MIN_LEFT_PANEL, nextWidth))
            );
        };

        const handlePointerUp = () => {
            setIsResizing(false);
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', handlePointerUp);
            window.removeEventListener('pointercancel', handlePointerUp);

            if (cfgRef.current) {
                window.windowAPI.getState?.().then(state => {
                    const next = {
                        ...cfgRef.current,
                        left_panel_width: leftPanelWidthRef.current,
                        window_width: state.width,
                        window_height: state.height
                    };
                    setCfg(next);
                    window.configAPI.set(next);
                });
            }
        };

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', handlePointerUp);
        window.addEventListener('pointercancel', handlePointerUp);
    }, [leftPanelWidth, getMaxLeftPanelWidth]);

    useEffect(() => {
        const handleResize = () => {
            const maxWidth = getMaxLeftPanelWidth();
            if (leftPanelWidth > maxWidth) {
                setLeftPanelWidth(maxWidth);
            }
        };

        const saveWindowSize = () => {
            if (!cfgRef.current) return;
            window.windowAPI.getState?.().then(state => {
                const next = {
                    ...cfgRef.current,
                    window_width: state.width,
                    window_height: state.height
                };
                setCfg(next);
                window.configAPI.set(next);
            });
        };

        window.addEventListener('resize', handleResize);
        const resizeTimer = setTimeout(saveWindowSize, 500);

        return () => {
            window.removeEventListener('resize', handleResize);
            clearTimeout(resizeTimer);
        };
    }, [leftPanelWidth, getMaxLeftPanelWidth]);

    // ---------------------------------------------------------------- actions
    // Every long action takes the single `busy` lock (any non-empty value blocks
    // all action buttons) and clears it in finally, so a rejected IPC call can
    // never strand the UI in a spinning/disabled state or let two Resolve/Lua
    // operations run against the same timeline at once.
    async function refreshTemplates() {
        if (busy) return;
        setBusy('templates');
        try {
            const res = await window.resolveAPI.getFusionTemplates();
            if (!guard(res)) return;
            setTemplates(res.templates || []);
            if (res.templates?.length && !template) setTemplate(res.templates[0]);
        } finally { setBusy(''); }
    }

    async function importBin() {
        if (busy) return;
        setBusy('templates');
        try {
            const res = await window.resolveAPI.importTemplateBin();
            if (!guard(res)) return;
            setTemplates(res.templates || []);
            if (res.templates?.length) setTemplate(res.templates[0]);
        } finally { setBusy(''); }
    }

    async function setPreviewCaption() {
        if (!template || busy) return;
        setBusy('preview');
        try {
            // Drop any existing preview first so successive clicks don't stack
            // a new video track + clip on the timeline. deletePreviewCaption
            // is a no-op when nothing matches (returns deleted: 0), so it's
            // safe to call unconditionally.
            await window.resolveAPI.deletePreviewCaption();
            const res = await window.resolveAPI.createPreviewCaption(template);
            if (!guard(res)) return;
            setTab('transcription');
        } finally { setBusy(''); }
    }

    async function refreshTracks() {
        const res = await window.resolveAPI.getSubtitleTracks();
        if (!guard(res)) return;
        setTracks(res.tracks || []);
        if (res.tracks?.length && track == null) setTrack(res.tracks[0].idx);
    }

    async function transcribe() {
        if (busy) return;
        setBusy('transcribe');
        try {
            // Force the finest granularity from DaVinci: 1 char per line so every
            // word lands in its own caption — the editor then regroups per the
            // preset mode. Gap between subtitles is fixed at 3 frames in the Lua bridge.
            const knownIndices = new Set(tracks.map(t => t.idx));
            const res = await window.resolveAPI.transcribeAudio(language, 1);
            if (!guard(res)) return;
            // Resolve materializes the new subtitle track asynchronously after
            // the API returns. Poll briefly to find it, then auto-select so the
            // user doesn't have to hit Refresh and pick the track manually.
            // Transient errors during polling are swallowed — only the final
            // transcribe result is surfaced via guard above.
            let pickedTrack = null;
            for (let attempt = 0; attempt < 6; attempt++) {
                await new Promise(r => setTimeout(r, 250));
                const tr = await window.resolveAPI.getSubtitleTracks();
                if (!tr || tr.error) continue;
                const newTracks = tr.tracks || [];
                setTracks(newTracks);
                const fresh = newTracks.find(t => !knownIndices.has(t.idx));
                if (fresh) { setTrack(fresh.idx); pickedTrack = fresh.idx; break; }
                if (newTracks.length && track == null) { setTrack(newTracks[0].idx); pickedTrack = newTracks[0].idx; break; }
            }
            // Auto-load subtitles from the newly-found track into the editor so
            // the user doesn't have to click "Pull from Resolve" manually.
            if (pickedTrack != null) {
                const sub = await window.resolveAPI.getSubtitlesFromTrack(pickedTrack);
                if (guard(sub)) {
            updateOriginalBlocks(sub.blocks || []);
            setLoadToken(t => t + 1);
                }
            }
        } finally { setBusy(''); }
    }

    async function pullFromResolve() {
        if (track == null || busy) return;
        setBusy('pull');
        try {
            const res = await window.resolveAPI.getSubtitlesFromTrack(track);
            if (!guard(res)) return;
            updateOriginalBlocks(res.blocks || []);
            setLoadToken(t => t + 1);
        } finally { setBusy(''); }
    }

    async function applyToResolve() {
        if (track == null || busy) return;
        setBusy('apply');
        try {
            // Run the live formatting (case + punctuation) over the raw edits
            // so Apply honours the same Deliver-tab settings as Create Captions.
            const sourceBlocks = originalBlocksRef.current;
            if (!sourceBlocks.length) {
                setErrorModal({ title: 'No subtitles to apply', body: 'Transcribe or pull subtitles from Resolve first.' });
                return;
            }
            const formatted = applyFormatting(sourceBlocks, getFmt());
            const res = await window.resolveAPI.applySubtitlesToTrack(track, formatted);
            guard(res);
        } finally { setBusy(''); }
    }

    async function createPhrases() {
        if (track == null || busy) return;
        setBusy('phrases');
        try {
            const sourceBlocks = originalBlocksRef.current;
            if (!sourceBlocks.length) {
                setErrorModal({ title: 'No subtitles to phrase', body: 'Transcribe or pull subtitles from Resolve first.' });
                return;
            }
            const grouped = smartRegroupSubs(sourceBlocks, modeIdx, maxWords, maxChars, { wsMaxChars: wsChars });
            updatePhrasesBlocks(grouped);
            setPhrasesMode(modeIdx);
            setLoadToken(t => t + 1);

            // Recreate the Preview Caption seeded with the LONGEST phrase, so the
            // user can dial size/position against a realistic line (ported from
            // the Python _on_create_phrases).
            if (grouped.length && template) {
                const longest = grouped.reduce((a, b) => (b.text.length > a.text.length ? b : a), grouped[0]);
                const longestText = applyFormatting([longest], getFmt())[0].text;
                await window.resolveAPI.deletePreviewCaption();
                const made = await window.resolveAPI.createPreviewCaption(template);
                if (made && made.ok) {
                    await window.resolveAPI.updatePreviewCaption({ size, x: posX, y: posY, text: longestText });
                }
            }
            setTab('deliver');
        } finally { setBusy(''); }
    }

    async function createCaptions() {
        const sourceBlocks = phrasesBlocksRef.current;
        if (!template || !sourceBlocks.length || busy) return;
        const formatted = applyFormatting(sourceBlocks, getFmt());
        setBusy('captions');
        try {
            const res = await window.resolveAPI.sendFusionTextTitles({
                blocks: formatted,
                templateName: template,
                sourceTrack: track,
                fillGaps,
                maxFrames: parseInt(maxFrames, 10) || 10,
                fallbackSize: size,
                fallbackX: posX,
                fallbackY: posY
            });
            guard(res);
        } finally { setBusy(''); }
    }

    // Live preview: push size/X/Y/text to the Preview Caption whenever any
    // tunable changes. Renderer-side throttling is one animation frame; the
    // main-process bridge handles latest-only coalescing and rate limiting.
    useEffect(() => {
        if (status !== 'connected' || !phrasesBlocks.length) return undefined;
        if (previewFrame.current != null) cancelAnimationFrame(previewFrame.current);
        previewFrame.current = requestAnimationFrame(() => {
            previewFrame.current = null;
            const longest = phrasesBlocks.reduce((a, b) => (b.text.length > a.text.length ? b : a), phrasesBlocks[0]);
            const text = applyFormatting([longest], getFmt())[0].text;
            window.resolveAPI.updatePreviewCaption({ size, x: posX, y: posY, text }).catch(() => {});
        });
        return () => {
            if (previewFrame.current != null) cancelAnimationFrame(previewFrame.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [size, posX, posY, textCase, rmPunct, punctSel, phrasesBlocks, status]);

    async function syncPlayhead(block) {
        await window.resolveAPI.setPlayhead(block.start);
    }

    useEffect(() => {
        if (!cfg || cfg.language === language) return;
        const next = { ...cfg, language };
        setCfg(next);
        window.configAPI.set(next);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [language]);

    return (
        <div className="app">
            <TitleBar
                status={status}
                timelineName={timelineName}
                maximized={maximized}
                onOpenSettings={() => setShowSettings(true)}
                theme={theme}
                onThemeChange={handleThemeChange}
            />

            <div className="body editor-open">
                <ControlPanel
                    tab={tab}
                    setTab={setTab}
                    isResizing={isResizing}
                    leftPanelWidth={leftPanelWidth}
                    templates={templates}
                    template={template}
                    setTemplate={setTemplate}
                    importBin={importBin}
                    refreshTemplates={refreshTemplates}
                    setPreviewCaption={setPreviewCaption}
                    language={language}
                    setLanguage={setLanguage}
                    tracks={tracks}
                    track={track}
                    setTrack={setTrack}
                    transcribe={transcribe}
                    refreshTracks={refreshTracks}
                    applyToResolve={applyToResolve}
                    pullFromResolve={pullFromResolve}
                    modeIdx={modeIdx}
                    setModeIdx={setModeIdx}
                    wsChars={wsChars}
                    setWsChars={setWsChars}
                    maxWords={maxWords}
                    setMaxWords={setMaxWords}
                    maxChars={maxChars}
                    setMaxChars={setMaxChars}
                    createPhrases={createPhrases}
                    size={size}
                    setSize={setSize}
                    posX={posX}
                    setPosX={setPosX}
                    posY={posY}
                    setPosY={setPosY}
                    textCase={textCase}
                    setTextCase={setTextCase}
                    rmPunct={rmPunct}
                    setRmPunct={setRmPunct}
                    punctSel={punctSel}
                    setPunctSel={setPunctSel}
                    fillGaps={fillGaps}
                    setFillGaps={setFillGaps}
                    maxFrames={maxFrames}
                    setMaxFrames={setMaxFrames}
                    createCaptions={createCaptions}
                    busy={busy}
                    hasOriginalBlocks={originalBlocks.length > 0}
                    hasPhrasesBlocks={phrasesBlocks.length > 0}
                />

                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label="Resize left panel"
                    className={'resize-divider' + (isResizeHovered || isResizing ? ' active' : '')}
                    onPointerDown={handleResizeStart}
                    onPointerEnter={() => setIsResizeHovered(true)}
                    onPointerLeave={() => setIsResizeHovered(false)}
                />

                <EditorPane
                    tab={tab}
                    currentBlocks={currentBlocks}
                    setPhrasesBlocks={updatePhrasesBlocks}
                    setOriginalBlocks={updateOriginalBlocks}
                    syncPlayhead={syncPlayhead}
                    loadToken={loadToken}
                    phrasesMode={phrasesMode}
                    deliverSection={deliverSection}
                    setDeliverSection={setDeliverSection}
                    phrasesTool={phrasesTool}
                    setPhrasesTool={setPhrasesTool}
                    emph={emph}
                    setEmph={setEmph}
                />
            </div>

            {(busy === 'transcribe' || busy === 'captions') && (
                <div className="busy-overlay">
                    <div className="busy-spinner">
                        <span /><span /><span />
                        <div className="busy-core" />
                    </div>
                    <div className="busy-label-wrap">
                        <div className="busy-label">
                            {busy === 'transcribe' ? 'Transcribing audio…' : 'Creating captions…'}
                        </div>
                    </div>
                </div>
            )}

            {showSettings && cfg && (
                <SettingsModal
                    cfg={cfg}
                    setCfg={setCfg}
                    onClose={() => setShowSettings(false)}
                    onApplyConfig={applyConfig}
                />
            )}

            {errorModal && (
                <div className="modal-overlay" onClick={() => setErrorModal(null)}>
                    <div className="modal error-modal" onClick={e => e.stopPropagation()}>
                        <h2>{errorModal.title}</h2>
                        <p className="error-modal-body">{errorModal.body}</p>
                        <button className="btn-primary" onClick={() => setErrorModal(null)}>OK</button>
                    </div>
                </div>
            )}
        </div>
    );
}
