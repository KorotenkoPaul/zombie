// Camera + post-processing cost on the phone profile (iPhone viewport, MOBILE path). CPU timings from headless Chromium.
//   node tests/camera/profile.js
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const PORT = 8129;
(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('[pageerror]', e.message));
  await p.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); let n = 0; window.requestAnimationFrame = cb => (window.__th && ++n > 3) ? 0 : raf(cb); });
  await p.goto(`http://localhost:${PORT}/index.html`);
  await p.waitForFunction(() => window.__th && window.__th.rig && window.__dbg, null, { timeout: 300000, polling: 500 });
  await p.waitForTimeout(1500);
  const r = await p.evaluate(async () => {
    const THREE = await import('three');
    const rig = window.__th.rig, out = {};
    const { trunkSolid, LIMB } = window.__dbg;
    const time = (f, n) => { const t = performance.now(); for (let i = 0; i < n; i++) f(i); return (performance.now() - t) / n; };
    const h = rig.debug.home;
    for (const [name, zf] of [['far', 1], ['home', 0.6], ['close', 0.05]]) {
      window.__th.view(0.3, 0.25, zf); for (let i = 0; i < 120; i++) rig.update(1 / 60);
      out['update_' + name] = { ms: +time(() => rig.update(1 / 60), 600).toFixed(3), dist: +rig.debug.cd.toFixed(2) };
    }
    out.trunkSolid_us = +(time(i => trunkSolid(Math.sin(i) * 3, 2 + (i % 10), Math.cos(i) * 3, 0), 20000) * 1000).toFixed(2);
    // pick: first call rebuilds the pickable list
    const W = innerWidth, H = innerHeight;
    for (let i = 0; i < 400; i++) rig.update(1 / 60);   // BVH warm-up (one mesh per frame)
    let t = performance.now(); rig.pick(W / 2, H / 2); out.pick_rebuild_ms = +(performance.now() - t).toFixed(1);
    out.pick_ms = +time(i => rig.pick(W * (0.2 + 0.6 * (i % 7) / 7), H * (0.2 + 0.6 * (i % 5) / 5)), 20).toFixed(1);
    let meshes = 0, tris = 0;
    let scene = null; { let o = window.__dbg.hero; o = o && (o.root || o.group || (o.isObject3D ? o : null)); while (o && o.parent) o = o.parent; if (o && o.isScene) scene = o; }
    // per-object raycast cost (which meshes make picking slow)
    if (scene) {
      const cost = []; const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(0, 0), rig.camera); rc.far = 200; window.__profRay = rc;
      scene.traverse(m => { if (!(m.isMesh) || !m.visible) return; const t0 = performance.now(); for (let i = 0; i < 3; i++) { const hits = []; try { m.raycast(window.__profRay, hits); } catch (e) {} } const dt = (performance.now() - t0) / 3; if (dt > 0.3) cost.push([m.name || (m.parent && m.parent.name) || m.type, +dt.toFixed(1), (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 | 0, m.count || 1]); });
      out.slowRaycast = cost.sort((a, b) => b[1] - a[1]).slice(0, 15);
    }
    scene && scene.traverse(m => { if (m.isMesh && m.visible) { meshes++; const g = m.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3 * (m.count || 1); } });
    out.sceneMeshes = meshes;
    // anchoring dump: what the zoom pick hits on a grid of screen points from three views
    out.anchors = [];
    for (const [yw, pt, zf] of [[0.3, 0.25, 1], [-0.5, 0.1, 0.6], [0.6, 0.45, 0.25]]) {
      window.__th.view(yw, pt, zf); for (let i = 0; i < 120; i++) rig.update(1 / 60);
      for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 9; gy++) {
        const X = W * (gx + 0.5) / 7, Y = H * (gy + 0.5) / 9;
        const h = rig.pick(X, Y), o = h.object;
        // same pick with the plain raycast (BVH off) in the same frame: the anchor must not move
        const ov = []; scene.traverse(m => { if (m.hasOwnProperty('raycast')) { ov.push([m, m.raycast]); delete m.raycast; } });
        const h0 = rig.pick(X, Y); for (const [m, f] of ov) m.raycast = f;
        const dd = h0.point.distanceTo(h.point); out.bvhMaxDiff = Math.max(out.bvhMaxDiff || 0, dd); if (dd > 1e-3) (out.bvhDiffs = out.bvhDiffs || []).push([h0.object && h0.object.name, h.object && h.object.name, +dd.toFixed(3)]);
        let n = o; while (n && !n.name && n.parent) n = n.parent;
        out.anchors.push([o ? (n && n.name) || o.type : 'sky', h.point.toArray().map(v => +v.toFixed(3))]);
      }
    } out.sceneTris = Math.round(tris);
    const cam = window.__camera; out.dof = cam.quality;
    return out;
  });
  if (process.env.ANCHORS) fs.writeFileSync(process.env.ANCHORS, JSON.stringify(r.anchors));
  delete r.anchors;
  console.log(JSON.stringify(r, null, 1));
  await b.close(); srv.kill();
})();
