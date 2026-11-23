// Smoothness at phone frame rates: a steady one-finger drag and a steady pinch, with touch events arriving at 60 Hz
// while frames run at 30 FPS (or 60) with timing noise. Measures frame-to-frame jitter of the camera's angular /
// zoom speed in the steady part, the biggest speed change when the drag runs into the rotation limit, and inertia.
//   node tests/camera/smooth.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8132;
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let n = 0; window.requestAnimationFrame = cb => (window.__th && ++n > 3) ? 0 : raf(cb); });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__th.rig, null, { timeout: 300000, polling: 500 });
  if (process.env.DUMP) await p.evaluate(() => { window.__dumpV = true; });
  const res = await p.evaluate(() => {
    let VT = 0; Object.defineProperty(performance, 'now', { value: () => VT, configurable: true });
    const r = window.__th.rig, cv = document.querySelector('canvas'), T = window.__dbg.THREE, out = {};
    const ev = (type, id, x, y) => cv.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 1, pointerType: 'touch', buttons: type === 'pointerup' ? 0 : 1 }));
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    function scenario(fps, kind) {
      r.set({ target: new T.Vector3(0, 7.4, 2.4), yaw: 0.75, pitch: 0.15, dist: kind === 'pinch' ? 12 : r.homeDist, snap: true });
      for (let i = 0; i < 30; i++) { VT += 16.7; r.update(1 / 60, {}); }
      const vals = []; let evT = VT, x = 100, y = 420, d = 60;
      if (kind === 'pinch') { ev('pointerdown', 1, 195 - d, 420); ev('pointerdown', 2, 195 + d, 420); } else ev('pointerdown', 1, x, y);
      const frames = fps === 30 ? 90 : 180;
      for (let f = 0; f < frames; f++) {
        const dt = (1 / fps) * (1 + (rnd() - 0.5) * 0.3);         // ±15 % frame time noise
        const t1 = VT + dt * 1000;
        while (evT + 16.7 <= t1) {                                  // touch events at 60 Hz, independent of frames
          evT += 16.7; VT = evT;
          if (kind === 'pinch') { d *= 1.006; ev('pointermove', 1, 195 - d, 420); ev('pointermove', 2, 195 + d, 420); }
          else { x += 3; ev('pointermove', 1, x, y); }               // 180 px/s: reaches the yaw limit after ~1.4 s
        }
        VT = t1; r.update(dt, {});
        const s = r.debug; vals.push([kind === 'pinch' ? Math.log(s.cd) : s.cy, dt]);
      }
      if (kind === 'pinch') { ev('pointerup', 1, 195 - d, 420); ev('pointerup', 2, 195 + d, 420); } else ev('pointerup', 1, x, y);
      const tail = []; for (let f = 0; f < 60; f++) { const dt = 1 / fps; VT += dt * 1000; r.update(dt, {}); const s = r.debug; tail.push(kind === 'pinch' ? Math.log(s.cd) : s.cy); }
      const v = []; for (let i = 1; i < vals.length; i++) v.push((vals[i][0] - vals[i - 1][0]) / vals[i][1]);   // speed per second
      // steady part: a window where the speed is high (before the limit for the drag)
      const vmax = Math.max(...v.map(Math.abs));
      const steady = v.slice(10).filter(q => Math.abs(q) > 0.6 * vmax);
      const mean = steady.reduce((a, q) => a + q, 0) / steady.length;
      const jit = Math.sqrt(steady.reduce((a, q) => a + (q - mean) ** 2, 0) / steady.length) / Math.abs(mean);
      let maxAcc = 0; for (let i = 1; i < v.length; i++) maxAcc = Math.max(maxAcc, Math.abs(v[i] - v[i - 1]) / Math.max(1e-6, vmax));
      const glide = Math.abs(tail[tail.length - 1] - vals[vals.length - 1][0]);
      if (window.__dumpV) out[fps + kind] = v.map(q => +q.toFixed(3));
      return { v: window.__dumpV ? v.map(q => +q.toFixed(2)).join(' ') : undefined, fps, kind, steadySpeed: +mean.toFixed(3), jitterPct: +(jit * 100).toFixed(1), maxSpeedStepPct: +(maxAcc * 100).toFixed(1), glideAfterRelease: +glide.toFixed(3) };
    }
    return [scenario(60, 'orbit'), scenario(30, 'orbit'), scenario(60, 'pinch'), scenario(30, 'pinch')];
  });
  for (const r of res) console.log(JSON.stringify(r));
  await b.close(); srv.kill();
})();
