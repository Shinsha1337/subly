import React from 'react';
import { flushSync } from 'react-dom';
import { Undo, Redo, Search, Razor } from './Icons';
import { tcToMs, msToTc, syncWordsToText } from '../logic/subtitle';

// Stable per-block identity for React keys. Module-level so the counter never
// resets across editor remounts (the editor is keyed by tab) and can't collide.
let __blockUid = 0;
const nextBlockUid = () => 'blk' + (++__blockUid);

// Counts visible characters, not UTF-16 code units — see subtitle.js#charLen.
const charLen = (s) => [...String(s || '')].length;

function rewrapTextLikeOriginal(originalText, newWords) {
    const lines = String(originalText || '').split('\n');
    if (lines.length <= 1) return newWords.map(w => w.text).join(' ');

    const maxLineLen = Math.max(...lines.map(l => charLen(l)));
    if (maxLineLen <= 0) return newWords.map(w => w.text).join(' ');

    const outLines = [];
    let line = [];
    let len = 0;
    for (const word of newWords) {
        const wl = charLen(word.text);
        if (!line.length) { line = [word.text]; len = wl; }
        else if (len + 1 + wl <= maxLineLen) { line.push(word.text); len += 1 + wl; }
        else { outLines.push(line.join(' ')); line = [word.text]; len = wl; }
    }
    if (line.length) outLines.push(line.join(' '));
    return outLines.join('\n');
}

