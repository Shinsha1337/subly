---@diagnostic disable: undefined-global, deprecated
local ffi = rawget(_G, "ffi")

local PORT = tonumber(os.getenv("SUBLY_PORT")) or 56003
local AUTH_TOKEN = os.getenv("SUBLY_TOKEN")
local socket = nil
local json = nil
local resolve = rawget(_G, "resolve")
if not resolve and type(rawget(_G, "Resolve")) == "function" then
    resolve = Resolve()
end

local function join_path(dir, filename)
    local sep = package.config:sub(1, 1)
    if dir:sub(-1) == sep then
        return dir .. filename
    end
    return dir .. sep .. filename
end

local function log(message)
end

local function sleep(seconds)
    if ffi and ffi.os == "Windows" then
        pcall(ffi.cdef, [[ void Sleep(unsigned int ms); ]])
        ffi.C.Sleep(math.floor(seconds * 1000))
    elseif ffi then
        pcall(ffi.cdef, [[
            struct timespec { long tv_sec; long tv_nsec; };
            int nanosleep(const struct timespec *req, struct timespec *rem);
        ]])
        local ts = ffi.new("struct timespec")
        ts.tv_sec = math.floor(seconds)
        ts.tv_nsec = math.floor((seconds - math.floor(seconds)) * 1000000000)
        ffi.C.nanosleep(ts, nil)
    else
        local target = os.clock() + seconds
        while os.clock() < target do end
    end
end

local function create_response(body)
    body = body or "{}"
    return "HTTP/1.1 200 OK\r\n"
        .. "Server: Subly-Lua/0.1\r\n"
        .. "Content-Type: application/json; charset=utf-8\r\n"
        .. "Content-Length: " .. #body .. "\r\n"
        .. "Connection: close\r\n\r\n"
        .. body
end

local function make_error(message, detail)
    return { error = tostring(message or "Resolve API error"), detail = tostring(detail or "") }
end

local function ok_response(extra)
    extra = extra or {}
    extra.ok = true
    return extra
end

local function get_context(require_timeline)
    if not resolve and type(rawget(_G, "Resolve")) == "function" then
        resolve = Resolve()
    end
    if not resolve then
        log("Connect failed: Resolve() returned nil")
        return nil, make_error("DaVinci Resolve not connected", "Resolve() returned nil")
    end

    local pm = resolve:GetProjectManager()
    if not pm then
        log("Connect failed: no project manager")
        return nil, make_error("No project manager", "resolve:GetProjectManager() returned nil")
    end

    local project = pm:GetCurrentProject()
    if not project then
        log("Connect failed: no active project")
        return nil, make_error("No active project", "Open a project in DaVinci Resolve")
    end

    local timeline = project:GetCurrentTimeline()
    if require_timeline and not timeline then
        log("Connect failed: no active timeline")
        return nil, make_error("No active timeline", "Open a timeline in DaVinci Resolve")
    end

    return { resolve = resolve, pm = pm, project = project, timeline = timeline }, nil
end

local function get_fps(timeline)
    local ok, value = pcall(function()
        return timeline:GetSetting("timelineFrameRate")
    end)
    if ok and value ~= nil and tonumber(value) then
        return tonumber(value), true
    end

    ok, value = pcall(function()
        local settings = timeline:GetSetting()
        return settings and settings["timelineFrameRate"]
    end)
    if ok and value ~= nil and tonumber(value) then
        return tonumber(value), true
    end

    return 25.0, false
end

local function frame_to_tc(frames, fps)
    frames = tonumber(frames) or 0
    fps = tonumber(fps) or 25
    local total_seconds = frames / fps
    local h = math.floor(total_seconds / 3600)
    local m = math.floor((total_seconds % 3600) / 60)
    local s = math.floor(total_seconds % 60)
    local ms = math.floor((total_seconds - math.floor(total_seconds)) * 1000)
    return string.format("%02d:%02d:%02d,%03d", h, m, s, ms)
end

local function tc_to_frame(tc, fps)
    if type(tc) ~= "string" then return 0 end
    local h, m, s, ms = tc:match("^(%d+):(%d+):(%d+)[,.](%d+)")
    if not h then return 0 end
    return math.floor(((tonumber(h) * 3600 + tonumber(m) * 60 + tonumber(s) + tonumber(ms) / 1000.0) * fps) + 0.5)
end

local function utf8_chars(value)
    value = tostring(value or "")
    local chars = {}
    local pos = 1
    local len = #value
    while pos <= len do
        local byte = value:byte(pos)
        local next_pos = pos + 1
        if byte and byte >= 240 then
            next_pos = pos + 4
        elseif byte and byte >= 224 then
            next_pos = pos + 3
        elseif byte and byte >= 192 then
            next_pos = pos + 2
        end
        table.insert(chars, value:sub(pos, math.min(next_pos - 1, len)))
        pos = next_pos
    end
    return chars
end

local function utf8_len(value)
    return #utf8_chars(value)
end

local function timeline_tc_to_frame(tc, fps)
    if type(tc) ~= "string" then return 0 end
    -- Accept ":" and the drop-frame ";" separator before the frame field.
    local h, m, s, sep, f = tc:match("^(%d+):(%d+):(%d+)([:;])(%d+)")
    if not h then return 0 end
    local rate = math.max(1, math.floor((tonumber(fps) or 25) + 0.5))
    h, m, s, f = tonumber(h), tonumber(m), tonumber(s), tonumber(f)
    if sep == ";" and (rate == 30 or rate == 60) then
        local drop = rate == 60 and 4 or 2
        local total_minutes = h * 60 + m
        return ((h * 3600 + m * 60 + s) * rate + f) - drop * (total_minutes - math.floor(total_minutes / 10))
    end
    return (h * 3600 + m * 60 + s) * rate + f
