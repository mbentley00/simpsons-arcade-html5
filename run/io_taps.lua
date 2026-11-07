-- Records every main-CPU data read in 0x0000-0x3fff (K052109/palette/K053247/IO views) in order, so
-- test/konami_lockstep.js can replay them; also logs bank (SETLN) is derived by the JS side.
local cpu = manager.machine.devices[":maincpu"]
local sp = cpu.spaces["program"]
local f = io.open("run/out/mreads.bin", "wb")
local n = 0
tap = sp:install_read_tap(0x0000, 0x3fff, "ioreads", function(offset, data, mask)
  f:write(string.char(offset & 0xff, (offset >> 8) & 0xff, data & 0xff)); n = n + 1
  return data
end)
emu.add_machine_stop_notifier(function() f:close(); print("reads logged: " .. n) end)
local dbg = manager.machine.debugger
if dbg then
  dbg:command('trace run/out/mtrace.log,maincpu,noloop,{tracelog "%04X %02X %02X %04X %04X %04X %04X %02X %02X %d\\n",pc,a,b,x,y,u,s,dp,cc,totalcycles}')
  dbg:command('go')
  for _, l in ipairs(dbg.consolelog) do print(l) end
end