const SubBlock = React.forwardRef(function SubBlock({ block, index, highlight, scrollRef, onChange, onMerge, onSplit, onDelete, onSync, splitMode, onEnterSplitMode, onExitSplitMode, editMode, onEnterEditMode, onExitEditMode, onEditWord, readOnly, hideStructural }, ref) {
    const textRef = React.useRef(null);
    const [splitPositions, setSplitPositions] = React.useState([]);
    const [editingWordIndex, setEditingWordIndex] = React.useState(null);
    const [editingText, setEditingText] = React.useState('');
    const editInputRef = React.useRef(null);

    const autosize = React.useCallback(() => {
        const el = textRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }, []);

    React.useLayoutEffect(() => { autosize(); }, [block.text, autosize]);

    React.useImperativeHandle(ref, () => ({ autosize, el: textRef.current }), [autosize]);

    const onTc = (field) => (e) => onChange(index, { [field]: e.target.value.replace(/[^0-9:,.]/g, '') });

    const handleEnterSplitMode = () => {
        setSplitPositions([]);
        onEnterSplitMode(index);
    };

    const handleConfirmSplit = () => {
        if (splitPositions.length > 0) {
            onSplit(index, { positions: splitPositions });
        }
        setSplitPositions([]);
        onExitSplitMode();
        setTimeout(() => autosize(), 0);
    };

    const handleCancelSplit = () => {
        setSplitPositions([]);
        onExitSplitMode();
        setTimeout(() => autosize(), 0);
    };

    const toggleSplitPosition = (position, textLength) => {
        if (position <= 0 || position >= textLength) return;
        setSplitPositions(prev => {
            if (prev.includes(position)) return prev.filter(p => p !== position);
            return [...prev, position].sort((a, b) => a - b);
        });
    };

    const handleEnterEditMode = () => {
        onEnterEditMode(index);
    };

    const handleExitEditMode = () => {
        onExitEditMode();
        setTimeout(() => autosize(), 0);
    };

    const handleStartEditWord = (wordIndex, currentText) => {
        setEditingWordIndex(wordIndex);
        setEditingText(currentText);
        setTimeout(() => editInputRef.current?.focus(), 0);
    };

    const handleSaveEditWord = () => {
        if (editingWordIndex !== null && block.words && block.words[editingWordIndex]) {
            flushSync(() => {
                onEditWord(index, editingWordIndex, editingText);
            });
        }
        setEditingWordIndex(null);
        setEditingText('');
    };

    const handleCancelEditWord = () => {
        setEditingWordIndex(null);
        setEditingText('');
    };

    const renderEditMode = () => {
        if (!block.words || block.words.length === 0) {
            return <div className="sub-text-edit">No word timing data available</div>;
        }

        return (
            <div className="sub-text-edit">
                {block.words.map((word, i) => {
                    const isEditing = editingWordIndex === i;

                    if (isEditing) {
                        return (
                            <span key={i} className="edit-word-wrap">
                                <span className="edit-word-measure" aria-hidden="true">{editingText || ' '}</span>
                                <input
                                    ref={editInputRef}
                                    className="edit-word-input"
                                    value={editingText}
                                    onChange={(e) => setEditingText(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            handleSaveEditWord();
                                        } else if (e.key === 'Escape') {
                                            e.preventDefault();
                                            handleCancelEditWord();
                                        }
                                    }}
                                    onBlur={handleSaveEditWord}
                                />
                            </span>
                        );
                    }

                    return (
                        <span
                            key={i}
                            className="edit-word"
                            onClick={() => handleStartEditWord(i, word.text || '')}
                        >
                            {word.text}
                        </span>
                    );
                })}
            </div>
        );
    };

    const renderSplitMode = () => {
        const text = block.text || '';
        const words = text.split(/(\s+)/);
        let charCount = 0;
        const firstSplitPosition = splitPositions.length ? splitPositions[0] : null;

        return (
            <div className="sub-text-split">
                {words.map((word, i) => {
                    const start = charCount;
                    const end = charCount + word.length;
                    charCount = end;

                    if (/^\s+$/.test(word)) {
                        return <span key={i} className="split-space">{word}</span>;
                    }

                    const isSelected = firstSplitPosition !== null && start >= firstSplitPosition;
                    const isSplitPoint = splitPositions.includes(start);

                    return (
                        <React.Fragment key={i}>
                            {isSplitPoint && <span className="split-divider" />}
                            <span
                                className={'split-word' + (isSelected ? ' selected' : '')}
                                onClick={() => toggleSplitPosition(start, text.length)}
                            >
                                {word}
                            </span>
                        </React.Fragment>
                    );
                })}
            </div>
        );
    };

    return (
        <div className={'sub-block' + (highlight ? ' match' : '') + (splitMode ? ' split-mode' : '')} ref={scrollRef}>
            <div className="sub-top">
                <button className="sub-idx tip-start" data-tip="Sync playhead" onClick={() => onSync(block)}>#{index + 1}</button>
                <input
                    className="tc-input"
                    value={block.start}
                    onChange={onTc('start')}
                    inputMode="numeric"
                    spellCheck={false}
                    disabled={splitMode}
                />
                <span className="tc-arrow">→</span>
                <input
                    className="tc-input"
                    value={block.end}
                    onChange={onTc('end')}
                    inputMode="numeric"
                    spellCheck={false}
                    disabled={splitMode}
                />
                <div className="sub-actions">
                    {!splitMode && !editMode ? (
                        <>
                            {!hideStructural && (
                                <>
                                    <button className="mini-btn tip-start" data-tip="Merge with next" aria-label="Merge with next subtitle" onClick={() => onMerge(index)}>↓</button>
                                    <button className="mini-btn icon-only tip-start" data-tip="Split" aria-label="Split subtitle" onClick={handleEnterSplitMode}><Razor /></button>
                                </>
                            )}
                            <button className="mini-btn del tip-start" data-tip="Delete" aria-label="Delete subtitle" onClick={() => onDelete(index)}>✕</button>
                        </>
                    ) : splitMode ? (
                        <>
                            <button className="mini-btn tip-start" data-tip="Cancel" onClick={handleCancelSplit}>✕</button>
                            <button className="mini-btn tip-start" data-tip="Confirm split" disabled={!splitPositions.length} onClick={handleConfirmSplit}>✓</button>
                        </>
                    ) : (
                        <>
                            <button className="mini-btn tip-start" data-tip="Exit edit mode" onClick={handleExitEditMode}>✓</button>
                        </>
                    )}
                </div>
            </div>
            {!splitMode && !editMode ? (
                <textarea
                    ref={textRef}
                    className="sub-text"
                    value={block.text}
                    rows={1}
                    onChange={(e) => onChange(index, { text: e.target.value })}
                    readOnly={readOnly}
                    onClick={readOnly ? handleEnterEditMode : undefined}
                    style={readOnly ? { cursor: 'pointer' } : {}}
                />
            ) : splitMode ? (
                renderSplitMode()
            ) : (
                renderEditMode()
            )}
        </div>
    );
});

