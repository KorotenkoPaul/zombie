// perf.js — performance tooling shared by every system (owner: Optimization thread)
//
// 1) On-screen readout (off by default). Toggle: tap the clock chip 3 times quickly, or press F,
//    or open the page with ?fps. The choice is remembered on the device.
//    Shows: FPS, frame time (avg / worst of the last second), JS time per frame, draw calls,
//    triangles, pixel ratio and the current quality level.
// 2) Quality governor. Systems register quality steps with addStep(); when the game stays
//    under the target frame rate the governor applies the next step (cheapest visual loss first),
//    and when it runs comfortably again it undoes the last reversible step (see the rules in createPerf).
//    API: window.__perf = { addStep(name, down, up?, order?), level, stats(), show(on) }
//      down(): apply the cheaper setting; return false if nothing changed (step is skipped)
//      up():   restore the previous setting (omit for one-way steps)
//      order:  lower runs first (0..100)

export function createPerf({ renderer, MOBILE }) {
  const info = renderer.info; info.autoReset = false; // the composer renders several passes; count them all
  const P = { steps: [], applied: [], level: 0 }; const dead = new Set();
  // Judged by missed frames, not by the FPS number: at vsync a phone shows 60 FPS / 16.7 ms whether it is
  // idling or at its limit, so "60" says nothing. A frame that takes longer than ~1.3 refresh intervals missed vsync.
  //  - more than 20% missed frames over 2 s  -> one step cheaper
  //  - under 3% missed for 4 s in a row     -> try one step nicer (most recent reversible step comes back)
  //  - if a step that came back is dropped again within 10 s, stop climbing for a while (30 s, then 60, 120, 240)
  const WIN = 2.0, DOWN = .20, UP = .03;
  let winT = 0, winF = 0, winMiss = 0, warm = 3, calm = 0, cool = 0, clock = 0, lastUpAt = -1e9, blockUntil = 0, backoff = 30;
  const N = 120, ft = new Float32Array(N), js = new Float32Array(N); let k = 0, n = 0;
  let t0 = 0, last = performance.now(), lastDraw = { calls: 0, tris: 0 }, vs = 16.7, miss = 0;

  P.addStep = (name, down, up = null, order = 50) => { const s = { name, down, up, order }; P.steps.push(s); P.steps.sort((a, b) => a.order - b.order); return s; };
  // start below the top (e.g. phones begin at a modest pixel ratio and climb if there is room): steps are applied in the given order
  P.preset = list => { for (const s of list) { if (!s || P.applied.includes(s)) continue; let ok = true; try { ok = s.down() !== false; } catch (e) { ok = false; } if (ok) { P.applied.push(s); P.level++; } } };
  function stepDown() {
    for (const s of P.steps) { if (P.applied.includes(s) || dead.has(s)) continue; let ok = true; try { ok = s.down() !== false; } catch (e) { console.warn('perf step', s.name, e); ok = false; }
      if (ok) { P.applied.push(s); P.level++; log('down', s.name); return true; } dead.add(s); }
    return false;
  }
  function stepUp() { // most recent reversible step; one-way steps (no up) stay applied
    for (let i = P.applied.length - 1; i >= 0; i--) { const s = P.applied[i]; if (!s.up) continue;
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
    if (document.hidden || dtm > 250) return;                  // tab switches and long stalls say nothing about load
    if (warm > 0) { warm -= dt; return; }                     // let loading hitches settle
    if (dtm > 4 && dtm < vs) vs += (dtm - vs) * .05;          // refresh interval: tracks the shortest frames
    else if (dtm >= vs) vs += .0005 * (dtm - vs);             // (slowly forgets, e.g. ProMotion switching 120 -> 60)
    winT += dt; winF++; if (dtm > vs * 1.3 && dtm < 100) winMiss++;
    if (winT >= WIN) {
      miss = winMiss / Math.max(1, winF); P.fps = winF / winT; winT = 0; winF = 0; winMiss = 0;
      if (cool > 0) { cool--; calm = 0; }
      else if (miss > DOWN) { calm = 0; if (stepDown()) { cool = 1; if (clock - lastUpAt < 10) { blockUntil = clock + backoff; backoff = Math.min(240, backoff * 2); } } }
      else if (miss < UP) { calm++; if (calm >= 2 && clock >= blockUntil && P.applied.some(s => s.up)) { if (stepUp()) { lastUpAt = clock; cool = 1; } calm = 0; } }
      else calm = 0;
    }
    if (hud && hud.on) drawHud();
  };
  P.stats = () => {
    const a = []; for (let i = 0; i < n; i++) a.push(ft[i]); a.sort((x, y) => x - y);
    const avg = a.reduce((s, x) => s + x, 0) / Math.max(1, n); let jsA = 0; for (let i = 0; i < n; i++) jsA += js[i]; jsA /= Math.max(1, n);
    return { fps: +(1000 / avg).toFixed(1), ms: +avg.toFixed(1), p95: +(a[Math.floor(n * .95)] || 0).toFixed(1), worst: +(a[n - 1] || 0).toFixed(1), js: +jsA.toFixed(1),
      vsync: +vs.toFixed(1), miss: Math.round(miss * 100), calls: lastDraw.calls, tris: lastDraw.tris, geo: info.memory.geometries, tex: info.memory.textures, progs: info.programs ? info.programs.length : 0,
      pr: +renderer.getPixelRatio().toFixed(2), level: P.level, applied: P.applied.map(s => s.name), steps: P.steps.map(s => s.name), blocked: clock < blockUntil, hist: hist.slice(), mobile: !!MOBILE };
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
      `пропуски ${s.miss}% · кадр ${s.vsync} ms\nкачество −${s.level}${s.applied.length ? ' (' + [...new Set(s.applied)].join(', ') + ')' : ''}`;
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
