import React, { useState } from 'react';

export default function TimelineBadge({ timelineName }) {
    const [showTooltip, setShowTooltip] = useState(false);
    const [isLeaving, setIsLeaving] = useState(false);

    const handleMouseEnter = () => {
        setIsLeaving(false);
        setShowTooltip(true);
    };

    const handleMouseLeave = () => {
        setIsLeaving(true);
        setTimeout(() => setShowTooltip(false), 150);
    };

    return (
        <div
            className="timeline-badge"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            <span className="timeline-dot" />
            <span className="timeline-name">{timelineName}</span>

            {showTooltip && (
                <div className={`timeline-tooltip${isLeaving ? ' leaving' : ''}`}>
                    <div className="timeline-tooltip-header">
                        <svg className="timeline-tooltip-icon resolve-icon" viewBox="0 0 50 50" fill="none">
                            <circle cx="25" cy="25" r="23" fill="none" stroke="currentColor" strokeWidth="2" />
                            <path d="M25 8C21.14 8 18 10.968 18 14.615C18 18.161 21.284 22.184 24.357 24.766C24.543 24.922 24.771 25 25 25s.458-.078.643-.234C28.716 22.184 32 18.161 32 14.615C32 10.969 28.86 8 25 8zM15.43 25.008c-1.566.04-3.022.34-4.186 1.004-1.489.85-2.557 2.254-3.012 3.95-.483 1.8-.206 3.782.76 5.44 1.338 2.295 3.73 3.597 6.13 3.597 1.092 0 2.188-.27 3.187-.84 3.106-1.777 4.968-6.639 5.676-10.598.086-.48-.186-.952-.645-1.117-2.383-.856-5.3-1.503-7.91-1.435zm19.142 0c-2.61-.068-5.527.58-7.91 1.435-.459.165-.732.639-.646 1.117.707 3.96 2.57 8.823 5.676 10.598.998.57 2.093.84 3.187.84 2.4 0 4.79-1.301 6.13-3.596.967-1.658 1.242-3.639.76-5.44-.454-1.697-1.525-3.1-3.014-3.95-1.163-.663-2.618-.962-4.183-1.004z" fill="currentColor" />
                        </svg>
                        <div className="timeline-tooltip-text">
                            <div className="timeline-tooltip-title">DaVinci Resolve</div>
                            <div className="timeline-tooltip-status">Connected</div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
