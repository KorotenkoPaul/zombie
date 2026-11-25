// GAME WALK (thread "Сделать героя как в нормальных играх", 2026-11-25), flag ?walk=game (or ?style=game)
// Pavel: the hero walks like jelly, nothing like a character in a good mobile game. The motion-matched CMU mocap is a real
// adult's soft walk on a chibi body (head forward, arms hanging, ~2 clip jumps a second blended away), so the walk never has a
// clear rhythm or a clear pose. Games walk their characters on a clean procedural/keyed cycle: a fixed rhythm, upright chest,
// a clear arm swing, a little bounce, and feet that are planted where they land and lifted where they leave (no slide).
//
// This module is that cycle. It runs in the hero's 'motion' slot (after motion.js), only while he walks a route on a floor
// (not on ladders, seats, beds, squats), and writes the whole body from the bind pose:
//  * a gait planner driven by the distance walked: each foot is planted in the world for 58% of the cycle and swings to a
//    landing spot predicted from the root's speed and turn rate for the rest (so stride = distance, zero sliding by design);
//  * hips: low at each foot contact, high at mid-stance (bounce), a small sway over the standing foot, pelvis turn with the legs;
//  * chest upright with a counter-turn, head held level (the look slot aims it afterwards);
//  * arms: a clear swing opposite to the legs, elbows a little bent, more bend on the forward swing; an arm that holds
//    something (a child object in the hand) or an upper-body action clip keeps the pose it had;
//  * legs: two-bone IK to the planned ankles, the sole rolls (heel strike, flat, toe-off).
// When he stops, the feet finish their steps onto a neutral stance and the cycle fades out into the idle pose underneath.
export function createGameWalk({ THREE, hero, opts = {} }) {
  const H = hero.H || hero.hero, bones = hero.bones, root = H.root;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), Q = () => new THREE.Quaternion();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const NAMES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'];
  const B = {}; for (const n of NAMES) B[n] = bones[n]; if (NAMES.some(n => !B[n])) { console.warn('gamewalk: bones missing'); return null; }
  // ---------- bind pose (local quaternions and hips position), from the skin's inverse bind matrices ----------
  let sk = null; root.traverse(o => { if (o.isSkinnedMesh && !sk) sk = o; }); const S = sk.skeleton;
  const bindW = new Map(); S.bones.forEach((b, i) => bindW.set(b, S.boneInverses[i].clone().invert()));
  // bones not in the skin (dropped by optim) have no bind matrix: none of ours, but guard anyway
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const bindWorld = b => { if (bindW.has(b)) return bindW.get(b).clone(); return rootInv.clone().multiply(b.matrixWorld); };
  // world of the hips' parent relative to the root (constant: the armature node)
  const hipsParentRel = rootInv.clone().multiply(B.Hips.parent.matrixWorld);
  const REST = {}; // local quaternion per bone in the bind pose
  for (const n of NAMES) { const b = B[n]; const pw = n === 'Hips' ? hipsParentRel : bindWorld(b.parent); const lw = pw.clone().invert().multiply(bindWorld(b)); const p = V(), q = Q(), s = V(); lw.decompose(p, q, s); REST[n] = { q, p }; }
  // measurements in the bind pose (root at the origin, facing +Z)
  const bp = n => V().setFromMatrixPosition(bindWorld(B[n]));
  // the bind space is offset from the root (mesh node transform): heights are taken from the lowest sole vertex in the same space
  let soleY = Infinity; root.traverse(o => { if (!o.isSkinnedMesh || o.skeleton !== S && o !== sk) return; if (o.skeleton.boneInverses[0] !== S.boneInverses[0] && o !== sk) return; const P0 = o.geometry.attributes.position, v0 = V();
    for (let i = 0; i < P0.count; i += 3) { v0.fromBufferAttribute(P0, i).applyMatrix4(o.bindMatrix); if (v0.y < soleY) soleY = v0.y; } });
  if (!isFinite(soleY)) soleY = Math.min(bp('LeftFoot').y, bp('RightFoot').y) - .1;
  // the root may be scaled after load: bind lengths -> world lengths by the live/bind length of the thigh bone
  const SC = B.LeftUpLeg.getWorldPosition(V()).distanceTo(B.LeftLeg.getWorldPosition(V())) / bp('LeftUpLeg').distanceTo(bp('LeftLeg'));
  const hipY = (bp('Hips').y - soleY) * SC, ankY = ((bp('LeftFoot').y + bp('RightFoot').y) / 2 - soleY) * SC;
  const legLen = (bp('LeftUpLeg').distanceTo(bp('LeftLeg')) + bp('LeftLeg').distanceTo(bp('LeftFoot'))) * SC;
  const footX = { Left: (bp('LeftFoot').x - bp('Hips').x) * SC, Right: (bp('RightFoot').x - bp('Hips').x) * SC };
  const sideSign = { Left: Math.sign(bp('LeftUpLeg').x - bp('Hips').x) || 1, Right: Math.sign(bp('RightUpLeg').x - bp('Hips').x) || -1 };
  const upOff = (bp('Hips').y - (bp('LeftUpLeg').y + bp('RightUpLeg').y) / 2) * SC;
  const hipW = Math.abs(bp('LeftUpLeg').x - bp('RightUpLeg').x) / 2 * SC;
  // foot world orientation in the bind pose, relative to the root
  const ballF = (() => { const a = bp('LeftFoot'), b = bp('LeftToeBase'); return a && b ? Math.hypot(a.x - b.x, a.z - b.z) * SC : .08; })(); // ankle to the ball, horizontal
  // the bind rotation stands the foot about 20 deg more toes-down than the walk clips do (gate ankle neutral 66 vs 78 deg; walking ankle median 120 vs 98):
  // the walking foot is turned that much toes-up, so a crouch after the walk starts from the same ankle as everywhere else
  const PITCH = (opts.footPitch ?? -21) * Math.PI / 180;
  const ANKMAX = (opts.ankleMax ?? 102) * Math.PI / 180; // shin-to-foot, the gate's measure: his neutral is ~78, a person bends ~26 past it
  const footRestQ = {}; for (const s of ['Left', 'Right']) { const q = Q(); bindWorld(B[s + 'Foot']).decompose(V(), q, V()); footRestQ[s] = q; }
  const headRest = Q(); bindWorld(B.Head).decompose(V(), headRest, V());
  const P = Object.assign({ duty: .6, lift: .075, bob: .012, sway: .014, pelvisYaw: .9, chestCounter: .65, arm: .55, elbow: .38, elbowFwd: .35, abd: .08, lean: .06, kneeBend: .03, passOut: .03 }, opts);
  // ---------- state ----------
  const ST = { hd: { Left: null, Right: null }, hs: { Left: 0, Right: 0 }, vx: 0, vz: 0, w: 0, ph: 0, on: false, feet: { Left: null, Right: null }, swing: { Left: null, Right: null }, prevYaw: null, av: 0, v: 0, settle: 0, prevPos: null };
  const _v = V(), _q = Q(), _q2 = Q(), _m = new THREE.Matrix4();
  const up = V(0, 1, 0);
  const saved = NAMES.map(() => Q()); const savedHip = V(); const out = NAMES.map(() => Q()); const outHip = V();
  const fwdOf = y => V(Math.sin(y), 0, Math.cos(y)), rightOf = y => V(Math.cos(y), 0, -Math.sin(y)); // right = +X in the bind pose at yaw 0
  function rotW(b, axis, ang) { if (Math.abs(ang) < 1e-5) return; b.parent.getWorldQuaternion(_q2); _q.setFromAxisAngle(axis, ang); const pi = _q2.clone().invert(); b.quaternion.premultiply(pi.multiply(_q).multiply(_q2)); b.updateMatrixWorld(true); }
  function setWorldQ(b, wq) { b.parent.getWorldQuaternion(_q2); b.quaternion.copy(_q2.invert().multiply(wq)); b.updateMatrixWorld(true); }
  function aim(b, child, dir) { const a = b.getWorldPosition(V()), c = child.getWorldPosition(V()); const v1 = c.sub(a).normalize(); const dq = Q().setFromUnitVectors(v1, dir.clone().normalize()); const wq = b.getWorldQuaternion(Q()); setWorldQ(b, dq.multiply(wq)); }
  function ik2(A, Bb, C, target, pole) {
    const a = A.getWorldPosition(V()), b = Bb.getWorldPosition(V()), c = C.getWorldPosition(V()); const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    const tv = target.clone().sub(a); const dd = clamp(tv.length(), Math.abs(l1 - l2) + .01, l1 + l2 - .003); const dir = tv.normalize();
    const ca = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1), sa = Math.sqrt(1 - ca * ca);
    let pp = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir))); if (pp.lengthSq() < 1e-6) pp = V(0, 0, 1); pp.normalize();
    const knee = a.clone().addScaledVector(dir, ca * l1).addScaledVector(pp, sa * l1); aim(A, Bb, knee.sub(a)); aim(Bb, C, a.clone().addScaledVector(dir, dd).sub(Bb.getWorldPosition(V())));
  }
  const holding = s => { const h = B[s + 'Hand']; for (const c of h.children) if (!c.isBone && c.visible !== false) return true; return !!(H.hold && H.hold[s]); };
  function ladderSoon() { if (H.lad || (H.path[0] && H.path[0].t === 'ladder')) return true;
    if (H.path.length > 1 && H.path[1].t === 'ladder' && hero.N && hero.N[H.path[0].node]) { const q = hero.N[H.path[0].node].p; if (Math.hypot(q.x - root.position.x, q.z - root.position.z) < 1.2) return true; }
    return false; }
  const _dp = V();
  function doorBusy() { const PR = window.__props; if (!PR) return false;
    for (const d of [PR.fridge, PR.ovenDoor, PR.oven]) { if (!d || !(d.open > .02)) continue; const o = d.obj || d.door || d.group;
      if (!o || !o.getWorldPosition) return true; o.getWorldPosition(_dp); if (Math.hypot(_dp.x - root.position.x, _dp.z - root.position.z) < 1.5 && Math.abs(_dp.y - root.position.y) < 1.5) return true; }
    return false; }
  function active() {
    if (window.__noGameWalk) return false;
    const lad = H.lad || (H.path[0] && H.path[0].t === 'ladder');
    if (lad || H.fit || H.inBed || H.bedB || H.bedC || H.seated || H.swing || H.trans || (H.squat || 0) > .02 || !H.ground) return false;
    // the ladder foot: hand the legs back to motion matching well before climb.js mounts (it places the root on the ladder,
    // and planted feet then snapped the knees)
    if (ladderSoon()) return false;
    // a door he is working (the fridge, the oven): the task's own approach and back-off handles the legs around its swing, as in
    // the classic style (stepped, the planted foot stayed in the door's arc: shins 5-8 cm inside the fridge door, gate cook/store)
    if (doorBusy()) return false;
    if (H.path.length > 0 && !H.slide) return true;
    // turning on the spot (the hero turns to face the work with the walk clip playing in place): real steps, the toes were in the air
    ST.turning = Math.abs(ST.av) > (ST.turning ? .35 : .9) && (H.cur && H.cur._clip && H.cur._clip.name === '30');
    if (ST.turning) return true;
    // the last bit up to a work spot (approachTo, slideTo: 0.3-1.2 m): real steps too, MM glided there on two standing feet
    const sl = H.slide; return !!(sl && sl.k < 1 && (Math.hypot(sl.x, sl.z) > .3 || Math.abs(sl.yaw || 0) > .6 || (sl.yT != null && Math.abs(sl.yT - sl.y0) + Math.abs((sl.yF ?? sl.yT) - sl.yT) > .6))); // and a turn on the spot: steps, not the walk clip shuffling with the toes in the air
  }
  // where his own standing pose puts each foot (root frame: forward, right), learned from the pose underneath while he stands
  // without the walk: the old hero's idle stands 8-9 cm behind the root. Settling at the root itself left the soles locked there
  // after the hand-over, the shins tilted 6 deg less and every crouch that followed read 6-14 deg further bent (gate trip, repairs)
  const STAND = { Left: { f: 0, x: footX.Left * .85 }, Right: { f: 0, x: footX.Right * .85 } };
  function learnRest(dt, pos, yaw) {
    if ((ST.lt = (ST.lt || 0) + dt) < .1) return; const k = 1 - Math.exp(-ST.lt * 2); ST.lt = 0;
    root.updateMatrixWorld(true); const fw = fwdOf(yaw), rt = rightOf(yaw);
    for (const s of ['Left', 'Right']) { const a = B[s + 'Foot'].getWorldPosition(V()).sub(pos); const f = clamp(a.dot(fw), -.2, .15), x = a.dot(rt);
      if (Math.abs(x - footX[s] * .85) > .12) continue; STAND[s].f += (f - STAND[s].f) * k; STAND[s].x += (x - STAND[s].x) * k; }
  }
  function neutral(s, pos, yaw) { return pos.clone().addScaledVector(rightOf(yaw), STAND[s].x).addScaledVector(fwdOf(yaw), STAND[s].f).setY(pos.y + ankY); }
  const sm = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  function update(dt) {
    if (!(dt > 0)) return; dt = Math.min(dt, .05);
    const pos = root.position, yaw = root.rotation.y;
    // a teleport (spawn at the reading chair, a task reset): the planted feet are somewhere else entirely; drop the walk at once
    // (gate: after spawn('read') the feet reached for the previous floor 1.1 m down and pulled the root with them)
    if (ST.prevPos && (Math.hypot(pos.x - ST.prevPos.x, pos.z - ST.prevPos.z) > .5 || Math.abs(pos.y - ST.prevPos.y) > .4)) { ST.w = 0; ST.feet.Left = ST.feet.Right = null; ST.swing.Left = ST.swing.Right = null; ST.rate = null; ST.L = null; ST.va = null; ST.prevPos = null; ST.settled = true; }
    if (ST.prevPos) { const sp = Math.hypot(pos.x - ST.prevPos.x, pos.z - ST.prevPos.z) / dt; ST.v += (Math.min(sp, 2.5) - ST.v) * (1 - Math.exp(-dt * 14)); { const k = 1 - Math.exp(-dt * 14), cl = sp > 2.5 ? 2.5 / sp : 1; ST.vx += ((pos.x - ST.prevPos.x) / dt * cl - ST.vx) * k; ST.vz += ((pos.z - ST.prevPos.z) / dt * cl - ST.vz) * k; } ST.av += (wrapA(yaw - ST.prevYaw) / dt - ST.av) * (1 - Math.exp(-dt * 10)); }
    ST.prevPos = pos.clone(); ST.prevYaw = yaw;
    const want = active();
    if (!want && ST.w === 0 && H.ground && !((H.squat || 0) > .02) && !H.fit && !H.seated && !H.inBed && !H.bedB && !H.bedC && !H.swing && !H.trans && !H.lad && !H.path.length && !H.slide
      && B.Hips.getWorldPosition(V()).y - pos.y > hipY - .06) learnRest(dt, pos, yaw);
    // feet far from their neutral spots: keep stepping until they are home (that is how a game character stops)
    const far = s => { const f = ST.feet[s]; if (!f) return false; const n = neutral(s, pos, yaw); return Math.hypot(f.x - n.x, f.z - n.z) > .1 || (ST.hd[s] != null && Math.abs(wrapA(ST.hd[s] - yaw)) > .45) || !!ST.swing[s]; };
    if (want) ST.settled = false;
    // the pose underneath going down (a task's squat or kneel at the hatch, the stove, the woodpile): no settle step over it, the
    // legs go to the task now (a settle kept the hips at walking height-then-sinking for 0.3 s: knees 13-14 cm/frame²)
    const crouch = !want && ((H.squat || 0) > .02 || B.Hips.getWorldPosition(V()).y - pos.y < hipY - .06); // a squat lowers the root itself
    const cn = H.cur && H.cur._clip ? H.cur._clip.name : ''; const loco = cn === '30' || cn === 'hy_idle' || !cn; // no settle step under a work clip (the axe swing: soleLock held the sole while the step moved it, 11 cm in one frame)
    const settling = !want && !crouch && loco && !ST.settled && ST.w > 0 && !ladderSoon() && !window.__noGameWalk && (far('Left') || far('Right')) && H.ground && !H.fit && !H.lad && !H.seated && !H.inBed && !H.bedB && !H.bedC && !H.swing && !H.trans;
    if (!want && !settling && ST.w > 0) ST.settled = true; // one settle per stop: after it the idle underneath owns him (an idle turn moved the neutral spots and he kept re-stepping at 83%)
    const tw = want || settling ? 1 : 0;
    if (tw && ST.w === 0) { // entering: plant both feet where the pose underneath has them
      root.updateMatrixWorld(true);
      for (const s of ['Left', 'Right']) { const a = B[s + 'Foot'].getWorldPosition(V()); a.y = pos.y + ankY; ST.feet[s] = a; ST.swing[s] = null; ST.hd[s] = yaw; }
      // the foot that is further behind leaves first
      const f = fwdOf(yaw); const dl = ST.feet.Left.clone().sub(pos).dot(f), dr = ST.feet.Right.clone().sub(pos).dot(f);
      ST.ph = dl < dr ? P.duty - .001 : P.duty - .501;
      if (ST.ph < 0) ST.ph += 1;
    }
    // sitting down, getting into bed, a fitted pose: the clip owns the legs now. The walk does not step on through the hand-over
    // (the planted foot kept its roll into the sit: foot-bend 45 deg) and hands over in 0.15 s
    const seatIn = !tw && !!(H.fit || H.seated || H.inBed || H.bedB || H.bedC || H.swing || H.trans);
    ST.w = clamp(ST.w + (tw ? dt / .3 : -dt / (seatIn ? .15 : .3)), 0, 1);
    if (ST.w <= 0) { ST.feet.Left = ST.feet.Right = null; ST.swing.Left = ST.swing.Right = null; ST.rate = null; ST.L = null; ST.va = null; return; }
    // fading out (a ladder ahead, a task takes the legs): the gait goes on as it was while the blend hands him over; a stop
    // in the middle of it (step length and cadence to 0) moved the landing spots and the hips in the same 0.3 s (knee 8 cm/frame²)
    let v, L, rate;
    if (tw) ST.walking = want; // what he was doing when the fade began: a walk is cut off mid-stride, a settle has finished
    if (seatIn) { v = 0; L = 0; rate = 0; ST.rate = 0; }
    else if (!tw && ST.walking && ST.L != null) { v = ST.v; L = ST.L; rate = ST.rate; }
    else {
      v = want ? Math.max(ST.v, H.v || 0) : 0;
      // step length grows with speed; cadence = v / L, never slower than a brisk settle step
      L = clamp((.28 + .18 * v) * legLen / .72, .12, .55) * (want ? 1 : 0); ST.L = L;
      rate = v > .05 ? v / (2 * Math.max(L, .1)) : 0; // cycles per second
      if (settling) rate = Math.max(rate, 1.3); // an unhurried settle: two 0.2 m steps at 1.9 read as leg jitter while the hands already reach (gate water, Leisure)
      if (want) rate = Math.max(rate, 1.2);
      ST.rate = ST.rate == null ? rate : ST.rate + (rate - ST.rate) * (1 - Math.exp(-dt * 6)); rate = ST.rate; // cadence eases (a stop switched it in one frame: knee 12-19 cm/frame²)
    }
    // the walk's body motion (bounce, sway, knee bend, lean) dies out over ~0.3 s: v went to 0 in one frame at a stop, and the
    // hips dropped 2 cm at once
    ST.va = ST.va == null ? v : (v > ST.va ? v : ST.va + (v - ST.va) * (1 - Math.exp(-dt * 7)));
    const Dt0 = P.duty;
    // a standing foot left further behind than a stance takes it (he speeds up from a standstill, a turn): the cadence picks up
    // so its swing comes sooner. Without this the planted foot got 40-50 cm behind and went home in a 0.22 s quick step
    // (gate: 'jump' 13 cm/frame² on the foot at nearly every walk start)
    if (want && v > .2) { const f0 = fwdOf(yaw); let back = 0; for (const s of ['Left', 'Right']) if (!ST.swing[s] && ST.feet[s]) back = Math.max(back, -ST.feet[s].clone().sub(pos).dot(f0));
      const half = v * Dt0 / Math.max(rate, .5) * .5; if (back > half + .03) rate *= clamp(1 + (back - half - .03) / .12, 1, 2); }
    const ph0 = ST.ph; ST.ph = (ST.ph + rate * dt) % 1;
    const T = rate > 0 ? 1 / rate : 1;
    const f = fwdOf(yaw), r = rightOf(yaw);
    // ---------- gait: per foot local phase (left = ph, right = ph + .5), stance [0, duty), swing [duty, 1) ----------
    const Dt = P.duty; const roll = { Left: 0, Right: 0 }; const lift = { Left: 0, Right: 0 };
    for (const s of ['Left', 'Right']) {
      const p = (ST.ph + (s === 'Right' ? .5 : 0)) % 1, p0 = (ph0 + (s === 'Right' ? .5 : 0)) % 1;
      const crossedSwing = (p0 < Dt && p >= Dt) || (p < p0 && p >= Dt);
      const crossedLand = p < p0 || (p0 >= Dt && p < Dt);
      if (crossedSwing && !ST.swing[s]) ST.swing[s] = { from: ST.feet[s].clone() };
      if (ST.swing[s] && crossedLand) { ST.feet[s] = ST.swing[s].to ? ST.swing[s].to.clone() : ST.feet[s]; ST.swing[s] = null; ST.hd[s] = yaw; }
      // a planted foot left far behind by a sharp turn or a push: it goes now (people do not do the splits)
      if (!ST.swing[s] && !ST.swing[s === 'Left' ? 'Right' : 'Left'] && ST.feet[s].distanceTo(V(pos.x, ST.feet[s].y, pos.z)) > legLen * (want ? .75 : .42)) { // stopping: a foot left 30 cm out comes home now (the hips sank 20 cm to reach it)
         ST.swing[s] = { from: ST.feet[s].clone(), quick: 0 }; }
      if (ST.swing[s]) {
        const sw = ST.swing[s]; let u;
        if (sw.quick != null) { sw.quick += dt / .3; u = clamp(sw.quick, 0, 1); if (u >= 1) { ST.feet[s] = sw.to.clone(); ST.swing[s] = null; ST.hd[s] = yaw; } }
        else u = clamp((p >= Dt ? p - Dt : p + 1 - Dt) / (1 - Dt), 0, 1);
        // landing: where the root will be at contact, half a stance's travel ahead of it (v·duty·T/2: the foot then leaves as
        // far behind as it landed ahead; L·duty/2 landed it 13 cm ahead and left it 37 cm behind, and the hips sank 13 cm to reach)
        const tl = (1 - u) * (1 - Dt) * T; const yl = yaw + ST.av * tl * .5;
        const vs = ST.v > 1e-3 ? v / ST.v : 0; // the real direction of travel: a step back (the walk clip run backwards) or sideways put the feet ahead of a body going the other way (hips sank 24 cm)
        const vc = (ST.vx * Math.sin(yaw) + ST.vz * Math.cos(yaw)) / Math.max(Math.hypot(ST.vx, ST.vz), 1e-3); const kb = 1 - .5 * clamp(-vc, 0, 1) - .3 * Math.sqrt(Math.max(0, 1 - vc * vc)); /* backing away or sidestepping: short steps, a person does not reach behind (backing from the sink, the right foot went 34 cm back into the open fridge door) */
        const land = V(pos.x, pos.y, pos.z).add(V(ST.vx * vs, 0, ST.vz * vs).multiplyScalar((tl + Dt * T * .5) * kb)).addScaledVector(rightOf(yl), STAND[s].x).addScaledVector(fwdOf(yl), STAND[s].f * (1 - clamp(v * 3, 0, 1))); land.y = pos.y + ankY; // standing where his idle stands, eased out as he walks
        // a landing in furniture (the bunk's front edge, a chair leg, a ground stone, the bench): the nearest clear spot within 20 cm
        { const C = window.__collide; if (C && C.footFree) { const g = V(land.x, pos.y, land.z); C.footFree(g, fwdOf(yaw)); land.x = g.x; land.z = g.z; } }
        // the landing spot eases toward its new prediction: when he stops mid-step it jumped from a stride ahead to the neutral stance
        if (!sw.to) sw.to = land; else sw.to.lerp(land, 1 - Math.exp(-dt * 10));
        if (ST.swing[s]) {
          const e = u * u * u * (u * (u * 6 - 15) + 10); // smootherstep: a clear push-off and landing, no step in acceleration
          { const h0 = sw.h0 ??= (ST.hd[s] == null ? yaw : yaw + clamp(wrapA(ST.hd[s] - yaw), -.6, .6)); /* from the heading it was shown with */ ST.hs[s] = h0 + wrapA(yaw - h0) * e; } // the foot turns to the new heading in the air
          const fp = sw.from.clone().lerp(sw.to, e).addScaledVector(rightOf(yaw), Math.sign(footX[s]) * P.passOut * Math.sin(Math.PI * u)); fp.y = pos.y + ankY + (sw.from.y - (sw.y0 ??= pos.y) - ankY) * (1 - e) /* leaves from the height it stood at (a planted foot keeps its own height) */ + P.lift * Math.sin(Math.PI * Math.min(1, u * 1.1)) * clamp((sw.L ??= L) / .3, .4, 1.2) /* the swing keeps the lift it started with: a stop mid-step (L -> 0) dropped the foot 4 cm in one frame */;
          // the swing clears what it passes over (a root, a stone, a beam end): a little more lift while the sole would be in it
          { const C = window.__collide; ST.xl = ST.xl || { Left: 0, Right: 0 }; let need = 0;
            if (C && C.soleDepth && u > .05 && u < .95) { const sd = C.soleDepth(fp.x, fp.y - ankY + ST.xl[s], fp.z, f.x, f.z); if (sd > .004) need = Math.min(.12, ST.xl[s] + sd + .015); }
            ST.xl[s] += (need - ST.xl[s]) * (1 - Math.exp(-dt * (need > ST.xl[s] ? 30 : 6))); fp.y += ST.xl[s] * Math.sin(Math.PI * u); }
          ST.feet[s + 'Shown'] = fp; lift[s] = u;
          roll[s] = sw.quick != null ? 0 : u < .3 ? .35 * (1 - sm(u / .3)) : u > .75 ? -.22 * sm((u - .75) / .25) : 0; // toe-off peel ends early in the swing, the toes come up for the heel strike; continuous with the stance roll at both ends (it jumped .3 -> .45 rad at lift-off, and from any stance roll to .45 on a quick step)
        }
      }
      if (!ST.swing[s]) { /* a planted foot stays where it stands: the root's own bumps (a board edge, 6 cm up and down in 3 frames) lifted the planted foot with it (gate stoke/telescope foot jumps 12-14 cm/frame²); it follows a lasting change of floor height in ~0.3 s */ ST.feet[s].y += (pos.y + ankY - ST.feet[s].y) * (1 - Math.exp(-dt * 4)); if (Math.abs(ST.feet[s].y - pos.y - ankY) > .12) ST.feet[s].y = pos.y + ankY + Math.sign(ST.feet[s].y - pos.y - ankY) * .12; ST.feet[s + 'Shown'] = ST.feet[s].clone(); const pst = Math.min(1, p / Dt); /* a foot that landed from a quick step stands through its swing window: p/Dt went to 1.66 and the toes pitched 75 deg down and back (gate: 'knee bends forward' x71) */ roll[s] = pst < .15 ? -.22 * (1 - sm(pst / .15)) : pst > .7 ? .35 * sm((pst - .7) / .3) : 0; }
    }
    // ---------- save the pose underneath (for blending), then build ours from the bind pose ----------
    NAMES.forEach((n, i) => saved[i].copy(B[n].quaternion)); savedHip.copy(B.Hips.position);
    for (const n of NAMES) B[n].quaternion.copy(REST[n].q);
    const amp = clamp(ST.va / 1.0, 0, 1.3);
    const fL = ST.feet.LeftShown.clone().sub(pos).dot(f), fR = ST.feet.RightShown.clone().sub(pos).dot(f);
    const stride = Math.max(.15, L * 1.2);
    const legDiff = 1.2 * Math.tanh((fL - fR) / stride / 1.2); // +1: left foot forward (soft limit: a hard clamp kinked the pelvis and arms)
    // hips: bounce (low at contact), sway over the standing foot, height from the leg length
    const bounce = -Math.cos(4 * Math.PI * (ST.ph - .02)) * P.bob * amp;
    const swayS = Math.sin(2 * Math.PI * (ST.ph - Dt / 2 + .25)); // toward the left foot while it stands
    const hipPos = V(pos.x, pos.y + hipY - P.kneeBend * Math.min(1, amp + .3) + bounce, pos.z).addScaledVector(r, swayS * P.sway * sideSign.Left * Math.min(1, amp + .2)).addScaledVector(f, P.lean * .25 * amp);
    // reach: a foot far behind at toe-off (or far ahead at heel strike) is out of the leg's reach from the walking hip height,
    // and the IK clamped it short and let go a frame later (gate: 'jump' 13-15 cm/frame² on the knees). The hips sink just
    // enough that both planned ankles are within 97% of the leg, so the legs never snap straight.
    { let drop = 0; for (const s of ['Left', 'Right']) { const t = ST.feet[s + 'Shown']; const hj = hipPos.clone().addScaledVector(r, sideSign[s] * hipW); hj.y -= upOff;
        const hd = Math.hypot(t.x - hj.x, t.z - hj.z), R = legLen * .97; const allowed = hd < R ? Math.sqrt(R * R - hd * hd) : 0; drop = Math.max(drop, (hj.y - t.y) - allowed); }
      ST.drop = (ST.drop || 0) + (Math.max(0, drop) - (ST.drop || 0)) * (1 - Math.exp(-dt * 18)); hipPos.y -= ST.drop; }
    // the hips' local position from the world target (hips' parent is the armature)
    B.Hips.position.copy(B.Hips.parent.worldToLocal(hipPos.clone()));
    root.updateMatrixWorld(true);
    // root yaw is in the parent chain already; pelvis: turn with the legs, drop toward the swinging leg, lean into the walk
    const yawSgn = Math.sign(V(0, 1, 0).cross(r.clone().multiplyScalar(sideSign.Left)).dot(f)) || 1; // which turn brings the left hip forward
    const pYaw = legDiff * .16 * P.pelvisYaw * yawSgn;
    rotW(B.Hips, up, pYaw);
    rotW(B.Hips, f, swayS * .05 * amp * sideSign.Left * -1);
    rotW(B.Hips, r, P.lean * amp * .5);
    // chest: counter-turn, upright, a little forward into the walk; banks a touch into turns
    rotW(B.Spine1, up, -pYaw * P.chestCounter * .5); rotW(B.Spine2, up, -pYaw * P.chestCounter * .5);
    rotW(B.Spine, r, -P.lean * amp * .25); rotW(B.Spine2, f, clamp(-ST.av * .04, -.08, .08));
    // head level and facing the way he walks (look slot adds the gaze)
    { const want = Q().setFromAxisAngle(up, yaw).multiply(headRest); const cur = B.Head.getWorldQuaternion(Q());
      const Dw = want.clone().multiply(cur.clone().invert()); const half = Q().slerp(Dw, .5);
      setWorldQ(B.Neck, half.multiply(B.Neck.getWorldQuaternion(Q()))); setWorldQ(B.Head, want); }
    // ---------- legs ----------
    for (const s of ['Left', 'Right']) {
      const pole = f.clone().add(V(0, 0, 0)).addScaledVector(r, sideSign[s] * .1);
      // a planted foot keeps the heading it landed with (turning on the spot near the chair, the planted soles turned with the
      // body and the toes swept into the chair leg); within 0.6 rad of the body, past that the knee would twist
      const hs = ST.swing[s] ? ST.hs[s] : ST.hd[s] == null ? yaw : yaw + clamp(wrapA(ST.hd[s] - yaw), -.6, .6);
      const fH = fwdOf(hs), rH = rightOf(hs);
      const fq = Q().setFromAxisAngle(up, hs).multiply(footRestQ[s]);
      const leg = rl => {
        let t = ST.feet[s + 'Shown'];
        // heel up: the foot turns about the ball of the foot, not the ankle, so the ankle rises (turned about the ankle, the toes went
        // into the boards, the floor guard lifted the whole foot and the gate saw both feet 8-9 cm up, 'stands on air')
        if (rl > 0) { t = t.clone(); t.y += ballF * Math.sin(rl); t.addScaledVector(fH, -ballF * (1 - Math.cos(rl))); }
        ik2(B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot'], t, pole);
        // sole: heading + roll about the lateral axis
        setWorldQ(B[s + 'Foot'], Q().setFromAxisAngle(rH, rl + PITCH).multiply(fq));
      };
      leg(roll[s]);
      // a person's ankle bends up only so far: past it (a step up the stairs, a root, a long stride) the heel comes up and the foot
      // turns about its ball (gate: planted foot flat on the next stair, ankle 30-40 deg past his neutral)
      { const a = B[s + 'Foot'].getWorldPosition(V()), sh = a.clone().sub(B[s + 'Leg'].getWorldPosition(V())), fd = B[s + 'ToeBase'].getWorldPosition(V()).sub(a);
        const ex = sh.angleTo(fd) - ANKMAX; if (ex > .005) leg(roll[s] + ex * 1.15); }
    }
    // ---------- arms ----------
    const layer = window.__motion && window.__motion.S && window.__motion.S.layer;
    for (const s of ['Left', 'Right']) {
      const i0 = NAMES.indexOf(s + 'Shoulder');
      if (layer || holding(s)) { // keep the arm the action / the held thing needs: its local pose from underneath
        for (const n of ['Shoulder', 'Arm', 'ForeArm', 'Hand']) B[s + n].quaternion.copy(saved[NAMES.indexOf(s + n)]); B[s + 'Shoulder'].updateMatrixWorld(true); continue;
      }
      ST.armK = ST.armK || { Left: 1, Right: 1 };
      const sw = (s === 'Left' ? -legDiff : legDiff) * P.arm * Math.min(1, amp + .15) * ST.armK[s]; // forward when the other foot is forward
      const side = r.clone().multiplyScalar(sideSign[s]);
      const dUA = V(0, -1, 0).applyAxisAngle(r, 0).addScaledVector(f, Math.tan(clamp(sw, -1, 1))).addScaledVector(side, Math.tan(P.abd)).normalize();
      // the upper arm hangs from the shoulder in the swing direction (the shortest turn from the bind pose keeps the palm toward the thigh)
      aim(B[s + 'Arm'], B[s + 'ForeArm'], dUA);
      const el = P.elbow + P.elbowFwd * Math.max(0, sw) ; // more bend on the forward swing
      const ax = dUA.clone().cross(f).normalize();
      const dFA = dUA.clone().applyAxisAngle(ax, el);
      aim(B[s + 'ForeArm'], B[s + 'Hand'], dFA);
      // walking along a counter or the bunk: the swing narrows while the hand (8 cm ahead along its swing, 4 cm out) would be
      // in something (gate collide: right hand 6.6 cm into the kitchen counter)
      { const C = window.__collide; let hit = false; if (C && C.depthAt) { const h0 = B[s + 'Hand'].getWorldPosition(V()); for (const [a, b] of [[.12, .07], [-.12, .07], [0, .1]]) { const h = h0.clone().addScaledVector(f, a).addScaledVector(side, b); if (C.depthAt(h.x, h.y, h.z) > 0) { hit = true; break; } } }
        const tk = hit ? .25 : 1; ST.armK[s] += (tk - ST.armK[s]) * (1 - Math.exp(-dt * (hit ? 25 : 2))); }
    }
    // ---------- blend with the pose underneath ----------
    const w = smooth(ST.w);
    if (w < .999) { NAMES.forEach((n, i) => { B[n].quaternion.copy(saved[i].clone().slerp(B[n].quaternion, w)); }); B.Hips.position.lerpVectors(savedHip, B.Hips.position, w); }
    root.updateMatrixWorld(true);
  }
  // the last word on the ankle while the walk has the legs: the board/root steps and the floor guard after the walk re-solve the leg
  // to another ankle height (stairs down: the swing foot's ankle bent 45-50 deg past neutral, gate fix_wall/firewood/hunt). Past
  // a person's limit the heel comes up about the ball (planted) or the toes drop (in the air), never more than the excess
  function ankleCap() {
    const w = ST.w; if (!(w > .01) || window.__noGameWalk) return;
    for (const s of ['Left', 'Right']) {
      const F = B[s + 'Foot'], T = B[s + 'ToeBase'], Lg = B[s + 'Leg'], U = B[s + 'UpLeg']; if (!F || !T) continue;
      const a = F.getWorldPosition(V()), t = T.getWorldPosition(V()), k = Lg.getWorldPosition(V()); const sh = a.clone().sub(k), fd = t.clone().sub(a);
      const ex = (sh.angleTo(fd) - ANKMAX - .02) * w; if (!(ex > .005)) continue;
      const ax = fd.clone().cross(V(0, -1, 0)); if (ax.lengthSq() < 1e-8) continue; ax.normalize();
      const q = Q().setFromAxisAngle(ax, ex), fq = q.clone().multiply(F.getWorldQuaternion(Q()));
      if (!ST.swing[s]) { const a2 = t.clone().add(a.clone().sub(t).applyQuaternion(q)); const pole = k.clone().sub(U.getWorldPosition(V()).add(a).multiplyScalar(.5)); ik2(U, Lg, F, a2, pole.lengthSq() > 1e-8 ? pole.normalize() : fwdOf(root.rotation.y)); }
      setWorldQ(F, fq);
    }
  }
  if (hero.stage) hero.stage('pops', ankleCap);
  return { update, S: ST, P, M: { hipY, ankY, legLen, footX, hipW } };
}