end

local function frame_to_resolve_tc(frames, fps, drop_frame)
    -- Use the nominal integer rate for the frame field so fractional rates
    -- (29.97/23.976/59.94) don't drift the FF component.
    frames = math.floor((tonumber(frames) or 0) + 0.5)
    local rate = math.max(1, math.floor((tonumber(fps) or 25) + 0.5))
    if drop_frame and (rate == 30 or rate == 60) then
        local drop = rate == 60 and 4 or 2
        local frames_per_10_minutes = rate * 60 * 10 - drop * 9
        local frames_per_minute = rate * 60 - drop
        local ten_minute_chunks = math.floor(frames / frames_per_10_minutes)
        local remainder = frames % frames_per_10_minutes
        frames = frames + drop * 9 * ten_minute_chunks
        if remainder > drop then
            frames = frames + drop * math.floor((remainder - drop) / frames_per_minute)
        end
        local f = frames % rate
        local secs = math.floor(frames / rate)
        return string.format("%02d:%02d:%02d;%02d", math.floor(secs / 3600), math.floor(secs / 60) % 60, secs % 60, f)
    end
    local f = frames % rate
    local secs = math.floor(frames / rate)
    local s = secs % 60
    local m = math.floor(secs / 60) % 60
    local h = math.floor(secs / 3600)
    return string.format("%02d:%02d:%02d:%02d", h, m, s, f)
end

local function find_bin_by_name(bin_obj, name)
    if not bin_obj then return nil end
    local ok, bin_name = pcall(function() return bin_obj:GetName() end)
    if ok and bin_name == name then return bin_obj end

    local found = nil
    ok = pcall(function()
        local subs = bin_obj:GetSubFolderList() or {}
        for _, sub in pairs(subs) do
            found = find_bin_by_name(sub, name)
            if found then break end
        end
    end)
    if ok and found then return found end
    return nil
end

local function collect_bins_by_name(bin_obj, name, out)
    out = out or {}
    if not bin_obj then return out end

    local ok, bin_name = pcall(function() return bin_obj:GetName() end)
    if ok and bin_name == name then table.insert(out, bin_obj) end

    ok = pcall(function()
        local subs = bin_obj:GetSubFolderList() or {}
        for _, sub in pairs(subs) do
            collect_bins_by_name(sub, name, out)
        end
    end)
    return out
end

local function merge_duplicate_media_pool_bins(mp, folders)
    if not folders or #folders <= 1 then return end
    local primary = folders[1]
    local duplicates = {}

    for i = 2, #folders do
        local folder = folders[i]
        pcall(function()
            local clips = folder:GetClipList() or {}
            if #clips > 0 then mp:MoveClips(clips, primary) end
        end)
        table.insert(duplicates, folder)
    end

    if #duplicates > 0 then
        pcall(function() mp:DeleteFolders(duplicates) end)
        pcall(function() mp:RefreshFolders() end)
    end
end

local function clip_name(clip)
    local ok, name = pcall(function() return clip:GetName() end)
    if ok and name then return name end
    ok, name = pcall(function()
        local props = clip:GetClipProperty()
        return props and (props["Clip Name"] or props["Name"])
    end)
    if ok and name then return name end
    return ""
end

local function find_template_clip_in_bin(bin_obj, template_name)
    if not bin_obj then return nil end

    local clips_ok, clips = pcall(function() return bin_obj:GetClipList() or {} end)
    if clips_ok then
        for _, clip in ipairs(clips) do
            if clip_name(clip) == template_name then return clip end
        end
    end

    local subs_ok, subs = pcall(function() return bin_obj:GetSubFolderList() or {} end)
    if subs_ok then
        for _, sub in ipairs(subs) do
            local found = find_template_clip_in_bin(sub, template_name)
            if found then return found end
        end
    end
    return nil
end

local function scan_templates(bin_obj, out)
    if not bin_obj then return end

    local ok, clips = pcall(function() return bin_obj:GetClipList() or {} end)
    if ok then
        for _, clip in ipairs(clips) do
            pcall(function()
                local props = clip:GetClipProperty() or {}
                local clip_type = tostring(props["Type"] or props["Clip Type"] or "")
                local name = clip_name(clip)
                if clip_type:find("Title", 1, true)
                    or clip_type:find("Text+", 1, true)
                    or clip_type:find("Fusion", 1, true)
                    or clip_type:find("Титры", 1, true) then
                    if not clip_type:find("Composition", 1, true) then out[name] = true end
                end
            end)
        end
    end

    local subs_ok, subs = pcall(function() return bin_obj:GetSubFolderList() or {} end)
    if subs_ok then
        for _, sub in ipairs(subs) do
            scan_templates(sub, out)
        end
    end
end

local function get_text_plus_tool(clip)
    local ok, comp = pcall(function() return clip:GetFusionCompByIndex(1) end)
    if not ok or not comp then return nil end

    local tools_ok, tools = pcall(function() return comp:GetToolList(false, "TextPlus") end)
    if tools_ok and tools then
        for _, tool in pairs(tools) do return tool end
    end

    tools_ok, tools = pcall(function() return comp:GetToolList(false) end)
    if tools_ok and tools then
        for _, tool in pairs(tools) do
            local input_ok, value = pcall(function() return tool:GetInput("StyledText") end)
            if input_ok and value ~= nil then return tool end
        end
    end
    return nil
end

