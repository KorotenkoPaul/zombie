// After raising the hips (kneeopen), bend the trunk a little more so the lower hand gets back down to its original height.
// usage: node handdrop.mjs hero.glb orig.json fixed.json out.json
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, origP, inp, outp] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = (C, f) => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const A = JSON.parse(fs.readFileSync(origP, 'utf8')), C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const low = () => Math.min(wp('LeftHand').y, wp('RightHand').y);
const diff = []; for (let f = 0; f < F; f++) { setFrame(A, f); const a = low(); setFrame(C, f); const c = low(); const L = wp('Spine').distanceTo(wp('LeftHand')) || .6; diff.push(Math.max(0, Math.atan((c - a) / L))); }
const sm = diff.map((_, f) => { let q = 0, sw = 0; for (let k = -10; k <= 10; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/24); q += diff[j]*w; sw += w; } return q / sw; });
for (let it = 0; it < 1; it++) for (let f = 0; f < F; f++) { if (sm[f] < 0.005) continue; setFrame(C, f);
  const left = wp('LeftUpLeg').sub(wp('RightUpLeg')); left.y = 0; left.normalize();
  for (const b of ['Spine','Spine1','Spine2']) { const before = low(); const qW = new T.Quaternion().setFromAxisAngle(left, sm[f] / 3); const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq);
    const save = O[b].quaternion.clone(); O[b].quaternion.copy(pq.clone().invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true);
    if (low() > before) { const qW2 = new T.Quaternion().setFromAxisAngle(left, -sm[f] / 3); const wq2 = save.clone(); O[b].quaternion.copy(save); root.updateMatrixWorld(true); O[b].getWorldQuaternion(wq2); O[b].quaternion.copy(pq.clone().invert().multiply(qW2.multiply(wq2))); root.updateMatrixWorld(true); }
    O[b].quaternion.toArray(C.tracks[b], f * 4); } }
for (const k of ['Spine','Spine1','Spine2']) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('max extra bend deg', (Math.max(...sm) * 57.3).toFixed(1));
