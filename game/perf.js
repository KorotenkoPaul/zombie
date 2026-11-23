// perf.js — performance tooling shared by every system (owner: Optimization thread)
//
// 1) On-screen readout (off by default). Toggle: tap the clock chip 3 times quickly, or press F,
//    or open the page with ?fps. The choice is remembered on the device.
//    5 quick taps open the GPU cost finder (also ?perfdebug).
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
  let vmin = 1e9, vT = 0, t0 = 0, last = performance.now(), lastDraw = { calls: 0, tris: 0 }, vs = 16.7, miss = 0;

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
    // refresh interval: the shortest frames of the last ~4 s, never above 16.7 ms (a slow phone must not look "on time")
    vmin = Math.min(vmin, dtm); vT += dt; if (vT > 4) { vs = Math.min(16.7, Math.max(6, vmin)); vmin = 1e9; vT = 0; }
    winT += dt; winF++; if (dtm > vs * 1.3 && dtm < 100) winMiss++;
    if (P.frozen) { winT = 0; winF = 0; winMiss = 0; }
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
  if (host) { host.style.pointerEvents = 'auto'; let taps = []; host.addEventListener('pointerdown', e => { e.stopPropagation(); const t = performance.now(); taps = taps.filter(x => t - x < 700); taps.push(t); clearTimeout(host._tt); if (taps.length >= 5) { taps = []; P.debugPanel(); } else if (taps.length >= 3) { host._tt = setTimeout(() => { if (taps.length >= 3 && taps.length < 5) P.show(!(hud && hud.on)); taps = []; }, 720); } }); }

  // ---------- GPU cost finder (?perfdebug, or the "Тест" button under the readout) ----------
  // Tests come from the game: {name, on(), off()}; on() switches ONE thing off. The auto test holds the quality
  // governor, measures the average frame time with everything on, then with each thing off, and shows a table:
  // how many ms each thing costs on this phone. Single buttons toggle one thing for manual checks.
  P.tests = [];
  P.addTest = (name, on, off) => P.tests.push({ name, on, off, active: false });
  const sample = async ms => { const s0 = []; const t1 = performance.now(); let l = performance.now();
    await new Promise(r => { const f = () => { const t = performance.now(); s0.push(t - l); l = t; if (t - t1 < ms) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
    s0.shift(); s0.sort((a, b) => a - b); return { avg: s0.reduce((a, b) => a + b, 0) / Math.max(1, s0.length), p95: s0[Math.floor(s0.length * .95)] || 0 }; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  let dbg = null, running = false;
  P.bench = async () => {
    if (running) return; running = true; P.frozen = true; const out = [];
    for (const t of P.tests) if (t.active) { try { t.off(); } catch (e) {} t.active = false; }
    paintDbg('измеряю…');
    await wait(1500); const base = await sample(3000); out.push(['всё включено', base.avg, base.p95, 0]);
    for (const t of P.tests) { paintDbg('без: ' + t.name + '…', out);
      try { t.on(); } catch (e) { console.warn('bench', t.name, e); }
      await wait(1500); const r = await sample(2500); try { t.off(); } catch (e) {} out.push([t.name, r.avg, r.p95, base.avg - r.avg]); await wait(700); }
    const end = await sample(2000); out.push(['всё снова', end.avg, end.p95, 0]);
    P.lastBench = out.map(r => ({ name: r[0], ms: +r[1].toFixed(1), p95: +r[2].toFixed(1), saves: +r[3].toFixed(1) }));
    P.frozen = false; running = false; paintDbg('готово: пришли скриншот', out); return P.lastBench;
  };
  function paintDbg(msg, rows) {
    if (!dbg) return; const tb = dbg.querySelector('.r');
    tb.textContent = msg + '\n' + (rows || []).map(r => (r[0] + '                    ').slice(0, 20) + r[1].toFixed(1).padStart(5) + ' ms' + (r[3] ? ('  −' + r[3].toFixed(1)).padStart(8) : '')).join('\n');
  }
  P.debugPanel = () => {
    if (dbg) { dbg.style.display = dbg.style.display === 'none' ? 'block' : 'none'; return; }
    if (!hud || !hud.on) P.show(true);
    dbg = document.createElement('div');
    dbg.style.cssText = 'position:fixed;left:max(10px,env(safe-area-inset-left,0px));right:60px;top:calc(env(safe-area-inset-top,0px) + 132px);z-index:51;' +
      'font:600 10px/1.35 ui-monospace,Menlo,monospace;color:#E9F3FF;background:rgba(8,12,24,.72);border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px;max-height:60vh;overflow:auto';
    const bs = 'margin:2px;padding:4px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.08);color:#fff;font:600 11px system-ui';
    const run = document.createElement('button'); run.textContent = '▶ Тест (≈1 мин)'; run.style.cssText = bs + ';background:#E89A3C;color:#1B1206';
    run.onclick = e => { e.stopPropagation(); P.bench(); }; dbg.appendChild(run);
    for (const t of P.tests) { const b = document.createElement('button'); b.textContent = t.name; b.style.cssText = bs;
      b.onclick = e => { e.stopPropagation(); if (running) return; t.active = !t.active; try { t.active ? t.on() : t.off(); } catch (er) {} P.frozen = P.tests.some(x => x.active); b.style.background = t.active ? '#C0392B' : 'rgba(255,255,255,.08)'; };
      dbg.appendChild(b); }
    const r = document.createElement('pre'); r.className = 'r'; r.style.cssText = 'margin:4px 0 0;white-space:pre;font:inherit'; r.textContent = 'Красная кнопка = выключено. Регулятор стоит, пока что-то выключено.'; dbg.appendChild(r);
    ['pointerdown', 'pointerup', 'pointermove', 'click', 'touchstart'].forEach(ev => dbg.addEventListener(ev, e => e.stopPropagation()));
    document.body.appendChild(dbg);
  };
  P.openDebugWhenReady = () => { if (/[?&#]perfdebug/.test(location.href)) P.debugPanel(); };

  window.__perf = P;
  return P;
}
