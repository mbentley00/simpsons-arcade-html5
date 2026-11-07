-- Plays an input script (INPUT_SCRIPT, format in test/input/*.txt) frame-exactly and logs, per frame, a hash of the
-- main CPU work RAM + palette/K052109 views are left out (only 0x4000-0x5fff), and every read of the input ports.
--   run/out/inlog.txt:  F <frame> <fnv32 of 0x4000-0x5fff>   /   R <frame> <addr> <value>
local scr = manager.machine.screens[":screen"]
local sp = manager.machine.devices[":maincpu"].spaces["program"]
local ports = manager.machine.ioport.ports
local ev = {}
for l in io.lines(os.getenv("INPUT_SCRIPT")) do
  local f, p, v = l:match("^%s*(%d+)%s+(%u+%d?)%s+(%x+)")
  if f then ev[#ev + 1] = { tonumber(f), p, tonumber(v, 16) } end
end
local last = tonumber(os.getenv("LAST_FRAME") or "4000")
local snap = {}
for f in string.gmatch(os.getenv("SNAP_FRAMES") or "", "%d+") do snap[tonumber(f)] = true end
local out = io.open("run/out/inlog.txt", "w")
local function apply(pname, bits)
  for _, fld in pairs(ports[":" .. pname].fields) do
    if fld.mask & 0xff ~= 0 and fld.type_class ~= "internal" then fld:set_value((bits & fld.mask) ~= 0 and 1 or 0) end
  end
end
tap = sp:install_read_tap(0x1f80, 0x1f93, "inreads", function(offset, data, mask)
  if offset == 0x1f80 or (offset >= 0x1f90 and offset <= 0x1f93) then out:write(string.format("R %d %04x %02x\n", scr:frame_number(), offset, data & 0xff)) end
  return data
end)
emu.register_frame_done(function()
  local n = scr:frame_number()
  local h = 0x811c9dc5
  for a = 0x4000, 0x5fff do h = ((h ~ sp:read_u8(a)) * 0x01000193) & 0xffffffff end
  out:write(string.format("F %d %08x\n", n, h))
  if snap[n] then local px = scr:pixels(); local f = io.open(string.format("snap/f%d.raw", n), "wb"); f:write(px); f:close() end
  for _, e in ipairs(ev) do if e[1] == n then apply(e[2], e[3]) end end
  if n >= last then out:close(); manager.machine:exit() end
end)