local function get_auto_subs_tool(clip)
    local ok, comp = pcall(function() return clip:GetFusionCompByIndex(1) end)
    if not ok or not comp then return nil, nil end

    local ok_tool, tool = pcall(function()
        if comp.FindTool then return comp:FindTool("SmartSubs") end
        return nil
    end)
    if ok_tool and tool then return comp, tool end

    local tools_ok, tools = pcall(function() return comp:GetToolList(false) end)
    if tools_ok and tools then
        for _, candidate in pairs(tools) do
            local has_word_timing = false
            local has_delay_spline = false
            pcall(function() has_word_timing = candidate:GetData("WordTiming") ~= nil end)
            pcall(function() has_delay_spline = candidate:GetData("DelaySpline") ~= nil end)
            if has_word_timing and has_delay_spline then
                return comp, candidate
            end
        end
    end

    return comp, nil
end

local function build_text_word_spans(text)
    local spans = {}
    local chars = utf8_chars(text)
    local in_word = false
    local start_index = 0
    local current = {}

    for i, ch in ipairs(chars) do
        if tostring(ch):match("^%s$") then
            if in_word then
                table.insert(spans, {
                    text = table.concat(current, ""),
                    startIndex = start_index,
                    endIndex = i - 2,
                })
                in_word = false
                current = {}
            end
        else
            if not in_word then
                in_word = true
                start_index = i - 1
                current = {}
            end
            table.insert(current, ch)
        end
    end

    if in_word then
        table.insert(spans, {
            text = table.concat(current, ""),
            startIndex = start_index,
            endIndex = #chars - 1,
        })
    end

    return spans
end

local function build_autosubs_word_timing(block, fps, text_value)
    local timing = {}
    local start_frame = tc_to_frame(block.start, fps)
    local spans = build_text_word_spans(text_value or block.text or "")

    for i, word in ipairs(block.words or {}) do
        local span = spans[i]
        if not span then break end
        local word_start = math.max(tc_to_frame(word.start, fps) - start_frame, 0)
        local word_end = math.max(tc_to_frame(word["end"], fps) - start_frame, word_start)

        table.insert(timing, {
            startIndex = span.startIndex,
            endIndex = span.endIndex,
            startFrame = word_start,
            endFrame = word_end,
        })
    end

    return timing
end

local function apply_autosubs_template(item, block, fps, pc_settings)
    if not block or type(block.words) ~= "table" or #block.words == 0 then return false end

    local comp, autosubs_tool = get_auto_subs_tool(item)
    if not comp or not autosubs_tool then return false end

    local text_value = tostring(block.text or "")
    if text_value == "" then return false end
    local word_timing = build_autosubs_word_timing(block, fps, text_value)
    if #word_timing == 0 then return false end
    local ok = pcall(function() autosubs_tool:SetData("WordTiming", word_timing) end)
    if not ok then return false end

    -- AutoSubs macro exposes Text as the control input. Its ExecuteOnChange
    -- updates StyledText, delay keyframes, highlight styling, and stored timing.
    pcall(function() autosubs_tool:SetInput("Text", text_value) end)
    if pc_settings then
        pcall(function() autosubs_tool:SetInput("TextSize", pc_settings.Size) end)
        pcall(function() autosubs_tool:SetInput("TextPosition", pc_settings.Center) end)
    end

    local apply_func = nil
    pcall(function() apply_func = autosubs_tool:GetData("ApplyWordTiming") end)
    if apply_func and apply_func ~= "" then
        pcall(function()
            loadstring(apply_func)()(comp, autosubs_tool, word_timing)
        end)
    end

    pcall(function() autosubs_tool:SetInput("StyledText", text_value) end)

    return true
end

local function get_preview_caption_settings(timeline, fallback_size, fallback_x, fallback_y)
    local settings = { Size = fallback_size or 0.07, Center = { fallback_x or 0.5, fallback_y or 0.5 } }
    local track_count = timeline:GetTrackCount("video") or 0
    for i = track_count, 1, -1 do
        local items = timeline:GetItemListInTrack("video", i) or {}
        for _, item in ipairs(items) do
            if item:GetName() == "Preview Caption" then
                local tool = get_text_plus_tool(item)
                if tool then
                    local ok, sz = pcall(function() return tool:GetInput("Size") end)
                    if ok and sz ~= nil then settings.Size = sz end
                    local ok2, center = pcall(function() return tool:GetInput("Center") end)
                    if ok2 and center ~= nil then settings.Center = center end
                end
                return settings
            end
        end
    end
    return settings
end

local function delete_preview_caption_impl(timeline)
    local clips = {}
    for i = 1, (timeline:GetTrackCount("video") or 0) do
        local items = timeline:GetItemListInTrack("video", i) or {}
        for _, item in ipairs(items) do
            if item:GetName() == "Preview Caption" then
                table.insert(clips, item)
            end
        end
    end
    if #clips > 0 then
        timeline:DeleteClips(clips)
    end
    return #clips
end

function Connect()
    local ctx, err = get_context(true)
    if not ctx then return err end
    return ok_response({ name = ctx.timeline:GetName() or "<unknown timeline>" })
end

function GetSubtitleTracks()
    local ctx, err = get_context(true)
    if not ctx then return err end
    local tracks = {}
    local count = ctx.timeline:GetTrackCount("subtitle") or 0
    for i = 1, count do
        table.insert(tracks, { idx = i, name = ctx.timeline:GetTrackName("subtitle", i) or ("Subtitle " .. i) })
    end
    return { tracks = tracks }
end

