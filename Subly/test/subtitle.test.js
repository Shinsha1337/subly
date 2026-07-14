import { describe, it, expect } from 'vitest';
import {
    tcToMs,
    msToTc,
    wordsToChars,
    syncWordsToText,
    applyFormatting,
    smartRegroupSubs,
    mergePhraseDown,
    splitPhraseAtWord
} from '../src/logic/subtitle.js';

const W = (text, start, end) => ({ text, start, end });
const phrase = (text, start, end, words) => ({ text, start, end, words });

describe('timecode conversion', () => {
    it('parses comma and dot millisecond separators', () => {
        expect(tcToMs('00:00:01,500')).toBe(1500);
        expect(tcToMs('00:00:01.500')).toBe(1500);
        expect(tcToMs('01:02:03,004')).toBe(((1 * 3600 + 2 * 60 + 3) * 1000) + 4);
    });

    it('round-trips ms -> tc -> ms', () => {
        for (const ms of [0, 1, 999, 1500, 3661004]) {
            expect(tcToMs(msToTc(ms))).toBe(ms);
        }
    });

    it('clamps negative ms to zero', () => {
        expect(msToTc(-5)).toBe('00:00:00,000');
    });
});

describe('wordsToChars', () => {
    it('maps 1..8 words into the 6..50 char range and clamps out-of-range input', () => {
        expect(wordsToChars(1)).toBe(6);
        expect(wordsToChars(8)).toBe(50);
        expect(wordsToChars(0)).toBe(6);    // clamped up to 1
        expect(wordsToChars(100)).toBe(50); // clamped down to 8
    });
});

describe('syncWordsToText', () => {
    it('keeps existing word timing when only the word text changes', () => {
        const words = syncWordsToText({
            start: '00:00:00,000',
            end: '00:00:02,000',
            words: [
                { text: 'old', start: '00:00:00,000', end: '00:00:01,000' },
                { text: 'text', start: '00:00:01,000', end: '00:00:02,000' }
            ]
        }, 'new words');

        expect(words.map(w => w.text)).toEqual(['new', 'words']);
        expect(words[0].start).toBe('00:00:00,000');
        expect(words[1].end).toBe('00:00:02,000');
    });

    it('retimes words inside the block when word count changes', () => {
        const words = syncWordsToText({
            start: '00:00:10,000',
            end: '00:00:12,000',
            words: [{ text: 'old', start: '00:00:10,000', end: '00:00:12,000' }]
        }, 'three new words');

        expect(words.map(w => w.text)).toEqual(['three', 'new', 'words']);
        expect(tcToMs(words[0].start)).toBe(10000);
        expect(tcToMs(words.at(-1).end)).toBeLessThanOrEqual(12000);
        for (let i = 1; i < words.length; i++) {
            expect(tcToMs(words[i].start)).toBeGreaterThanOrEqual(tcToMs(words[i - 1].end));
        }
    });
});

describe('applyFormatting — case', () => {
    it('lowercases / uppercases', () => {
        expect(applyFormatting([{ text: 'Hello World' }], { text_case: 'lowercase' })[0].text).toBe('hello world');
        expect(applyFormatting([{ text: 'Hello World' }], { text_case: 'UPPERCASE' })[0].text).toBe('HELLO WORLD');
    });

    it('Auto capitalizes the first letter after a sentence ender', () => {
        expect(applyFormatting([{ text: 'hello. world' }], { text_case: 'Auto' })[0].text).toBe('Hello. World');
    });

    it('handles Cyrillic in Auto case', () => {
        expect(applyFormatting([{ text: 'привет. мир' }], { text_case: 'Auto' })[0].text).toBe('Привет. Мир');
    });
});

describe('applyFormatting — punctuation', () => {
    it('removes all punctuation but keeps accented Latin letters (regression: café -> caf)', () => {
        const out = applyFormatting(
            [{ text: 'Café, über!' }],
            { text_case: 'lowercase', remove_punct: true, punct_chars: 'all' }
        )[0].text;
        expect(out).toBe('café über');
    });

    it('keeps Cyrillic and digits while stripping punctuation', () => {
        const out = applyFormatting(
            [{ text: 'Привет, мир 2026!' }],
            { text_case: 'lowercase', remove_punct: true, punct_chars: 'all' }
        )[0].text;
        expect(out).toBe('привет мир 2026');
    });

    it('removes only the selected characters', () => {
        const out = applyFormatting(
            [{ text: 'a, b! c.' }],
            { text_case: 'lowercase', remove_punct: true, punct_chars: ',!' }
        )[0].text;
        expect(out).toBe('a b c.');
    });

    it('formats the per-word array too', () => {
        const out = applyFormatting(
            [{ text: 'hi!', words: [{ text: 'hi!' }] }],
            { text_case: 'UPPERCASE', remove_punct: true, punct_chars: 'all' }
        )[0];
        expect(out.words[0].text).toBe('HI');
    });
});

