--[[ ============================================================================
  Subly — installer for the DaVinci Resolve Workflow Integration plugin.

  HOW TO USE
    Open DaVinci Resolve, then  Workspace -> Console  (set the language to Lua),
    and drop / run this file. No batch files, no Node.js, nothing to install:
    the script only COPIES the pre-built plugin into Resolve's plugins folder.

  WHAT IT DOES
    Copies <this folder>/plugin/* into
      Windows : %PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\
                Workflow Integration Plugins\subly
      macOS   : /Library/Application Support/Blackmagic Design/DaVinci Resolve/
                Workflow Integration Plugins/subly
    The React UI must already be built (plugin/dist). Re-run `npm run build`
    in plugin/ only when you change the UI — end users never need Node.
    The proprietary WorkflowIntegration native module is NOT shipped with this
    project (it belongs to Blackmagic). The installer copies it from the local
    Resolve SDK, picking the right file/name for the current OS.

  NOTE
    The script self-locates next to the `plugin` folder. If you PASTE the text
    into the console instead of running the file, set SOURCE_DIR_OVERRIDE below.
============================================================================ ]]
---@diagnostic disable: undefined-global

-- If self-location fails (pasted text), point this at the Subly folder that
-- CONTAINS the `plugin` subfolder, e.g.  [[C:\Users\you\Desktop\Subly\Apps\Subly]]
local SOURCE_DIR_OVERRIDE = ""

-- ---------------------------------------------------------------------------
local sep    = package.config:sub(1, 1)
local is_win = sep == "\\"

local function logline(prefix, msg) print(string.format("  [%s] %s", prefix, msg)) end
local function info(m) logline("*", m) end
local function ok(m)   logline("OK", m) end
local function fail(m) logline("ERROR", m) end

-- normalize mixed slashes to the platform separator
local function norm(p) return (p:gsub("[/\\]", sep)) end

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
QWidget#SublyDlg {
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
QPushButton#QuitBtn {
    color: #ffffff;
    background-color: #6C5CE7;
    border: 1px solid #7d6ef0;
}
QPushButton#OkBtn {
    color: #cfcfcf;
    background-color: #222222;
    border: 1px solid #333333;
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
local DIVIDER_CSS = [[
QFrame[frameShape="4"] { border: none; background-color: #2a2a2a; max-height: 1px; }
]]

-- ---------------------------------------------------------------------------
-- A modal "please restart" dialog via Fusion's UI Manager, with a console
-- fallback if the UI toolkit is not reachable from this console. No Geometry is
-- set so Resolve centers the window inside the Console-sized host window.
local function notify(title, message)
    print("")
    print("  " .. message)
    print("")
    local want_quit = false
    local shown = pcall(function()
        local fusion = rawget(_G, "fusion")
        if not fusion and type(rawget(_G, "resolve")) ~= "nil" then
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
    return shown
end

-- ---------------------------------------------------------------------------
-- File copy. Prefer pure-Lua (bmd + io); fall back to the OS copy command if
-- the bmd file helpers are not available in this console.
local use_bmd = type(bmd) == "table"
    and type(bmd.readdir) == "function"
    and type(bmd.createdir) == "function"

local function mkdirs(path)
    if not use_bmd then
        -- no bmd in this console: let the shell build the whole chain
        if is_win then os.execute('cmd /c mkdir "' .. path .. '" >nul 2>&1')
        else os.execute('mkdir -p "' .. path .. '"') end
        return
    end
    local accum
    for token in path:gmatch("[^/\\]+") do
        if accum == nil then
            accum = (path:sub(1, 1) == "/") and (sep .. token) or token
        else
            accum = accum .. sep .. token
        end
        if accum ~= "" and not accum:match("^%a:$") then
            pcall(bmd.createdir, accum)
        end
    end
end

local function copy_file(src, dst)
    local fin = assert(io.open(src, "rb"), "cannot read " .. src)
    local data = fin:read("*a"); fin:close()
    local fout = assert(io.open(dst, "wb"), "cannot write " .. dst)
    fout:write(data or ""); fout:close()
end

local function copy_tree(src, dst)
    mkdirs(dst)
    local entries = bmd.readdir(src .. sep .. "*")
    if not entries then return end
    for _, e in ipairs(entries) do
        local nm = e.Name
        if nm and nm ~= "." and nm ~= ".." then
            local s, d = src .. sep .. nm, dst .. sep .. nm
            if e.IsDir then copy_tree(s, d) else copy_file(s, d) end
        end
    end
end

local function shell_copy(src, dst, is_dir)
    if is_win then
        if is_dir then
            os.execute('cmd /c xcopy "' .. src .. '" "' .. dst .. '" /E /I /Y /Q >nul 2>&1')
        else
            os.execute('cmd /c copy /Y "' .. src .. '" "' .. dst .. '" >nul 2>&1')
        end
    else
        if is_dir then
            mkdirs(dst)
            os.execute('cp -R "' .. src .. '/." "' .. dst .. '"')
        else
            os.execute('cp -f "' .. src .. '" "' .. dst .. '"')
        end
    end
end

local function rmtree(path)
    if is_win then os.execute('cmd /c rmdir /s /q "' .. path .. '" 2>nul')
    else os.execute('rm -rf "' .. path .. '"') end
end

-- ---------------------------------------------------------------------------
print("")
print("  ============================================")
print("   Subly — Workflow Integration installer")
print("  ============================================")
print("")

-- 1. locate the source `plugin` folder
local script_dir = SOURCE_DIR_OVERRIDE
if script_dir == "" then
    local src = debug.getinfo(1, "S").source
    local this_file = src:sub(1, 1) == "@" and src:sub(2) or src
    script_dir = this_file:match("^(.*)[/\\][^/\\]+$") or ""
end
script_dir = norm(script_dir)

local plugin_src = script_dir .. sep .. "plugin"
if script_dir == "" or not file_exists(plugin_src .. sep .. "manifest.xml") then
    fail("Could not find the 'plugin' folder next to this script.")
    fail("Set SOURCE_DIR_OVERRIDE at the top of install.lua to the Subly folder")
    fail("that contains 'plugin', then run again.")
    return
end
ok("Source: " .. plugin_src)

if not file_exists(plugin_src .. sep .. "dist" .. sep .. "index.html") then
    fail("plugin/dist is missing. Build the UI once with `npm run build` in plugin/,")
    fail("then re-run this installer. (End users do NOT need Node — ship the built dist.)")
    return
end

-- 2. destination
local dest_root
if is_win then
    local pd = os.getenv("PROGRAMDATA") or "C:\\ProgramData"
    dest_root = pd .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins"
else
    dest_root = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins"
end
local dest_dir = dest_root .. sep .. "subly"
local legacy_dest_dir = dest_root .. sep .. "com.subly.plugin"
info("Installing to: " .. dest_dir)

-- { name, is_directory } — mirrors install.ps1's $include (no node_modules/src).
-- WorkflowIntegration.node is NOT here — it is copied from the Resolve SDK below.
local INCLUDE = {
    { "main.js", false }, { "preload.js", false }, { "manifest.xml", false },
    { "package.json", false },
    { "dist", true }, { "ipc", true }, { "data", true }, { "lua", true },
}

-- 3. Validate ALL prerequisites BEFORE touching the existing install, so a
--    missing source file or an absent Resolve SDK can never leave the user with
--    a half-deleted or broken plugin and no rollback.
local function src_exists(p, is_dir)
    if not is_dir then return file_exists(p) end
    if use_bmd then return bmd.readdir(p .. sep .. "*") ~= nil end
    return true  -- no bmd to stat dirs here; post-copy verification is the backstop
end

for _, item in ipairs(INCLUDE) do
    if not src_exists(plugin_src .. sep .. item[1], item[2]) then
        fail("Missing source in plugin/: " .. item[1])
        fail("The Subly 'plugin' folder is incomplete — re-download or rebuild it, then re-run.")
        return
    end
end

-- Locate + verify the proprietary WorkflowIntegration native module in the local
-- Resolve SDK. We do NOT ship it (it belongs to Blackmagic); it is present on
-- every machine with DaVinci Resolve Studio installed. The SDK file is named
-- WorkflowIntegration.node on both platforms, but resolve.js loads the macOS
-- build as WorkflowIntegration.darwin.node, so on macOS we copy it under that name.
local sdk_node, node_dst_name
if is_win then
    local pd = os.getenv("PROGRAMDATA") or ((os.getenv("SystemDrive") or "C:") .. "\\ProgramData")
    sdk_node = pd .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer" ..
               "\\Workflow Integrations\\Examples\\SamplePlugin\\WorkflowIntegration.node"
    node_dst_name = "WorkflowIntegration.node"
else
    sdk_node = "/Library/Application Support/Blackmagic Design/DaVinci Resolve" ..
               "/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"
    node_dst_name = "WorkflowIntegration.darwin.node"
end
sdk_node = norm(sdk_node)

if not file_exists(sdk_node) then
    fail("WorkflowIntegration native module not found in the Resolve SDK at:")
    fail("  " .. sdk_node)
    fail("Install DaVinci Resolve Studio (it ships the Developer SDK), then re-run.")
    notify("Subly — install failed",
        "WorkflowIntegration.node was not found in the DaVinci Resolve SDK.\n" ..
        "Make sure DaVinci Resolve Studio is installed, then run the installer again.")
    return
end

-- 4. Prerequisites OK — only now remove the previous install and copy the whitelist.
-- The old pre-1.0 folder is removed too, otherwise Resolve would show duplicate
-- Subly menu entries after the plugin ID/folder was simplified to "subly".
if legacy_dest_dir ~= dest_dir then rmtree(legacy_dest_dir) end
rmtree(dest_dir)
mkdirs(dest_dir)

for _, item in ipairs(INCLUDE) do
    local name, is_dir = item[1], item[2]
    local s = plugin_src .. sep .. name
    local d = dest_dir .. sep .. name
    local copied, err = pcall(function()
        if use_bmd then
            if is_dir then copy_tree(s, d) else if file_exists(s) then copy_file(s, d) end end
        else
            shell_copy(s, d, is_dir)
        end
    end)
    if copied then
        info("copied " .. name)
    else
        fail("failed to copy " .. name .. " — " .. tostring(err))
    end
end

-- 3b. Icon is already in dist/assets (copied by vite build), no separate copy needed.
--     main.js looks for it at dist/assets/Subly.ico (with fallback to src/assets for dev).

-- 4c. copy the proprietary WorkflowIntegration native module (located + verified
--     above, before the existing install was removed).
local node_dst = dest_dir .. sep .. node_dst_name
local node_ok, node_err = pcall(function()
    if use_bmd then copy_file(sdk_node, node_dst) else shell_copy(sdk_node, node_dst, false) end
end)
if node_ok then
    info("copied " .. node_dst_name .. " (from Resolve SDK)")
else
    fail("failed to copy WorkflowIntegration module — " .. tostring(node_err))
    return
end

-- 5. verify the critical pieces landed (a silently-empty copy is caught here)
local checks = {
    dest_dir .. sep .. "main.js",
    dest_dir .. sep .. "package.json",
    dest_dir .. sep .. "manifest.xml",
    dest_dir .. sep .. "dist" .. sep .. "index.html",
    dest_dir .. sep .. node_dst_name,
    dest_dir .. sep .. "ipc" .. sep .. "resolve.js",
    dest_dir .. sep .. "data" .. sep .. "Subly.drb",
    dest_dir .. sep .. "lua" .. sep .. "subly_bridge_launcher.lua",
    dest_dir .. sep .. "lua" .. sep .. "subly_resolve_core.lua",
}
local missing = {}
for _, p in ipairs(checks) do
    if not file_exists(p) then missing[#missing + 1] = p end
end

if #missing > 0 then
    fail("Verification failed — these files are missing in the destination:")
    for _, p in ipairs(missing) do fail("  " .. p) end
    notify("Subly — install failed",
        "Subly could not be installed.\nSee the Console for details.")
    return
end

ok("Subly installed.")
notify("Subly installed",
    "Subly was installed successfully.\n\n" ..
    "DaVinci Resolve must be restarted to load the plugin.\n" ..
    "Click \"Quit DaVinci Resolve\" to close it now, then start it\n" ..
    "again and open  Workspace -> Workflow Integrations -> Subly.")