function GetSubtitlesFromTrack(track_index)
    local ctx, err = get_context(true)
    if not ctx then return err end
    local fps = get_fps(ctx.timeline)
    local items = ctx.timeline:GetItemListInTrack("subtitle", tonumber(track_index) or 1) or {}
    local blocks = {}
    for idx, item in ipairs(items) do
        local uid = nil
        pcall(function()
            if item.GetUniqueId then uid = item:GetUniqueId() end
        end)
        local start_frame = item:GetStart()
        local end_frame = item:GetEnd()
        table.insert(blocks, {
            idx = idx,
            uid = uid,
            startFrame = start_frame,
            endFrame = end_frame,
            start = frame_to_tc(start_frame, fps),
            ["end"] = frame_to_tc(end_frame, fps),
            text = item:GetName() or ""
        })
    end
    return { blocks = blocks }
end

local function frames_equal(a, b)
    return math.abs((tonumber(a) or 0) - (tonumber(b) or 0)) <= 1
end

local function try_set_subtitle_text(item, text)
    text = tostring(text or "")
    local current = tostring(item:GetName() or "")
    if current == text then return true, false end

    local changed = false
    local ok, result = pcall(function() return item:SetName(text) end)
    if ok and result ~= false then changed = true end

    if not changed then
        ok, result = pcall(function() return item:SetClipProperty("Name", text) end)
        if ok and result ~= false then changed = true end
    end

    local verify_ok, after = pcall(function() return item:GetName() end)
    if verify_ok and tostring(after or "") == text then
        return true, changed
    end

    return false, changed
end

local function try_set_subtitle_timing(item, start_frame, end_frame)
    start_frame = tonumber(start_frame) or 0
    end_frame = tonumber(end_frame) or start_frame
    local current_start = item:GetStart()
    local current_end = item:GetEnd()
    if frames_equal(current_start, start_frame) and frames_equal(current_end, end_frame) then
        return true, false
    end

    local attempts = {
        function()
            local ok1 = item:SetProperty("Start", start_frame)
            local ok2 = item:SetProperty("End", end_frame)
            return ok1 ~= false and ok2 ~= false
        end,
        function()
            return item:SetProperty({ Start = start_frame, End = end_frame }) ~= false
        end,
        function()
            local ok1 = item:SetProperty("StartFrame", start_frame)
            local ok2 = item:SetProperty("EndFrame", end_frame)
            return ok1 ~= false and ok2 ~= false
        end,
        function()
            local ok1 = item:SetClipProperty("Start", tostring(start_frame))
            local ok2 = item:SetClipProperty("End", tostring(end_frame))
            return ok1 ~= false and ok2 ~= false
        end,
        function()
            local duration = math.max(end_frame - start_frame, 1)
            return item:SetProperty("Duration", duration) ~= false
        end,
    }

    for _, attempt in ipairs(attempts) do
        pcall(attempt)
        local ok_s, new_start = pcall(function() return item:GetStart() end)
        local ok_e, new_end = pcall(function() return item:GetEnd() end)
        if ok_s and ok_e and frames_equal(new_start, start_frame) and frames_equal(new_end, end_frame) then
            return true, true
        end
    end

    return false, true
end

local function srt_time(value)
    value = tostring(value or "00:00:00,000")
    return value:gsub("%.", ",")
end

local function normalize_subtitle_text(value)
    value = tostring(value or "")
    value = value:gsub("%s+", " ")
    value = value:gsub("^%s+", ""):gsub("%s+$", "")
    return value
end

local function first_block_frame(blocks, fps)
    if not blocks or not blocks[1] then return 0 end
    return math.max(tc_to_frame(blocks[1].start, fps), 0)
end

local function timeline_start_frame(timeline)
    local ok, value = pcall(function() return timeline:GetStartFrame() end)
    if ok and tonumber(value) then return tonumber(value) end
    return 0
end

local function write_blocks_to_srt(blocks, fps, frame_offset)
    local tmp_dir = os.getenv("TMPDIR") or os.getenv("TEMP") or os.getenv("TMP")
    if not tmp_dir or tmp_dir == "" then
        tmp_dir = (package.config:sub(1, 1) == "\\") and "." or "/tmp"
    end
    tmp_dir = tmp_dir:gsub("\\", "/"):gsub("/+$", "")
    math.randomseed(os.time())
    local path = tmp_dir .. "/subly_sync_" .. tostring(os.time()) .. "_" .. tostring(math.random(100000, 999999)) .. ".srt"
    local file, open_err = io.open(path, "wb")
    if not file then return nil, open_err end

    file:write("\239\187\191")
    for i, block in ipairs(blocks or {}) do
        local start_frame = math.max(tc_to_frame(block.start, fps) - (tonumber(frame_offset) or 0), 0)
        local end_frame = math.max(tc_to_frame(block["end"], fps) - (tonumber(frame_offset) or 0), start_frame + 1)
        file:write(tostring(i), "\n")
        file:write(srt_time(frame_to_tc(start_frame, fps)), " --> ", srt_time(frame_to_tc(end_frame, fps)), "\n")
        file:write(tostring(block.text or ""), "\n\n")
    end
    file:close()
    return path, nil
end

local function get_or_create_media_pool_bin(ctx, name)
    local mp = ctx.project:GetMediaPool()
    local root = mp:GetRootFolder()
    pcall(function() mp:RefreshFolders() end)
    local folders = collect_bins_by_name(root, name, {})
    if #folders > 0 then
        merge_duplicate_media_pool_bins(mp, folders)
        return folders[1]
    end

    local ok, created = pcall(function() return mp:AddSubFolder(root, name) end)
    if ok and created then return created end

    pcall(function() mp:RefreshFolders() end)
    return find_bin_by_name(root, name)
