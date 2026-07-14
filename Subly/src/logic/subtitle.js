// Subly — subtitle logic (ported from subly/subtitle_logic.py)
// Timecode helpers, formatting (case + punctuation), and smart regrouping.

export function tcToMs(tc) {
    const norm = String(tc || '').replace('.', ',');
    const parts = norm.split(',');
    const hms = parts[0] || '00:00:00';
    const ms = parseInt(parts[1] || '0', 10) || 0;
    const [h, m, s] = hms.split(':').map(v => parseInt(v, 10) || 0);
    return (h * 3600 + m * 60 + s) * 1000 + ms;
}

export function msToTc(ms) {
    ms = Math.max(0, Math.floor(ms));
    const h = Math.floor(ms / 3600000); ms %= 3600000;
    const m = Math.floor(ms / 60000); ms %= 60000;
    const s = Math.floor(ms / 1000); ms %= 1000;
    const p = (n, w = 2) => String(n).padStart(w, '0');
    return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function wordsToChars(words) {
    const w = Math.min(8, Math.max(1, Math.round(Number(words) || 1)));
    return Math.round(6 + (w - 1) * (50 - 6) / (8 - 1));
}

export function syncWordsToText(block, nextText) {
    if (!Array.isArray(block.words)) return block.words;

    const textWords = String(nextText || '').split(/\s+/).filter(Boolean);
    if (!textWords.length) return [];

    const oldWords = block.words;
    if (textWords.length === oldWords.length) {
        return textWords.map((text, i) => ({ ...oldWords[i], text }));
    }

    const startMs = tcToMs(block.start);
    const endMs = tcToMs(block.end);
    const totalDur = Math.max(0, endMs - startMs);
    const totalChars = textWords.reduce((sum, w) => sum + w.length, 0);
    const gapCount = textWords.length - 1;
    const gapUnit = (totalChars && gapCount) ? totalDur * (1 / (totalChars + textWords.length)) : 0;
    const wordBudget = Math.max(0, totalDur - gapUnit * gapCount);
    let current = startMs;

    return textWords.map((text, i) => {
        const wDur = totalChars ? wordBudget * (text.length / totalChars) : 0;
        const start = current;
        const end = Math.min(current + wDur, endMs);
        current += wDur + (i < textWords.length - 1 ? gapUnit : 0);
        return { text, start: msToTc(start), end: msToTc(end) };
    });
}

// Strip punctuation/symbols but keep ALL Unicode letters (incl. accented like
// café/über), digits, combining marks and whitespace — \w + Ѐ-ӿ dropped accents.
const PUNCT_ALL = /[^\p{L}\p{N}\p{M}\s]/gu;
const SENTENCE_ENDERS = new Set(['.', '!', '?', '…']);

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Apply text case + punctuation removal. fmt = { text_case, remove_punct, punct_chars }
export function applyFormatting(blocks, fmt) {
    const doCase = (t) => {
        if (fmt.text_case === 'lowercase') return t.toLowerCase();
        if (fmt.text_case === 'UPPERCASE') return t.toUpperCase();
        // Auto / Sentence: capitalize first alpha after a sentence ender
        let capNext = true;
        let out = '';
        for (const ch of t) {
            if (capNext && /[a-zA-Zа-яА-ЯёЁ]/.test(ch)) {
                out += ch.toUpperCase();
                capNext = false;
            } else {
                out += ch;
                if (SENTENCE_ENDERS.has(ch)) capNext = true;
            }
        }
        return out;
    };

    const doRmPunct = (t) => {
        if (!fmt.remove_punct) return t;
        if (fmt.punct_chars === 'all') return t.replace(PUNCT_ALL, '');
        if (fmt.punct_chars) {
            const re = new RegExp(`[${escapeRegex(fmt.punct_chars)}]`, 'g');
            return t.replace(re, '');
        }
        return t;
    };

    return blocks.map(block => {
        const next = { ...block, text: doCase(doRmPunct(block.text || '')) };
        if (Array.isArray(block.words)) {
            next.words = block.words.map(w => ({ ...w, text: doCase(doRmPunct(w.text || '')) }));
        }
        return next;
    });
}

// ----------------------------------------------------------------- Deliver
// Phrase-level structural ops used by the Deliver Grouping mode. These keep the
// `words` arrays intact so per-word timing / emphasis survives the operation.

// Merge a phrase block with the one directly below it (Deliver: arrow points
// DOWN, the selected phrase joins its lower neighbour).
export function mergePhraseDown(blocks, index) {
    if (index < 0 || index >= blocks.length - 1) return blocks;
    const a = blocks[index];
    const b = blocks[index + 1];
    const merged = {
        ...a,
        end: b.end,
        text: `${a.text} ${b.text}`.trim(),
        words: [...(a.words || []), ...(b.words || [])]
    };
    const next = [...blocks];
    next.splice(index, 2, merged);
    return next;
}

// Split a phrase block at a word boundary. `wordIndex` is the index of the first
// word that moves to the NEW (lower) block — the tail goes down, the head stays.
export function splitPhraseAtWord(blocks, index, wordIndex) {
    const b = blocks[index];
    const words = b.words || [];
    if (wordIndex <= 0 || wordIndex >= words.length) return blocks;

    const headWords = words.slice(0, wordIndex);
    const tailWords = words.slice(wordIndex);
    if (!headWords.length || !tailWords.length) return blocks;

    const joinText = (ws) => ws.map(w => w.text).join(' ');
    const head = {
        ...b,
        end: headWords[headWords.length - 1].end,
        text: joinText(headWords),
        words: headWords
    };
    const tail = {
        ...b,
        __uid: undefined, // caller stamps a fresh uid
        start: tailWords[0].start,
        text: joinText(tailWords),
        words: tailWords
    };
    const next = [...blocks];
    next.splice(index, 1, head, tail);
    return next;
}

// Build a per-word timed stream from subtitle blocks.
function buildWordStream(blocks) {
    const stream = [];
    for (const block of blocks) {
        const text = String(block.text || '').trim();
        if (!text) continue;

        const startMs = tcToMs(block.start);
        const endMs = tcToMs(block.end);
        const words = text.split(/\s+/).filter(Boolean);

        // If block contains only one word, keep it as-is with exact timing
        if (words.length === 1) {
            stream.push({ text: text, start: startMs, end: endMs });
            continue;
        }

        // If block contains multiple words, split them with proportional timing.
        // Reserve the inter-word gaps out of the budget first, so the words plus
        // gaps fill exactly [startMs, endMs] and the last word never overruns.
        const totalDur = endMs - startMs;
        const totalChars = words.reduce((sum, w) => sum + w.length, 0);
        const gapCount = words.length - 1;
        const gapUnit = (totalChars && gapCount) ? totalDur * (1 / (totalChars + words.length)) : 0;
        const wordBudget = Math.max(0, totalDur - gapUnit * gapCount);
        let current = startMs;
        words.forEach((word, i) => {
            const wDur = totalChars ? wordBudget * (word.length / totalChars) : 0;
            stream.push({ text: word, start: current, end: Math.min(current + wDur, endMs) });
            current += wDur + (i < words.length - 1 ? gapUnit : 0);
        });
    }
    return stream;
}

// Counts visible characters, not UTF-16 code units — otherwise a single
// emoji (2 units) or any supplementary-plane char would consume the budget
// as if it were two characters.
const charLen = (s) => [...String(s || '')].length;

// Wrap words into lines no longer than maxChars (used by Whole Sentence mode).
function wrapLines(words, maxChars) {
    const lines = [];
    let line = [];
    let len = 0;
    for (const word of words) {
        const wl = charLen(word);
        if (!line.length) { line = [word]; len = wl; }
        else if (len + 1 + wl <= maxChars) { line.push(word); len += 1 + wl; }
        else { lines.push(line.join(' ')); line = [word]; len = wl; }
    }
    if (line.length) lines.push(line.join(' '));
    return lines.join('\n');
}

// mode: 0=Single Word, 1=Whole Sentence, 2=Custom
export function smartRegroupSubs(blocks, mode, maxWords, maxChars, { maxGapMs = 800, wsMaxChars = 18 } = {}) {
    const stream = buildWordStream(blocks);

    const formatPhrase = (words) => {
        if (mode === 1) return wrapLines(words, wsMaxChars);
        return words.join(' ');
    };

    const result = [];
    let phrase = [];
    let wordObjs = [];
    let start = null;
    let end = null;

    const flush = () => {
        result.push({
            idx: result.length + 1,
            start: msToTc(start),
            end: msToTc(end),
            text: formatPhrase(phrase),
            words: wordObjs.map(w => ({ text: w.text, start: msToTc(w.start), end: msToTc(w.end) }))
        });
    };

    for (const w of stream) {
        if (!phrase.length) {
            phrase = [w.text]; wordObjs = [w]; start = w.start; end = w.end;
            continue;
        }
        const testPhrase = [...phrase, w.text];
        const testText = testPhrase.join(' ');
        const gap = w.start - end;
        const lastWord = phrase[phrase.length - 1].replace(/["'»“”]/g, '');
        const endsSentence = ['.', '!', '?', '…'].some(p => lastWord.endsWith(p));

        let shouldBreak;
        if (mode === 0) shouldBreak = true;
        else if (mode === 1) shouldBreak = gap > maxGapMs || endsSentence;
        else shouldBreak = gap > maxGapMs || testPhrase.length > maxWords || testText.length > maxChars || endsSentence;

        if (shouldBreak) {
            flush();
            phrase = [w.text]; wordObjs = [w]; start = w.start; end = w.end;
        } else {
            phrase.push(w.text); wordObjs.push(w); end = w.end;
        }
    }
    if (phrase.length) flush();
    return result;
}
