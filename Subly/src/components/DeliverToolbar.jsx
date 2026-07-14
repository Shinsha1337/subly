import React from 'react';
import { createPortal } from 'react-dom';
import { Select } from './Controls';

// Deliver sub-toolbar (Subly-стиль, Snap Captions-логика).
// Level 1: Phrases | Emphasis
// Level 2: Phrases → Grouping/Spelling, Emphasis → Color/Size/Font (multi)
// Level 3: controls only for enabled Emphasis tools.

const SIZE_PRESETS = [10, 20];
const FALLBACK_FONTS = ['Arial', 'Anton', 'Bebas Neue', 'Impact', 'Inter', 'Montserrat', 'Oswald', 'Roboto']
    .map(family => ({ family, styles: ['Regular'] }));
const DEFAULT_SAVED_COLORS = ['#6C5CE7'];
const MAX_SAVED_COLORS = 24;
const MAX_FAVORITE_FONTS = 64;
const HEX_COLOR = /^#[0-9A-F]{6}$/i;
const POPOVER_GAP = 8;
const VIEWPORT_PADDING = 12;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function normalizeHex(value, fallback = '#6C5CE7') {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toUpperCase();
    return HEX_COLOR.test(normalized) ? normalized : fallback;
}

function normalizePalette(value) {
    if (!Array.isArray(value)) return [...DEFAULT_SAVED_COLORS];
    return Array.from(new Set(
        value.filter(color => typeof color === 'string' && HEX_COLOR.test(color)).map(color => color.toUpperCase())
    )).slice(0, MAX_SAVED_COLORS);
}

function normalizeFavoriteFonts(value) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.reduce((fonts, font) => {
        const cleaned = typeof font === 'string' ? font.trim() : '';
        const key = cleaned.toLocaleLowerCase();
        if (cleaned && !seen.has(key) && fonts.length < MAX_FAVORITE_FONTS) {
            seen.add(key);
            fonts.push(cleaned);
        }
        return fonts;
    }, []);
}

function splitLegacyFont(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(.*?)\s*:\s*(.+)$/);
    return match
        ? { family: match[1].trim(), style: match[2].trim() || 'Regular' }
        : { family: text, style: 'Regular' };
}

function normalizeFontCatalog(value) {
    const catalog = new Map();
    for (const item of Array.isArray(value) ? value : []) {
        const legacy = typeof item === 'string' ? splitLegacyFont(item) : null;
        const family = String(legacy?.family || item?.family || '').trim();
        if (!family) continue;
        const styles = legacy ? [legacy.style] : (Array.isArray(item.styles) ? item.styles : ['Regular']);
        const key = family.toLocaleLowerCase();
        if (!catalog.has(key)) catalog.set(key, { family, styles: new Map() });
        for (const rawStyle of styles) {
            const style = String(rawStyle || 'Regular').trim() || 'Regular';
            catalog.get(key).styles.set(style.toLocaleLowerCase(), style);
        }
    }
    return Array.from(catalog.values())
        .map(item => ({ family: item.family, styles: Array.from(item.styles.values()) }))
        .sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }));
}

function fontPreviewStyle(family, style = 'Regular') {
    const normalized = String(style).toLocaleLowerCase().replace(/[\s-]/g, '');
    let fontWeight = 400;
    if (normalized.includes('thin')) fontWeight = 100;
    else if (normalized.includes('extralight') || normalized.includes('ultralight')) fontWeight = 200;
    else if (normalized.includes('light')) fontWeight = 300;
    else if (normalized.includes('medium')) fontWeight = 500;
    else if (normalized.includes('semibold') || normalized.includes('demibold')) fontWeight = 600;
    else if (normalized.includes('extrabold') || normalized.includes('ultrabold')) fontWeight = 800;
    else if (normalized.includes('black') || normalized.includes('heavy')) fontWeight = 900;
    else if (normalized.includes('bold')) fontWeight = 700;
    return {
        fontFamily: family,
        fontWeight,
        fontStyle: normalized.includes('italic') || normalized.includes('oblique') ? 'italic' : 'normal'
    };
}

function hexToRgb(hex) {
    const value = normalizeHex(hex).slice(1);
    return {
        r: parseInt(value.slice(0, 2), 16),
        g: parseInt(value.slice(2, 4), 16),
        b: parseInt(value.slice(4, 6), 16)
    };
}

