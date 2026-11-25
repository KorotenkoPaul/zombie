// Motion matching for the hero's locomotion (owner: the motion-matching thread).
//
// What it does
//  * A database of real human walking captured in a mocap studio (CMU Graphics Lab, free for any use, incl. commercial):
//    walk at 0.6-1.35 m/s, starts from standing, stops, turns in place, 90-degree turns, veering. Retargeted to the hero's
//    Mixamo skeleton offline (pipeline/mm/cmu2hero.mjs, pack.mjs -> game/motion-db.txt). Every clip is also mirrored here at load.
//  * Each frame the hero's own navigation (hero.js walkStep: path, speed, heading) is the "simulation". From it we predict
//    where the body should be in 1/3, 2/3 and 1 s (along the real path, with a human stopping distance) and search the
//    database for the frame whose feet, hip velocity and future trajectory match best (brute force with bounding-box pruning,
//    every 0.1 s, well under 1 ms). The pose plays on from there; jumps are hidden with inertialization (offsets that decay
//    like a critically damped spring), never a cross-fade.
//  * The animation moves its own root (no foot sliding); it is pulled toward the simulation with a short half-life and a hard
//    clamp, so the hero stays on the collision-free path. Feet in contact in the data are locked to the floor with leg IK.
//  * Layering: while he walks, an action clip that hero.js plays (stretching, carrying...) keeps the upper body, the legs and
//    hips come from motion matching. When he stops, the pose hands back to hero.js clips through the same inertialization.
//
// Hook (hero.js): HH.setMotion(m); hero post() calls m.post(dt) right after mixer.update, before its IK, look-at and props.
import * as THREE from 'three';

const FPS = 30;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const LOCO_CLIPS = new Set(['30', '0', '11', '12', 'hy_idle']); // hero.js clips that only stand in for walking / standing
const LOWER = /^(Hips|LeftUpLeg|LeftLeg|LeftFoot|LeftToeBase|RightUpLeg|RightLeg|RightFoot|RightToeBase)$/;

export function decodeDB(txt) {
  const D = typeof txt === 'string' ? JSON.parse(txt) : txt;
  const b64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Int16Array(u.buffer); };
  const q = b64(D.q), h = b64(D.h); const B = D.bones.length; let off = 0; const clips = [];
  for (const c of D.clips) { const Q = new Float32Array(c.n * B * 4), Hh = new Float32Array(c.n * 3);
    for (let i = 0; i < Q.length; i++) Q[i] = q[off * B * 4 + i] / 32767; for (let i = 0; i < Hh.length; i++) Hh[i] = h[off * 3 + i] / 1000;
    clips.push({ name: c.name, n: c.n, q: Q, h: Hh }); off += c.n; }
  return { fps: D.fps || FPS, bones: D.bones, rest: D.rest, clips };
}

// ---------- small quaternion / vector helpers on flat arrays (no allocation in the hot path) ----------
function qmul(a, ai, b, bi, o, oi) { const ax = a[ai], ay = a[ai+1], az = a[ai+2], aw = a[ai+3], bx = b[bi], by = b[bi+1], bz = b[bi+2], bw = b[bi+3];
  o[oi] = aw*bx + ax*bw + ay*bz - az*by; o[oi+1] = aw*by - ax*bz + ay*bw + az*bx; o[oi+2] = aw*bz + ax*by - ay*bx + az*bw; o[oi+3] = aw*bw - ax*bx - ay*by - az*bz; }
function qrot(q, qi, v, vi, o, oi) { const x = v[vi], y = v[vi+1], z = v[vi+2], qx = q[qi], qy = q[qi+1], qz = q[qi+2], qw = q[qi+3];
  const ix = qw*x + qy*z - qz*y, iy = qw*y + qz*x - qx*z, iz = qw*z + qx*y - qy*x, iw = -qx*x - qy*y - qz*z;
  o[oi] = ix*qw + iw*-qx + iy*-qz - iz*-qy; o[oi+1] = iy*qw + iw*-qy + iz*-qx - ix*-qz; o[oi+2] = iz*qw + iw*-qz + ix*-qy - iy*-qx; }
const yawQ = (a, o = [0, 0, 0, 1], oi = 0) => { o[oi] = 0; o[oi+1] = Math.sin(a / 2); o[oi+2] = 0; o[oi+3] = Math.cos(a / 2); return o; };
// quaternion -> rotation vector (log map) and back
function qlog(x, y, z, w, o, oi) { if (w < 0) { x = -x; y = -y; z = -z; w = -w; } const s = Math.hypot(x, y, z); const a = s < 1e-8 ? 2 : 2 * Math.atan2(s, w) / s; o[oi] = x*a; o[oi+1] = y*a; o[oi+2] = z*a; }
function qexp(o, oi, x, y, z) { const a = Math.hypot(x, y, z); if (a < 1e-8) { o[oi] = x/2; o[oi+1] = y/2; o[oi+2] = z/2; o[oi+3] = 1; return; } const s = Math.sin(a / 2) / a; o[oi] = x*s; o[oi+1] = y*s; o[oi+2] = z*s; o[oi+3] = Math.cos(a / 2); }
function gauss(arr, n, stride, k, sig) { if (sig <= 0) return; const R = Math.ceil(sig * 3); const w = []; for (let i = -R; i <= R; i++) w.push(Math.exp(-i*i / (2*sig*sig)));
  const src = Float32Array.from({ length: n }, (_, i) => arr[i*stride + k]); for (let i = 0; i < n; i++) { let s = 0, ws = 0; for (let j = -R; j <= R; j++) { const t = clamp(i + j, 0, n - 1); s += src[t] * w[j + R]; ws += w[j + R]; } arr[i*stride + k] = s / ws; } }

