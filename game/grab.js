// Hand contact (the "Дать герою настоящие касания руками" thread).
// What the hero moves (hatch lid, doors, bolt, oven door, fridge, buckets, tools...) moves only while a hand holds it.
// This module keeps the register of what each hand is holding right now, so other systems treat the grip as a grip:
//  - collide.js does not push a hand out of the very thing it holds (the palm on a ring sits on the lid's boards);
//  - the probe (tests/grab/probe.js) measures palm-to-handle distance while the handle moves.
// API: window.__grab = { hold(side, obj, handleFn), free(side|obj), held(o3d) -> side|null, palm(side, out), dist(side) }
export function createGrab({ THREE, bones }) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const grip = { Left: null, Right: null }; // {obj, handle}
  const PALM = .06;
  function palm(side, out = V()) { const h = bones[side + 'Hand'], f = bones[side + 'ForeArm']; if (!h || !f) return null; h.getWorldPosition(out); const fa = f.getWorldPosition(V()); return out.add(out.clone().sub(fa).setLength(PALM)); }
  // ---- closed hands: the hero's skeleton has no finger bones, so a fist is a morph built here from the hand's own vertices.
  // In hand-bone space the fingers run along +y and the palm faces the thumb side (x); every vertex past the knuckles is bent
  // round an axis across the hand (z) like a real finger curling, more the further out it is, so the hand closes round a handle.
  const FIST = []; // {mesh, idx:{Left,Right}}
  const fistK = { Left: 0, Right: 0 }, fistT = { Left: 0, Right: 0 };
  const CH = { Left: null, Right: null }; // the grip channel (hand-bone space): centre of the closed fingers, axis z
  function buildFists(root) {
    root.traverse(o => { if (!o.isSkinnedMesh || !o.skeleton || /eyelid/i.test(o.name)) return; const sk = o.skeleton, g = o.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight; if (!P || !SI || !SW) return;
      const idx = {}; const bindInv = o.bindMatrix.clone().invert();
      for (const side of ['Left', 'Right']) { const bi = sk.bones.findIndex(b => new RegExp(side + 'Hand$').test(b.name)); if (bi < 0) continue;
        const inv = sk.boneInverses[bi], bind = inv.clone().invert(); const vs = []; const v = V();
        for (let i = 0; i < P.count; i++) { const ws = [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)], is = [SI.getX(i), SI.getY(i), SI.getZ(i), SI.getW(i)]; let w = 0; for (let k = 0; k < 4; k++) if (is[k] === bi) w += ws[k]; if (w < .05) continue;
          v.fromBufferAttribute(P, i).applyMatrix4(o.bindMatrix).applyMatrix4(inv); vs.push([i, v.x, v.y, v.z, w]); }
        if (vs.length < 30) continue;
        const med = a => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
        const core = vs.filter(q => q[4] > .3); const ymax = Math.max(...core.map(q => q[2]));
        const tipC = med(core.filter(q => q[2] > ymax * .75).map(q => q[1])); const mid = core.filter(q => q[2] > ymax * .28 && q[2] < ymax * .62);
        const ext = mid.length ? [tipC - Math.min(...mid.map(q => q[1])), Math.max(...mid.map(q => q[1])) - tipC] : [1, 0];
        const ps = ext[0] > ext[1] ? -1 : 1, mx = tipC; // the palm (thumb) side along x: the thumb sticks out further than the back of the hand
        const thumb = vs.filter(q => (q[1] - mx) * ps > .025 && q[2] < ymax * .7);
        const k0 = ymax * .56; // knuckles
        const fing = vs.filter(q => q[2] > k0); const xn = fing.length ? med(fing.map(q => q[1])) : mx; const Lf = Math.max(.03, ymax - k0);
        const TH = 3.5, R = Lf / TH; // total curl (rad) and the radius the fingers roll round
        const tz = thumb.length ? thumb.reduce((a, q) => a + q[3], 0) / thumb.length : 0; // thumb (index) end of the hand along z
        CH[side] = { c: V(xn + ps * R * 1.05, k0 + R * .35, 0), ps, iz: Math.sign(tz) || 1, R };
        const d = new Float32Array(P.count * 3); const out = V(); const geo = V();
        for (const [i, x, y, z, w] of vs) { let nx = x, ny = y, nz = z;
          if (y > k0 && (x - mx) * ps < .022) { const s = y - k0, phi = s / R * Math.min(1, s / .012 + .4); const dd = (x - xn) * -ps; const rho = R + dd;
            nx = xn + ps * R - ps * rho * Math.cos(phi); ny = k0 + rho * Math.sin(phi); nx = xn + ps * (R - rho * Math.cos(phi)); }
          else if ((x - mx) * ps >= .022 && y > .03) { // the thumb comes over the closed fingers
            const a = .7 * Math.min(1, (y - .03) / .06); const cz = z * Math.cos(a) - (x - xn) * ps * Math.sin(a) * .3; nz = z + (-(tz > 0 ? 1 : -1) * .012) * a; nx = x - ps * .01 * a; void cz; }
          out.set(nx, ny, nz).applyMatrix4(bind).applyMatrix4(bindInv); geo.fromBufferAttribute(P, i); const ww = Math.min(1, w * 1.15);
          d[i * 3] = (out.x - geo.x) * ww; d[i * 3 + 1] = (out.y - geo.y) * ww; d[i * 3 + 2] = (out.z - geo.z) * ww; }
        const rel = g.morphTargetsRelative || !g.morphAttributes.position; let arr = d; if (!rel) { arr = new Float32Array(P.count * 3); for (let i = 0; i < arr.length; i++) arr[i] = P.array[i] + d[i]; }
        g.morphAttributes.position = g.morphAttributes.position || []; if (!g.morphAttributes.position.length) g.morphTargetsRelative = true;
        const at = new THREE.BufferAttribute(arr, 3); at.name = 'fist' + side; idx[side] = g.morphAttributes.position.length; g.morphAttributes.position.push(at); }
      if (Object.keys(idx).length) { const keep = o.morphTargetInfluences ? o.morphTargetInfluences.slice() : []; o.updateMorphTargets(); keep.forEach((v, i) => { o.morphTargetInfluences[i] = v; });
        const mats = Array.isArray(o.material) ? o.material : [o.material]; mats.forEach(m => { m.needsUpdate = true; }); FIST.push({ mesh: o, idx }); } });
  }
  // per frame: each hand closes while it holds something (a tool on the hand bone, or a grip registered here) and opens after
  function tick(dt, H) { tweens(dt); for (const s of ['Left', 'Right']) { const holds = !!grip[s] || !!(H && H.hold && H.hold[s]) || !!handHasTool(s); fistT[s] = holds ? 1 : 0;
      const r = 1 - Math.exp(-dt * (fistT[s] > fistK[s] ? 14 : 9)); fistK[s] += (fistT[s] - fistK[s]) * r; if (Math.abs(fistT[s] - fistK[s]) < .002) fistK[s] = fistT[s];
      for (const F of FIST) if (F.idx[s] != null) F.mesh.morphTargetInfluences[F.idx[s]] = fistK[s] * (window.__noFist ? 0 : 1); } }
  function handHasTool(s) { const b = bones[s + 'Hand']; if (!b) return false; for (const c of b.children) if (c.visible && (c.isMesh || c.isGroup) && !c.userData.noGrip) return true; return false; }
  // ---- how each tool sits in a closed hand (tool-local): g = the point on the handle the fist closes round, a = the handle's
  // axis pointing to the working end and where that end comes out of the fist (T thumb/index side, K little-finger side,
  // F forward past the knuckles), b + B = a second tool direction and where it faces (F forward, P palm, D back of the hand, T, K),
  // tilt = how far the handle leans from straight across the palm toward the fingers (a knife lies diagonally, a hammer square).
  const GRIP = {
    ladle: { g: [0, .135, -.011], a: [0, -1, 0], A: 'K', b: [0, 0, 1], B: 'F', tilt: .35 },
    hammer: { g: [0, -.085, 0], a: [0, 1, 0], A: 'T', b: [1, 0, 0], B: 'F', tilt: .15 },
    knife: { g: [-.05, 0, 0], a: [1, 0, 0], A: 'T', b: [0, -1, 0], B: 'P', tilt: .75 },
    saw: { g: [-.065, -.06, 0], a: [1, 0, 0], A: 'F', b: [0, 1, 0], B: 'T', tilt: 0, fwd: true },
    plankSaw: { g: [-.11, .075, 0], a: [1, 0, 0], A: 'F', b: [0, 1, 0], B: 'T', tilt: 0, fwd: true },
    axe: { g: [.01, -.58, 0], a: [0, 1, 0], A: 'T', b: [1, 0, 0], B: 'F', tilt: .1 },
    broom: { g: [0, 1.02, 0], a: [0, 1, 0], A: 'T', b: [0, 0, 1], B: 'F', tilt: .1, two: [0, .66, 0] }, // two: where the other hand holds
    pencil: { g: [.0, .0045, 0], a: [1, 0, 0], A: 'F', b: [0, 1, 0], B: 'T', tilt: 0, fwd: true, pinch: true },
    lantern: { g: [0, .24, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },
    waterBucket: { g: [0, .35, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },
    drainBucket: { g: [0, .35, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },
    wateringCan: { g: [-.01, .27, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },
    meatBag: { g: [0, -.02, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },
    bow: { g: [0, 0, .01], a: [0, 1, 0], A: 'T', b: [0, 0, 1], B: 'D', tilt: 0 },
  };
  for (const n of ['benchHammer']) GRIP[n] = GRIP.hammer;
  for (const n of ['wrenchBig', 'wrench1', 'wrench2', 'wrench3', 'wrench4', 'wrench5', 'wrenchLong', 'benchWrench', 'screwdriver1', 'screwdriver2', 'screwdriver3', 'pliers']) GRIP[n] = { g: null, a: [0, 1, 0], A: 'T', b: [1, 0, 0], B: 'F', tilt: .2 };
  function handDir(side, k, out = V()) { const c = CH[side]; const ps = c ? c.ps : (side === 'Right' ? -1 : 1), iz = c ? c.iz : 1;
    return k === 'T' ? out.set(0, 0, iz) : k === 'K' ? out.set(0, 0, -iz) : k === 'F' ? out.set(0, 1, 0) : k === 'P' ? out.set(ps, 0, 0) : k === 'D' ? out.set(-ps, 0, 0) : out.set(0, 1, 0); }
  const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
  function basis(a, b, m) { const x = a.clone().normalize(); const y = b.clone().sub(x.clone().multiplyScalar(b.dot(x))).normalize(); const z = x.clone().cross(y); return m.makeBasis(x, y, z); }
  // rotation + position of a tool on a hand bone so the fist closes round its handle; null when the tool has no grip spec
  function toolPose(name, side, obj) { const G0 = GRIP[name]; const c = CH[side]; if (!G0 || !c) return null;
    let A = handDir(side, G0.A); const F = V(0, 1, 0); if (G0.tilt) A.addScaledVector(F, G0.tilt * (G0.A === 'K' ? 1 : 1)).normalize();
    const B = handDir(side, G0.B); const q = new THREE.Quaternion().setFromRotationMatrix(basis(A, B, _m2).multiply(_m1.copy(basis(V(...G0.a), V(...G0.b), _m1)).transpose()));
    let g = G0.g ? V(...G0.g) : (obj && obj.userData.grip ? obj.userData.grip.clone() : V());
    const at = c.c.clone(); if (G0.fwd) at.y += .01; if (G0.pinch) at.add(V(c.ps * .012, .045, 0));
    return { q, at, g }; }
  // props.js grab(): a tool put on a hand bone goes into the fist by its spec (any offset / rot the caller passes is for an open hand)
  function wrapProps(P) { PROPS = P; if (!P || !P.grab || P.grab.__grab) return; const orig = P.grab;
    const g2 = (name, bone, o = {}) => { const side = bone && /LeftHand$/.test(bone.name) ? 'Left' : bone && /RightHand$/.test(bone.name) ? 'Right' : null;
      const r = orig(name, bone, o); if (!r || !side || window.__noGripFix) return r; const tp = toolPose(name, side, r); if (!tp) return r;
      r.quaternion.copy(tp.q); r.position.copy(tp.at).sub(tp.g.multiplyScalar(r.scale.x).applyQuaternion(tp.q)); r.userData.gripSide = side; return r; };
    g2.__grab = true; P.grab = g2;
    // release(name, {blend}) from a hand: the tool settles onto its hook pivoting round its grip point (the bit the palm holds)
    // instead of its origin flying across; the hand is expected to be there (hero.js lets go only with the palm on the hook)
    const origR = P.release; P.release = (name, o = {}) => { const ob = P.tools && P.tools[name]; const h = ob && ob.userData.home;
      if (!ob || !h || !(o.blend > 0) || window.__noGripFix || !ob.userData.gripSide) { if (ob) delete ob.userData.gripSide; tw.delete(ob); return origR(name, o); }
      const G0 = GRIP[name]; const g = G0 && G0.g ? V(...G0.g) : (ob.userData.grip ? ob.userData.grip.clone() : V()); h.parent.attach(ob); delete ob.userData.gripSide;
      const s0 = ob.scale.x, s1 = h.scale || 1; const gl0 = g.clone().multiplyScalar(s0).applyQuaternion(ob.quaternion).add(ob.position), gl1 = g.clone().multiplyScalar(s1).applyQuaternion(h.quat).add(h.pos);
      tw.set(ob, { name, g, q0: ob.quaternion.clone(), q1: h.quat.clone(), gl0, gl1, s0, s1, t: 0, d: Math.max(.08, o.blend), orig: origR }); };
  }
  const tw = new Map();
  function tweens(dt) { for (const [ob, m] of tw) { m.t = Math.min(1, m.t + dt / m.d); const e = m.t * m.t * (3 - 2 * m.t); ob.quaternion.copy(m.q0).slerp(m.q1, e); const sc = m.s0 + (m.s1 - m.s0) * e; ob.scale.setScalar(sc);
      ob.position.copy(m.gl0).lerp(m.gl1, e).sub(m.g.clone().multiplyScalar(sc).applyQuaternion(ob.quaternion)); if (m.t >= 1) { tw.delete(ob); m.orig(m.name); } } }
  // the fist's grip point in the world (where a held handle's grip point sits), and where a tool's grip point is when it hangs at home
  function gripPoint(side, out = V()) { const c = CH[side], b = bones[side + 'Hand']; if (!c || !b) return palm(side, out); return b.localToWorld(out.copy(c.c)); }
  let PROPS = null;
  function toolGripHome(name, out = V()) { const P = PROPS; const o = P && P.tools && P.tools[name]; const h = o && o.userData.home; if (!h) return null; const G0 = GRIP[name];
    const g = G0 && G0.g ? V(...G0.g) : (o.userData.grip ? o.userData.grip.clone() : V()); h.parent.updateMatrixWorld(true);
    const m = new THREE.Matrix4().compose(h.pos, h.quat, V(1, 1, 1).multiplyScalar(h.scale || 1)); return out.copy(g).applyMatrix4(m).applyMatrix4(h.parent.matrixWorld); }
  // the target to hand to a palm IK (palm = wrist + 6 cm) so that the fist's grip point lands on p
  function palmTarget(side, p, out = V()) { const pa = palm(side), gp = gripPoint(side); return out.copy(p).sub(gp.sub(pa)); }
  // late fixes: hands that must stay exactly on something are put back after collide.js has moved the body (it wraps HH.update
  // before this does; motion.js's pop filter stays outermost). Callers queue a fix each frame with late(fn).
  let lateQ = [];
  // ---- two-handed long tools (broom): the free hand goes onto the handle by an arm-only two-bone IK, after everything else ----
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  function rotW(b, axis, ang) { if (!b || !(Math.abs(ang) > 1e-5)) return; b.parent.getWorldQuaternion(_q); _q2.setFromAxisAngle(axis, ang); const pi = _q.clone().invert(); b.quaternion.premultiply(pi.multiply(_q2).multiply(_q)); b.updateMatrixWorld(true); }
  function ik2(side, t, w) { const A = bones[side + 'Arm'], F = bones[side + 'ForeArm'], Hd = bones[side + 'Hand']; if (!A || !F || !Hd || w < .01) return;
    A.updateMatrixWorld(true); const a = A.getWorldPosition(V()), b = F.getWorldPosition(V()), c = Hd.getWorldPosition(V());
    const T = a.clone().lerp(t, 1); const lab = a.distanceTo(b), lcb = b.distanceTo(c); const lat = Math.min(Math.max(a.distanceTo(T), .02), lab + lcb - .002);
    const cl = x => Math.min(1, Math.max(-1, x)); const ang = (u, v) => Math.acos(cl(u.clone().normalize().dot(v.clone().normalize())));
    const ac_ab0 = ang(c.clone().sub(a), b.clone().sub(a)), ba_bc0 = ang(a.clone().sub(b), c.clone().sub(b)), ac_at0 = ang(c.clone().sub(a), T.clone().sub(a));
    const ac_ab1 = Math.acos(cl((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat))), ba_bc1 = Math.acos(cl((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb)));
    let ax0 = c.clone().sub(a).cross(b.clone().sub(a)); if (ax0.lengthSq() < 1e-8) ax0.set(0, 0, 1); ax0.normalize(); let ax1 = c.clone().sub(a).cross(T.clone().sub(a)); if (ax1.lengthSq() < 1e-10) ax1.copy(ax0); ax1.normalize();
    rotW(A, ax0, (ac_ab1 - ac_ab0) * w); rotW(F, ax0, (ba_bc1 - ba_bc0) * w);
    const c2 = Hd.getWorldPosition(V()); const ax2 = c2.clone().sub(a).cross(T.clone().sub(a)); if (ax2.lengthSq() > 1e-10) rotW(A, ax2.normalize(), ang(c2.clone().sub(a), T.clone().sub(a)) * w); }
  const twoW = { Left: 0, Right: 0 };
  // ---- sweeping: the broom's bristles on the floor in front of him, short strokes side to side; the right fist high on the
  // handle, the left lower on it (the clip alone carried the broom over his shoulder) ----
  const api_dbg = {}; let HHref = null; const SW = { w: 0, ph: 0, ox: null };
  function setHandQ(side, Qh, w) { const hb = bones[side + 'Hand']; const pq = hb.parent.getWorldQuaternion(new THREE.Quaternion()); const cur = hb.getWorldQuaternion(new THREE.Quaternion()); hb.quaternion.copy(pq.invert().multiply(cur.slerp(Qh, w))); hb.updateMatrixWorld(true); }
  function sweepDrive(dt) { const P = PROPS || window.__props; const b = P && P.tools && P.tools.broom; const H = HHref && (HHref.hero || HHref.H) || (window.__dbg && window.__dbg.hero);
    const on = !!(b && b.parent === bones.RightHand && H && H.task === 'sweep' && !window.__noSweepDrive); SW.w = Math.max(0, Math.min(1, SW.w + (on ? dt : -dt) / .5)); if (SW.w < .01 || !b || b.parent !== bones.RightHand) return false;
    const hips = bones.Hips; const hp = hips.getWorldPosition(V()); const fw = V(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion())); fw.y = 0; fw.normalize(); const rt = V(0, 1, 0).cross(fw).normalize().negate();
    // the clip folds him nearly double over the broom: the chest is held to at most ~35 deg forward (a sweeper's stoop)
    { const sp2 = bones.Spine2; if (sp2 && SW.w > .01) { const up = V(0, 1, 0).applyQuaternion(sp2.getWorldQuaternion(new THREE.Quaternion())); const pitch = Math.atan2(up.dot(fw), up.y); const tg = Math.max(0, pitch - .6) * SW.w; SW.ex = (SW.ex || 0) + Math.max(-1.2 * dt, Math.min(1.2 * dt, tg - (SW.ex || 0))); const ex = SW.ex; // eased: no jerk
      if (ex > .005) { const ax = rt.clone().negate(); rotW(bones.Spine, ax, -ex * .4); rotW(bones.Spine1, ax, -ex * .35); rotW(sp2, ax, -ex * .25); } } }
    const fy = H.root ? H.root.position.y : hp.y - .95; SW.ph += dt * 2.6; const sx = Math.sin(SW.ph) * .18;
    const Bp = hp.clone().addScaledVector(fw, .7).addScaledVector(rt, .08 + sx).setY(fy + .02); // bristles on the boards, ahead of his feet
    for (const ft of ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase']) { const b = bones[ft]; if (!b) continue; const fp = b.getWorldPosition(V()); const d = Bp.clone().sub(fp).setY(0); const ah = d.dot(fw); if (Math.abs(d.dot(rt)) < .22 && ah < .2) Bp.addScaledVector(fw, .2 - ah); }
    const top = hp.clone().addScaledVector(fw, .2).addScaledVector(rt, .16 + sx * .25).add(V(0, .42, 0)); const dir = top.sub(Bp).normalize();
    const sp = GRIP.broom; const Gp = Bp.clone().addScaledVector(dir, sp.g[1] * b.getWorldScale(V()).x); const Lp = Bp.clone().addScaledVector(dir, sp.two[1] * b.getWorldScale(V()).x);
    // tool orientation: local +y along the handle (bristles -> top), local +z (the bristle face) toward his front
    const z = fw.clone().addScaledVector(dir, -fw.dot(dir)).normalize(); const x = dir.clone().cross(z).normalize(); const Qt = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, dir, z));
    const Qh = Qt.clone().multiply(b.quaternion.clone().invert()); const hs = bones.RightHand.getWorldScale(V()).x;
    const gl = V(...sp.g).multiplyScalar(b.scale.x).applyQuaternion(b.quaternion).add(b.position).multiplyScalar(hs); const wrist = Gp.clone().sub(gl.applyQuaternion(Qh));
    ik2('Right', wrist, SW.w); setHandQ('Right', Qh, SW.w);
    const pa = palm('Left'), wr = bones.LeftHand.getWorldPosition(V()); ik2('Left', Lp.clone().sub(pa.sub(wr)), SW.w); fistK.Left = Math.max(fistK.Left, SW.w); return true; }
  // ---- the bedroom door and its bolt move only under a palm (Pavel: nothing by magic wand) ----
  // props' door.openTo / boltTo only set a goal; door.hand(kind) (set here) lets the door move ('open') or the bolt slide
  // ('bolt') only on frames when a palm is on the leaf / on the bolt knob. The nearer free hand reaches there by the arm-only
  // IK; the palm keeps its spot on the leaf while the door swings (re-picked only if it drifts out of reach). No hand in
  // reach: the door just waits. Off switch: window.__noDoorHand (the old timed swing).
  const DR = { w: 0, side: null, loc: null, face: 0, mode: null, tp: null, on: { open: false, bolt: false } }; api_dbg.DR = DR;
  function doorDrive(dt) { const P = PROPS || window.__props; const D = P && P.door; if (!D || !D.leaf || !bones.RightArm) return;
    if (window.__noDoorHand) { if (D.hand && D.hand.__grab) D.hand = null; return; }
    if (!D.hand) { D.hand = k => !!DR.on[k]; D.hand.__grab = true; }
    DR.on.open = DR.on.bolt = false;
    const mode = Math.abs(D.open - D.target) > 1e-3 ? 'open' : Math.abs(D.bolt - D.boltTarget) > 1e-3 && D.open <= .02 ? 'bolt' : null;
    // a goal belongs to the task that set it: if he moves on to something else the door stays where his hand left it
    const H = HHref && (HHref.hero || HHref.H) || (window.__dbg && window.__dbg.hero); const task = H ? H.task : null;
    if (mode && DR.task === undefined) DR.task = task; if (!mode) DR.task = undefined;
    if (mode && task !== DR.task) { D.openTo(D.open); D.boltTo(D.bolt); DR.task = undefined; return; }
    const leaf = D.leaf(); leaf.updateMatrixWorld(true); const hw = (D.width || .77) / 2;
    if (mode && !DR.side) { // the hand: the free one whose shoulder is nearer the door's handle
      const h = D.handle(V()); let best = 9; for (const s of ['Left', 'Right']) { let busy = !!grip[s]; for (const ch of bones[s + 'Hand'].children) if (ch.isObject3D && !ch.isBone && ch.visible && !/mixamorig/.test(ch.name)) busy = true;
        const d = bones[s + 'Arm'].getWorldPosition(V()).distanceTo(h) + (busy ? 1 : 0); if (d < best) { best = d; DR.side = s; } } }
    if (mode !== DR.mode) { DR.loc = null; DR.mode = mode || DR.mode; }
    const side = DR.side; if (!side) return; const sh = bones[side + 'Arm'].getWorldPosition(V());
    let want = null;
    if (mode === 'bolt') want = D.boltKnob(V());
    else if (mode === 'open') { // a flat palm on the leaf, on the face toward him, chest high, toward the latch side
      const pick = () => { const l = leaf.worldToLocal(sh.clone()); DR.face = l.z > 0 ? .07 : -.035; DR.loc = V(Math.min(hw - .25, Math.max(-hw + .05, l.x)), Math.min(1.2, Math.max(.75, l.y - .22)), DR.face); };
      if (!DR.loc) pick(); want = leaf.localToWorld(DR.loc.clone()); if (want.distanceTo(sh) > .5 || (leaf.worldToLocal(sh.clone()).z > 0) !== (DR.face > 0)) { pick(); want = leaf.localToWorld(DR.loc.clone()); } }
    const reach = !!want && want.distanceTo(sh) < .56; // arm .41 + palm: farther and the palm would stop short
    DR.w = Math.max(0, Math.min(1, DR.w + (reach ? dt : -dt) / .35));
    if (want) { if (!DR.tp) DR.tp = palm(side); const d = want.clone().sub(DR.tp); const mx = 1.4 * dt; DR.tp.add(d.length() > mx ? d.setLength(mx) : d); }
    if (DR.w < .01) { if (!mode) { DR.side = null; DR.tp = null; DR.mode = null; } return; }
    const w = DR.w * DR.w * (3 - 2 * DR.w); const hb = bones[side + 'Hand']; for (let it = 0; it < 3; it++) { const pa = palm(side), wr = hb.getWorldPosition(V()); ik2(side, DR.tp.clone().sub(pa.sub(wr)), it ? 1 : w); if (w < .99) break; } // the palm sits past the wrist along the forearm, which turns with the IK: a few passes
    if (mode && want && DR.w > .97 && palm(side).distanceTo(want) < .06) DR.on[mode] = true; }
  // ---- a bucket in a fist hangs plumb with its bail right under the fist. hero.js (odHang) hangs it before collide.js, which
  // can then swing the arm out and drag the rigid bucket sideways into the leg: put it back under the fist after collide.
  // A tip about his right axis (pouring) is kept. ----
  const _bq = new THREE.Quaternion();
  function hangBuckets() { const P = PROPS || window.__props; if (!P || !P.tools || window.__noBucketHang) return;
    const H = HHref && (HHref.hero || HHref.H) || (window.__dbg && window.__dbg.hero); if (!H || !H.root) return; const act = HHref && HHref.act;
    for (const nm of ['waterBucket', 'drainBucket', 'wateringCan']) { const o = P.tools[nm]; if (!o || !o.visible) continue; const side = o.parent === bones.RightHand ? 'Right' : o.parent === bones.LeftHand ? 'Left' : null; if (!side) continue;
      const can = nm === 'wateringCan'; if (can && act && act.step === 'work') continue; // the can (radius ~8 cm) only kept off his shins; it keeps its own grip pose, and while watering the clip holds it out
      if (H.bucketTilt) continue; // Outdoor tips it on purpose (scoop at the pond, pouring out): leave it to them
      const hb = bones[side + 'Hand'], fa = bones[side + 'ForeArm']; const tipping = !!(act && /^(pour|fill)$/.test(act.step || ''));
      // clear of his legs first (the arm takes the fist out): the bucket's side (radius ~0.17) plus a thigh (~0.08) from its axis
      if (!tipping) { const f = V(Math.sin(H.root.rotation.y), 0, Math.cos(H.root.rotation.y)), r = V(-f.z, 0, f.x).multiplyScalar(side === 'Right' ? 1 : -1);
        const c = palm(side).add(V(0, can ? -.12 : -.2, 0)); let need = 0; for (const [a, b] of [['UpLeg', 'Leg'], ['Leg', 'Foot']]) for (const L of ['Left', 'Right']) { const A = bones[L + a].getWorldPosition(V()), B = bones[L + b].getWorldPosition(V());
          const ab = B.clone().sub(A); const t = Math.max(0, Math.min(1, c.clone().sub(A).dot(ab) / ab.lengthSq())); const q = A.addScaledVector(ab, t); const lat = c.clone().sub(q).setY(0).dot(r);
          if (Math.abs(c.y - q.y) < .25) need = Math.max(need, (can ? .19 : .26) - lat); }
        if (need > .005) { const wr = hb.getWorldPosition(V()); ik2(side, wr.addScaledVector(r, Math.min(need, .15)), 1); } }
      if (can) continue;
      // then hang it: plumb (his pouring tip about his right axis kept), the bail's middle at the fist
      o.updateMatrixWorld(true); o.getWorldQuaternion(_bq); { const e = new THREE.Euler().setFromQuaternion(_bq, 'YXZ'); _bq.setFromEuler(new THREE.Euler(tipping ? e.x : 0, H.root.rotation.y, 0, 'YXZ')); }
      hb.updateMatrixWorld(true); const h = hb.getWorldPosition(V()), fp = fa.getWorldPosition(V()); const pm = h.add(h.clone().sub(fp).normalize().multiplyScalar(.07)); // = hero.js odPalm
      const g = o.userData.grip ? o.userData.grip.clone() : V(0, .35, 0); const ws = o.getWorldScale(V()).x; const pos = pm.sub(g.multiplyScalar(ws).applyQuaternion(_bq));
      const M = new THREE.Matrix4().compose(pos, _bq, V(ws, ws, ws)); M.premultiply(hb.matrixWorld.clone().invert()); M.decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(true); } }
  function twoHands(dt) { try { hangBuckets(); } catch (e) { console.error('grab bucket', e); } try { doorDrive(dt); } catch (e) { console.error('grab door', e); } const P = PROPS || window.__props; if (!P || !P.tools) return; if (sweepDrive(dt)) return;
    for (const side of ['Left', 'Right']) { const other = side === 'Left' ? 'Right' : 'Left'; const ho = bones[other + 'Hand'], hs = bones[side + 'Hand']; let tool = null, nm = null;
      for (const k in P.tools) { const o = P.tools[k]; if (o && o.parent === ho && o.visible !== false && GRIP[k] && GRIP[k].two) { tool = o; nm = k; break; } }
      let busy = false; for (const ch of hs.children) if (ch.isObject3D && !ch.isBone && ch.visible && !/mixamorig/.test(ch.name)) busy = true; if (grip[side]) busy = true;
      let ok = !!tool; if (tool) { tool.updateMatrixWorld(true); const p = tool.localToWorld(V(...GRIP[nm].two)); const sh = bones[side + 'Arm'].getWorldPosition(V()); const hips = bones.Hips; const fw = V(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion())); fw.y = 0; fw.normalize();
        const hp = hips.getWorldPosition(V()); ok = p.y < sh.y - .05 && p.clone().sub(hp).dot(fw) > .05 && p.distanceTo(sh) < .62; } // only where a real second hand would go: below the shoulder, in front of him, within reach
      const want = ok && !busy && !window.__noTwoHands ? 1 : 0; twoW[side] += Math.max(-dt / .3, Math.min(dt / .3, want - twoW[side]));
      if (twoW[side] > .01 && tool) { tool.updateMatrixWorld(true); const p = tool.localToWorld(V(...GRIP[nm].two)); const pa = palm(side), wr = hs.getWorldPosition(V()); ik2(side, p.clone().sub(pa.sub(wr)), twoW[side]); fistK && (fistK[side] = 1); } } }
  function attach(HH) { if (!HH || HH.__grabLate) return; HHref = HH;
    // HERO-RULES.md: the late holds run in the pipeline's 'grab' slot (after collide, before the guard)
    if (typeof HH.stage === 'function') { HH.stage('grab', dt => { const q = lateQ; lateQ = []; for (const f of q) { try { f(); } catch (e) { console.error('grab late', e); } } try { twoHands(dt || 1 / 60); } catch (e) { console.error('grab two', e); } }); HH.__grabLate = true; return; }
    const inner = HH.update; HH.update = dt => { lateQ = []; const r = inner(dt); const q = lateQ; lateQ = []; for (const f of q) { try { f(); } catch (e) { console.error('grab late', e); } } try { twoHands(dt || 1 / 60); } catch (e) { console.error('grab two', e); } return r; }; HH.__grabLate = true; }
  const api = {
    attach, late(fn) { lateQ.push(fn); }, twoW, dbg: api_dbg,
    gripPoint, toolGripHome, palmTarget, setProps(P) { PROPS = P; },
    wrapProps, toolPose, GRIP,
    buildFists, tick, channel: s => CH[s], get fist() { return fistK; },
    hold(side, obj, handle) { grip[side] = obj ? { obj, handle } : null; },
    free(x) { for (const s of ['Left', 'Right']) if (!x || x === s || (grip[s] && grip[s].obj === x)) grip[s] = null; },
    // the side whose hand holds o (or one of its ancestors), else null
    held(o) { if (!grip.Left && !grip.Right) return null; for (let x = o, d = 0; x && d < 8; x = x.parent, d++) { if (grip.Right && grip.Right.obj === x) return 'Right'; if (grip.Left && grip.Left.obj === x) return 'Left'; } return null; },
    palm,
    // how far the palm is from what it holds (m), or null
    dist(side) { const g = grip[side]; if (!g || !g.handle) return null; const h = g.handle(); const p = palm(side); return h && p ? h.distanceTo(p) : null; },
    get grip() { return grip; },
  };
  return api;
}
