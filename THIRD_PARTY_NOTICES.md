# Third-party notices

The JavaScript written for this player has no license header, and this repository does not add one for that code.

The portions below are translations or generated translations of other people's source. Each of those upstream files is marked BSD-3-Clause. The terms are printed once at the end of this file. The copyright line that applies is the one named with each portion.

MAME as a whole is released under GPL-2.0, with individual files under the license named in their headers. This tree does not contain `simpsons.cpp` or any other MAME driver. `web/sim/simpsons.js`, `web/sim/video.js`, and the hand-written `web/sim/z80.js` are separate models checked against MAME's behavior. They are not labeled as copies of MAME source.

The sine and power tables in `web/sim/ym2151.js` come from ymfm. They are chip constants, not bytes taken from the Simpsons ROM.

## KONAMI 053248 CPU

`web/sim/konami.js`, `web/sim/konamim.js`, `web/sim/konamim_core.js`, and the output of `tools/konami_transpile.py`.

Upstream: MAME `src/devices/cpu/m6809/konami.cpp` (and the generated `konami.hxx` built from it), tag checked `mame0289`.

```
// license:BSD-3-Clause
// copyright-holders:Nathan Woods
```

That file says it is based on the M6809 core, and `m6809.cpp` at the same tag says `Copyright John Butler` with `copyright-holders:Nathan Woods`. The M6809 comment also says that core derives from L.C. Benschop's 6809 Simulator V09. This import repeats that attribution and does not add a separate license for V09.

## Z80

`web/sim/z80m.js`, `web/sim/z80m_core.js`, and the output of `tools/z80_transpile.py`.

Upstream: MAME `src/devices/cpu/z80/z80.cpp` (generated `z80.hxx`), tag checked `mame0289`.

```
// license:BSD-3-Clause
// copyright-holders:Juergen Buchmueller
```

`tools/z80_transpile.py` also names Andrei I. Holub. That name is not in the `z80.cpp` header at the tag above. Both names are recorded here; only Buchmueller is confirmed from that header.

`web/sim/z80.js` is a separate interpreter. Its header does not say it is a translation of MAME source. No third-party license is attached to it here.

## YM2151

`web/sim/ym2151.js`, a JavaScript port of ymfm's OPM engine, including the tables ymfm generates.

```
Copyright (c) 2021, Aaron Giles
BSD 3-Clause License
```

The ymfm `LICENSE` file is the text in the section below.

## K053260

`web/sim/k053260.js`.

Upstream: MAME `src/devices/sound/k053260.cpp`, tag checked `mame0289`.

```
// license:BSD-3-Clause
// copyright-holders:Ernesto Corvi, Alex W. Jackson
```

The pan steps and the 4-bit ADPCM nibble table are part of that device. They are not the game's sample ROM.

## Scheduler

`web/sim/sched.js`.

Upstream: MAME `src/emu/schedule.cpp` and `src/emu/diexec.cpp`, tag checked `mame0289`.

```
// license:BSD-3-Clause
// copyright-holders:Aaron Giles
```

## Resampler used by the older mixer

`web/sim/mixer.js` follows the curve its comment calls MAME's `audio_resampler_lofi`. The coefficients are computed in the file. Current MAME `src/emu/resampler.cpp` (tag `mame0289`) is BSD-3-Clause, copyright-holder Olivier Galibert. This import did not re-check the older lofi function line by line against that file. The live page does not use this mixer; `web/audio_worklet.js` plays the board's samples with a linear read step.

## Lilita One

`web/fonts/LilitaOne-Regular.ttf`.

```
Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz),
with Reserved Font Name Lilita
```

SIL Open Font License, Version 1.1. The full text is `web/fonts/OFL.txt`.

## PeerJS

Not stored in this repository. If the page is opened with `?net=peerjs`, it loads `peerjs@1.5.4` from unpkg. That package's `license` field is MIT.

## BSD-3-Clause terms

The following terms apply to each BSD-3-Clause portion above, together with the copyright line named for that portion.

```
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
