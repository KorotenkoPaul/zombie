// Cap head yaw relative to the pelvis (owl-head) at MAX deg by twisting Neck+Head back about world up; smoothed (circular for loops).
// usage: node yawcap.mjs hero.glb in out [MAX=55]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, mArg = '55'] = process.argv; const MAX = +mArg; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames; const up = new T.Vector3(0,1,0);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
// rest-relative forward of a bone: take the bone's world quat times its bind-relative 'forward' measured at bind (rest pose = frame of identity anim? use world z of bind)
setFrame(0); const bindQ = {}; { const R = {}; for (const n of ['Hips','Head']) { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); R[n] = q; } }
const fwdOf = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); const v = new T.Vector3(0, 0, 1).applyQuaternion(q.multiply(restInv[n])); v.y = 0; return v.normalize(); };
// rest pose world quats from the glb bind (no animation)
const restInv = {}; { const saved = {}; for (const b of Object.keys(O)) saved[b] = O[b].quaternion.clone(); doc.getRoot().listNodes().forEach(n => { const nm = n.getName().replace('mixamorig:', ''); if (O[nm]) O[nm].quaternion.fromArray(n.getRotation()); }); root.updateMatrixWorld(true);
  for (const n of ['Hips','Head']) { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); restInv[n] = q.invert(); } for (const b of Object.keys(O)) O[b].quaternion.copy(saved[b]); }
const yaw = () => { const a = fwdOf('Hips'), b = fwdOf('Head'); let ang = Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 180 / Math.PI; if (a.clone().cross(b).y < 0) ang = -ang; return ang; };
const Y = []; for (let f = 0; f < F; f++) { setFrame(f); Y.push(yaw()); }
const ex = Y.map(y => Math.sign(y) * Math.max(0, Math.abs(y) - MAX));
const dl = ex.map((_, f) => { let m = 0; for (let k = -5; k <= 5; k++) { const j = ((f + k) % F + F) % F; if (Math.abs(ex[j]) > Math.abs(m)) m = ex[j]; } return m; });
const sm = dl.map((_, f) => { let q = 0, sw = 0; for (let k = -12; k <= 12; k++) { const j = ((f + k) % F + F) % F, w = Math.exp(-k*k/32); q += dl[j]*w; sw += w; } return q/sw; });
for (let f = 0; f < F; f++) { if (Math.abs(sm[f]) < .1) continue; setFrame(f);
  for (const b of ['Neck','Head']) { const qW = new T.Quaternion().setFromAxisAngle(up, -sm[f] / 2 * Math.PI / 180); const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq);
    O[b].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); O[b].quaternion.toArray(C.tracks[b], f * 4); } }
for (const k of ['Neck','Head']) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
const Y2 = []; for (let f = 0; f < F; f++) { setFrame(f); Y2.push(yaw()); }
if (process.env.DUMP) console.log(Y.map(v=>v.toFixed(0)).join(" "));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'head yaw max', Math.max(...Y.map(Math.abs)).toFixed(0), '->', Math.max(...Y2.map(Math.abs)).toFixed(0), 'at', Y.map(Math.abs).indexOf(Math.max(...Y.map(Math.abs))));
