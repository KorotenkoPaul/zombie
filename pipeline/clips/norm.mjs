// trim + face +Z at the first kept frame + start hips at x=z=0. usage: node norm.mjs in.json out.json [t0] [t1] [faceAtSec]
import fs from 'fs'; import * as T from 'three';
const [,, inp, out, t0s, t1s, faceS] = process.argv; const C = JSON.parse(fs.readFileSync(inp, 'utf8'));
const fps = C.fps || 30, F = C.frames; const a = Math.max(0, Math.round((+t0s || 0) * fps)), b = t1s && t1s !== '-' ? Math.min(F - 1, Math.round(+t1s * fps)) : F - 1;
const tr = {}; for (const k of Object.keys(C.tracks)) tr[k] = C.tracks[k].slice(a * 4, (b + 1) * 4); const hips = C.hips.slice(a * 3, (b + 1) * 3); const n = b - a + 1;
// facing from the Hips rotation: hero rest faces +Z, so forward = Hips world rotation * rest^-1 applied to +Z. Use hip-line instead (robust): needs FK; approximate with Hips quat * (0,0,1) relative to frame where rest gives +Z
const fa = faceS ? Math.round(+faceS * fps) - a : 0;
const q0 = new T.Quaternion().fromArray(tr.Hips, fa * 4); const rest = new T.Quaternion(-0.034, 0.003, 0.003, 0.999).normalize();
const f = new T.Vector3(0, 0, 1).applyQuaternion(q0.clone().multiply(rest.clone().invert())); const yaw = Math.atan2(f.x, f.z);
const R = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -yaw);
const h0 = new T.Vector3(hips[0], 0, hips[2]);
for (let i = 0; i < n; i++) { const q = new T.Quaternion().fromArray(tr.Hips, i * 4).premultiply(R); q.toArray(tr.Hips, i * 4);
  const v = new T.Vector3(hips[i*3] - h0.x, hips[i*3+1], hips[i*3+2] - h0.z).applyAxisAngle(new T.Vector3(0,1,0), -yaw); hips[i*3] = +v.x.toFixed(4); hips[i*3+1] = +v.y.toFixed(4); hips[i*3+2] = +v.z.toFixed(4); }
for (const k of Object.keys(tr)) tr[k] = tr[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(out, JSON.stringify({ ...C, frames: n, tracks: tr, hips, trim: [a / fps, b / fps] }));
console.log(out, n, 'frames, turned', (yaw * 180 / Math.PI).toFixed(0), 'deg');
