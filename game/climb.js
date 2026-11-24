// climb.js: the hero climbs the REAL rungs of every ladder (board ladders and rope ladders).
// Owner: the "Сделать лазание по лестницам естественным" thread. hero.js calls it from ladderStep (phase 'climb')
// and from post() (fenced "CLIMB HOOK" lines); window.__noClimb=true falls back to the old canned clip for before/after.
//
// How it works
//  * index.html registers every ladder with its rung list in window.__ladders ({x,z,y0,y1,rope,rungs:[{x,y,z,r,half}]}).
//  * Four limbs each sit on a rung index (-1 = the floor at the foot of the ladder). One "step" moves the lowest foot
//    (going up) or the highest foot (going down) past the other one, and, when the hands fall behind, the matching hand of
//    the other side (contralateral, like people climb). Steps chain without pauses; the body rises with the supporting foot.
//  * The canned climb clip 437 only gives the spine / head style: it is paused and scrubbed in step with the gait.
//    Hips are placed at a fixed distance from the ladder; arms and legs are solved with two-bone IK onto the rungs
//    (wrist just under and behind the rung, ball of the foot on top of it), swinging limbs arc away from the rungs.
//  * The IK weight fades in when he takes hold and out when he lets go, so the hand-off to walking / the pull-up is smooth.
export function createClimb() {
  let C = null, THREE = null, V = null;
  const M = {}; // body measures
  const S = { W: 0, wTarget: 0, act: null }; // act = current climb, W = IK weight (fades)
  const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (t * 6 - 15) + 10);
  const sstep = (a, b, x) => ease((x - a) / (b - a));
  const LIMBS = ['LF', 'RF', 'LH', 'RH'];

  function init(ctx) {
    C = ctx; THREE = ctx.THREE; V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const B = C.bones, wp = b => b.getWorldPosition(V());
    C.root.updateMatrixWorld(true);
    M.thigh = wp(B.LeftUpLeg).distanceTo(wp(B.LeftLeg)); M.shin = wp(B.LeftLeg).distanceTo(wp(B.LeftFoot));
    M.leg = M.thigh + M.shin; M.upper = wp(B.LeftArm).distanceTo(wp(B.LeftForeArm)); M.fore = wp(B.LeftForeArm).distanceTo(wp(B.LeftHand));
    M.footH = .117; M.footUp = .094; // ankle sits ~13 cm behind and 7.5 cm above the ball of the foot
    M.hipW = Math.abs(wp(B.LeftUpLeg).x - wp(B.RightUpLeg).x) || .18;
  }

  // the ladder of this route step (matched by position)
  function findLadder(x, lz) {
    const all = window.__ladders || []; let best = null, bd = 1e9;
    for (const l of all) { const d = Math.abs(l.x - x) + Math.abs(l.z - lz); if (d < bd) { bd = d; best = l; } }
    return bd < .6 ? best : null;
  }

  // the floor edge the ladder leads to (scan from the ladder away from the hero) and where he stands up there
  function edgeOf(o, lad) {
    const zDir = Math.sign(o.cz - o.lz) || 1;
    for (let k = 0; k < 60; k++) { const z = lad.z + zDir * .06 - zDir * k * .02; const f = C.floorAt(lad.x, o.yTop + .1, z, .15, .25); if (f != null && Math.abs(f - o.yTop) < .12) return z; }
    return lad.z - zDir * .05;
  }
  function topStand(o) { const lad = findLadder(o.x, o.lz); if (!lad) return null; const zDir = Math.sign(o.cz - o.lz) || 1; const e = edgeOf(o, lad); return V(lad.x, o.yTop, e - zDir * .42); }

  // ---- start a climb: called once when ladderStep enters its 'climb' phase ----
  // o = {up, x, lz, side, cz, yBot, yTop, fromTop}
  function begin(o) {
    const lad = findLadder(o.x, o.lz); if (!lad || !lad.rungs.length) return false;
    const B = C.bones, p = C.root.position, wp = b => b.getWorldPosition(V());
    C.root.updateMatrixWorld(true);
    // the head's and chest's own 'up' measured once while he stands upright (the rig's local axes are not the world up)
    // the palm's own normal, measured once while he stands with the arms hanging (palms toward the thighs)
    if (!M.pn && !o.fromTop && B.Hips) { M.pn = {}; const hp = wp(B.Hips); for (const s of ['Left', 'Right']) { const h = B[s + 'Hand']; if (!h) continue; const d = hp.clone().sub(wp(h)).setY(0); if (d.lengthSq() < 1e-6) continue; M.pn[s[0] + 'H'] = d.normalize().applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()).invert()); } }
    if (!M.uH && !o.fromTop && B.Head && B.Spine2) { M.uH = V(0, 1, 0).applyQuaternion(B.Head.getWorldQuaternion(new THREE.Quaternion()).invert()); M.uC = V(0, 1, 0).applyQuaternion(B.Spine2.getWorldQuaternion(new THREE.Quaternion()).invert()); }
    const zDir = Math.sign(o.cz - o.lz) || 1;
    const A = { o, lad, zDir, R: lad.rungs, up: o.up, K: 4, steps: 0, step: null, t: 0, mode: 'climb',
      Dhip: lad.rope ? .3 : .29, T: o.up ? .74 : .66, hx: lad.rope ? .2 : .17, fx: .1, limb: {}, grab: 0, floorY: o.yBot, fy: o.up ? 0 : 1 };
    A.edge = edgeOf(o, lad); A.P = V(lad.x, o.yTop, A.edge - zDir * .42);
    const nR = A.R.length;
    for (const k of LIMBS) A.limb[k] = { r: 0, w: 1 };
    if (o.fromTop) {
      // down from the floor above: start standing at the edge, back to the hole (the climb over the edge, played backwards)
      let h = 0; for (let i = 0; i < nR; i++) if (top(A, i) <= o.yTop - .2) h = i;
      A.limb.RF.r = h; A.limb.LF.r = h - 1; A.limb.LH.r = nR; A.limb.RH.r = nR;
      A.grab = 1; A.y = top(A, h - 1);
      startOver(A, -1, { LF: wp(B.LeftFoot), RF: wp(B.RightFoot) }, p.clone());
    } else {
      let n;
      if (o.up) n = -1; else { n = 0; let bd = 1e9; for (let i = 0; i < nR; i++) { const d = Math.abs(top(A, i) - p.y); if (d < bd) { bd = d; n = i; } } n = Math.min(n, nR - 2); }
      const hb = Math.min(nR - 2, n + A.K);
      A.limb.LF.r = n; A.limb.RF.r = o.up ? n : n + 1; A.limb.RH.r = hb; A.limb.LH.r = hb + 1;
      if (o.up) { A.limb.LF.floor = wp(B.LeftFoot); A.limb.RF.floor = wp(B.RightFoot); }
      for (const k of LIMBS) A.limb[k].from = wp(B[{ LF: 'LeftFoot', RF: 'RightFoot', LH: 'LeftHand', RH: 'RightHand' }[k]]);
      A.y = o.up ? o.yBot : top(A, n); A.y0 = p.y;
    }
    A.hl = C.H.lad; // this climb belongs to this ladder run only (a reset body / new route drops it)
    S.act = A; S.wTarget = 1; S.resid = null;
    // the limbs start exactly where they are and travel to the rungs (grab blend), so the IK is on at once: no frames where the
    // climb clip's raised arms swing through the beams around a hatch (QA: hand 9 cm into the kitchen floor joist)
    if (!o.fromTop) S.W = 1;
    return true;
  }

  // top of rung i (where a sole rests); -1 = the floor below, >= nR = the floor above
  function top(A, i) { if (i < 0) return A.floorY; if (i >= A.R.length) return A.o.yTop; const r = A.R[i]; return r.y + r.r; }
  function rungP(A, i) { if (i < 0) return V(A.lad.x, A.floorY, A.o.cz); const r = A.R[Math.min(i, A.R.length - 1)]; const q = V(r.x, r.y, r.z);
    // rope ladders sway in their vertex shader (wind.js windRope): follow the same offset so the hands stay on the rung on screen
    const W = window.__wind; if (A.lad.rope && A.lad.len && W && W.swayAt && r.sw > 0) { try { const o = W.swayAt(q, 1.1); const k = .05 * A.lad.len * r.sw * r.sw * (1 - .45 * (W.wet ? W.wet() : 0)); q.x += o.x * k; q.z += o.z * k; } catch (e) {} }
    return q; }
  // where each limb wants to be when it rests on rung i
  function restTarget(A, k, i) {
    const s = k[0] === 'L' ? 1 : -1, zD = A.zDir;
    const side = s * zD; // the hero faces -zDir; his left is +x when he faces -z
    if (k[1] === 'H') {
      if (i >= A.R.length) return V(A.lad.x + side * .24, A.o.yTop + .04, A.edge - zD * .1); // palm flat on the floor above
      const c = rungP(A, i); return c.add(V(side * A.hx, .015, zD * .065)); }// wrist just behind the rung at its height: the palm lies over the rung, fingers hooked over the front (no finger bones in this rig)
    if (i < 0) { const f = A.limb[k].floor; if (f && A.up) return f.clone(); return V(A.lad.x + side * A.fx, A.floorY + M.footUp, A.o.cz - zD * .02); }
    const c = rungP(A, i); const R = A.R[Math.min(i, A.R.length - 1)];
    return c.add(V(side * A.fx, R.r + .05 + M.footUp, zD * (M.footH - .02)));
  }

  // ---- over the top edge: s 0 = on the ladder (feet on the two top rungs, hands on the floor), 1 = standing up there ----
  function startOver(A, dir, feetTop, rootTop) {
    const L = A.limb; const h = L.LF.r > L.RF.r ? 'LF' : 'RF', l = h === 'LF' ? 'RF' : 'LF'; const zD = A.zDir;
    const ff = k => { const side = (k[0] === 'L' ? 1 : -1) * zD; return V(A.lad.x + side * .11, A.o.yTop + M.footUp, 0); };
    const FF = { [h]: ff(h).setZ(A.edge - zD * .24), [l]: ff(l).setZ(A.P.z - zD * .02) };
    if (feetTop) { FF.LF = feetTop.LF.clone(); FF.RF = feetTop.RF.clone(); }
    const P = rootTop ? rootTop.clone() : A.P.clone();
    A.mode = 'over'; A.C = { s: dir > 0 ? 0 : 1, dir, T: 1.55, h, l, FF, P, ys: top(A, L[l].r), hold: 0, idle: false };
  }
  function overTick(A, dt, p) {
    const c = A.C; if (c.hold > 0) c.hold -= dt; else c.s = Math.min(1, Math.max(0, c.s + c.dir * dt / c.T));
    const s = c.s;
    p.x = A.lad.x;
    p.y = lerp(c.ys, c.P.y, sstep(.12, .74, s));
    p.z = lerp(A.o.cz, c.P.z, sstep(.22, .9, s));
    // clip: standing idle up top, the climb pose on the ladder
    const wantIdle = s > .42; if (wantIdle !== c.idle) { c.idle = wantIdle; if (wantIdle) C.play(C.idle(), { fade: .5 }); else C.play('437', { speed: 0, fade: .5 }); }
    A.phase = 0;
    // hands leave the floor as he gets up
    A.limb.LH.w = A.limb.RH.w = 1 - sstep(.78, 1, s);
    if (c.dir > 0 && s >= 1) return 'off';
    if (c.dir < 0 && s <= 0) { A.mode = 'climb'; A.y = c.ys; A.C = null; A.limb.LH.w = A.limb.RH.w = 1; return null; }
    return null;
  }
  function overLimb(A, k) {
    const c = A.C, s = c.s, L = A.limb[k];
    if (k[1] === 'H') { // palms on the boards, then (as he stands up) the hands come down beside the thighs under IK: the climb clip's raised
      // arms never blend through 'arms straight out in front' on their way to the idle pose (frame review: zombie arms at the top)
      const f = restTarget(A, k, A.R.length); const e = sstep(.36, .72, s); if (e <= 0) return f;
      const sh = C.bones[(k[0] === 'L' ? 'Left' : 'Right') + 'Arm'].getWorldPosition(V()); const hp = C.bones.Hips.getWorldPosition(V());
      const out = sh.clone().sub(hp).setY(0); if (out.lengthSq() > 1e-6) out.normalize();
      const hang = sh.clone().add(V(0, -.55, 0)).addScaledVector(out, .05); hang.z -= A.zDir * .03;
      const q = f.lerp(hang, e); q.addScaledVector(out, Math.sin(Math.PI * e) * .06); return q; }
    const [a, b, lift] = k === c.h ? [.04, .46, .16] : [.5, .92, .2];
    const e = sstep(a, b, s); const from = restTarget(A, k, L.r), to = c.FF[k];
    // up first, then over the edge, then down onto the boards (a straight line clipped the floor's edge beam: gate, feet 5 cm into it)
    const eh = sstep(.3, 1, e), ev = sstep(0, .6, e); const q = from.clone().lerp(to, eh); q.y = lerp(from.y, to.y, ev) + Math.sin(Math.PI * e) * lift; return q;
  }

  // ---- one frame of climbing (root height, gait). Returns 'off' (standing on the floor above) | 'bottom' | null ----
  function tick(dt) {
    if (S.act && C.H.lad !== S.act.hl) { S.act = null; S.W = 0; S.wTarget = 0; S.last = null; }
    const A = S.act; if (!A) return 'lost';// the hook re-begins or finishes (a frozen ladder is never ok)
    const p = C.root.position;
    A.t += dt;
    if (A.mode === 'over') { const r = overTick(A, dt, p); if (r === 'off') { S.act = null; S.wTarget = 0; S.fade = .35; } return r; }
    C.play('437', { speed: 0, fade: .3 });
    // take hold first: hands go to their rungs, the body settles, then the steps start
    if (A.grab < 1) { A.grab = Math.min(1, A.grab + dt / .45); A.y = A.up ? A.o.yBot : lerp(A.y0, top(A, Math.min(A.limb.LF.r, A.limb.RF.r)), ease(A.grab)); placeRoot(A, p); return null; }
    if (A.mode === 'land') { // both feet on the floor: let go of the rungs, stand up
      A.lt += dt; A.limb.LH.w = A.limb.RH.w = 1 - sstep(0, .45, A.lt); placeRoot(A, p);
      if (A.lt > .5) { S.act = null; S.wTarget = 0; S.fade = .3; return 'bottom'; } return null; }
    if (!A.step) { A.step = planStep(A); if (!A.step) {
      if (A.up) { startOver(A, 1); return overTick(A, dt, p); }
      A.mode = 'land'; A.lt = 0; placeRoot(A, p); return null; } }
    const st = A.step; st.u += dt / st.T;
    const u = Math.min(1, st.u);
    for (const m of st.move) { const L = A.limb[m.k]; L.e = sstep(m.a, m.b, u); }
    A.y = lerp(st.y0, st.y1, sstep(st.ya, st.yb, u));
    A.phase = (A.steps + u) * .5;
    placeRoot(A, p);
    if (st.u >= 1) { for (const m of st.move) { const L = A.limb[m.k]; L.r = m.to; L.from = null; L.e = 0; } A.steps++; A.carry = st.u - 1; A.step = null; }
    return null;
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  function placeRoot(A, p) { p.y = A.y; p.x = A.lad.x; p.z = A.o.cz; } // hips are fixed exactly in post()

  function planStep(A) {
    const L = A.limb, nR = A.R.length, up = A.up;
    const fl = L.LF.r <= L.RF.r ? 'LF' : 'RF', fh = fl === 'LF' ? 'RF' : 'LF';
    let mf, to;
    if (up) { mf = fl; to = Math.max(L.LF.r, L.RF.r) + 1; if (L.LF.r === L.RF.r) to = L[mf].r + 1; }
    else { mf = fh; if (L.LF.r === L.RF.r) return null; to = Math.max(-1, Math.min(L.LF.r, L.RF.r) - 1); }
    const other = mf === 'LF' ? 'RF' : 'LF';
    const minAfter = Math.min(to, L[other].r);
    // going up: the next rung would be at the floor above: climb over the edge instead
    if (up && (to > nR - 1 || top(A, to) > A.o.yTop - .2)) return null;
    const move = [];
    const hLo = L.LH.r <= L.RH.r ? 'LH' : 'RH', hHi = hLo === 'LH' ? 'RH' : 'LH';
    let hand = null, hto = null;
    // hands: one rung higher than the other hand; past the top rung the palm goes flat on the floor above
    if (up) { if (L[hLo].r < minAfter + A.K && L[hLo].r < nR) { hand = hLo; hto = Math.min(nR, L[hHi].r + 1); if (hto > nR - 1) hto = top(A, minAfter) + 1.3 > A.o.yTop + .05 ? nR : (L[hHi].r === nR - 1 ? nR - 2 : nR - 1); if (hto === L[hLo].r) hand = null; } }
    else { if (L[hHi].r > minAfter + A.K) {/* going down the hands stay a rung lower: the body hangs lower under them */ hand = hHi; hto = Math.min(nR - 1, L[hLo].r - 1); if (L[hLo].r >= nR) hto = nR - 1; } }
    if (hand && hto === L[hand].r) hand = null;
    if (up) {
      if (hand) { move.push({ k: hand, to: hto, a: 0, b: .42, arc: .09 }); move.push({ k: mf, to, a: .3, b: .84, arc: .13 }); }
      else move.push({ k: mf, to, a: 0, b: .62, arc: .13 });
    } else {
      move.push({ k: mf, to, a: 0, b: .5, arc: .13 }); if (hand) move.push({ k: hand, to: hto, a: .4, b: .88, arc: .09 });
    }
    for (const m of move) { const l = L[m.k]; l.from = l.cur ? l.cur.clone() : restTarget(A, m.k, l.r); l.toP = restTarget(A, m.k, m.to); }
    const y0 = A.y, y1 = top(A, minAfter);
    const T = hand ? A.T : A.T * .8;
    const st = { move, u: A.carry || 0, T, y0, y1, ya: up ? (hand ? .22 : .1) : 0, yb: up ? 1 : .78 };
    A.carry = 0;
    return st;
  }

  // limb position this frame
  function limbPos(A, k) {
    if (A.mode === 'over') return overLimb(A, k);
    const L = A.limb[k]; const st = A.step; const m = st && st.move.find(q => q.k === k);
    if (m && L.from) {
      const e = L.e || 0; const q = L.from.clone().lerp(L.toP, e);
      const s = Math.sin(Math.PI * e); q.z += A.zDir * m.arc * s; q.y += (k[1] === 'F' ? .04 : .02) * s; return q;
    }
    if (A.grab < 1 && L.from) return L.from.clone().lerp(restTarget(A, k, L.r), ease(A.grab));
    return restTarget(A, k, L.r);
  }

  // ---- after the clip pose: hips to the ladder, limbs onto the rungs ----
  function post(dt) {
    // the body was reset (spawn / freeze guard / random start) while on a ladder: drop the climb at once
    if (S.act && C.H.lad !== S.act.hl) { S.act = null; S.W = 0; S.wTarget = 0; S.last = null; S.resid = null; }
    const A = S.act;
    // fade the IK weight (also after the climb ended, while the next clip takes over)
    const fadeT = A ? .3 : (S.fade || .3);
    S.W += Math.sign(S.wTarget - S.W) * Math.min(Math.abs(S.wTarget - S.W), dt / fadeT);
    if (S.W <= .001 && !A) { S.last = null; return; }
    const B = C.bones, root = C.root, wp = b => b.getWorldPosition(V());
    root.updateMatrixWorld(true);
    let tg, hw;
    if (A) {
      // scrub the climb clip in step with the gait (2 steps = one clip cycle)
      const a = C.actions['437']; if (a && C.H.cur === a) { a.timeScale = 0; const d = a.getClip().duration; a.time = ((A.phase || 0) % 1) * d; }
      // hips: fixed distance from the ladder, height from the lower supporting foot (a nearly straight leg)
      const fl = Math.min(A.limb.LF.r, A.limb.RF.r);
      const planeZ = rungP(A, Math.max(0, Math.min(fl, A.R.length - 1))).z;
      const hz = A.Dhip - (M.footH - .02); const hipUp = Math.sqrt(Math.max(.1, (M.leg * .95) ** 2 - hz * hz)) + M.footUp + .02;
      // on the floor (start / end of the climb) the hips stand where the clip puts them: blend that in and out
      const onFloor = A.mode !== 'over' && Math.max(A.limb.LF.r, A.limb.RF.r) < 0;
      A.fy += Math.sign((onFloor ? 0 : 1) - A.fy) * Math.min(Math.abs((onFloor ? 0 : 1) - A.fy), dt / .45);
      const sway = Math.sin((A.phase || 0) * Math.PI * 2) * .018;
      // over the edge: the correction is worked out for the body still on the ladder, and handed over to the standing clip
      let ko = 1, base = V(); if (A.mode === 'over') { ko = 1 - sstep(0, .6, A.C.s); base = root.position.clone().sub(V(A.lad.x, A.C.ys, A.o.cz)); }
      const hp = wp(B.Hips).sub(base);
      const want = V(A.lad.x + sway, (A.mode === 'over' ? A.C.ys : A.y) + hipUp, planeZ + A.zDir * A.Dhip);
      const d = want.sub(hp).multiplyScalar(ease(A.grab) * S.W * ko); d.y *= A.fy;
      root.position.add(d); root.updateMatrixWorld(true);
      // upper body close to the ladder (the climb clip leans back ~16 cm: hands could not reach the rungs): pitch the spine
      // so the neck is ~24 cm from the rungs, split between the lower and the middle spine
      // with the palms on the floor above he leans over the edge (neck over the top of the ladder)
      { const flat = A.limb.LH.r >= A.R.length || A.limb.RH.r >= A.R.length; const want = flat ? .08 : .24; A.nd = A.nd == null ? want : A.nd + Math.sign(want - A.nd) * Math.min(Math.abs(want - A.nd), dt * .5); }
      if (A.mode !== 'over' || A.C.s < .85) { const kk = S.W * ease(A.grab) * (A.mode === 'over' ? 1 - sstep(.45, .85, A.C.s) : 1);
        for (const [bn, part] of [['Spine', .5], ['Spine1', 1]]) { const nk = wp(B.Neck); const dz = (nk.z - planeZ) * A.zDir - A.nd; if (Math.abs(dz) < .005) break;
          const goal = nk.clone(); goal.z -= A.zDir * dz * part; C.turnBone(B[bn], nk, goal, kk); } }
      // keep the chest and head off the rungs: the body leans back from the ladder if they come too close
      // (only below the top of the ladder: above it there is nothing to hit; eased, and handed over smoothly at the edge)
      { let need = 0; const topY = A.R[A.R.length - 1].y + .1; if (A.mode !== 'over') for (const [bn, minD] of [['Spine2', .2], ['Head', .19]]) { const q = wp(B[bn]); if (q.y > topY) continue; const dz = (q.z - planeZ) * A.zDir; need = Math.max(need, minD - dz); }
        A.gz = (A.gz || 0) + Math.sign(need - (A.gz || 0)) * Math.min(Math.abs(need - (A.gz || 0)), dt * .8);
        if (A.gz > 1e-4) { root.position.z += A.zDir * A.gz; root.updateMatrixWorld(true); } }
      tg = {}; for (const k of LIMBS) { tg[k] = limbPos(A, k); A.limb[k].cur = tg[k].clone(); }
      hw = { LH: A.limb.LH.w, RH: A.limb.RH.w };
      S.last = { tg, zDir: A.zDir, hw, hangE: A.mode === 'over' ? sstep(.36, .72, A.C.s) : 0, flat: { LH: A.limb.LH.r >= A.R.length, RH: A.limb.RH.r >= A.R.length } };
      // look at the hand that moves next (or between the hands); over the edge: ahead
      const nh = A.step && A.step.move.find(m => m.k[1] === 'H');
      { const hd = wp(B.Head); // eyes on the rungs ahead, a little above the head at most (no head thrown back)
        let L = A.mode === 'over' ? V(A.P.x, hd.y + .3, A.P.z - A.zDir * 1.6) : (nh ? A.limb[nh.k].toP : tg.LH.clone().lerp(tg.RH, .5)).clone();
        if (A.mode !== 'over') { L.y = Math.min(L.y, hd.y + .2); L.z = planeZ; }
        C.H.look = L; C.H.lookW = .35; A.lookPt = L; }
    } else { tg = S.last && S.last.tg; hw = S.last && S.last.hw; }
    if (!tg) return;
    const W = S.W; const zDir = S.last.zDir;
    // legs: knees forward between the rungs and a little out, then the ball of the foot onto the rung
    for (const s of ['Left', 'Right']) {
      const t = tg[s[0] + 'F']; const sx = (s === 'Left' ? 1 : -1) * zDir;
      C.ik2(B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot'], t, V(sx * .3, .55, -zDir), W, false);
      const F = B[s + 'Foot'], Tb = B[s + 'ToeBase'];
      if (F && Tb) { const a = wp(F), toe = wp(Tb); const d = V(0, -M.footUp, -zDir * M.footH);
        // a real ankle: the toes point away from the calf side of the shin (the hip side), whatever the leg does when it folds deep
        // over the edge (gate: 'knee bent the wrong way' when the toes swung to the hip side of a near-level shin)
        const kn = wp(B[s + 'Leg']), hp = wp(B[s + 'UpLeg']); const sh = a.clone().sub(kn).normalize(); const o = hp.clone().sub(kn); o.addScaledVector(sh, -o.dot(sh));
        if (o.lengthSq() > 1e-6) { o.normalize(); const dl = d.length(); const k = d.dot(o); if (k > -.35 * dl) { d.addScaledVector(o, -k - .35 * dl); d.setLength(dl); } }
        C.turnBone(F, toe, a.clone().add(d), W); }
    }
    // arms: elbows down and out, wrist under and behind the rung, fingers over it (or the palm flat on the floor above)
    for (const s of ['Left', 'Right']) {
      const k = s[0] + 'H'; const t = tg[k]; const sx = (s === 'Left' ? 1 : -1) * zDir; const w = W * (hw ? hw[k] : 1); if (w < .002) continue;
      C.ik2(B[s + 'Arm'], B[s + 'ForeArm'], B[s + 'Hand'], t, V(sx * .7, -1, zDir * .45), w, false);
      const Hd = B[s + 'Hand']; if (Hd) { const a = wp(Hd); const dir = V(0, 1, 0).applyQuaternion(Hd.getWorldQuaternion(new THREE.Quaternion())); const tip = a.clone().addScaledVector(dir, .09);
        const flat = S.last.flat && S.last.flat[k];
        const he = S.last.hangE || 0; const aim = flat ? V(0, -.015, -zDir * .09).lerp(V(0, -.09, -zDir * .015), he) : V(0, -.02, -zDir * .09);
        C.turnBone(Hd, tip, a.clone().add(aim), w);
        // palm onto the rung (facing the ladder and a little down) or flat on the boards (facing down), not turned out to the side
        if (M.pn && M.pn[k]) { const hq = Hd.getWorldQuaternion(new THREE.Quaternion()); const fa = V(0, 1, 0).applyQuaternion(hq).normalize(); const n = M.pn[k].clone().applyQuaternion(hq);
          const want = flat ? V(0, -1, 0).lerp(V(-sx * zDir, 0, 0), he) : V(0, -1, -zDir * .25); n.addScaledVector(fa, -n.dot(fa)); want.addScaledVector(fa, -want.dot(fa));
          if (n.lengthSq() > 1e-6 && want.lengthSq() > 1e-6) { n.normalize(); want.normalize(); const ang = Math.atan2(n.clone().cross(want).dot(fa), n.dot(want)); rotWorld(Hd, fa, ang * w); } } }
    }
    if (A && A.lookPt) aimHead(A.lookPt, W * .85);
  }

  // the head looks where he climbs (the climb clip throws it back to the ceiling): Neck 40 % / Head 60 %, kept within a
  // human pitch range, after the limbs so nothing turns it back afterwards
  const _q1 = () => new THREE.Quaternion();
  function aimHead(pt, w) {
    const B = C.bones, Hd = B.Head, Nk = B.Neck; if (!Hd || !Nk || !pt || w < .01) return;
    for (const [b, part] of [[Nk, .4], [Hd, 1]]) {
      const hp = Hd.getWorldPosition(V()); const f = V(0, 0, 1).applyQuaternion(Hd.getWorldQuaternion(_q1()));
      const want = pt.clone().sub(hp).normalize();
      // pitch only up to 30 deg up / 35 deg down from level
      const hz = Math.hypot(want.x, want.z) || 1e-3; let pit = Math.atan2(want.y, hz); pit = Math.max(-.6, Math.min(.52, pit)); want.set(want.x / hz * Math.cos(pit), Math.sin(pit), want.z / hz * Math.cos(pit));
      const dq = _q1().setFromUnitVectors(f, want); dq.slerp(_q1(), 1 - w * part);
      const bq = b.getWorldQuaternion(_q1()), pq = b.parent.getWorldQuaternion(_q1());
      b.quaternion.copy(pq.invert().multiply(dq.multiply(bq))); b.updateMatrixWorld(true);
    }
    headLimits(Math.min(1, w / .85));
  }
  // a human neck (pelvis and head face local +Z): the head stays within 65 deg of the pelvis in yaw and rolls at most ~5 deg (no owl, no ear on the shoulder)
  function rotWorld(b, axis, ang) { const pq = b.parent.getWorldQuaternion(_q1()); const bq = b.getWorldQuaternion(_q1()); const r = _q1().setFromAxisAngle(axis, ang); b.quaternion.copy(pq.invert().multiply(r.multiply(bq))); b.updateMatrixWorld(true); }
  function headLimits(w) {
    const B = C.bones, Hd = B.Head; if (!Hd || !B.Hips) return; const Y = V(0, 1, 0);
    const hq = Hd.getWorldQuaternion(_q1()); const f = V(0, 0, 1).applyQuaternion(hq); const pf = V(0, 0, 1).applyQuaternion(B.Hips.getWorldQuaternion(_q1()));
    const fh = V(f.x, 0, f.z), ph = V(pf.x, 0, pf.z);
    if (fh.lengthSq() > 1e-4 && ph.lengthSq() > 1e-4) { fh.normalize(); ph.normalize(); const a = Math.atan2(fh.x, fh.z) - Math.atan2(ph.x, ph.z); const d = Math.atan2(Math.sin(a), Math.cos(a)); const M = 1.13;
      if (Math.abs(d) > M) { const ex = d - Math.sign(d) * M; if (B.Neck) rotWorld(B.Neck, Y, -ex * .5 * w); rotWorld(Hd, Y, -ex * .5 * w); } }
    // nod/side bend: the head's up stays within 55 deg of the chest's up (gate: head tipped 70-88 deg back while looking up the ladder)
    if (B.Spine2) { const hu = (M.uH || V(0, 1, 0)).clone().applyQuaternion(Hd.getWorldQuaternion(_q1())), cu = (M.uC || V(0, 1, 0)).clone().applyQuaternion(B.Spine2.getWorldQuaternion(_q1())); const a = hu.angleTo(cu), MT = .96;
      if (a > MT) { const ax = hu.clone().cross(cu); if (ax.lengthSq() > 1e-8) { ax.normalize(); const ex = (a - MT) * w; if (B.Neck) rotWorld(B.Neck, ax, ex * .5); rotWorld(Hd, ax, ex * .5); } } }
    const q2 = Hd.getWorldQuaternion(_q1()); const f2 = V(0, 0, 1).applyQuaternion(q2), u = Y.clone().applyQuaternion(q2); const sd = f2.clone().cross(Y); if (sd.lengthSq() < 1e-4) return; sd.normalize();
    const roll = Math.asin(Math.max(-1, Math.min(1, u.dot(sd)))); const RM = .09; const ex = roll > RM ? roll - RM : roll < -RM ? roll + RM : 0; if (Math.abs(ex) > 1e-3) rotWorld(Hd, f2.normalize(), -ex * w);
  }

  return { init, begin, tick, post, topStand, get active() { return !!S.act; }, get weight() { return S.W; }, state: S, M,
    // for tests: where each limb should be now
    targets: () => S.last && S.last.tg };
}
