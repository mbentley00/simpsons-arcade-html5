-- Dumps raw screen pixels (ARGB32, visible area) at chosen frames to snap/f<frame>.raw, plus time, for test/video_compare.js
local want = {}
for f in string.gmatch(os.getenv("SNAP_FRAMES") or "200,400,600,800", "%d+") do want[tonumber(f)] = true end
local scr = manager.machine.screens[":screen"]
emu.register_frame_done(function()
  local n = scr:frame_number()
  if want[n] then
    local px, w, h = scr:pixels()
    local f = io.open(string.format("snap/f%d.raw", n), "wb"); f:write(px); f:close()
    print(string.format("snap %d %dx%d t=%s", n, w, h, tostring(manager.machine.time)))
  end
end)
