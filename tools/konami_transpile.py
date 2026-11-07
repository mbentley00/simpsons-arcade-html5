#!/usr/bin/env python3
"""Transpile MAME's generated konami.hxx (resumable KONAMI CPU core) into JS.
Control flow (labels/goto/if/while/switch) is lowered to a flat state machine
so that MAME's mid-instruction suspension (push_state/return) is reproduced."""
import re, sys
SRC = sys.argv[1] if len(sys.argv) > 1 else '/opt/mame-master/src/build/generated/emu/cpu/m6809/konami.hxx'
OUT = sys.argv[2] if len(sys.argv) > 2 else None
s = open(SRC).read()
s = re.sub(r'/\*.*?\*/', '', s, flags=re.S)
s = re.sub(r'//[^\n]*', '', s)

def skipws(i):
    while i < len(s) and s[i].isspace(): i += 1
    return i
def balanced(i):  # s[i]=='(' -> returns (inner, j after ')')
    d = 0; j = i
    while True:
        c = s[j]
        if c == '(': d += 1
        elif c == ')':
            d -= 1
            if d == 0: return s[i+1:j], j+1
        j += 1
ident = re.compile(r'[A-Za-z_]\w*')

def parse_stmt(i):
    i = skipws(i)
    m = ident.match(s, i)
    if s[i] == '{':
        body, i = parse_list(i+1); return ('block', body), i+1
    if s[i] == ';': return ('block', []), i+1
    if m:
        w = m.group(0); j = skipws(m.end())
        if w == 'if':
            c, j = balanced(j); t, j = parse_stmt(j)
            k = skipws(j); e = None
            if s.startswith('else', k) and not s[k+4].isalnum():
                e, j = parse_stmt(k+4)
            return ('if', c, t, e), j
        if w == 'while':
            c, j = balanced(j); b, j = parse_stmt(j); return ('while', c, b), j
        if w == 'switch':
            c, j = balanced(j); j = skipws(j); assert s[j] == '{'
            body, j = parse_list(j+1); return ('switch', c, body), j+1
        if w == 'case':
            k = s.index(':', j); return ('case', s[j:k].strip()), k+1
        if w == 'default' and s[j] == ':': return ('case', None), j+1
        if w == 'goto':
            k = s.index(';', j); return ('goto', s[j:k].strip()), k+1
        if w == 'return': k = s.index(';', j); return ('ret',), k+1
        if w == 'break': k = s.index(';', j); return ('break',), k+1
        if s[j] == ':' and s[j+1] != ':': return ('label', w), j+1
    # expression statement
    j = i; d = 0
    while not (s[j] == ';' and d == 0):
        if s[j] in '([': d += 1
        elif s[j] in ')]': d -= 1
        j += 1
    return ('expr', s[i:j].strip()), j+1

def parse_list(i):
    out = []
    while True:
        i = skipws(i)
        if i >= len(s) or s[i] == '}': return out, i
        n, i = parse_stmt(i); out.append(n)

top, _ = parse_list(0)
tree = ('switch', 'pop_state()', top)

items = []; cnt = [0]
def new():
    cnt[0] += 1; return '__L%d' % cnt[0]
def lower(n, brk=None, cont=None):
    k = n[0]
    if k == 'block':
        for x in n[1]: lower(x, brk, cont)
    elif k == 'if':
        le = new(); items.append(('cgoto', '!(%s)' % n[1], le)); lower(n[2], brk, cont)
        if n[3] is not None:
            lend = new(); items.append(('goto', lend)); items.append(('label', le)); lower(n[3], brk, cont); items.append(('label', lend))
        else: items.append(('label', le))
    elif k == 'while':
        lt, lend = new(), new(); items.append(('label', lt)); items.append(('cgoto', '!(%s)' % n[1], lend))
        lower(n[2], lend, lt); items.append(('goto', lt)); items.append(('label', lend))
    elif k == 'switch':
        lend = new(); cases = []; dflt = lend; body = []
        for x in n[2]:
            if x[0] == 'case':
                l = new()
                if x[1] is None: dflt = l
                else: cases.append((x[1], l))
                body.append(('label', l))
            else: body.append(x)
        items.append(('jtable', n[1], cases, dflt))
        for x in body:
            if x[0] == 'label' and x[1].startswith('__L'): items.append(x)
            else: lower(x, lend, cont)
        items.append(('label', lend))
    elif k == 'break': items.append(('goto', brk))
    elif k in ('goto', 'label', 'ret', 'expr'): items.append(n)
    else: raise Exception(n)
lower(tree)

if OUT is None:
    ex = sorted(set(re.sub(r'\d+', 'N', x[1]) for x in items if x[0] == 'expr'))
    for e in ex: print(e)
    print('CONDS'); print('\n'.join(sorted(set(x[1] for x in items if x[0] == 'cgoto'))))
    print('JT'); print('\n'.join(sorted(set(x[1] for x in items if x[0] == 'jtable'))))
    sys.exit()

