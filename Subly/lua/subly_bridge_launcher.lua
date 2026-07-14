--- Subly bridge launcher (self-locating).
--- Run by fuscript.exe. Resolves its own directory so the bridge can live
--- inside the plugin folder (ProgramData) with no runtime file copying.
---@diagnostic disable: undefined-global

local source = debug.getinfo(1, "S").source
local this_path = source:sub(1, 1) == "@" and source:sub(2) or source
local sep = package.config:sub(1, 1)
local resources_path = this_path:match("^(.*)[/\\][^/\\]+$") or "."

package.path = package.path
    .. ";" .. resources_path .. "/?.lua"
    .. ";" .. resources_path .. "/modules/?.lua"
    .. ";" .. resources_path .. sep .. "?.lua"
    .. ";" .. resources_path .. sep .. "modules" .. sep .. "?.lua"

local Subly = require("subly_resolve_core")
Subly:Init("", resources_path, "")
