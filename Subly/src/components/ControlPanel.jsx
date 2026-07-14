import { Play, Refresh, Folder } from './Icons';
import { Toggle, Slider, Chips, MultiChips, Select } from './Controls';
import { wordsToChars } from '../logic/subtitle';
import { LANGUAGES, PUNCT_OPTS } from '../constants/options';

export default function ControlPanel(props) {
    const {
        tab, setTab,
        isResizing, leftPanelWidth,
        templates, template, setTemplate, importBin, refreshTemplates, setPreviewCaption,
        language, setLanguage, tracks, track, setTrack, transcribe, refreshTracks, applyToResolve, pullFromResolve,
        modeIdx, setModeIdx, wsChars, setWsChars, maxWords, setMaxWords, maxChars, setMaxChars, createPhrases,
        size, setSize, posX, setPosX, posY, setPosY,
        textCase, setTextCase, rmPunct, setRmPunct, punctSel, setPunctSel,
        fillGaps, setFillGaps, maxFrames, setMaxFrames, createCaptions,
        busy, hasOriginalBlocks, hasPhrasesBlocks
    } = props;

    return (
        <div
            className={'left-panel' + (isResizing ? ' left-panel-resizing' : '')}
            style={{ width: leftPanelWidth }}
        >
            {tab === 'template' && (
                <div className="card">
                    <span className="card-label">Select Template from Media Pool</span>
                    <div className="row">
                        <Select
                            className="grow"
                            value={template}
                            options={templates.length === 0
                                ? [{ value: '', label: 'No templates' }]
                                : templates.map(t => ({ value: t, label: t }))}
                            onChange={(v) => setTemplate(v)}
                        />
                        <button className="icon-square tip-end" data-tip="Import bundled bin" onClick={importBin}><Folder /></button>
                        <button className="icon-square tip-end" data-tip="Refresh templates" onClick={refreshTemplates}><Refresh /></button>
                    </div>
                    <button className="btn-primary" disabled={!!busy} onClick={setPreviewCaption}>
                        <Play /> Set Preview Caption
                    </button>
                </div>
            )}

            {tab === 'transcription' && (
                <>
                    <div className="card">
                        <span className="card-label">Transcribe</span>
                        <span className="field-label">Language</span>
                        <Select
                            className="grow"
                            value={language}
                            options={LANGUAGES.map(l => ({ value: l, label: l }))}
                            onChange={(v) => setLanguage(v)}
                        />
                        <div className="row between">
                            <span className="field-label">Subtitle Track</span>
                            <button className="btn-gray" disabled={!!busy} onClick={transcribe}>Transcribe Audio</button>
                        </div>
                        <div className="row">
                            <Select
                                className="grow"
                                value={track ?? ''}
                                options={tracks.length === 0
                                    ? [{ value: '', label: 'No tracks — Refresh' }]
                                    : tracks.map(t => ({ value: t.idx, label: t.name }))}
                                onChange={(v) => setTrack(Number(v))}
                            />
                            <button className="icon-square tip-end" data-tip="Refresh tracks" onClick={refreshTracks}><Refresh /></button>
                        </div>
                    </div>

                    <div className="card">
                        <span className="card-label">Timeline Sync</span>
                        <div className="row">
                            <button className="btn-gray grow tip-start" data-tip="Send subtitles to DaVinci Resolve for timeline editing: fix timing and text errors there, then Pull back" disabled={!!busy || !hasOriginalBlocks} onClick={applyToResolve}>Apply to Resolve</button>
                            <button className="btn-gray grow tip-end" data-tip="Load subtitles from the selected track into the editor" disabled={!!busy} onClick={pullFromResolve}>Pull from Resolve</button>
                        </div>
                    </div>

                    <div className="card">
                        <span className="card-label">Subtitle Mode</span>
                        <Select
                            className="grow"
                            value={modeIdx}
                            options={[
                                { value: 1, label: 'Whole Sentence' },
                                { value: 0, label: 'Single Word' },
                                { value: 2, label: 'Custom' }
                            ]}
                            onChange={(v) => setModeIdx(Number(v))}
                        />
                        {modeIdx === 1 && (
                            <Slider label="Max characters per line" value={wsChars} min={4} max={60} step={1} decimals={0} onChange={setWsChars} />
                        )}
                        {modeIdx === 2 && (
                            <>
                                <Slider label="Max Word Amount" value={maxWords} min={1} max={8} step={1} decimals={0}
                                    onChange={(v) => { setMaxWords(v); setMaxChars(wordsToChars(v)); }} />
                                <Slider label="Max Character Amount" value={maxChars} min={6} max={50} step={1} decimals={0} onChange={setMaxChars} />
                            </>
                        )}
                        <button className="btn-primary" disabled={!!busy || !hasOriginalBlocks} onClick={createPhrases}>
                            <Play /> Create Phrases
                        </button>
                    </div>
                </>
            )}

            {tab === 'deliver' && (
                <>
                    <div className="card">
                        <Slider label="Text Size:" strong value={size} min={0.001} max={0.3} step={0.001} decimals={3} onChange={setSize} />
                        <Slider label="X:" strong value={posX} min={0} max={1} step={0.001} decimals={3} snap={0.5} onChange={setPosX} />
                        <Slider label="Y:" strong value={posY} min={0} max={1} step={0.001} decimals={3} snap={0.5} onChange={setPosY} />
                    </div>
                    <div className="card">
                        <div className="row">
                            <span className="strong-label">Text case</span>
                            <Chips
                                options={[{ value: 'Auto', label: 'Aa' }, { value: 'lowercase', label: 'aa' }, { value: 'UPPERCASE', label: 'AA' }]}
                                value={textCase}
                                onChange={setTextCase}
                            />
                        </div>
                        <hr className="divider" />
                        <div className="row">
                            <span className="strong-label">Remove punctuation</span>
                            <Toggle value={rmPunct} onChange={setRmPunct} />
                        </div>
                        {rmPunct && (
                            <MultiChips
                                options={PUNCT_OPTS}
                                values={punctSel}
                                onToggle={(key) => setPunctSel(prev => ({ ...prev, [key]: !prev[key] }))}
                            />
                        )}
                        <hr className="divider" />
                        <div className="row between" style={{ flexWrap: 'nowrap' }}>
                            <div className="row">
                                <span className="strong-label">Fill Gaps</span>
                                <Toggle value={fillGaps} onChange={setFillGaps} />
                            </div>
                            {fillGaps && (
                                <div className="row" style={{ flexWrap: 'nowrap' }}>
                                    <span className="strong-label">Max Frames</span>
                                    <input
                                        className="slider-val"
                                        style={{ width: 38, padding: '6px 4px' }}
                                        value={maxFrames}
                                        onChange={(e) => setMaxFrames(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))}
                                        onBlur={(e) => {
                                            const n = parseInt(e.target.value, 10);
                                            setMaxFrames(String(Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 10));
                                        }}
                                        inputMode="numeric"
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                    <button className="btn-primary" disabled={!!busy || !hasPhrasesBlocks} onClick={createCaptions}>
                        <Play /> Create Captions
                    </button>
                </>
            )}

            <div className="grow" />
            <div className="tabs">
                <button className={'tab-btn' + (tab === 'template' ? ' active' : '')} onClick={() => setTab('template')}>Template</button>
                <button className={'tab-btn' + (tab === 'transcription' ? ' active' : '')} onClick={() => setTab('transcription')}>Transcription</button>
                <button className={'tab-btn' + (tab === 'deliver' ? ' active' : '')} onClick={() => setTab('deliver')}>Deliver</button>
            </div>
        </div>
    );
}
