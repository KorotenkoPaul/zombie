// Build delivered clips from recipes. usage: node build.mjs recipes.json outDir [only1,only2]
// recipe: {src:'80_71', t0, t1, upper?:{src,t0,t1}, base?:'pingpong'|'loop'|'hold', mirror?:bool, note}
// src clips are n_<id>.json (normalized: faces +Z at frame 0, hips start x=z=0)
import fs from 'fs'; import * as T from 'three';
const [,, recPath, outDir, onlyS] = process.argv; const R = JSON.parse(fs.readFileSync(recPath, 'utf8')); const only = onlyS ? onlyS.split(',') : null;
const UPPER = ['Spine','Spine1','Spine2','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand'];
const load = id => JSON.parse(fs.readFileSync(fs.existsSync(`/tmp/w/n_${id}.json`) ? `/tmp/w/n_${id}.json` : `/tmp/w/${id}.json`, 'utf8'));
const win = (C, t0, t1) => { const a = Math.round((t0 || 0) * 30), b = t1 != null ? Math.min(C.frames - 1, Math.round(t1 * 30)) : C.frames - 1; const tr = {};
  for (const k of Object.keys(C.tracks)) tr[k] = C.tracks[k].slice(a * 4, (b + 1) * 4); return { fps: 30, frames: b - a + 1, tracks: tr, hips: C.hips.slice(a * 3, (b + 1) * 3) }; };
const qa = (C, b, i) => new T.Quaternion().fromArray(C.tracks[b], i * 4);
function faceZ(C) { // yaw so the hip line at frame 0 faces +Z; hips start at x=z=0
  // forward from Hips quat with hero rest compensation
  const rest = new T.Quaternion(-0.034, 0.003, 0.003, 0.999).normalize();
  const f = new T.Vector3(0, 0, 1).applyQuaternion(qa(C, 'Hips', 0).multiply(rest.invert())); const yaw = Math.atan2(f.x, f.z);
  const Ry = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -yaw); const x0 = C.hips[0], z0 = C.hips[2];
  for (let i = 0; i < C.frames; i++) { qa(C, 'Hips', i).premultiply(Ry).toArray(C.tracks.Hips, i * 4);
    const v = new T.Vector3(C.hips[i*3] - x0, C.hips[i*3+1], C.hips[i*3+2] - z0).applyQuaternion(Ry); C.hips[i*3] = v.x; C.hips[i*3+1] = v.y; C.hips[i*3+2] = v.z; } }
function mirror(C) { const sw = b => b.startsWith('Left') ? 'Right' + b.slice(4) : b.startsWith('Right') ? 'Left' + b.slice(5) : b; const nt = {};
  for (const b of Object.keys(C.tracks)) { const src = C.tracks[sw(b)], a = []; for (let i = 0; i < C.frames; i++) { a.push(src[i*4], -src[i*4+1], -src[i*4+2], src[i*4+3]); } nt[b] = a; }
  C.tracks = nt; for (let i = 0; i < C.frames; i++) C.hips[i*3] = -C.hips[i*3]; }
fs.mkdirSync(outDir, { recursive: true });
for (const [name, r] of Object.entries(R)) { if (only && !only.includes(name)) continue; if (name.startsWith('_')) continue;
  let C = win(load(r.src), r.t0, r.t1);
  if (r.upper) { const U = win(load(r.upper.src), r.upper.t0, r.upper.t1); const n = U.frames; const B = C; const out = { fps: 30, frames: n, tracks: {}, hips: [] };
    const idx = i => { if (B.frames >= n) return i; if (r.base === 'hold') return Math.min(i, B.frames - 1); const p = 2 * (B.frames - 1) || 1; const k = i % p; return k < B.frames ? k : p - k; };
    for (const b of Object.keys(B.tracks)) { out.tracks[b] = []; const S = UPPER.includes(b) ? U : B; for (let i = 0; i < n; i++) { const j = S === U ? i : idx(i); out.tracks[b].push(...S.tracks[b].slice(j * 4, j * 4 + 4)); } }
    // upper-body lean correction: keep the spine's world pitch of the upper clip relative to its own hips (default) 
    for (let i = 0; i < n; i++) out.hips.push(...B.hips.slice(idx(i) * 3, idx(i) * 3 + 3));
    // keep the upper clip's chest orientation in the world (an upright standing torso on a seated/kneeling pelvis), yaw taken from the base pelvis
    if (r.keepChest !== false) for (let i = 0; i < n; i++) { const Hb = qa(B, 'Hips', idx(i)), Hu = qa(U, 'Hips', i), Su = qa(U, 'Spine', i);
      // remove the upper clip's pelvis yaw difference: only pitch/roll of the world chest are kept relative to the base yaw
      const W = Hu.clone().multiply(Su); const yb = new T.Euler().setFromQuaternion(Hb, 'YXZ').y, yu = new T.Euler().setFromQuaternion(Hu, 'YXZ').y;
      W.premultiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0), yb - yu));
      const L = Hb.clone().invert().multiply(W); const k = (r.chestKeep ?? 1); const S0 = qa(B, 'Spine', idx(i)); S0.slerp(L, k).toArray(out.tracks.Spine, i * 4); }
    C = out; }
  if (r.dampLegs) { const LEGS = ['LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','RightUpLeg','RightLeg','RightFoot','RightToeBase'];
    for (const b of LEGS) { if (!C.tracks[b]) continue; const m = [0,0,0,0]; const q0 = qa(C, b, 0); for (let i = 0; i < C.frames; i++) { const q = qa(C, b, i); const s = q.dot(q0) < 0 ? -1 : 1; m[0] += s*q.x; m[1] += s*q.y; m[2] += s*q.z; m[3] += s*q.w; }
      const M = new T.Quaternion(...m).normalize(); for (let i = 0; i < C.frames; i++) M.clone().slerp(qa(C, b, i), 1 - r.dampLegs).toArray(C.tracks[b], i * 4); } }
  if (r.mirror) mirror(C);
  faceZ(C);
  for (const b of Object.keys(C.tracks)) { const a = C.tracks[b]; for (let i = 1; i < C.frames; i++) { const d = a[i*4]*a[i*4-4] + a[i*4+1]*a[i*4-3] + a[i*4+2]*a[i*4-2] + a[i*4+3]*a[i*4-1]; if (d < 0) for (let k = 0; k < 4; k++) a[i*4+k] = -a[i*4+k]; } C.tracks[b] = a.map(v => +(+v).toFixed(5)); }
  C.hips = C.hips.map(v => +(+v).toFixed(4));
  const o = { name, fps: 30, frames: C.frames, source: r.upper ? `CMU ${r.src} [${r.t0}-${r.t1}s] legs + CMU ${r.upper.src} [${r.upper.t0}-${r.upper.t1}s] upper body` : `CMU ${r.src} [${r.t0 ?? 0}-${r.t1 ?? 'end'}s]`, license: 'CMU Graphics Lab Motion Capture Database, free for any use', note: r.note || '', tracks: C.tracks, hips: C.hips };
  fs.writeFileSync(`${outDir}/${name}.json`, JSON.stringify(o)); console.log(name, C.frames, 'frames'); }
