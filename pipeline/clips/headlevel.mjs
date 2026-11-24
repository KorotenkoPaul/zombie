// Keep the head from hanging forward: if the head's up vector tips forward more than MAX (sin), pitch Neck+Head back
// (split 40/60), smoothed in time. usage: node headlevel.mjs hero.glb in.json out.json [MAXDEG=14]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, mArg = '14'] = process.argv; const MAX = +mArg; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const up = new T.Vector3(0, 1, 0);
const frame = () => { const left = wp('LeftShoulder').sub(wp('RightShoulder')); left.y = 0; left.normalize(); const fwd = left.clone().cross(up).normalize(); return { left, fwd }; };
// pitch in degrees: angle of head-up vector toward fwd (positive = nodding down)
const pitch = () => { const { fwd } = frame(); const hu = wp('HeadTop_End').sub(wp('Head')).normalize(); return Math.asin(Math.max(-1, Math.min(1, hu.dot(fwd)))) * 180 / Math.PI; };
// determine fwd sign: chest forward = direction the toes point
setFrame(0); { const { fwd } = frame(); const toe = wp('LeftToe_End').add(wp('RightToe_End')).multiplyScalar(.5).sub(wp('LeftFoot').add(wp('RightFoot')).multiplyScalar(.5)); toe.y = 0; if (toe.dot(fwd) < 0) globalThis.FLIP = true; }
const P0 = []; for (let f = 0; f < F; f++) { setFrame(f); P0.push((globalThis.FLIP ? -1 : 1) * pitch()); }
const ex = P0.map(p => Math.max(0, p - MAX));
const sm = ex.map((_, f) => { let q = 0, sw = 0; for (let k = -15; k <= 15; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/50); q += ex[j]*w; sw += w; } return q / sw; });
function rot(b, ax, ang) { const qW = new T.Quaternion().setFromAxisAngle(ax, ang); const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq); O[b].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); }
let mx = 0;
for (let f = 0; f < F; f++) { if (sm[f] < 0.2) continue; setFrame(f); const { left } = frame(); const a = sm[f] * Math.PI / 180; mx = Math.max(mx, sm[f]);
  // try +left; if it increases the nod, use -left
  const before = pitch(); const save = ['Neck','Head'].map(b => O[b].quaternion.clone());
  rot('Neck', left, a * .4); rot('Head', left, a * .6); let after = pitch();
  if (Math.abs(after) > Math.abs(before)) { ['Neck','Head'].forEach((b, i) => O[b].quaternion.copy(save[i])); root.updateMatrixWorld(true); rot('Neck', left, -a * .4); rot('Head', left, -a * .6); }
  for (const b of ['Neck','Head']) O[b].quaternion.toArray(C.tracks[b], f * 4); }
for (const b of ['Neck','Head']) C.tracks[b] = C.tracks[b].map(v => +v.toFixed(5));
const P1 = []; for (let f = 0; f < F; f++) { setFrame(f); P1.push((globalThis.FLIP ? -1 : 1) * pitch()); }
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'nod max before', Math.max(...P0).toFixed(0), 'after', Math.max(...P1).toFixed(0), 'mean', (P0.reduce((a,b)=>a+b)/F).toFixed(0), '->', (P1.reduce((a,b)=>a+b)/F).toFixed(0));
