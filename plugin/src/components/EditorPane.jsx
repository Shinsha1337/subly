import Editor from './Editor';

export default function EditorPane({
    tab,
    currentBlocks,
    setPhrasesBlocks,
    setOriginalBlocks,
    syncPlayhead,
    loadToken,
    phrasesMode
}) {
    return (
        <div className="editor-panel">
            {tab === 'template' ? (
                <div className="empty-state">
                    <div className="empty-state-title">How to create subtitles</div>
                    <div className="empty-state-desc">
                        <ol>
                            <li>Pick a <strong>Text+ template</strong> here and click <strong>Set Preview Caption</strong>.</li>
                            <li>Switch to <strong>Transcription</strong>, choose a language and click <strong>Transcribe Audio</strong> — the subtitle track loads into the editor automatically.</li>
                            <li>Choose a <strong>Subtitle Mode</strong> (Whole Sentence / Single Word / Custom) and click <strong>Create Phrases</strong>.</li>
                            <li>Open <strong>Deliver</strong>, tune size, position, case, punctuation and Fill Gaps, then click <strong>Create Captions</strong>.</li>
                        </ol>
                    </div>
                </div>
            ) : tab === 'transcription' && currentBlocks.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-title">No subtitles yet</div>
                    <div className="empty-state-desc">Transcribe the timeline audio by clicking <strong>Transcribe Audio</strong> — the resulting subtitles will appear here.</div>
                </div>
            ) : tab === 'deliver' && currentBlocks.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-state-title">No phrases yet</div>
                    <div className="empty-state-desc">Create phrases on the <strong>Transcription</strong> tab to produce the final subtitles, then come back here to refine and bake them.</div>
                </div>
            ) : (
                <Editor
                    key={tab}
                    blocks={currentBlocks}
                    setBlocks={tab === 'deliver' ? setPhrasesBlocks : setOriginalBlocks}
                    onSyncPlayhead={syncPlayhead}
                    loadToken={loadToken}
                    readOnly={tab === 'deliver' && phrasesMode !== 0}
                    hideStructural={tab === 'transcription'}
                    countLabel={tab === 'deliver' ? 'phrases' : 'subtitles'}
                />
            )}
        </div>
    );
}
