// Flatten planted feet (heel not lifted above the ball more than BASE) and optionally smooth a loop seam circularly.
// usage: node footflat.mjs hero.glb in.json out.json [--seam]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, ...flags] = process.argv; await MeshoptDecoder.ready; const SEAM = flags.includes('--seam');
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const BASE = 0.045; let fixedMax = 0;
if (SEAM) { // circular gaussian smoothing of all tracks and hips within +-10 frames of the seam
  const W = +(process.env.SEAMW || 10), sig = +(process.env.SEAMS || 3);
  for (const b of Object.keys(C.tracks)) { const a = C.tracks[b], src = a.slice(); const q = i => { const j = ((i % F) + F) % F; return [src[j*4], src[j*4+1], src[j*4+2], src[j*4+3]]; };
    for (let d = -W; d < W; d++) { const f = ((d % F) + F) % F; const ref = q(f); const acc = [0,0,0,0]; let sw = 0;
      for (let k = -8; k <= 8; k++) { let v = q(f + k); if (v[0]*ref[0]+v[1]*ref[1]+v[2]*ref[2]+v[3]*ref[3] < 0) v = v.map(x => -x); const w = Math.exp(-k*k/(2*sig*sig)) * (1 - Math.abs(d + .5) / W); const w0 = Math.exp(-k*k/(2*sig*sig)); for (let c = 0; c < 4; c++) acc[c] += v[c]*w0; sw += w0; }
      const s = acc.map(x => x / sw); const l = Math.hypot(...s); const t = 1 - Math.abs(d + .5) / W; for (let c = 0; c < 4; c++) a[f*4+c] = ref[c] * (1 - t) + s[c] / l * t; const l2 = Math.hypot(a[f*4], a[f*4+1], a[f*4+2], a[f*4+3]); for (let c = 0; c < 4; c++) a[f*4+c] /= l2; } }
  const h = C.hips, hs = h.slice(); for (let d = -W; d < W; d++) { const f = ((d % F) + F) % F; const t = 1 - Math.abs(d + .5) / W; for (let c = 0; c < 3; c++) { let s = 0, sw = 0; for (let k = -8; k <= 8; k++) { const j = (((f + k) % F) + F) % F; const w = Math.exp(-k*k/18); s += hs[j*3+c]*w; sw += w; } h[f*3+c] = hs[f*3+c]*(1-t) + s/sw*t; } }
}
if (flags.includes("--noflat")) { for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5)); C.hips = C.hips.map(v => +(+v).toFixed(4)); fs.writeFileSync(outp, JSON.stringify(C)); console.log("seam only"); process.exit(0); }
const floorY = {}; for (const s of ['Left','Right']) { let m = 9; for (let f = 0; f < F; f++) { setFrame(f); m = Math.min(m, wp(s+'ToeBase').y); } floorY[s] = m; }
const corr = { Left: [], Right: [] };
for (let f = 0; f < F; f++) { setFrame(f); for (const s of ['Left','Right']) { const heel = wp(s+'Foot'), ball = wp(s+'ToeBase'); const planted = ball.y < floorY[s] + 0.05;
  const e = heel.y - ball.y - BASE; corr[s].push(planted && e > 0 ? e : 0); } }
for (const s of ['Left','Right']) { const c = corr[s]; const sm = c.map((_, f) => { let q = 0, sw = 0; for (let k = -6; k <= 6; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/8); q += c[j]*w; sw += w; } return q/sw; }); corr[s] = sm; }
for (let f = 0; f < F; f++) { setFrame(f); for (const s of ['Left','Right']) { const e = corr[s][f]; if (e < 0.002) continue; fixedMax = Math.max(fixedMax, e);
  const heel = wp(s+'Foot'), ball = wp(s+'ToeBase'); const fd = ball.clone().sub(heel); const L = fd.length(); const ax = fd.clone().cross(new T.Vector3(0,1,0)).normalize();
  // rotating the foot about ax by +ang lifts the ball (dorsiflexion); check sign numerically
  const ang = Math.asin(Math.min(1, e / L)); const pq = new T.Quaternion(); O[s+'Foot'].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[s+'Foot'].getWorldQuaternion(wq);
  const save = O[s+'Foot'].quaternion.clone(); const y0 = ball.y;
  O[s+'Foot'].quaternion.copy(pq.clone().invert().multiply(new T.Quaternion().setFromAxisAngle(ax, ang).multiply(wq.clone()))); root.updateMatrixWorld(true);
  if (wp(s+'ToeBase').y < y0) { O[s+'Foot'].quaternion.copy(pq.clone().invert().multiply(new T.Quaternion().setFromAxisAngle(ax, -ang).multiply(wq.clone()))); root.updateMatrixWorld(true); }
  O[s+'Foot'].quaternion.toArray(C.tracks[s+'Foot'], f * 4); } }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5)); C.hips = C.hips.map(v => +(+v).toFixed(4));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'max heel lowered', fixedMax.toFixed(3), SEAM ? 'seam smoothed' : '');
