--[[ ============================================================================
  Subly — uninstaller for the DaVinci Resolve Workflow Integration plugin.

  HOW TO USE
    Open DaVinci Resolve, then  Workspace -> Console  (set the language to Lua),
    and drop / run this file. It removes the installed plugin folder. No batch
    files, no extra tooling.

  REMOVES
    Windows : %PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\
              Workflow Integration Plugins\subly
    macOS   : /Library/Application Support/Blackmagic Design/DaVinci Resolve/
              Workflow Integration Plugins/subly
============================================================================ ]]
---@diagnostic disable: undefined-global

local sep    = package.config:sub(1, 1)
local is_win = sep == "\\"

local function logline(prefix, msg) print(string.format("  [%s] %s", prefix, msg)) end
local function info(m) logline("*", m) end
local function ok(m)   logline("OK", m) end
local function fail(m) logline("ERROR", m) end

local function file_exists(p)
    local f = io.open(p, "rb")
    if f then f:close() return true end
    return false
end

local function html_escape(value)
    return tostring(value or "")
        :gsub("&", "&amp;")
        :gsub("<", "&lt;")
        :gsub(">", "&gt;")
        :gsub("\n", "<br>")
end

local SUBLY_DIALOG_STYLE = [[
QWidget#SublyDlg, QWidget#SublyAsk {
    background-color: #0d0d0d;
}
QWidget#SublyCard {
    background-color: #141414;
    border: 1px solid #2a2a2a;
    border-radius: 16px;
}
QLabel#Brand {
    color: #ffffff;
    font-size: 20px;
    font-weight: 700;
}
QLabel#SubTitle {
    color: #8d7ef5;
    font-size: 13px;
    font-weight: 700;
}
QLabel#Msg {
    color: #cfcfcf;
    font-size: 12px;
    line-height: 150%;
}
QPushButton {
    min-height: 28px;
    max-height: 32px;
    padding: 5px 16px;
    border-radius: 14px;
    font-weight: 700;
}
QPushButton#QuitBtn, QPushButton#KeepBtn {
    color: #ffffff;
    background-color: #6C5CE7;
    border: 1px solid #7d6ef0;
}
QPushButton#OkBtn {
    color: #cfcfcf;
    background-color: #222222;
    border: 1px solid #333333;
}
QPushButton#DelBtn {
    color: #ffffff;
    background-color: #FF5F57;
    border: 1px solid #ff7b74;
}
]]