end

local function as_media_pool_item(value)
    local function looks_like_item(item)
        if item == nil then return false end
        local ok = pcall(function()
            if item.GetName then return item:GetName() end
            return nil
        end)
        return ok
    end

    if looks_like_item(value) then return value end
    if type(value) == "table" then
        for _, item in pairs(value) do
            if looks_like_item(item) then return item end
        end
    end
    return nil
end

local function import_subtitle_file(ctx, path)
    local mp = ctx.project:GetMediaPool()
    local imported = nil
    local previous_folder = nil
    pcall(function() previous_folder = mp:GetCurrentFolder() end)

    local sync_folder = get_or_create_media_pool_bin(ctx, "Subly_sync")
    if sync_folder then
        pcall(function() mp:SetCurrentFolder(sync_folder) end)
    end

    pcall(function() imported = mp:ImportMedia({ path }) end)
    local item = as_media_pool_item(imported)
    if item then
        if sync_folder then pcall(function() mp:MoveClips({ item }, sync_folder) end) end
        if previous_folder then pcall(function() mp:SetCurrentFolder(previous_folder) end) end
        return item
    end

    pcall(function() imported = ctx.resolve:GetMediaStorage():AddItemListToMediaPool({ path }) end)
    item = as_media_pool_item(imported)
    if item then
        if sync_folder then pcall(function() mp:MoveClips({ item }, sync_folder) end) end
        if previous_folder then pcall(function() mp:SetCurrentFolder(previous_folder) end) end
        return item
    end

    if previous_folder then pcall(function() mp:SetCurrentFolder(previous_folder) end) end

    return nil
end

local function import_srt_to_subly_sync(ctx, blocks, fps)
    local timeline = ctx.timeline
    pcall(function() ctx.resolve:OpenPage("edit") end)
    if not blocks or #blocks == 0 then
        return false, "Editor is empty; no subtitles were applied", nil
    end

    local first_frame = first_block_frame(blocks, fps)
    local path, write_err = write_blocks_to_srt(blocks, fps, first_frame)
    if not path then
        return false, "Could not write temporary SRT: " .. tostring(write_err), nil
    end

    local media_item = import_subtitle_file(ctx, path)
    if not media_item then
        return false, "DaVinci Resolve did not import the temporary SRT file into Subly_sync", nil
    end

    -- Park the playhead on the exact record frame where the exported SRT should
    -- be dropped if the user drags it from Media Pool onto the timeline.
    local current_tc = ""
    pcall(function() current_tc = timeline:GetCurrentTimecode() or "" end)
    pcall(function() timeline:SetCurrentTimecode(frame_to_resolve_tc(first_frame, fps, tostring(current_tc):find(";", 1, true) ~= nil)) end)

    return true, "SRT imported into Subly_sync", path
end

function ApplySubtitlesToTrack(track_index, blocks)
    local ctx, err = get_context(true)
    if not ctx then return err end
    local fps = get_fps(ctx.timeline)
    blocks = blocks or {}

    local imported, import_msg, srt_path = import_srt_to_subly_sync(ctx, blocks, fps)
    if imported then
        return ok_response({ message = import_msg, imported = true, srtPath = srt_path })
    end
    return {
        ok = false,
        message = "Apply failed",
        detail = tostring(import_msg),
    }
end

local function get_resolve_const(names, default)
    if type(names) == "string" then names = { names } end
    for _, name in ipairs(names or {}) do
        local ok, value = pcall(function() return resolve[name] end)
        if ok and value ~= nil then return value end
    end
    return default
end

function TranscribeAudio(language, chars_per_line)
    local ctx, err = get_context(true)
    if not ctx then return err end

    local lang_map = {
        Auto = { "AUTO_CAPTION_AUTO" },
        Danish = { "AUTO_CAPTION_DANISH" },
        Dutch = { "AUTO_CAPTION_DUTCH" },
        English = { "AUTO_CAPTION_ENGLISH" },
        French = { "AUTO_CAPTION_FRENCH" },
        German = { "AUTO_CAPTION_GERMAN" },
        Italian = { "AUTO_CAPTION_ITALIAN" },
        Japanese = { "AUTO_CAPTION_JAPANESE" },
        Korean = { "AUTO_CAPTION_KOREAN" },
        ["Mandarin - Simplified"] = { "AUTO_CAPTION_MANDARIN_SIMPLIFIED", "AUTO_CAPTION_SIMPLIFIED_CHINESE", "AUTO_CAPTION_CHINESE" },
        ["Mandarin - Traditional"] = { "AUTO_CAPTION_MANDARIN_TRADITIONAL", "AUTO_CAPTION_TRADITIONAL_CHINESE", "AUTO_CAPTION_CHINESE" },
        Norwegian = { "AUTO_CAPTION_NORWEGIAN" },
        Portuguese = { "AUTO_CAPTION_PORTUGUESE" },
        Russian = { "AUTO_CAPTION_RUSSIAN" },
        Spanish = { "AUTO_CAPTION_SPANISH" },
        Swedish = { "AUTO_CAPTION_SWEDISH" },
    }

    local cpl = math.max(1, math.min(tonumber(chars_per_line) or 1, 60))
    local lang_const = get_resolve_const(lang_map[language] or { "AUTO_CAPTION_AUTO" }, get_resolve_const("AUTO_CAPTION_AUTO", 0))
    local settings = {
        [get_resolve_const("SUBTITLE_LANGUAGE", "subtitleLanguage")] = lang_const,
        [get_resolve_const("SUBTITLE_CAPTION_PRESET", "subtitleCaptionPreset")] = get_resolve_const("AUTO_CAPTION_SUBTITLE_DEFAULT", 0),
        [get_resolve_const("SUBTITLE_CHARS_PER_LINE", "subtitleCharsPerLine")] = cpl,
        [get_resolve_const("SUBTITLE_LINE_BREAK", "subtitleLineBreak")] = get_resolve_const("AUTO_CAPTION_LINE_SINGLE", 1),
        [get_resolve_const("SUBTITLE_GAP", "subtitleGap")] = 3,
    }

    local ok, result = pcall(function() return ctx.timeline:CreateSubtitlesFromAudio(settings) end)
    if not ok then return make_error("API Error", result) end
    if not result then return make_error("DaVinci Resolve failed to generate subtitles", "Make sure audio is clear and tracks are not muted") end
    return ok_response()
