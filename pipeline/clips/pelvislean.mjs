// Lean from the hips, not the upper back: in the deep part (depth weight) tilt the pelvis forward to PT deg from vertical,
// then uncurl the spine chain (Spine*Spine1*Spine2 vs pelvis) to <= SC deg and the head chain (Neck*Head vs chest) to <= HC deg
// by slerping those locals toward their bind rotations. Reports the metrics per frame.
// usage: node pelvislean.mjs hero.glb in.json out.json [PT=40] [SC=45] [HC=35] [HIPTOP=0.80]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, ptA = '40', scA = '45', hcA = '35', htA = '0.80'] = process.argv; const D = Math.PI / 180, PT = +ptA * D, SC = +scA * D, HC = +hcA * D, HT = +htA; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}, REST = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); REST[o.name] = o.quaternion.clone(); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const Y = new T.Vector3(0,1,0);
// swing of a chain product vs the rest product (as pose.js chain())
const swing = (names) => { const q = new T.Quaternion(), r = new T.Quaternion(); for (const n of names) { q.multiply(O[n].quaternion); r.multiply(REST[n]); } const d = r.clone().invert().multiply(q); const ax = Y.clone().applyQuaternion(d); return Math.acos(Math.max(-1, Math.min(1, ax.y))); };
const pelvisTilt = () => { const u = Y.clone().applyQuaternion(wq('Hips').multiply(REST.Hips.clone().invert())); const lat = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize(); const fw = lat.clone().cross(Y).normalize(); return Math.atan2(u.dot(fw), u.y); };
const tiltW = n => Math.acos(Math.max(-1, Math.min(1, Y.clone().applyQuaternion(wq(n)).y)));
let hmin = 9; for (let f = 0; f < F; f++) hmin = Math.min(hmin, C.hips[f*3+1]);
const w0 = []; for (let f = 0; f < F; f++) w0.push(Math.max(0, Math.min(1, (HT - C.hips[f*3+1]) / (HT - hmin))));
const w = w0.map((_, f) => { let q = 0, s = 0; for (let k = -5; k <= 5; k++) { const j = Math.max(0, Math.min(F-1, f+k)), g = Math.exp(-k*k/8); q += w0[j]*g; s += g; } return q/s; }).map(x => x*x*(3-2*x));
const uncurl = (names, cap) => { for (let it = 0; it < 30; it++) { const s = swing(names); if (s <= cap) return; const t = Math.min(1, (s - cap) / s + 0.02); for (const n of names) O[n].quaternion.slerp(REST[n], t); root.updateMatrixWorld(true); } };
const rep = []; let mxS = 0, mxH = 0, mnP = 9, mxP = 0;
for (let f = 0; f < F; f++) { setFrame(f);
  // 1) uncurl first (keeps the world chest direction lost -> recovered by pelvis tilt below)
  const chestTilt0 = tiltW('Spine2');
  uncurl(['Spine','Spine1','Spine2'], SC + (1 - w[f]) * 30 * D);
  // 2) pelvis forward so the chest tilt is restored, but the pelvis goes to at least PT*w and the chest at most its old tilt
  const lat = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize();
  const keep = {}; for (const n of ['LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot']) keep[n] = wq(n);
  { const d = Math.max(0, PT * w[f] - pelvisTilt()); const q0 = wq('Hips'); const p0 = pelvisTilt(); setWorldQ('Hips', new T.Quaternion().setFromAxisAngle(lat, d).multiply(q0)); if (pelvisTilt() < p0) setWorldQ('Hips', new T.Quaternion().setFromAxisAngle(lat, -d).multiply(q0)); }
  for (const n of ['LeftUpLeg','LeftLeg','LeftFoot','RightUpLeg','RightLeg','RightFoot']) setWorldQ(n, keep[n]);
  // 3) head vs chest
  uncurl(['Neck','Head'], HC);
  const s = swing(['Spine','Spine1','Spine2']), h = swing(['Neck','Head']), p = pelvisTilt(); mxS = Math.max(mxS, s); mxH = Math.max(mxH, h); if (w[f] > 0.9) { mnP = Math.min(mnP, p); mxP = Math.max(mxP, p); }
  if (f % 6 === 0) rep.push(`${f} w${w[f].toFixed(2)} pelvis ${(p/D).toFixed(0)} spine ${(s/D).toFixed(0)} head ${(h/D).toFixed(0)} chestW ${(tiltW('Spine2')/D).toFixed(0)}`);
  for (const n of ['Hips','Spine','Spine1','Spine2','Neck','Head','LeftUpLeg','RightUpLeg','LeftLeg','RightLeg','LeftFoot','RightFoot']) O[n].quaternion.toArray(C.tracks[n], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(rep.join('\n')); console.log('max spine', (mxS/D).toFixed(0), 'max head', (mxH/D).toFixed(0), 'pelvis in deep part', (mnP/D).toFixed(0), '..', (mxP/D).toFixed(0));
