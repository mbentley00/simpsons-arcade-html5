// Presentation modes (pt67u): CRT shader (WebGL) + original Simpsons-sky bezel at 16:9, CRT only, or the original sharp look.
// Presentation only: reads the finished 320x224 frame (game.js ImageData) and positions #screen; never touches the
// machine, inputs, rollback or hashes. #screen always sits exactly on the game picture so #chatov (chat bubbles, nicks,
// coin hint) stays aligned. Always CRT + 16:9 bezel (pt70u); hidden debug: ?gfx=crt|orig, ?webgl=0 (2D fallback).
// The bezel is drawn procedurally here (no image files, no Konami art). Fonts: system sans-serif only.
(function (G) {
  'use strict';
  const W = 320, H = 224, MODES = ['bezel', 'crt', 'orig'];
  const q = new URLSearchParams(location.search);
  let mode = q.get('gfx') || 'bezel';
  if (!MODES.includes(mode)) mode = 'bezel';
  let gl = null, prog = null, tex = null, crt = null, bz = null, bzKey = '', glFail = false, frames = 0;
  // ---------- layout ----------
  // bezel layout in 1920x1080 units: game picture 4:3, 860 high, centred at x, top 110
  // picture 990 of 1080 high (pt28u), title plaque on the top frame edge
  const BZ = { w: 1920, h: 1080, gh: 990, gy: 60 }; BZ.gw = BZ.gh * 4 / 3; BZ.gx = (BZ.w - BZ.gw) / 2;
  function rects() {
    const iw = innerWidth, ih = innerHeight;
    if (mode === 'orig' || (glFail && mode !== 'bezel')) {
      const s = Math.max(1, Math.floor(Math.min(iw / W, ih / H)));
      return { g: { x: (iw - W * s) >> 1, y: (ih - H * s) >> 1, w: W * s, h: H * s } };
    }
    if (mode === 'crt') {
      let h = ih, w = h * 4 / 3; if (w > iw) { w = iw; h = w * 3 / 4; }
      return { g: { x: (iw - w) / 2, y: (ih - h) / 2, w, h } };
    }
    let aw = iw, ah = aw * 9 / 16; if (ah > ih) { ah = ih; aw = ah * 16 / 9; }
    const a = { x: (iw - aw) / 2, y: (ih - ah) / 2, w: aw, h: ah }, k = aw / BZ.w;
    return { a, g: { x: a.x + BZ.gx * k, y: a.y + BZ.gy * k, w: BZ.gw * k, h: BZ.gh * k } };
  }
  // title font: Lilita One (SIL OFL 1.1, web/fonts/OFL.txt), bundled; bezel is redrawn once it loads
  let fontOK = false;
  if (G.FontFace && document.fonts) new FontFace('Lilita One', 'url(fonts/LilitaOne-Regular.ttf)').load().then(f => { document.fonts.add(f); fontOK = true; bzKey = ''; layout(); }).catch(() => {});
  const px = (el, r) => { el.style.left = r.x + 'px'; el.style.top = r.y + 'px'; el.style.width = r.w + 'px'; el.style.height = r.h + 'px'; };
  function layout() {
    const scr = document.getElementById('screen'); if (!scr) return;
    const R = rects(), useGL = mode !== 'orig' && ensureGL();
    px(scr, R.g); scr.style.opacity = useGL ? '0' : '1';
    scr.style.imageRendering = useGL || mode === 'orig' ? '' : 'auto';
    if (mode === 'orig') scr.style.imageRendering = 'pixelated';
    if (crt) {
      crt.style.display = useGL ? 'block' : 'none';
      if (useGL) { px(crt, R.g); const d = G.devicePixelRatio || 1; crt.width = Math.round(R.g.w * d); crt.height = Math.round(R.g.h * d); }
    }
    document.body.style.background = mode === 'bezel' ? 'radial-gradient(#2f6fb0,#0c1424 80%)' : '#000';
    if (mode === 'bezel') {
      if (!bz) { bz = document.createElement('canvas'); bz.id = 'bezel'; bz.style.cssText = 'position:absolute;z-index:0;pointer-events:none'; document.body.prepend(bz); }
      bz.style.display = 'block'; px(bz, R.a);
      const d = G.devicePixelRatio || 1, cw = Math.min(3840, Math.round(R.a.w * d)), key = cw + (fontOK ? 'f' : '');
      if (key !== bzKey) { bzKey = key; bz.width = cw; bz.height = Math.round(cw * 9 / 16); drawBezel(bz); }
    } else if (bz) bz.style.display = 'none';
  }
  // ---------- WebGL CRT ----------
  const VS = 'attribute vec2 p;varying vec2 uv;void main(){uv=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
  const FS = `precision mediump float;
uniform sampler2D T;uniform vec2 SRC;uniform vec2 OUT;varying vec2 uv;
vec2 warp(vec2 p){p=p*2.-1.;p*=vec2(1.+p.y*p.y*.028,1.+p.x*p.x*.040);return p*.5+.5;}
vec3 tap(float x,float y){float i=floor(x-.5),f=fract(x-.5);f=clamp((f-.5)*2.5+.5,0.,1.);vec3 c=texture2D(T,vec2(i+.5+f,y)/SRC).rgb;return c*c;}
vec3 beam(float d,vec3 c){vec3 w=mix(vec3(.24),vec3(.46),sqrt(c));vec3 e=d/w;return exp(-.5*e*e);}
void main(){
 vec2 w=warp(uv);
 if(w.x<0.||w.x>1.||w.y<0.||w.y>1.){gl_FragColor=vec4(0.,0.,0.,1.);return;}
 float sc=OUT.y/SRC.y, s=clamp((sc-1.6)/2.2,0.,1.);
 float x=w.x*SRC.x, sy=w.y*SRC.y-.5, r0=floor(sy), f=sy-r0;
 vec3 c0=tap(x,r0+.5), c1=tap(x,r0+1.5);
 vec3 scan=c0*beam(f,c0)+c1*beam(1.-f,c1);
 vec3 fl=mix(c0,c1,smoothstep(.3,.7,f));
 vec3 col=mix(fl,scan*1.75,s);
 vec2 b=vec2(1.6)/SRC; vec3 g=vec3(0.);
 g+=texture2D(T,w+vec2(b.x,b.y)).rgb;g+=texture2D(T,w+vec2(-b.x,b.y)).rgb;g+=texture2D(T,w+vec2(b.x,-b.y)).rgb;g+=texture2D(T,w+vec2(-b.x,-b.y)).rgb;
 g*=.25; col+=g*g*.16;
 float m=mod(floor(gl_FragCoord.x),3.); vec3 mk=vec3(.86); if(m<.5)mk.r=1.12;else if(m<1.5)mk.g=1.12;else mk.b=1.12;
 col*=mix(vec3(1.),mk,s);
 vec2 v=w*(1.-w); col*=pow(clamp(v.x*v.y*16.,0.,1.),.10);
 vec2 e=min(w,1.-w)*vec2(SRC.x/SRC.y,1.); float cm=smoothstep(0.,.008,min(e.x,e.y)); 
 gl_FragColor=vec4(sqrt(col)*cm,1.);}`;
  function ensureGL() {
    if (gl) return true; if (glFail || q.get('webgl') === '0') { glFail = true; return false; }
    try {
      crt = document.createElement('canvas'); crt.id = 'crt'; crt.style.cssText = 'position:absolute;z-index:1;pointer-events:none';
      gl = crt.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) throw new Error('no webgl');
      const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
      prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog);
      const bb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.uniform2f(gl.getUniformLocation(prog, 'SRC'), W, H); gl.uniform1i(gl.getUniformLocation(prog, 'T'), 0);
      crt.addEventListener('webglcontextlost', e => { e.preventDefault(); gl = null; glFail = true; layout(); });
      document.getElementById('screen').after(crt);
      return true;
    } catch (e) { console.warn('gfx: WebGL unavailable, using the 2D canvas', e.message); gl = null; glFail = true; if (crt) crt.remove(); crt = null; return false; }
  }
  const tms = [];
  function present(img) {
    if (mode === 'orig' || !gl) return;
    const t0 = performance.now();
    gl.viewport(0, 0, crt.width, crt.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.uniform2f(gl.getUniformLocation(prog, 'OUT'), crt.width, crt.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); frames++;
    tms.push(performance.now() - t0); if (tms.length > 240) tms.shift();
  }
  // ---------- bezel (procedural, 1920x1080 design units) ----------
  function rnd(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  function fitText(c, t, x, y, maxw) { const m = c.measureText(t).width; if (m > maxw) { c.save(); c.translate(x, y); c.scale(maxw / m, 1); c.fillText(t, 0, 0); c.restore(); } else c.fillText(t, x, y); }
  // ---- own procedural art: no Konami/official artwork, no characters, no logos ----
  const SANS = '"Helvetica Neue",Arial,"Liberation Sans","DejaVu Sans",sans-serif';
  function sky(c, top, bot) { const g = c.createLinearGradient(0, 0, 0, BZ.h); g.addColorStop(0, top); g.addColorStop(1, bot); c.fillStyle = g; c.fillRect(0, 0, BZ.w, BZ.h); }
  function cloud(c, x, y, s, a) { // soft puffy cloud: overlapping blurred circles
    c.save(); c.globalAlpha = a; c.filter = `blur(${s * .06}px)`; c.fillStyle = '#fff';
    for (const [dx, dy, r] of [[0, 0, .5], [.45, -.18, .42], [.85, .02, .38], [-.42, .06, .36], [.3, .16, .4]]) { c.beginPath(); c.arc(x + dx * s, y + dy * s, r * s, 0, 7); c.fill(); }
    c.restore();
  }
  function clouds(c, a, seed) { const r = rnd(seed);
    for (let i = 0; i < 60; i++) { const x = r() * BZ.w, y = 60 + r() * 900, s = 70 + r() * 110; if (x > BZ.gx - 60 && x < BZ.gx + BZ.gw + 60) continue; cloud(c, x, y, s, a * (.55 + r() * .45)); } }
  function frame(c, accent, dark) { // dark surround right at the picture so the screen stays the focus, thin warm accent line
    const gx = BZ.gx, gy = BZ.gy, gw = BZ.gw, gh = BZ.gh;
    c.save(); c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 50; c.fillStyle = dark; rr(c, gx - 34, gy - 34, gw + 68, gh + 68, 26); c.fill(); c.restore();
    c.strokeStyle = accent; c.lineWidth = 3; rr(c, gx - 22, gy - 22, gw + 44, gh + 44, 18); c.stroke();
    c.fillStyle = '#030303'; rr(c, gx - 6, gy - 6, gw + 12, gh + 12, 10); c.fill();
  }
  function vignette(c, a) { const g = c.createRadialGradient(960, 540, 300, 960, 540, 1150); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${a})`); c.fillStyle = g; c.fillRect(0, 0, BZ.w, BZ.h); }
  // title plaque straddling the top edge of the frame (like Sunset Riders): it never takes height from the picture
  function title(c) {
    const w = 400, h = 54, x = 960 - w / 2, y = 4; // spans the top frame band (y 26..60), fully on-screen
    c.save(); c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 18; c.shadowOffsetY = 5;
    const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, '#2a62a8'); g.addColorStop(1, '#123462');
    c.fillStyle = g; rr(c, x, y, w, h, 22); c.fill(); c.restore();
    c.lineWidth = 5; c.strokeStyle = '#f2c230'; rr(c, x + 2.5, y + 2.5, w - 5, h - 5, 20); c.stroke();
    c.lineWidth = 2; c.strokeStyle = 'rgba(12,20,36,.9)'; rr(c, x + 9, y + 9, w - 18, h - 18, 14); c.stroke();
    c.font = `40px "Lilita One",${SANS}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
    const ty = y + h / 2 + 2, txt = 'THE SIMPSONS', mw = w - 60, m = c.measureText(txt).width, sx = Math.min(1, mw / m);
    c.save(); c.translate(960, ty); c.scale(sx, 1);
    c.lineWidth = 8; c.strokeStyle = '#1a1206'; c.strokeText(txt, 0, 0);
    const tg = c.createLinearGradient(0, -18, 0, 18); tg.addColorStop(0, '#fff27a'); tg.addColorStop(.55, '#ffd90f'); tg.addColorStop(1, '#f0a800');
    c.fillStyle = tg; c.fillText(txt, 0, 0); c.restore();
  }
  function donut(c, x, y, R, a, rot = 0) {
    c.save(); c.globalAlpha = a; c.translate(x, y); c.rotate(rot);
    c.fillStyle = '#d9a35a'; c.beginPath(); c.arc(0, 0, R, 0, 2 * Math.PI); c.moveTo(R * .36, 0); c.arc(0, 0, R * .36, 0, 2 * Math.PI, true); c.fill('evenodd');
    c.fillStyle = '#f39ac0'; c.beginPath(); for (let i = 0; i <= 24; i++) { const t = i / 24 * 2 * Math.PI, rr2 = R * (.86 + .04 * Math.sin(t * 7)); c.lineTo(Math.cos(t) * rr2, Math.sin(t) * rr2); } c.closePath(); c.moveTo(R * .46, 0); c.arc(0, 0, R * .46, 0, 2 * Math.PI, true); c.fill('evenodd');
    const r = rnd(R | 0), SP = ['#fff', '#6cc8f0', '#ffe14d', '#8fe06a'];
    for (let i = 0; i < 16; i++) { const t = r() * 7, d = R * (.52 + r() * .3); c.save(); c.translate(Math.cos(t) * d, Math.sin(t) * d); c.rotate(r() * 7); c.fillStyle = SP[i % 4]; c.fillRect(-R * .07, -R * .018, R * .14, R * .036); c.restore(); }
    c.restore();
  }
  function drawBezel(cv) { // original art (pt18u/pt19u): daytime sky, soft clouds, a few donuts off-screen, dark surround
    const c = cv.getContext('2d'), k = cv.width / BZ.w; c.setTransform(k, 0, 0, k, 0, 0);
    sky(c, '#4f9be0', '#1d4f86'); clouds(c, .45, 3);
    DONUTS.forEach(([x, y, R, rot]) => { c.save(); c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 14; c.shadowOffsetY = 6; donut(c, x, y, R, .95, rot); c.restore(); });
    for (const [x, y, s2] of [[200, 520, 90], [50, 760, 110], [1720, 300, 100], [1880, 690, 100], [170, 1000, 80]]) cloud(c, x, y, s2, .8); // in front: donuts partly behind
    vignette(c, .45); frame(c, '#f2c230', '#0c1424'); title(c);
  }
  const DONUTS = [[130, 170, 60, .4], [105, 420, 46, 2.1], [150, 660, 54, 4.0], [120, 920, 62, 1.2], // left side (clear of the frame at x 266)
    [1790, 150, 50, 3.3], [1805, 390, 62, .9], [1770, 640, 46, 5.2], [1800, 900, 58, 2.7]];           // right side (frame ends at x 1654)
  // ---------- debug mode switch (tests only; no key, not persisted) ----------
  function set(m) { if (!MODES.includes(m)) return; mode = m; layout(); }
  addEventListener('resize', layout);
  G.SSRGFX = { layout, present, set, get mode() { return mode; }, get webgl() { return !!gl; }, get frames() { return frames; }, modes: MODES, msPresent: () => tms.reduce((a, b) => a + b, 0) / (tms.length || 1) };
})(window);
