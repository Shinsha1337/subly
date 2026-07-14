import React, { useLayoutEffect, useRef, useState } from 'react';
import { Close } from './Icons';
import { Slider, Toggle, Chips, MultiChips, Select } from './Controls';
import { wordsToChars } from '../logic/subtitle';

const DEFAULT_PRESET = {
    mode_idx: 1, ws_chars: 30, max_words: 1, max_chars: 6,
    size: 0.07, x: 0.5, y: 0.5, text_case: 'Auto', rm_punct: false,
    p_all: false, p_comma: false, p_period: false, p_excl: false, p_quest: false, p_dash: false,
    fill_gaps: false, max_frames: 10
};

const PUNCT_OPTS = [
    { key: 'p_all', label: 'All' },
    { key: 'p_comma', label: ',' },
    { key: 'p_period', label: '.' },
    { key: 'p_excl', label: '!' },
    { key: 'p_quest', label: '?' },
    { key: 'p_dash', label: '-' }
];

export default function SettingsModal({ cfg, setCfg, onClose, onApplyConfig }) {
    const [activePreset, setActivePreset] = useState(cfg.active_preset);
    const [data, setData] = useState({ ...DEFAULT_PRESET, ...(cfg.presets[cfg.active_preset] || {}) });
    const [renaming, setRenaming] = useState(false);
    const [renameVal, setRenameVal] = useState('');
    const [adding, setAdding] = useState(false);
    const [newName, setNewName] = useState('');
    const [isClosing, setIsClosing] = useState(false);
    const [hasScroll, setHasScroll] = useState(false);
    const scrollRef = useRef(null);
    const presetNames = Object.keys(cfg.presets);

    const set = (k, v) => setData(prev => ({ ...prev, [k]: v }));

    function persist(next) {
        setCfg(next);
        window.configAPI.set(next);
    }

    function handleClose() {
        setIsClosing(true);
        setTimeout(onClose, 150);
    }

    function loadPreset(name) {
        setActivePreset(name);
        setData({ ...DEFAULT_PRESET, ...(cfg.presets[name] || {}) });
    }

    function switchPreset(name) {
        loadPreset(name);
        const next = { ...cfg, active_preset: name };
        persist(next);
        onApplyConfig(next);
    }

    function createPreset() {
        const name = newName.trim();
        setAdding(false);
        setNewName('');
        if (!name || cfg.presets[name]) return;
        const next = {
            ...cfg,
            active_preset: name,
            presets: { ...cfg.presets, [name]: { ...DEFAULT_PRESET } }
        };
        setActivePreset(name);
        setData({ ...DEFAULT_PRESET });
        persist(next);
        onApplyConfig(next);
    }

    function commitRename() {
        const name = renameVal.trim();
        setRenaming(false);
        if (!name || name === activePreset || cfg.presets[name]) return;
        const presets = { ...cfg.presets };
        presets[name] = presets[activePreset];
        delete presets[activePreset];
        const next = { ...cfg, active_preset: name, presets };
        setActivePreset(name);
        persist(next);
        onApplyConfig(next);
    }

    function deletePreset() {
        if (presetNames.length <= 1) return;
        const presets = { ...cfg.presets };
        delete presets[activePreset];
        const nextName = Object.keys(presets)[0];
        const next = { ...cfg, active_preset: nextName, presets };
        loadPreset(nextName);
        persist(next);
        onApplyConfig(next);
    }

    function saveSettings() {
        const clean = { ...data, max_frames: parseInt(data.max_frames, 10) || 10 };
        const next = {
            ...cfg,
            active_preset: activePreset,
            presets: { ...cfg.presets, [activePreset]: clean }
        };
        persist(next);
        onApplyConfig(next);
        handleClose();
    }

    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return undefined;
        const update = () => setHasScroll(el.scrollHeight > el.clientHeight + 1);
        update();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        if (ro) ro.observe(el);
        window.addEventListener('resize', update);
        return () => {
            if (ro) ro.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [data, renaming, adding, activePreset]);

    return (
        <div className={`modal-overlay${isClosing ? ' closing' : ''}`} onClick={handleClose}>
            <div className={`modal${isClosing ? ' closing' : ''}`} onClick={(e) => e.stopPropagation()}>
                <button className="settings-close-btn" onClick={handleClose}><Close /></button>

                <div className={'modal-scroll' + (hasScroll ? ' has-scroll' : '')} ref={scrollRef}>
                <div className="preset-frame">
                    {renaming ? (
                        <div className="inline-row">
                            <span className="preset-label">Preset:</span>
                            <input
                                className="txt grow" autoFocus value={renameVal}
                                onChange={(e) => setRenameVal(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(false); }}
                            />
                            <button className="btn-gray" onClick={commitRename}>Save</button>
                            <button className="btn-gray" onClick={() => setRenaming(false)}>Cancel</button>
                        </div>
                    ) : adding ? (
                        <div className="inline-row">
                            <span className="preset-label">New:</span>
                            <input
                                className="txt grow" autoFocus placeholder="Preset name…" value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') createPreset(); if (e.key === 'Escape') { setAdding(false); setNewName(''); } }}
                            />
                            <button className="btn-gray" disabled={!newName.trim() || !!cfg.presets[newName.trim()]} onClick={createPreset}>Add</button>
                            <button className="btn-gray" onClick={() => { setAdding(false); setNewName(''); }}>Cancel</button>
                        </div>
                    ) : (
                        <div className="inline-row">
                            <span className="preset-label">Preset:</span>
                            <Select
                                className="grow"
                                value={activePreset}
                                options={presetNames.map(n => ({ value: n, label: n }))}
                                onChange={(v) => switchPreset(v)}
                            />
                            <button className="btn-gray" onClick={() => setAdding(true)}>New</button>
                            <button className="btn-gray" onClick={() => { setRenameVal(activePreset); setRenaming(true); }}>Rename</button>
                            <button className="btn-gray" disabled={presetNames.length <= 1} onClick={deletePreset}>Delete</button>
                        </div>
                    )}

                    <div className="inline-row">
                        <span className="preset-label">Subtitle Mode:</span>
                        <Select
                            className="grow"
                            value={data.mode_idx}
                            options={[
                                { value: 1, label: 'Whole Sentence' },
                                { value: 0, label: 'Single Word' },
                                { value: 2, label: 'Custom' }
                            ]}
                            onChange={(v) => set('mode_idx', Number(v))}
                        />
                    </div>
                    {data.mode_idx === 1 && (
                        <Slider label="Max characters per line" value={data.ws_chars} min={4} max={60} step={1} decimals={0} onChange={(v) => set('ws_chars', v)} />
                    )}
                    {data.mode_idx === 2 && (
                        <>
                            <Slider label="Max Word Amount" value={data.max_words} min={1} max={8} step={1} decimals={0}
                                onChange={(v) => setData(prev => ({ ...prev, max_words: v, max_chars: wordsToChars(v) }))} />
                            <Slider label="Max Character Amount" value={data.max_chars} min={6} max={50} step={1} decimals={0} onChange={(v) => set('max_chars', v)} />
                        </>
                    )}

                    <hr className="divider" />

                    <Slider label="Text Size:" strong value={data.size} min={0.001} max={0.3} step={0.001} decimals={3} onChange={(v) => set('size', v)} />
                    <Slider label="X:" strong value={data.x} min={0} max={1} step={0.001} decimals={3} snap={0.5} onChange={(v) => set('x', v)} />
                    <Slider label="Y:" strong value={data.y} min={0} max={1} step={0.001} decimals={3} snap={0.5} onChange={(v) => set('y', v)} />

                    <hr className="divider" />

                    <div className="inline-row">
                        <span className="preset-label">Text Case:</span>
                        <Chips
                            options={[{ value: 'Auto', label: 'Aa' }, { value: 'lowercase', label: 'aa' }, { value: 'UPPERCASE', label: 'AA' }]}
                            value={data.text_case}
                            onChange={(v) => set('text_case', v)}
                        />
                    </div>

                    <hr className="divider" />

                    <div className="inline-row">
                        <span className="preset-label">Remove Punctuation:</span>
                        <Toggle value={data.rm_punct} onChange={(v) => set('rm_punct', v)} />
                        {data.rm_punct && (
                            <MultiChips
                                options={PUNCT_OPTS}
                                values={data}
                                onToggle={(key) => set(key, !data[key])}
                            />
                        )}
                    </div>

                    <hr className="divider" />

                    <div className="inline-row">
                        <span className="preset-label" style={{ minWidth: 'auto' }}>Fill Gaps:</span>
                        <Toggle value={data.fill_gaps} onChange={(v) => set('fill_gaps', v)} />
                        {data.fill_gaps && (
                            <>
                                <span className="preset-label" style={{ minWidth: 'auto' }}>Max Frames:</span>
                                <input
                                    className="slider-val"
                                    style={{ width: 38, padding: '6px 4px' }}
                                    value={data.max_frames}
                                    onChange={(e) => set('max_frames', e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                                    onBlur={(e) => {
                                        const n = parseInt(e.target.value, 10);
                                        set('max_frames', String(Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 10));
                                    }}
                                    inputMode="numeric"
                                />
                            </>
                        )}
                    </div>

                    <button className="btn-primary" onClick={saveSettings}>Save Settings</button>
                </div>
                <div className="modal-byline">Subly · by shinsha</div>
                </div>
            </div>
        </div>
    );
}
