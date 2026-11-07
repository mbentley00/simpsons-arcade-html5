#!/usr/bin/env python3
"""Transpile MAME's generated Z80 core (build/generated/emu/cpu/z80/z80.hxx, slow re-enter section)
into a JS function body. Only the code structure is MAME's (BSD-3-Clause, Juergen Buchmueller, Andrei I. Holub).
Usage: z80_transpile.py z80.hxx > web/sim/z80m_core.js"""
import re, sys
src = open(sys.argv[1]).read().split('\n')
end = next(i for i, l in enumerate(src) if l.startswith('} // end: slow'))
fst = next(i for i, l in enumerate(src) if l.startswith('while (true) { // fast process'))
fend = next(i for i, l in enumerate(src) if l.startswith('} // end: fast'))
SLOW = re.sub(r'/\*.*?\*/', '', '\n'.join(src[:end + 1]), flags=re.S)
FAST = re.sub(r'/\*.*?\*/', '', '\n'.join(src[fst + 1:fend]), flags=re.S)
R16 = dict(AF=0, BC=1, DE=2, HL=3, IX=4, IY=5, WZ=6, TDAT=7, TDAT2=8, SP=9, PC=10, PRVPC=11)
R8 = dict(F=0, A=1, C=2, B=3, E=4, D=5, L=6, H=7, LX=8, HX=9, LY=10, HY=11, WZ_L=12, WZ_H=13,
          TDAT_L=14, TDAT8=14, TDAT_H=15, R=16, R2=17, I=18)
FL = dict(s_val=0, z_val=1, yx_val=2, h_val=3, pv_val=4, n=5, c=6, q=7, qtemp=8)
ALIAS = {'m_r2': 'R2', 'm_r': 'R', 'm_i': 'I', 'm_pc.w': 'PC', 'Q': 'm_f.q', 'QT': 'm_f.qtemp'}
FUN = ['data_read', 'data_write', 'arg_read', 'opcode_read', 'stack_read', 'stack_write', 'rlca', 'rrca', 'rla', 'rra',
       'add_a', 'adc_a', 'sub_a', 'sbc_a', 'neg', 'daa', 'and_a', 'or_a', 'xor_a', 'cp', 'exx', 'rlc', 'rrc', 'rl', 'rr',
       'sla', 'sra', 'sll', 'srl', 'bit', 'bit_hl', 'bit_xy', 'ei', 'halt', 'leave_halt', 'illegal_1', 'illegal_2',
       'get_f', 'set_f', 'block_io_interrupted_flags', 'standard_irq_callback', 'io_read', 'io_write', 'reti']

def balanced(s, i):  # s[i] == '(' -> index after matching ')'
    d = 0
    for j in range(i, len(s)):
        if s[j] == '(': d += 1
        elif s[j] == ')':
            d -= 1
            if d == 0: return j + 1
    raise ValueError(s)

def casts(s):
    for pat, mask in ((r'\(u16\)\(', '0xffff'), (r'\bu8\(', '0xff'), (r'\bu16\(', '0xffff')):
        while True:
            m = re.search(pat, s)
            if not m: break
            p = m.end() - 1; e = balanced(s, p)
            s = s[:m.start()] + '((' + s[p + 1:e - 1] + ')&' + mask + ')' + s[e:]
    s = re.sub(r'\(u16\)(\w+)', r'((\1)&0xffff)', s)
    s = re.sub(r'\(s8\)(\w+)', r'((\1<<24)>>24)', s)
    return s