function rgbToHex({ r, g, b }) {
    const channel = value => clamp(Math.round(Number(value) || 0), 0, 255).toString(16).padStart(2, '0');
    return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function rgbToHsv({ r, g, b }) {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const delta = max - min;
    let h = 0;
    if (delta) {
        if (max === red) h = 60 * (((green - blue) / delta) % 6);
        else if (max === green) h = 60 * (((blue - red) / delta) + 2);
        else h = 60 * (((red - green) / delta) + 4);
    }
    if (h < 0) h += 360;
    return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function hsvToHex({ h, s, v }) {
    const hue = ((h % 360) + 360) % 360;
    const chroma = v * s;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = v - chroma;
    let rgb;
    if (hue < 60) rgb = [chroma, x, 0];
    else if (hue < 120) rgb = [x, chroma, 0];
    else if (hue < 180) rgb = [0, chroma, x];
    else if (hue < 240) rgb = [0, x, chroma];
    else if (hue < 300) rgb = [x, 0, chroma];
    else rgb = [chroma, 0, x];
    return rgbToHex({ r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 });
}

function BigToggle({ options, value, onChange }) {
    return (
        <div className="dt-bigseg">
            {options.map(o => (
                <button
                    key={o.value}
                    className={'dt-bigbtn' + (value === o.value ? ' active' : '')}
                    onClick={() => onChange(o.value)}
                    type="button"
                >{o.label}</button>
            ))}
        </div>
    );
}

function ChildRow({ options, values, onChange, multi }) {
    return (
        <div className={'dt-childseg' + (multi ? ' multi' : '')}>
            {options.map(o => {
                const active = multi ? !!values[o.value] : values === o.value;
                return (
                    <button
                        key={o.value}
                        className={'dt-childbtn' + (active ? ' active' : '')}
                        onClick={() => multi ? onChange(o.value, !active) : onChange(o.value)}
                        type="button"
                    >{o.label}</button>
                );
            })}
        </div>
    );
}

function MenuSelect({ value, options, onChange, placeholder = 'Select...', className = '' }) {
    const [open, setOpen] = React.useState(false);
    const ref = React.useRef(null);

    React.useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        return () => document.removeEventListener('mousedown', onDoc);
    }, [open]);

    const current = options.find(o => String(o.value) === String(value));
    return (
        <div className={'dt-sel ' + className + (open ? ' open' : '')} ref={ref}>
            <button
                type="button"
                className="dt-sel-trigger"
                onClick={() => setOpen(o => !o)}
                style={className.includes('font') && value ? { fontFamily: value } : undefined}
            >
                <span>{current ? current.label : placeholder}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && (
                <div className="dt-sel-menu">
                    {options.map(o => (
                        <div
                            key={String(o.value)}
                            className={'dt-sel-opt' + (String(o.value) === String(value) ? ' active' : '')}
                            style={className.includes('font') && o.value ? { fontFamily: o.value } : undefined}
                            onClick={() => { onChange(o.value); setOpen(false); }}
                        >{o.label}</div>
                    ))}
                </div>
            )}
        </div>
    );
}

