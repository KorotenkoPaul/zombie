// Frame-spike profiler on the phone profile (iPhone UA + viewport, MOBILE path).
//   node tests/spikes/spikes.js [gameMinutes=10] [renderEvery=1]
// Runs the real game loop with virtual time (dt 1/60) and logs every frame whose cost is more than SPIKE ms (default 40)
// above the running median, with what it was spent on: shader compile / link, texture upload, GC, raycast, and the
// game file (owner) on the stack. Attribution comes from the V8 sampling profiler (CDP), aligned to frames with a
// calibration spin; shader compile and texture upload are also timed directly on the WebGL context.
// Output: tests/spikes/out/spikes.json + a summary grouped by owner on stdout.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const MIN = +(process.argv[2] || 10), RENDER_EVERY = +(process.argv[3] || 1), PORT = 8131;
const SPIKE = +(process.env.SPIKE || 40), CHUNK = +(process.env.CHUNK || 120), FPS = 60;
const W = +(process.env.W || 390), H = +(process.env.H || 844);

const OWNER = {
  'hero.js': 'Character', 'brain.js': 'Brain', 'tree.js': 'Tree & house', 'treedress.js': 'Tree dressing', 'props.js': 'Props',
  'env.js': 'Environment', 'ground.js': 'Ground', 'lights.js': 'Lights', 'camera.js': 'Camera', 'collide.js': 'Collide',
  'wind.js': 'Wind', 'smoke.js': 'Wind', 'rain.js': 'Wind', 'fogbank.js': 'Wind', 'fogpass.js': 'Wind', 'audio.js': 'Sound',
  'perf.js': 'Optimization', 'motion.js': 'Motion matching', 'index.html': 'index.html (shared)',
};
function category(stack) {           // stack: top (leaf) first, array of {fn,url,line}
  const top = stack[0] || { fn: '' };
  if (top.fn === '(garbage collector)') return 'GC';
  for (const f of stack.slice(0, 12)) {
    if (/^(compileShader|linkProgram|getProgramParameter|getShaderParameter|WebGLShader|WebGLProgram|getProgramInfoLog|fetchAttributeLocations|getProgram|acquireProgram)$/.test(f.fn) || /WebGLProgram/.test(f.fn)) return 'shader compile';
    if (/^(texImage2D|texSubImage2D|texStorage2D|uploadTexture|setTexture2D|compressedTexImage2D|generateMipmap|initTexture|texImage3D)$/.test(f.fn)) return 'texture upload';
    if (/^(bufferData|bufferSubData|updateBuffer|createBuffer)$/.test(f.fn)) return 'buffer upload';
    if (/raycast|intersect(Object|Triangle|Ray|Sphere|Box)/i.test(f.fn) || /bvh/i.test(f.url)) return 'raycast';
    if (/rapier/i.test(f.url)) return 'physics (rapier)';
  }
  for (const f of stack) if (/three\.module|three\/examples/.test(f.url) && /^(render|renderBufferDirect|renderObjects|renderScene|projectObject|setProgram|renderObject|render)$/.test(f.fn)) return 'render';
  return 'js';
}
function ownerOf(stack) {            // the innermost game file on the stack
  for (const f of stack) { const m = /\/game\/([\w.]+)(\?|$)/.exec(f.url) || /\/([\w]+\.(js|html))(\?|$)/.exec(f.url); if (m && OWNER[m[1]]) return { owner: OWNER[m[1]], file: m[1], fn: f.fn, line: f.line }; }
  return { owner: 'three.js / engine', file: (stack[0] && stack[0].url.split('/').pop()) || '', fn: stack[0] && stack[0].fn };
}

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  await p.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1'; document.head.appendChild(m); });
    const realNow = performance.now.bind(performance);
    window.__realNow = realNow;
    // capture the game's frame callback once the game is up; the profiler then steps it by hand
    const raf = window.requestAnimationFrame.bind(window); let n = 0;
    window.requestAnimationFrame = cb => { if (window.__th && ++n > 3) { window.__rafCb = cb; return 1; } return raf(cb); };
    // time shader compile / link and texture uploads directly on the context
    const G = window.__glStat = { compile: 0, compileN: 0, link: 0, linkN: 0, tex: 0, texN: 0, buf: 0, bufN: 0 };
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue; const P = C.prototype;
      const wrap = (name, k) => { const f = P[name]; if (!f) return; P[name] = function () { const t = realNow(); try { return f.apply(this, arguments); } finally { G[k] += realNow() - t; G[k + 'N']++; } }; };
      wrap('compileShader', 'compile'); wrap('getShaderParameter', 'compile'); wrap('linkProgram', 'link'); wrap('getProgramParameter', 'link');
      wrap('texImage2D', 'tex'); wrap('texSubImage2D', 'tex'); wrap('texStorage2D', 'tex'); wrap('generateMipmap', 'tex'); wrap('compressedTexImage2D', 'tex'); wrap('texImage3D', 'tex');
      wrap('bufferData', 'buf'); wrap('bufferSubData', 'buf');
    }
  });
  const tl = Date.now();
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__rafCb, null, { timeout: 600000, polling: 500 });
  console.log(`page ready after ${((Date.now() - tl) / 1000).toFixed(0)} s; state ${JSON.stringify(await p.evaluate(() => window.__th.state()))}`);
  await p.evaluate(() => {
    let VT = window.__realNow();
    window.__VT = { get: () => VT, add: ms => { VT += ms; } };
    Object.defineProperty(performance, 'now', { value: () => VT, configurable: true, writable: true });
    window.__calibSpin = function __calibSpin() { const t = window.__realNow(); while (window.__realNow() - t < 6) { } return t; };
  });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 250 });

  const total = Math.round(MIN * 60 * FPS), frames = [], spikes = [];
  const t0 = Date.now(); let hist = [];
  for (let f0 = 0; f0 < total; f0 += CHUNK) {
    const tC = Date.now(); await cdp.send('Profiler.start');
    const r = await p.evaluate(({ f0, n, every, fps }) => {
      const G = window.__glStat, out = [], cal = window.__calibSpin();
      const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
      for (let i = 0; i < n; i++) {
        for (const k in G) G[k] = 0;
        window.__VT.add(1000 / fps);
        const cb = window.__rafCb; window.__rafCb = null;
        const m0 = mem(), t = window.__realNow();
        if (cb) cb(window.__VT.get());
        const ms = window.__realNow() - t, m1 = mem();
        out.push({ f: f0 + i, t, ms, gl: Object.assign({}, G), heap: m1, heapDrop: m0 - m1 });
      }
      return { cal, out, st: window.__th.state() };
    }, { f0, n: Math.min(CHUNK, total - f0), every: RENDER_EVERY, fps: FPS });
    const tE = Date.now(); const { profile } = await cdp.send('Profiler.stop');
    if (process.env.DBG) console.log('chunk eval', tE - tC, 'ms; stop', Date.now() - tE, 'ms; samples', profile.samples.length, 'frame ms sum', r.out.reduce((a, x) => a + x.ms, 0).toFixed(0));
    // align: the first sample inside __calibSpin = r.cal
    const nodes = new Map(profile.nodes.map(n => [n.id, n])), parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    let ts = profile.startTime, calT = null; const samples = [];
    for (let i = 0; i < profile.samples.length; i++) {
      ts += profile.timeDeltas[i]; const id = profile.samples[i];
      samples.push([ts, id]);
      if (calT === null && nodes.get(id).callFrame.functionName === '__calibSpin') calT = ts;
    }
    const stackOf = id => { const s = []; for (let x = id; x !== undefined; x = parent.get(x)) { const cf = nodes.get(x).callFrame; if (cf.functionName === '(root)') break; s.push({ fn: cf.functionName || '(anon)', url: cf.url, line: cf.lineNumber + 1 }); } return s; };
    for (const fr of r.out) {
      frames.push(fr.ms); hist.push(fr.ms); if (hist.length > 121) hist.shift();
      const med = [...hist].sort((a, b) => a - b)[hist.length >> 1];
      if (fr.ms - med < SPIKE || fr.f < 60) continue;
      const rec = { frame: fr.f, gameSec: +(fr.f / FPS).toFixed(1), ms: +fr.ms.toFixed(1), median: +med.toFixed(1), hour: r.st.hour, task: r.st.task,
        gl: { compileMs: +(fr.gl.compile + fr.gl.link).toFixed(1), programs: fr.gl.linkN, texMs: +fr.gl.tex.toFixed(1), tex: fr.gl.texN, bufMs: +fr.gl.buf.toFixed(1) },
        heapDropMB: +(fr.heapDrop / 1e6).toFixed(1) };
      if (calT !== null) {
        const a = calT + (fr.t - r.cal) * 1000, z = a + fr.ms * 1000;
        const cat = {}, own = {}; let n = 0;
        for (let i = 0; i < samples.length; i++) {
          const [s, id] = samples[i]; if (s < a || s > z) continue;
          const dt = ((samples[i + 1] ? samples[i + 1][0] : s) - s) / 1000; n++;
          const st = stackOf(id), c = category(st), o = ownerOf(st);
          cat[c] = (cat[c] || 0) + dt;
          const key = `${o.owner} | ${o.file}:${o.fn}${o.line ? ':' + o.line : ''} | ${c}`; own[key] = (own[key] || 0) + dt;
        }
        rec.samples = n;
        rec.by = Object.fromEntries(Object.entries(cat).sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, +v.toFixed(1)]));
        rec.top = Object.entries(own).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([k, v]) => [k, +v.toFixed(1)]);
      }
      spikes.push(rec);
    }
    const el = (Date.now() - t0) / 1000;
    if ((f0 / CHUNK) % 10 === 0) console.log(`  ${f0 + r.out.length}/${total} frames (${((f0 + r.out.length) / FPS / 60).toFixed(1)} game min), ${el.toFixed(0)} s, spikes ${spikes.length}, hour ${r.st.hour} task ${r.st.task}`);
  }
  const sorted = [...frames].sort((a, b) => a - b);
  const summary = { frames: frames.length, medianMs: +sorted[sorted.length >> 1].toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), spikes: spikes.length };
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out/spikes.json'), JSON.stringify({ summary, spikes }, null, 1));
  console.log('\n== summary', JSON.stringify(summary));
  // grouped by owner: total spike ms attributed to each owner / function
  const agg = {};
  for (const s of spikes) for (const [k, v] of s.top || []) { const a = agg[k] = agg[k] || { ms: 0, n: 0 }; a.ms += v; a.n++; }
  for (const [k, v] of Object.entries(agg).sort((x, y) => y[1].ms - x[1].ms).slice(0, 40)) console.log(`${v.ms.toFixed(0).padStart(6)} ms in ${String(v.n).padStart(3)} spikes  ${k}`);
  await b.close(); srv.kill();
})();
