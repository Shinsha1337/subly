import React from 'react';

// Custom dropdown — replaces the native <select> whose popup list is drawn by
// the OS (Windows paints the highlighted row in the system accent = blue, which
// CSS can't override). This renders the list ourselves so selection styling is
// fully ours (purple), no blue anywhere.
export function Select({ value, options, onChange, className = '' }) {
    const [open, setOpen] = React.useState(false);
    const [hasScroll, setHasScroll] = React.useState(false);
    const ref = React.useRef(null);
    const menuRef = React.useRef(null);
    const current = options.find(o => String(o.value) === String(value));

    React.useEffect(() => {
        if (!open) return undefined;
        const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
    }, [open]);

    // On open, move keyboard focus to the selected option (or the first one).
    React.useEffect(() => {
        if (!open || !menuRef.current) return;
        const sel = menuRef.current.querySelector('[aria-selected="true"]') || menuRef.current.firstChild;
        if (sel && sel.focus) sel.focus();
    }, [open]);

    React.useLayoutEffect(() => {
        if (!open || !menuRef.current) return undefined;
        const el = menuRef.current;
        const update = () => setHasScroll(el.scrollHeight > el.clientHeight + 1);
        update();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
        if (ro) ro.observe(el);
        window.addEventListener('resize', update);
        return () => {
            if (ro) ro.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [open, options.length]);

    const choose = (v) => { onChange(v); setOpen(false); };

    const onTriggerKey = (e) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(true); }
    };

    const onOptKey = (e, idx) => {
        const items = menuRef.current ? Array.from(menuRef.current.children) : [];
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(options[idx].value); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
    };

    return (
        <div className={'sel' + (className ? ' ' + className : '') + (open ? ' open' : '')} ref={ref}>
            <button
                type="button"
                className="sel-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                onKeyDown={onTriggerKey}
            >
                <span className="sel-label">{current ? current.label : ''}</span>
                <svg className="sel-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {open && (
                <div className="sel-menu">
                    <div className={'sel-menu-scroll' + (hasScroll ? ' has-scroll' : '')} role="listbox" ref={menuRef}>
                        {options.map((o, idx) => (
                            <div
                                key={String(o.value)}
                                role="option"
                                tabIndex={0}
                                aria-selected={String(o.value) === String(value)}
                                className={'sel-opt' + (String(o.value) === String(value) ? ' active' : '')}
                                onClick={() => choose(o.value)}
                                onKeyDown={(e) => onOptKey(e, idx)}
                            >
                                {o.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export function Toggle({ value, onChange }) {
    return (
        <div
            className={'toggle' + (value ? ' on' : '')}
            role="switch"
            aria-checked={value}
            tabIndex={0}
            onClick={() => onChange(!value)}
            onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onChange(!value); } }}
        >
            <div className="knob" />
        </div>
    );
}

// snap   — value the thumb sticks to when dragged close (e.g. 0.5 for X/Y)
// The number field keeps a local draft while focused so digits can be erased
// freely; it clamps to [min,max] only on blur/Enter (ported from widgets.py).
export function Slider({ label, value, min, max, step, decimals = 3, snap = null, snapThreshold = 0.015, strong = false, onChange }) {
    const [editing, setEditing] = React.useState(false);
    const [draft, setDraft] = React.useState('');

    const fmt = (v) => (typeof v === 'number' ? v.toFixed(decimals) : String(v));
    const display = editing ? draft : fmt(value);
    const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0;

    const handleRange = (e) => {
        let v = parseFloat(e.target.value);
        if (snap != null && Math.abs(v - snap) <= snapThreshold) v = snap;
        onChange(v);
    };

    const handleText = (e) => {
        const raw = e.target.value;
        setDraft(raw);
        // commit live only for a complete, in-range number; partial input
        // ("", "-", ".", "0.") is left alone until blur so it can be erased.
        if (raw === '' || raw === '-' || raw === '.' || raw.endsWith('.')) return;
        const v = parseFloat(raw);
        if (!Number.isNaN(v) && v >= min && v <= max) onChange(v);
    };

    const commit = () => {
        setEditing(false);
        let v = parseFloat(draft);
        if (Number.isNaN(v)) return; // empty/garbage → keep current value
        v = Math.min(max, Math.max(min, v));
        onChange(v);
    };

    return (
        <div className="slider-block">
            <span className={strong ? 'strong-label' : 'field-label'}>{label}</span>
            <div className="slider-row">
                <input
                    type="range"
                    min={min} max={max} step={step} value={value}
                    style={{ background: `linear-gradient(to right, #493D90 0%, #493D90 ${pct}%, var(--slider-track) ${pct}%, var(--slider-track) 100%)` }}
                    onChange={handleRange}
                />
                <input
                    className="slider-val"
                    value={display}
                    onFocus={() => { setEditing(true); setDraft(fmt(value)); }}
                    onChange={handleText}
                    onBlur={commit}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                />
            </div>
        </div>
    );
}

export function Chips({ options, value, onChange }) {
    return (
        <div className="chips">
            {options.map(opt => (
                <button
                    key={opt.value}
                    className={'chip' + (value === opt.value ? ' active' : '')}
                    onClick={() => onChange(opt.value)}
                >
                    {opt.label}
                </button>
            ))}
        </div>
    );
}

// allKey — when this chip is active, every other chip is disabled (the "All"
// punctuation option makes the individual marks irrelevant).
export function MultiChips({ options, values, onToggle, allKey = 'p_all' }) {
    const allOn = !!values[allKey];
    return (
        <div className="chips">
            {options.map(opt => {
                const isAll = opt.key === allKey;
                const disabled = allOn && !isAll;
                return (
                    <button
                        key={opt.key}
                        className={'chip' + (values[opt.key] ? ' active' : '')}
                        disabled={disabled}
                        onClick={() => onToggle(opt.key)}
                    >
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );
}