function ColorPickerPanel({ value, onChange, savedColors, onSaveColor, onDeleteColor, onClose, panelRef, style }) {
    const normalized = normalizeHex(value);
    const [hsv, setHsv] = React.useState(() => rgbToHsv(hexToRgb(normalized)));
    const [hexDraft, setHexDraft] = React.useState(normalized);
    const rgb = hexToRgb(normalized);

    React.useEffect(() => {
        setHexDraft(normalized);
        setHsv(current => hsvToHex(current) === normalized ? current : rgbToHsv(hexToRgb(normalized)));
    }, [normalized]);

    const applyHsv = next => {
        const safe = {
            h: ((Number(next.h) % 360) + 360) % 360,
            s: clamp(Number(next.s), 0, 1),
            v: clamp(Number(next.v), 0, 1)
        };
        setHsv(safe);
        onChange(hsvToHex(safe));
    };

    const updateSaturationValue = event => {
        const rect = event.currentTarget.getBoundingClientRect();
        applyHsv({
            ...hsv,
            s: (event.clientX - rect.left) / rect.width,
            v: 1 - ((event.clientY - rect.top) / rect.height)
        });
    };

    const handleSvPointerDown = event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateSaturationValue(event);
    };

    const handleSvPointerMove = event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationValue(event);
    };

    const setRgbChannel = (channel, rawValue) => {
        const next = { ...rgb, [channel]: clamp(parseInt(rawValue || '0', 10) || 0, 0, 255) };
        onChange(rgbToHex(next));
    };

    const isSaved = savedColors.includes(normalized);
    const paletteFull = savedColors.length >= MAX_SAVED_COLORS;

    return (
        <div ref={panelRef} className="dt-color-popover" role="dialog" aria-label="Emphasis color picker" style={style}>
            <div className="dt-color-popover-head">
                <span>Emphasis Color</span>
                <button type="button" className="dt-color-close" onClick={onClose} aria-label="Close color picker">×</button>
            </div>

            <div
                className="dt-color-sv"
                style={{ '--picker-hue': `hsl(${hsv.h}, 100%, 50%)` }}
                onPointerDown={handleSvPointerDown}
                onPointerMove={handleSvPointerMove}
            >
                <span className="dt-color-sv-cursor" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
            </div>

            <div className="dt-color-hue-row">
                <span className="dt-color-preview" style={{ background: normalized }} />
                <input
                    className="dt-color-hue"
                    type="range"
                    min="0"
                    max="359"
                    value={Math.round(hsv.h)}
                    onChange={event => applyHsv({ ...hsv, h: Number(event.target.value) })}
                    aria-label="Hue"
                />
            </div>

            <div className="dt-color-fields">
                <label className="dt-color-field dt-color-hex-field">
                    <input
                        value={hexDraft}
                        maxLength={7}
                        onChange={event => {
                            const next = event.target.value.toUpperCase();
                            setHexDraft(next);
                            if (HEX_COLOR.test(next)) onChange(next);
                        }}
                        onBlur={() => setHexDraft(normalized)}
                        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                    />
                    <span>HEX</span>
                </label>
                {['r', 'g', 'b'].map(channel => (
                    <label className="dt-color-field" key={channel}>
                        <input
                            type="number"
                            min="0"
                            max="255"
                            value={rgb[channel]}
                            onChange={event => setRgbChannel(channel, event.target.value)}
                        />
                        <span>{channel.toUpperCase()}</span>
                    </label>
                ))}
            </div>

            <div className="dt-palette-head">
                <span>Saved colors</span>
                <button
                    type="button"
                    className="dt-palette-add"
                    onClick={() => onSaveColor(normalized)}
                    disabled={isSaved || paletteFull}
                    title={isSaved ? 'Color already saved' : paletteFull ? `Palette is limited to ${MAX_SAVED_COLORS} colors` : 'Save current color'}
                >+ Save</button>
            </div>
            {savedColors.length ? (
                <div className="dt-saved-colors">
                    {savedColors.map(color => (
                        <div className="dt-saved-color" key={color}>
                            <button
                                type="button"
                                className={'dt-saved-swatch' + (color === normalized ? ' active' : '')}
                                style={{ background: color }}
                                onClick={() => onChange(color)}
                                title={color}
                                aria-label={`Use saved color ${color}`}
                            />
                            <button
                                type="button"
                                className="dt-saved-remove"
                                onClick={() => onDeleteColor(color)}
                                title={`Remove ${color}`}
                                aria-label={`Remove saved color ${color}`}
                            >×</button>
                        </div>
                    ))}
                </div>
            ) : <div className="dt-palette-empty">Save frequently used colors here.</div>}
        </div>
    );
}