end

function GetFusionTemplates(drb_path)
    local ctx, err = get_context(false)
    if not ctx then return err end
    local mp = ctx.project:GetMediaPool()
    local root = mp:GetRootFolder()

    local target_bin = find_bin_by_name(root, "Subly") or find_bin_by_name(root, "SubsAI")
    if not target_bin and drb_path and drb_path ~= "" then
        pcall(function() mp:ImportFolderFromFile(drb_path) end)
        pcall(function() ctx.resolve:GetMediaStorage():AddItemListToMediaPool({ drb_path }) end)
        sleep(0.5)
    end

    local set = {}
    scan_templates(root, set)
    local templates = {}
    for name, _ in pairs(set) do
        if name and name ~= "" then table.insert(templates, name) end
    end
    table.sort(templates)
    return { templates = templates }
end

function CreatePreviewCaption(template_name)
    local ctx, err = get_context(true)
    if not ctx then return err end
    pcall(function() ctx.resolve:OpenPage("edit") end)
    local timeline = ctx.timeline
    local mp = ctx.project:GetMediaPool()
    local fps = get_fps(timeline)
    local root = mp:GetRootFolder()
    local template_clip = find_template_clip_in_bin(root, template_name)
    if not template_clip then return make_error("Template not found", "Template '" .. tostring(template_name) .. "' not found in Media Pool") end

    local ok_props, props = pcall(function() return template_clip:GetClipProperty() end)
    if ok_props and props then
        local template_fps = tonumber(props["Clip Frame Rate"] or props["FPS"])
        if template_fps and math.abs(template_fps - fps) > 0.01 then
            return make_error("FPS Mismatch Detected!", string.format("Timeline FPS: %s\nTemplate '%s' FPS: %s", tostring(fps), tostring(template_name), tostring(template_fps)))
        end
    end

    if not timeline:AddTrack("video") then return make_error("Failed to create a new video track", "Make sure the Edit page is open") end
    local text_track = timeline:GetTrackCount("video")
    local current_frame = timeline_tc_to_frame(timeline:GetCurrentTimecode(), fps)
    local dur = math.max(math.floor(fps), 1)

    local added = mp:AppendToTimeline({ {
        mediaPoolItem = template_clip,
        startFrame = 0,
        endFrame = dur,
        trackIndex = text_track,
        recordFrame = current_frame,
    } })
    if not added or not added[1] then
        pcall(function() timeline:DeleteTrack("video", text_track) end)
        return make_error("Failed to place template on the timeline", "AppendToTimeline returned no item")
    end

    local item = added[1]
    pcall(function() item:SetClipColor("Orange") end)
    pcall(function() item:SetName("Preview Caption") end)
    pcall(function() item:SetClipProperty("Name", "Preview Caption") end)
    local current_tc = ""
    pcall(function() current_tc = timeline:GetCurrentTimecode() or "" end)
    pcall(function() timeline:SetCurrentTimecode(frame_to_resolve_tc(current_frame + math.floor(dur / 2), fps, tostring(current_tc):find(";", 1, true) ~= nil)) end)
    return ok_response()
end

function UpdatePreviewCaption(size, x, y, text)
    local ctx, err = get_context(true)
    if not ctx then return err end
    local timeline = ctx.timeline
    for i = (timeline:GetTrackCount("video") or 0), 1, -1 do
        local items = timeline:GetItemListInTrack("video", i) or {}
        for _, item in ipairs(items) do
            if item:GetName() == "Preview Caption" then
                local tool = get_text_plus_tool(item)
                if tool then
                    tool:SetInput("Size", tonumber(size) or 0.07)
                    tool:SetInput("Center", { tonumber(x) or 0.5, tonumber(y) or 0.5 })
                    if text ~= nil then tool:SetInput("StyledText", tostring(text)) end
                    return ok_response()
                end
            end
        end
    end
    return make_error("Preview Caption not found", "Create a preview caption first")
end

function DeletePreviewCaption()
    local ctx, err = get_context(true)
    if not ctx then return err end
    return ok_response({ deleted = delete_preview_caption_impl(ctx.timeline) })
end

