// Frame-spike profiler on the phone profile (iPhone UA + viewport, MOBILE path).
//   node tests/spikes/spikes.js [gameMinutes=10]
// Steps the real game loop with virtual time (dt 1/60). Every frame is timed in the page, split by owner:
// each subsystem's exposed object (window.__brain, __lights, __props, the hero, the camera rig, ...) has its methods
// wrapped with exclusive timers, plus shader compile / link, texture and buffer uploads on the WebGL context,
// raycasts, animation mixers, matrix updates, and heap drops (GC). What is left is the render + index.html glue.
// Phase 1 (first 6 s after load): the camera is swiped through the whole yaw/pitch range and zoomed in and out,
// like a first touch after opening the page. Phase 2: the rest of the run with the camera left alone.
// A spike = a frame more than SPIKE ms (default 40) above the running median, or over SPIKE ms absolute.
// Output: tests/spikes/out/spikes.json and a summary grouped by owner.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const MIN = +(process.argv[2] || 10), PORT = 8131, FPS = 60;
const SPIKE = +(process.env.SPIKE || 40), CHUNK = +(process.env.CHUNK || 600);

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  p.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });
  await p.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1'; document.head.appendChild(m); });
    const realNow = performance.now.bind(performance);
    window.__realNow = realNow;
    // long tasks while loading (before the game loop starts)
    window.__long = [];
    try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push([+e.startTime.toFixed(0), +e.duration.toFixed(0)]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
    const raf = window.requestAnimationFrame.bind(window); let n = 0;
    window.requestAnimationFrame = cb => { if (window.__th && ++n > 3) { window.__rafCb = cb; return 1; } return raf(cb); };
    // exclusive timers: a stack, so time spent in a nested wrapped call is charged to the inner owner only
    const T = window.__prof = { acc: {}, stack: [] };
    T.wrapFn = (f, key) => function () {
      const t0 = realNow(); T.stack.push(0);
      try { return f.apply(this, arguments); }
      finally { const el = realNow() - t0, child = T.stack.pop(); T.acc[key] = (T.acc[key] || 0) + el - child; if (T.stack.length) T.stack[T.stack.length - 1] += el; }
    };
    for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
      if (!C) continue; const P = C.prototype;
      const w = (name, k) => { if (P[name]) P[name] = T.wrapFn(P[name], k); };
      for (const n of ['compileShader', 'getShaderParameter', 'linkProgram', 'getProgramParameter', 'getShaderInfoLog', 'getProgramInfoLog']) w(n, 'GPU: shader compile/link');
      for (const n of ['texImage2D', 'texSubImage2D', 'texStorage2D', 'generateMipmap', 'compressedTexImage2D', 'texImage3D', 'texSubImage3D']) w(n, 'GPU: texture upload');
      for (const n of ['bufferData', 'bufferSubData']) w(n, 'GPU: buffer upload');
      for (const n of ['readPixels', 'getError', 'finish', 'clientWaitSync']) w(n, 'GPU: sync stall');
    }
  });
  const tl = Date.now();
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__rafCb, null, { timeout: 600000, polling: 500 });
  const loadInfo = await p.evaluate(() => ({ state: window.__th.state(), long: window.__long.slice().sort((a, b) => b[1] - a[1]).slice(0, 12), longTotal: window.__long.reduce((a, x) => a + x[1], 0) }));
  console.log(`page ready after ${((Date.now() - tl) / 1000).toFixed(0)} s; state ${JSON.stringify(loadInfo.state)}`);
  console.log(`load long tasks: total ${loadInfo.longTotal} ms; biggest ${JSON.stringify(loadInfo.long)}`);
  await p.evaluate(() => {
    const T = window.__prof, D = window.__dbg, THREE = D.THREE;
    const groups = {
      Character: [D.HH], Brain: [window.__brain], Environment: [window.__env], Ground: [window.__ground], Props: [window.__props],
      'Tree dressing': [window.__treedress], Lights: [window.__lights], 'Tree & house': [window.__house, window.__planks],
      Wind: [window.__wind, window.__smoke, window.__rain, window.__fogbank, window.__fogpass, window.__housewind, window.__particles],
      Camera: [window.__th.rig, window.__camera], Motion: [window.__motion],
    };
    const seen = new Set();
    for (const [owner, objs] of Object.entries(groups)) for (const o of objs) {
      if (!o || typeof o !== 'object' || seen.has(o)) continue; seen.add(o);
      for (const k of Object.keys(o)) {
        const d = Object.getOwnPropertyDescriptor(o, k);
        if (!d || typeof d.value !== 'function' || !d.writable || /^[A-Z]/.test(k)) continue;
        o[k] = T.wrapFn(d.value, `${owner}: ${k}`);
      }
    }
    const pw = (proto, name, key) => { if (proto && proto[name]) proto[name] = T.wrapFn(proto[name], key); };
    pw(THREE.Raycaster.prototype, 'intersectObjects', 'raycast (three)'); pw(THREE.Raycaster.prototype, 'intersectObject', 'raycast (three)');
    // who calls slow raycasts / compiles: keep the stack of any call over 30 ms
    window.__slow = [];
    for (const name of ['intersectObjects', 'intersectObject']) { const f = THREE.Raycaster.prototype[name]; THREE.Raycaster.prototype[name] = function () { const t = window.__realNow(); try { return f.apply(this, arguments); } finally { const el = window.__realNow() - t; if (el > 30) window.__slow.push(['raycast ' + el.toFixed(0) + ' ms', new Error().stack.split('\n').slice(2, 9).map(s => s.trim().replace(/https?:\/\/[^/]+\//, '')).join(' < ')]); } }; }
    pw(THREE.AnimationMixer.prototype, 'update', 'animation mixers');
    pw(THREE.Object3D.prototype, 'updateMatrixWorld', 'matrix updates');
    pw(THREE.Skeleton.prototype, 'update', 'skinning (skeleton)');
    let VT = window.__realNow();
    window.__VT = { get: () => VT, add: ms => { VT += ms; } };
    Object.defineProperty(performance, 'now', { value: () => VT, configurable: true, writable: true });
  });

  const total = Math.round(MIN * 60 * FPS), spikes = [], times = [];
  const t0 = Date.now(); let hist = [];
  if (process.env.DBG) p.on('console', m => console.log('[page]', m.text().slice(0, 300)));
  for (let f0 = 0; f0 < total; f0 += CHUNK) {
    const r = await p.evaluate(({ f0, n, fps }) => {
      const T = window.__prof, out = [], rig = window.__th.rig;
      const mem = () => (performance.memory ? performance.memory.usedJSHeapSize : 0);
      for (let i = 0; i < n; i++) {
        const f = f0 + i;
        // phase 1: a first touch after opening: swipe across the whole range, pinch in and out
        if (f < 360) {
          const u = f / 360;
          if (f % 2 === 0) rig.orbit(Math.sin(u * Math.PI * 6) * 26, Math.cos(u * Math.PI * 4) * 10);
          if (f === 120) rig.setFollow(true); if (f === 240) rig.goHome();
        }
        T.acc = {}; T.stack.length = 0;
        window.__VT.add(1000 / fps);
        const cb = window.__rafCb; window.__rafCb = null;
        const m0 = mem(), t = window.__realNow();
        if (cb) cb(window.__VT.get());
        const ms = window.__realNow() - t, m1 = mem();
        const acc = T.acc; let sum = 0; for (const k in acc) sum += acc[k];
        acc['render + index.html (rest)'] = ms - sum;
        if (m0 - m1 > 1e6) acc['GC (heap dropped ' + ((m0 - m1) / 1e6).toFixed(1) + ' MB)'] = 0;
        out.push({ f, ms, acc });
      }
      const slow = window.__slow.splice(0); return { out, st: window.__th.state(), slow };
    }, { f0, n: Math.min(CHUNK, total - f0), fps: FPS });
    for (const x of r.slow) console.log('  [slow]', x.join(' :: '));
    for (const fr of r.out) {
      times.push(fr.ms); hist.push(fr.ms); if (hist.length > 121) hist.shift();
      const med = [...hist].sort((a, b) => a - b)[hist.length >> 1];
      if (fr.ms - med < SPIKE && fr.ms < SPIKE) continue;
      spikes.push({ frame: fr.f, gameSec: +(fr.f / FPS).toFixed(1), phase: fr.f < 360 ? 'first swipe' : 'idle play', ms: +fr.ms.toFixed(1), median: +med.toFixed(1), hour: r.st.hour, task: r.st.task,
        top: Object.entries(fr.acc).sort((a, b) => b[1] - a[1]).filter(([k, v]) => v > 1 || k.startsWith('GC')).slice(0, 6).map(([k, v]) => [k, +v.toFixed(1)]) });
    }
    console.log(`  ${f0 + r.out.length}/${total} frames (${((f0 + r.out.length) / FPS / 60).toFixed(1)} game min), ${((Date.now() - t0) / 1000).toFixed(0)} s, spikes ${spikes.length}, hour ${r.st.hour} task ${r.st.task}`);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const summary = { frames: times.length, medianMs: +sorted[sorted.length >> 1].toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), p99: +sorted[Math.floor(sorted.length * 0.99)].toFixed(1), spikes: spikes.length, load: loadInfo };
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out/spikes.json'), JSON.stringify({ summary, spikes }, null, 1));
  console.log('\n== summary', JSON.stringify({ ...summary, load: undefined }));
  const agg = {};
  for (const s of spikes) for (const [k, v] of s.top) { const key = k.replace(/\(heap dropped .*\)/, ''); const a = agg[key] = agg[key] || { ms: 0, n: 0, max: 0 }; a.ms += v; a.n++; a.max = Math.max(a.max, v); }
  for (const [k, v] of Object.entries(agg).sort((x, y) => y[1].ms - x[1].ms)) console.log(`${v.ms.toFixed(0).padStart(7)} ms total, max ${v.max.toFixed(0).padStart(4)} ms, in ${String(v.n).padStart(4)} spikes  ${k}`);
  for (const s of spikes.slice(0, 25)) console.log(JSON.stringify(s));
  await b.close(); srv.kill();
})();
