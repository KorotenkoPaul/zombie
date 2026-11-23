// Close-zoom renders for eyeballing the camera fade (no see-through circle on the house, leaves melt smoothly)
// and the K1 check (top pitch at home distance must not be a black frame).
//   node tests/camera/renders.js [outDir]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const OUT = process.argv[2] || path.join(__dirname, 'out'), PORT = 8129;
require('fs').mkdirSync(OUT, { recursive: true });
const VIEWS = process.env.POND ? [
  ['pond-left-limit', { target: [0, 7.4, 2.4], yaw: -0.7, pitch: 0.13, k: 1.2 }],
  ['pond-left-high', { target: [0, 7.4, 2.4], yaw: -0.7, pitch: 0.35, k: 1.2 }],
  ['pond-zoomed', { target: [-8.4, 0.5, 9.2], yaw: -0.5, pitch: 0.3, dist: 9 }],
] : [
  ['home', { target: [0, 7.4, 2.4], yaw: 0.05, pitch: 0.13, k: 1 }],
  ['top-limit', { target: [0, 7.4, 2.4], yaw: 0.05, pitch: 0.6, k: 1.1 }],
  ['bedroom-close', { target: [-2.0, 9.2, 1.4], yaw: 0.3, pitch: 0.12, dist: 1.6 }],
  ['kitchen-side', { target: [-2.1, 6.9, 1.3], yaw: -0.7, pitch: 0.2, dist: 2.2 }],
  ['workshop-right', { target: [2.4, 6.2, 1.6], yaw: 0.75, pitch: 0.15, dist: 2.5 }],
  ['crown-through', { target: [0.5, 13.5, 1.5], yaw: 0.4, pitch: 0.25, dist: 6 }],
  ['K3-kitchen-right', { target: [-2.6, 6.9, 2], yaw: 0.7, pitch: 0.15, dist: 3 }],
  ['K3-workshop', { target: [2.8, 5.6, 2.2], yaw: 0.75, pitch: 0.15, dist: 3 }],
  ['right-limit-far', { target: [0, 7.4, 2.4], yaw: 0.8, pitch: 0.2, k: 1 }],
];
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__th.rig, null, { timeout: 300000, polling: 1000 });
  await p.evaluate(h => window.__th.setHour(h), +(process.env.HOUR || 21.5));
  await p.waitForTimeout(8000);
  for (const [name, v] of VIEWS) {
    await p.evaluate(v => { const r = window.__th.rig, T = window.__dbg.THREE; r.set({ target: new T.Vector3(...v.target), yaw: v.yaw, pitch: v.pitch, dist: v.dist || r.homeDist * v.k, snap: true }); }, v);
    await p.waitForTimeout(4000);
    const f = path.join(OUT, name + '.png');
    await p.screenshot({ path: f, timeout: 180000 });
    const st = await p.evaluate(() => window.__th.rig.state);
    console.log(name, JSON.stringify(st));
  }
  console.log('errors:', errs.filter(e => !/GL Driver|GPU stall/.test(e)).slice(0, 5));
  await b.close(); srv.kill();
})();
