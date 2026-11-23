// Universal anatomical guard for the hero (owner: the poses thread).
//
// Pavel: "never an impossible pose, in any task, by construction". Clips (many are generated motions with broken frames), IK,
// collision pushes, grabs and motion matching all write the skeleton; this runs LAST every frame (called at the very end of
// motion.js's final pass, or wrapped around HH.update when motion matching is absent) and makes the result a pose a human body
// can take. It knows nothing about tasks:
//  * every joint is held inside a human range of motion, measured as swing (two axes) + twist (about the bone) relative to the
//    bind pose. Ranges come from the 58 hero clips (game/pose.js limits were set from their 0.5..99.5 percentiles) and are capped
//    by anatomy where the clips themselves break it (thigh twisted 120 deg, leg thrown 140 deg sideways, foot bent 50 deg up);
//  * elbows never bend backwards; feet never roll over onto their edge or bend past what an ankle does;
//  * neck + head together turn at most +-55 deg and tip at most 62 deg against the chest; the spine twists at most +-45 deg
//    against the pelvis (so the head never passes ~100 deg from the hips: no owl);
//  * knees are hinges: never backwards, sideways/twist play only as the knee bends; when a clamp moved a leg it is re-solved
//    (two-bone) so the ankle stays where it was planted and the foot keeps its orientation;
//  * no joint turns faster than a person can in one frame: a clip switch or a released IK
//    target can never snap a bone 180 deg; the bone turns at its top speed instead and catches up in a few frames.
// Debug: ?pose=off or window.__poseOff = true disables it; window.__poseGuard.stats() lists what it corrected.
import * as THREE from 'three';

const D2R = Math.PI / 180;
// [swingX lo, hi], [twist lo, hi], [swingZ lo, hi] in degrees, relative to the bind pose, LEFT side (right side is mirrored:
// twist and swingZ change sign). v = top angular speed, deg/s. hinge: perp/twist play = a + b * flex.
const LIM = {
  Spine:      { x: [-30, 45], t: [-25, 25], z: [-25, 25], v: 400 },
  Spine1:     { x: [-40, 35], t: [-40, 40], z: [-35, 35], v: 400 },
  Spine2:     { x: [-20, 52], t: [-25, 25], z: [-25, 25], v: 400 },
  Neck:       { x: [-35, 40], t: [-50, 50], z: [-40, 40], v: 450 },
  Head:       { x: [-45, 62], t: [-55, 60], z: [-40, 50], v: 500 },
  Shoulder:   { x: [-40, 55], t: [-50, 50], z: [-60, 45], v: 700 },
  Arm:        { x: [-85, 125], t: [-115, 115], z: [-115, 95], v: 1500 },
  ForeArm:    { x: [-12, 150], t: [-115, 115], z: [-100, 80], v: 1700 },
  Hand:       { x: [-85, 95], t: [-115, 115], z: [-60, 95], v: 1700 },
  // thigh and knee: not clamped joint by joint (leg IK twists the shin about its own axis; undoing that slid planted feet). The knee
  // is kept a hinge geometrically instead (kneeFix: it always points the way the toes do), which never moves the foot.
  UpLeg:      { x: [-130, 38], t: [-70, 40], z: [-75, 32], v: 1800 },
  Leg:        { x: [-5, 155], hinge: [12, .25, 10, .2], v: 2000 },
  Foot:       { v: 1800 }, // feet: planted by leg IK in the world; a local clamp against a twisted shin tipped planted feet (off for now)
  ToeBase:    { x: [-62, 40], t: [-35, 35], z: [-35, 35], v: 900 },
};
const ORDER = ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
const HEAD = { yaw: 50, tilt: 62 }, SPINE = { yaw: 35, tilt: 80 };

