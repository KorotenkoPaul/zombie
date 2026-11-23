// perf.js — performance tooling shared by every system (owner: Optimization thread)
//
// 1) On-screen readout (off by default). Toggle: tap the clock chip 3 times quickly, or press F,
//    or open the page with ?fps. The choice is remembered on the device.
//    Shows: FPS, frame time (avg / worst of the last second), JS time per frame, draw calls,
//    triangles, pixel ratio and the current quality level.
// 2) Quality governor. Systems register quality steps with addStep(); when the game stays
//    under the target frame rate the governor applies the next step (cheapest visual loss first),
//    and when it runs comfortably again it undoes the last reversible step.
//    API: window.__perf = { addStep(name, down, up?, order?), level, stats(), show(on) }
//      down(): apply the cheaper setting; return false if nothing changed (step is skipped)
//      up():   restore the previous setting (omit for one-way steps)
//      order:  lower runs first (0..100)

export function createPerf({ renderer, MOBILE }) {
  const info = renderer.info; info.autoReset = false; // the composer renders several passes; count them all
  const P = { steps: [], applied: [], level: 0 }; const dead = new Set();
  const LOW = 46, HIGH = 57;          // target: 60 FPS on iPhone (Safari caps at 60)
  const WIN = 2.0;                    // seconds per measurement window
  let winT = 0, winF = 0, warm = 4, goodT = 0, cool = 0, locked = false, lastUpAt = -1e9, clock = 0;
  // rolling per-frame samples for the readout
  const N = 120, ft = new Float32Array(N), js = new Float32Array(N); let k = 0, n = 0;
  let t0 = 0, last = performance.now(), lastDraw = { calls: 0, tris: 0 };

  P.addStep = (name, down, up = null, order = 50) => { P.steps.push({ name, down, up, order }); P.steps.sort((a, b) => a.order - b.order); };
  function stepDown() {
    for (const s of P.steps) { if (P.applied.includes(s) || dead.has(s)) continue; let ok = true; try { ok = s.down() !== false; } catch (e) { console.warn('perf step', s.name, e); ok = false; }
      if (ok) { P.applied.push(s); P.level++; log('down', s.name); return true; } dead.add(s); }
    return false;
  }
  function stepUp() {
    for (let i = P.applied.length - 1; i >= 0; i--) { const s = P.applied[i]; if (!s.up) return false; // one-way step on top: stay
      P.applied.splice(i, 1); try { s.up(); } catch (e) { console.warn('perf up', s.name, e); } P.level = Math.max(0, P.level - 1); log('up', s.name); return true; }
    return false;
  }
  const hist = []; function log(d, nm) { hist.push([+clock.toFixed(1), d, nm]); if (hist.length > 30) hist.shift(); }

  P.begin = () => { t0 = performance.now(); info.reset(); };
  P.end = () => {
    const now = performance.now(); const dtm = now - last; last = now;
    ft[k] = dtm; js[k] = now - t0; k = (k + 1) % N; n = Math.min(N, n + 1);
    lastDraw = { calls: info.render.calls, tris: info.render.triangles };
    const dt = Math.min(dtm / 1000, .25); clock += dt;
    if (document.hidden) return;
    if (warm > 0) { warm -= dt; return; }                     // let loading hitches settle
    winT += dt; winF++;
    if (winT >= WIN) {
      const fps = winF / winT; winT = 0; winF = 0; P.fps = fps;
      if (cool > 0) { cool--; }
      else if (fps < LOW) { goodT = 0; if (stepDown()) { cool = 1; if (clock - lastUpAt < 25) locked = true; } }
      else if (fps > HIGH && !locked) { goodT += WIN; if (goodT >= 12 && P.applied.length) { if (stepUp()) { lastUpAt = clock; cool = 1; } goodT = 0; } }
      else goodT = 0;
    }
    if (hud && hud.on) drawHud();
  };
  P.stats = () => {
    const a = []; for (let i = 0; i < n; i++) a.push(ft[i]); a.sort((x, y) => x - y);
    const avg = a.reduce((s, x) => s + x, 0) / Math.max(1, n); let jsA = 0; for (let i = 0; i < n; i++) jsA += js[i]; jsA /= Math.max(1, n);
    return { fps: +(1000 / avg).toFixed(1), ms: +avg.toFixed(1), p95: +(a[Math.floor(n * .95)] || 0).toFixed(1), worst: +(a[n - 1] || 0).toFixed(1), js: +jsA.toFixed(1),
      calls: lastDraw.calls, tris: lastDraw.tris, geo: info.memory.geometries, tex: info.memory.textures, progs: info.programs ? info.programs.length : 0,
      pr: +renderer.getPixelRatio().toFixed(2), level: P.level, applied: P.applied.map(s => s.name), steps: P.steps.map(s => s.name), locked, hist: hist.slice(), mobile: !!MOBILE };
  };

  // ---------- readout ----------
  let hud = null, hudT = 0;
  function makeHud() {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:max(10px,env(safe-area-inset-left,0px));top:calc(env(safe-area-inset-top,0px) + 34px);z-index:50;pointer-events:none;' +
      'font:600 10px/1.35 ui-monospace,Menlo,monospace;color:#E9F3FF;background:rgba(8,12,24,.62);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:5px 7px;white-space:pre;display:none';
    document.body.appendChild(d); return { el: d, on: false };
  }
  function drawHud() {
    const t = performance.now(); if (t - hudT < 500) return; hudT = t; const s = P.stats();
    const col = s.fps >= 55 ? '#8CF59A' : s.fps >= 40 ? '#FFD36B' : '#FF7B6B';
    hud.el.innerHTML = `<span style="color:${col};font-size:13px">${s.fps.toFixed(0)} FPS</span>  ${s.ms} ms\n` +
      `худший ${s.worst} · 95% ${s.p95} ms\nJS ${s.js} ms · вызовов ${s.calls}\nтреуг. ${(s.tris / 1000).toFixed(0)}k · px ${s.pr}\n` +
      `качество −${s.level}${s.applied.length ? ' (' + s.applied.slice(-2).join(', ') + ')' : ''}`;
  }
  P.show = on => { if (!hud) hud = makeHud(); hud.on = on; hud.el.style.display = on ? 'block' : 'none'; try { localStorage.setItem('perfHud', on ? '1' : '0'); } catch (e) {} };
  let want = /[?&#]fps/.test(location.href); try { want = want || localStorage.getItem('perfHud') === '1'; } catch (e) {}
  if (want) P.show(true);
  addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') P.show(!(hud && hud.on)); });
  // triple tap on the clock chip (the HUD row ignores pointers, so this chip opts in)
  const chip = document.getElementById('tod'); const host = chip && chip.closest('.chip');
  if (host) { host.style.pointerEvents = 'auto'; let taps = []; host.addEventListener('pointerdown', e => { e.stopPropagation(); const t = performance.now(); taps = taps.filter(x => t - x < 700); taps.push(t); if (taps.length >= 3) { taps = []; P.show(!(hud && hud.on)); } }); }

  window.__perf = P;
  return P;
}
