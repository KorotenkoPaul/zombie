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
    broom: { g: [0, 1.02, 0], a: [0, 1, 0], A: 'T', b: [0, 0, 1], B: 'F', tilt: .1 },
    pencil: { g: [.0, .0045, 0], a: [1, 0, 0], A: 'F', b: [0, 1, 0], B: 'T', tilt: 0, fwd: true, pinch: true },
    lantern: { g: [0, .24, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },
    kettle: { g: [0, .21, 0], a: [0, -1, 0], A: 'F', b: [1, 0, 0], B: 'T', tilt: 0, fwd: true },// KITCHEN: the arched handle's top bar, spout (+x) toward the thumb
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
  function attach(HH) { if (!HH || HH.__grabLate) return;
    // HERO-RULES.md: the late holds run in the pipeline's 'grab' slot (after collide, before the guard)
    if (typeof HH.stage === 'function') { HH.stage('grab', () => { const q = lateQ; lateQ = []; for (const f of q) { try { f(); } catch (e) { console.error('grab late', e); } } }); HH.__grabLate = true; return; }
    const inner = HH.update; HH.update = dt => { lateQ = []; const r = inner(dt); const q = lateQ; lateQ = []; for (const f of q) { try { f(); } catch (e) { console.error('grab late', e); } } return r; }; HH.__grabLate = true; }
  const api = {
    attach, late(fn) { lateQ.push(fn); },
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