function ColorControl({ value, onChange, savedColors, onSavedColorsChange }) {
    const [open, setOpen] = React.useState(false);
    const [popoverStyle, setPopoverStyle] = React.useState({ visibility: 'hidden' });
    const controlRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const panelRef = React.useRef(null);

    const updatePopoverPosition = React.useCallback(() => {
        const trigger = triggerRef.current;
        const panel = panelRef.current;
        if (!trigger || !panel) return;

        const triggerRect = trigger.getBoundingClientRect();
        const panelRect = panel.getBoundingClientRect();
        const maxLeft = Math.max(VIEWPORT_PADDING, window.innerWidth - panelRect.width - VIEWPORT_PADDING);
        const left = clamp(triggerRect.left, VIEWPORT_PADDING, maxLeft);
        const below = triggerRect.bottom + POPOVER_GAP;
        const above = triggerRect.top - panelRect.height - POPOVER_GAP;
        const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - panelRect.height - VIEWPORT_PADDING);
        const top = below + panelRect.height <= window.innerHeight - VIEWPORT_PADDING
            ? below
            : above >= VIEWPORT_PADDING ? above : clamp(below, VIEWPORT_PADDING, maxTop);
        const next = { left: Math.round(left), top: Math.round(top), visibility: 'visible' };

        setPopoverStyle(current => (
            current.left === next.left && current.top === next.top && current.visibility === next.visibility
                ? current
                : next
        ));
    }, []);

    React.useEffect(() => {
        if (!open) return undefined;
        const closeOnOutside = event => {
            const outsideControl = !controlRef.current?.contains(event.target);
            const outsidePanel = !panelRef.current?.contains(event.target);
            if (outsideControl && outsidePanel) setOpen(false);
        };
        const closeOnEscape = event => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', closeOnOutside);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    React.useLayoutEffect(() => {
        if (!open) return undefined;
        updatePopoverPosition();
        window.addEventListener('resize', updatePopoverPosition);
        window.addEventListener('scroll', updatePopoverPosition, true);
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(updatePopoverPosition)
            : null;
        if (panelRef.current) observer?.observe(panelRef.current);
        return () => {
            window.removeEventListener('resize', updatePopoverPosition);
            window.removeEventListener('scroll', updatePopoverPosition, true);
            observer?.disconnect();
        };
    }, [open, savedColors.length, updatePopoverPosition]);

    const saveColor = color => onSavedColorsChange(normalizePalette([color, ...savedColors]));
    const deleteColor = color => onSavedColorsChange(savedColors.filter(saved => saved !== color));

    return (
        <div className={'dt-control dt-ctl-color' + (open ? ' open' : '')} ref={controlRef}>
            <button
                ref={triggerRef}
                type="button"
                className="dt-color-trigger"
                onClick={() => {
                    setPopoverStyle({ visibility: 'hidden' });
                    setOpen(current => !current);
                }}
                title="Choose color"
                aria-label="Choose emphasis color"
                aria-expanded={open}
            >
                <span className="dt-color-box" style={{ background: normalizeHex(value) }} />
            </button>
            {open && createPortal(
                <ColorPickerPanel
                    value={value}
                    onChange={onChange}
                    savedColors={savedColors}
                    onSaveColor={saveColor}
                    onDeleteColor={deleteColor}
                    onClose={() => setOpen(false)}
                    panelRef={panelRef}
                    style={popoverStyle}
                />,
                document.body
            )}
        </div>
    );
}

