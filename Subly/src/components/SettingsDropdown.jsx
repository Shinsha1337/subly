import React, { useState, useEffect, useRef } from 'react';
import { Settings } from './Icons';

const Svg = ({ children, ...p }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}>{children}</svg>;

const SlidersIcon = () => (
    <Svg><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="12" x2="15" y2="12" /><line x1="17" y1="16" x2="23" y2="16" /></Svg>
);

const GithubIcon = () => (
    <Svg><path d="M9 19c-4.3 1.4 -4.3 -2.5 -6 -3m12 5v-3.5c0 -1 .1 -1.4 -.5 -2c2.8 -.3 5.5 -1.4 5.5 -6a4.6 4.6 0 0 0 -1.3 -3.2a4.2 4.2 0 0 0 -.1 -3.2s-1.1 -.3 -3.5 1.3a12.3 12.3 0 0 0 -6.2 0c-2.4 -1.6 -3.5 -1.3 -3.5 -1.3a4.2 4.2 0 0 0 -.1 3.2a4.6 4.6 0 0 0 -1.3 3.2c0 4.6 2.7 5.7 5.5 6c-.6 .6 -.6 1.2 -.5 2v3.5" /></Svg>
);

const HeartIcon = () => (
    <Svg><path d="M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572" /></Svg>
);

const HeartFilledIcon = () => (
    <svg viewBox="0 0 24 24" fill="currentColor" className="heart-filled"><path d="M6.979 3.074a6 6 0 0 1 4.988 1.425l.037 .033l.034 -.03a6 6 0 0 1 4.733 -1.44l.246 .036a6 6 0 0 1 3.364 10.008l-.18 .185l-.048 .041l-7.45 7.379a1 1 0 0 1 -1.313 .082l-.094 -.082l-7.493 -7.422a6 6 0 0 1 3.176 -10.215z" /></svg>
);

const SunIcon = () => (
    <Svg><circle cx="12" cy="12" r="4" /><path d="M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7" /></Svg>
);

const MoonIcon = () => (
    <Svg><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008" /></Svg>
);

const DesktopIcon = () => (
    <Svg><path d="M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10" /><path d="M7 20h10" /><path d="M9 16v4" /><path d="M15 16v4" /></Svg>
);

export default function SettingsDropdown({ onOpenSettings, theme, onThemeChange }) {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [heartHover, setHeartHover] = useState(false);
    const ref = useRef(null);
    const closeTimerRef = useRef(null);

    const clearCloseTimer = () => {
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };

    const openMenu = () => {
        clearCloseTimer();
        setClosing(false);
        setOpen(true);
    };

    const closeMenu = (afterClose) => {
        if (!open || closing) {
            if (afterClose) afterClose();
            return;
        }
        clearCloseTimer();
        setClosing(true);
        closeTimerRef.current = window.setTimeout(() => {
            setOpen(false);
            setClosing(false);
            closeTimerRef.current = null;
            if (afterClose) afterClose();
        }, 150);
    };

    const toggleMenu = () => {
        if (open && !closing) closeMenu();
        else openMenu();
    };

    useEffect(() => () => clearCloseTimer(), []);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) closeMenu();
        };
        // Use mousedown so we catch the click before any other handler
        window.addEventListener('mousedown', handler);
        return () => window.removeEventListener('mousedown', handler);
    }, [open, closing]);

    const handleOpenSettings = () => {
        closeMenu(onOpenSettings);
    };

    const openExternal = (url) => {
        closeMenu(() => window.windowAPI.openExternal(url));
    };

    return (
        <div className="settings-dropdown" ref={ref}>
            <button
                className={`icon-btn${open ? ' active' : ''}`}
                onClick={toggleMenu}
            >
                <Settings />
            </button>
            {open && (
                <div className={`dropdown-menu${closing ? ' closing' : ''}`}>
                    <button className="dropdown-item" onClick={handleOpenSettings}>
                        <SlidersIcon /> Presets
                    </button>
                    <div className="dropdown-sep" />
                    <button className="dropdown-item" onClick={() => openExternal('https://github.com/Shinsha1337/subly')}>
                        <GithubIcon /> GitHub
                    </button>
                    <button
                        className="dropdown-item support-item"
                        onMouseEnter={() => setHeartHover(true)}
                        onMouseLeave={() => setHeartHover(false)}
                        onClick={() => openExternal('https://boosty.to/shinsha')}
                    >
                        {heartHover ? <HeartFilledIcon /> : <HeartIcon />} Support
                    </button>
                    <div className="dropdown-sep" />
                    <div className="dropdown-theme-group">
                        <button
                            className={`dropdown-theme-btn${theme === 'light' ? ' active' : ''}`}
                            data-tip="Light"
                            onClick={() => onThemeChange('light')}
                        >
                            <SunIcon />
                        </button>
                        <button
                            className={`dropdown-theme-btn${theme === 'dark' ? ' active' : ''}`}
                            data-tip="Dark"
                            onClick={() => onThemeChange('dark')}
                        >
                            <MoonIcon />
                        </button>
                        <button
                            className={`dropdown-theme-btn${theme === 'auto' ? ' active' : ''}`}
                            data-tip="Auto"
                            onClick={() => onThemeChange('auto')}
                        >
                            <DesktopIcon />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
