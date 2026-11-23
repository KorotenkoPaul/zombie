// In-page camera stress driver (injected by tests/camera/stress.js into the real game page).
// The game loop is stopped; time is virtual (performance.now is patched) and rig.update(dt) is called by hand,
// so thousands of gesture sequences run fast and deterministically against the real tree, trunk and ground.
(function () {
  const S = window.__camStress = {};
  let VT = 0;
  Object.defineProperty(performance, 'now', { value: () => VT, configurable: true, writable: true });
  window.requestAnimationFrame = () => 0;            // freeze the game loop (frame() reschedules itself first)
  const rig = window.__th.rig, cv = document.querySelector('canvas');

  function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  S.run = function (opt) {
    const R = mulberry(opt.seed), rnd = (a, b) => a + (b - a) * R(), ri = (a, b) => Math.floor(rnd(a, b + 1));
    const touch = opt.touch, W = innerWidth, H = innerHeight;
    const groundH = opt.groundH, solidStrict = opt.solid;
    const out = { frames: 0, seqs: 0, viol: {}, samples: {}, collided: 0, maxRatioDrop: 0 };
    let orbitRef = null, zin = 0, legitGoal = true, lastKind = '', lastGesture = '', curSeq = 0, log = [];
    let prev = null;
    function bad(kind, info) {
      out.viol[kind] = (out.viol[kind] || 0) + 1;
      if (!out.samples[kind]) out.samples[kind] = { seq: curSeq, seed: opt.seed, info, log: log.slice(-8) };
    }
    function camPos() { return rig.camera.position; }

    const wall0 = Date.now();
    function frame(dt) {
      VT += dt * 1000;
      if (opt.maxMs && Date.now() - wall0 > opt.maxMs) throw new Error('timeout after ' + out.frames + ' frames: ' + log.join(','));
      const before = rig.debug;
      rig.update(dt, {});
      const d = rig.debug, cp = camPos(), t = d.ct;
      const E = Math.hypot(cp.x - t[0], cp.y - t[1], cp.z - t[2]);
      out.frames++;
      if (d.hit) out.collided++;
      // --- goal.dist changes must come from a zoom cause ---
      const gChange = Math.abs(Math.log(d.gd / before.gd)) > 1e-3;
      const springBack = before.gd > before.maxD && d.gd < before.gd;
      const zoomCause = zin > 0 || d.cine || before.cine || d.flyK > 0 || d.follow || ((d.inert || before.inert) && lastGesture === 'pinch') || springBack;
      if (gChange && !zoomCause) bad('goal-dist-unrequested', { from: before.gd, to: d.gd, why: lastKind });
      if (gChange) legitGoal = zoomCause;
      // --- visual distance: camera-to-focus may only change while a zoom is being asked for / settling ---
      if (prev) {
        const dE = Math.log(E / prev.E);
        const settling = Math.abs(Math.log(d.cd / d.gd)) > 0.002 || Math.abs(Math.log(d.cd / prev.cd)) > 1e-4;
        const allowed = zoomCause || (settling && legitGoal) || d.collK < 0.999 || prev.coll < 0.999 || d.hit === 'ground' || prev.hit === 'ground';
        const collDelta = Math.log((E / d.cd) / (prev.E / prev.cd));       // shortening by collision alone
        // a collision may slide the camera in/out (flying around the trunk) but never snap
        if (Math.abs(collDelta) > 0.2 && Math.max(E, prev.E) > 4)
          bad('collision-snap', { E0: +prev.E.toFixed(2), E1: +E.toFixed(2), dist: +d.cd.toFixed(2), hit: d.hit || prev.hit, yaw: +d.cy.toFixed(3), pitch: +d.cp.toFixed(3), target: t.map(v => +v.toFixed(2)), kind: lastKind });
        if (!allowed && Math.abs(dE) > 0.004 && Math.abs(collDelta) <= 0.01) bad('unrequested-zoom', { E0: prev.E, E1: E, kind: lastKind, cd0: prev.cd, cd: d.cd, gd: d.gd, gd0: before.gd, hit: d.hit, coll: d.collK, p: [cp.x, cp.y, cp.z], t, pitch: d.cp });
        const jump = Math.hypot(cp.x - prev.p[0], cp.y - prev.p[1], cp.z - prev.p[2]);
        const rAx = Math.hypot(t[0], t[2] + 0.6);
        if (jump > (0.25 * (Math.max(E, prev.E) + rAx) + 0.3) * dt * 60) bad('jump', { jump: +jump.toFixed(2), E: +E.toFixed(2), kind: lastKind });
        out.maxRatioDrop = Math.max(out.maxRatioDrop, -collDelta);
      }
      // --- never inside the trunk or under the ground ---
      if (solidStrict(cp.x, cp.y, cp.z)) bad('inside-trunk', { p: [cp.x, cp.y, cp.z].map(v => +v.toFixed(2)), kind: lastKind, t, cd: d.cd, E, coll: d.collK, hit: d.hit, yaw: d.cy, pitch: d.cp });
      if (cp.y < groundH(cp.x, cp.z) + 0.15) bad('under-ground', { p: [cp.x, cp.y, cp.z].map(v => +v.toFixed(2)), g: groundH(cp.x, cp.z) });
      // --- limits and a sensible focus ---
      if (Math.abs(d.cy - d.home.yaw) > d.YAW_LIM + 0.02) bad('yaw-limit', { yaw: d.cy, kind: lastKind });
      if (d.cp < d.PMIN - 0.01 || d.cp > d.PMAX + 0.01) bad('pitch-limit', { pitch: d.cp });
      const B = d.BOUND, r = Math.hypot(t[0] - B.cx, t[2] - B.cz);
      if (r > B.r + 3.8 || t[1] > B.yMax + 3.6 || t[1] < groundH(t[0], t[2]) - 0.01) bad('focus-out', { t, r: +r.toFixed(2) });
      if (!isFinite(E) || !isFinite(cp.x)) bad('nan', {});
      if (d.cd < 0.99 || d.cd > d.hardD + 0.01) bad('dist-range', { cd: d.cd });
      if (orbitRef) {
        if (zin > 0 || d.flyK > 0 || d.cine || d.follow || Math.abs(Math.log(d.cd / orbitRef.cd)) > 0.003) orbitRef = null;
        else if (Math.abs(Math.log(E / orbitRef.E)) > 0.12 && orbitRef.E > 5) { bad('orbit-zoom', { E0: +orbitRef.E.toFixed(2), E1: +E.toFixed(2), hit: d.hit, yaw: +d.cy.toFixed(3), pitch: +d.cp.toFixed(3), t: t.map(v => +v.toFixed(2)) }); orbitRef = null; }
      }
      if (opt.trace === curSeq) (out.trace = out.trace || []).push([lastKind, +E.toFixed(2), +d.cd.toFixed(2), +d.gd.toFixed(2), d.hit, +d.collK.toFixed(3), t.map(v => +v.toFixed(2)), d.gt.map(v => +v.toFixed(2)), +d.cy.toFixed(3), d.flyK]);
      prev = { coll: d.collK, E, cd: d.cd, p: [cp.x, cp.y, cp.z], hit: d.hit };
      if (zin > 0) zin--;
    }
    const dt = () => (R() < 0.04 ? rnd(0.03, 0.07) : 1 / 60);
    const run = n => { for (let i = 0; i < n; i++) frame(dt()); };
    let pid = 10;
    function pe(type, id, x, y, extra = {}) {
      if (type === 'pointerdown') lastGesture = lastKind;
      const ev = new PointerEvent(type, Object.assign({ pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, isPrimary: true, pointerType: touch ? 'touch' : 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1 }, extra));
      cv.dispatchEvent(ev);
    }
    const P = () => [rnd(20, W - 20), rnd(20, H - 20)];

    const actions = {
      orbit() {
        lastKind = 'orbit'; log.push('orbit');
        const id = ++pid; let [x, y] = P(); pe('pointerdown', id, x, y);
        const n = ri(3, 40), tdx = rnd(-1600, 1600) * (R() < 0.5 ? 1 : 0.3), tdy = rnd(-500, 500) * (R() < 0.6 ? 0.3 : 1);
        const n2 = Math.max(n, Math.ceil(Math.hypot(tdx, tdy) / 60));
        orbitRef = null; run(0);
        for (let i = 0; i < n2; i++) { x += tdx / n2; y += tdy / n2; pe('pointermove', id, x, y); run(1); if (i === 0) orbitRef = { E: prev.E, cd: prev.cd }; }
        if (R() < 0.4) run(ri(2, 10));                            // stop before lifting: no fling
        const r = R(); pe(r < 0.1 ? 'pointercancel' : 'pointerup', id, x, y);
      },
      orbitLimit() {                                               // push against the yaw limit, back and forth
        lastKind = 'orbitLimit'; log.push('orbitLimit');
        const id = ++pid; let [x, y] = P(); pe('pointerdown', id, x, y);
        const s = R() < 0.5 ? 1 : -1;
        for (let k = 0; k < ri(1, 4); k++) {
          const dx = s * (k % 2 ? -1 : 1) * rnd(300, 2500), dy = rnd(-200, 200), n = Math.max(ri(8, 30), Math.ceil(Math.abs(dx) / 60));
          if (k === 0) { run(1); orbitRef = { E: prev.E, cd: prev.cd }; }
          for (let i = 0; i < n; i++) { x += dx / n; y += dy / n; pe('pointermove', id, x, y); run(1); }
          for (let i = 0; i < ri(0, 30); i++) { x += s * rnd(-2, 12); pe('pointermove', id, x, y); run(1); }
        }
        pe('pointerup', id, x, y);
      },
      pinch() {
        lastKind = 'pinch'; log.push('pinch');
        const a = ++pid, b = ++pid; let [cx, cy] = P(); let r = rnd(30, 160), ang = rnd(0, 6.28);
        const pts = () => [[cx + Math.cos(ang) * r, cy + Math.sin(ang) * r], [cx - Math.cos(ang) * r, cy - Math.sin(ang) * r]];
        let q = pts(); pe('pointerdown', a, ...q[0]); if (R() < 0.3) run(ri(1, 3)); pe('pointerdown', b, ...q[1], { isPrimary: false });
        const n = ri(4, 35), sc = Math.pow(rnd(0.25, 4), 1 / n), mvx = R() < 0.4 ? rnd(-300, 300) / n : 0, mvy = R() < 0.4 ? rnd(-300, 300) / n : 0;
        for (let i = 0; i < n; i++) { r *= sc; cx += mvx; cy += mvy; ang += rnd(-0.02, 0.02); q = pts(); pe('pointermove', a, ...q[0]); zin = 2; pe('pointermove', b, ...q[1], { isPrimary: false }); zin = 2; run(1); }
        const order = R() < 0.5;
        pe('pointerup', order ? a : b, ...q[order ? 0 : 1]); zin = 2;
        if (R() < 0.4) {                                           // one finger stays and keeps orbiting
          lastKind = 'orbit'; let [x, y] = q[order ? 1 : 0];
          for (let i = 0; i < ri(3, 20); i++) { x += rnd(-30, 30); y += rnd(-10, 10); pe('pointermove', order ? b : a, x, y); run(1); }
          pe('pointerup', order ? b : a, x, y);
        } else { pe('pointerup', order ? b : a, ...q[order ? 1 : 0]); lastKind = 'pinch'; }
      },
      pan() {
        lastKind = 'pan'; log.push('pan');
        const id = ++pid; let [x, y] = P(); pe('pointerdown', id, x, y, { button: 2, buttons: 2 });
        const n = ri(3, 30), dx = rnd(-600, 600), dy = rnd(-600, 600);
        for (let i = 0; i < n; i++) { x += dx / n; y += dy / n; pe('pointermove', id, x, y); run(1); }
        pe('pointerup', id, x, y);
      },
      wheel() {
        lastKind = 'wheel'; log.push('wheel');
        const [x, y] = P();
        for (let i = 0; i < ri(1, 10); i++) { cv.dispatchEvent(new WheelEvent('wheel', { deltaY: rnd(-300, 300), clientX: x, clientY: y, ctrlKey: R() < 0.3, bubbles: true, cancelable: true })); zin = 3; run(ri(1, 4)); }
      },
      tap(dbl) {
        lastKind = dbl ? 'dbl' : 'tap'; log.push(lastKind);
        const [x, y] = P(); const id = ++pid; pe('pointerdown', id, x, y); run(ri(1, 6)); if (dbl) zin = 3; pe('pointerup', id, x, y);
        if (dbl) { run(ri(3, 15)); const id2 = ++pid; pe('pointerdown', id2, x + rnd(-8, 8), y + rnd(-8, 8)); run(ri(1, 6)); zin = 3; pe('pointerup', id2, x, y); zin = 3; }
      },
      key() {
        const k = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '-', 'h'][ri(0, 6)];
        lastKind = 'key' + k; log.push(lastKind);
        if ('+-h'.includes(k)) zin = 3;
        dispatchEvent(new KeyboardEvent('keydown', { key: k }));
      },
      button() {
        const b = R() < 0.5 ? 'bF' : 'bH'; lastKind = b; log.push(b); zin = 3; document.getElementById(b).click();
      },
      wait() { log.push('wait'); run(R() < 0.03 ? ri(1860, 2100) : ri(5, 120)); },
    };
    const W8 = [['orbit', 26], ['orbitLimit', 16], ['pinch', 14], ['pan', 6], ['wheel', 8], ['tap', 3], ['dbl', 4], ['key', 4], ['button', 2], ['wait', 17]];
    const tot = W8.reduce((a, w) => a + w[1], 0);
    function pickA() { let r = R() * tot; for (const [n, w] of W8) { if ((r -= w) < 0) return n; } return 'wait'; }

    if (rig.debug.inert) lastGesture = 'pinch';    // inertia left over from the previous chunk
    for (let s = 0; s < opt.n; s++) {
      curSeq = s; log = [];
      if (R() < 0.5) { document.getElementById('bH').click(); zin = 3; lastKind = 'home'; run(90); }
      const n = ri(3, 9);
      for (let i = 0; i < n; i++) {
        const a = pickA();
        if (a === 'tap') actions.tap(false); else if (a === 'dbl') actions.tap(true); else actions[a]();
        if (R() < 0.5) run(ri(1, 20));
      }
      run(ri(20, 90));                                            // let everything settle
      out.seqs++;
    }
    return out;
  };
})();