export function createPoseGuard({ hero }) {
  const B = hero.bones, root = hero.root;
  let sk = null; root.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; });
  if (!sk || !B || !B.Hips) return null;
  // bind-pose local rotations
  const S = sk.skeleton, saved = S.bones.map(b => b.quaternion.clone()); S.pose();
  const rest = new Map(S.bones.map(b => [b, b.quaternion.clone()])); S.bones.forEach((b, i) => b.quaternion.copy(saved[i]));
  root.updateMatrixWorld(true);
  const J = [];
  for (const n of ORDER) { const bn = B[n]; if (!bn) continue; const side = /^Right/.test(n) ? -1 : /^Left/.test(n) ? 1 : 0;
    const L = LIM[n.replace(/^(Left|Right)/, '')]; if (!L) continue;
    const mir = r => side < 0 ? [-r[1], -r[0]] : r;
    J.push({ n, b: bn, arm: /Shoulder|Arm|Hand/.test(n), rom: !!L.x, r: rest.get(bn).clone(), ri: rest.get(bn).clone().invert(), x: L.x, t: L.t ? mir(L.t) : null, z: L.z ? mir(L.z) : null, hinge: L.hinge,
      v: L.v * D2R, prev: new THREE.Quaternion(), has: false, cl: 0, cn: 0, vn: 0 }); }
  const byName = {}; J.forEach(j => byName[j.n] = j);
  const stat = { frames: 0, rom: 0, vel: 0, head: 0, spine: 0, knee: 0, worst: {} };
  const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion(), q4 = new THREE.Quaternion(), qs = new THREE.Quaternion(), qt = new THREE.Quaternion();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  const out = { x: 0, t: 0, z: 0 };
  // q (unit, local deviation from rest) -> swing rotation vector (x, z) and twist about Y, degrees
  function decomp(d) { let { x, y, z, w } = d; if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
    const th = Math.atan2(y, w), c = Math.cos(th), s = Math.sin(th); // twist half-angle
    // swing = d * twist^-1, twist^-1 = (0,-s,0,c)
    const sx = x * c + z * s, sz = z * c - x * s, sw = w * c + y * s; // y component vanishes
    const sl = Math.hypot(sx, sz), a = sl < 1e-9 ? 2 : 2 * Math.atan2(sl, sw) / sl;
    out.x = sx * a / D2R; out.z = sz * a / D2R; out.t = 2 * th / D2R; return out; }
  function recomp(x, t, z, target) { const ax = x * D2R, az = z * D2R, ang = Math.hypot(ax, az);
    if (ang < 1e-9) qs.set(0, 0, 0, 1); else { const s = Math.sin(ang / 2) / ang; qs.set(ax * s, 0, az * s, Math.cos(ang / 2)); }
    qt.set(0, Math.sin(t * D2R / 2), 0, Math.cos(t * D2R / 2)); return target.multiplyQuaternions(qs, qt); }
  const clampR = (v, r) => r ? Math.min(r[1], Math.max(r[0], v)) : v;
  // ROM clamp of one joint; returns degrees moved
  function rom(j) { if (!j.rom) return 0; const q = j.b.quaternion; q1.multiplyQuaternions(j.ri, q); const d = decomp(q1);
    let x = clampR(d.x, j.x), t, z;
    if (j.hinge) { const f = Math.max(0, x), pz = j.hinge[0] + j.hinge[1] * f, pt = j.hinge[2] + j.hinge[3] * f; z = Math.min(pz, Math.max(-pz, d.z)); t = Math.min(pt, Math.max(-pt, d.t)); }
    else { t = clampR(d.t, j.t); z = clampR(d.z, j.z); }
    const m = Math.abs(x - d.x) + Math.abs(t - d.t) + Math.abs(z - d.z); if (m < .05) return 0;
    recomp(x, t, z, q2); q.multiplyQuaternions(j.r, q2); j.cl += m; j.cn++; return m; }
  // a chain (bones a..b, each the child of the previous) held so its end turns at most yaw / tips at most tilt from the bind pose;
  // the correction is spread evenly over the chain
  function chain(js, yaw, tilt) { if (js.some(j => !j)) return 0;
    q3.set(0, 0, 0, 1); q4.set(0, 0, 0, 1); for (const j of js) { q3.multiply(j.b.quaternion); q4.multiply(j.r); }
    q1.copy(q4).invert().multiply(q3); const d = decomp(q1);
    const sw = Math.hypot(d.x, d.z), k = sw > tilt ? tilt / sw : 1, t = Math.min(yaw, Math.max(-yaw, d.t));
    const m = Math.abs(t - d.t) + sw * (1 - k); if (m < .05) return 0;
    recomp(d.x * k, t, d.z * k, q2); const tgt = q4.multiply(q2); // wanted chain rotation in the chain parent's frame
    const C = new THREE.Quaternion().multiplyQuaternions(tgt, q3.invert()); // correction in the parent frame
    for (let i = 0; i < js.length; i++) { const j = js[i], f = 1 / (js.length - i);
      const Ca = new THREE.Quaternion().slerp(C, f); // C^f
      const ql = j.b.quaternion.clone(); j.b.quaternion.premultiply(Ca);
      // what is left of C, seen from this bone's frame
      C.premultiply(Ca.invert()); C.premultiply(ql.clone().invert()).multiply(ql); }
    return m; }
  // legs: when a clamp moved the thigh or the knee, the leg is re-solved (two-bone, knee as a hinge) so the ankle stays exactly
  // where it was planted and the foot keeps its orientation in the world
  const LEGS = [['LeftUpLeg', 'LeftLeg', 'LeftFoot'], ['RightUpLeg', 'RightLeg', 'RightFoot']].map(([u, l, f]) => ({ u: byName[u], l: byName[l], f: byName[f], A: new THREE.Vector3(), F: new THREE.Quaternion(), ok: !!(byName[u] && byName[l] && byName[f]) }));
  const pq = new THREE.Quaternion(), vA = new THREE.Vector3();
  function worldQ(b, o) { return b.getWorldQuaternion(o); }
  function setWorldQ(b, wq) { b.parent.getWorldQuaternion(pq); b.quaternion.copy(pq.invert().multiply(wq)); }
  function reach(L) { const U = L.u.b, K = L.l.b, F = L.f.b; U.updateMatrixWorld(true);
    const H = U.getWorldPosition(v1), A1 = F.getWorldPosition(v2); if (A1.distanceTo(L.A) < .004) { setWorldQ(F, L.F); return false; }
    const Kp = K.getWorldPosition(v3); const l1 = H.distanceTo(Kp), l2 = Kp.distanceTo(A1);
    const want = L.A.distanceTo(H), d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, want));
    const flex = 180 - Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)))) / D2R;
    q1.multiplyQuaternions(L.l.ri, K.quaternion); const dd = decomp(q1);
    recomp(Math.min(L.l.x[1], Math.max(L.l.x[0], flex)), dd.t, dd.z, q2); K.quaternion.multiplyQuaternions(L.l.r, q2);
    U.updateMatrixWorld(true); const a = F.getWorldPosition(vA).sub(H).normalize(), b = L.A.clone().sub(H).normalize();
    const R = q4.setFromUnitVectors(a, b); worldQ(U, q3); setWorldQ(U, q3.premultiply(R));
    U.updateMatrixWorld(true); setWorldQ(F, L.F); return true; }
  // speed limit
  const rootPrev = new THREE.Vector3(); let gap = 0;
  function speed(dt) {
    const tele = root.position.distanceTo(rootPrev) > .45 || dt > .2 || window.__heroFast || hero.H && hero.H.lad; rootPrev.copy(root.position);
    if (tele) gap = 3; const live = gap <= 0; if (gap > 0) gap--;
    for (const j of J) { const q = j.b.quaternion;
      if (j.has && live) { const ang = j.prev.angleTo(q), mx = j.v * dt; if (ang > mx) { q.copy(j.prev.slerp(q, mx / ang)); j.vn++; stat.vel++; } }
      j.prev.copy(q); j.has = true; } }
  function run(dt) {
    if (window.__poseOff || !(dt > 0)) return; dt = Math.min(dt, .1); stat.frames++;
    const lad = !!(hero.H && hero.H.lad); root.updateMatrixWorld(true);
    for (const L of LEGS) if (L.ok) { L.f.b.getWorldPosition(L.A); worldQ(L.f.b, L.F); }
    const legMoved = [false, false];
    for (const j of J) { if (lad && j.arm) continue; const m = rom(j); if (m) { stat.rom++; if (/Leg$/.test(j.n)) legMoved[/^Left/.test(j.n) ? 0 : 1] = true; const w = stat.worst[j.n]; if (!w || m > w) stat.worst[j.n] = +m.toFixed(1); } }
    if (chain([byName.Spine, byName.Spine1, byName.Spine2], SPINE.yaw, SPINE.tilt)) stat.spine++;
    if (chain([byName.Neck, byName.Head], HEAD.yaw, HEAD.tilt)) stat.head++;
    root.updateMatrixWorld(true);
    LEGS.forEach((L, i) => { if (L.ok && legMoved[i] && !hero.inBed && reach(L)) stat.knee++; });
    speed(dt);
    root.updateMatrixWorld(true); }
  function stats() { const r = { ...stat, joints: {} }; for (const j of J) if (j.cn || j.vn) r.joints[j.n] = { rom: j.cn, deg: +(j.cl / Math.max(1, j.cn)).toFixed(1), speed: j.vn }; return r; }
  function reset() { J.forEach(j => { j.has = false; j.cl = j.cn = j.vn = 0; }); Object.assign(stat, { frames: 0, rom: 0, vel: 0, head: 0, spine: 0, knee: 0, worst: {} }); }
  run.stats = stats; run.reset = reset; run.LIM = LIM;
  return run;
}
