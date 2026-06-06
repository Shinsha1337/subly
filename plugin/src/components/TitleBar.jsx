import { Close, Minimize, Maximize, Restore } from './Icons';
import SettingsDropdown from './SettingsDropdown';
import TimelineBadge from './TimelineBadge';

export default function TitleBar({ status, timelineName, maximized, onOpenSettings, theme, onThemeChange }) {
    const isMac = window.windowAPI.platform === 'darwin';

    return (
        <header className={'titlebar' + (isMac ? ' macos' : '')}>
            <div className="tb-left">
                {!isMac && <SettingsDropdown onOpenSettings={onOpenSettings} theme={theme} onThemeChange={onThemeChange} />}
            </div>
            <div className="tb-center">
                {status === 'connected' && timelineName && (
                    <TimelineBadge timelineName={timelineName} />
                )}
            </div>
            <div className="tb-right">
                {isMac ? (
                    <SettingsDropdown onOpenSettings={onOpenSettings} theme={theme} onThemeChange={onThemeChange} />
                ) : (
                    <>
                        <button className="icon-btn win-btn min" onClick={() => window.windowAPI.minimize()}><Minimize /></button>
                        <button
                            className="icon-btn win-btn max"
                            data-tip={maximized ? 'Restore down' : 'Maximize'}
                            onClick={() => window.windowAPI.toggleMaximize()}
                        >
                            {maximized ? <Restore /> : <Maximize />}
                        </button>
                        <button className="icon-btn win-btn close" onClick={() => window.windowAPI.close()}><Close /></button>
                    </>
                )}
            </div>
        </header>
    );
}
