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
  const sine = t => t <= 0 ? 0 : t >= 1 ? 1 : .5 - .5 * Math.cos(Math.PI * t);
  const LIMBS = ['LF', 'RF', 'LH', 'RH'];

  function init(ctx) {
    C = ctx; THREE = ctx.THREE; V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const B = C.bones, wp = b => b.getWorldPosition(V());
    C.root.updateMatrixWorld(true);
    M.thigh = wp(B.LeftUpLeg).distanceTo(wp(B.LeftLeg)); M.shin = wp(B.LeftLeg).distanceTo(wp(B.LeftFoot));
    M.leg = M.thigh + M.shin; M.upper = wp(B.LeftArm).distanceTo(wp(B.LeftForeArm)); M.fore = wp(B.LeftForeArm).distanceTo(wp(B.LeftHand));
    M.footH = .117; M.footUp = .094; M.ankFloor = .136; M.toeFloor = .079; /* standing on the boards (gate, both heroes): ankle 13.6 cm, toe 7.9 cm above the floor */ // ankle sits ~13 cm behind and 7.5 cm above the ball of the foot
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
  // standing up at the top: the hips 20 cm clear of a post or rail beside the opening (bl_t: the bedroom guard rail 16 cm left of the ladder line,
  // the thigh stood 1-3 cm in it the whole time); probed once per ladder top at thigh and hip height, shifted sideways at most 8 cm
  const _ss = {};
  function sideShift(x, y, z) {
    const key = x.toFixed(2) + ',' + y.toFixed(2) + ',' + z.toFixed(2); if (_ss[key] != null) return _ss[key];
    const CD = window.__collide; let L = .35, R = .35;
    if (CD && CD.depthAt) { try { for (const h of [.55, .7, .85, 1]) for (const dz of [-.08, 0, .08]) for (let d = .1; d <= .35; d += .01) { let hitL = false, hitR = false;
      const vl = CD.depthAt(x - d, y + h, z + dz), vr = CD.depthAt(x + d, y + h, z + dz); hitL = (typeof vl === 'number' ? vl : (vl && vl.depth) || 0) > .002; hitR = (typeof vr === 'number' ? vr : (vr && vr.depth) || 0) > .002;
      if (hitL) L = Math.min(L, d); if (hitR) R = Math.min(R, d); if (hitL || hitR) break; } } catch (e) { L = R = .35; } }
    let sh = 0; if (L < .25 && R > L) sh = Math.min(.1, .25 - L, (R - L) / 2); else if (R < .25 && L > R) sh = -Math.min(.1, .25 - R, (L - R) / 2); /* 25 cm: the v6 arms brushed the door post at the top of the bedroom ladder (3 cm in) */
    return (_ss[key] = sh);
  }
  function topStand(o) { const lad = findLadder(o.x, o.lz); if (!lad) return null; const zDir = Math.sign(o.cz - o.lz) || 1; const e = edgeOf(o, lad); const z = e - zDir * .42; return V(lad.x + sideShift(lad.x, o.yTop, z), o.yTop, z); }

  // ---- start a climb: called once when ladderStep enters its 'climb' phase ----
  // o = {up, x, lz, side, cz, yBot, yTop, fromTop}
  // the palm's own normal and the head's and chest's own 'up', measured once while he stands or walks with the arms hanging (palms toward the
  // thighs). Before, only at the first climb from the bottom: a day that began by going down never had it, and on the way onto the ladder the
  // palms stayed up in the air (watch: R20-2 at the hatch, the inner ladder and the deck). Also tried every frame off the ladder until it works
  function calib() {
    const B = C.bones, wp = b => b.getWorldPosition(V()); if (M.pn && M.uH) return; if (!B.Hips || !B.LeftHand || !B.RightHand) return;
    const hp = wp(B.Hips), l = wp(B.LeftHand), r = wp(B.RightHand);
    const la = B.LeftArm ? wp(B.LeftArm).y : hp.y + .5, ra = B.RightArm ? wp(B.RightArm).y : hp.y + .5; if (!(l.y < hp.y + .12 && r.y < hp.y + .12 && l.y < la - .35 && r.y < ra - .35 && Math.hypot(l.x - hp.x, l.z - hp.z) < .35 && Math.hypot(r.x - hp.x, r.z - hp.z) < .35 && (!B.Head || wp(B.Head).y > hp.y + .45))) return;
    if (!M.pn) { M.pn = {}; for (const s of ['Left', 'Right']) { const h = B[s + 'Hand']; const d = hp.clone().sub(wp(h)).setY(0); if (d.lengthSq() < 1e-6) continue; M.pn[s[0] + 'H'] = d.normalize().applyQuaternion(h.getWorldQuaternion(new THREE.Quaternion()).invert()); } }
    if (!M.uH && B.Head && B.Spine2) { M.uH = V(0, 1, 0).applyQuaternion(B.Head.getWorldQuaternion(new THREE.Quaternion()).invert()); M.uC = V(0, 1, 0).applyQuaternion(B.Spine2.getWorldQuaternion(new THREE.Quaternion()).invert()); }
  }
  function begin(o) {
    const lad = findLadder(o.x, o.lz); if (!lad || !lad.rungs.length) return false;
    const B = C.bones, p = C.root.position, wp = b => b.getWorldPosition(V());
    C.root.updateMatrixWorld(true);
    // the head's and chest's own 'up' measured once while he stands upright (the rig's local axes are not the world up)
    // the palm's own normal, measured once while he stands with the arms hanging (palms toward the thighs)
    calib();
    if (!M.arm && B.LeftArm && B.LeftForeArm && B.LeftHand) M.arm = wp(B.LeftArm).distanceTo(wp(B.LeftForeArm)) + wp(B.LeftForeArm).distanceTo(wp(B.LeftHand));
    if (!M.shH && B.LeftArm && B.Hips && M.leg) M.shH = Math.max(.2, wp(B.LeftArm).distanceTo(wp(B.Hips))) + M.leg; // shoulder over the sole with the leg straight
    const zDir = Math.sign(o.cz - o.lz) || 1;
    const A = { o, lad, zDir, R: lad.rungs, up: o.up, K: 4, steps: 0, step: null, t: 0, mode: 'climb',
      Dhip: lad.rope ? .27 : .26, T: o.up ? .6 : .58, hx: lad.rope ? .15 : .14, fx: .1, limb: {}, grab: 0, floorY: o.yBot, fy: o.up ? 0 : 1 };
    A.edge = edgeOf(o, lad); A.P = V(lad.x, o.yTop, A.edge - zDir * .42); A.P.x += sideShift(lad.x, o.yTop, A.P.z);
    const nR = A.R.length;
    if (B.LeftArm && B.RightArm) A.sh0 = Math.max(.6, Math.min(1.6, (wp(B.LeftArm).y + wp(B.RightArm).y) / 2 - p.y)); /* the real shoulder height over the soles, standing (the estimate from the leg put the v6 shoulder 25 cm too low: hands went to rungs at the waist) */
    for (const k of LIMBS) A.limb[k] = { r: 0, w: 1 };
    if (o.fromTop) {
      // down from the floor above: start standing at the edge, back to the hole (the climb over the edge, played backwards)
      let h = 0; for (let i = 0; i < nR; i++) if (top(A, i) <= o.yTop - .2) h = i;
      A.limb.RF.r = h; A.limb.LF.r = h - 1; A.limb.LH.r = nR; A.limb.RH.r = nR;
      A.grab = 1; A.y = top(A, h - 1);
      startOver(A, -1, { LF: wp(B.LeftFoot), RF: wp(B.RightFoot) }, p.clone());
    } else {
      if (o.up && p.y < o.yBot + .08 && p.y > o.yBot - .5) { o.yBot = p.y; A.floorY = p.y; } /* (also a threshold board a few cm up: the root dropped 4 cm at the mount) */ /* the floor he really stands on (gate: root up 26 cm in one frame at the rope ladder's foot) */ 
      let n;
      if (o.up) n = -1; else { n = 0; let bd = 1e9; for (let i = 0; i < nR; i++) { const d = Math.abs(top(A, i) - p.y); if (d < bd) { bd = d; n = i; } } n = Math.min(n, nR - 2); }
      let hb = Math.min(nR - 2, n + A.K); { const ry = reachY(A, o.up ? o.yBot : top(A, n)); while (hb > Math.max(0, n + 1) && top(A, hb + 1) + .015 > ry) hb--; }
      /* and not below the arm's reach either: the first grab went to rungs 70 cm under the shoulder of the short-armed v6 (hands 35-60 cm off their rungs at every mount) */
      if (B.LeftArm && M.arm) { const shY = (o.up ? o.yBot : top(A, n)) + (wp(B.LeftArm).y - p.y), lo = shY - M.arm * .9, ry = reachY(A, o.up ? o.yBot : top(A, n)); while (hb < nR - 2 && top(A, hb) + .015 < lo && top(A, hb + 2) + .015 <= ry + .04) hb++; }
      A.limb.LF.r = n; A.limb.RF.r = o.up ? n : n + 1; A.limb.RH.r = hb; A.limb.LH.r = hb + 1;
      if (o.up) { const ft = k => { const q = wp(B[k]), f = S.ft && S.ft[k[0] + 'F']; return f && f.distanceTo(q) < .15 ? f.clone() : q; }; A.limb.LF.floor = ft('LeftFoot'); A.limb.RF.floor = ft('RightFoot'); } /* from last frame's final feet (the raw clip feet were 5 cm off: both feet slid at the first frame of the mount) */
      for (const k of LIMBS) A.limb[k].from = wp(B[{ LF: 'LeftFoot', RF: 'RightFoot', LH: 'LeftHand', RH: 'RightHand' }[k]]);
      if (o.up) { A.limb.LF.from = A.limb.LF.floor.clone(); A.limb.RF.from = A.limb.RF.floor.clone(); } /* the feet stay put: the walk's pop offsets still ease out after the IK, so the IK holds the feet as they were before them (both feet slid 5 cm in the first frame: gate, foot jump 11 cm/frame² at kh_b) */
      A.y = A.y0 = p.y; A.p0 = p.clone(); if (o.up && B.Hips) A.hip0 = wp(B.Hips).y - p.y; /* the standing hip height: kept while both feet are on the ground */
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
  // height of the flat palm on the floor above: over the real boards (the deck's edge beam stands 3 cm above the floor height,
  // and the fingers hang ~5 cm below the wrist: gate, fingers 4-6 cm into the 349x28x12 beam at the top of the rope ladder)
  function palmY(A) {
    if (A.palmY != null) return A.palmY; const CD = window.__collide; let top = -1e9;
    if (CD && CD.depthAt) { try { for (const sd of [-1, 1]) for (let dz = 0; dz <= .16; dz += .04) { const x = A.lad.x + sd * .16, z = A.edge - A.zDir * (.03 + dz);
      for (let y = A.o.yTop + .15; y > A.o.yTop - .06; y -= .005) { const d = CD.depthAt(x, y, z); if ((typeof d === 'number' ? d : (d && d.depth) || 0) > .002) { top = Math.max(top, y); break; } } } } catch (e) { top = -1e9; }
      if (top > -1e9) A.palmY = Math.max(A.o.yTop + .04, Math.min(A.o.yTop + .12, top + .055)); }
    return A.palmY != null ? A.palmY : A.o.yTop + .04;
  }
  // top of the boards under a foot stepping off the bottom rung (a threshold board under the hatch ladder stands 3 cm above the
  // floor height: gate, soles 4.3 cm into the 332x24x9 board at the bottom of kh); the sole spans ~10 cm, so the highest of three probes
  function floorTop(A, x, z) {
    A.ft = A.ft || {}; const key = x.toFixed(2) + ',' + z.toFixed(2); if (A.ft[key] != null) return A.ft[key];
    const CD = window.__collide; let top = -1e9;
    if (CD && CD.depthAt) { try { for (const dz of [-.06, 0, .06]) for (let y = A.floorY + .08; y > A.floorY - .03; y -= .004) { const d = CD.depthAt(x, y, z + dz); if ((typeof d === 'number' ? d : (d && d.depth) || 0) > .002) { top = Math.max(top, y); break; } } } catch (e) { top = -1e9; } }
    return (A.ft[key] = top > -1e9 ? Math.min(top, A.floorY + .06) : A.floorY);
  }
  // how far the climbing body may lean back from the rungs before its back meets something (a wall 45 cm behind the hatch ladder kh:
  // pushed back for the knees, the back went 6 cm into it). Probed once per 10 cm of height, from the hips to the shoulders
  function backRoom(A, y, planeZ) {
    A.br = A.br || {}; const key = Math.round(y * 10); if (A.br[key] != null) return A.br[key];
    const CD = window.__collide; let free = .6;
    if (CD && CD.depthAt) { try { for (const h of [.15, .5, .85, 1.15, 1.3, 1.45]) for (const sx of [-.13, .13]) for (let d = A.Dhip; d < .6 + A.Dhip; d += .02) { const v = CD.depthAt(A.lad.x + sx, y + h, planeZ + A.zDir * d); if ((typeof v === 'number' ? v : (v && v.depth) || 0) > .002) { free = Math.min(free, d - A.Dhip); break; } } } catch (e) { free = 0; } }
    return (A.br[key] = Math.max(0, free - .17)); /* the back is ~15 cm behind the hip line, and 2 cm to spare */
  }
  // how far out to the side a palm goes on the floor above: 16 cm, less when a post stands beside the opening (bl_t: a 75x29x5 board 21 cm
  // left of the ladder line, the left palm and forearm 2.5 cm in it on every pass); the palm's edge keeps 7.5 cm off it
  function handOff(A, side) {
    A.hO = A.hO || {}; if (A.hO[side] != null) return A.hO[side]; const CD = window.__collide; let free = .4;
    if (CD && CD.depthAt) { try { for (const h of [.06, .15, .3]) for (const dz of [.03, .12]) for (let d = .1; d <= .3; d += .01) { const v = CD.depthAt(A.lad.x + side * d, A.o.yTop + h, A.edge - A.zDir * dz); if ((typeof v === 'number' ? v : (v && v.depth) || 0) > .002) { free = Math.min(free, d); break; } } } catch (e) { free = .4; } }
    return (A.hO[side] = Math.max(.1, Math.min(.16, free - .075)));
  }
  // where each limb wants to be when it rests on rung i
  function restTarget(A, k, i) {
    const s = k[0] === 'L' ? -1 : 1, zD = A.zDir;
    const side = s * zD; // the hero faces -zDir; his left is -x when he faces -z (body axes +Z, no mirrored root)
    if (k[1] === 'H') {
      if (i >= A.R.length) return V(A.lad.x + side * handOff(A, side), palmY(A), A.edge - zD * .03); // palm flat on the floor above
      const c = rungP(A, i).add(V(side * A.hx, .01, 0));
      // the palm (7 cm up the forearm line from the wrist) on the rung: the wrist sits back along the forearm from the rung
      const sh = C.bones[(k[0] === 'L' ? 'Left' : 'Right') + 'Arm']; const el = sh ? sh.getWorldPosition(V()).add(V(0, -.22, zD * .04)) : c.clone().add(V(0, -.3, zD * .25));
      const dir = c.clone().sub(el); if (dir.lengthSq() < 1e-6) dir.set(0, 1, -zD); dir.normalize(); return c.addScaledVector(dir, -.06); }// wrist just behind the rung at its height: the palm lies over the rung, fingers hooked over the front (no finger bones in this rig)
    if (i < 0) { const f = A.limb[k].floor; if (f && A.up) return f.clone(); const fx = A.lad.x + side * A.fx, fz = A.o.cz - zD * .02; return V(fx, Math.max(A.floorY, floorTop(A, fx, fz)) + M.ankFloor, fz); } // a flat foot on the boards: the ankle as high as in the standing pose (footUp is the rung's ball-of-the-foot stance: the sole sank 4-5 cm)
    const c = rungP(A, i); const R = A.R[Math.min(i, A.R.length - 1)];
    return c.add(V(side * A.fx, R.r + .012 + M.footUp + ((A.tadj && A.tadj[k]) || 0), zD * (M.footH - .03))); // tadj: measured toe height trim per foot
  }

  // ---- over the top edge: s 0 = on the ladder (feet on the two top rungs, hands on the floor), 1 = standing up there ----
  function startOver(A, dir, feetTop, rootTop) {
    const L = A.limb; const h = L.LF.r > L.RF.r ? 'LF' : 'RF', l = h === 'LF' ? 'RF' : 'LF'; const zD = A.zDir;
    const ff = k => { const side = (k[0] === 'L' ? -1 : 1) * zD; return V(A.lad.x + side * .11, A.o.yTop + M.footUp, 0); };
    const FF = { [h]: ff(h).setZ(A.edge - zD * .24), [l]: ff(l).setZ(A.P.z - zD * .02) };
    if (feetTop) { FF.LF = feetTop.LF.clone(); FF.RF = feetTop.RF.clone(); }
    const P = rootTop ? rootTop.clone() : A.P.clone();
    const fromClimb = A.mode === 'climb'; A.mode = 'over'; A.C = { s: dir > 0 ? 0 : 1, dir, T: dir > 0 ? 1.35 : 1.55, h, l, FF, P, ys: dir > 0 && fromClimb ? A.y : top(A, L[l].r), hold: 0, idle: false };
  }
  function overTick(A, dt, p) {
    const c = A.C; if (c.hold > 0) c.hold -= dt; else c.s = Math.min(1, Math.max(0, c.s + c.dir * dt / c.T));
    const s = c.s;
    p.x = lerp(A.lad.x, c.P.x, sstep(.75, 1, s)); // from where he stood at the edge (gate: x snapped 12 cm onto the ladder's axis)
    p.y = lerp(c.ys, c.P.y, sstep(.12, .74, s));
    p.z = lerp(A.o.cz, c.P.z, sstep(.22, .9, s));
    // clip: standing idle up top, the climb pose on the ladder
    const wantIdle = s > .42; if (wantIdle !== c.idle) { c.idle = wantIdle; if (wantIdle) C.play(C.idle(), { fade: .5 }); else C.play('437', { speed: 0, fade: .5 }); }
    if (A.phase == null) A.phase = 0; /* the climb clip's scrub stays where the last step left it (reset to 0 it moved the hips 5 cm in a frame at the edge) */
    // hands leave the floor as he gets up
    A.limb.LH.w = A.limb.RH.w = 1 - sstep(.78, 1, s);
    if (c.dir > 0 && s >= 1) { if (C.H.look === A.lookPt || C.H.look) { C.H.look = null; C.H.lookW = 0; } return 'off'; }
    if (c.dir < 0 && s <= 0) { A.mode = 'climb'; A.y = c.ys; A.C = null; A.limb.LH.w = A.limb.RH.w = 1; return null; }
    return null;
  }
  function overLimb(A, k) {
    const c = A.C, s = c.s, L = A.limb[k];
    if (k[1] === 'H') { // palms on the boards, then (as he stands up) the hands come down beside the thighs under IK: the climb clip's raised
      // arms never blend through 'arms straight out in front' on their way to the idle pose (frame review: zombie arms at the top)
      let f = restTarget(A, k, A.R.length);
      // a hand still on a rung when the body comes up to the edge (the boards were out of its reach): onto the boards now, up first, then over the beam
      if (L.r < A.R.length && c.dir > 0) { const g = restTarget(A, k, L.r), u = (s - (k === 'LH' ? 0 : .08)) / .26; const ey = sine(u / .6), ez = sine((u - .4) / .6);
        f = V(lerp(g.x, f.x, ez), lerp(g.y, f.y, ey) + Math.sin(Math.PI * Math.min(1, Math.max(0, u))) * .03, lerp(g.z, f.z, ez)); if (u >= 1) L.r = A.R.length; }
      const e = sstep(.36, .72, s); if (e <= 0) return f;
      const sh = C.bones[(k[0] === 'L' ? 'Left' : 'Right') + 'Arm'].getWorldPosition(V()); const hp = C.bones.Hips.getWorldPosition(V());
      const out = sh.clone().sub(hp).setY(0); if (out.lengthSq() > 1e-6) out.normalize();
      const hang = sh.clone().add(V(0, -.5, 0)).addScaledVector(out, .1); /* clear of a tool hung on the hip (gate: forearm 2 cm through the belt hammer at bl_t / kh_t) */ hang.z -= A.zDir * .03;
      const q = f.lerp(hang, e); q.addScaledVector(out, Math.sin(Math.PI * e) * .06); return q; }
    const [a, b, lift] = c.dir < 0 ? (k === c.h ? [.24, .54, .13] : [.46, .76, .18]) : (k === c.h ? [.2, .62, .13] : [.6, .95, .18]); // going down a foot leaves the floor only once the body is low enough to reach the rung
    const e = sine((s - a) / (b - a)); const from = restTarget(A, k, L.r), to = c.FF[k];
    // up first, then over the edge, then down onto the boards (a straight line clipped the floor's edge beam: gate, feet 5 cm into it)
    const eh = sine((e - .25) / .75), ev = sine(e / .75); /* gentle and overlapping (gate: foot and knee jumps stepping onto the boards) */ const q = from.clone().lerp(to, eh); q.y = lerp(from.y, to.y, ev) + Math.sin(Math.PI * e) * lift; return q;
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
    if (A.grab < 1) { A.grab = Math.min(1, A.grab + dt / .45); const e = ease(A.grab); A.y = lerp(A.y0, A.up ? A.o.yBot : top(A, Math.min(A.limb.LF.r, A.limb.RF.r)), e); placeRoot(A, p);
      if (A.p0) { p.x = lerp(A.p0.x, p.x, e); p.z = lerp(A.p0.z, p.z, e); } return null; } // from where the walk left him onto the ladder's line, eased (motion: root x snapped 4 cm and y 4 cm in one frame at every mount)
    if (A.mode === 'land') { // both feet on the floor: let go of the rungs, stand up
      A.lt += dt; A.limb.LH.w = A.limb.RH.w = 1; /* the hands come down by IK (fading to the climb clip left both arms up at shoulder height while he stepped back: watch R28-3) */
      // a step back off the ladder before walking away (gate: arms, hips and shins swept through the rail when he turned off at the foot)
      A.back = BACK * sstep(.15, .75, A.lt);
      if (A.lt > .8) { S.act = null; S.wTarget = 0; S.fade = .3; return 'bottom'; } /* the root stays where the last hip correction put it (gate: root 14 cm in one frame at the end) */
      placeRoot(A, p); return null; }
    if (!A.step) { A.step = planStep(A); if (!A.step) {
      if (A.up) { startOver(A, 1); return overTick(A, dt, p); }
      A.mode = 'land'; A.lt = 0; placeRoot(A, p); return null; } }
    const st = A.step; st.u += dt / st.T;
    const u = Math.min(1, st.u);
    for (const m of st.move) { const L = A.limb[m.k]; L.e = sine((u - m.a) / (m.b - m.a)); } // the lowest peak acceleration for a rest-to-rest swing
    A.y = lerp(st.y0, st.y1, sstep(st.ya, st.yb, u));
    A.phase = (A.steps + u) * .5;
    placeRoot(A, p);
    if (st.u >= 1) { for (const m of st.move) { const L = A.limb[m.k]; L.r = m.to; L.from = null; L.e = 0; } A.steps++; A.carry = st.u - 1; A.step = null; }
    return null;
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  const BACK = .26;
  function placeRoot(A, p) { p.y = A.y; p.x = A.lad.x; p.z = A.o.cz + A.zDir * (A.back || 0); } // hips are fixed exactly in post()

  // highest wrist the arm reaches with the body standing on a foot at rootY (shoulder over the hips, ~a hip distance from the rungs)
  function reachY(A, rootY) { const arm = (M.arm || .5) * .93, dz = A.Dhip - .065; return rootY + (A.shOff != null ? A.shOff : A.sh0 != null ? A.sh0 : (M.shH || 1.1) * .9) + Math.sqrt(Math.max(0, arm * arm - dz * dz)); }
  // can the hand reach the palm spot on the floor above (past the top rung and the edge beam) from a body standing at rootY?
  // (it went there with the body still low: the arm ran out 12 cm short and the fingers dragged through the edge beam)
  function reachFloor(A, rootY) { const arm = (M.arm || .5) * .95, g = restTarget(A, 'LH', A.R.length), rz = rungP(A, A.R.length - 1).z;
    const dz = (A.Dhip - .065) + Math.abs(rz - g.z), sy = rootY + (A.shOff != null ? A.shOff : A.sh0 != null ? A.sh0 : (M.shH || 1.1) * .9); return Math.hypot(dz, g.y - sy) <= arm; }
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
    const lowOut = up && M.arm && L[hLo].r < nR && top(A, L[hLo].r) + .015 < top(A, minAfter) + (A.shOff != null ? A.shOff : A.sh0 != null ? A.sh0 : (M.shH || 1.1) * .9) - M.arm * .9; /* the lower hand would be left below the arm's reach after this step (v6: hands 35 cm off their rungs while the body rose) */
    if (up) { if ((L[hLo].r < minAfter + A.K || lowOut) && L[hLo].r < nR) { hand = hLo; hto = Math.min(nR, L[hHi].r + 1); if (hto > nR - 1) hto = reachFloor(A, top(A, minAfter)) ? nR : (L[hHi].r === nR - 1 ? nR - 2 : nR - 1); if (hto < nR) { const ry = reachY(A, top(A, minAfter)); while (hto > L[hLo].r && top(A, hto) + .015 > ry) hto--; } if (hto <= L[hLo].r && lowOut && L[hHi].r > L[hLo].r && L[hHi].r < nR && top(A, L[hHi].r) + .015 <= reachY(A, top(A, minAfter)) + .04) hto = L[hHi].r; /* nowhere higher to go (top rung taken, the boards out of reach): both hands on the top rung rather than one left behind (gate rope ladder: a hand 40 cm off its rung) */ if (hto <= L[hLo].r) hand = null; } }
    else { const ry = reachY(A, top(A, minAfter)) - .12; const hy = r => r >= nR ? A.o.yTop : top(A, r) + .015; // palm flat on the floor above: its height is the floor's
      if (L[hHi].r > minAfter + A.K || L[hHi].r >= nR || hy(L[hHi].r) > ry) { /* a palm still on the boards above comes onto the top rung with the first step down (gate: hand gripping air) *//* going down the hands stay a rung lower: the body hangs lower under them */ hand = hHi; hto = Math.min(nR - 1, L[hLo].r - 1); if (L[hLo].r >= nR) hto = nR - 1; while (hto > minAfter + 1 && top(A, hto) + .015 > ry) hto--; if (M.arm) { const lo = (A.y + top(A, minAfter)) / 2 + (A.shOff != null ? A.shOff : A.sh0 != null ? A.sh0 : (M.shH || 1.1) * .9) - M.arm * .8; while (hto < nR - 1 && hto < L[hLo].r && top(A, hto) + .015 < lo) hto++; } /* not below the arm's reach either (v6: the lower hand hung 10-17 cm short of its rung all the way down) */ } }
    if (hand && hto === L[hand].r) hand = null;
    if (up) {
      if (hand) { move.push({ k: hand, to: hto, a: 0, b: .56, arc: .09 }); move.push({ k: mf, to, a: .26, b: .98, arc: .13 }); }
      else move.push({ k: mf, to, a: 0, b: .8, arc: .13 }); // long, overlapping swings: no limb accelerates harder than the gate's 2.5 cm/frame²
    } else {
      move.push({ k: mf, to, a: 0, b: .66, arc: .13 }); if (hand) move.push({ k: hand, to: hto, a: L[hand].r >= nR ? .1 : .18, b: .98, arc: .09 }); /* a palm coming off the boards drops ~50 cm: it starts with the foot (gate: hand 4.2 cm/frame² leaving bl_t) */
      // the other hand out of reach too (both hands on one rung, the body went on down): it comes down in the same step, first
      { const o = hand === 'LH' ? 'RH' : hand === 'RH' ? 'LH' : (L.LH.r >= L.RH.r ? 'LH' : 'RH'); const ry2 = reachY(A, top(A, minAfter)) - .12;
        if (L[o].r >= nR || top(A, L[o].r) + .015 > ry2) { let t2 = L[o].r - 1; while (t2 > minAfter + 1 && top(A, t2) + .015 > ry2) t2--; if (M.arm) { const lo = top(A, minAfter) + (A.shOff != null ? A.shOff : A.sh0 != null ? A.sh0 : (M.shH || 1.1) * .9) - M.arm * .78; while (t2 < L[o].r - 1 && top(A, t2) + .015 < lo) t2++; } if (hand && t2 === hto) t2 = Math.max(minAfter + 1, t2 - 1); if (t2 < L[o].r && t2 >= 0) move.push({ k: o, to: t2, a: .06, b: L[o].r >= nR ? .9 : .62, arc: .09 }); /* off the boards it drops ~60 cm: a longer move (gate: hand 4.2 cm/frame² leaving bl_t) */ } }
    }
    for (const m of move) { const l = L[m.k]; l.from = l.cur ? l.cur.clone() : restTarget(A, m.k, l.r); l.toP = restTarget(A, m.k, m.to); }
    const y0 = A.y; let y1 = top(A, minAfter);
    // going up: the body rises no higher than the hands that stay on their rungs can follow (rope ladder top: both hands on the
    // top rung, the body went on up and the arms ran out 10 cm)
    if (up && M.arm) { const so = A.shOff != null ? A.shOff : A.sh0 != null ? A.sh0 : (M.shH || 1.1) * .9; for (const h of ['LH', 'RH']) { const mv = move.find(m => m.k === h); const r = mv ? mv.to : L[h].r; if (r < 0 || r >= nR) continue; const lim = top(A, r) + .015 - so + M.arm * .97; if (lim < y1) y1 = Math.max(y0, lim); } }
    const T = (hand ? A.T : A.T * .8) * (!up && move.some(m => m.k[1] === 'H' && L[m.k].r >= nR) ? 1.4 : 1); /* a palm coming off the boards drops ~50 cm: that first step down is slower (gate: hand 4 cm/frame² leaving bl_t) */
    const st = { move, u: A.carry || 0, T, y0, y1, ya: up ? (hand ? .22 : .1) : 0, yb: up ? 1 : .78 };
    A.carry = 0;
    return st;
  }

  // limb position this frame
  // the sideways push round the shoulder, eased (it came and went within 3 frames as the hand passed the shoulder: gate, hand jump 12 cm/frame²
  // going down onto the rungs); kept on and eased out after the move too, so the move's end does not snap it off
  function limbPos(A, k) { const L = A.limb[k]; L.pxW = 0; const q = limbPos0(A, k); if (k[1] !== 'H') return q;
    const kd = Math.min(1, (A.dtL || 1 / 60) * 14); L.px1 = (L.px1 || 0) + (L.pxW - (L.px1 || 0)) * kd; L.px = (L.px || 0) + (L.px1 - (L.px || 0)) * kd; if (Math.abs(L.px) > 1e-4) q.x += L.px; return q; }
  function limbPos0(A, k) {
    if (A.mode === 'over') return overLimb(A, k);
    const L = A.limb[k]; const st = A.step; const m = st && st.move.find(q => q.k === k);
    if (m && L.from) {
      const e = L.e || 0; const g = restTarget(A, k, m.to); const q = L.from.clone().lerp(g, e); // live goal: the wrist aim follows the shoulder, a frozen goal jumped at the step end
      // a hand onto (or off) the floor above: up first, then over the edge beam (down: back off the boards first, then down to the rung)
      if (k[1] === 'H' && (m.to >= A.R.length || L.r >= A.R.length)) { const upw = g.y > L.from.y; const ey = upw ? sine(Math.min(1, e / .65)) : sine(Math.max(0, (e - .3) / .7)), ez = upw ? sine(Math.max(0, (e - .35) / .65)) : sine(Math.min(1, e / .55)); /* overlapped a little more: a 1 m drop in the last 60 % of the move pulled the hand down at 6-9 cm/frame² (gate) */
        q.y = L.from.y + (g.y - L.from.y) * ey; q.z = L.from.z + (g.z - L.from.z) * ez; }
      const s = Math.sin(Math.PI * e); q.z += A.zDir * m.arc * s; q.y += (k[1] === 'F' ? .04 : (m.to >= A.R.length || L.r >= A.R.length) ? .06 : .02) * s; /* over the edge beam: arc clear of it (the collision lift kicked in mid-move: hand 4.7 cm/frame²) */
      // a swinging hand goes round its shoulder, not through it (the target passed 6 cm from the shoulder joint: the elbow whipped round)
      if (k[1] === 'H' && A.shP && A.shP[k]) { const sp = A.shP[k], R0 = .24; const r = Math.hypot(q.y - sp.y, q.z - sp.z); const out = (k === 'LH' ? -1 : 1) * A.zDir;
        const u = r < R0 ? 1 - r / R0 : 0; L.pxW = out * .17 * u * u * s; }
      return q;
    }
    if (A.grab < 1 && L.from) return L.from.clone().lerp(restTarget(A, k, L.r), ease(A.grab));
    if (A.mode === 'land' && k[1] === 'H' && A.shP && A.shP[k] && C.bones.Hips) { // let go: off the rung and down beside the thigh as the feet step back
      const g = restTarget(A, k, Math.min(L.r, A.R.length - 1)), sh = A.shP[k], hp = C.bones.Hips.getWorldPosition(V()); const out = sh.clone().sub(hp).setY(0); if (out.lengthSq() > 1e-6) out.normalize();
      const hang = sh.clone().add(V(0, -.52, 0)).addScaledVector(out, .08); hang.z += A.zDir * .02; const e = sstep(0, .55, A.lt); const q = g.lerp(hang, e); q.z += A.zDir * Math.sin(Math.PI * e) * .06; return q; }
    if (A.mode === 'land' && k[1] === 'F' && A.back) { // the feet step back one after the other, lifted a little
      const e = k === 'LF' ? sstep(.15, .5, A.lt) : sstep(.4, .75, A.lt); const q = restTarget(A, k, L.r); q.z += A.zDir * BACK * e; q.y += Math.sin(Math.PI * e) * .06; return q; }
    return restTarget(A, k, L.r);
  }

  // ---- after the clip pose: hips to the ladder, limbs onto the rungs ----
  function post(dt) {
    // the body was reset (spawn / freeze guard / random start) while on a ladder: drop the climb at once
    if (S.act && C.H.lad !== S.act.hl) { S.act = null; S.W = 0; S.wTarget = 0; S.last = null; S.resid = null; S.hk = S.hk1 = 0; }
    const A = S.act; if (!A && !(M.pn && M.uH) && !C.H.lad && !C.H.inBed) calib();
    // fade the IK weight (also after the climb ended, while the next clip takes over)
    const fadeT = A ? .3 : (S.fade || .3);
    S.W += Math.sign(S.wTarget - S.W) * Math.min(Math.abs(S.wTarget - S.W), dt / fadeT);
    if (!A && C.bones.LeftFoot && C.bones.RightFoot) S.ft = { LF: C.bones.LeftFoot.getWorldPosition(V()), RF: C.bones.RightFoot.getWorldPosition(V()) }; /* the feet as the earlier stages left them (foot locks): the mount starts from there */
    if (S.W <= .001 && !A) { S.last = null; return; }
    const B = C.bones, root = C.root, wp = b => b.getWorldPosition(V());
    root.updateMatrixWorld(true);
    let tg, hw;
    if (A) {
      // scrub the climb clip in step with the gait (2 steps = one clip cycle)
      const a = C.actions['437']; if (a && C.H.cur === a) { a.timeScale = 0; const d = a.getClip().duration; a.time = ((A.phase || 0) % 1) * d; }
      // hips: fixed distance from the ladder, height from the lower supporting foot (a nearly straight leg)
      const fl = Math.min(A.limb.LF.r, A.limb.RF.r);
      const pz0 = rungP(A, Math.max(0, Math.min(fl, A.R.length - 1))).z; A.pz = A.pz == null ? pz0 : A.pz + (pz0 - A.pz) * Math.min(1, dt * 3); const planeZ = A.pz; // eased: rope rungs hang at different depths (root stepped at every step)
      const hz = A.Dhip - (M.footH - .02); const hipUp = Math.sqrt(Math.max(.1, (M.leg * .95) ** 2 - hz * hz)) + M.footUp + .02;
      // on the floor (start / end of the climb) the hips stand where the clip puts them: blend that in and out
      const onFloor = A.mode !== 'over' && Math.max(A.limb.LF.r, A.limb.RF.r) < 0;
      A.fy += Math.sign((onFloor ? 0 : 1) - A.fy) * Math.min(Math.abs((onFloor ? 0 : 1) - A.fy), dt / .45);
      const sway = Math.sin((A.phase || 0) * Math.PI * 2) * .018;
      // over the edge: the correction is worked out for the body still on the ladder, and handed over to the standing clip
      let ko = 1, base = V(); if (A.mode === 'over') { ko = 1 - sstep(0, .6, A.C.s); base = root.position.clone().sub(V(A.lad.x, A.C.ys, A.o.cz)); }
      const hp = wp(B.Hips).sub(base);
      const want = V(A.lad.x + sway, (A.mode === 'over' ? A.C.ys : A.y) + hipUp, planeZ + A.zDir * (A.Dhip + (A.back || 0)));
      const d = want.sub(hp).multiplyScalar(ease(A.grab) * S.W * ko); d.y = d.y * A.fy + (A.hip0 != null ? (A.y + A.hip0 - hp.y) * ease(A.grab) * S.W * ko * (1 - A.fy) : 0); /* feet on the ground: the hips stay at the standing height (the climb clip's hips rose 10 cm and lifted both feet 9-14 cm off the floor at the mount) */ if (A.up && A.noSink == null) { A.noSink = true; A.sk1 = A.sk = 0; } if (A.noSink && A.mode === 'climb' && A.fy <= 0) { A.sk1 = A.sk = d.y; } else if (A.noSink && A.mode !== 'land') { /* kept on over the edge too: it ended there and the hips jumped 5 cm */ const k = Math.min(1, dt * 3.5); A.sk1 += (d.y - A.sk1) * k; A.sk += (A.sk1 - A.sk) * k; const want = d.y; d.y = A.sk; if (fl >= 0 && Math.abs(want - A.sk) < .004) A.noSink = false; } /* climbing up from the ground the hips settle into the climbing height eased in two stages (v6: they dropped 14 cm in the first step, and holding them up then dropped 25 cm in a frame) */ /* first foot on the bottom rung, the other still on the ground: the hips do not sink under the standing height (v6: shoulders dropped 20 cm and the hands lost the rungs above) */
      root.position.add(d); root.updateMatrixWorld(true);
      // upper body close to the ladder (the climb clip leans back ~16 cm: hands could not reach the rungs): pitch the spine
      // so the neck is ~24 cm from the rungs, split between the lower and the middle spine
      // with the palms on the floor above he leans over the edge (neck over the top of the ladder)
      { const flat = (A.limb.LH.r >= A.R.length || A.limb.RH.r >= A.R.length) && (A.mode === 'over' || wp(B.Neck).y > A.o.yTop - .05); const want = flat ? .06 : !B.HeadTop_End && A.mode === 'climb' && A.limb.LF.r < 0 && A.limb.RF.r < 0 ? .22 : !B.HeadTop_End ? .19 : .17; /* the big head: 2 cm more room on the way up too (its brow touched the kh rungs while the body waited for the hands) */ /* standing at the foot of the ladder the original hero's big head (brow ~14 cm in front of the head bone) leant into the rung at head height: neck 5 cm further off until a foot is on a rung */ /* leaning over the edge only with the neck above it (below it the chest hit the rungs and the body was pushed back into a crouch) */ A.ndw = A.ndw == null ? want : A.ndw + (want - A.ndw) * Math.min(1, dt * 4); A.nd = A.nd == null ? want : A.nd + Math.sign(A.ndw - A.nd) * Math.min(Math.abs(A.ndw - A.nd), dt * (A.ndw > A.nd ? .8 : .5)); /* away from the rungs faster (the quicker descent brought the big head onto the top rungs at kh while it was still leaning over the edge) */ /* the target eased first: a step in it gave the linear ramp a hard start and stop (gate: P3 jumps) */ }
      if (A.mode !== 'over' || A.C.s < .85) { const kk = S.W * ease(A.grab) * (A.mode === 'over' ? 1 - sstep(.45, .85, A.C.s) : A.mode === 'land' ? 1 - sstep(0, .6, A.lt) : 1); /* stands up straight while stepping back (gate: 44 deg forward lean walking off) */
        for (const [bn, part] of [['Spine', .5], ['Spine1', 1]]) { const nk = wp(B.Neck); const dz = (nk.z - planeZ) * A.zDir - A.nd; if (Math.abs(dz) < .005) break;
          const goal = nk.clone(); goal.z -= A.zDir * dz * part; C.turnBone(B[bn], nk, goal, kk); } }
      // keep the chest and head off the rungs: the body leans back from the ladder if they come too close
      // (only below the top of the ladder: above it there is nothing to hit; eased, and handed over smoothly at the edge)
      { let need = 0; const topY = A.R[A.R.length - 1].y + .1; if (A.mode !== 'over') for (const [bn, minD] of [['Spine2', .2], ['Head', .19]]) { const q = wp(B[bn]); if (q.y > topY) continue; const dz = (q.z - planeZ) * A.zDir; need = Math.max(need, minD - dz); }
          if (A.mode === 'climb') for (const bn of ['LeftLeg', 'RightLeg']) { const q = wp(B[bn]); if (q.y > topY) continue; let wk = 0; for (const R of A.R) wk = Math.max(wk, 1 - sstep(.05, .12, Math.abs(R.y - q.y))); if (wk <= 0) continue; need = Math.max(need, wk * Math.min(backRoom(A, root.position.y, planeZ), .09 - (q.z - planeZ) * A.zDir)); } /* weighted by how level the knee is with a rung (an on/off window made the lean step) */ /* a knee level with a rung stays off it (the new hero's shin went 3 cm into the rung climbing kl_b-bl_t); between the rungs it may come in */
        A.gn = (A.gn || 0) + (need - (A.gn || 0)) * Math.min(1, dt * (5 + 5 * sstep(0, .04, need - (A.gn || 0)))); /* faster while the head is in the rungs (mount: the brow sat in the top rung for half a second) */ A.gz = (A.gz || 0) + (A.gn - (A.gz || 0)) * Math.min(1, dt * (4 + 5 * sstep(0, .04, A.gn - (A.gz || 0)))); /* rates blend with the gap (a switch between two rates was a velocity step) */ // two eased stages: the lean-back had no velocity ease (root z jerked 2 cm/frame²)
        if (A.gz > 1e-4) { root.position.z += A.zDir * A.gz; root.updateMatrixWorld(true); } }
      A.planeZ = planeZ;
      // the real shoulder height over the supporting rung (the plan used a standing estimate: hands were left 40-75 cm out of reach going down)
      if (A.mode === 'climb' && B.LeftArm && B.RightArm) { const so = (wp(B.LeftArm).y + wp(B.RightArm).y) / 2 - A.y; A.shOff = A.shOff == null ? so : A.shOff + (so - A.shOff) * Math.min(1, dt * 4); }
      if (B.LeftArm && B.RightArm) A.shP = { LH: wp(B.LeftArm), RH: wp(B.RightArm) };
      tg = {}; A.dtL = dt; for (const k of LIMBS) { tg[k] = limbPos(A, k); A.limb[k].cur = tg[k].clone(); }
      hw = { LH: A.limb.LH.w, RH: A.limb.RH.w };
      S.last = { tg, zDir: A.zDir, hw, hangE: A.mode === 'over' ? sstep(.36, .72, A.C.s) : 0, flat: { LH: A.limb.LH.r >= A.R.length, RH: A.limb.RH.r >= A.R.length } };
      // look at the hand that moves next (or between the hands); over the edge: ahead
      const nh = A.step && A.step.move.find(m => m.k[1] === 'H');
      { const hd = wp(B.Head); // eyes on the rungs ahead, a little above the head at most (no head thrown back)
        let L = A.mode === 'over' ? V(A.P.x, hd.y - .35, A.P.z - A.zDir * 1.6) : (nh ? A.limb[nh.k].toP : tg.LH.clone().lerp(tg.RH, .5)).clone();
        if (A.mode !== 'over') { L.y = Math.min(L.y, hd.y + .2); L.z = planeZ; }
        // the look DIRECTION is eased, not the point: a point a hand's width from the face swung the head 3-5 cm in a frame when it changed (next hand, climb -> over); the neck jumped 30-50 deg when it switched hands
        { const u = L.clone().sub(hd); if (u.lengthSq() < 1e-8) u.set(0, 0, -A.zDir); u.normalize(); if (A.lookU) A.lookU.lerp(u, 1 - Math.exp(-dt * 5)).normalize(); else A.lookU = u; A.lookS = hd.clone().addScaledVector(A.lookU, .9); } C.H.look = A.lookS.clone(); C.H.lookW = .35; A.lookPt = A.lookS.clone(); }
    } else { tg = S.last && S.last.tg; hw = S.last && S.last.hw; }
    if (!tg) return;
    const W = S.act ? S.W : ease(S.W); /* the hand-over to the walk eased at both ends (a linear fade started at full speed: foot 4-4.5 cm/frame² stepping off) */ const zDir = S.last.zDir;
    // legs: knees forward between the rungs and a little out, then the ball of the foot onto the rung
    // once the climb has ended the walk owns the legs at once (frozen foot targets while he walked off bent the ankles: gate foot-bend near the ladders)
    // just after the climb: the feet go over to the walk from where the IK left them, eased (they snapped there in one frame: foot 4.5 cm/frame² stepping off)
    if (!A && tg && W > .01 && S.last.fo) for (const s of ['Left', 'Right']) { const k = s[0] + 'F', F = B[s + 'Foot']; if (!F || !S.last.fo[k]) continue; const raw = wp(F); const t = S.last.fo[k].clone().lerp(raw, 1 - W); C.ik2(B[s + 'UpLeg'], B[s + 'Leg'], F, t, V((s === 'Left' ? -1 : 1) * zDir * .3, .55, -zDir), 1, false); }
    if (A) for (const s of ['Left', 'Right']) {
      let t = tg[s[0] + 'F']; const sx = (s === 'Left' ? -1 : 1) * zDir;
      // near full stretch the foot slows down softly (going straight the knee is ill-defined: it swung 13 cm in a frame as the foot
      // stepped down off the kitchen floor onto the hatch ladder; gate, knee jump 11-12 cm/frame² on every descent at kh)
      { const hp = wp(B[s + 'UpLeg']), Ll = hp.distanceTo(wp(B[s + 'Leg'])) + wp(B[s + 'Leg']).distanceTo(wp(B[s + 'Foot'])); const v = t.clone().sub(hp), d = v.length(), Lm = Ll * .985, x0 = (A.mode === 'over' ? .78 : .9) * Lm; /* over the edge the foot goes down faster than the body: a longer soft zone, so it settles onto the rung instead of stopping at 7 cm/frame */ if (d > x0) { const w = Lm - x0; v.setLength(x0 + w * Math.tanh((d - x0) / w)); const Lf = A.limb[s[0] + 'F'], fm = A.step && A.step.move.find(m => m.k === s[0] + 'F'); const cw = Lf.r < 0 ? (fm ? sstep(0, .3, Lf.e || 0) : 0) : 1; /* a standing foot at the mount: eased in with the grab (the straight standing leg was pulled up 10 cm in the first frame: gate, foot jump 11 cm/frame² at kh_b) */ t = t.clone().lerp(hp.clone().add(v), cw); } }
      C.ik2(B[s + 'UpLeg'], B[s + 'Leg'], B[s + 'Foot'], t, V(sx * .3, .55, -zDir), W, false);
      const F = B[s + 'Foot'], Tb = B[s + 'ToeBase'];
      if (F && Tb) { const a = wp(F), toe = wp(Tb); const onFl = A && A.mode !== 'over' && A.limb[s[0] + 'F'].r < 0 && !(A.step && A.step.move.some(m => m.k === s[0] + 'F')); const dd = M.ankFloor - M.toeFloor; A.flE = A.flE || {}; const fk = s[0] + 'F'; A.flE[fk] = A.flE[fk] == null ? (onFl ? 1 : 0) : A.flE[fk] + ((onFl ? 1 : 0) - A.flE[fk]) * Math.min(1, dt * 6); const d = V(0, -M.footUp, -zDir * M.footH).lerp(V(0, -dd, -zDir * Math.sqrt(Math.max(0, M.footUp * M.footUp + M.footH * M.footH - dd * dd))), A.flE[fk]); /* flat on the boards, the ball on a rung (eased: no ankle snap at the step) */
        // a real ankle: the toes point away from the calf side of the shin (the hip side), whatever the leg does when it folds deep
        // over the edge (gate: 'knee bent the wrong way' when the toes swung to the hip side of a near-level shin)
        const kn = wp(B[s + 'Leg']), hp = wp(B[s + 'UpLeg']); const sh = a.clone().sub(kn).normalize(); const o = hp.clone().sub(kn); o.addScaledVector(sh, -o.dot(sh));
        if (o.lengthSq() > 1e-6) { o.normalize(); const dl = d.length(); const k = d.dot(o); if (k > -.35 * dl) { d.addScaledVector(o, -k - .35 * dl); d.setLength(dl); } }
        C.turnBone(F, toe, a.clone().add(d), W);
        // the ball of the foot really on the rung: the ankle aim leaves the toes a few cm higher on one side (gate: left toe 9-12 cm off the rung)
        const k = s[0] + 'F'; if (A && A.mode === 'climb' && !(A.step && A.step.move.some(m => m.k === k)) && A.limb[k].r >= 0 && A.limb[k].r < A.R.length) {
          const rg = A.R[A.limb[k].r]; const ty = wp(Tb).y; A.tadj = A.tadj || {}; const cur = A.tadj[k] || 0;
          A.tadj[k] = Math.max(-.08, Math.min(.04, cur + ((rg.y + .055) - ty) * Math.min(1, dt * 4))); } }
    }
    if (A && S.last) S.last.fo = { LF: wp(B.LeftFoot), RF: wp(B.RightFoot) };
    // arms: elbows down and out, wrist under and behind the rung, fingers over it (or the palm flat on the floor above)
    for (const s of ['Left', 'Right']) {
      const k = s[0] + 'H'; let t = tg[k];
      // never into a beam or a board (collide: hand 4-6 cm into the ledge beam at the top of the rope ladder): lift the wrist until it and the palm are clear
      const CD = window.__collide; S.lf = S.lf || {}; const t0 = t;
      // only at the top (ledge beam, floor edge): on the rungs the grip is meant to wrap the rung, and lifting off it flickered frame to frame (arm pops)
      const nearTop = A ? t.y > A.R[A.R.length - 1].y - .06 : true;
      if (t && CD && CD.depthAt && nearTop) { t = t.clone(); for (let n = 0; n < 12; n++) { let dd = 0; try { const dv = d => typeof d === 'number' ? d : (d && d.depth) || 0; /* wrist, palm, and the fingers (they hang ~5 cm below the wrist line, 10-15 cm ahead) */ for (const [f, dy] of [[0, 0], [.06, 0], [.11, -.045], [.15, -.055]]) dd = Math.max(dd, dv(CD.depthAt(t.x, t.y + dy, t.z - zDir * f))); } catch (e) { break; } if (dd <= .002) break; t.y += Math.min(.03, dd + .005); } }
      { const need = t && t0 ? t.y - t0.y : 0; const cur = S.lf[k] || 0; S.lf[k] = cur + (need - cur) * Math.min(1, dt * (need > cur ? 14 : 5)); if (t0) { t = t0.clone(); t.y += S.lf[k]; } } // eased lift
      // out of the arm's reach the hand slows down softly before it gets there (it went at 11 cm/frame and stopped dead at full stretch: gate, hand jump 7-11 cm/frame² reaching up for the floor above)
      if (t && M.arm && B[s + 'Arm']) { const sp = wp(B[s + 'Arm']), v = t.clone().sub(sp), d = v.length(), Lm = M.arm * .96, x0 = .86 * Lm; const mvE = A && A.mode === 'climb' && A.step && A.step.move.some(m => m.k === k) ? (A.limb[k].e || 0) : 0; const wu = Math.max(sstep(sp.y - .02, sp.y + .14, t.y), sstep(0, .15, mvE) * (1 - sstep(.85, 1, mvE))); /* a moving hand also slows before full stretch below the shoulder (going down it reached the straight arm and stopped dead: 4 cm/frame²) */ if (d > x0 && wu > 0) /* only reaching up: a hand hanging on a rung below the shoulder with the arm near straight was pulled off it (11-40 cm off the rung) */ /* weighted in by height (an on/off switch at shoulder + 10 cm jerked the hand 10 cm/frame²) */ { const w = Lm - x0; v.setLength(x0 + w * Math.tanh((d - x0) / w)); t = t.clone().lerp(sp.clone().add(v), wu); } }
      const sx = (s === 'Left' ? -1 : 1) * zDir; const w = W * (hw ? hw[k] : 1); if (w < .002) continue;
      C.ik2(B[s + 'Arm'], B[s + 'ForeArm'], B[s + 'Hand'], t, V(sx * .7, -1, zDir * .45), w, false); if (window.__qa) { S.tl = S.tl || {}; S.tl[k] = [t.x, t.y, t.z, w, wp(B[s + 'Hand']).distanceTo(t)]; }
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
    // the face off the rungs (after the look, which would turn it back): the climb clip leans the head ~35 deg to the ladder and the brow went 2-3 cm into the top rung at the hatch.
    // A climber keeps the head up: the middle of the skull (9 cm on from the neck; the face and brow ~11 cm round it) stays 20 cm off the rung plane, 4-6 cm off the rung, by tipping the head back (eased)
    if (B.Head && B.Neck && (A && A.planeZ != null || S.hk > 1e-3)) { let hk = 0; const h = wp(B.Head), c = h.clone().add(h.clone().sub(wp(B.Neck)).setLength(.09));
      if (A && A.planeZ != null && A.mode !== 'over') { const big = !B.HeadTop_End; /* the original hero's head is bigger (brow ~17 cm above the head bone) */ hk = Math.min(.09, Math.max(0, (big ? .235 : .2) - (c.z - A.planeZ) * A.zDir)) * (1 - sstep(A.R[A.R.length - 1].y + .04, A.R[A.R.length - 1].y + .2, c.y)); /* faded out above the top rung, not cut */ }
      if (A) S.hkZ = A.zDir;
      // two eased stages, kept on after the climb ends and eased out there (dropped with the climb, the head top jumped 15 cm in a frame: gate)
      S.hk1 = (S.hk1 || 0) + (hk - (S.hk1 || 0)) * Math.min(1, dt * 8); S.hk = (S.hk || 0) + (S.hk1 - (S.hk || 0)) * Math.min(1, dt * 8);
      if (S.hk > 1e-3) { /* a pure nod back about the head's own ear-to-ear axis, kept level (a free turn, or a turn about the ladder's axis on a head turned to a hand, rolled it 19 deg) */ const ex = V(1, 0, 0).applyQuaternion(B.Head.getWorldQuaternion(new THREE.Quaternion())); ex.y = 0; if (ex.lengthSq() > .1) { ex.normalize(); const v = c.clone().sub(h), dz = ex.clone().cross(v).z; if (Math.abs(dz) > .02) rotWorld(B.Head, ex, Math.max(-.6, Math.min(.6, (S.hkZ || 1) * S.hk / dz))); } } }
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
    if (B.Spine2) { const hu = (M.uH || V(0, 1, 0)).clone().applyQuaternion(Hd.getWorldQuaternion(_q1())), cu = (M.uC || V(0, 1, 0)).clone().applyQuaternion(B.Spine2.getWorldQuaternion(_q1())); const a = hu.angleTo(cu), MT = .72; /* the gate reads the nod against the upper chest calibrated its own way: 55 deg here still showed up to 72 there */
      if (a > MT) { const ax = hu.clone().cross(cu); if (ax.lengthSq() > 1e-8) { ax.normalize(); const ex = (a - MT) * w; if (B.Neck) rotWorld(B.Neck, ax, ex * .5); rotWorld(Hd, ax, ex * .5); } } }
    const q2 = Hd.getWorldQuaternion(_q1()); const f2 = V(0, 0, 1).applyQuaternion(q2), u = Y.clone().applyQuaternion(q2); const sd = f2.clone().cross(Y); if (sd.lengthSq() < 1e-4) return; sd.normalize();
    const roll = Math.asin(Math.max(-1, Math.min(1, u.dot(sd)))); const RM = .09; const ex = roll > RM ? roll - RM : roll < -RM ? roll + RM : 0; if (Math.abs(ex) > 1e-3) rotWorld(Hd, f2.normalize(), -ex * w);
  }

  return { init, begin, tick, post, topStand, get active() { return !!S.act; }, get weight() { return S.W; }, state: S, M,
    // for tests: where each limb should be now
    targets: () => S.last && S.last.tg };
}
