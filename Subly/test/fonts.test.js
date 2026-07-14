import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { buildFontCatalog, parseFallbackFace } = require('../ipc/fonts.js');

describe('system font catalog', () => {
    it('separates Windows registry family and style labels', () => {
        expect(parseFallbackFace('Bebas Neue : Black (TrueType)')).toEqual({
            family: 'Bebas Neue',
            style: 'Black'
        });
    });

    it('groups installed faces under one family', () => {
        expect(buildFontCatalog([
            { family: 'Bebas Neue', style: 'Regular' },
            { family: 'Bebas Neue', style: 'Black' },
            { family: 'Bebas Neue', style: 'Thin' }
        ])).toEqual([{
            family: 'Bebas Neue',
            styles: ['Thin', 'Regular', 'Black']
        }]);
    });
});