def translate(body):
  lines = []
  for raw in body.split('\n'):
      l = raw.split('//')[0].rstrip() if '//' in raw and '"' not in raw else raw.rstrip()
      t = l.strip()
      ind = l[:len(l) - len(l.lstrip())]
      if not t: continue
      if t.startswith(('LOGMASKED', 'assert(', 'using std::swap', 'device_execute_interface::device().debug', 'logerror',
                       '[[maybe_unused]]', 'const bool nomreq_en', 'debugger_wait_hook', 'bool interrupted')):
          if t.endswith(';'): lines.append(ind + ';'); continue
          raise ValueError(t)
      if t == '[[fallthrough]];': continue
      t = t.replace('debugger_instruction_hook(PC);', 'if (this.hook) this.hook();')
      t = t.replace('debugger_enabled()', 'false').replace('nomreq_en', 'false').replace('refresh_en', 'false')
      t = re.sub(r'\bm_(nomreq|refresh|irqack|busack)_cb\(.*\);', ';', t)
      t = t.replace('access_to_be_redone()', 'false').replace('m_mreq_cycles', '3').replace('m_m1_cycles', '4').replace('m_iorq_cycles', '4')
      t = t.replace('device_z80daisy_interface *intf = daisy_get_irq_device();', 'var intf = null;')
      t = t.replace('intf != nullptr', 'false').replace('intf->z80daisy_irq_ack()', '0').replace('daisy_call_reti_device();', 'this.reti();')
      t = t.replace('m_io.read_interruptible(', 'io_read(').replace('m_io.write_interruptible(', 'io_write(')
      t = t.replace('goto process;', 'go = 1; continue;')
      t = re.sub(r'set_service_attention<(SA_\w+), 1>\(\);', r'this.sa |= 1 << this.\1;', t)
      t = re.sub(r'set_service_attention<(SA_\w+), 0>\(\);', r'this.sa &= ~(1 << this.\1);', t)
      t = re.sub(r'get_service_attention<(SA_\w+)>\(\)', r'(this.sa & (1 << this.\1))', t)
      m = re.match(r'swap\((\w+), (\w+)\);$', t)
      if m:
          a, b = m.groups(); a = {'m_af': 'AF'}.get(a, a); b = {'m_af2': 'm_af2.w'}.get(b, b)
          t = '{ const t_ = %s; %s = %s; %s = t_; }' % (a, a, b, b)
      m = re.match(r'(inc|dec)\((\w+)\);$', t)
      if m: t = '%s = this.%s(%s);' % (m.group(2), m.group(1), m.group(2))
      t = re.sub(r'\bres\((\d), ', r'this.res_(\1, ', t)
      t = re.sub(r'\bset\((\d), ', r'this.set_(\1, ', t)
      m = re.match(r'(?:const )?(u8|u16|u32|int|bool) (\w+) = (.*);$', t)
      if m:
          ty, n, e = m.groups()
          e = {'u8': '(%s) & 0xff', 'u16': '(%s) & 0xffff', 'u32': '(%s) >>> 0'}.get(ty, '%s') % e
          t = 'var %s = %s;' % (n, e)
      m = re.match(r'm_f\.(c|n) = ([^=]*);$', t)
      if m: t = 'm_f.%s = (%s) ? 1 : 0;' % m.groups()
      t = casts(t)
      for k, v in ALIAS.items(): t = re.sub(r'(?<![\w.])' + re.escape(k) + r'\b', v, t)
      t = re.sub(r'\bm_(af2|bc2|de2|hl2)\.w\b', lambda m: 'w[%d]' % {'af2': 12, 'bc2': 13, 'de2': 14, 'hl2': 15}[m.group(1)], t)
      t = re.sub(r'\bm_f\.(\w+)\(\)', r'this.f_\1()', t)
      t = re.sub(r'\bm_f\.(\w+)', lambda m: 'f[%d]' % FL[m.group(1)], t)
      t = re.sub(r'\b(' + '|'.join(R16) + r')\b', lambda m: 'w[%d]' % R16[m.group(1)], t)
      t = re.sub(r'\b(' + '|'.join(sorted(R8, key=len, reverse=True)) + r')\b', lambda m: 'b[%d]' % R8[m.group(1)], t)
      t = re.sub(r'(?<![\w.])(' + '|'.join(FUN) + r')\(', r'this.\1(', t)
      t = re.sub(r'\bm_(ref|icount|iff1|iff2|im|halt|irq_state|nmi_state|busreq_state|busack_state|tmp_irq_vector|wait_state|ea|service_attention)\b',
                 lambda m: 'this.' + {'service_attention': 'sa'}.get(m.group(1), m.group(1)), t)
      t = t.replace('nullptr', 'null').replace('CLEAR_LINE', '0')
      if re.search(r'\bm_\w|::|->|<\w+>', t): raise ValueError('unhandled: ' + t)
      lines.append(ind + t)

  return lines

lab = [0x1000]
def parse(ls, i):  # parse until matching close; returns (nodes, i_after_close, closer_line)
    nodes = []
    while i < len(ls):
        t = ls[i].strip()
        if t.startswith('}'):
            return nodes, i, t
        if re.match(r'case 0x[0-9a-f]+:$', t): nodes.append(('case', t)); i += 1; continue
        if t.endswith('{') and t.count('{') - t.count('}') == 1:
            head = t; kids, i, closer = parse(ls, i + 1)
            node = ['blk', head, kids, None]
            cur = node
            while closer.startswith('} else'):
                if closer.startswith('} else if'):
                    sub = ['blk', closer[7:], None, None]
                    sk, i, closer = parse(ls, i + 1); sub[2] = sk
                    cur[3] = [sub]; cur = sub
                else:
                    ek, i, closer = parse(ls, i + 1); cur[3] = ek
            nodes.append(tuple(node)); i += 1; continue
        nodes.append(('stmt', ls[i])); i += 1
    return nodes, i, None