local STYLE_BRAND = "color: #ffffff; font-size: 32px; font-weight: 700;"
local STYLE_SUBTITLE = "color: #8d7ef5; font-size: 18px; font-weight: 700;"
local STYLE_MESSAGE = "color: #f0f0f0; font-size: 17px; line-height: 155%;"
local STYLE_PRIMARY = [[
QPushButton { color: #ffffff; background-color: #6C5CE7; border: 1px solid #7d6ef0; border-radius: 14px; padding: 5px 16px; font-weight: 700; min-height: 28px; max-height: 32px; }
QPushButton:hover { background-color: #7d6ef0; }
]]
local STYLE_SECONDARY = [[
QPushButton { color: #cfcfcf; background-color: #222222; border: 1px solid #333333; border-radius: 14px; padding: 5px 16px; font-weight: 700; min-height: 28px; max-height: 32px; }
QPushButton:hover { border-color: #6C5CE7; color: #ffffff; }
]]
local STYLE_DANGER = [[
QPushButton { color: #ffffff; background-color: #FF5F57; border: 1px solid #ff7b74; border-radius: 14px; padding: 5px 16px; font-weight: 700; min-height: 28px; max-height: 32px; }
QPushButton:hover { background-color: #ff7b74; }
]]
local DIVIDER_CSS = [[
QFrame[frameShape="4"] { border: none; background-color: #2a2a2a; max-height: 1px; }
]]

-- A folder counts as "present" if we can read at least one known file in it,
-- or if bmd can stat it.
local function dir_exists(path)
    if file_exists(path .. sep .. "manifest.xml") then return true end
    if type(bmd) == "table" and type(bmd.fileexists) == "function" then
        local good = pcall(function() return bmd.fileexists(path) end)
        if good and bmd.fileexists(path) then return true end
    end
    return false
end

local function rmtree(path)
    if is_win then os.execute('cmd /c rmdir /s /q "' .. path .. '" 2>nul')
    else os.execute('rm -rf "' .. path .. '"') end
end

-- User settings folder (presets, last used language), auto-created by the app.
local function settings_dir()
    if is_win then
        local ad = os.getenv("APPDATA")
            or ((os.getenv("USERPROFILE") or "C:") .. "\\AppData\\Roaming")
        return ad .. sep .. "subly"
    end
    return (os.getenv("HOME") or "") .. "/Library/Application Support/subly"
end

local function legacy_settings_dir()
    if is_win then
        local ad = os.getenv("APPDATA")
            or ((os.getenv("USERPROFILE") or "C:") .. "\\AppData\\Roaming")
        return ad .. sep .. "com.subly"
    end
    return (os.getenv("HOME") or "") .. "/Library/Application Support/com.subly"
end

-- A modal dialog via Fusion's UI Manager, with a console fallback if the UI
-- toolkit is not reachable. No Geometry is set so Resolve centers the window
-- inside the Console-sized host window.
local function notify(title, message)
    print("")
    print("  " .. message)
    print("")
    local want_quit = false
    pcall(function()
        local fusion = rawget(_G, "fusion")
        if not fusion then
            local r = rawget(_G, "resolve")
            if r and r.Fusion then fusion = r:Fusion() end
        end
        local fu = rawget(_G, "fu") or fusion
        assert(fu and fu.UIManager, "no UI manager")
        local ui   = fu.UIManager
        local disp = bmd.UIDispatcher(ui)
        local win = disp:AddWindow({
            ID = "SublyDlg", WindowTitle = title, Margin = 20, StyleSheet = SUBLY_DIALOG_STYLE,
        }, ui:VGroup{
            FixedSize = { 720, 430 }, Spacing = 0,
            ui:VGap(14, 0),
            ui:Label{ ID = "Brand", Text = "Subly", Weight = 0, StyleSheet = STYLE_BRAND, Alignment = { AlignHCenter = true } },
            ui:Label{ ID = "SubTitle", Text = html_escape(title), Weight = 0, StyleSheet = STYLE_SUBTITLE, Alignment = { AlignHCenter = true } },
            ui:VGap(10, 0),
            ui:Label{ FrameStyle = 4, StyleSheet = DIVIDER_CSS },
            ui:Label{ ID = "Msg", Text = html_escape(message), WordWrap = true,
                      Weight = 1, StyleSheet = STYLE_MESSAGE,
                      Alignment = { AlignHCenter = true, AlignVCenter = true } },
            ui:HGroup{ Weight = 0, Spacing = 14,
                ui:Gap(0),
                ui:Button{ ID = "QuitBtn", Text = "Quit DaVinci Resolve", StyleSheet = STYLE_PRIMARY, FixedSize = { 240, 34 }, Weight = 0 },
                ui:Button{ ID = "OkBtn",   Text = "Not now", StyleSheet = STYLE_SECONDARY, FixedSize = { 140, 34 }, Weight = 0 },
                ui:Gap(0),
            },
            ui:VGap(18, 0),
        })
        win.On.OkBtn.Clicked   = function() disp:ExitLoop() end
        win.On.QuitBtn.Clicked = function() want_quit = true; disp:ExitLoop() end
        win.On.SublyDlg.Close = function() disp:ExitLoop() end
        win:RecalcLayout(); win:Show(); disp:RunLoop(); win:Hide()
    end)
    -- Quit AFTER the dialog loop exits — calling Quit() mid-RunLoop can hang the UI.
    if want_quit then
        local r = rawget(_G, "resolve")
        if r and r.Quit then pcall(function() r:Quit() end) end
    end
end

-- Yes/No dialog. Returns true only if the user explicitly chooses Delete; with
-- no UI reachable it returns false (safe default: keep the settings).
local function confirm_delete(title, message)
    local result = false
    local shown = pcall(function()
        local fusion = rawget(_G, "fusion")
        if not fusion then
            local r = rawget(_G, "resolve")
            if r and r.Fusion then fusion = r:Fusion() end
        end
        local fu = rawget(_G, "fu") or fusion
        assert(fu and fu.UIManager, "no UI manager")
        local ui   = fu.UIManager
        local disp = bmd.UIDispatcher(ui)
        local win = disp:AddWindow({
            ID = "SublyAsk", WindowTitle = title, Margin = 20, StyleSheet = SUBLY_DIALOG_STYLE,
        }, ui:VGroup{
            FixedSize = { 720, 430 }, Spacing = 0,
            ui:VGap(14, 0),
            ui:Label{ ID = "Brand", Text = "Subly", Weight = 0, StyleSheet = STYLE_BRAND, Alignment = { AlignHCenter = true } },
            ui:Label{ ID = "SubTitle", Text = html_escape(title), Weight = 0, StyleSheet = STYLE_SUBTITLE, Alignment = { AlignHCenter = true } },
            ui:VGap(10, 0),
            ui:Label{ FrameStyle = 4, StyleSheet = DIVIDER_CSS },
            ui:Label{ ID = "Msg", Text = html_escape(message), WordWrap = true,
                      Weight = 1, StyleSheet = STYLE_MESSAGE,
                      Alignment = { AlignHCenter = true, AlignVCenter = true } },
            ui:HGroup{ Weight = 0, Spacing = 14,
                ui:Gap(0),
                ui:Button{ ID = "DelBtn",  Text = "Delete settings", StyleSheet = STYLE_DANGER, FixedSize = { 180, 34 }, Weight = 0 },
                ui:Button{ ID = "KeepBtn", Text = "Keep settings", StyleSheet = STYLE_PRIMARY, FixedSize = { 180, 34 }, Weight = 0 },
                ui:Gap(0),
            },
            ui:VGap(18, 0),
        })
        win.On.DelBtn.Clicked  = function() result = true;  disp:ExitLoop() end
        win.On.KeepBtn.Clicked = function() result = false; disp:ExitLoop() end
        win.On.SublyAsk.Close = function() result = false; disp:ExitLoop() end
        win:RecalcLayout(); win:Show(); disp:RunLoop(); win:Hide()
    end)
    if not shown then return false end
    return result
end

-- ---------------------------------------------------------------------------
print("")
print("  ============================================")
print("   Subly — Workflow Integration uninstaller")
print("  ============================================")
print("")

local dest_root
if is_win then
    local pd = os.getenv("PROGRAMDATA") or ((os.getenv("SystemDrive") or "C:") .. "\\ProgramData")
    dest_root = pd .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins"
else
    dest_root = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins"
end
local dest_dir = dest_root .. sep .. "subly"
local legacy_dest_dir = dest_root .. sep .. "com.subly.plugin"

if not dir_exists(dest_dir) and not dir_exists(legacy_dest_dir) then
    info("Subly is not installed (nothing at " .. dest_dir .. ").")
    notify("Subly", "Subly does not appear to be installed.")
    return
end

if dir_exists(dest_dir) then
    info("Removing: " .. dest_dir)
    rmtree(dest_dir)
end
if legacy_dest_dir ~= dest_dir and dir_exists(legacy_dest_dir) then
    info("Removing legacy install: " .. legacy_dest_dir)
    rmtree(legacy_dest_dir)
end

if dir_exists(dest_dir) or dir_exists(legacy_dest_dir) then
    fail("Could not fully remove the plugin folder. If it was installed as")
    fail("administrator, run DaVinci Resolve as administrator and try again,")
    fail("or delete these folders manually if present:")
    fail("  " .. dest_dir)
    fail("  " .. legacy_dest_dir)
    notify("Subly — uninstall incomplete",
        "Some files could not be removed.\nSee the Console for the path to delete manually.")
    return
end

ok("Subly removed.")

-- Settings are NOT removed by default — ask the user first.
local set_dir = settings_dir()
local legacy_set_dir = legacy_settings_dir()
if file_exists(set_dir .. sep .. "settings.json") or file_exists(legacy_set_dir .. sep .. "settings.json") then
    if confirm_delete("Subly — delete settings?",
        "Also delete your Subly settings\n(presets and last used language)?\n\n" .. set_dir) then
        rmtree(set_dir)
        rmtree(legacy_set_dir)
        ok("Settings removed.")
    else
        info("Settings kept: " .. set_dir)
    end
end

notify("Subly removed",
    "Subly was removed.\n\n" ..
    "DaVinci Resolve must be restarted to finish unloading it.\n" ..
    "Click \"Quit DaVinci Resolve\" to close it now, then start it again.")
