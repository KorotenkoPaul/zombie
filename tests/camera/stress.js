// Camera stress test: thousands of randomized touch / mouse gesture sequences against the real game page.
//   node tests/camera/stress.js [sequencesPerConfig=1500] [seed=1]
// Starts its own static server on game/ (port 8127). Runs desktop (mouse) and iPhone (touch) configs.
// Invariants checked every frame (see driver.js): no unrequested zoom, no collision zoom, no jumps,
// never inside the trunk / under the ground, yaw/pitch limits, focus stays inside the soft bounds.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const N = +(process.argv[2] || 1500), SEED = +(process.argv[3] || 1), PORT = 8127;
const CHUNK = +(process.env.CHUNK || 25);

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const driver = fs.readFileSync(path.join(__dirname, 'driver.js'), 'utf8');
  const configs = [
    { name: 'desktop', ctx: { viewport: { width: 1280, height: 800 } }, touch: false },
    { name: 'iphone', ctx: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }, touch: true },
  ];
  let failed = false;
  for (const c of configs) {
    const ctx = await b.newContext(c.ctx);
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('[pageerror]', e.message));
    if (c.touch) await p.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1'; document.head.prepend(m); }); });
    // stop the game's render loop right after start-up (SwiftShader frames take seconds); the driver steps the rig itself
    await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let n = 0; window.requestAnimationFrame = cb => (window.__th && ++n > 3) ? 0 : raf(cb); });
    const tl = Date.now();
    await p.goto(`http://localhost:${PORT}/index.html`);
    await p.waitForFunction(() => window.__th && window.__th.rig && window.__dbg, null, { timeout: 300000, polling: 500 });
    console.log(`[${c.name}] page ready after ${((Date.now() - tl) / 1000).toFixed(0)} s`);
    await p.waitForTimeout(1500);
    await p.addScriptTag({ content: driver });
    await p.evaluate(async () => {
      const env = await import(new URL('env.js', document.baseURI).href);
      const { trunkSolid } = window.__dbg;
      window.__camStressOpt = {
        groundH: env.groundH,
        solid: (x, y, z) => trunkSolid(x, y, z, 0),
      };
    });
    const tot = { frames: 0, seqs: 0, viol: {}, samples: {}, collided: 0, maxRatioDrop: 0 };
    const t0 = Date.now();
    for (let done = 0; done < N; done += CHUNK) {
      const r = await p.evaluate(o => window.__camStress.run(Object.assign({}, window.__camStressOpt, o)), { seed: SEED * 7919 + done + (c.touch ? 1e6 : 0), n: Math.min(CHUNK, N - done), touch: c.touch, maxMs: +(process.env.MAXMS || 600000) });
      tot.frames += r.frames; tot.seqs += r.seqs; tot.collided += r.collided; tot.maxRatioDrop = Math.max(tot.maxRatioDrop, r.maxRatioDrop);
      process.stdout.write(`  [${c.name}] ${done + r.seqs}/${N} seq, ${((Date.now() - t0) / 1000).toFixed(0)} s, viol ${JSON.stringify(r.viol)}\n`);
      for (const k in r.viol) { tot.viol[k] = (tot.viol[k] || 0) + r.viol[k]; if (!tot.samples[k]) tot.samples[k] = r.samples[k]; }
    }
    const bad = Object.keys(tot.viol).length > 0;
    failed = failed || bad;
    console.log(`\n== ${c.name}: ${tot.seqs} sequences, ${tot.frames} frames, ${((Date.now() - t0) / 1000).toFixed(0)} s; frames with collision: ${tot.collided}; worst collision drop per frame: ${(100 * (1 - Math.exp(-tot.maxRatioDrop))).toFixed(1)}%`);
    if (!bad) console.log('   clean: no violations');
    for (const k in tot.viol) console.log(`   ${k}: ${tot.viol[k]} frames; first: ${JSON.stringify(tot.samples[k])}`);
    await ctx.close();
  }
  await b.close(); srv.kill();
  process.exit(failed ? 1 : 0);
})();