describe('smartRegroupSubs', () => {
    const block = (start, end, text) => ({ start, end, text });

    it('returns an empty array for empty input', () => {
        expect(smartRegroupSubs([], 0, 1, 6, {})).toEqual([]);
    });

    it('mode 0 (single word) emits one phrase per word', () => {
        const res = smartRegroupSubs([block('00:00:00,000', '00:00:02,000', 'one two three')], 0, 1, 6, {});
        expect(res.map(r => r.text)).toEqual(['one', 'two', 'three']);
    });

    it('mode 1 (whole sentence) breaks on a sentence ender', () => {
        const res = smartRegroupSubs([
            block('00:00:00,000', '00:00:01,000', 'hello world.'),
            block('00:00:01,100', '00:00:02,000', 'next one')
        ], 1, 1, 6, { wsMaxChars: 18 });
        expect(res.length).toBe(2);
        expect(res[0].text).toBe('hello world.');
        expect(res[1].text).toBe('next one');
    });

    it('mode 1 wraps by character count, not UTF-16 code units (emoji regression)', () => {
        // Each emoji is 1 char but 2 UTF-16 units (surrogate pair). With the
        // old word.length, '🌟🌟🌟' looked like 6 units and refused to share
        // a 6-unit line with 'ха'. With charLen it is 3 chars and fits.
        const res = smartRegroupSubs([
            block('00:00:00,000', '00:00:01,000', '🌟🌟🌟 ха'),
        ], 1, 1, 6, { wsMaxChars: 6 });
        expect(res.length).toBe(1);
        expect(res[0].text).toBe('🌟🌟🌟 ха');
    });

    it('mode 2 (custom) respects the max word count', () => {
        const res = smartRegroupSubs([block('00:00:00,000', '00:00:04,000', 'a b c d e')], 2, 2, 100, {});
        // 5 words, max 2 per phrase -> 3 phrases (2 + 2 + 1)
        expect(res.length).toBe(3);
        expect(res[0].text.split(' ').length).toBeLessThanOrEqual(2);
    });

    it('word timing never overruns the block end (regression)', () => {
        const res = smartRegroupSubs([block('00:00:00,000', '00:00:01,000', 'aaaa bb c')], 2, 10, 100, {});
        expect(res.length).toBe(1);
        const words = res[0].words;
        for (const w of words) {
            expect(tcToMs(w.end)).toBeLessThanOrEqual(1000);
            expect(tcToMs(w.start)).toBeGreaterThanOrEqual(0);
        }
        expect(tcToMs(res[0].end)).toBeLessThanOrEqual(1000);
    });

    it('keeps words in chronological, non-overlapping order', () => {
        const res = smartRegroupSubs([block('00:00:00,000', '00:00:03,000', 'one two three four')], 2, 10, 100, {});
        const words = res[0].words;
        for (let i = 1; i < words.length; i++) {
            expect(tcToMs(words[i].start)).toBeGreaterThanOrEqual(tcToMs(words[i - 1].start));
        }
    });
});

describe('Deliver grouping: mergePhraseDown', () => {
    const blocks = [
        phrase('Hello there', '00:00:00,000', '00:00:01,000', [W('Hello', '00:00:00,000', '00:00:00,500'), W('there', '00:00:00,500', '00:00:01,000')]),
        phrase('friend', '00:00:01,000', '00:00:02,000', [W('friend', '00:00:01,000', '00:00:02,000')]),
        phrase('bye', '00:00:02,000', '00:00:03,000', [W('bye', '00:00:02,000', '00:00:03,000')])
    ];

    it('joins a phrase with the one below it (text + words + end time)', () => {
        const out = mergePhraseDown(blocks, 0);
        expect(out).toHaveLength(2);
        expect(out[0].text).toBe('Hello there friend');
        expect(out[0].end).toBe('00:00:02,000');
        expect(out[0].words.map(w => w.text)).toEqual(['Hello', 'there', 'friend']);
    });

    it('is a no-op on the last block', () => {
        const out = mergePhraseDown(blocks, 2);
        expect(out).toBe(blocks);
    });
});

describe('Deliver grouping: splitPhraseAtWord', () => {
    const block = phrase('Hello there friend', '00:00:00,000', '00:00:03,000', [
        W('Hello', '00:00:00,000', '00:00:01,000'),
        W('there', '00:00:01,000', '00:00:02,000'),
        W('friend', '00:00:02,000', '00:00:03,000')
    ]);

    it('moves the tail (from wordIndex) down into a new phrase', () => {
        const out = splitPhraseAtWord([block], 0, 1);
        expect(out).toHaveLength(2);
        expect(out[0].text).toBe('Hello');
        expect(out[0].end).toBe('00:00:01,000');
        expect(out[1].text).toBe('there friend');
        expect(out[1].start).toBe('00:00:01,000');
        expect(out[1].words.map(w => w.text)).toEqual(['there', 'friend']);
    });

    it('is a no-op at boundaries (0 or last word index)', () => {
        const input = [block];
        expect(splitPhraseAtWord(input, 0, 0)).toBe(input);
        expect(splitPhraseAtWord(input, 0, 3)).toBe(input);
    });
});
