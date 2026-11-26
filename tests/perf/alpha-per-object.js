// Alpha overdraw per object (copy of budget.js's day-home alpha measure, split by object). Ground thread, 2026-11-26.
//   node tests/perf/alpha-per-object.js --only "day home"
// Prints the 25 alpha-tested objects with the most depth-tested card area (screens, 1.0 = one full screen) as a JSON line,
// then the usual budget row. Use it to see which cards to trim when the day alpha nears the 1.5 ceiling.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium, devices } = require('playwright');
const ROOT = path.join(__dirname, '..', '..', 'game');
const BUD = { tris: 450000, calls: 300, alpha: 1.5 };
const QUICK = process.argv.includes('--quick'), ONLY = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ktx2': 'image/ktx2', '.txt': 'text/plain', '.css': 'text/css', '.bin': 'application/octet-stream' };
const srv = http.createServer((q, r) => { const u = decodeURIComponent(q.url.split('?')[0]); const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  if (!f.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(d); }); });
const VIEWS = [
  { name: 'night home', hour: 22 },
  { name: 'day home', hour: 13, alpha: true },
  { name: 'night yaw limit', hour: 22, cam: { t: [0, 7.4, 2.4], d: 30, y: 0.75 } },
  { name: 'night kitchen zoom', hour: 22, cam: { t: [-2.1, 6.9, 1.3], d: 10.7, y: -0.6 } },
  { name: 'night deck zoom', hour: 22, cam: { t: [1.5, 10, 1.5], d: 10.7, y: 0.3 } },
];
(async () => {
  await new Promise(res => srv.listen(0, res)); const PORT = srv.address().port;
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  let fail = 0; const rows = [];
  for (const v of QUICK ? VIEWS.slice(0, 1) : ONLY ? VIEWS.filter(v => v.name.includes(ONLY)) : VIEWS) {
    const p = await b.newPage({ ...devices['iPhone 13'], viewport: { width: 390, height: 664 }, deviceScaleFactor: 1 });
    const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.text().startsWith('[[')) console.log(m.text()); });
    await p.goto(`http://localhost:${PORT}/index.html?t=${v.hour}`);
    await p.waitForFunction(() => window.__th && document.getElementById('load').classList.contains('hide'), null, { timeout: 600000 });
    await p.evaluate(h => window.__th.setHour(h), v.hour); await p.waitForTimeout(8000);
    if (v.cam) { await p.evaluate(c => { window.__resortSync = true; /* the bark/props back-face re-sort runs in one go here (on a phone it takes ~1 s of 3 ms slices) */ }); await p.evaluate(c => window.__camera.rig.set({ target: new window.__dbg.THREE.Vector3(...c.t), dist: c.d, yaw: c.y, pitch: 0.13, snap: true }), v.cam); await p.waitForTimeout(4000); }
    const r = await p.evaluate(() => new Promise(res => { const R = window.__perf.renderer, o = R.renderBufferDirect; let root = window.__dbg.hero.root; while (root.parent) root = root.parent;
      const F = []; let cur = null;
      R.renderBufferDirect = function (camera, scene, g, m, obj, group) { if (cur) { let n = Math.min(g.index ? g.index.count : g.attributes.position.count, g.drawRange.count) / 3; if (group) n = Math.min(n, group.count / 3); if (obj.isInstancedMesh) n *= obj.count; else if (g.isInstancedBufferGeometry) n *= g.instanceCount;
        if (n > 0) { const sh = m.isMeshDepthMaterial || m.isMeshDistanceMaterial; cur.t += n; cur.c++; if (sh) cur.s += n; const k = (sh ? 'shadow ' : '') + (obj.name || (obj.parent && obj.parent.name) || obj.type) + '#' + obj.id; cur.o[k] = (cur.o[k] || 0) + n; } } return o.apply(this, arguments); };
      let k = 0; const f = () => { if (cur) F.push(cur); cur = { t: 0, c: 0, s: 0, o: {} }; root.traverse(l => { if (l.isLight && l.castShadow && l.shadow) l.shadow.needsUpdate = true; }); if (++k < 8) requestAnimationFrame(f); else { R.renderBufferDirect = o; F.sort((a, b) => b.t - a.t); const x = F[0]; res({ tris: Math.round(x.t), shadow: Math.round(x.s), calls: Math.max(...F.map(y => y.c)), top: Object.entries(x.o).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, n]) => Math.round(n) + ' ' + k) }); } };
      requestAnimationFrame(f); }));
    if (v.alpha) r.alpha = await p.evaluate(() => { const R = window.__perf.renderer, T = window.__dbg.THREE; let s = window.__dbg.hero.root; while (s.parent) s = s.parent; const cam = window.__camera.rig.camera;
      window.__noPlCull = true; for (const q of window.__plView || []) { if (q.hid) { q.S.visible = true; q.D.visible = false; } }
      const W = 195, H = 332, rt = new T.WebGLRenderTarget(W, H, { type: T.FloatType }), buf = new Float32Array(W * H * 4); const mat = o => (Array.isArray(o.material) ? o.material[0] : o.material) || {};
      const vis = []; s.traverse(o => { if (o.isMesh || o.isPoints || o.isSprite || o.isLine) vis.push([o, o.visible]); }); const bg = s.background; s.background = null; const sm = R.shadowMap.enabled; R.shadowMap.enabled = false;
      const ac = R.getPixelRatio(); R.setRenderTarget(rt); R.setClearColor(0, 0); R.clear();
      for (const [o, v] of vis) o.visible = v && !mat(o).transparent && !(mat(o).alphaTest > 0); s.overrideMaterial = new T.MeshBasicMaterial({ colorWrite: false }); R.render(s, cam);
      for (const [o, v] of vis) o.visible = v && mat(o).alphaTest > 0 && !mat(o).transparent; const om = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: T.AdditiveBlending, depthTest: true, depthWrite: false, side: T.DoubleSide, fog: false }); om.color.setScalar(1 / 64);
      s.overrideMaterial = om; const al = vis.filter(([o, v]) => v && mat(o).alphaTest > 0 && !mat(o).transparent); const per = [];
      for (const [o] of al) { for (const [q] of al) q.visible = false; o.visible = true; R.setRenderTarget(rt); R.clearColor(); R.autoClear = false; R.render(s, cam); R.autoClear = true; R.readRenderTargetPixels(rt, 0, 0, W, H, buf); let t = 0; for (let i = 0; i < W * H; i++) t += buf[i * 4] * 64; per.push([+(t / (W * H)).toFixed(3), (o.name || o.type) + '#' + o.id + (o.isInstancedMesh ? ' n' + o.count : '')]); }
      per.sort((a, b) => b[0] - a[0]); console.log(JSON.stringify(per.slice(0, 25))); window.__perAlpha = per.slice(0, 25);
      for (const [o] of al) o.visible = true; R.setRenderTarget(rt); R.clearColor(); R.autoClear = false; R.render(s, cam); R.autoClear = true; R.readRenderTargetPixels(rt, 0, 0, W, H, buf); let sum = 0; for (let i = 0; i < W * H; i++) sum += buf[i * 4] * 64;
      s.overrideMaterial = null; s.background = bg; R.shadowMap.enabled = sm; for (const [o, v] of vis) o.visible = v; R.setRenderTarget(null); window.__noPlCull = false; void ac; return +(sum / (W * H)).toFixed(2); });
    const bad = [r.tris > BUD.tris && 'tris', r.calls > BUD.calls && 'calls', r.alpha > BUD.alpha && 'alpha', errs.length && 'page errors'].filter(Boolean);
    if (bad.length) fail = 1;
    rows.push(`${bad.length ? 'OVER ' : 'ok   '}${v.name.padEnd(20)} tris ${(r.tris / 1000).toFixed(0)}k/${BUD.tris / 1000}k (shadow ${(r.shadow / 1000).toFixed(0)}k)  calls ${r.calls}/${BUD.calls}` + (r.alpha !== undefined ? `  alpha ${r.alpha}/${BUD.alpha} screens` : '') + (bad.length ? '  <- ' + bad.join(', ') : '') + (errs.length ? '\n      ' + errs.slice(0, 3).join('\n      ') : ''));
    console.log(rows[rows.length - 1]);
    if (bad.length || v.name === 'night home') console.log('      heaviest: ' + r.top.join(' | '));
    await p.close();
  }
  console.log('\n' + (fail ? 'OVER BUDGET: trim what you added (see the heaviest objects), or ask the perf thread.' : 'Within the phone budget.'));
  await b.close(); srv.close(); process.exit(fail);
})();
