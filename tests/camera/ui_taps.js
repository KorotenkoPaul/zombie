// Phone UI vs camera gestures: real touch taps (CDP touch input, iPhone viewport) on every HUD button must never
// rotate, pan or zoom the camera, except ⌂ (home) and ◎ (follow) which are meant to move it. Also: idle for 40 s
// must not move the camera (cinematic idle is opt-in, ?cine=1).
//   node tests/camera/ui_taps.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8131;
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let n = 0; window.requestAnimationFrame = cb => (window.__th && ++n > 3) ? 0 : raf(cb); });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__th.rig, null, { timeout: 300000, polling: 500 });
  await p.waitForTimeout(1000);
  const step = n => p.evaluate(n => { for (let i = 0; i < n; i++) window.__th.rig.update(1 / 60, {}); }, n);
  const st = () => p.evaluate(() => { const d = window.__th.rig.debug; return { y: d.cy, p: d.cp, d: d.cd, t: d.ct, follow: d.follow }; });
  await p.evaluate(() => { const r = window.__th.rig, T = window.__dbg.THREE; r.set({ target: new T.Vector3(-1, 7.5, 2.3), yaw: 0.3, pitch: 0.2, dist: 9, snap: true }); });
  // requestAnimationFrame is frozen here, so the loading screen never gets its reveal frames: hide it by hand
  // (otherwise it catches every touch); and let the classic camera's soft framing settle before measuring
  await p.evaluate(() => { const l = document.getElementById('load'); if (l) l.classList.add('hide'); });
  await step(900);
  const ids = await p.evaluate(() => [...document.querySelectorAll('button')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && getComputedStyle(e).visibility !== 'hidden'; }).map(e => e.id || e.className));
  let fail = 0;
  for (const id of ids) {
    if (id === 'bH' || id === 'bF') continue;
    const box = await p.evaluate(id => { const e = document.getElementById(id) || document.querySelector('button.' + id.split(' ')[0]); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; }, id);
    const a = await st();
    await p.touchscreen.tap(box[0], box[1]);
    await p.waitForTimeout(150);
    await p.touchscreen.tap(box[0], box[1]);             // a quick double tap on a button must not fly the camera either
    await step(60);
    const z = await st();
    const moved = Math.abs(a.y - z.y) + Math.abs(a.p - z.p) + Math.abs(Math.log(a.d / z.d)) + Math.hypot(a.t[0] - z.t[0], a.t[1] - z.t[1], a.t[2] - z.t[2]);
    console.log(`${moved > 1e-3 ? 'FAIL' : 'ok  '} tap+double tap on ${id} (${box[2].toFixed(0)}x${box[3].toFixed(0)} px): camera change ${moved.toFixed(5)}`);
    if (moved > 1e-3) fail++;
    await p.evaluate(() => { document.querySelectorAll('.brainP').forEach(e => e.hidden = true); });
  }
  // a drag that starts on the canvas and ends on a button: orbits, and the button is not pressed
  {
    const cdp = await p.context().newCDPSession(p);
    const bw = await p.evaluate(() => { const e = document.getElementById('bW'); e.__clicks = 0; e.addEventListener('click', () => e.__clicks++); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const a = await st();
    const pt = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(120, 500) });
    for (let i = 1; i <= 12; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(120 + (bw[0] - 120) * i / 12, 500 + (bw[1] - 500) * i / 12) }); await step(1); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await step(60);
    const z = await st(), clicks = await p.evaluate(() => document.getElementById('bW').__clicks);
    const ok = Math.abs(a.y - z.y) > 0.01 && clicks === 0;
    console.log(`${ok ? 'ok  ' : 'FAIL'} drag from canvas onto ☁ button: yaw ${a.y.toFixed(3)} -> ${z.y.toFixed(3)}, button clicks ${clicks}`); if (!ok) fail++;
  }
  // idle: 40 s of frames without input, camera must stay (breathing changes the view direction a hair, not the state)
  await step(300); const a = await st(); await step(2400); const z = await st();
  const moved = Math.abs(a.y - z.y) + Math.abs(a.p - z.p) + Math.abs(Math.log(a.d / z.d));
  console.log(`${moved > 1e-3 ? 'FAIL' : 'ok  '} 40 s idle: camera change ${moved.toFixed(5)}`); if (moved > 1e-3) fail++;
  await b.close(); srv.kill();
  console.log(fail ? `${fail} failures` : 'clean'); process.exit(fail ? 1 : 0);
})();