function SendFusionTextTitles(blocks, template_name, source_track, fill_gaps, max_frames, fallback_size, fallback_x, fallback_y)
    local ctx, err = get_context(true)
    if not ctx then return err end
    pcall(function() ctx.resolve:OpenPage("edit") end)
    local timeline = ctx.timeline
    local mp = ctx.project:GetMediaPool()
    local fps = get_fps(timeline)
    local root = mp:GetRootFolder()
    local template_clip = find_template_clip_in_bin(root, template_name)
    if not template_clip then return make_error("Template not found", "Template '" .. tostring(template_name) .. "' not found in Media Pool") end

    if not timeline:AddTrack("video") then return make_error("Failed to create a new video track", "Make sure the Edit page is open") end
    local text_track = timeline:GetTrackCount("video")
    local pc_settings = get_preview_caption_settings(timeline, fallback_size, fallback_x, fallback_y)

    local clip_infos = {}
    local valid_blocks = {}
    blocks = blocks or {}
    for i, block in ipairs(blocks) do
        local start_f = tc_to_frame(block.start, fps)
        local end_f = tc_to_frame(block["end"], fps)
        if fill_gaps and i < #blocks then
            local next_start_f = tc_to_frame(blocks[i + 1].start, fps)
            local gap_frames = next_start_f - end_f
            if gap_frames > 0 and gap_frames <= (tonumber(max_frames) or 100) then
                end_f = next_start_f
            end
        end
        local dur = math.max(end_f - start_f, 1)
        table.insert(clip_infos, {
            mediaPoolItem = template_clip,
            startFrame = 0,
            endFrame = dur,
            trackIndex = text_track,
            recordFrame = start_f,
        })
        table.insert(valid_blocks, block)
    end

    if #clip_infos == 0 then
        pcall(function() timeline:DeleteTrack("video", text_track) end)
        return make_error("No valid blocks", "No valid blocks to place on the timeline")
    end
    local added = mp:AppendToTimeline(clip_infos)
    if not added or #added == 0 then
        pcall(function() timeline:DeleteTrack("video", text_track) end)
        return make_error("Failed to place templates on the timeline", "AppendToTimeline returned no clips")
    end

    local applied_count = 0
    for i, item in ipairs(added) do
        local ok_apply = pcall(function()
            local block = valid_blocks[i]
            if not apply_autosubs_template(item, block, fps, pc_settings) then
                local tool = get_text_plus_tool(item)
                if tool then
                    tool:SetInput("StyledText", block.text or "")
                    tool:SetInput("Size", pc_settings.Size)
                    tool:SetInput("Center", pc_settings.Center)
                end
            end
        end)
        if ok_apply then applied_count = applied_count + 1 end
    end

    pcall(function() delete_preview_caption_impl(timeline) end)
    if source_track ~= nil and source_track ~= json.null then
        pcall(function() timeline:SetTrackEnable("subtitle", tonumber(source_track), false) end)
    end

    pcall(function()
        for _, track_type in ipairs({ "video", "subtitle" }) do
            for i = (timeline:GetTrackCount(track_type) or 0), 1, -1 do
                local items = timeline:GetItemListInTrack(track_type, i)
                if not items or #items == 0 then timeline:DeleteTrack(track_type, i) end
            end
        end
    end)

    return ok_response({ created = applied_count, requested = #valid_blocks })
end

function SetPlayhead(tc)
    local ctx, err = get_context(true)
    if not ctx then return err end
    local fps = get_fps(ctx.timeline)
    local frames = tc_to_frame(tc, fps)
    local current_tc = ""
    pcall(function() current_tc = ctx.timeline:GetCurrentTimecode() or "" end)
    local ok, result = pcall(function() return ctx.timeline:SetCurrentTimecode(frame_to_resolve_tc(frames, fps, tostring(current_tc):find(";", 1, true) ~= nil)) end)
    if not ok or result == false then return make_error("Failed to set playhead", result or "SetCurrentTimecode returned false") end
    return ok_response()
end

local DISPATCH = {
    Ping = function(_) return ok_response({ message = "Pong" }) end,
    Connect = function(_) return Connect() end,
    GetSubtitleTracks = function(_) return GetSubtitleTracks() end,
    GetSubtitlesFromTrack = function(data) return GetSubtitlesFromTrack(data.trackIndex) end,
    ApplySubtitlesToTrack = function(data) return ApplySubtitlesToTrack(data.trackIndex, data.blocks) end,
    TranscribeAudio = function(data) return TranscribeAudio(data.language, data.charsPerLine) end,
    GetFusionTemplates = function(data) return GetFusionTemplates(data.drbPath) end,
    CreatePreviewCaption = function(data) return CreatePreviewCaption(data.templateName) end,
    UpdatePreviewCaption = function(data) return UpdatePreviewCaption(data.size, data.x, data.y, data.text) end,
    DeletePreviewCaption = function(_) return DeletePreviewCaption() end,
    SendFusionTextTitles = function(data) return SendFusionTextTitles(data.blocks, data.templateName, data.sourceTrack, data.fillGaps, data.maxFrames, data.fallbackSize, data.fallbackX, data.fallbackY) end,
    SetPlayhead = function(data) return SetPlayhead(data.tc) end,
}

local function launch_app(app_path, app_args)
    if not app_path or app_path == "" then return end
    app_args = app_args or ""

    if ffi and ffi.os == "Windows" then
        pcall(ffi.cdef, [[
            typedef wchar_t WCHAR;
            int MultiByteToWideChar(unsigned int CodePage, unsigned long dwFlags, const char* lpMultiByteStr, int cbMultiByte, WCHAR* lpWideCharStr, int cchWideChar);
            intptr_t ShellExecuteW(void* hwnd, const WCHAR* lpOperation, const WCHAR* lpFile, const WCHAR* lpParameters, const WCHAR* lpDirectory, int nShowCmd);
        ]])
        local function to_wide(str)
            local len = #str + 1
            local buffer = ffi.new("WCHAR[?]", len)
            local written = ffi.C.MultiByteToWideChar(65001, 0, str, -1, buffer, len)
            if written == 0 then error("wide conversion failed") end
            return buffer
        end
        local ok = pcall(function()
            ffi.C.ShellExecuteW(nil, to_wide("open"), to_wide(app_path), to_wide(app_args), nil, 5)
        end)
        if ok then return end
    end

    local function quote(value)
        return '"' .. tostring(value):gsub('"', '\\"') .. '"'
    end
    if package.config:sub(1, 1) == "\\" then
        os.execute('cmd.exe /C start "" ' .. quote(app_path) .. ' ' .. app_args)
    else
        os.execute(quote(app_path) .. ' ' .. app_args .. ' &')
    end
end

local function send_exit_to_existing_server()
    pcall(function()
        local info = assert(socket.find_first_address("127.0.0.1", PORT))
        local client = assert(socket.create(info.family, info.socket_type, info.protocol))
        client:set_blocking(true)
        client:connect(info)
        local body = '{"func":"Exit"}'
        local req = string.format("POST / HTTP/1.1\r\nHost: 127.0.0.1:%d\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: %d\r\n\r\n%s", PORT, #body, body)
        client:send(req)
        client:close()
    end)
end

local function handle_request(content, req_token)
    local data = nil
    local decode_ok, decoded = pcall(function()
        if content and #content > 0 then
            return json.decode(content, 1, nil)
        end
        return nil
    end)
    if decode_ok then data = decoded end

    if not data or type(data) ~= "table" then
        return make_error("Invalid JSON data", content or "")
    end
    -- Exit is left unauthenticated on purpose so a fresh launch can evict a stale
    -- server squatting on the port. Every other (potentially destructive) call
    -- requires the per-launch token passed via SUBLY_TOKEN.
    if data.func == "Exit" then
        return { message = "Server shutting down", exit = true }
    end
    if AUTH_TOKEN and AUTH_TOKEN ~= "" and req_token ~= AUTH_TOKEN then
        return make_error("Unauthorized", "Missing or invalid Subly bridge token")
    end

    local handler = DISPATCH[data.func]
    if not handler then
        return make_error("Unknown function", tostring(data.func))
    end

    local ok, result = pcall(function() return handler(data) end)
    if not ok then
        return make_error("Server handler failed", result)
    end
    return result or ok_response()
end

local function start_server(app_path, app_args)
    if not socket or not json then error("Subly Lua modules are not loaded") end

    local info = assert(socket.find_first_address("127.0.0.1", PORT))
    local server = assert(socket.create(info.family, info.socket_type, info.protocol))
    server:set_blocking(false)
    pcall(function() server:set_option("nodelay", true, "tcp") end)
    pcall(function() server:set_option("reuseaddr", true) end)

    local ok = pcall(function() assert(server:bind(info)) end)
    if not ok then
        send_exit_to_existing_server()
        sleep(0.5)
        assert(server:bind(info))
    end
    assert(server:listen())

    log("Subly Lua API server is listening on port " .. PORT)
    log("Launching app: " .. tostring(app_path) .. " " .. tostring(app_args or "--auto-connect"))
    launch_app(app_path, app_args or "--auto-connect")

    local quit = false
    while not quit do
        local client, accept_err = server:accept()
        if client then
            local request = ""
            pcall(function()
                client:set_blocking(false)
                local first = client:receive()
                request = type(first) == "string" and first or ""

                local sep = "\r\n\r\n"
                -- os.time() (wall clock) not os.clock() — the latter is CPU time on
                -- macOS/Linux, so a mostly-sleeping read loop would never time out.
                local start_time = os.time()
                while os.time() - start_time < 2 do
                    local sep_start, sep_end = request:find(sep, 1, true)
                    if sep_end then
                        local headers = request:sub(1, sep_start - 1)
                        local body_start = sep_end + 1
                        local length = tonumber(headers:match("[Cc]ontent%-[Ll]ength:%s*(%d+)")) or 0
                        local current = #request - (body_start - 1)
                        if current >= length then break end
                    end
                    local chunk, recv_err = client:receive(1024)
                    if type(chunk) == "string" and #chunk > 0 then
                        request = request .. chunk
                    elseif recv_err == "timeout" then
                        sleep(0.01)
                    else
                        break
                    end
                end
            end)

            local sep_start, sep_end = request:find("\r\n\r\n", 1, true)
            local body_text = sep_end and request:sub(sep_end + 1) or ""
            local headers_text = sep_start and request:sub(1, sep_start - 1) or request
            local req_token = headers_text:lower():match("x%-subly%-token:%s*([^\r\n]+)")
            local result = handle_request(body_text, req_token)
            if result and result.exit then quit = true end

            local encoded = json.encode(result or {})
            pcall(function() client:send(create_response(encoded)) end)
            pcall(function() client:close() end)
        elseif accept_err ~= "timeout" then
            -- Keep server alive on transient socket errors.
            sleep(0.1)
        else
            sleep(0.1)
        end
    end

    pcall(function() server:close() end)
    log("Subly Lua API server stopped")
end

local Subly = {}
function Subly:Init(app_path, resources_path, app_args)
    resources_path = resources_path or ""
    log("Subly Lua bridge init")
    log("Resources: " .. tostring(resources_path))
    package.path = package.path .. ";" .. join_path(join_path(resources_path, "modules"), "?.lua")
    local ok_socket, socket_or_err = pcall(require, "ljsocket")
    if not ok_socket then
        log("Failed to load ljsocket: " .. tostring(socket_or_err))
        error(socket_or_err)
    end
    socket = socket_or_err
    local ok_json, json_or_err = pcall(require, "dkjson")
    if not ok_json then
        log("Failed to load dkjson: " .. tostring(json_or_err))
        error(json_or_err)
    end
    json = json_or_err
    start_server(app_path, app_args or "--auto-connect")
end

return Subly