function FontSelect({ value, fonts, favorites, onChange, onFavoritesChange }) {
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const [expandedFamilies, setExpandedFamilies] = React.useState(() => new Set());
    const [menuStyle, setMenuStyle] = React.useState({ visibility: 'hidden' });
    const rootRef = React.useRef(null);
    const triggerRef = React.useRef(null);
    const menuRef = React.useRef(null);
    const searchRef = React.useRef(null);
    const listRef = React.useRef(null);
    const selectedFamily = String(value?.family || '').trim();
    const selectedStyle = String(value?.style || 'Regular').trim() || 'Regular';
    const favoriteKeys = React.useMemo(
        () => new Set(favorites.map(font => font.toLocaleLowerCase())),
        [favorites]
    );
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = item => !normalizedQuery
        || item.family.toLocaleLowerCase().includes(normalizedQuery)
        || item.styles.some(style => style.toLocaleLowerCase().includes(normalizedQuery));
    const favoriteFonts = fonts.filter(item => favoriteKeys.has(item.family.toLocaleLowerCase()) && matches(item));
    const otherFonts = fonts.filter(item => !favoriteKeys.has(item.family.toLocaleLowerCase()) && matches(item));

    const updateMenuPosition = React.useCallback(() => {
        const trigger = triggerRef.current;
        const menu = menuRef.current;
        if (!trigger || !menu) return;

        const triggerRect = trigger.getBoundingClientRect();
        const editorRect = rootRef.current?.closest('.editor-panel')?.getBoundingClientRect();
        const minLeft = Math.max(VIEWPORT_PADDING, (editorRect?.left ?? 0) + VIEWPORT_PADDING);
        const availableWidth = Math.max(0, window.innerWidth - minLeft - VIEWPORT_PADDING);
        const width = Math.min(260, availableWidth);
        const maxLeft = Math.max(minLeft, window.innerWidth - width - VIEWPORT_PADDING);
        const left = clamp(triggerRect.right - width, minLeft, maxLeft);
        const menuHeight = menu.getBoundingClientRect().height;
        const below = triggerRect.bottom + POPOVER_GAP;
        const above = triggerRect.top - menuHeight - POPOVER_GAP;
        const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - menuHeight - VIEWPORT_PADDING);
        const top = below + menuHeight <= window.innerHeight - VIEWPORT_PADDING
            ? below
            : above >= VIEWPORT_PADDING ? above : clamp(below, VIEWPORT_PADDING, maxTop);

        setMenuStyle({
            left: Math.round(left),
            top: Math.round(top),
            width: Math.round(width),
            visibility: 'visible'
        });
    }, []);

    React.useEffect(() => {
        if (!open) return undefined;
        const closeOnOutside = event => {
            const outsideTrigger = !rootRef.current?.contains(event.target);
            const outsideMenu = !menuRef.current?.contains(event.target);
            if (outsideTrigger && outsideMenu) setOpen(false);
        };
        const closeOnEscape = event => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', closeOnOutside);
        document.addEventListener('keydown', closeOnEscape);
        requestAnimationFrame(() => searchRef.current?.focus());
        return () => {
            document.removeEventListener('pointerdown', closeOnOutside);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [open]);

    React.useLayoutEffect(() => {
        if (!open) return undefined;
        updateMenuPosition();
        window.addEventListener('resize', updateMenuPosition);
        window.addEventListener('scroll', updateMenuPosition, true);
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(updateMenuPosition)
            : null;
        if (menuRef.current) observer?.observe(menuRef.current);
        return () => {
            window.removeEventListener('resize', updateMenuPosition);
            window.removeEventListener('scroll', updateMenuPosition, true);
            observer?.disconnect();
        };
    }, [open, updateMenuPosition]);

    const choose = selection => {
        onChange(selection);
        setOpen(false);
        setQuery('');
    };
    const toggleFavorite = family => {
        const key = family.toLocaleLowerCase();
        const next = favoriteKeys.has(key)
            ? favorites.filter(item => item.toLocaleLowerCase() !== key)
            : [family, ...favorites];
        onFavoritesChange(normalizeFavoriteFonts(next));
    };
    const toggleExpanded = family => {
        const key = family.toLocaleLowerCase();
        setExpandedFamilies(current => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };
    const focusAdjacent = (event, direction) => {
        const options = listRef.current
            ? Array.from(listRef.current.querySelectorAll('.dt-font-family, [role="option"]'))
            : [];
        const index = options.indexOf(event.currentTarget);
        if (options.length) options[(index + direction + options.length) % options.length]?.focus();
    };
    const renderFamily = (item, favorite) => {
        const key = item.family.toLocaleLowerCase();
        const expanded = expandedFamilies.has(key) || (!!normalizedQuery && matches(item));
        const familySelected = selectedFamily.toLocaleLowerCase() === key;
        return (
            <React.Fragment key={item.family}>
                <div
                    role="button"
                    tabIndex={0}
                    aria-expanded={expanded}
                    className={'dt-font-option dt-font-family' + (familySelected ? ' selected' : '')}
                    onClick={() => toggleExpanded(item.family)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleExpanded(item.family); }
                        else if (event.key === 'ArrowDown') { event.preventDefault(); focusAdjacent(event, 1); }
                        else if (event.key === 'ArrowUp') { event.preventDefault(); focusAdjacent(event, -1); }
                    }}
                >
                    <svg className={'dt-font-expand' + (expanded ? ' open' : '')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
                    <span className="dt-font-option-name" style={{ fontFamily: item.family }}>{item.family}</span>
                    <button
                        type="button"
                        className={'dt-font-favorite' + (favorite ? ' active' : '')}
                        aria-label={`${favorite ? 'Remove' : 'Add'} ${item.family} ${favorite ? 'from' : 'to'} favorites`}
                        aria-pressed={favorite}
                        onClick={event => { event.stopPropagation(); toggleFavorite(item.family); }}
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17l-5.56 2.92 1.06-6.2L3 9.33l6.22-.9L12 2.8Z" /></svg>
                    </button>
                </div>
                {expanded && (
                    <div className="dt-font-styles">
                        {item.styles.map(style => {
                            const active = familySelected && selectedStyle.toLocaleLowerCase() === style.toLocaleLowerCase();
                            return (
                                <div
                                    key={`${item.family}:${style}`}
                                    role="option"
                                    tabIndex={0}
                                    aria-selected={active}
                                    className={'dt-font-style-option' + (active ? ' active' : '')}
                                    style={fontPreviewStyle(item.family, style)}
                                    onClick={() => choose({ family: item.family, style })}
                                    onKeyDown={event => {
                                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose({ family: item.family, style }); }
                                        else if (event.key === 'ArrowDown') { event.preventDefault(); focusAdjacent(event, 1); }
                                        else if (event.key === 'ArrowUp') { event.preventDefault(); focusAdjacent(event, -1); }
                                    }}
                                >{style}</div>
                            );
                        })}
                    </div>
                )}
            </React.Fragment>
        );
    };

    return (
        <div className={'sel dt-font-select dt-font-picker' + (open ? ' open' : '')} ref={rootRef}>
            <button
                ref={triggerRef}
                type="button"
                className="sel-trigger dt-font-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => {
                    setQuery('');
                    setMenuStyle({ visibility: 'hidden' });
                    if (selectedFamily) setExpandedFamilies(current => new Set(current).add(selectedFamily.toLocaleLowerCase()));
                    setOpen(current => !current);
                }}
            >
                <span className="sel-label" style={selectedFamily ? fontPreviewStyle(selectedFamily, selectedStyle) : undefined}>
                    {selectedFamily ? `${selectedFamily} · ${selectedStyle}` : 'Select Font...'}
                </span>
                <svg className="sel-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && createPortal(
                <div ref={menuRef} className="sel-menu dt-font-menu" style={menuStyle}>
                    <div className="dt-font-search-wrap">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
                        <input
                            ref={searchRef}
                            type="text"
                            className="dt-font-search"
                            value={query}
                            onChange={event => setQuery(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'ArrowDown') {
                                    event.preventDefault();
                                    listRef.current?.querySelector('.dt-font-family, [role="option"]')?.focus();
                                }
                            }}
                            placeholder="Search fonts..."
                            aria-label="Search fonts"
                        />
                    </div>
                    <div className="dt-font-list" role="listbox" ref={listRef}>
                        {favoriteFonts.map(item => renderFamily(item, true))}
                        {favoriteFonts.length > 0 && (!normalizedQuery || otherFonts.length > 0) && <div className="dt-font-separator" role="separator" />}
                        {!normalizedQuery && (
                            <div
                                role="option"
                                tabIndex={0}
                                aria-selected={!selectedFamily}
                                className={'dt-font-option dt-font-default' + (!selectedFamily ? ' active' : '')}
                                onClick={() => choose({ family: '', style: '' })}
                                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') choose({ family: '', style: '' }); }}
                            >Default font</div>
                        )}
                        {otherFonts.map(item => renderFamily(item, false))}
                        {favoriteFonts.length === 0 && otherFonts.length === 0 && <div className="dt-font-empty">No fonts found</div>}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
}

