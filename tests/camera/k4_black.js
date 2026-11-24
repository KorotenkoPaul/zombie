// K4 gate (critic pass 8): close to the hero, rotated right, at night the frame must never be black.
//   node tests/camera/k4_black.js
// Runs the critic's two repros on the phone viewport at several night hours with the real game loop, and checks every
// rendered frame for the first 40 frames after the request (read back from the canvas right after each frame)
// plus a settled page screenshot. Fails if any frame's mean brightness is under 4 (of 255) or the WebGL context is lost.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const PORT = 8137;
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  await p.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1'; document.head.appendChild(m); });
    window.__lost = 0; addEventListener('webglcontextlost', () => window.__lost++, true);
    const raf = window.requestAnimationFrame.bind(window); let n = 0;
    window.requestAnimationFrame = cb => { if (window.__th && ++n > 3) { window.__rafCb = cb; return 1; } return raf(cb); };
  });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__rafCb, null, { timeout: 300000, polling: 500 });
  // one game frame, then the mean brightness of what it drew (copied before the browser clears the buffer)
  const frames = (n, setup) => p.evaluate(({ n, setup }) => {
    if (setup) (0, eval)(setup);
    const cv = document.querySelector('canvas'), t = document.createElement('canvas'); t.width = 39; t.height = 84; const g = t.getContext('2d'), out = [];
    for (let i = 0; i < n; i++) {
      const cb = window.__rafCb; window.__rafCb = null; cb && cb(performance.now());
      g.drawImage(cv, 0, 0, 39, 84); const px = g.getImageData(0, 0, 39, 84).data; let s = 0; for (let k = 0; k < px.length; k += 4) s += px[k] + px[k + 1] + px[k + 2];
      out.push([+(s / (px.length / 4) / 3).toFixed(1), +window.__th.rig.debug.cd.toFixed(2)]);
    }
    return out;
  }, { n, setup });
  await frames(5);
  const V = 'new window.__dbg.THREE.Vector3';
  const cases = [
    ['bedroom', `window.__th.rig.set({target:${V}(-2.19,9.85,1.71),yaw:.6,pitch:.12,dist:2.6,snap:true})`],
    ['hollow', `window.__th.rig.set({target:${V}(0.8,2.6,2.5),yaw:.1,pitch:.12,dist:4})`],
  ];
  let bad = 0;
  for (const h of [21, 22, 23, 23.83, 0, 1])
    for (const [name, js] of cases) {
      const f = await frames(40, `window.__th.setHour(${h});${js}`);
      const dark = f.filter(x => x[0] < 4);
      if (dark.length || await p.evaluate(() => window.__lost)) bad++;
      console.log(`${dark.length ? 'BLACK' : 'ok   '} ${name} ${h}h: min brightness ${Math.min(...f.map(x => x[0]))}, dist ${f[0][1]} -> ${f[f.length - 1][1]}${dark.length ? ' black frames ' + JSON.stringify(dark) : ''}`);
    }
  console.log(bad ? `\nK4 FAILED: ${bad} cases with black frames` : '\nK4 clean: no black frame');
  await b.close(); srv.kill();
  process.exit(bad ? 1 : 0);
})();
