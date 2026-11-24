// Soft-limit forward trunk lean (Hips->Neck vs vertical). Above LIM deg the excess is reduced to 30%,
// taken out of Spine1/Spine2 and smoothed in time. usage: node limitlean.mjs hero.glb in.json out.json [LIM=42]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, limArg = '42'] = process.argv; const LIM = +limArg; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const up = new T.Vector3(0, 1, 0); const ex = []; const axes = [];
for (let f = 0; f < F; f++) { setFrame(f); const s = wp('Neck').sub(wp('Hips')); const lean = s.angleTo(up) * 180 / Math.PI;
  const e = lean > LIM ? (lean - LIM) * 0.7 : 0; ex.push(e); axes.push(s.clone().cross(up).normalize()); }
// smooth excess (dilate 4, gaussian sigma 4)
const dil = ex.map((_, f) => { let m = 0; for (let k = -4; k <= 4; k++) { const j = f + k; if (j >= 0 && j < F) m = Math.max(m, ex[j]); } return m; });
const sm = dil.map((_, f) => { let q = 0, sw = 0; for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/32); q += dil[j]*w; sw += w; } return q / sw; });
let mx = 0;
for (let f = 0; f < F; f++) { if (sm[f] < 0.05) continue; setFrame(f); const ax = axes[f]; mx = Math.max(mx, sm[f]);
  for (const b of ['Spine', 'Spine1', 'Spine2']) { const ang = sm[f] / 3 * Math.PI / 180; const qW = new T.Quaternion().setFromAxisAngle(ax, ang);
    const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq);
    O[b].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); O[b].quaternion.toArray(C.tracks[b], f * 4); } }
for (const b of ['Spine','Spine1','Spine2']) C.tracks[b] = C.tracks[b].map(v => +v.toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'max reduction deg', mx.toFixed(1));