function EmphasisValueRow({ emph, setEmph, fonts, savedColors, onSavedColorsChange, favoriteFonts, onFavoriteFontsChange }) {
    const sizeOptions = [
        ...SIZE_PRESETS.map(size => ({ value: size, label: `${size}%` })),
        { value: 'custom', label: 'Custom' }
    ];

    return (
        <div className="dt-value-row">
            {emph.color && (
                <ColorControl
                    value={emph.colorValue}
                    onChange={colorValue => setEmph(current => ({ ...current, colorValue }))}
                    savedColors={savedColors}
                    onSavedColorsChange={onSavedColorsChange}
                />
            )}

            {emph.size && (
                <div className="dt-control dt-ctl-size">
                    <Select
                        className="dt-inline-select dt-size-select"
                        value={emph.sizePreset}
                        options={sizeOptions}
                        onChange={(value) => {
                            if (value === 'custom') setEmph({ ...emph, sizePreset: 'custom' });
                            else setEmph({ ...emph, sizePreset: value, sizeValue: Number(value) });
                        }}
                    />
                    {emph.sizePreset === 'custom' && (
                        <input
                            className="dt-custom-size"
                            value={emph.sizeValue}
                            onChange={(e) => setEmph({ ...emph, sizeValue: e.target.value.replace(/[^0-9]/g, '').slice(0, 3) })}
                            onBlur={(e) => {
                                const n = parseInt(e.target.value, 10);
                                setEmph({ ...emph, sizeValue: Number.isFinite(n) ? Math.min(300, Math.max(1, n)) : 20 });
                            }}
                            inputMode="numeric"
                        />
                    )}
                </div>
            )}

            {emph.font && (
                <div className="dt-control dt-ctl-font">
                    <FontSelect
                        value={{ family: emph.fontValue || '', style: emph.fontStyleValue || 'Regular' }}
                        fonts={fonts}
                        favorites={favoriteFonts}
                        onChange={({ family, style }) => setEmph({
                            ...emph,
                            fontValue: family,
                            fontStyleValue: family ? (style || 'Regular') : ''
                        })}
                        onFavoritesChange={onFavoriteFontsChange}
                    />
                </div>
            )}
        </div>
    );
}