# ---------------- emission ----------------
def tr(e):
    e = e.replace('UNEXPECTED(', '(')
    e = re.sub(r'\(void\)', '', e)
    e = re.sub(r'\buint(8|16|32)_t\s+(\w+)\s*=', r'var \2 =', e)
    e = re.sub(r'\((u?int(8|16|32)_t)\)\s*', lambda m: '' if m.group(1).startswith('u') else '/*s%s*/' % m.group(2), e)
    e = e.replace('&regop16() == &m_s', 'this.r16 === this.s')
    e = e.replace('m_ppc = m_pc', 'm_ppc = m_pc.w')
    e = e.replace('m_q.p.d', 'm_q').replace('m_q.r.a', 'm_q.h').replace('m_q.r.b', 'm_q.l').replace('m_q.r.d', 'm_q.w')
    e = e.replace('.b.h', '.h').replace('.b.l', '.l')
    e = re.sub(r'set_regop8\(m_q\.(h|l)\)', r"this.r8 = '\1'", e)
    e = re.sub(r'set_regop16\((m_\w+)\)', r'this.r16 = \1', e)
    e = e.replace('regop8()', "this.q[this.r8]").replace('regop16()', 'this.r16').replace('ireg()', 'this.ireg().w')
    e = re.sub(r'set_flags<uint8_t>\(', 'sf8(', e); e = re.sub(r'set_flags<uint16_t>\(', 'sf16(', e)
    def sfw(m):
        return m.group(0)
    # untyped set_flags: infer width from the arguments
    out = ''; i = 0
    while True:
        j = e.find('set_flags(', i)
        if j < 0: out += e[i:]; break
        if j > 0 and (e[j-1].isalnum() or e[j-1] == '_'): out += e[i:j+10]; i = j+10; continue
        k = j + 9; d = 0
        while True:
            if e[k] == '(': d += 1
            elif e[k] == ')':
                d -= 1
                if d == 0: break
            k += 1
        args = e[j+10:k]
        w = '16' if re.search(r'\.w\b|this\.r16', args) else '8'
        out += e[i:j] + 'sf' + w + '(' ; i = j + 10
    e = out
    e = re.sub(r'/\*s(8|16)\*/\s*\(([^()]*)\)', r's\1(\2)', e)
    e = re.sub(r'/\*s(8|16)\*/\s*(m_[\w.]+)', r's\1(\2)', e)
    e = re.sub(r'\bBIT\(param, 7\)', '((param >> 7) & 1)', e)
    e = re.sub(r'\b(CC_\w+|VECTOR_\w+|ADDRESSING_MODE_\w+|INPUT_LINE_NMI|M6809_\w+|EXCEPTION_\w+)\b', r'K.\1', e)
    e = re.sub(r'\bm_(\w+)', r'this.\1', e)
    # helper calls
    e = re.sub(r'(?<![\w.])(?!(?:this|var|sf8|sf16|s8|s16|K)\b)([a-z_]\w*)\(', r'this.\1(', e)
    e = e.replace('this.sf8(', 'this.sf8(').replace('sf8(', 'this.sf8(').replace('this.this.', 'this.')
    e = re.sub(r'(?<![\w.])sf16\(', 'this.sf16(', e)
    e = re.sub(r'(?<![\w.])(s8|s16)\(', r'\1(', e)
    e = re.sub(r'this\.rotate_(left|right)\((this\.\w+)\.l\)', r'this.rotate_\1_8(\2.l)', e)
    e = re.sub(r'this\.rotate_(left|right)\((this\.\w+)\.w\)', r'this.rotate_\1_16(\2.w)', e)
    return e

ids = {}
for it in items:
    if it[0] == 'label': ids.setdefault(it[1], len(ids))
def lid(n): return ids[n]
o = []
o.append('// GENERATED by tools/konami_transpile.py from MAME konami.hxx (BSD-3-Clause, Nathan Woods). Do not edit.')
o.append('module.exports = function execute_one(K, s8, s16) {')
o.append('  let L = -1;')
o.append('  for (;;) switch (L) {')
o.append('  case -1:')
for it in items:
    k = it[0]
    if k == 'label': o.append('  case %d: // %s' % (lid(it[1]), it[1]))
    elif k == 'expr': o.append('    %s;' % tr(it[1]))
    elif k == 'goto': o.append('    L = %d; continue;' % lid(it[1]))
    elif k == 'cgoto': o.append('    if (%s) { L = %d; continue; }' % (tr(it[1]), lid(it[2])))
    elif k == 'ret': o.append('    return;')
    elif k == 'jtable':
        o.append('    switch (%s) {' % tr(it[1]))
        for v, l in it[2]: o.append('      case %s: L = %d; continue;' % (tr(v), lid(l)))
        o.append('    }')
        o.append('    L = %d; continue;' % lid(it[3]))
o.append('  default: throw new Error("bad label " + L);')
o.append('  }')
o.append('};')
open(OUT, 'w').write('\n'.join(o) + '\n')
print('labels', len(ids), 'lines', len(o))
