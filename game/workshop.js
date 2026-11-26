// Workshop bench work (the "Сделать работу в мастерской естественной" thread): saw, sharpen, fix the lantern.
// HERO-RULES.md: every action is a job({...}); the body stands on the idle clip (upright, no clip lean), and the hands are
// driven only in the contacts slot (job post): the tool in the right fist by holdToolAt, the left hand on the work.
// Tools are taken from where they lie by hand and put back by hand: the tool stays on its spot until the fist is on it
// (virtual hold), and is set down in the same pose it was taken in, so nothing flies and nothing snaps.
// World props this module owns: the board in the vice and its offcuts (built here, in bench-local coordinates).
export function createWorkshop(K) {
  const { THREE, V, H, root, bones, job, PP, AU, smooth, rnd, grabTool, relTool, scene } = K;
  const reachGrip = (sd, p, w) => handTo(sd, p, w);
  // bow the chest toward a point from the hips (spread over the three spine bones), before the hands are placed
  function bowTo(t, ang) { if (!(ang > .002) || !bones.Spine) return; const hp = bones.Hips.getWorldPosition(V()); const d = V(t.x - hp.x, 0, t.z - hp.z); if (d.lengthSq() < 1e-4) return; d.normalize();
    const ax = V(0, 1, 0).cross(d).normalize(); for (const [n, f] of [['Spine', .45], ['Spine1', .35], ['Spine2', .2]]) { const b = bones[n]; if (!b) continue;
      const pq = b.parent.getWorldQuaternion(Q()); const qa = Q().setFromAxisAngle(ax, ang * f); b.quaternion.premultiply(pq.clone().invert().multiply(qa).multiply(pq)); b.updateMatrixWorld(true); } }
  // put a held tool exactly: its grip point at gp, its working end toward tip, its second axis along bw (Grab's GRIP table);
  // the hand's world rotation is solved first, then the wrist goes where that puts the fist on gp, then the arm IK (no lean)
  function holdToolAt(side, name, gp, tip, w, bw) { const P = PP(); const o = P && P.tools && P.tools[name]; const g = G(); const sp = g && g.GRIP && g.GRIP[name]; const hb = bones[side + 'Hand']; if (!o || !sp || o.parent !== hb) return false;
    const gl = V(...sp.g).multiplyScalar(o.scale.x).applyQuaternion(o.quaternion).add(o.position); const W = tip.clone().sub(gp).normalize();
    const bas = (x, y) => { const X = x.clone().normalize(); const Y = y.clone().sub(X.clone().multiplyScalar(y.dot(X))); if (Y.lengthSq() < 1e-6) Y.set(0, 1, 0).sub(X.clone().multiplyScalar(X.y)); Y.normalize(); return new THREE.Matrix4().makeBasis(X, Y, X.clone().cross(Y)); };
    for (let it = 0; it < 2; it++) { const Qt = Q().setFromRotationMatrix(bas(W, bw).multiply(bas(V(...sp.a), V(...sp.b)).transpose())); const Qh = Qt.multiply(o.quaternion.clone().invert());
      const sc = hb.getWorldScale(V()).x; const wrist = gp.clone().sub(gl.clone().multiplyScalar(sc).applyQuaternion(Qh));
      K.armIK(side, wrist, K.sidePole(side), w); const pq = hb.parent.getWorldQuaternion(Q()); const cur = hb.getWorldQuaternion(Q()); hb.quaternion.copy(pq.invert().multiply(cur.slerp(Qh, w))); hb.updateMatrixWorld(true); }
    return true; }
  const Q = () => new THREE.Quaternion();
  const G = () => window.__grab;
  // a fist onto a point with the arm only (no lean of the chest: he stands upright at the bench; the stance puts the work in reach)
  function handTo(side, t, w) { const g = G(); const sh = bones[side + 'Arm']; if (!g || !g.gripPoint || !sh || w <= .001) return; const pt = g.palmTarget(side, t);
    K.armIK(side, pt, K.sidePole(side), Math.min(1, w)); if (w > .98) for (let i = 0; i < 3; i++) { const e = t.clone().sub(g.gripPoint(side)); if (e.length() < .004) break; K.armIK(side, bones[side + 'Hand'].getWorldPosition(V()).add(e), K.sidePole(side), 1); } }
  // a flat hand pressing on something: hand-bone +y (fingers) along fdir, the palm (hand-bone x, side sign PS) facing pdir
  const PS = { Left: +(window.__wsPS || 1), Right: -(window.__wsPS || 1) };
  function flatHand(side, fdir, pdir, w) { const hb = bones[side + 'Hand']; if (!hb || w <= .001) return; const y = fdir.clone().normalize(); const x = pdir.clone().multiplyScalar(-PS[side]).addScaledVector(y, -pdir.dot(y) * -PS[side]).normalize();
    const z = x.clone().cross(y).normalize(); const m = new THREE.Matrix4().makeBasis(x, y, z); const qW = Q().setFromRotationMatrix(m); const qP = hb.parent.getWorldQuaternion(Q()); hb.quaternion.slerp(qP.invert().multiply(qW), Math.min(1, w)); hb.updateMatrixWorld(true); }
  const bench = () => { const P = PP(); return P && P.objects && P.objects.workbench; };
  const toW = (x, y, z) => { const b = bench(); b.updateMatrixWorld(); return b.localToWorld(V(x, y, z)); };
  const dirW = (x, y, z) => { const b = bench(); b.updateMatrixWorld(); return V(x, y, z).applyQuaternion(b.getWorldQuaternion(Q())); }; // keeps the length (transformDirection normalises)
  // which way his right hand is along the bench (bench-local x sign), measured from the shoulders, never assumed
  // (measured in the body's own frame and turned to face the bench, so it is right even while he is still walking up facing
  // elsewhere: the craft piece was once built mirrored from a mid-walk reading and the hammer then swung across his face)
  const RS = () => { const b = bench(); if (!b) return 1; K.root.updateMatrixWorld(true); const r = K.root.worldToLocal(bones.RightArm.getWorldPosition(V())), l = K.root.worldToLocal(bones.LeftArm.getWorldPosition(V()));
    const d = r.sub(l); d.y = 0; d.applyAxisAngle(V(0, 1, 0), benchYaw()); return d.dot(dirW(1, 0, 0)) >= 0 ? 1 : -1; };
  // the bench's obstacle box includes the vice, so pushOut kept him 45 cm from the top everywhere: trim it to the top's front edge
  let trimmed = false; function trimObst() { if (trimmed || !K.OBST || !bench()) return; const b = bench(); b.updateMatrixWorld(); const fz = toW(0, 0, .33 + .02).z;
    for (const o of K.OBST) if (o.n === 'workbench' && Math.abs(b.rotation.y) < .01 && o.z1 > fz) o.z1 = fz; trimmed = true; }
  const benchYaw = () => { const b = bench(); const f = dirW(0, 0, -1); void b; return Math.atan2(f.x, f.z); }; // he faces the bench: bench-local -z

  // ---------- bench-local layout (workbench(): L 1.7 along x, D .66 along z, top .9; the vice at the front-left end) ----------
  // The hero's right hand is on the bench's -x side when he faces it, so the vice end is where he saws.
  const VICE = { x: -.63, y: .84, z: .33 + .0537 }; // the gap between the iron and the wooden jaw
  const BD = { y0: .89, y1: window.__wsBY1 ?? .97, t: .018, z: VICE.z }; // the board stands on edge in the jaws
  const XC = -.80; // cut line, just left (his right) of the jaws and past the bench end
  const OFF = .15; // offcut length
  const SAW_STAND = [-.66, .86]; // where he stands (bench-local x, z)
  const HX = () => window.__wsHX ?? -.58; // where the left hand holds the board (bench-local x)
  const SREST = () => window.__wsRS ?? .05; // the saw at rest in the kerf (stroke position): at the stroke centre, so taking it never folds the arm in past the stroke (at -.02 the wrist snapped 17 cm into the shoulder near the end of the take)
  let ALPHA = .35; const ALf = () => window.__wsAL ?? ALPHA; // steeper and the board lower: he is small (shoulder ~26 cm over the bench), a 34 deg blade on a tall board put the handle at his shoulder and the arm could not fold that far // blade angle below horizontal (34 deg)

  // ---------- the board (and the kerf in it) ----------
  let WB = null, MIR = false; const toWB = (x, y, z) => toW(MIR ? 2 * VICE.x - x : x, y, z);
  function buildBoard() {
    if (WB) return WB; const b = bench(); if (!b) return null;
    let map = null; b.traverse(o => { if (!map && o.isMesh && o.material && o.material.map) map = o.material.map; }); // the bench's own wood grain
    const mat = new THREE.MeshStandardMaterial({ color: map ? 0xF0D2A8 : 0xC89A63, roughness: .8, map });
    const endMat = new THREE.MeshStandardMaterial({ color: 0xE2C08C, roughness: .9 }); // fresh end grain is lighter
    const box = new THREE.BoxGeometry(1, 1, 1);
    const mk = m => { const o = new THREE.Mesh(box, m); o.castShadow = true; o.receiveShadow = true; return o; };
    const g = new THREE.Group(); g.name = 'wsBoard'; b.add(g); MIR = RS() > 0; if (MIR) { g.scale.x = -1; g.position.x = 2 * VICE.x; } // his right hand at the cut: mirror the set-up about the vice
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
    const o = WB.off.clone(); o.material = WB.mat; WB.g.add(o); o.visible = true;
    const floorY = 0; const s = { o, v: 0, y: o.position.y, rx: 0, rxT: (Math.random() < .5 ? -1 : 1) * Math.PI / 2, ry: rnd(-.6, .6), x: o.position.x - rnd(.02, .08), z: o.position.z + rnd(-.05, .12), floorY: floorY + BD.t / 2, done: false };
    WB.offs.push(s); while (WB.offs.length > 3) { const r = WB.offs.shift(); WB.g.remove(r.o); }
    WB.off.visible = false; WB.kerf.visible = false;
    try { window.__audio && window.__audio.contact && window.__audio.contact({ tool: 'hammer', kind: 'hit', pos: toWB(XC - OFF / 2, BD.y0, BD.z).toArray(), strength: .25 }); } catch (e) { }
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
    const steel = new THREE.MeshStandardMaterial({ color: 0xAEB3B8, metalness: .35, roughness: .42 }); const wood = new THREE.MeshStandardMaterial({ color: 0x7A3B1F, roughness: .6 });
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
  function take(a, name, side, gp, tip, B, dt, T = .7, path = false) { const P = PP(); const o = P.tools[name]; const k = a.tk || (a.tk = { t: 0 }); k.t += dt;
    if (!k.got) { if (!grabTool(name, side)) { a.tk = null; return true; } k.got = true; k.fp = o.position.clone(); k.fq = o.quaternion.clone(); k.home = o.userData.home; }
    const w = smooth(0, T, k.t); o.position.copy(k.fp); o.quaternion.copy(k.fq); const sc0 = o.scale.x;
    // path: the fist travels a straight line to the grip with the arm fully solved on it (blending the joint angles by w kept the arm
    // straight until the end and then folded it at once: the saw take threw the wrist 16 cm/frame² into the shoulder)
    let gpU = gp, tipU = tip, wI = w; if (path) { const gg = G(); if (!k.g0) k.g0 = gg && gg.gripPoint ? gg.gripPoint(side).clone() : gp.clone(); gpU = k.g0.clone().lerp(gp, w); tipU = gpU.clone().add(tip.clone().sub(gp)); wI = smooth(0, .35, k.t); }
    const place = () => { holdToolAt(side, name, gpU, tipU, wI, B); if (w < 1) { // keep the tool lying where it was until the fist closes on it
        const hb = bones[side + 'Hand']; hb.updateMatrixWorld(true); const hw = new THREE.Matrix4().copy(hb.matrixWorld).invert();
        const m = new THREE.Matrix4().compose(k.home.pos, k.home.quat, V(1, 1, 1).multiplyScalar(k.home.scale || 1)); m.premultiply(hw);
        const p = V(), q = Q(), s = V(); m.decompose(p, q, s); o.position.copy(p); o.quaternion.copy(q); o.scale.setScalar(s.x); } else { o.position.copy(k.fp); o.quaternion.copy(k.fq); o.scale.setScalar(sc0); } };
    place(); const g = G(); if (g && g.late) g.late(() => { o.position.copy(k.fp); o.quaternion.copy(k.fq); o.scale.setScalar(sc0); place(); });
    if (w >= 1) { a.tk = null; return true; } return false; }
  // put the tool down exactly on its rest pose, let go, then the hand leaves
  function put(a, name, side, dt, T = .6) { const P = PP(); const o = P.tools[name]; const h = o && o.userData.home; const k = a.pk || (a.pk = { t: 0 }); k.t += dt; const sp = G().GRIP[name];
    if (!h) return true; const gp = V(...sp.g).multiplyScalar(h.scale || 1).applyQuaternion(h.quat).add(h.pos); const tip = gp.clone().add(V(...sp.a).applyQuaternion(h.quat)); const B = V(...sp.b).applyQuaternion(h.quat);
    // GRAB (frame check: the hammer was let go 40 cm short of its spot and jumped 32 cm there): the hand carries the tool to its spot over
    // ~0.5 s (eased IK, not snapped), and lets go only once the fist's grip point is on the spot (or after 1.6 s, the release eases the rest)
    if (!k.rel) { const w = smooth(0, .5, k.t); holdToolAt(side, name, gp, tip, w, B); const g = G(); if (g && g.late) g.late(() => holdToolAt(side, name, gp, tip, w, B));
      const gd = g && g.gripPoint ? g.gripPoint(side).distanceTo(gp) : 0; if (k.t > .5 && (gd < .04 || k.t > 1.6)) { k.rel = true; k.t = 0; k.gp = gp; relTool(side, name, gd < .04 ? .06 : .35); } return false; }
    const w = 1 - smooth(0, T, k.t); if (w > .01) reachGrip(side, k.gp.clone().add(V(0, .04 * (1 - w), 0)), w); if (k.t >= T) { a.pk = null; snapHome(name); return true; } return false; }
  // a released tool lies exactly where it was taken from (the release blend and the settle tick left it 6 cm up, hanging in the air)
  function snapHome(name) { const P = PP(); const o = P && P.tools && P.tools[name]; const h = o && o.userData.home; if (!h || o.parent !== h.parent) return; o.position.copy(h.pos); o.quaternion.copy(h.quat); o.updateMatrixWorld(true); }

  // ================= SAW: a cross cut on a board in the vice =================
  // the saw rests in the kerf; he takes it, saws with the right hand while the left holds the board, the offcut drops,
  // the left hand slides the board along for the next cut; at the end the saw goes back into the new kerf.
  function sawGeom(depth, s) { // stroke s in metres (+ = pushed forward); returns grip point, tip, spine direction (world)
    const W = dirW(0, -Math.sin(ALf()), -Math.cos(ALf())); const up = dirW(0, 1, 0); const B = up.clone().sub(W.clone().multiplyScalar(up.dot(W))).normalize();
    const C = toWB(XC, BD.y1 - depth, BD.z); const L = .25 - s; const gp = C.clone().addScaledVector(W, -L).addScaledVector(B, .045); /* the teeth run 5 cm under the grip */ return { gp, tip: gp.clone().add(W), B, C }; }
  function sawRest() { const r = sawGeom(Math.max(.012, WB.depth), SREST()); restPose('benchSaw', r.gp, r.tip.clone().sub(r.gp), r.B); }
  function setupSaw() { if (!buildBoard()) return false; if (!makeSaw()) return false;
    if (WB.xR - XC < .3 && !(H.hold.Right && H.hold.Right.tool === 'benchSaw')) { WB.xR = -.3; WB.depth = .018; layout(); } // a fresh board (only while he is away from it)
    if (PP().tools.benchSaw.parent === scene) sawRest(); return true; }
  function saw(o) {
    setupSaw();
    const standAt = () => { if (!bench()) return null; trimObst(); buildBoard(); return toWB(window.__wsSSX ?? SAW_STAND[0], 0, window.__wsSSZ ?? SAW_STAND[1]).add(V(0, 1, 0)); };
    const S = { ph: 'take', t: 0, cuts: 0, want: Math.random() < .5 ? 2 : 3, s: 0, dir: 1, w: 0 };
    return job({ pt: standAt, stand: .03, dur: [600, 600], vary: false, tools: [],
      start: a => { a.S = S; setupSaw(); },
      look: () => WB ? toWB(XC, BD.y1 - WB.depth, BD.z) : null, lookW: .9,
      tick: (a, dt) => { H.face = benchYaw() + (window.__wsTurn ?? .3) * RS(); /* three-quarter to the room (the hero camera looks from behind him): the saw arm shows beside his body */ },
      post: (a, dt) => { if (!WB) { a.T = 1e9; return; } S.t += dt; const g = G();
        if (g) { g.hold('Left', WB.g, null); g.hold('Right', WB.g, null); }
        // R19-1: a slight bow over the board from the hips (the board sits in the vice ~57 cm in front of his shoulders: upright, the left
        // arm stuck out straight and stiff and the handle came up to his chin); eased in as he takes the saw, out as he puts it back
        S.lw = Math.max(0, Math.min(1, (S.lw || 0) + (S.ph === 'put' || S.ph === 'done' ? -dt / .6 : dt / .7)));
        bowTo(toWB((XC + HX()) / 2, 0, BD.z), (window.__wsLean ?? .3) * smooth(0, 1, S.lw));
        if (S.hx == null) S.hx = HX();
        // the left hand holds the board's top edge in front of him; after a slide it lets go and takes a new hold (a small lift)
        if (S.ph === 'saw' && S.hx < HX() - .001) { S.rg = (S.rg || 0) + dt / .5; const k = smooth(0, 1, S.rg); S.hxL = S.hxL ?? S.hx; S.hx = S.hxL + (HX() - S.hxL) * k; S.lift = .04 * Math.sin(Math.PI * k); if (k >= 1) { S.hx = HX(); S.hxL = null; S.rg = 0; S.lift = 0; } }
        const hp = () => (S.hpT = toWB(S.hx, BD.y1 + .012 + (S.lift || 0), BD.z));
        if (S.ph === 'take') { const r = sawGeom(Math.max(.012, WB.depth), SREST()); if (take(a, 'benchSaw', 'Right', r.gp, r.tip, r.B, dt, window.__wsTT ?? .9, true)) { S.ph = 'saw'; S.t = 0; S.u = 0; S.amp = null; } reachGrip('Left', hp(), smooth(0, .7, S.t)); return; }
        if (S.ph === 'saw') { // strokes: ~0.85 s each, the push cuts; the stroke is shorter at the start of a cut
          S.u += dt / .85; S.amp = S.amp == null ? .06 : S.amp + ((WB.depth < .02 ? .05 : (window.__wsAmp ?? .08)) - S.amp) * Math.min(1, dt * 1.5); const amp = S.amp; const kin = smooth(0, .6, S.t); const s = kin * (amp * Math.sin(S.u * Math.PI * 2) + (window.__wsSO ?? .05)) + (1 - kin) * SREST(); // the stroke grows in from the rest pose and lengthens smoothly once the kerf has a start
          const push = Math.cos(S.u * Math.PI * 2) > 0; if (push) { WB.depth = Math.min(BD.y1 - BD.y0, WB.depth + dt * .045); layout(); }
          const r = sawGeom(WB.depth, s); S.gpT = r.gp; holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B));
          reachGrip('Left', hp(), 1);
          if (WB.depth >= BD.y1 - BD.y0 - 1e-4 && Math.sin(S.u * Math.PI * 2) < -.9) { dropOffcut(); S.cuts++; S.ph = 'look'; S.t = 0; S.last = r; }
          else if (S.finish && WB.depth >= .016 && Math.sin(S.u * Math.PI * 2) < -.9) { S.ph = 'put'; S.t = 0; }
          return; }
        if (S.ph === 'look') { // the offcut falls: the saw stays still in the cut, he watches it land
          const r = S.last; holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B)); reachGrip('Left', hp(), 1);
          if (S.t > 1.1) { if (S.cuts >= S.want || WB.xR - OFF - XC < .3) S.finish = true; S.ph = 'slide'; S.t = 0; S.x0 = WB.xR; S.hx0 = S.hx; } return; }
        if (S.ph === 'slide') { // the left hand pushes the board along the jaws by one offcut; the saw is lifted out, held just above
          const k = smooth(0, 1.3, S.t); const sl = OFF * k; WB.xR = S.x0; layout(sl); const r = sawGeom(-.03 * Math.sin(Math.PI * k) - .005, SREST() - .02);
          holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt('Right', 'benchSaw', r.gp, r.tip, 1, r.B));
          S.hx = S.hx0 - sl; reachGrip('Left', hp(), 1);
          if (k >= 1) { WB.xR = S.x0 - OFF; WB.depth = 0; layout(); S.ph = 'saw'; S.u = .75; S.t = 0; } return; }
        if (S.ph === 'put') { sawRest(); reachGrip('Left', hp(), 1 - smooth(0, .5, S.t)); if (put(a, 'benchSaw', 'Right', dt)) { S.ph = 'done'; a.T = 1e9; g && g.free('Left'); g && g.free('Right'); } return; }
      },
      end: a => { const g = G(); if (g) { g.free('Left'); g.free('Right'); } if (H.hold.Right && H.hold.Right.tool === 'benchSaw') { sawRest(); relTool('Right', 'benchSaw', .3); } a.held.length = 0; },
      result: () => ({ ok: true, cuts: S.cuts }) });
  }


  // the pose a tool rests in at home, as (grip point, tip, second axis) in the world
  function homeGrip(name) { const P = PP(); const o = P.tools[name]; const h = o && o.userData.home; const sp = G() && G().GRIP[name]; if (!h || !sp) return null; h.parent.updateMatrixWorld(true);
    const M = new THREE.Matrix4().compose(h.pos, h.quat, V(1, 1, 1).multiplyScalar(h.scale || 1)).premultiply(h.parent.matrixWorld); const q = Q(); M.decompose(V(), q, V());
    const gp = V(...sp.g).applyMatrix4(M); return { gp, tip: gp.clone().add(V(...sp.a).applyQuaternion(q)), B: V(...sp.b).applyQuaternion(q) }; }
  // a small tool of our own on the bench: knife (blade +x, edge on y 0, spine +y) or screwdriver (shaft +x)
  function makeTool(name) { const P = PP(); if (!P || !P.tools) return null; if (P.tools[name]) return P.tools[name]; const g = new THREE.Group(); g.name = name;
    const steel = new THREE.MeshStandardMaterial({ color: 0xB4B8BC, metalness: .35, roughness: .4 }); let spec;
    if (name === 'benchKnife') { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(.12, 0); sh.quadraticCurveTo(.15, .006, .16, .024); sh.lineTo(0, .026); sh.lineTo(0, 0);
      g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: .002, bevelEnabled: false }), steel)); g.children[0].position.z = -.001;
      const hd = new THREE.Mesh(new THREE.BoxGeometry(.1, .024, .018), new THREE.MeshStandardMaterial({ color: 0x4A2A16, roughness: .55 })); hd.position.set(-.05, .013, 0); g.add(hd);
      spec = { g: [-.05, .013, 0], a: [1, 0, 0], A: 'T', b: [0, 1, 0], B: 'F', tilt: .3 }; }
    else { const hd = new THREE.Mesh(new THREE.CylinderGeometry(.013, .011, .09, 12), new THREE.MeshStandardMaterial({ color: 0xB8331E, roughness: .5 })); hd.rotation.z = Math.PI / 2; hd.position.x = -.045; g.add(hd);
      const sf = new THREE.Mesh(new THREE.CylinderGeometry(.0032, .0032, .1, 8), steel); sf.rotation.z = Math.PI / 2; sf.position.x = .05; g.add(sf);
      spec = { g: [-.045, 0, 0], a: [1, 0, 0], A: 'T', b: [0, 1, 0], B: 'F', tilt: .25 }; }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.userData = { live: true, grip: V(...spec.g) }; scene.add(g); P.tools[name] = g; if (K.P3 && K.P3.tools && K.P3 !== P) K.P3.tools[name] = g;
    const gr = G(); if (gr && gr.GRIP) gr.GRIP[name] = spec; return g; }
  function lieOnBench(name, lx, lz, yaw) { const o = makeTool(name); if (!o || o.parent !== scene) return; const b = bench(); const p = toW(lx, .9, lz); const q = Q().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)); q.premultiply(Q().setFromAxisAngle(V(0, 1, 0), yaw + b.rotation.y));
    const lift = name === 'benchKnife' ? .009 : .013; p.y += lift; o.position.copy(p); o.quaternion.copy(q); o.userData.home = { parent: scene, pos: p.clone(), quat: q.clone(), scale: 1 }; }
  const standFor = (lx) => () => bench() ? toW(lx, 0, .55).add(V(0, 1, 0)) : null;
  const hold = (side, name, r, g) => { holdToolAt(side, name, r.gp, r.tip, 1, r.B); if (g && g.late) g.late(() => holdToolAt(side, name, r.gp, r.tip, 1, r.B)); };

  // ================= SHARPEN: a knife on the whetstone =================
  // right hand on the handle, the blade flat on the stone at ~15 deg, long strokes along the stone; two fingers of the left
  // hand press on the blade; now and then he lifts it, looks along the edge, and goes on
  function sharpen(o) {
    const ST = () => { const P = PP(); return P && P.point ? P.point('whetstone') : null; }; // top of the stone
    const setup = () => { if (!bench()) return; trimObst(); lieOnBench('benchKnife', -.03 + RS() * .3, .25, .5); };
    setup(); const S = { ph: 'take', t: 0, n: 0, u: 0, want: Math.round(rnd(3, 5)) };
    const geom = (s, lift = 0) => { const c = ST(); const fw = dirW(0, 0, -1), rt = dirW(RS(), 0, 0), up = V(0, 1, 0); // his right
      const W = fw.clone().multiplyScalar(.75).addScaledVector(rt, -.66).normalize(); // blade points forward and to his left, across the stone
      const tilt = .26; const nrm = W.clone().cross(up).normalize(); // horizontal, perpendicular to the blade
      const B = up.clone().multiplyScalar(Math.sin(tilt)).addScaledVector(nrm, -Math.cos(tilt)).normalize(); if (B.dot(fw) > 0) B.addScaledVector(nrm, 2 * Math.cos(tilt)).normalize();
      const C = c.clone().add(dirW(s, 0, 0)).add(V(0, .001 + lift, 0)); const gp = C.clone().addScaledVector(W, -.13).addScaledVector(B, .013); return { gp, tip: gp.clone().add(W), B, C, W }; };
    return job({ pt: () => { const c = ST(); return c ? c.clone().add(dirW(RS() * .04, 0, .3)) : null; }, stand: .03, dur: [600, 600], vary: false, tools: [],
      start: () => setup(), look: () => S.lookAt || ST(), lookW: .9, tick: () => { H.face = benchYaw(); },
      post: (a, dt) => { S.t += dt; const g = G();
        if (S.ph === 'take') { const r = homeGrip('benchKnife'); if (!r || take(a, 'benchKnife', 'Right', r.gp, r.tip, r.B, dt)) { S.ph = 'onto'; S.t = 0; } return; }
        if (S.ph === 'onto') { const k = smooth(0, .6, S.t); const r0 = homeGrip('benchKnife'), r = geom(-.07, .03 * (1 - k)); hold('Right', 'benchKnife', r, g); if (k >= 1) { S.ph = 'stroke'; S.t = 0; S.u = .75; } return; }
        if (S.ph === 'stroke') { S.u += dt / 1.15; const s = .075 * Math.sin(S.u * Math.PI * 2); const r = geom(s); hold('Right', 'benchKnife', r, g); S.lookAt = r.C;
          const lw = smooth(0, .5, S.t); handTo('Left', r.C.clone().addScaledVector(r.W, .02).add(V(0, .025, 0)), lw * .95); flatHand('Left', r.W.clone().add(V(0, -.25, 0)), V(0, -1, 0), lw); handTo('Left', r.C.clone().addScaledVector(r.W, .02).add(V(0, .025, 0)), lw);
          const n = Math.floor(S.u); if (n !== S.lastN) { S.lastN = n; S.n++; AU('sharpen', r.C); if (S.n % 9 === 0) { S.ph = 'check'; S.t = 0; S.n2 = (S.n2 || 0) + 1; } } return; }
        if (S.ph === 'check') { // lift the knife, turn the edge to the light and look along it
          const k = smooth(0, .7, S.t) * (1 - smooth(2.3, 3, S.t)); const r = geom(0); const eye = bones.Head.getWorldPosition(V()); const fw = dirW(0, 0, -1);
          const gpU = eye.clone().addScaledVector(fw, .3).add(V(0, -.18, 0)).add(dirW(RS() * .08, 0, 0)); const W2 = fw.clone().addScaledVector(dirW(RS(), 0, 0), -.4).add(V(0, .35, 0)).normalize();
          const gp = r.gp.clone().lerp(gpU, k), W = r.W.clone().lerp(W2, k).normalize(); const B = r.B.clone().lerp(V(0, 1, 0), k).normalize(); hold('Right', 'benchKnife', { gp, tip: gp.clone().add(W), B }, g);
          S.lookAt = gp.clone().addScaledVector(W, .1); if (S.t > 3) { S.ph = S.n2 >= S.want / 2 + 1 ? 'put' : 'stroke'; S.t = 0; S.u = .75; } return; }
        if (S.ph === 'put') { if (put(a, 'benchKnife', 'Right', dt)) { S.ph = 'done'; a.T = 1e9; } return; }
      },
      end: a => { const g = G(); if (g) { g.free('Left'); g.free('Right'); } if (H.hold.Right && H.hold.Right.tool === 'benchKnife') relTool('Right', 'benchKnife', .3); a.held.length = 0; },
      result: () => ({ ok: true }) });
  }

  // ================= FIX THE LANTERN =================
  // the lantern stands at the bench's front edge; the left hand steadies it by the bail, the right turns screws on its frame
  // with a screwdriver (the hand rolls the shaft), then he lifts it by the bail to eye level, the flame catches, he looks,
  // sets it down where it stood and puts the screwdriver back
  let FLAME = null;
  function flame(on) { const P = PP(); const L = P && P.tools && P.tools.lantern; if (!L) return; if (!FLAME) { FLAME = new THREE.Mesh(new THREE.SphereGeometry(.012, 10, 8), new THREE.MeshBasicMaterial({ color: 0xFFC060 })); FLAME.scale.set(1, 1.8, 1); FLAME.position.set(0, .075, 0); L.add(FLAME); } FLAME.visible = !!on; }
  function fixlamp(o) {
    const LP = () => { const P = PP(); const L = P && P.tools && P.tools.lantern; if (!L) return null; L.updateMatrixWorld(true); return L; };
    const setup = () => { if (!bench()) return; trimObst(); lieOnBench('benchDriver', .7 + RS() * .16, .29, .4); flame(false); };
    setup(); const S = { ph: 'take', t: 0, screw: 0, u: 0 };
    const screwAt = i => { const L = LP(); const c = [[.045, .07, .045], [-.045, .07, .045], [.045, .12, .045], [-.045, .12, .045]][i % 4]; return L.localToWorld(V(c[0] * .75 / .75, c[1], c[2])); };
    const drv = (P0, roll) => { const fw = dirW(0, 0, -1); const W = fw.clone().addScaledVector(dirW(-RS(), 0, 0), .35).add(V(0, -.25, 0)).normalize(); const up = V(0, 1, 0); let B = up.clone().sub(W.clone().multiplyScalar(up.dot(W))).normalize();
      B.applyAxisAngle(W, roll); const gp = P0.clone().addScaledVector(W, -.148); return { gp, tip: gp.clone().add(W), B }; };
    const bail = () => { const L = LP(); return L ? L.localToWorld(V(0, .245, 0)) : null; };
    return job({ pt: () => { const L = LP(); return L ? L.getWorldPosition(V()).add(dirW(RS() * .12, 0, .32)) : null; }, stand: .03, dur: [600, 600], vary: false, tools: [],
      start: () => setup(), look: () => S.lookAt || (LP() && LP().getWorldPosition(V()).add(V(0, .1, 0))), lookW: .9, tick: () => { H.face = benchYaw(); },
      post: (a, dt) => { S.t += dt; const g = G(); const L = LP(); if (!L) { a.T = 1e9; return; }
        const steady = w => { const b = bail(); if (g) g.hold('Left', L, () => bail()); handTo('Left', b, w); };
        if (S.ph === 'take') { const r = homeGrip('benchDriver'); if (!r || take(a, 'benchDriver', 'Right', r.gp, r.tip, r.B, dt)) { S.ph = 'to'; S.t = 0; } steady(smooth(.2, .9, S.t)); return; }
        if (S.ph === 'to') { const k = smooth(0, .6, S.t); const r = drv(screwAt(S.screw).add(V(0, 0, 0)).addScaledVector(dirW(0, 0, 1), .04 * (1 - k)), 0); if (S.last && !window.__noScrewGlide) { if (!S.fromD) S.fromD = S.last.gp.clone().sub(r.gp); const d = S.fromD.clone().multiplyScalar(1 - k); r.gp.add(d); r.tip.add(d); } /* from the last screw the driver glides to the next one (it jumped 9 cm there in one frame: gate fixlamp RightHand jump) */ hold('Right', 'benchDriver', r, g); steady(1); S.lookAt = screwAt(S.screw); if (k >= 1) { S.ph = 'turn'; S.t = 0; S.u = 0; S.fromD = null; } return; }
        if (S.ph === 'turn') { S.u += dt; const roll = .9 * Math.sin(S.u * Math.PI * 2 / .9); const r = drv(screwAt(S.screw), roll); hold('Right', 'benchDriver', r, g); steady(1); S.lookAt = screwAt(S.screw); S.last = r;
          if (S.u > rnd(4, 6) && S.u > 4 && (window.__noScrewGlide || Math.abs(roll) < .15)) {/* the wrist turns back to its middle before the driver leaves the screw (the roll snapped back to 0 with it) */ S.screw++; S.ph = S.screw >= 3 ? 'away' : 'to'; S.t = 0; } return; }
        if (S.ph === 'away') { // the screwdriver comes back a little and rests in the hand, low
          const k = smooth(0, .6, S.t); const r = drv(screwAt(S.screw - 1).addScaledVector(dirW(0, 0, 1), .12 * k).add(V(0, -.05 * k, 0)), 0); hold('Right', 'benchDriver', r, g); steady(1); if (k >= 1) { S.ph = 'lift'; S.t = 0; S.r = r; } return; }
        if (S.ph === 'lift') { hold('Right', 'benchDriver', S.r, g); const r0 = homeGrip('lantern'); if (!r0 || take(a, 'lantern', 'Left', r0.gp, r0.tip, r0.B, dt, .4)) { S.ph = 'look'; S.t = 0; S.base = homeGrip('lantern'); } return; }
        if (S.ph === 'look') { hold('Right', 'benchDriver', S.r, g); const k = smooth(0, .9, S.t) * (1 - smooth(3.4, 4.3, S.t)); const eye = bones.Head.getWorldPosition(V());
          const up = S.base.gp.clone().lerp(eye.clone().addScaledVector(dirW(0, 0, -1), .3).add(V(0, -.12, 0)).add(dirW(-RS() * .06, 0, 0)), k); hold('Left', 'lantern', { gp: up, tip: up.clone().add(V(0, -1, 0)), B: S.base.B }, g);
          S.lookAt = up.clone().add(V(0, -.15, 0)); if (S.t > 1.2 && !S.lit) { S.lit = 1; flame(true); AU('match', up); } if (S.t > 3.3 && S.lit === 1) { S.lit = 2; flame(false); }
          if (S.t >= 4.3) { S.ph = 'setL'; S.t = 0; } return; }
        if (S.ph === 'setL') { hold('Right', 'benchDriver', S.r, g); if (put(a, 'lantern', 'Left', dt)) { S.ph = 'putR'; S.t = 0; } return; }
        if (S.ph === 'putR') { if (put(a, 'benchDriver', 'Right', dt)) { S.ph = 'done'; a.T = 1e9; } return; }
      },
      end: a => { const g = G(); if (g) { g.free('Left'); g.free('Right'); } flame(false); for (const [sd, n] of [['Right', 'benchDriver'], ['Left', 'lantern']]) if (H.hold[sd] && H.hold[sd].tool === n) relTool(sd, n, .3); a.held.length = 0; },
      result: () => ({ ok: true }) });
  }

  // ================= CHOP: slicing a carrot on the kitchen board =================
  // he takes the kitchen knife from beside the board, the left hand holds the carrot in a claw just behind the cut,
  // the knife rocks on its tip: handle up, edge down through the carrot onto the board; slice after slice the cut and the
  // claw creep along the carrot; then the knife goes back where it lay
  function chop(o) {
    const BO = () => { const P = PP(); const b = P && P.tools && P.tools.board; if (b) b.updateMatrixWorld(true); return b; };
    const S = { ph: 'take', t: 0, u: 0, cut: 0, n: 0 };
    const frame = () => { const b = BO(); const c = b.localToWorld(V(-.025, .028, .045)); const ax = V(1, 0, 0).applyQuaternion(b.getWorldQuaternion(Q())).setY(0).normalize();
      const p = root.position; const fw = V(c.x - p.x, 0, c.z - p.z).normalize(); const r = bones.RightArm.getWorldPosition(V()).sub(bones.LeftArm.getWorldPosition(V())).setY(0).normalize();
      if (ax.dot(r) < 0) ax.negate(); return { c, ax, fw }; }; // ax: along the carrot toward his right hand
    const geom = th => { const F = frame(); const C = F.c.clone().addScaledVector(F.ax, .05 - S.cut); const up = V(0, 1, 0);
      const W = F.fw.clone().multiplyScalar(Math.cos(th)).addScaledVector(up, -Math.sin(th)).normalize(); const U = up.clone().multiplyScalar(Math.cos(th)).addScaledVector(F.fw, Math.sin(th)).normalize();
      const T = C.clone().addScaledVector(F.fw, .07); const gp = T.clone().addScaledVector(W, -.19).addScaledVector(U, .015 + .002); return { gp, tip: gp.clone().add(W), B: U.clone().negate(), C, F }; };
    return job({ pt: () => { const P = PP(); return P && P.point ? P.point('board') : null; }, stand: .36, dur: [600, 600], vary: false, tools: [],
      look: () => S.lookAt || (BO() && BO().getWorldPosition(V())), lookW: .9,
      post: (a, dt) => { S.t += dt; const g = G(); if (!BO()) { a.T = 1e9; return; }
        const claw = w => { const r = geom(0); handTo('Left', r.C.clone().addScaledVector(r.F.ax, -.05).add(V(0, .045, 0)).addScaledVector(r.F.fw, .01), w); if (g) g.hold('Left', BO(), null); };
        if (S.ph === 'take') { const r = homeGrip('knife'); if (!r || take(a, 'knife', 'Right', r.gp, r.tip, r.B, dt)) { S.ph = 'to'; S.t = 0; } claw(smooth(.3, 1, S.t)); return; }
        if (S.ph === 'to') { const k = smooth(0, .5, S.t); const r = geom(.35 * k + .0); hold('Right', 'knife', r, g); claw(1); if (k >= 1) { S.ph = 'chop'; S.t = 0; S.u = 0; } return; }
        if (S.ph === 'chop') { // one slice every ~0.45 s: the edge comes down fast and lifts slower
          S.u += dt / .45; const ph = S.u % 1; const th = ph < .35 ? .35 * (1 - smooth(0, .35, ph)) : .35 * smooth(.45, 1, ph); const r = geom(th); hold('Right', 'knife', r, g); claw(1); S.lookAt = r.C;
          const n = Math.floor(S.u); if (n !== S.n && ph > .3) { S.n = n; S.cut += .006; AU('chop', r.C); if (S.cut > .075) { S.ph = 'push'; S.t = 0; } } return; }
        if (S.ph === 'push') { // the slices are pushed aside with the flat of the blade, the claw goes back to the start of the carrot
          const k = smooth(0, .8, S.t); const th = .35 * (1 - Math.sin(Math.PI * k) * .5); const r = geom(th); r.gp.addScaledVector(r.F.ax, -.06 * Math.sin(Math.PI * k)); r.tip.addScaledVector(r.F.ax, -.06 * Math.sin(Math.PI * k)); hold('Right', 'knife', r, g);
          if (k >= 1) { S.cut = 0; S.rounds = (S.rounds || 0) + 1; S.ph = S.rounds >= 3 ? 'put' : 'chop'; S.t = 0; S.u = 0; } claw(1); return; }
        if (S.ph === 'put') { claw(1 - smooth(0, .5, S.t)); if (put(a, 'knife', 'Right', dt)) { S.ph = 'done'; a.T = 1e9; } return; }
      },
      end: a => { const g = G(); if (g) { g.free('Left'); g.free('Right'); } if (H.hold.Right && H.hold.Right.tool === 'knife') relTool('Right', 'knife', .3); a.held.length = 0; },
      result: () => ({ ok: true }) });
  }

  // ================= HAMMER (craft): nailing a plank onto a crossbar at the bench =================
  // the hammer lies at the front edge; he takes it, the left hand holds the nail for the first light taps, then flattens on
  // the plank beside it; the swing turns round a point a forearm behind the grip, in the vertical plane through his right
  // shoulder (the hand never comes above the shoulder or in front of the face), the face lands square on the nail head and
  // the nail sinks a little with each blow; three or four nails, then the hammer goes back where it lay
  let CR = null;
  function buildCraft() { if (CR) return CR; const b = bench(); if (!b) return null; const rs = RS();
    let map = null; b.traverse(o => { if (!map && o.isMesh && o.material && o.material.map) map = o.material.map; });
    const wood = new THREE.MeshStandardMaterial({ color: map ? 0xE8C9A0 : 0xC89A63, roughness: .8, map }); const iron = new THREE.MeshStandardMaterial({ color: 0x8E9196, metalness: .4, roughness: .45 });
    const g = new THREE.Group(); g.name = 'wsCraft'; b.add(g); if (rs < 0) { g.scale.x = -1; } // built for his right hand at +x
    const bar = new THREE.Mesh(new THREE.BoxGeometry(.07, .035, .26), wood); bar.position.set(.67, .9 + .0175, .2); bar.visible = false; const pl = new THREE.Mesh(new THREE.BoxGeometry(.34, .02, .1), wood); pl.position.set(.66, .9 + .01, .28); // flat on the top: he is small (shoulder 26 cm over the bench), a raised piece put his fist above the shoulder
    for (const m of [bar, pl]) { m.castShadow = true; m.receiveShadow = true; g.add(m); }
    const nails = []; for (const x of [.645, .69, .62, .71]) { const n = new THREE.Group(); const sh = new THREE.Mesh(new THREE.CylinderGeometry(.0018, .0018, .05, 6), iron); sh.position.y = .025; const hd = new THREE.Mesh(new THREE.CylinderGeometry(.0045, .0045, .0015, 10), iron); hd.position.y = .05; n.add(sh, hd); n.position.set(x, .9, .28 + (nails.length % 2 ? -.018 : .012)); n.visible = false; g.add(n); nails.push({ o: n, sunk: 0 }); }
    CR = { g, nails, top: .92 }; return CR; }
  const toWC = (x, y, z) => { const sx = CR && CR.g.scale.x < 0 ? -1 : 1; return toW(x * sx, y, z); };
  // the bench hammer lives on the bench's front edge from the moment the world loads (its peg on the toolwall is out of his
  // reach): placed once, before anyone can see it, so no task ever makes it fly from the wall to the bench without a hand
  let hamPlaced = false;
  function hammerOnBench() { if (hamPlaced) return true; const P = PP(); const hm = P && P.tools && P.tools.benchHammer; if (!bench() || !G() || !G().GRIP || !hm || hm.parent !== scene || !buildCraft()) return false;
    const gp = toWC(.72, .9 + .022, .318); restPose('benchHammer', gp, dirW(-RS(), 0, 0), dirW(0, 0, -1)); hamPlaced = true; return true; }
  { let tries = 0; const poll = () => { try { if (hammerOnBench()) return; } catch (e) { } if (++tries < 600) setTimeout(poll, 100); }; setTimeout(poll, 0); }
  function craft(o) {
    const setup = () => { if (!buildCraft()) return; trimObst(); hammerOnBench(); }; // the hammer already lies on the bench since load: nothing moves here
    setup(); const S = { ph: 'take', t: 0, ni: 0, hits: 0 };
    const nailHead = i => { const n = CR.nails[i]; return toWC(n.o.position.x, n.o.position.y + .05 - n.sunk, n.o.position.z); };
    // strike geometry: face (+b) down on the nail, handle (a) horizontal pointing forward from the hand; phi lifts it round the pivot
    const swing = (N, phi) => { const fw = dirW(0, 0, -1), up = V(0, 1, 0); const k = fw.clone().cross(up).normalize(); // turning +phi about k lifts the head up and back
      const W0 = fw.clone().add(V(0, -.03, 0)).normalize(), B0 = up.clone().negate(); const H0 = N.clone().addScaledVector(B0, -.1025); const gp0 = H0.clone().addScaledVector(W0, -.24);
      const piv = gp0.clone().addScaledVector(fw, -(window.__wsPiv ?? .2)).add(V(0, .02, 0)); const q = Q().setFromAxisAngle(k, phi);
      const gp = piv.clone().add(gp0.clone().sub(piv).applyQuaternion(q)).addScaledVector(dirW(RS(), 0, 0), (window.__wsOut ?? .18) * Math.min(1, phi / .25)); const W = W0.clone().applyQuaternion(q), B = B0.clone().applyQuaternion(q); return { gp, tip: gp.clone().add(W), B }; };
    // HARD LIMIT (whatever touches the arm later): the hammer head stays in front of the shoulder plane by 18 cm, below the chin,
    // and at least 22 cm from the head; the pose is shifted (never rotated) to satisfy it, so the strike line is kept
    const guardFace = r => { const hd = bones.Head.getWorldPosition(V()); const ls = bones.LeftArm.getWorldPosition(V()), rsh = bones.RightArm.getWorldPosition(V()); const mid = ls.clone().add(rsh).multiplyScalar(.5);
      const fw = V(0, 0, 1).applyQuaternion(K.root.getWorldQuaternion(Q())); fw.y = 0; fw.normalize(); const W = r.tip.clone().sub(r.gp).normalize(); const head = r.gp.clone().addScaledVector(W, .24);
      const sh = V(); const inF = head.clone().sub(mid).dot(fw); if (inF < .18) sh.addScaledVector(fw, .18 - inF);
      const chin = hd.y - .02; if (head.y + sh.y > chin - .04) sh.y -= head.y + sh.y - (chin - .04);
      const hh = head.clone().add(sh); const dx = hh.clone().sub(hd); dx.y = 0; const dl = dx.length(); if (dl < .22) { const o = dl > 1e-4 ? dx.multiplyScalar(1 / dl) : dirW(RS(), 0, 0); sh.addScaledVector(o, .22 - dl); }
      if (sh.lengthSq() > 0) { r.gp.add(sh); r.tip.add(sh); } H.wsGuard = sh.length(); return r; };
    return job({ pt: () => { if (!buildCraft()) return null; return toWC(window.__wsSX ?? .45, 0, .66).add(V(0, 1, 0)); }, stand: .03, dur: [600, 600], vary: false, tools: [],
      start: () => setup(), look: () => S.lookAt || (CR && nailHead(0)), lookW: .9, tick: () => { H.face = benchYaw() + (window.__wsTurnH ?? 0) * RS(); },
      post: (a, dt) => { S.t += dt; const g = G(); if (!CR) { a.T = 1e9; return; }
        const n = CR.nails[S.ni]; const N = n ? nailHead(S.ni) : null; S.lookAt = N || S.lookAt;
        const leftOn = (w, onNail) => { const p = onNail && N ? N.clone().add(V(0, -.03, 0)).addScaledVector(dirW(0, 0, 1), .025) : toWC(.53, .92 + .03, .28); handTo('Left', p, w); if (g) g.hold('Left', CR.g, null); };
        if (S.ph === 'take') { const r = homeGrip('benchHammer'); if (!r || take(a, 'benchHammer', 'Right', r.gp, r.tip, r.B, dt)) { S.ph = 'set'; S.t = 0; } leftOn(smooth(.3, 1, S.t), false); return; }
        if (S.ph === 'set') { // a nail from the plank's edge is stood on its point; the hammer waits low
          if (!n) { S.ph = 'put'; S.t = 0; return; } if (S.t > .4 && !n.o.visible) { n.o.visible = true; n.sunk = 0; }
          const r = guardFace(swing(N, (window.__wsTop ?? .25) * .8)); hold('Right', 'benchHammer', r, g); leftOn(1, true); if (S.t > .9) { S.ph = 'swing'; S.t = 0; S.hits = 0; S.u = 0; } return; }
        if (S.ph === 'swing') { // light taps first (the fingers hold the nail), then full blows (the hand flat on the plank)
          const full = S.hits >= 2, T = full ? .7 : .5, top = full ? (window.__wsTop ?? .25) : .35; S.u += dt / T; const u = S.u % 1;
          const phi = u < .55 ? top * smooth(0, .55, u) : u < .62 ? top : u < .8 ? top * (1 - Math.pow((u - .62) / .18, 2)) : 0; hold('Right', 'benchHammer', guardFace(swing(N, Math.max(0, phi))), g);
          leftOn(1, !full); const c = Math.floor(S.u + .2); if (u >= .8 && S.hc !== Math.floor(S.u)) { S.hc = Math.floor(S.u); S.hits++; n.sunk = Math.min(.028, n.sunk + (full ? .008 : .004));
            try { window.__audio && window.__audio.contact ? window.__audio.contact({ tool: 'hammer', kind: 'hit', pos: N.toArray(), strength: full ? rnd(.7, 1) : .35 }) : AU('hammer', N); } catch (e) { }
            if (n.sunk >= .028) { S.ni++; S.ph = S.ni >= 3 ? 'rest' : 'set'; S.t = 0; } } void c; return; }
        if (S.ph === 'rest') { hold('Right', 'benchHammer', guardFace(swing(nailHead(S.ni - 1), .4)), g); leftOn(1 - smooth(.6, 1.2, S.t), false); if (S.t > 1.3) { S.ph = 'put'; S.t = 0; } return; }
        if (S.ph === 'put') { if (put(a, 'benchHammer', 'Right', dt)) { S.ph = 'done'; a.T = 1e9; } return; }
      },
      end: a => { const g = G(); if (g) { g.free('Left'); g.free('Right'); } if (H.hold.Right && H.hold.Right.tool === 'benchHammer') relTool('Right', 'benchHammer', .3); a.held.length = 0;
        if (CR) for (const n of CR.nails) { if (n.sunk < .028) n.o.visible = false; } }, // a nail left half in is pulled again next time
      result: () => ({ ok: true }) });
  }

  return { saw, sharpen, fixlamp, chop, craft, tick: tickOffcuts, setupSaw, layoutDbg: () => WB, sawGeom: (d, s) => sawGeom(d, s) };
}