export default function DeliverToolbar({
    section, setSection,
    phrasesTool, setPhrasesTool,
    emph, setEmph
}) {
    const [fonts, setFonts] = React.useState(() => normalizeFontCatalog(FALLBACK_FONTS));
    const [savedColors, setSavedColors] = React.useState(DEFAULT_SAVED_COLORS);
    const [favoriteFonts, setFavoriteFonts] = React.useState([]);

    React.useEffect(() => {
        let alive = true;
        window.windowAPI?.getFonts?.()
            .then(list => {
                if (!alive || !Array.isArray(list) || !list.length) return;
                const detected = normalizeFontCatalog(list);
                const detectedKeys = new Set(detected.map(item => item.family.toLocaleLowerCase()));
                const missingFallbacks = FALLBACK_FONTS.filter(item => !detectedKeys.has(item.family.toLocaleLowerCase()));
                setFonts(normalizeFontCatalog([...detected, ...missingFallbacks]));
            })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    React.useEffect(() => {
        let alive = true;
        window.configAPI?.get?.()
            .then(config => {
                if (alive) {
                    setSavedColors(normalizePalette(config?.emphasis_colors));
                    setFavoriteFonts(normalizeFavoriteFonts(config?.favorite_fonts));
                }
            })
            .catch(() => {});
        return () => { alive = false; };
    }, []);

    const updateSavedColors = React.useCallback(colors => {
        const normalized = normalizePalette(colors);
        setSavedColors(normalized);
        window.configAPI?.set?.({ emphasis_colors: normalized })?.catch?.(() => {});
    }, []);

    const updateFavoriteFonts = React.useCallback(fontsToSave => {
        const normalized = normalizeFavoriteFonts(fontsToSave);
        setFavoriteFonts(normalized);
        window.configAPI?.set?.({ favorite_fonts: normalized })?.catch?.(() => {});
    }, []);

    return (
        <div className="deliver-toolbar">
            <BigToggle
                options={[
                    { value: 'phrases',  label: 'Phrases' },
                    { value: 'emphasis', label: 'Emphasis' }
                ]}
                value={section}
                onChange={setSection}
            />

            {section === 'phrases' && (
                <ChildRow
                    options={[
                        { value: 'grouping', label: 'Grouping' },
                        { value: 'spelling', label: 'Spelling' }
                    ]}
                    values={phrasesTool}
                    onChange={setPhrasesTool}
                    multi={false}
                />
            )}

            {section === 'emphasis' && (
                <>
                    <ChildRow
                        options={[
                            { value: 'color', label: 'Color' },
                            { value: 'size',  label: 'Size' },
                            { value: 'font',  label: 'Font' }
                        ]}
                        values={{ color: emph.color, size: emph.size, font: emph.font }}
                        onChange={(key, value) => setEmph({ ...emph, [key]: value })}
                        multi={true}
                    />
                    {(emph.color || emph.size || emph.font) && (
                        <EmphasisValueRow
                            emph={emph}
                            setEmph={setEmph}
                            fonts={fonts}
                            savedColors={savedColors}
                            onSavedColorsChange={updateSavedColors}
                            favoriteFonts={favoriteFonts}
                            onFavoriteFontsChange={updateFavoriteFonts}
                        />
                    )}
                </>
            )}
        </div>
    );
}