export default function Editor({ blocks, setBlocks, onSyncPlayhead, loadToken, readOnly, hideStructural, countLabel = 'subtitles' }) {
    const undoStack = React.useRef([]);
    const redoStack = React.useRef([]);
    const burstOpen = React.useRef(false);   // a typing burst owns the latest undo entry
    const burstTimer = React.useRef(null);
    const [, force] = React.useReducer((x) => x + 1, 0); // refresh enabled-state of undo/redo

    // search
    const [searchOpen, setSearchOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [matchIdx, setMatchIdx] = React.useState(0);
    const searchRef = React.useRef(null);

    // split mode
    const [splitModeIndex, setSplitModeIndex] = React.useState(null);
    const prevSplitModeIndex = React.useRef(null);

    // edit mode
    const [editModeIndex, setEditModeIndex] = React.useState(null);
    const prevEditModeIndex = React.useRef(null);

    // Auto-resize previous block when switching modes
    React.useEffect(() => {
        if (prevSplitModeIndex.current !== null && prevSplitModeIndex.current !== splitModeIndex) {
            const prevBlock = blockRefs.current[prevSplitModeIndex.current];
            if (prevBlock && prevBlock.autosize) {
                setTimeout(() => prevBlock.autosize(), 0);
            }
        }
        prevSplitModeIndex.current = splitModeIndex;
    }, [splitModeIndex]);

    React.useEffect(() => {
        if (prevEditModeIndex.current !== null && prevEditModeIndex.current !== editModeIndex) {
            const prevBlock = blockRefs.current[prevEditModeIndex.current];
            if (prevBlock && prevBlock.autosize) {
                setTimeout(() => prevBlock.autosize(), 0);
            }
        }
        prevEditModeIndex.current = editModeIndex;
    }, [editModeIndex]);

    // blockRefs stores the imperative handle from each SubBlock (has .autosize and .el).
    // scrollRefs stores the DOM node of each sub-block div for scrollIntoView.
    const blockRefs = React.useRef({});
    const scrollRefs = React.useRef({});
    const listRef = React.useRef(null);

    // One shared ResizeObserver on the list container, debounced so it fires once
    // after the user stops dragging — not on every pixel. This replaces the N
    // per-block observers that caused layout thrash during window resize.
    // Dep is blocks.length>0 (not []): on first load the list isn't rendered yet
    // (empty-state is), so a []-effect would attach to nothing. Re-running when
    // blocks first appear attaches the observer; it then fires when the panel
    // flips display:none→flex (width 0→real), re-fitting every textarea — which
    // fixes multi-line captions being clipped to one line on the first create.
    const hasBlocks = blocks.length > 0;
    React.useEffect(() => {
        const el = listRef.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        let lastW = el.clientWidth;
        let raf = null;
        const ro = new ResizeObserver(() => {
            if (el.clientWidth === lastW) return;
            lastW = el.clientWidth;
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                raf = null;
                Object.values(blockRefs.current).forEach(h => h && h.autosize && h.autosize());
            });
        });
        ro.observe(el);
        return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
    }, [hasBlocks]);

    // A fresh set of blocks loaded from outside (Pull / Create Phrases) wipes
    // history and stamps a stable __uid on any block missing one, so React keys
    // follow the data through merge/split/delete instead of the array slot.
    React.useEffect(() => {
        undoStack.current = [];
        redoStack.current = [];
        burstOpen.current = false;
        clearTimeout(burstTimer.current);
        setBlocks(prev => prev.some(b => !b.__uid)
            ? prev.map(b => (b.__uid ? b : { ...b, __uid: nextBlockUid() }))
            : prev);
        force();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loadToken]);

    const snapshot = () => blocks.map(b => ({ ...b, words: b.words ? [...b.words] : b.words }));

    const pushUndo = () => {
        undoStack.current.push(snapshot());
        if (undoStack.current.length > 200) undoStack.current.shift();
        redoStack.current = [];
    };

    const endBurst = () => {
        clearTimeout(burstTimer.current);
        burstTimer.current = null;
        burstOpen.current = false;
    };

    // text edits: one undo step per 600ms burst of keystrokes
    const updateBlock = (index, patch) => {
        if (!burstOpen.current) { pushUndo(); burstOpen.current = true; force(); }
        clearTimeout(burstTimer.current);
        burstTimer.current = setTimeout(() => { burstOpen.current = false; }, 600);
        setBlocks(prev => prev.map((b, i) => {
            if (i !== index) return b;
            const next = { ...b, ...patch };
            if (Object.prototype.hasOwnProperty.call(patch, 'text')) {
                next.words = syncWordsToText(b, patch.text);
            }
            return next;
        }));
    };

    // structural edits: snapshot immediately, closing any open typing burst
    const structuralEdit = (updater) => {
        endBurst();
        pushUndo();
        force();
        setBlocks(updater);
    };

    // Split/edit mode is tracked by index; a structural change shifts indices, so
    // clear both modes first to avoid the highlight landing on the wrong block.
    const resetModes = () => { setSplitModeIndex(null); setEditModeIndex(null); };

    const deleteBlock = (index) => {
        resetModes();
        structuralEdit(prev => prev.filter((_, i) => i !== index));
    };

    const mergeBlock = (index) => {
        resetModes();
        structuralEdit(prev => {
            if (index >= prev.length - 1) return prev;
            const a = prev[index];
            const b = prev[index + 1];
            const merged = {
                ...a,
                end: b.end,
                text: `${a.text} ${b.text}`.trim(),
                words: [...(a.words || []), ...(b.words || [])]
            };
            const next = [...prev];
            next.splice(index, 2, merged);
            return next;
        });
    };

    const splitBlock = (index, selection) => {
        resetModes();
        structuralEdit(prev => {
            const b = prev[index];
            const text = String(b.text || '');

            const positions = [...new Set(
                (Array.isArray(selection?.positions) ? selection.positions : [selection?.start])
                    .map(Number)
                    .filter(pos => Number.isFinite(pos) && pos > 0 && pos < text.length)
            )].sort((a, b) => a - b);

            if (positions.length > 0) {
                const startMs = tcToMs(b.start);
                const endMs = tcToMs(b.end);
                const wordInfos = [];

                if (b.words && b.words.length > 0) {
                    let charPos = 0;
                    for (const word of b.words) {
                        const wordText = word.text || '';
                        const wordStart = charPos;
                        const wordEnd = charPos + wordText.length;
                        wordInfos.push({ word, start: wordStart, end: wordEnd });

                        charPos = wordEnd;
                        while (charPos < text.length && /\s/.test(text[charPos])) {
                            charPos++;
                        }
                    }
                }

                const splitMs = positions.map(position => {
                    const wordInfo = wordInfos.find(info => position >= info.start && position <= info.end);
                    if (wordInfo && wordInfo.word.start) {
                        return tcToMs(wordInfo.word.start);
                    }
                    return startMs + Math.floor((endMs - startMs) * (position / text.length));
                });

                const bounds = [0, ...positions, text.length];
                const parts = [];
                for (let i = 0; i < bounds.length - 1; i++) {
                    const segmentText = text.substring(bounds[i], bounds[i + 1]).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
                    if (!segmentText) return prev;

                    const segmentWords = wordInfos
                        .filter(info => info.start >= bounds[i] && info.start < bounds[i + 1])
                        .map(info => info.word);

                    parts.push({
                        ...b,
                        __uid: i === 0 ? (b.__uid || nextBlockUid()) : nextBlockUid(),
                        start: i === 0 ? b.start : msToTc(splitMs[i - 1]),
                        end: i === bounds.length - 2 ? b.end : msToTc(splitMs[i]),
                        text: segmentText,
                        words: segmentWords,
                    });
                }

                const next = [...prev];
                next.splice(index, 1, ...parts);
                return next;
            }

            const words = text.split(/\s+/).filter(Boolean);
            if (words.length < 2) return prev;
            const mid = Math.ceil(words.length / 2);
            const startMs = tcToMs(b.start);
            const endMs = tcToMs(b.end);
            const splitMs = startMs + Math.floor((endMs - startMs) * (mid / words.length));
            const first = { ...b, __uid: b.__uid || nextBlockUid(), end: msToTc(splitMs), text: words.slice(0, mid).join(' ') };
            const second = { ...b, __uid: nextBlockUid(), start: msToTc(splitMs), text: words.slice(mid).join(' '), words: [] };
            const next = [...prev];
            next.splice(index, 1, first, second);
            return next;
        });
    };

    const editWord = (blockIndex, wordIndex, newText) => {
        structuralEdit(prev => {
            const block = prev[blockIndex];
            if (!block.words || !block.words[wordIndex]) return prev;

            const originalWord = block.words[wordIndex];
            const newWords = newText.split(/\s+/).filter(Boolean);

            // If no spaces added, just update the text
            if (newWords.length === 1) {
                const updatedWords = [...block.words];
                updatedWords[wordIndex] = { ...originalWord, text: newText };
                const newBlockText = rewrapTextLikeOriginal(block.text, updatedWords);
                const next = [...prev];
                next[blockIndex] = { ...block, words: updatedWords, text: newBlockText };
                return next;
            }

            // If spaces added, split into multiple words with proportional timing.
            // Reserve the gaps out of the budget so the split words stay within
            // [startMs, endMs] and never overrun the original word's end.
            const startMs = tcToMs(originalWord.start);
            const endMs = tcToMs(originalWord.end);
            const totalDur = endMs - startMs;
            const totalChars = newWords.reduce((sum, w) => sum + w.length, 0);
            const gapCount = newWords.length - 1;
            const gapUnit = (totalChars && gapCount) ? totalDur * (1 / (totalChars + newWords.length)) : 0;
            const wordBudget = Math.max(0, totalDur - gapUnit * gapCount);

            const splitWords = [];
            let current = startMs;
            newWords.forEach((word, i) => {
                const wDur = totalChars ? wordBudget * (word.length / totalChars) : 0;
                splitWords.push({
                    text: word,
                    start: msToTc(current),
                    end: msToTc(Math.min(current + wDur, endMs))
                });
                current += wDur + (i < newWords.length - 1 ? gapUnit : 0);
            });

            // Replace the original word with split words
            const updatedWords = [
                ...block.words.slice(0, wordIndex),
                ...splitWords,
                ...block.words.slice(wordIndex + 1)
            ];

            const newBlockText = rewrapTextLikeOriginal(block.text, updatedWords);
            const next = [...prev];
            next[blockIndex] = { ...block, words: updatedWords, text: newBlockText };
            return next;
        });
    };

    const undo = () => {
        endBurst();
        if (!undoStack.current.length) return;
        redoStack.current.push(snapshot());
        setBlocks(undoStack.current.pop());
        force();
    };

    const redo = () => {
        endBurst();
        if (!redoStack.current.length) return;
        undoStack.current.push(snapshot());
        setBlocks(redoStack.current.pop());
        force();
    };

    // ---- search -----------------------------------------------------------
    const matches = React.useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const out = [];
        blocks.forEach((b, i) => { if ((b.text || '').toLowerCase().includes(q)) out.push(i); });
        return out;
    }, [query, blocks]);

    React.useEffect(() => { setMatchIdx(0); }, [query]);

    const gotoMatch = (n) => {
        if (!matches.length) return;
        const idx = ((n % matches.length) + matches.length) % matches.length;
        setMatchIdx(idx);
        const el = scrollRefs.current[matches[idx]];
        if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    };

    const openSearch = () => {
        setSearchOpen(true);
        setTimeout(() => searchRef.current && searchRef.current.focus(), 0);
    };
    const closeSearch = () => { setSearchOpen(false); setQuery(''); };

    // ---- keyboard shortcuts ----------------------------------------------
    // Match on e.code (physical key) not e.key — under a non-Latin layout
    // (e.g. Russian) e.key is the localized char ("а"/"ф"), so Ctrl+F/Z/Y
    // would never fire. e.code stays "KeyF"/"KeyZ"/"KeyY" on any layout.
    React.useEffect(() => {
        const onKey = (e) => {
            const mod = e.ctrlKey || e.metaKey;
            if (mod && e.code === 'KeyZ' && !e.shiftKey) { e.preventDefault(); undo(); }
            else if ((mod && e.code === 'KeyY') || (mod && e.shiftKey && e.code === 'KeyZ')) { e.preventDefault(); redo(); }
            else if (mod && e.code === 'KeyF') { e.preventDefault(); searchOpen ? closeSearch() : openSearch(); }
            else if (e.key === 'Escape' && searchOpen) { e.preventDefault(); closeSearch(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // re-bind so undo/redo/search close over the current blocks
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchOpen, blocks]);

    if (!blocks.length) {
        return (
            <div className="empty-state">
                <div className="empty-state-title">No subtitles found</div>
                <div className="empty-state-desc">Generate phrases to populate the editor.</div>
            </div>
        );
    }

    const currentMatch = matches.length ? matches[matchIdx] : -1;

    return (
        <>
            <div className="editor-header">
                <span className="editor-count">{blocks.length} {countLabel}</span>
                <span className="grow" />
                <button className="icon-btn tip-end" data-tip="Undo (Ctrl+Z)" disabled={!undoStack.current.length} onClick={undo}><Undo /></button>
                <button className="icon-btn tip-end" data-tip="Redo (Ctrl+Y)" disabled={!redoStack.current.length} onClick={redo}><Redo /></button>
                <button className={'icon-btn tip-end' + (searchOpen ? ' active' : '')} data-tip="Find (Ctrl+F)" onClick={() => (searchOpen ? closeSearch() : openSearch())}><Search /></button>
            </div>

            {searchOpen && (
                <div className="editor-search">
                    <Search />
                    <input
                        ref={searchRef}
                        className="search-input"
                        placeholder="Find in subtitles…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); gotoMatch(matchIdx + (e.shiftKey ? -1 : 1)); }
                            if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
                        }}
                    />
                    <span className="search-count">{matches.length ? `${matchIdx + 1} / ${matches.length}` : '0 / 0'}</span>
                    <button className="mini-btn" disabled={!matches.length} onClick={() => gotoMatch(matchIdx - 1)}>↑</button>
                    <button className="mini-btn" disabled={!matches.length} onClick={() => gotoMatch(matchIdx + 1)}>↓</button>
                </div>
            )}

            <div className="editor-list" ref={listRef}>
                {blocks.map((block, i) => (
                    <SubBlock
                        key={block.__uid ?? i}
                        ref={(h) => { blockRefs.current[i] = h; }}
                        block={block}
                        index={i}
                        highlight={i === currentMatch}
                        scrollRef={(el) => { scrollRefs.current[i] = el; }}
                        onChange={updateBlock}
                        onMerge={mergeBlock}
                        onSplit={splitBlock}
                        onDelete={deleteBlock}
                        onSync={onSyncPlayhead}
                        splitMode={splitModeIndex === i}
                        onEnterSplitMode={setSplitModeIndex}
                        onExitSplitMode={() => setSplitModeIndex(null)}
                        editMode={editModeIndex === i}
                        onEnterEditMode={setEditModeIndex}
                        onExitEditMode={() => setEditModeIndex(null)}
                        onEditWord={editWord}
                        readOnly={readOnly}
                        hideStructural={hideStructural}
                    />
                ))}
            </div>
        </>
    );
}