export function createMotion({ hero, db, opts = {} }) {
  const D = db.clips ? db : decodeDB(db);
  const NB = D.bones.length; const names = D.bones;
  const HB = names.map(n => hero.bones[n]); const iOf = Object.fromEntries(names.map((n, i) => [n, i]));
  const par = names.map(n => { const b = hero.bones[n]; let p = b && b.parent; while (p && !(p.name.replace('mixamorig', '').replace(':', '') in iOf)) p = p.parent; return p ? iOf[p.name.replace('mixamorig', '').replace(':', '')] : -1; });
  const restQ = D.rest.q.flat(), restP = D.rest.p.flat();
  const HIPS = iOf.Hips, LF = iOf.LeftFoot, RF = iOf.RightFoot, LU = iOf.LeftUpLeg, RU = iOf.RightUpLeg, LL = iOf.LeftLeg, RL = iOf.RightLeg, SP2 = iOf.Spine2;
  const isLower = names.map(n => LOWER.test(n));

  // ---------- FK on flat arrays ----------
  const Wq = new Float32Array(NB * 4), Wp = new Float32Array(NB * 3), tmp3 = new Float32Array(3);
  function fk(Q, qo, hips, ho) { for (let i = 0; i < NB; i++) { const p = par[i];
      if (p < 0) { Wq.set(Q.subarray(qo + i*4, qo + i*4 + 4), i*4); Wp[i*3] = hips[ho]; Wp[i*3+1] = hips[ho+1]; Wp[i*3+2] = hips[ho+2]; }
      else { qmul(Wq, p*4, Q, qo + i*4, Wq, i*4); qrot(Wq, p*4, restP, i*3, tmp3, 0); Wp[i*3] = Wp[p*3] + tmp3[0]; Wp[i*3+1] = Wp[p*3+1] + tmp3[1]; Wp[i*3+2] = Wp[p*3+2] + tmp3[2]; } } }

  // ---------- mirrored copies (x -> -x, left <-> right) ----------
  const restW = new Float32Array(NB * 4); { const z = new Float32Array(3); fk(Float32Array.from(restQ), 0, z, 0); restW.set(Wq); }
  const mir = names.map(n => iOf[n.replace(/^Left/, '#').replace(/^Right/, 'Left').replace(/^#/, 'Right')] ?? iOf[n]);
  const Mq = (q, i, o, oi) => { o[oi] = q[i]; o[oi+1] = -q[i+1]; o[oi+2] = -q[i+2]; o[oi+3] = q[i+3]; };
  const corr = new Float32Array(NB * 4); // M(R_b)^-1 * R_b'
  { const t = new Float32Array(4); for (let b = 0; b < NB; b++) { Mq(restW, b*4, t, 0); t[0] = -t[0]; t[1] = -t[1]; t[2] = -t[2]; qmul(t, 0, restW, mir[b]*4, corr, b*4); } }
  function mirrorClip(c) { const n = c.n, Q = new Float32Array(c.q.length), Hh = new Float32Array(c.h.length); const Wm = new Float32Array(NB * 4), t = new Float32Array(4), inv = new Float32Array(4);
    for (let f = 0; f < n; f++) { fk(c.q, f*NB*4, c.h, f*3);
      for (let b = 0; b < NB; b++) { Mq(Wq, b*4, t, 0); qmul(t, 0, corr, b*4, Wm, mir[b]*4); }
      for (let b = 0; b < NB; b++) { const p = par[b]; if (p < 0) { Q.set(Wm.subarray(b*4, b*4+4), f*NB*4 + b*4); continue; }
        inv[0] = -Wm[p*4]; inv[1] = -Wm[p*4+1]; inv[2] = -Wm[p*4+2]; inv[3] = Wm[p*4+3]; qmul(inv, 0, Wm, b*4, Q, f*NB*4 + b*4); }
      Hh[f*3] = -c.h[f*3]; Hh[f*3+1] = c.h[f*3+1]; Hh[f*3+2] = c.h[f*3+2]; }
    for (let b = 0; b < NB; b++) for (let f = 1; f < n; f++) { const i = f*NB*4 + b*4, j = i - NB*4; if (Q[i]*Q[j] + Q[i+1]*Q[j+1] + Q[i+2]*Q[j+2] + Q[i+3]*Q[j+3] < 0) for (let k = 0; k < 4; k++) Q[i+k] = -Q[i+k]; }
    return { name: c.name + 'm', n, q: Q, h: Hh }; }
  const clips = []; for (const c of D.clips) { clips.push(c); clips.push(mirrorClip(c)); }

  // ---------- per clip: root trajectory, root-relative pose, contacts, features ----------
  const restAnkle = (() => { const z = new Float32Array([0, 0, 0]); fk(Float32Array.from(restQ), 0, z, 0); return Wp[LF*3+1] - Math.min(Wp[iOf.LeftToeBase*3+1], Wp[LF*3+1]) ; })();
  const hipsFwdLocal = new Float32Array(3); { const inv = new Float32Array([-restW[HIPS*4], -restW[HIPS*4+1], -restW[HIPS*4+2], restW[HIPS*4+3]]); qrot(inv, 0, new Float32Array([0, 0, 1]), 0, hipsFwdLocal, 0); }
  const sp2FwdLocal = new Float32Array(3); { const inv = new Float32Array([-restW[SP2*4], -restW[SP2*4+1], -restW[SP2*4+2], restW[SP2*4+3]]); qrot(inv, 0, new Float32Array([0, 0, 1]), 0, sp2FwdLocal, 0); }
  const NF = 27; const TR = [10, 20, 30];
  let total = 0; for (const c of clips) total += c.n;
  const F = new Float32Array(total * NF); const valid = new Uint8Array(total); const where = new Int32Array(total * 2);
  const W = { fpos: .75, fvel: 1, hvel: 1, tpos: 1.1, tdir: 1.4 };
  let g0 = 0;
  for (let ci = 0; ci < clips.length; ci++) { const c = clips[ci]; const n = c.n; c.g0 = g0;
    const R = new Float32Array(n * 3); // root x, z, yaw
    const foot = new Float32Array(n * 6), hip = new Float32Array(n * 3); const fv = new Float32Array(3); let prevYaw = null;
    for (let f = 0; f < n; f++) { fk(c.q, f*NB*4, c.h, f*3);
      qrot(Wq, HIPS*4, hipsFwdLocal, 0, fv, 0); let fx = fv[0], fz = fv[2]; qrot(Wq, SP2*4, sp2FwdLocal, 0, fv, 0); fx += fv[0]; fz += fv[2];
      let yaw = Math.atan2(fx, fz); if (prevYaw != null) yaw = prevYaw + wrapA(yaw - prevYaw); prevYaw = yaw;
      R[f*3] = Wp[HIPS*3]; R[f*3+1] = Wp[HIPS*3+2]; R[f*3+2] = yaw;
      for (const [k, b] of [[0, LF], [3, RF]]) { foot[f*6+k] = Wp[b*3]; foot[f*6+k+1] = Wp[b*3+1]; foot[f*6+k+2] = Wp[b*3+2]; }
      hip[f*3] = Wp[HIPS*3]; hip[f*3+1] = Wp[HIPS*3+1]; hip[f*3+2] = Wp[HIPS*3+2]; }
    gauss(R, n, 3, 0, 4); gauss(R, n, 3, 1, 4); gauss(R, n, 3, 2, 7);
    c.R = R;
    // contacts: ankle low and nearly still
    const con = new Uint8Array(n * 2); let minA = [1e9, 1e9]; for (let f = 0; f < n; f++) { minA[0] = Math.min(minA[0], foot[f*6+1]); minA[1] = Math.min(minA[1], foot[f*6+4]); }
    for (let f = 0; f < n; f++) for (let s = 0; s < 2; s++) { const a = Math.max(0, f - 1), b = Math.min(n - 1, f + 1); const k = s*3;
      const v = Math.hypot(foot[b*6+k] - foot[a*6+k], foot[b*6+k+2] - foot[a*6+k+2]) / ((b - a) / FPS); const hgt = foot[f*6+k+1] - minA[s];
      con[f*2+s] = (hgt < .035 && v < .3) ? 1 : 0; }
    for (let s = 0; s < 2; s++) for (let f = 1; f < n - 1; f++) if (con[(f-1)*2+s] === con[(f+1)*2+s] && con[f*2+s] !== con[(f-1)*2+s]) con[f*2+s] = con[(f-1)*2+s]; // no 1-frame blips
    c.con = con;
    // root-relative pose: hips position and rotation in the root frame (so sampling needs no further transform)
    const yq = [0, 0, 0, 1], v3 = new Float32Array(3), r3 = new Float32Array(3);
    c.hl = new Float32Array(n * 3); c.ql = new Float32Array(n * 4);
    for (let f = 0; f < n; f++) { yawQ(-R[f*3+2], yq); v3[0] = c.h[f*3] - R[f*3]; v3[1] = c.h[f*3+1]; v3[2] = c.h[f*3+2] - R[f*3+1]; qrot(yq, 0, v3, 0, r3, 0); c.hl.set(r3, f*3);
      qmul(yq, 0, c.q, f*NB*4 + HIPS*4, c.ql, f*4); if (f > 0) { const i = f*4, j = i - 4; if (c.ql[i]*c.ql[j] + c.ql[i+1]*c.ql[j+1] + c.ql[i+2]*c.ql[j+2] + c.ql[i+3]*c.ql[j+3] < 0) for (let k = 0; k < 4; k++) c.ql[i+k] = -c.ql[i+k]; } }
    // root deltas per frame (local to the root at f)
    c.dr = new Float32Array(n * 3); for (let f = 0; f < n - 1; f++) { const dx = R[f*3+3] - R[f*3], dz = R[f*3+4] - R[f*3+1], y = R[f*3+2]; const cs = Math.cos(-y), sn = Math.sin(-y);
      c.dr[f*3] = dx*cs + dz*sn; c.dr[f*3+1] = -dx*sn + dz*cs; c.dr[f*3+2] = R[f*3+5] - R[f*3+2]; }
    if (n > 1) c.dr.set(c.dr.subarray((n - 2)*3, (n - 1)*3), (n - 1)*3);
    // does the clip end standing still? then its future can be held instead of being unknown
    const endSpd = n > 6 ? Math.hypot(R[(n-1)*3] - R[(n-6)*3], R[(n-1)*3+1] - R[(n-6)*3+1]) * FPS / 5 : 0; const endStill = endSpd < .12;
    c.speed = new Float32Array(n);
    for (let f = 0; f < n; f++) { const gi = g0 + f; where[gi*2] = ci; where[gi*2+1] = f; const o = gi * NF; const y = R[f*3+2], cs = Math.cos(-y), sn = Math.sin(-y);
      const loc = (x, z, out, k) => { const dx = x - R[f*3], dz = z - R[f*3+1]; out[k] = dx*cs + dz*sn; out[k+1] = -dx*sn + dz*cs; };
      const vloc = (x, z, out, k) => { out[k] = x*cs + z*sn; out[k+1] = -x*sn + z*cs; };
      const a = Math.max(0, f - 1), b = Math.min(n - 1, f + 1), dtv = (b - a) / FPS;
      const t2 = [0, 0];
      for (let s = 0; s < 2; s++) { const k = s*3; loc(foot[f*6+k], foot[f*6+k+2], t2, 0); F[o + s*3] = t2[0]; F[o + s*3 + 1] = foot[f*6+k+1]; F[o + s*3 + 2] = t2[1];
        vloc((foot[b*6+k] - foot[a*6+k]) / dtv, (foot[b*6+k+2] - foot[a*6+k+2]) / dtv, t2, 0); F[o + 6 + s*3] = t2[0]; F[o + 7 + s*3] = (foot[b*6+k+1] - foot[a*6+k+1]) / dtv; F[o + 8 + s*3] = t2[1]; }
      vloc((hip[b*3] - hip[a*3]) / dtv, (hip[b*3+2] - hip[a*3+2]) / dtv, t2, 0); F[o+12] = t2[0]; F[o+13] = (hip[b*3+1] - hip[a*3+1]) / dtv; F[o+14] = t2[1];
      c.speed[f] = Math.hypot(R[b*3] - R[a*3], R[b*3+1] - R[a*3+1]) / dtv;
      let ok = f >= 1 && f < n - 4;
      for (let j = 0; j < 3; j++) { let t = f + TR[j]; if (t > n - 1) { if (!endStill) ok = false; t = n - 1; }
        loc(R[t*3], R[t*3+1], t2, 0); F[o + 15 + j*2] = t2[0]; F[o + 16 + j*2] = t2[1];
        const dy = R[t*3+2] - y; F[o + 21 + j*2] = Math.sin(dy); F[o + 22 + j*2] = Math.cos(dy); }
      // generated turn-backs: kept for turning back mid-walk, but not for starting from rest (wide splayed legs, hips lag the body by 0.2 s)
      valid[gi] = ok ? (/^hy_turnback/.test(c.name) ? 2 : 1) : 0; }
    c.fl = new Float32Array(n * 6); for (let f = 0; f < n; f++) for (let k = 0; k < 6; k++) c.fl[f*6 + k] = F[(g0 + f)*NF + k];
    g0 += n; }
  // normalisation: one scale per feature group, times the group's weight
  const groups = [[0, 6, W.fpos], [6, 12, W.fvel], [12, 15, W.hvel], [15, 21, W.tpos], [21, 27, W.tdir]];
  const mean = new Float32Array(NF), scale = new Float32Array(NF);
  for (let k = 0; k < NF; k++) { let s = 0; for (let i = 0; i < total; i++) s += F[i*NF + k]; mean[k] = s / total; }
  for (const [a, b, w] of groups) { let s = 0; for (let k = a; k < b; k++) for (let i = 0; i < total; i++) { const d = F[i*NF + k] - mean[k]; s += d*d; } const sd = Math.sqrt(s / (total * (b - a))) || 1;
    for (let k = a; k < b; k++) scale[k] = w / sd; }
  for (let i = 0; i < total; i++) for (let k = 0; k < NF; k++) F[i*NF + k] = (F[i*NF + k] - mean[k]) * scale[k];
  // bounding boxes of 16-frame blocks for pruning
  const BS = 16, NBL = Math.ceil(total / BS); const bmin = new Float32Array(NBL * NF).fill(1e9), bmax = new Float32Array(NBL * NF).fill(-1e9); const bval = new Uint8Array(NBL);
  for (let i = 0; i < total; i++) { if (!valid[i]) continue; const bl = (i / BS) | 0; bval[bl] = 1; for (let k = 0; k < NF; k++) { const v = F[i*NF + k]; if (v < bmin[bl*NF + k]) bmin[bl*NF + k] = v; if (v > bmax[bl*NF + k]) bmax[bl*NF + k] = v; } }

  function search(Qv, bestI, bestC) { let pruned = 0;
    for (let bl = 0; bl < NBL; bl++) { if (!bval[bl]) continue; let lb = 0; const o = bl * NF;
      for (let k = 0; k < NF; k++) { const v = Qv[k]; const d = v < bmin[o+k] ? bmin[o+k] - v : v > bmax[o+k] ? v - bmax[o+k] : 0; lb += d*d; if (lb >= bestC) break; }
      if (lb >= bestC) { pruned++; continue; }
      const e = Math.min(total, (bl + 1) * BS);
      for (let i = bl * BS; i < e; i++) { if (!valid[i] || (valid[i] === 2 && S.noTB)) continue; let c = 0; const fo = i * NF; for (let k = 0; k < NF; k++) { const d = Qv[k] - F[fo + k]; c += d*d; if (c >= bestC) break; } if (c < bestC) { bestC = c; bestI = i; } } }
    S.pruned = pruned / NBL; return [bestI, bestC]; }

  // ---------- runtime state ----------
  const H = hero.H, root = hero.root || H.root, N = hero.N;
  const S = { on: false, ci: 0, t: 0, char: new THREE.Vector3(), cyaw: 0, searchT: 0, lastSearchMs: 0, cost: 0, pruned: 0, settle: 0, prevSim: null, simV: new THREE.Vector3(), simAv: 0,
    jumps: 0, layer: false, stats: { searches: 0, ms: 0, maxMs: 0 } };
  const Qv = new Float32Array(NF), cur = new Float32Array(NB * 4), curH = new Float32Array(3);
  const out = new Float32Array(NB * 4), outH = [0, 0, 0], prevOut = new Float32Array(NB * 4), prevOut2 = new Float32Array(NB * 4), curPrev = new Float32Array(NB * 4), curPrevH = [0, 0, 0], prevOutH = new Float32Array(3), prevOutH2 = new Float32Array(3); let haveOut = false, haveOut2 = false; let wroteH = false, pureH = [0, .9, 0];
  const src = new Float32Array(NB * 4), srcH = new Float32Array(3), prevSrc = new Float32Array(NB * 4), prevSrcH = new Float32Array(3); let haveSrc = false;
  // inertialization offsets (rotation vectors + angular velocity per bone, hips position + velocity)
  const offX = new Float32Array(NB * 3), offV = new Float32Array(NB * 3), offP = new Float32Array(3), offPV = new Float32Array(3);
  const srcKind = new Int8Array(NB).fill(-1); // 0 = hero clip, 1 = motion matching
  // half-lives: a jump inside the database blends out fast; handing the body between motion matching and hero.js clips (ladder, sitting) slower
  const HL_JUMP = opts.halflife ?? .1, HL_SWITCH = .2;
  const damp = hl => (4 * Math.LN2) / (hl + 1e-5) / 2;
  const yB = new Float32Array(NB).fill(damp(HL_JUMP)); let yP = damp(HL_JUMP);

  function sampleClip(c, t, Q, Hh) { const n = c.n; const tt = clamp(t, 0, n - 1); const f0 = Math.floor(tt), f1 = Math.min(n - 1, f0 + 1), a = tt - f0;
    for (let b = 0; b < NB; b++) { const i0 = f0*NB*4 + b*4, i1 = f1*NB*4 + b*4; let q0x, q0y, q0z, q0w, q1x, q1y, q1z, q1w;
      if (b === HIPS) { q0x = c.ql[f0*4]; q0y = c.ql[f0*4+1]; q0z = c.ql[f0*4+2]; q0w = c.ql[f0*4+3]; q1x = c.ql[f1*4]; q1y = c.ql[f1*4+1]; q1z = c.ql[f1*4+2]; q1w = c.ql[f1*4+3]; }
      else { q0x = c.q[i0]; q0y = c.q[i0+1]; q0z = c.q[i0+2]; q0w = c.q[i0+3]; q1x = c.q[i1]; q1y = c.q[i1+1]; q1z = c.q[i1+2]; q1w = c.q[i1+3]; }
      if (q0x*q1x + q0y*q1y + q0z*q1z + q0w*q1w < 0) { q1x = -q1x; q1y = -q1y; q1z = -q1z; q1w = -q1w; }
      let x = q0x + (q1x - q0x)*a, y = q0y + (q1y - q0y)*a, z = q0z + (q1z - q0z)*a, w = q0w + (q1w - q0w)*a; const l = Math.hypot(x, y, z, w) || 1;
      Q[b*4] = x/l; Q[b*4+1] = y/l; Q[b*4+2] = z/l; Q[b*4+3] = w/l; }
    for (let k = 0; k < 3; k++) Hh[k] = c.hl[f0*3+k] + (c.hl[f1*3+k] - c.hl[f0*3+k]) * a; }
  const gidx = () => clips[S.ci].g0 + clamp(Math.round(S.t), 0, clips[S.ci].n - 1);

  // ---------- what the simulation (hero.js navigation) wants over the next second ----------
  const tmpV = new THREE.Vector3(), tmpA = new THREE.Vector3();
  const ARR = opts.decel ?? 1.6; // m/s^2: a person stops within about one step
  function pathPoints() { const pts = [root.position.clone()]; if (!H.path || !H.path.length) return pts;
    for (const st of H.path) { if (st.t === 'ladder') break; const n = N[st.node]; if (!n) break; pts.push(n.p.clone()); } return pts; }
  function predict(out) { // out: [{x,z,yaw}] at 1/3, 2/3, 1 s in world space
    const p = root.position, yaw = root.rotation.y; const pts = pathPoints(); const walking = pts.length > 1;
    if (walking) { const v0 = Math.max(H.v || 0, .3), vmax = H.walkV || 1.05; let total = 0; for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i-1].x, pts[i].z - pts[i-1].z);
      const last = H.path[H.path.length - 1]; const endsAtLadder = H.path.some(s => s.t === 'ladder');
      let finalFace = null; { let lastNode = null; for (const st of H.path) { if (st.t === 'ladder') break; lastNode = st.node; } if (!endsAtLadder && lastNode && N[lastNode] && N[lastNode].face != null) finalFace = N[lastNode].face; }
      // integrate distance along the path with accelerate-to-vmax and a constant-deceleration stop
      let d = 0, v = v0; const res = []; const dt = 1 / 30; let t = 0; let k = 0; const T = [1/3, 2/3, 1];
      while (k < 3) { const rem = endsAtLadder ? 1e9 : total - d; const vStop = Math.sqrt(Math.max(0, 2 * ARR * rem)); const vt = Math.min(vmax, vStop); v += clamp(vt - v, -3 * dt, 2 * dt); d = Math.min(total, d + v * dt); t += dt;
        if (t >= T[k] - 1e-6) { res.push(d); k++; } }
      for (let j = 0; j < 3; j++) { let dd = res[j]; let i = 1; for (; i < pts.length; i++) { const L = Math.hypot(pts[i].x - pts[i-1].x, pts[i].z - pts[i-1].z); if (dd <= L || i === pts.length - 1) break; dd -= L; }
        const A = pts[i-1], B = pts[i]; const L = Math.hypot(B.x - A.x, B.z - A.z) || 1; const u = clamp(dd / L, 0, 1); const x = A.x + (B.x - A.x)*u, z = A.z + (B.z - A.z)*u;
        let fy = Math.atan2(B.x - A.x, B.z - A.z); if (j === 0 && Math.hypot(x - p.x, z - p.z) < .05) fy = yaw;
        const remaining = total - res[j]; if (finalFace != null && remaining < .35) fy = fy + wrapA(finalFace - fy) * clamp(1 - remaining / .35, 0, 1);
        out[j] = { x, z, yaw: fy }; }
      return; }
    // no path: extrapolate the simulation's own velocity (decaying) and turn toward H.face
    const target = H.face ?? yaw; const v = S.simV;
    for (let j = 0; j < 3; j++) { const t = (j + 1) / 3; const k = (1 - Math.exp(-t * 3)) / 3; const da = wrapA(target - yaw); const turn = clamp(da, -3.2 * t, 3.2 * t);
      out[j] = { x: p.x + v.x * k, z: p.z + v.z * k, yaw: yaw + turn }; } }

  function blocked() { if (H.fit || H.seated || H.inBed || H.bedB || H.swing || H.edgeHold) return true;
    if (H.lad && !(H.lad.phase === 'mount' || (H.lad.phase === 'over' && !H.lad.start))) return true; return false; }

  function buildQuery(traj) { const g = gidx(); const o = g * NF; for (let k = 0; k < 15; k++) Qv[k] = F[o + k];
    const cs = Math.cos(-S.cyaw), sn = Math.sin(-S.cyaw);
    for (let j = 0; j < 3; j++) { const dx = traj[j].x - S.char.x, dz = traj[j].z - S.char.z; const lx = dx*cs + dz*sn, lz = -dx*sn + dz*cs; const dy = traj[j].yaw - S.cyaw;
      Qv[15 + j*2] = (lx - mean[15 + j*2]) * scale[15 + j*2]; Qv[16 + j*2] = (lz - mean[16 + j*2]) * scale[16 + j*2];
      Qv[21 + j*2] = (Math.sin(dy) - mean[21 + j*2]) * scale[21 + j*2]; Qv[22 + j*2] = (Math.cos(dy) - mean[22 + j*2]) * scale[22 + j*2]; } }
  function curCost() { const g = gidx(); if (!valid[g] || (valid[g] === 2 && S.noTB)) return 1e9; let c = 0; for (let k = 0; k < NF; k++) { const d = Qv[k] - F[g*NF + k]; c += d*d; } return c; }

  // ---------- foot locking ----------
  const lock = [0, 1].map(() => ({ on: false, hold: false, w: 0, p: new THREE.Vector3(), shown: new THREE.Vector3() }));
  const legs = [[LU, LL, LF], [RU, RL, RF]];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion();
  function turnBone(bone, from, to, w) { const bp = bone.getWorldPosition(new THREE.Vector3()); const v1 = from.clone().sub(bp).normalize(), v2 = to.clone().sub(bp).normalize(); if (v1.lengthSq() < 1e-6 || v2.lengthSq() < 1e-6) return;
    _dq.setFromUnitVectors(v1, v2); if (w < 1) _dq.slerp(new THREE.Quaternion(), 1 - w); bone.getWorldQuaternion(_q); bone.parent.getWorldQuaternion(_pq); bone.quaternion.copy(_pq.invert().multiply(_dq.multiply(_q))); bone.updateMatrixWorld(true); }
  function legIK(s, target, w) { const [ui, li, fi] = legs[s]; const U = HB[ui], L = HB[li], Fb = HB[fi]; const endQ = Fb.getWorldQuaternion(new THREE.Quaternion());
    const a = U.getWorldPosition(new THREE.Vector3()), b = L.getWorldPosition(new THREE.Vector3()), c = Fb.getWorldPosition(new THREE.Vector3()); const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    const goal = c.clone().lerp(target, w); const tv = goal.clone().sub(a); const dd = clamp(tv.length(), Math.abs(l1 - l2) + .01, l1 + l2 - .002); const dir = tv.normalize();
    let pole = b.clone().sub(a.clone().add(c).multiplyScalar(.5)); pole.sub(dir.clone().multiplyScalar(pole.dot(dir))); if (pole.lengthSq() < 1e-8) pole.set(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y)); pole.normalize();
    const ca = clamp((l1*l1 + dd*dd - l2*l2) / (2*l1*dd), -1, 1), sa = Math.sqrt(1 - ca*ca); const knee = a.clone().addScaledVector(dir, ca*l1).addScaledVector(pole, sa*l1);
    turnBone(U, b, knee, 1); turnBone(L, Fb.getWorldPosition(new THREE.Vector3()), a.clone().addScaledVector(dir, dd), 1);
    Fb.parent.getWorldQuaternion(_pq); Fb.quaternion.copy(_pq.invert().multiply(endQ)); Fb.updateMatrixWorld(true); }

  // ---------- inertialization ----------
  function inertialize(b, newQ, ni, hl, vel) { yB[b] = damp(hl); // offset so that offset * newQ == last output, keep the output's angular velocity
    if (!haveOut) { offX[b*3] = offX[b*3+1] = offX[b*3+2] = 0; offV[b*3] = offV[b*3+1] = offV[b*3+2] = 0; return; }
    offV[b*3] = offV[b*3+1] = offV[b*3+2] = 0;
    // WALK: a clip jump keeps the bone where it would be NOW (the last output carried on by its own angular velocity) and keeps
    // that velocity (offset velocity = output's - new clip's). Against the last frame with no velocity the bone stood still for
    // one frame at every jump (~2 a second while walking): the swinging foot stopped dead and went on. Stage trace, walking
    // ankle: mean jerk on the jump frame and the next 1.17 -> 0.32 cm/frame^2, frames over 2.5: 114 -> 5
    let ox = prevOut[b*4], oy = prevOut[b*4+1], oz = prevOut[b*4+2], ow = prevOut[b*4+3];
    if (vel && vel.dt > 1e-4 && haveOut2 && !window.__noPredInert) { const d = [0, 0, 0, 0], v = [0, 0, 0], w = [0, 0, 0], pr = [0, 0, 0, 0];
      qmul(prevOut, b*4, [-prevOut2[b*4], -prevOut2[b*4+1], -prevOut2[b*4+2], prevOut2[b*4+3]], 0, d, 0); if (d[3] < 0) { d[0] = -d[0]; d[1] = -d[1]; d[2] = -d[2]; d[3] = -d[3]; }
      if (2 * Math.acos(Math.min(1, d[3])) < .35) { qlog(d[0], d[1], d[2], d[3], v, 0); qmul(d, 0, prevOut, b*4, pr, 0); const l = Math.hypot(pr[0], pr[1], pr[2], pr[3]) || 1; ox = pr[0]/l; oy = pr[1]/l; oz = pr[2]/l; ow = pr[3]/l;
        qmul(newQ, ni, [-vel.q[ni], -vel.q[ni+1], -vel.q[ni+2], vel.q[ni+3]], 0, d, 0); if (d[3] < 0) { d[0] = -d[0]; d[1] = -d[1]; d[2] = -d[2]; d[3] = -d[3]; } qlog(d[0], d[1], d[2], d[3], w, 0);
        for (let k = 0; k < 3; k++) offV[b*3+k] = clamp(v[k] / vel.dtOut - w[k] / vel.dt, -8, 8); } }
    const nx = -newQ[ni], ny = -newQ[ni+1], nz = -newQ[ni+2], nw = newQ[ni+3];
    const t = [0, 0, 0, 0]; qmul([ox, oy, oz, ow], 0, [nx, ny, nz, nw], 0, t, 0); qlog(t[0], t[1], t[2], t[3], offX, b*3); }
  // angle between q (at qi) and the constant-angular-velocity prediction from a (t-1) and b (t-2)
  function devAngle(q, qi, a, b, i) { const ib = [-b[i], -b[i+1], -b[i+2], b[i+3]], d = [0, 0, 0, 0], pr = [0, 0, 0, 0]; qmul(a, i, ib, 0, d, 0); qmul(d, 0, a, i, pr, 0);
    const dot = Math.abs(pr[0]*q[qi] + pr[1]*q[qi+1] + pr[2]*q[qi+2] + pr[3]*q[qi+3]) / Math.max(1e-9, Math.hypot(pr[0], pr[1], pr[2], pr[3])); return 2 * Math.acos(Math.min(1, dot)); }

  // ---------- final pass: no pose ever pops on screen ----------
  // Runs after everything that touches the skeleton in a frame (hero.js clips and IK, motion matching, collide.js). When a bone's
  // final rotation breaks from its own constant-velocity prediction (a clip switched without a long enough cross-fade, an IK target
  // let go, a correction released), the jump is taken into a decaying offset (inertialization): the bone leaves from where it was on
  // screen and eases into the new pose. Around action changes the threshold is low, elsewhere only real pops trip it.
  const legSide = names.map((n, b) => !isLower[b] ? -1 : /Left/.test(n) ? 0 : /Right/.test(n) ? 1 : -1);
  const FP = { on: opts.pops ?? true, hl: .11, thrHot: .06, thr: .3, chainMin: .04, chainK: 1.2, chainFloor: .2, hot: 0, key: '', n: 0, bones: 0, gen: 0 };
  const fr1 = new Float32Array(NB * 4), fr2 = new Float32Array(NB * 4), fShown = new Float32Array(NB * 4), fRaw = new Float32Array(NB * 4);
  const fX = new Float32Array(NB * 3), fV = new Float32Array(NB * 3); const fDv = new Float32Array(NB), fAcc = new Float32Array(NB), fHit = new Uint8Array(NB); let fN = 0; const fY = damp(FP.hl);
  function final(dt) { if (!(dt > 0)) return; dt = Math.min(dt, .1);
    const cn = H.cur && H.cur.getClip ? H.cur.getClip().name : '';
    const key = cn + '|' + (S.on ? 1 : 0) + (H.lad ? 1 : 0) + (H.fit ? 1 : 0) + (H.seated ? 1 : 0) + (H.inBed ? 1 : 0) + (H.swing ? 1 : 0) + (H.once ? 1 : 0) + '|' + (H.state || '');
    if (key !== FP.key) { FP.hot = .6; FP.key = key; } else FP.hot = Math.max(0, FP.hot - dt);
    const off = !FP.on || window.__noPops; const climbIK = !!(window.__climb && window.__climb.active && window.__climb.weight > .99); // climb IK: every limb is solved each frame from eased targets on the rungs; new pops are not taken (they dragged the hands 20-50 cm off the rungs), running offsets still ease out (zeroing them snapped a foot 30 cm)
    // a blow is meant to be sharp (hero.js repairs hammer, H.noPop = {side, until}): that arm is left out of the pop filter while it lasts
    const np = H.noPop && H.noPop.until > T0() ? H.noPop.side : null;
    for (let b = 0; b < NB; b++) { const B = HB[b]; if (!B) continue; const q = B.quaternion; fRaw[b*4] = q.x; fRaw[b*4+1] = q.y; fRaw[b*4+2] = q.z; fRaw[b*4+3] = q.w; }
    let any = false, hit = 0; const thr = FP.hot > 0 ? FP.thrHot : FP.thr;
    // the game walk (gamewalk.js, ?style=game) plants each foot in the world and solves the legs to it: a 'pop' it makes in a thigh or a
    // shin is the leg reaching its next planned ankle, and easing that bone from last frame's angle took the planted foot off its spot
    // (stage trace, style=game trip: the pop filter alone added 8 cm/frame² to a standing foot). Lower-body bones take no new pops then.
    const gwPlant = !!(window.__gamewalk && window.__gamewalk.S && window.__gamewalk.S.w > .01);
    // a snap spread over a chain (spine, spine1, spine2, neck, head each 8-12 deg in one frame) stays under the per-bone limit but
    // throws the head 25-30 cm: deviations are summed down the chain and a chain over the limit is caught as a whole
    for (let b = 0; b < NB; b++) { fDv[b] = -1; fHit[b] = 0; const B = HB[b]; if (!B) continue;
      const offB = off || (np && names[b] && new RegExp('^' + np + '(Arm|ForeArm|Hand)$').test(names[b]));
      if (!offB && !climbIK && fN >= 2 && !(S.on && isLower[b] && legSide[b] >= 0 && lock[legSide[b]].w > .01) && !(gwPlant && isLower[b])) fDv[b] = devAngle(fRaw, b*4, fr1, fr2, b*4);
      const p = par[b]; fAcc[b] = (fDv[b] > FP.chainMin ? fDv[b] : 0) + (p >= 0 && fDv[p] >= 0 ? fAcc[p] : 0);
      if (fDv[b] > thr) fHit[b] = 1;
      else if (fDv[b] > FP.chainMin && fAcc[b] > Math.max(FP.chainFloor, thr * FP.chainK)) { fHit[b] = 1; for (let q = par[b]; q >= 0 && fDv[q] > FP.chainMin; q = par[q]) fHit[q] = 1; } }
    for (let b = 0; b < NB; b++) { const B = HB[b]; if (!B) continue; const i3 = b*3;
      const offB = off || (np && names[b] && new RegExp('^' + np + '(Arm|ForeArm|Hand)$').test(names[b]));
      { if (fHit[b]) { // start from what was on screen last frame
          const t = [0, 0, 0, 0]; qmul(fShown, b*4, [-fRaw[b*4], -fRaw[b*4+1], -fRaw[b*4+2], fRaw[b*4+3]], 0, t, 0); qlog(t[0], t[1], t[2], t[3], fX, i3); fV[i3] = fV[i3+1] = fV[i3+2] = 0; hit++; } }
      if (offB) { fX[i3] = fX[i3+1] = fX[i3+2] = 0; }
      const e = Math.exp(-fY * dt); for (let k = 0; k < 3; k++) { const j1 = fV[i3+k] + fX[i3+k] * fY; fX[i3+k] = e * (fX[i3+k] + j1 * dt); fV[i3+k] = e * (fV[i3+k] - j1 * fY * dt); }
      if (Math.abs(fX[i3]) + Math.abs(fX[i3+1]) + Math.abs(fX[i3+2]) > 1e-4) { const o = [0, 0, 0, 0]; qexp(o, 0, fX[i3], fX[i3+1], fX[i3+2]); qmul(o, 0, fRaw, b*4, fShown, b*4); B.quaternion.set(fShown[b*4], fShown[b*4+1], fShown[b*4+2], fShown[b*4+3]); any = true; }
      else { fShown[b*4] = fRaw[b*4]; fShown[b*4+1] = fRaw[b*4+1]; fShown[b*4+2] = fRaw[b*4+2]; fShown[b*4+3] = fRaw[b*4+3]; } }
    if (hit) { FP.n++; FP.bones += hit; }
    fr2.set(fr1); fr1.set(fRaw); fN++;
    if (any) root.updateMatrixWorld(true); }
  // hook the final pass after everything else in the hero's update (collide.js wraps HH.update too, possibly later: stay outermost)
  let fWrap = null;
  // hero.js slots (HERO-RULES.md): the pop filter runs in 'pops', before the anatomical guard, instead of wrapping hero.update
  let fStage = false;
  function ensureFinal() { if (fStage) return; if (typeof hero.stage === 'function') { hero.stage('pops', dt => final(dt)); fStage = true; return; }
    if (hero.update === fWrap || typeof hero.update !== 'function') return; const inner = hero.update, g = ++FP.gen;
    fWrap = dt => { inner(dt); if (g === FP.gen) final(dt); }; hero.update = fWrap; }
  function stepOffsets(dt) {
    for (let i = 0; i < NB * 3; i++) { const y = yB[(i / 3) | 0], e = Math.exp(-y * dt); const j1 = offV[i] + offX[i] * y; offX[i] = e * (offX[i] + j1 * dt); offV[i] = e * (offV[i] - j1 * y * dt); }
    { const e = Math.exp(-yP * dt); for (let k = 0; k < 3; k++) { const j1 = offPV[k] + offP[k] * yP; offP[k] = e * (offP[k] + j1 * dt); offPV[k] = e * (offPV[k] - j1 * yP * dt); } } }

  // ---------- called by hero.js at the start of its post(): the pose that was on screen (after all IK) is what blends start from ----------
  // blends continue from our own last output, not the on-screen pose: hero.js adds look / lean / IK on top of motion.js every frame,
  // and starting a jump from the screen pose put that addition in twice (spine and neck snapped 10-12 deg at every clip jump)
  // the hips position as it was on screen, before mixer.update: a later stage (the game walk, a crouch) may have written it after us
  const scrH = [NaN, NaN, NaN];
  function pre() { { const hp = HB[HIPS] && HB[HIPS].position; if (hp) { scrH[0] = hp.x; scrH[1] = hp.y; scrH[2] = hp.z; } }
    if (haveOut && !window.__mmPreScreen) return; for (let b = 0; b < NB; b++) { const B = HB[b]; if (!B) continue; prevOut[b*4] = B.quaternion.x; prevOut[b*4+1] = B.quaternion.y; prevOut[b*4+2] = B.quaternion.z; prevOut[b*4+3] = B.quaternion.w; }
    const hp = HB[HIPS].position; prevOutH[0] = hp.x; prevOutH[1] = hp.y; prevOutH[2] = hp.z; haveOut = true; }
  // ---------- per frame, called by hero.js right after mixer.update ----------
  const traj = [null, null, null];
  const T0 = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function post(dt) { if (!(dt > 0)) return; dt = Math.min(dt, .1); ensureFinal();
    // three.js only writes a bone when the clip value changes, so the hips position may still be what we wrote last frame
    { const hp = HB[HIPS].position; if (!(wroteH && hp.x === outH[0] && hp.y === outH[1] && hp.z === outH[2]) && !(hp.x === scrH[0] && hp.y === scrH[1] && hp.z === scrH[2] && !window.__noScrH)) pureH = [hp.x, hp.y, hp.z]; }
    // (and not what a later stage left there: under ?style=game the walk cycle's hips stayed in the bone while the mixer had no new value,
    // were taken for the clip's, and the body under the walk drifted 20-28 cm off the root, then snapped back when the clip wrote again:
    // stage trace, pot / cook / eat / hatch, whole-body jumps of 12-25 cm/frame² a few frames after the walk handed back)
    const p = root.position, yaw = root.rotation.y;
    if (S.prevSim) { const vx = (p.x - S.prevSim.x) / dt, vz = (p.z - S.prevSim.z) / dt; const k = 1 - Math.exp(-dt * 12); S.simV.x += (vx - S.simV.x) * k; S.simV.z += (vz - S.simV.z) * k; S.simAv = wrapA(yaw - S.prevSim.yaw) / dt; }
    S.prevSim = { x: p.x, z: p.z, yaw };
    const simSpd = Math.hypot(S.simV.x, S.simV.z);
    const isBlocked = blocked();
    const pathing = H.path && H.path.length > 0 && !(H.path[0] && H.path[0].t === 'ladder' && H.lad && H.lad.phase !== 'mount');
    // hysteresis: small heading corrections at a workbench must not flick the legs between clips and motion matching
    const yawErr = Math.abs(wrapA((H.face ?? yaw) - yaw)); S.offT = S.on ? 0 : (S.offT || 0) + dt;
    const turning = !H.trans && (S.on ? yawErr > .08 : yawErr > .9); // small pivots at a workbench stay with hero.js clips
    const moving = S.on ? simSpd > .1 : simSpd > .2 && S.offT > .25;
    const wantOn = !isBlocked && !window.__noMotion && (pathing || moving || (turning && (S.on || S.offT > .25)));
    if (wantOn) S.settle = .9; else S.settle = Math.max(0, S.settle - dt);
    const mmAct = !isBlocked && !window.__noMotion && (wantOn || (S.on && S.settle > 0 && !settled()));
    if (mmAct && !S.on) { // entering: start the character where the body is, find a frame for the current state
      S.on = true; S.onT = 0; S.lockDelay = .3; S.char.set(p.x, p.y, p.z); S.cyaw = yaw; S.searchT = 0; S.forceSearch = true;
      // query from the current skeleton: feet / hips relative to the root (velocity unknown -> zero)
      predict(traj); buildQueryFromBody(traj); const [bi] = search(Qv, -1, 1e9); if (bi >= 0) { S.ci = where[bi*2]; S.t = where[bi*2+1]; } }
    if (!mmAct && S.on) { S.on = false; }
    S.layer = false;
    if (S.on) { S.onT = (S.onT || 0) + dt; S.noTB = S.onT < .8;
      predict(traj);
      S.searchT -= dt;
      if (S.searchT <= 0 || S.forceSearch || S.t >= clips[S.ci].n - 2) { S.searchT = .1; S.forceSearch = false; const t0 = T0();
        buildQuery(traj); const cc = curCost(); const [bi, bc] = search(Qv, -1, cc < 1e8 ? cc - Math.max(.2, cc * .15) : 1e9); // switch only for a clearly better match
        const ms = T0() - t0; S.stats.searches++; S.stats.ms += ms; S.stats.maxMs = Math.max(S.stats.maxMs, ms); S.cost = bc;
        if (bi >= 0) { const ci = where[bi*2], f = where[bi*2+1]; if (!(ci === S.ci && f - S.t > -12 && f - S.t < 8)) { S.ci = ci; S.t = f; S.jumps++; S.jumped = true; S.searchT = .22; S.lockDelay = Math.max(S.lockDelay || 0, .08); } } }
      // playback speed: match the simulation's speed a little (stride warping is limited to +-15%)
      const c = clips[S.ci]; const f = clamp(Math.round(S.t), 0, c.n - 1); const ds = c.speed[f];
      let rate = 1; if (ds > .35 && pathing) rate = clamp((H.v || simSpd) / ds, .87, 1.18);
      const t0 = S.t; S.t = Math.min(c.n - 1, S.t + dt * FPS * rate); const adv = S.t - t0;
      // root motion of the animation
      const fi = Math.floor(t0); const dx = c.dr[fi*3] * adv, dz = c.dr[fi*3+1] * adv, dy = c.dr[fi*3+2] * adv; const cs = Math.cos(S.cyaw), sn = Math.sin(S.cyaw);
      S.char.x += dx*cs + dz*sn; S.char.z += -dx*sn + dz*cs; S.cyaw += dy;
      // pull toward the simulation (short half-life), never further than a hand's width away
      const kp = 1 - Math.exp(-dt * Math.LN2 / .18), ky = 1 - Math.exp(-dt * Math.LN2 / .14);
      S.char.x += (p.x - S.char.x) * kp; S.char.z += (p.z - S.char.z) * kp; S.cyaw += wrapA(yaw - S.cyaw) * ky;
      const ex = S.char.x - p.x, ez = S.char.z - p.z, el = Math.hypot(ex, ez), MAXD = .12; if (el > MAXD) { S.char.x = p.x + ex / el * MAXD; S.char.z = p.z + ez / el * MAXD; }
      const ea = wrapA(S.cyaw - yaw); if (Math.abs(ea) > .5) S.cyaw = yaw + Math.sign(ea) * .5;
      S.char.y = p.y;
      sampleClip(c, S.t, cur, curH);
      if (S.jumped && pathing) { const back = Math.max(adv, .2); sampleClip(c, Math.max(0, S.t - back), curPrev, curPrevH); S.jvel = { q: curPrev, dt: back / FPS, dtOut: S.lastDt || dt }; } else S.jvel = null; // on a route only: at a work spot (approach slides, stops) a jump hands over as before
      // into the hero's root frame (root sits at the simulation)
      const curH0 = [curH[0], curH[1], curH[2]];
      const rel = S.cyaw - yaw; const rq = yawQ(rel); const t3 = new Float32Array(3); qrot(rq, 0, curH, 0, t3, 0);
      const ox = S.char.x - p.x, oz = S.char.z - p.z, c2 = Math.cos(-yaw), s2 = Math.sin(-yaw);
      curH[0] = t3[0] + ox*c2 + oz*s2; curH[1] = t3[1]; curH[2] = t3[2] - ox*s2 + oz*c2;
      const hq = cur.slice(HIPS*4, HIPS*4 + 4); qmul(rq, 0, hq, 0, cur, HIPS*4);
      if (S.jvel) { const pq = curPrev.slice(HIPS*4, HIPS*4 + 4); qmul(rq, 0, pq, 0, curPrev, HIPS*4); const dv = new Float32Array(3); qrot(rq, 0, [curH0[0] - curPrevH[0], curH0[1] - curPrevH[1], curH0[2] - curPrevH[2]], 0, dv, 0); S.jvel.hv = [dv[0] / S.jvel.dt, dv[1] / S.jvel.dt, dv[2] / S.jvel.dt]; }
      // layering: an action clip from hero.js keeps the upper body
      const cn = H.cur && H.cur.getClip ? H.cur.getClip().name : null; S.layer = !!(cn && !LOCO_CLIPS.has(cn) && H.cur.getEffectiveWeight() > .5);
    }
    // ---------- choose the source of every bone, inertialize switches, write the skeleton ----------
    // layered: the action's spine is re-based on the motion-matched pelvis so the upper body keeps the action's orientation
    // instead of swinging with every step's pelvis twist (people counter-rotate the chest when they walk)
    const SPI = iOf.Spine; let spineFix = null;
    if (S.on && S.layer && HB[HIPS] && HB[SPI]) { const mh = HB[HIPS].quaternion; const inv = [-cur[HIPS*4], -cur[HIPS*4+1], -cur[HIPS*4+2], cur[HIPS*4+3]]; const t = [0, 0, 0, 0];
      qmul(inv, 0, [mh.x, mh.y, mh.z, mh.w], 0, t, 0); const sp = HB[SPI].quaternion; spineFix = [0, 0, 0, 0]; qmul(t, 0, [sp.x, sp.y, sp.z, sp.w], 0, spineFix, 0); }
    for (let b = 0; b < NB; b++) { const B = HB[b]; if (!B) continue; let kind, sq, si;
      if (S.on && (isLower[b] || !S.layer)) { kind = 1; sq = cur; si = b*4; }
      else { kind = 0; src[b*4] = B.quaternion.x; src[b*4+1] = B.quaternion.y; src[b*4+2] = B.quaternion.z; src[b*4+3] = B.quaternion.w; sq = src; si = b*4; }
      if (kind === 0 && b === SPI && spineFix) { src.set(spineFix, b*4); }
      if (b === SPI && !!spineFix !== !!S.spFix) { if (srcKind[b] === kind) inertialize(b, sq, si, HL_SWITCH); S.spFix = !!spineFix; }
      if (kind !== srcKind[b] || (kind === 1 && S.jumped)) { if (srcKind[b] !== -1) inertialize(b, sq, si, kind !== srcKind[b] ? HL_SWITCH : HL_JUMP, kind === srcKind[b] ? S.jvel : null); srcKind[b] = kind; }
      const o = [0, 0, 0, 0]; qexp(o, 0, offX[b*3], offX[b*3+1], offX[b*3+2]); qmul(o, 0, sq, si, out, b*4); }
    { const hb = HB[HIPS]; const hk = S.on ? 1 : 0; const hs = S.on ? curH : pureH;
      if (hk !== S.hipKind || (hk === 1 && S.jumped)) { if (S.hipKind != null && haveOut) { const jv = hk === S.hipKind && S.jvel && S.jvel.hv && haveOut2 && !window.__noPredInert; for (let k = 0; k < 3; k++) { offP[k] = prevOutH[k] + (jv ? clamp(prevOutH[k] - prevOutH2[k], -.03, .03) : 0) - hs[k]; offPV[k] = jv ? clamp((prevOutH[k] - prevOutH2[k]) / S.jvel.dtOut - S.jvel.hv[k], -3, 3) : 0; } yP = damp(hk !== S.hipKind ? HL_SWITCH : HL_JUMP); } S.hipKind = hk; }
      for (let k = 0; k < 3; k++) outH[k] = hs[k] + offP[k]; }
    S.jumped = false;
    stepOffsets(dt);
    const anyOff = S.on || offActive();
    if (anyOff) { for (let b = 0; b < NB; b++) { const B = HB[b]; if (B) B.quaternion.set(out[b*4], out[b*4+1], out[b*4+2], out[b*4+3]); } HB[HIPS].position.set(outH[0], outH[1], outH[2]); outH[0] = HB[HIPS].position.x; outH[1] = HB[HIPS].position.y; outH[2] = HB[HIPS].position.z; wroteH = true; } else wroteH = false;
    if (haveOut) { prevOut2.set(prevOut); prevOutH2.set(prevOutH); haveOut2 = true; } prevOut.set(out); prevOutH.set(outH); haveOut = true; S.lastDt = dt;
    root.updateMatrixWorld(true);
    // foot locking while the data says the foot is planted
    if (S.on && !window.__noFootLock) { const c = clips[S.ci], f = clamp(Math.round(S.t), 0, c.n - 1);
      S.lockDelay = (S.lockDelay || 0) - dt; const cs = Math.cos(S.cyaw), sn = Math.sin(S.cyaw);
      for (let s = 0; s < 2; s++) { const L = lock[s]; const inC = !!c.con[f*2+s]; const fb = HB[legs[s][2]]; const ap = fb.getWorldPosition(_a);
        // where the data puts this foot (no blending offsets): character root + the clip's foot, on the hero's floor
        const a0 = f*6 + s*3, lx = c.fl[a0], ly = c.fl[a0+1], lz = c.fl[a0+2]; _b.set(S.char.x + lx*cs + lz*sn, root.position.y + ly, S.char.z - lx*sn + lz*cs);
        if (inC && !L.on && !L.hold && !(S.lockDelay > 0)) { L.on = true; if (L.w > .05) L.p.copy(L.shown); else { L.p.copy(_b); L.p.y = ap.y; /* walk thread: the height where the foot is now (hero.js boardDy put it on its own board); the clip's height is over the root's floor, and planting there sank the standing foot 4 cm as the other stepped onto a higher board (kitchen hatch) */ } }
        // the lock holds the foot in place across the floor, not in height: it rides up and down with the root, and hero.js (boardDy)
        // puts each sole on its own board. A height fixed in the world was lifted again by boardDy as the root went down a step (10 cm)
        { const ry = root.position.y; if (L.ry != null && L.w > .001) L.p.y += ry - L.ry; L.ry = ry; }
        if (inC && L.on && _b.distanceTo(L.p) > .12) { L.on = false; L.hold = true; } // stretched too far: let it go smoothly, re-plant on the next step
        if (!inC) { L.on = false; L.hold = false; }
        L.w = clamp(L.w + (L.on ? dt / .07 : -dt / .16), 0, 1);
        if (L.w > .001) { if (!L.on) L.p.lerp(ap, 1 - Math.exp(-dt * 14)); const w = L.w * L.w * (3 - 2 * L.w); L.shown.copy(ap).lerp(L.p, w); legIK(s, L.p, w); } else L.shown.copy(ap); } }
    // motion matching handed the legs back (a ladder, a seat, a stop): a planted foot is let go over the lock's own release time,
    // not dropped in one frame (gate: the standing foot jumped 10 cm at the foot of a ladder, and the pop filter then overshot it)
    else { root.updateMatrixWorld(true); for (let s = 0; s < 2; s++) { const L = lock[s]; L.on = L.hold = false; if (!(L.w > .001) || window.__noLockFade) { L.w = 0; continue; }
      const ap = HB[legs[s][2]].getWorldPosition(_a); if (ap.distanceTo(L.p) > .3) { L.w = 0; continue; }
      L.w = clamp(L.w - dt / .16, 0, 1); L.p.lerp(ap, 1 - Math.exp(-dt * 14)); const w = L.w * L.w * (3 - 2 * L.w); L.shown.copy(ap).lerp(L.p, w); if (w > .001) legIK(s, L.p, w); } }
    if (S.on) { // world position of the feet for tests
      S.charSpeed = Math.hypot(S.char.x - (S.lastChar ? S.lastChar.x : S.char.x), S.char.z - (S.lastChar ? S.lastChar.z : S.char.z)) / dt; S.lastChar = { x: S.char.x, z: S.char.z }; }
  }
  function offActive() { let m = 0; for (let i = 0; i < NB * 3; i++) m = Math.max(m, Math.abs(offX[i])); return m > 1e-3 || Math.abs(offP[0]) + Math.abs(offP[1]) + Math.abs(offP[2]) > 1e-4; }
  function settled() { const c = clips[S.ci]; const f = clamp(Math.round(S.t), 0, c.n - 1); return c.speed[f] < .08 && c.con[f*2] && c.con[f*2+1]; }
  function buildQueryFromBody(trj) { root.updateMatrixWorld(true); const yaw = root.rotation.y, cs = Math.cos(-yaw), sn = Math.sin(-yaw); const p = root.position;
    const put = (k, v) => { Qv[k] = (v - mean[k]) * scale[k]; };
    [LF, RF].forEach((b, s) => { const w = HB[b].getWorldPosition(_a); const dx = w.x - p.x, dz = w.z - p.z; put(s*3, dx*cs + dz*sn); put(s*3+1, w.y - p.y); put(s*3+2, -dx*sn + dz*cs); });
    for (let k = 6; k < 12; k++) put(k, 0); const vx = S.simV.x*cs + S.simV.z*sn, vz = -S.simV.x*sn + S.simV.z*cs; put(12, vx); put(13, 0); put(14, vz);
    S.char.set(p.x, p.y, p.z); S.cyaw = yaw;
    for (let j = 0; j < 3; j++) { const dx = trj[j].x - p.x, dz = trj[j].z - p.z; put(15 + j*2, dx*cs + dz*sn); put(16 + j*2, -dx*sn + dz*cs); const dy = trj[j].yaw - yaw; put(21 + j*2, Math.sin(dy)); put(22 + j*2, Math.cos(dy)); } }

  // timing check: n full searches against random database frames as queries (Date.now: works under a frozen performance.now)
  function bench(n = 400) { let pr = 0; const t0 = Date.now(); for (let i = 0; i < n; i++) { const g = (Math.random() * total) | 0; for (let k = 0; k < NF; k++) Qv[k] = F[g*NF + k] + (Math.random() - .5) * .3; search(Qv, -1, 1e9); pr += S.pruned; } return { msPerSearch: (Date.now() - t0) / n, pruned: pr / n }; }
  // snap(): a teleport (the QA spawn) drops the inertialization still easing out of the cut-off clip, and the foot locks (a walk's
  // standing-hips offset carried 38 cm into the seated reading pose and pulled the root off the chair for a few frames)
  function snap() { offX.fill(0); offV.fill(0); offP.fill(0); offPV.fill(0); haveOut = haveOut2 = false; S.hipKind = null; srcKind.fill(-1); for (const L of lock) { L.on = L.hold = false; L.w = 0; } }
  const api = { pre, post, bench, snap, S, clips, frames: total, stats: S.stats, traj: () => traj, pops: () => ({ n: FP.n, bones: FP.bones }), info: () => ({ on: S.on, clip: clips[S.ci].name, t: S.t, cost: S.cost, layer: S.layer, jumps: S.jumps, char: S.char.clone(), cyaw: S.cyaw, pruned: S.pruned, lk: lock.map(L => (L.on ? 'L' : L.hold ? 'h' : '-') + L.w.toFixed(2)).join(' '), f: Math.round(S.t) }) };
  return api;
}