def hascase(ns):
    for n in ns or []:
        if n[0] == 'case': return True
        if n[0] == 'blk' and (hascase(n[2]) or hascase(n[3])): return True
    return False
def emit(ns, out):
    for n in ns:
        if n[0] == 'stmt': out.append(n[1])
        elif n[0] == 'case': out.append(n[1])
        else:
            _, head, th, el = n
            if not (hascase(th) or hascase(el)):
                out.append(head); emit(th, out)
                while el is not None:
                    if len(el) == 1 and el[0][0] == 'blk' and el[0][1].startswith('if'):
                        out.append('} else ' + el[0][1]); emit(el[0][2], out); el = el[0][3]
                    else:
                        out.append('} else {'); emit(el, out); el = None
                out.append('}'); continue
            if head == '{': emit(th, out); continue
            m = re.match(r'if \((.*)\) \{$', head); assert m, head
            le = lab[0]; lab[0] += 1; lend = lab[0]; lab[0] += 1
            out.append('if (!(%s)) { st = 0x%x; continue inner; }' % (m.group(1), le))
            emit(th, out)
            out.append('st = 0x%x; continue inner;' % lend)
            out.append('case 0x%x:' % le)
            if el: emit(el, out)
            out.append('case 0x%x:' % lend)
lines = translate(SLOW)
res = []; i = 0
while i < len(lines):
    t = lines[i].strip()
    if t == 'switch (((this.ref)&0xff))':
        assert lines[i + 1].strip() == '{'
        ns, j, closer = parse(lines, i + 2)
        assert closer == '}', closer
        if hascase([n for n in ns if n[0] == 'blk']):
            body = []; emit(ns, body)
            res.append('var st = this.ref & 0xff;'); res.append('inner: for (;;) { switch (st) {')
            res.extend(body); res.append('} break; }')
        else:
            res.append(lines[i]); res.append('{'); body = []; emit(ns, body); res.extend(body); res.append('}')
        i = j + 1; continue
    res.append(lines[i]); i += 1
slow = '\n'.join(res)
slow = slow.replace('go = 1; continue;', 'toProc = 1; break slow;')
slow = re.sub(r'\bcontinue;', 'this.ref = 0xffff00; break slow;', slow)
slow = re.sub(r'\n\s*if \(!interrupted\) \{\n\s*this\.ref = 0xffff00;\n\s*this.ref = 0xffff00; break slow;\n\s*\}\n\s*interrupted = false;', '', slow)
a = slow.index('while (((this.ref)&0xff) != 0x00) {')
slow = 'slow: for (;;) {' + slow[a + len('while (((this.ref)&0xff) != 0x00) {'):]
fast = '\n'.join(translate(FAST))
p = fast.index('\nprocess:')
fetch, proc = fast[:p], fast[p + len('\nprocess:'):]
fetch = fetch.replace('go = 1; continue;', 'break fetch;')
fetch = re.sub(r'\bcontinue;', 'continue fast;', fetch)
proc = proc.replace('go = 1; continue;', 'continue proc;')
proc = re.sub(r'\bcontinue;', 'continue fast;', proc)
def fix(x):
    return re.sub(r'\bthis\.halt\)', 'this.halt_)', x).replace('HAS_LDAIR_QUIRK', 'false')
slow = fix(slow); fetch = fix(fetch); proc = fix(proc)
print('// generated by tools/z80_transpile.py from MAME z80.hxx (BSD-3-Clause). Do not edit.')
print('module.exports = function (Z) { Z.prototype.runCore = function () {')
print('const w = this.w, b = this.b, f = this.f; let toProc = 0; const CF = 0x01, NF = 0x02, PF = 0x04, VF = 0x04, HF = 0x10, YXF = 0x28, ZF = 0x40, SF = 0x80;')
print('if (this.wait_state) { this.icount = 0; return; }')
print(slow)
print('if (this.ref !== 0xffff00) toProc = 1;')
print('fast: for (;;) {\nif (!toProc) { fetch: {')
print(fetch)
print('} }\ntoProc = 0;\nproc: for (;;) {')
print(proc)
print('break; }\n}\n}; };')
