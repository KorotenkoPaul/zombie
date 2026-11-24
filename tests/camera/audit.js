// Hero visibility audit on the phone screen: every action, home view and ◎ (zoom to the hero), day and night.
//   node tests/camera/audit.js <outdir> [acts=all] [hours=14,21.5]
// For each action: rendering off, the action is forced (__th.task), game time runs in virtual frames until the hero
// is doing it; then the home view and the ◎ view are settled (virtual frames) and drawn once. Saved per shot:
// a PNG and a JSON line with how much of the hero is on screen and unoccluded (raycasts camera -> sampled skin
// vertices; leaf cards that the near-fade clears are not counted), and what occludes him. Existing shots are skipped,
// so a run cut by a restart continues where it stopped.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || 'audit-out';
const ALL = 'cook tea wash read craft look window sleep hunt wood eat fetch dump chop splitwood pot stoke dishes saw hammer sharpen fixlamp stretch diary sweep water listen bolt supplies radio telescope ledge fix_shingle fix_board fix_wall fix_rope fix_hinge fix_window fix_railing clear_roof fix_chimney firewood around breathe inspect'.split(' ');
const ACTS = (process.argv[3] && process.argv[3] !== 'all') ? process.argv[3].split(',') : ALL;
const HOURS = (process.argv[4] || '14,21.5').split(',').map(Number);
const PORT = 8143;
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: path.join(__dirname, '../../game'), stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const b = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
  let p = null;
  async function fresh() {
    if (p) await p.context().close();
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    p = await ctx.newPage();
    p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 200)));
    await p.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { const m = document.createElement('meta'); m.name = 'viewport'; m.content = 'width=device-width,initial-scale=1'; document.head.appendChild(m); });
      const raf = window.requestAnimationFrame.bind(window); let n = 0;
      window.requestAnimationFrame = cb => { if (window.__th && ++n > 3) { window.__rafCb = cb; return 1; } return raf(cb); };
    });
    await p.route(/\/index\.html$/, async r => { const res = await r.fetch(); let t = await res.text(); t = t.replace(/(const renderer=new THREE\.WebGLRenderer\([^;]*\);)/, '$1window.__renderer=renderer;'); await r.fulfill({ response: res, body: t, headers: { ...res.headers(), 'content-type': 'text/html' } }); });
    await p.goto(`http://localhost:${PORT}/index.html`);
    await p.waitForFunction(() => window.__th && window.__rafCb && window.__renderer, null, { timeout: 300000, polling: 500 });
    await p.evaluate(() => {
      const R = window.__renderer, real = R.render;
      R.render = function (sc, c) { if (window.__skipDraw) { sc && sc.updateMatrixWorld && sc.updateMatrixWorld(); return; } return real.call(this, sc, c); };
      let VT = performance.now(); Object.defineProperty(performance, 'now', { value: () => VT, configurable: true, writable: true });
      window.__step = (n, draw) => { for (let i = 0; i < n; i++) { VT += 1000 / 60; window.__skipDraw = !(draw && i >= n - 3); const cb = window.__rafCb; window.__rafCb = null; cb && cb(VT); } };
    });
  }
  await fresh();
  let runs = 0;
  for (const H of HOURS) for (const act of ACTS) {
    const tag = `${act}_${String(H).replace('.', 'h')}`;
    if (fs.existsSync(path.join(OUT, tag + '_zoom.json'))) continue;
    if (runs++ % 6 === 0 && runs > 1) await fresh();        // a fresh page now and then: no drift from earlier forcing
    const t0 = Date.now();
    const st = await p.evaluate(({ act, H }) => {
      const hero = window.__dbg.hero; window.__th.setHour(H); window.__th.rig.goHome(); window.__th.task(act); window.__TS = 3;
      const seen = []; let ok = false;
      for (let k = 0; k < 900; k++) {          // up to 900 x 20 frames = 5 game-minutes at TS 3
        window.__step(20, false);
        const clip = hero.cur && hero.cur.getClip().name, s = hero.task + '/' + hero.state;
        if (seen[seen.length - 1] !== s) seen.push(s);
        if (hero.task === act && hero.state === 'work' && !/^(30|437|hy_idle)$/.test(clip || '')) { window.__step(90, false); ok = true; break; }
      }
      window.__TS = 1;
      return { ok, seen: seen.slice(-6), task: hero.task, clip: hero.cur && hero.cur.getClip().name, root: hero.root.position.toArray().map(v => +v.toFixed(2)), hour: window.__th.state().hour };
    }, { act, H });
    for (const view of ['home', 'zoom']) {
      const res = await p.evaluate(view => {
        const THREE = window.__dbg.THREE, rig = window.__th.rig, hero = window.__dbg.hero, cam = rig.camera;
        if (view === 'home') rig.goHome(); else rig.setFollow(true);
        window.__step(150, true);                 // settle 2.5 s, draw the last frame
        // visibility: sampled skin vertices -> on screen? occluded?
        let sc = hero.root; while (sc.parent) sc = sc.parent;
        const occl = []; sc.traverse(o => { if ((o.isMesh) && o.visible && !(o.isInstancedMesh && o.count > 1500)) { let n = o; while (n && n !== hero.root) n = n.parent; if (!n) occl.push(o); } });
        const rc = new THREE.Raycaster(), v = new THREE.Vector3(), ndc = new THREE.Vector3(); cam.updateMatrixWorld();
        let tot = 0, onScr = 0, vis = 0; const by = {};
        const cut = (rig.debug && rig.focusDist) || 10;
        hero.root.traverse(m => { if (!m.isSkinnedMesh || !m.visible) return; const pos = m.geometry.attributes.position; const stp = Math.max(1, Math.floor(pos.count / 120));
          for (let i = 0; i < pos.count; i += stp) { v.fromBufferAttribute(pos, i); m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld); tot++;
            ndc.copy(v).project(cam); if (Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1 || ndc.z > 1) continue; onScr++;
            const d = v.distanceTo(cam.position); rc.set(cam.position, v.clone().sub(cam.position).normalize()); rc.near = 0.2; rc.far = d - 0.05;
            const hits = []; for (const o of occl) { try { o.raycast(rc, hits); } catch (e) {} }
            hits.sort((a, b2) => a.distance - b2.distance);
            const h = hits.find(h => { const mt = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material; if (!mt) return false; if (mt.transparent && mt.opacity < .6) return false; if (mt.depthWrite === false) return false; if (mt.userData.nearFade && (h.distance < 2.2 || h.distance < cut - 0.9)) return false; return true; });
            if (!h) { vis++; continue; }
            let n = h.object, pa = []; for (; n && n.parent; n = n.parent) pa.push(n.name || ''); const nm = pa.filter(Boolean).slice(0, 2).join('<') || h.object.type; by[nm] = (by[nm] || 0) + 1; } });
        const cv = document.querySelector('canvas'); const url = cv.toDataURL('image/jpeg', 0.8);
        return { view, dist: +rig.debug.cd.toFixed(2), cam: cam.position.toArray().map(v => +v.toFixed(2)), onScreen: +(onScr / Math.max(1, tot)).toFixed(2), visible: +(vis / Math.max(1, tot)).toFixed(2), occluders: Object.entries(by).sort((a, b2) => b2[1] - a[1]).slice(0, 4), url };
      }, view);
      fs.writeFileSync(path.join(OUT, `${tag}_${view}.jpg`), Buffer.from(res.url.split(',')[1], 'base64'));
      delete res.url; Object.assign(res, { act, hour: H, reached: st.ok, task: st.task, clip: st.clip, root: st.root, seen: st.seen });
      fs.writeFileSync(path.join(OUT, `${tag}_${view}.json`), JSON.stringify(res));
      console.log(`${tag} ${view}: visible ${res.visible} on-screen ${res.onScreen} dist ${res.dist} reached ${st.ok} ${st.task}/${st.clip} occ ${JSON.stringify(res.occluders)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
  await b.close(); srv.kill();
})();
