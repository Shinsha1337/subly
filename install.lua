--[[ ============================================================================
  Subly — installer for the DaVinci Resolve Workflow Integration plugin.

  HOW TO USE
    Open DaVinci Resolve, then  Workspace -> Console  (set the language to Lua),
    and drop / run this file. No batch files, no Node.js, nothing to install:
    the script only COPIES the pre-built plugin into Resolve's plugins folder.

  WHAT IT DOES
    Copies <this folder>/Subly/* into
      Windows : %PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\
                Workflow Integration Plugins\Subly
      macOS   : /Library/Application Support/Blackmagic Design/DaVinci Resolve/
                Workflow Integration Plugins/Subly
    The React UI must already be built (Subly/dist). Re-run `npm run build`
    in Subly/ only when you change the UI — end users never need Node.
    The proprietary WorkflowIntegration native module is NOT shipped with this
    project (it belongs to Blackmagic). The installer copies it from the local
    Resolve SDK, using the platform build installed for the current OS.

  NOTE
    The script self-locates next to the `Subly` plugin folder. If you PASTE the
    text into the console instead of running the file, set SOURCE_DIR_OVERRIDE below.
============================================================================ ]]
---@diagnostic disable: undefined-global

-- If self-location fails (pasted text), point this at the project folder that
-- CONTAINS the `Subly` subfolder, or directly at the Subly plugin folder.
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
-- Is `dir` writable by the current user? Tries to create+remove a probe file.
local function dir_writable(dir)
    mkdirs(dir)
    local probe = dir .. sep .. ".subly_write_probe"
    local f = io.open(probe, "wb")
    if not f then return false end
    f:close()
    os.remove(probe)
    return true
end

-- ---------------------------------------------------------------------------
-- The Fusion UI Manager does not expose a portable folder/file picker here.
-- Browse opens Finder / Explorer at the current default; the adjacent field
-- remains editable so the user can paste or type a different path.
local function get_fusion_ui()
    local fusion = rawget(_G, "fusion")
    if not fusion and type(rawget(_G, "resolve")) ~= "nil" then
        local r = rawget(_G, "resolve")
        if r and r.Fusion then fusion = r:Fusion() end
    end
    local fu = rawget(_G, "fu") or fusion
    if fu and fu.UIManager then return fu end
    return nil
end

local function pick_folder(default)
    pcall(function() bmd.openfileexternal("Open", default) end)
    return nil  -- text field is editable; user verifies/edits in Finder, then types path
end

local function pick_file(default)
    local dir = default:match("(.+[/\\])") or default
    pcall(function() bmd.openfileexternal("Open", dir) end)
    return nil
end

-- ---------------------------------------------------------------------------
-- Setup dialog. Pre-fills the plugin destination and SDK node path with
-- detected defaults; the user can edit the text fields or use Browse to open
-- Finder / Explorer at those locations. Returns (dest, sdk) on Install, or nil
-- if cancelled.
local STYLE_FIELD = [[QLineEdit { color: #e0e0e0; background-color: #1a1a1a;
border: 1px solid #333; border-radius: 6px; padding: 4px 8px; font-size: 12px; }]]
local STYLE_MANUAL_HELP = [[QLabel { color: #e0e0e0; background-color: #1a1a1a;
border: 1px solid #3a3a3a; border-radius: 8px; padding: 8px 12px; font-size: 12px; }]]
local STYLE_INFO_OK   = "QLabel { color: #5cb85c; font-size: 11px; }"
local STYLE_INFO_WARN = "QLabel { color: #f0ad4e; font-size: 11px; }"
local STYLE_INFO_ERR  = "QLabel { color: #FF5F57; font-size: 11px; }"

local function setup_dialog(default_dest, default_sdk, auto_fail_reason)
    local chosen_dest, chosen_sdk = default_dest, default_sdk
    local cancelled = true
    local manual_help = "Manual installation\n" ..
        "1. Copy the Subly folder to the first path.\n" ..
        "2. Copy WorkflowIntegration.node from the second path into Subly.\n" ..
        "3. Restart DaVinci Resolve."

    local fu = get_fusion_ui()
    if not fu then
        info("No UI available — using default paths.")
        return default_dest, default_sdk
    end
    local ui   = fu.UIManager
    local disp = bmd.UIDispatcher(ui)

    local win = disp:AddWindow({
        ID = "SublySetup", WindowTitle = "Subly — Setup", Margin = 20,
        StyleSheet = SUBLY_DIALOG_STYLE,
    }, ui:VGroup{
        FixedSize = { 640, 514 }, Spacing = 0,
        ui:VGap(14, 0),
        ui:Label{ ID = "Brand", Text = "Subly", Weight = 0, StyleSheet = STYLE_BRAND,
                  Alignment = { AlignHCenter = true } },
        ui:Label{ ID = "SubTitle", Text = "Installation Setup", Weight = 0,
                  StyleSheet = STYLE_SUBTITLE, Alignment = { AlignHCenter = true } },
        ui:VGap(10, 0),
        ui:Label{ FrameStyle = 4, StyleSheet = DIVIDER_CSS },
        ui:Label{ ID = "AutoFailInfo",
                  Text = html_escape(auto_fail_reason or "Automatic install needs path confirmation. Check the folders below, then click Install."),
                  WordWrap = true, Weight = 0, MinimumSize = { 0, 52 },
                  StyleSheet = "QLabel { color: #f0f0f0; font-size: 12px; line-height: 140%; }",
                  Alignment = { AlignHCenter = true, AlignVCenter = true } },
        ui:VGap(10, 0),

        -- Plugin destination
        ui:Label{ Text = "Plugin folder (where to install):", Weight = 0,
                  StyleSheet = "QLabel { color: #cfcfcf; font-size: 12px; font-weight: bold; }" },
        ui:HGroup{ Weight = 0,
            ui:LineEdit{ ID = "DestPath", Text = default_dest, StyleSheet = STYLE_FIELD, Weight = 1 },
            ui:Button{ ID = "BrowseDest", Text = "Browse", StyleSheet = STYLE_SECONDARY, Weight = 0 },
        },
        ui:Label{ ID = "DestInfo", Text = "", Weight = 0,
                  StyleSheet = "QLabel { color: #888; font-size: 11px; }" },

        ui:VGap(14, 0),

        -- Resolve ships a platform-specific build under the same standard
        -- WorkflowIntegration.node filename on Windows and macOS.
        ui:Label{ Text = "Resolve SDK native module:", Weight = 0,
                  StyleSheet = "QLabel { color: #cfcfcf; font-size: 12px; font-weight: bold; }" },
        ui:HGroup{ Weight = 0,
            ui:LineEdit{ ID = "SdkPath", Text = default_sdk, StyleSheet = STYLE_FIELD, Weight = 1 },
            ui:Button{ ID = "BrowseSdk", Text = "Browse", StyleSheet = STYLE_SECONDARY, Weight = 0 },
        },
        ui:Label{ ID = "SdkInfo", Text = "", Weight = 0,
                  StyleSheet = "QLabel { color: #888; font-size: 11px; }" },

        ui:VGap(12, 0),
        ui:HGroup{ Weight = 0, Spacing = 0,
            ui:Gap(0, 1),
            ui:Label{ ID = "ManualInstallInfo", Text = html_escape(manual_help), WordWrap = true,
                      FixedSize = { 440, 108 }, Weight = 0,
                      StyleSheet = STYLE_MANUAL_HELP,
                      Alignment = { AlignVCenter = true } },
            ui:Gap(0, 1),
        },

        ui:VGap(14, 0),
        -- This stretch is intentional: action buttons stay at the bottom even
        -- when Qt/Resolve reports different font metrics on Windows and macOS.
        ui:VGap(0, 1),

        ui:HGroup{ Weight = 0, Spacing = 14,
            ui:Gap(0),
            ui:Button{ ID = "InstallBtn", Text = "Install", StyleSheet = STYLE_PRIMARY,
                       FixedSize = { 180, 34 }, Weight = 0 },
            ui:Button{ ID = "CancelBtn", Text = "Cancel", StyleSheet = STYLE_SECONDARY,
                       FixedSize = { 140, 34 }, Weight = 0 },
            ui:Gap(0),
        },
        ui:VGap(18, 0),
    })

    local itm = win:GetItems()

    local function update_status()
        local d = itm.DestPath.Text
        itm.DestPath.ToolTip = d
        itm.SdkPath.ToolTip = itm.SdkPath.Text
        if dir_writable(d) then
            itm.DestInfo.Text    = "Writable \226\152\133 ready to install."
            itm.DestInfo.StyleSheet = STYLE_INFO_OK
        else
            itm.DestInfo.Text    = "Not writable \226\128\148 choose a different folder or grant access."
            itm.DestInfo.StyleSheet = STYLE_INFO_WARN
        end
        if file_exists(itm.SdkPath.Text) then
            itm.SdkInfo.Text    = "Found."
            itm.SdkInfo.StyleSheet = STYLE_INFO_OK
        else
            itm.SdkInfo.Text    = "Not found \226\128\148 click Browse to locate it."
            itm.SdkInfo.StyleSheet = STYLE_INFO_ERR
        end
    end
    update_status()
    -- Long paths otherwise open scrolled to their end, which hides the drive or
    -- root folder and makes the detected locations unnecessarily hard to verify.
    pcall(function()
        itm.DestPath:Home(false)
        itm.SdkPath:Home(false)
        itm.InstallBtn:SetFocus("OtherFocusReason")
    end)

    win.On.BrowseDest.Clicked = function()
        local picked = pick_folder(itm.DestPath.Text)
        if picked then itm.DestPath.Text = picked end
        update_status()
    end
    win.On.BrowseSdk.Clicked = function()
        local picked = pick_file(itm.SdkPath.Text)
        if picked then itm.SdkPath.Text = picked end
        update_status()
    end
    win.On.InstallBtn.Clicked = function()
        chosen_dest = itm.DestPath.Text
        chosen_sdk  = itm.SdkPath.Text
        cancelled = false
        disp:ExitLoop()
    end
    win.On.CancelBtn.Clicked  = function() disp:ExitLoop() end
    win.On.SublySetup.Close   = function() disp:ExitLoop() end

    win:RecalcLayout(); win:Show(); disp:RunLoop(); win:Hide()
    if cancelled then return nil, nil end
    return chosen_dest, chosen_sdk
end

-- ---------------------------------------------------------------------------
-- Manual install fallback. This is shown only when the installer cannot finish
-- automatically (usually macOS system-folder permissions). It opens the source
-- and destination folders and tells the user exactly what to copy.
local function show_manual_install(reason, plugin_src, dest_root, dest_dir, sdk_node, node_dst_name)
    fail(reason or ("Cannot write to: " .. dest_root))
    info("")
    info("  Manual installation:")
    info("")
    info("  1. Copy the Subly folder into: " .. dest_root)
    info("     Source: " .. plugin_src)
    info("  2. Copy the SDK file into " .. dest_dir .. " as " .. node_dst_name)
    info("     SDK file: " .. sdk_node)
    info("  3. Restart DaVinci Resolve.")
    info("")

    pcall(function() bmd.openfileexternal("Open", plugin_src) end)
    pcall(function() bmd.openfileexternal("Open", dest_root) end)

    notify("Subly — manual install required",
        "Subly could not install automatically.\n\n" ..
        "Reason:\n" .. tostring(reason or ("The destination folder is not writable.")) .. "\n\n" ..
        "Two folders were opened for you:\n" ..
        "  1. Source: the Subly plugin folder\n" ..
        "  2. Destination: the DaVinci Resolve plugins folder\n\n" ..
        "Manual installation:\n\n" ..
        "Step 1 — Copy the entire Subly source folder into the destination folder.\n\n" ..
        "Step 2 — Copy the file from this SDK path into the copied Subly folder:\n" ..
        "  " .. sdk_node .. "\n" ..
        "Save it there as:\n" ..
        "  " .. node_dst_name .. "\n\n" ..
        "Step 3 — Restart DaVinci Resolve, then open:\n" ..
        "  Workspace -> Workflow Integrations -> Subly")
end

-- ---------------------------------------------------------------------------
print("")
print("  ============================================")
print("   Subly — Workflow Integration installer")
print("  ============================================")
print("")

-- 1. locate the source plugin folder. Current releases use `Subly`; `plugin`
-- remains supported so older source trees can still be installed.
local script_dir = SOURCE_DIR_OVERRIDE
if script_dir == "" then
    local src = debug.getinfo(1, "S").source
    local this_file = src:sub(1, 1) == "@" and src:sub(2) or src
    script_dir = this_file:match("^(.*)[/\\][^/\\]+$") or ""
end
script_dir = norm(script_dir)

local function find_plugin_source(root)
    if root == "" then return nil end
    if file_exists(root .. sep .. "manifest.xml") then return root end
    local candidates = { "Subly", "@Subly", "plugin" }
    for _, name in ipairs(candidates) do
        local candidate = root .. sep .. name
        if file_exists(candidate .. sep .. "manifest.xml") then return candidate end
    end
    return nil
end

local plugin_src = find_plugin_source(script_dir)
if not plugin_src then
    fail("Could not find the Subly plugin source folder next to this script.")
    fail("Expected one of: Subly, @Subly, or legacy plugin.")
    fail("Set SOURCE_DIR_OVERRIDE at the top of install.lua to the project folder")
    fail("that contains Subly, or directly to the Subly plugin folder, then run again.")
    return
end
ok("Source: " .. plugin_src)

if not file_exists(plugin_src .. sep .. "dist" .. sep .. "index.html") then
    fail("Subly/dist is missing. Build the UI once with `npm run build` in Subly/,")
    fail("then re-run this installer. (End users do NOT need Node — ship the built dist.)")
    return
end

-- 2. default paths (user can override these in the setup dialog)
local dest_root
if is_win then
    local pd = os.getenv("PROGRAMDATA") or "C:\\ProgramData"
    dest_root = pd .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Workflow Integration Plugins"
else
    dest_root = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins"
end

local sdk_node
if is_win then
    local pd = os.getenv("PROGRAMDATA") or ((os.getenv("SystemDrive") or "C:") .. "\\ProgramData")
    sdk_node = pd .. "\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer" ..
               "\\Workflow Integrations\\Examples\\SamplePlugin\\WorkflowIntegration.node"
else
    sdk_node = "/Library/Application Support/Blackmagic Design/DaVinci Resolve" ..
               "/Developer/Workflow Integrations/Examples/SamplePlugin/WorkflowIntegration.node"
end
local node_dst_name = "WorkflowIntegration.node"

-- { name, is_directory } — no node_modules/src. .node is copied separately.
local INCLUDE = {
    { "main.js", false }, { "preload.js", false }, { "manifest.xml", false },
    { "package.json", false },
    { "dist", true }, { "ipc", true }, { "data", true }, { "lua", true },
}

-- 3. Validate source BEFORE touching anything.
local function src_exists(p, is_dir)
    if not is_dir then return file_exists(p) end
    if use_bmd then return bmd.readdir(p .. sep .. "*") ~= nil end
    return true
end
for _, item in ipairs(INCLUDE) do
    if not src_exists(plugin_src .. sep .. item[1], item[2]) then
        fail("Missing source in " .. plugin_src .. ": " .. item[1])
        fail("The Subly plugin source folder is incomplete — re-download or rebuild it, then re-run.")
        return
    end
end

-- 4. Try automatic install first. Show setup only when defaults cannot work.
local auto_fail_reason = nil
if not file_exists(norm(sdk_node)) then
    auto_fail_reason = "Automatic install could not find the Resolve SDK native module. Click Browse and select it manually."
elseif not dir_writable(dest_root) then
    auto_fail_reason = "Automatic install cannot write to the Resolve plugins folder. On macOS this usually means the current user cannot write to the system-wide plugin folder."
end

if auto_fail_reason then
    info(auto_fail_reason)
    local dest_root_chosen, sdk_node_chosen = setup_dialog(dest_root, norm(sdk_node), auto_fail_reason)
    if not dest_root_chosen or not sdk_node_chosen then
        info("Installation cancelled.")
        return
    end
    dest_root = dest_root_chosen
    sdk_node  = sdk_node_chosen
else
    sdk_node = norm(sdk_node)
end

local dest_dir = dest_root .. sep .. "Subly"
local legacy_dest_dirs = {
    dest_root .. sep .. "subly",
    dest_root .. sep .. "com.subly.plugin",
}
local old_user_dest_dirs = {}
if not is_win then
    local home = os.getenv("HOME") or ""
    if home ~= "" then
        local old_user_root = home .. "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins"
        old_user_dest_dirs = {
            old_user_root .. sep .. "Subly",
            old_user_root .. sep .. "subly",
            old_user_root .. sep .. "com.subly.plugin",
        }
    end
end
info("Installing to: " .. dest_dir)

-- 5. Validate chosen paths.
if not file_exists(sdk_node) then
    fail("WorkflowIntegration native module not found:")
    fail("  " .. sdk_node)
    fail("Click Browse in the setup dialog to locate it, or install DaVinci Resolve Studio.")
    notify("Subly — install failed",
        "The WorkflowIntegration native module was not found at the selected path.\n" ..
        "Re-run the installer and click Browse to locate it.")
    return
end

if not dir_writable(dest_root) then
    show_manual_install(
        "Automatic install cannot write to the Resolve plugins folder: " .. dest_root,
        plugin_src, dest_root, dest_dir, sdk_node, node_dst_name)
    return
end

-- 6. Install — direct copy. Old / legacy / user-local folders are cleaned up.
for _, path in ipairs(legacy_dest_dirs) do
    if path ~= dest_dir then rmtree(path) end
end
for _, path in ipairs(old_user_dest_dirs) do
    if path ~= dest_dir then rmtree(path) end
end
rmtree(dest_dir)
mkdirs(dest_dir)

local copy_errors = {}
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
        local message = "failed to copy " .. name .. " — " .. tostring(err)
        copy_errors[#copy_errors + 1] = message
        fail(message)
    end
end

-- 6b. Copy the proprietary WorkflowIntegration native module.
local node_dst = dest_dir .. sep .. node_dst_name
local node_ok, node_err = pcall(function()
    if use_bmd then copy_file(sdk_node, node_dst) else shell_copy(sdk_node, node_dst, false) end
end)
if node_ok then
    info("copied " .. node_dst_name .. " (from Resolve SDK)")
else
    local message = "failed to copy WorkflowIntegration module — " .. tostring(node_err)
    copy_errors[#copy_errors + 1] = message
    fail(message)
end

if #copy_errors > 0 then
    show_manual_install(copy_errors[1], plugin_src, dest_root, dest_dir, sdk_node, node_dst_name)
    return
end

-- 7. Verify the critical pieces landed.
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
    show_manual_install(
        "Automatic install finished incompletely. Missing: " .. tostring(missing[1]),
        plugin_src, dest_root, dest_dir, sdk_node, node_dst_name)
    return
end

ok("Subly installed.")
notify("Subly installed",
    "Subly was installed successfully.\n\n" ..
    "DaVinci Resolve must be restarted to load the plugin.\n" ..
    "Click \"Quit DaVinci Resolve\" to close it now, then start it\n" ..
    "again and open  Workspace -> Workflow Integrations -> Subly.")
