#!/usr/bin/env python3
"""Split the transpiled Z80 core (output of tools/z80_transpile.py) into one small function per prefix/opcode.

Why: z80_transpile.py emits a single runCore() of ~800 KB. V8 never optimizes a function that large, and every call
sets up its very large frame; the sound CPU calls runCore() ~5700 times per frame (the K053260 timer cuts each frame
into ~3800 slices), so most of the Z80's time went into entering the function. This pass keeps the exact control flow:
each `case <opcode>:` body of the slow (re-entry) and fast (fetched opcode) switches becomes a function, and the jumps
that left the body become return codes the small driver acts on:
  break slow -> DONE        toProc = 1; break slow -> PROC (slow section)
  continue fast -> FAST     continue proc -> PROC (fast section)     return -> RET
The driver is the original runCore with each two-level switch replaced by a table lookup. Bodies must end in a jump
(no fall-through between opcode cases); the pass checks this and stops otherwise.
Usage: python tools/z80_split.py web/sim/z80m_core.js > split.js   (input: the unsplit generated core)"""
import re, sys

src = open(sys.argv[1], encoding='utf-8').read()
DONE, PROC, FAST, RET = 0, 1, 2, 3

def match_brace(s, i):
    """s[i] == '{' -> index of the matching '}' (the generated code has no strings, regexes or comments with braces)."""
    d = 0
    for j in range(i, len(s)):
        c = s[j]
        if c == '{': d += 1
        elif c == '}':
            d -= 1
            if d == 0: return j
    raise ValueError('unbalanced')

def cases(body):
    """Split a switch body into [(labels, text)] at depth 0 (stacked labels collect into one clause)."""
    out, d, i, cur, labels, start = [], 0, 0, None, [], None
    pat = re.compile(r'case (0x[0-9a-f]+):')
    while i < len(body):
        c = body[i]
        if c == '{': d += 1
        elif c == '}': d -= 1
        elif d == 0 and body.startswith('case ', i):
            m = pat.match(body, i)
            if m:
                if start is not None and body[start:i].strip():
                    out.append((labels, body[start:i])); labels = []
                labels.append(int(m.group(1), 16)); i = m.end(); start = i; continue
        i += 1
    if start is not None: out.append((labels, body[start:]))
    return out

def two_level(s, at):
    """At `switch (((this.ref >> 16)&0xff))` index `at`: returns (end index of the switch, {(prefix, op): body})."""
    o = s.index('{', at); e = match_brace(s, o); table = {}
    for plabels, pbody in cases(s[o + 1:e]):
        if 'switch (((this.ref >> 8)&0xff))' not in pbody:
            # a prefix without an opcode switch (the fetch/interrupt re-entry, prefix 0xff): one block for every opcode key
            bo = pbody.index('{'); be = match_brace(pbody, bo)
            if pbody[be + 1:].strip() != 'break;': raise ValueError('unexpected text after a prefix block')
            for p in plabels:
                for op in range(256): table[(p, op)] = pbody[bo + 1:be]
            continue
        ib = pbody.index('switch (((this.ref >> 8)&0xff))'); io = pbody.index('{', ib); ie = match_brace(pbody, io)
        tail = pbody[ie + 1:].strip()
        if tail not in ('} break;', '}'): raise ValueError('unexpected text after an opcode switch: %r' % tail[:80])
        for olabels, obody in cases(pbody[io + 1:ie]):
            for p in plabels:
                for op in olabels: table[(p, op)] = obody
    return e, table

JUMP_END = re.compile(r'(break slow;|continue fast;|continue proc;|return;)\s*$')
def convert(body, section):
    b = body.rstrip()
    if not JUMP_END.search(b): raise ValueError('opcode body does not end in a jump (%s): %r' % (section, b[-120:]))
    if section == 'slow':
        b = b.replace('toProc = 1; break slow;', 'return %d;' % PROC).replace('break slow;', 'return %d;' % DONE)
        if 'continue fast' in b or 'continue proc' in b: raise ValueError('fast jump in a slow body')
    else:
        b = b.replace('continue fast;', 'return %d;' % FAST).replace('continue proc;', 'return %d;' % PROC)
        if 'break slow' in b: raise ValueError('slow jump in a fast body')
    if 'toProc' in b or 'break fetch' in b: raise ValueError('driver state used inside an opcode body')
    b = re.sub(r'\breturn;', 'return %d;' % RET, b)
    return b

head, runcore = src.split('Z.prototype.runCore = function () {', 1)
pre, body_rest = runcore.split('slow: for (;;) {', 1)
decl = pre.strip()   # 'const w = ...; let toProc = 0; const CF ...;' + wait_state check
s = 'slow: for (;;) {' + body_rest
sw1 = s.index('switch (((this.ref >> 16)&0xff))'); e1, slow = two_level(s, sw1)
after_slow = s[e1 + 1:]
fast_at = after_slow.index('fast: for (;;) {')
between = after_slow[:fast_at]    # ';\n}\nif (this.ref !== 0xffff00) toProc = 1;\n'
fast_part = after_slow[fast_at:]
sw2 = fast_part.index('switch (((this.ref >> 16)&0xff))'); e2, fast = two_level(fast_part, sw2)
fast_head, fast_tail = fast_part[:sw2], fast_part[e2 + 1:]

consts = re.search(r'const CF = [^;]+;', decl).group(0)
out = [head.rstrip().replace("module.exports = function (Z) {", "").rstrip(),
       '// Split into one function per prefix/opcode by tools/z80_split.py (exact control flow; see that file).',
       consts,
       'const DONE = %d, PROC = %d, FAST = %d, RET = %d;' % (DONE, PROC, FAST, RET),
       'const SLOW = new Array(65536), FASTOP = new Array(65536);']
def emit(table, name, section):
    seen = {}   # identical bodies (a prefix block shared by every opcode key) become one function
    for (p, op), b in sorted(table.items()):
        key = (p << 8) | op
        if b in seen: out.append('%s[0x%04x] = %s[0x%04x];' % (name, key, name, seen[b])); continue
        seen[b] = key
        out.append('%s[0x%04x] = function () { const w = this.w, b = this.b, f = this.f;\n%s\n};' % (name, key, convert(b, section)))
emit(slow, 'SLOW', 'slow'); emit(fast, 'FASTOP', 'fast')
driver = decl + '\n' + \
    'slow: for (;;) {\n' \
    'const sf = SLOW[(this.ref >> 8) & 0xffff], sc = sf.call(this);\n' \
    'if (sc === RET) return; if (sc === PROC) toProc = 1; break slow;\n}\n' + between.lstrip().lstrip(';').lstrip().lstrip('}') + \
    fast_head + \
    'const pf = FASTOP[(this.ref >> 8) & 0xffff], pc = pf.call(this);\n' \
    'if (pc === RET) return; if (pc === PROC) continue proc; continue fast;\n' + fast_tail
out.append('module.exports = function (Z) { Z.prototype.runCore = function () {\n' + driver)
sys.stdout.write('\n'.join(out))
