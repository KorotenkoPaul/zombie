// Workshop bench work (the "Сделать работу в мастерской естественной" thread): saw, sharpen, fix the lantern.
// HERO-RULES.md: every action is a job({...}); the body stands on the idle clip (upright, no clip lean), and the hands are
// driven only in the contacts slot (job post): the tool in the right fist by holdToolAt, the left hand on the work.
// Tools are taken from where they lie by hand and put back by hand: the tool stays on its spot until the fist is on it
// (virtual hold), and is set down in the same pose it was taken in, so nothing flies and nothing snaps.
// World props this module owns: the board in the vice and its offcuts (built here, in bench-local coordinates).
export function createWorkshop(K) {
  const { THREE, V, H, root, bones, job, PP, AU, reachGrip, holdToolAt, smooth, rnd, grabTool, relTool, scene } = K;
  const Q = () => new THREE.Quaternion();
  const G = () => window.__grab;
  // a fist onto a point with the arm only (no lean of the chest: he stands upright at the bench; the stance puts the work in reach)
  function handTo(side, t, w) { const g = G(); const sh = bones[side + 'Arm']; if (!g || !g.gripPoint || !sh || w <= .001) return; const pt = g.palmTarget(side, t);
    K.armIK(side, pt, K.sidePole(side), Math.min(1, w)); if (w > .98) for (let i = 0; i < 3; i++) { const e = t.clone().sub(g.gripPoint(side)); if (e.length() < .004) break; K.armIK(side, bones[side + 'Hand'].getWorldPosition(V()).add(e), K.sidePole(side), 1); } }
  const bench = () => { const P = PP(); return P && P.objects && P.objects.workbench; };
  const toW = (x, y, z) => { const b = bench(); b.updateMatrixWorld(); return b.localToWorld(V(x, y, z)); };
  const dirW = (x, y, z) => { const b = bench(); return V(x, y, z).transformDirection(b.matrixWorld); };
  const benchYaw = () => { const b = bench(); const f = dirW(0, 0, -1); void b; return Math.atan2(f.x, f.z); }; // he faces the bench: bench-local -z

  // ---------- bench-local layout (workbench(): L 1.7 along x, D .66 along z, top .9; the vice at the front-left end) ----------
  // The hero's right hand is on the bench's -x side when he faces it, so the vice end is where he saws.
  const VICE = { x: -.63, y: .84, z: .33 + .0537 }; // the gap between the iron and the wooden jaw
  const BD = { y0: .89, y1: 1.04, t: .018, z: VICE.z }; // the board stands on edge in the jaws
  const XC = -.80; // cut line, just left (his right) of the jaws and past the bench end
  const OFF = .15; // offcut length
  const SAW_STAND = [-.66, .72]; // where he stands (bench-local x, z)
  const ALPHA = .6; // blade angle below horizontal (34 deg)

  // ---------- the board (and the kerf in it) ----------
  let WB = null;
  function buildBoard() {
    if (WB) return WB; const b = bench(); if (!b) return null;
    let map = null; b.traverse(o => { if (!map && o.isMesh && o.material && o.material.map) map = o.material.map; }); // the bench's own wood grain
    const mat = new THREE.MeshStandardMaterial({ color: map ? 0xF0D2A8 : 0xC89A63, roughness: .8, map });
    const endMat = new THREE.MeshStandardMaterial({ color: 0xE2C08C, roughness: .9 }); // fresh end grain is lighter
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mk = m => { const o = new THREE.Mesh(box, m); o.castShadow = true; o.receiveShadow = true; return o; };
    const g = new THREE.Group(); g.name = 'wsBoard'; b.add(g);
    const main = mk(mat), off = mk(mat), cutEnd = mk(endMat);
    const kerf = new THREE.Mesh(box, new THREE.MeshStandardMaterial({ color: 0x2A1A0E, roughness: 1 }));
    g.add(main, off, cutEnd, kerf);
    WB = { g, main, off, kerf, cutEnd, xR: -.3, depth: .018, offs: [], mat };
    layout(); return WB;
  }
  // main: XC..xR, offcut: XC-OFF..XC, kerf: a dark slot from the top down to depth
  function layout(slide = 0) {
    const h = BD.y1 - BD.y0, yc = (BD.y0 + BD.y1) / 2;
    const x0 = XC - OFF - slide, xr = WB.xR - slide;
    if (slide > 0) { // sliding: one piece from x0 to xr (the next offcut is still part of the board)
      WB.main.position.set((x0 + xr) / 2, yc, BD.z); WB.main.scale.set(xr - x0, h, BD.t); WB.off.visible = false; WB.kerf.visible = false; WB.cutEnd.visible = true;
      WB.cutEnd.position.set(x0 - .0005, yc, BD.z); WB.cutEnd.scale.set(.001, h - .001, BD.t - .001); return; }
    WB.main.position.set((XC + xr) / 2, yc, BD.z); WB.main.scale.set(xr - XC, h, BD.t);
    WB.off.visible = true; WB.off.position.set(XC - OFF / 2, yc, BD.z); WB.off.scale.set(OFF, h, BD.t);
    WB.cutEnd.visible = true; WB.cutEnd.position.set(XC - OFF - .0005, yc, BD.z); WB.cutEnd.scale.set(.001, h - .001, BD.t - .001);
    const d = Math.max(.001, Math.min(h, WB.depth)); WB.kerf.visible = WB.depth > .001; WB.kerf.position.set(XC, BD.y1 - d / 2 + .0005, BD.z); WB.kerf.scale.set(.003, d, BD.t + .002);
  }
  // the offcut falls off the board, tumbles flat onto the floor and stays there (at most 3 lie about)
  function dropOffcut() {
    const b = bench(); const o = WB.off.clone(); o.material = WB.mat; b.add(o); o.visible = true;
    const floorY = 0; const s = { o, v: 0, y: o.position.y, rx: 0, rxT: (Math.random() < .5 ? -1 : 1) * Math.PI / 2, ry: rnd(-.6, .6), x: o.position.x - rnd(.02, .08), z: o.position.z + rnd(-.05, .12), floorY: floorY + BD.t / 2, done: false };
    WB.offs.push(s); while (WB.offs.length > 3) { const r = WB.offs.shift(); b.remove(r.o); }
    WB.off.visible = false; WB.kerf.visible = false;
    try { window.__audio && window.__audio.contact && window.__audio.contact({ tool: 'hammer', kind: 'hit', pos: toW(XC - OFF / 2, BD.y0, BD.z).toArray(), strength: .25 }); } catch (e) { }
  }
  function tickOffcuts(dt) { if (!WB) return; for (const s of WB.offs) { if (s.done) continue; s.v += 9.8 * dt; s.y -= s.v * dt; const k = 1 - Math.exp(-dt * 7); s.rx += (s.rxT - s.rx) * k;
      if (s.y <= s.floorY) { s.y = s.floorY; s.rx = s.rxT; s.done = true; } s.o.position.set(s.x, s.y, s.z); s.o.rotation.set(s.rx, s.ry, 0, 'YXZ'); } }

  // ---------- tools taken from the bench: clones of the tool wall's (same look, real size) ----------
  function cloneTool(src, name) { const P = PP(); if (!P || !P.tools) return null; if (P.tools[name]) return P.tools[name]; const s = P.tools[src]; if (!s) return null;
    const ud = s.userData; s.userData = {}; const c = s.clone(true); s.userData = ud; c.userData = { live: true, grip: ud.grip ? ud.grip.clone() : V() }; c.scale.setScalar(1); c.visible = true;
    scene.add(c); P.tools[name] = c; if (K.P3 && K.P3.tools && K.P3 !== P) K.P3.tools[name] = c; /* hero.js grabs through its own props handle */ const g = G(); if (g && g.GRIP && g.GRIP[src] && !g.GRIP[name]) g.GRIP[name] = g.GRIP[src]; return c; }
  // a hand saw of its own (the tool wall's saw is merged into the wall): blade along +x, spine up (+y), teeth on y = 0, grip in the handle
  function makeSaw() { const P = PP(); if (!P || !P.tools) return null; if (P.tools.benchSaw) return P.tools.benchSaw; const g = new THREE.Group(); g.name = 'benchSaw';
    const sh = new THREE.Shape(); sh.moveTo(0, 0); for (let x = 0; x < .4; x += .012) { sh.lineTo(x + .006, -.006); sh.lineTo(x + .012, 0); } sh.lineTo(.4, .05); sh.quadraticCurveTo(.2, .085, 0, .105); sh.lineTo(0, 0);
    const steel = new THREE.MeshStandardMaterial({ color: 0xB9BEC3, metalness: .85, roughness: .32 }); const wood = new THREE.MeshStandardMaterial({ color: 0x7A3B1F, roughness: .6 });
    const bl = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .0012, bevelEnabled: false }), steel); bl.position.z = -.0006; g.add(bl);
    const hs = new THREE.Shape(); hs.moveTo(-.005, -.005); hs.lineTo(.03, -.005); hs.lineTo(.03, .115); hs.quadraticCurveTo(-.05, .14, -.115, .1); hs.quadraticCurveTo(-.125, .02, -.09, -.005); hs.lineTo(-.005, -.005);
    const hole = new THREE.Path(); hole.absellipse(-.055, .055, .026, .036, 0, Math.PI * 2, true); hs.holes.push(hole);
    const hd = new THREE.Mesh(new THREE.ExtrudeGeometry(hs, { depth: .022, bevelEnabled: true, bevelThickness: .004, bevelSize: .004, bevelSegments: 2 }), wood); hd.position.z = -.011; g.add(hd);
    for (const y of [.02, .08]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, .032, 10), steel); r.rotation.x = Math.PI / 2; r.position.set(.012, y, 0); g.add(r); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.userData = { live: true, grip: V(-.055, .045, 0) }; scene.add(g); P.tools.benchSaw = g; if (K.P3 && K.P3.tools && K.P3 !== P) K.P3.tools.benchSaw = g;
    const gr = G(); if (gr && gr.GRIP) gr.GRIP.benchSaw = { g: [-.055, .045, 0], a: [1, 0, 0], A: 'F', b: [0, 1, 0], B: 'T', tilt: 0, fwd: true }; return g; }
  // set a tool's home (where it rests) so that its grip point is at gp, its working axis along W and its second axis along B
  function basis(a, b) { const x = a.clone().normalize(); const y = b.clone().sub(x.clone().multiplyScalar(b.dot(x))).normalize(); return new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)); }
  function restPose(name, gp, W, B) { const P = PP(); const o = P.tools[name]; const sp = G().GRIP[name]; const sc = 1;
    const q = Q().setFromRotationMatrix(basis(W, B).multiply(basis(V(...sp.a), V(...sp.b)).transpose()));
    const pos = gp.clone().sub(V(...sp.g).multiplyScalar(sc).applyQuaternion(q)); o.userData.home = { parent: scene, pos, quat: q, scale: sc };
    if (o.parent === scene) { o.position.copy(pos); o.quaternion.copy(q); o.scale.setScalar(sc); } return { pos, q }; }

  // ---------- virtual hold: the fist goes onto the tool where it rests, in the pose it will hold it ----------
  // take(a, name, side, gp, tip, B, dt) -> true once the tool is in the hand; the tool does not move before the fist is on it
  function take(a, name, side, gp, tip, B, dt, T = .7) { const P = PP(); const o = P.tools[name]; const k = a.tk || (a.tk = { t: 0 }); k.t += dt;
    if (!k.got) { if (!grabTool(name, side)) { a.tk = null; return true; } k.got = true; k.fp = o.position.clone(); k.fq = o.quaternion.clone(); k.home = o.userData.home; }
    const w = smooth(0, T, k.t); o.position.copy(k.fp); o.quaternion.copy(k.fq); const sc0 = o.scale.x;
    const place = () => { holdToolAt(side, name, gp, tip, w, B); if (w < 1) { // keep the tool lying where it was until the fist closes on it
        const hb = bones[side + 'Hand']; hb.updateMatrixWorld(true); const hw = new THREE.Matrix4().copy(hb.matrixWorld).invert();
        const m = new THREE.Matrix4().compose(k.home.pos, k.home.quat, V(1, 1, 1).multiplyScalar(k.home.scale || 1)); m.premultiply(hw);
        const p = V(), q = Q(), s = V(); m.decompose(p, q, s); o.position.copy(p); o.quaternion.copy(q); o.scale.setScalar(s.x); } else { o.position.copy(k.fp); o.quaternion.copy(k.fq); o.scale.setScalar(sc0); } };
    place(); const g = G(); if (g && g.late) g.late(() => { o.position.copy(k.fp); o.quaternion.copy(k.fq); o.scale.setScalar(sc0); place(); });
    if (w >= 1) { a.tk = null; return true; } return false; }
  // put the tool down exactly on its rest pose, let go, then the hand leaves
  function put(a, name, side, dt, T = .6) { const P = PP(); const o = P.tools[name]; const h = o && o.userData.home; const k = a.pk || (a.pk = { t: 0 }); k.t += dt; const sp = G().GRIP[name];
    if (!h) return true; const gp = V(...sp.g).multiplyScalar(h.scale || 1).applyQuaternion(h.quat).add(h.pos); const tip = gp.clone().add(V(...sp.a).applyQuaternion(h.quat)); const B = V(...sp.b).applyQuaternion(h.quat);
    if (!k.rel) { holdToolAt(side, name, gp, tip, 1, B); const g = G(); if (g && g.late) g.late(() => holdToolAt(side, name, gp, tip, 1, B));
      if (k.t > .05) { k.rel = true; k.t = 0; k.gp = gp; relTool(side, name, .06); } return false; }
    const w = 1 - smooth(0, T, k.t); if (w > .01) reachGrip(side, k.gp.clone().add(V(0, .04 * (1 - w), 0)), w); if (k.t >= T) { a.pk = null; return true; } return false; }

  // ================= SAW: a cross cut on a board in the vice =================
  // the saw rests in the kerf; he takes it, saws with the right hand while the left holds the board, the offcut drops,
  // the left hand slides the board along for the next cut; at the end the saw goes back into the new kerf.
  function sawGeom(depth, s) { // stroke s in metres (+ = pushed forward); returns grip point, tip, spine direction (world)
    const W = dirW(0, -Math.sin(ALPHA), -Math.cos(ALPHA)); const up = dirW(0, 1, 0); const B = up.clone().sub(W.clone().multiplyScalar(up.dot(W))).normalize();
    const C = toW(XC, BD.y1 - depth, BD.z); const L = .25 - s; const gp = C.clone().addScaledVector(W, -L).addScaledVector(B, .045); /* the teeth run 5 cm under the grip */ return { gp, tip: gp.clone().add(W), B, C }; }
  function sawRest() { const r = sawGeom(Math.max(.012, WB.depth), -.02); restPose('benchSaw', r.gp, r.tip.clone().sub(r.gp), r.B); }
  function setupSaw() { if (!buildBoard()) return false; if (!makeSaw()) return false;
    if (WB.xR - XC < .3 && !(H.hold.Right && H.hold.Right.tool === 'benchSaw')) { WB.xR = -.3; WB.depth = .018; layout(); } // a fresh board (only while he is away from it)
    if (PP().tools.benchSaw.parent === scene) sawRest(); return true; }
  function saw(o) {
    setupSaw();
    const standAt = () => { if (!bench()) return null; return toW(SAW_STAND[0], 0, SAW_STAND[1]).add(V(0, 1, 0)); };
    const S = { ph: 'take', t: 0, cuts: 0, want: Math.random() < .5 ? 2 : 3, s: 0, dir: 1, w: 0 };
    return job({ pt: standAt, stand: .03, dur: [600, 600], vary: false, tools: [],
      start: a => { a.S = S; setupSaw(); },
      look: () => WB ? toW(XC, BD.y1 - WB.depth, BD.z) : null, lookW: .9,
      tick: (a, dt) => { H.face = benchYaw(); },
      post: (a, dt) => { if (!WB) { a.T = 1e9; return; } S.t += dt; const g = G();
        if (g) { g.hold('Left', WB.g, null); g.hold('Right', WB.g, null); }
        if (S.hx == null) S.hx = -.45;
        // the left hand holds the board's top edge in front of him; after a slide it lets go and takes a new hold (a small lift)
        if (S.ph === 'saw' && S.hx < -.451) { S.rg = (S.rg || 0) + dt / .5; const k = smooth(0, 1, S.rg); S.hxL = S.hxL ?? S.hx; S.hx = S.hxL + (-.45 - S.hxL) * k; S.lift = .04 * Math.sin(Math.PI * k); if (k >= 1) { S.hx = -.45; S.hxL = null; S.rg = 0; S.lift = 0; } }
        const hp = () => toW(S.hx, BD.y1 + .012 + (S.lift || 0), BD.z); const reachGrip = (sd, p, w) => { if (sd === 'Left') { if (!window.__wsNoL) handTo(sd, p, w); } else K.reachGrip(sd, p, w); };
        if (S.ph === 'take') { const r = sawGeom(Math.max(.012, WB.depth), -.02); if (take(a, 'benchSaw', 'Right', r.gp, r.tip, r.B, dt)) { S.ph = 'saw'; S.t = 0; S.u = 0; } reachGrip('Left', hp(), smooth(0, .7, S.t)); return; }
        if (S.ph === 'saw') { // strokes: ~0.85 s each, the push cuts; the stroke is shorter at the start of a cut
          S.u += dt / .85; const amp = WB.depth < .02 ? .06 : .11; const s = amp * Math.sin(S.u * Math.PI * 2);
          const push = Math.cos(S.u * Math.PI * 2) > 0; if (push) { WB.depth = Math.min(BD.y1 - BD.y0, WB.depth + dt * .045); layout(); }
          const r = sawGeom(WB.depth, s); holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B));
          reachGrip('Left', hp(), 1);
          if (WB.depth >= BD.y1 - BD.y0 - 1e-4 && s < -amp * .9) { dropOffcut(); S.cuts++; S.ph = 'look'; S.t = 0; S.last = r; }
          else if (S.finish && WB.depth >= .016 && s < -amp * .9) { S.ph = 'put'; S.t = 0; }
          return; }
        if (S.ph === 'look') { // the offcut falls: the saw stays still in the cut, he watches it land
          const r = S.last; holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B)); reachGrip('Left', hp(), 1);
          if (S.t > 1.1) { if (S.cuts >= S.want || WB.xR - OFF - XC < .3) S.finish = true; S.ph = 'slide'; S.t = 0; S.x0 = WB.xR; S.hx0 = S.hx; } return; }
        if (S.ph === 'slide') { // the left hand pushes the board along the jaws by one offcut; the saw is lifted out, held just above
          const k = smooth(0, 1.3, S.t); const sl = OFF * k; WB.xR = S.x0; layout(sl); const r = sawGeom(-.03 * Math.sin(Math.PI * k) - .005, -.04);
          holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B));
          S.hx = S.hx0 - sl; reachGrip('Left', hp(), 1);
          if (k >= 1) { WB.xR = S.x0 - OFF; WB.depth = 0; layout(); S.ph = 'saw'; S.u = .75; S.t = 0; } return; }
        if (S.ph === 'put') { sawRest(); reachGrip('Left', hp(), 1 - smooth(0, .5, S.t)); if (put(a, 'benchSaw', 'Right', dt)) { S.ph = 'done'; a.T = 1e9; g && g.free('Left'); g && g.free('Right'); } return; }
      },
      end: a => { const g = G(); if (g) { g.free('Left'); g.free('Right'); } if (H.hold.Right && H.hold.Right.tool === 'benchSaw') { sawRest(); relTool('Right', 'benchSaw', .3); } a.held.length = 0; },
      result: () => ({ ok: true, cuts: S.cuts }) });
  }

  return { saw, tick: tickOffcuts, setupSaw, layoutDbg: () => WB, sawGeom: (d, s) => sawGeom(d, s) };
}
