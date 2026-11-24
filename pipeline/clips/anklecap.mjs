// Cap ankle dorsiflexion: angle(Leg->Foot, Foot->ToeBase) <= CAP deg (hero-neutral ~85). The foot is pointed down about
// its hinge (heel rises), then the whole body is raised so the lowest ball stays on its original floor height. Smoothed.
// usage: node anklecap.mjs hero.glb in.json out.json [CAP=88]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, capArg = '88'] = process.argv; const CAP = +capArg * Math.PI / 180; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const ank = s => wp(s+'Foot').sub(wp(s+'Leg')).angleTo(wp(s+'ToeBase').sub(wp(s+'Foot')));
const ex = { Left: [], Right: [] }; const ball0 = [];
for (let f = 0; f < F; f++) { setFrame(f); for (const s of ['Left','Right']) ex[s].push(Math.max(0, ank(s) - CAP)); ball0.push(Math.min(wp('LeftToeBase').y, wp('RightToeBase').y)); }
const smooth = (c, R = 8, s2 = 18) => c.map((_, f) => { let q = 0, sw = 0; for (let k = -R; k <= R; k++) { const j = ((f + k) % F + F) % F, w = Math.exp(-k*k/s2); q += c[j]*w; sw += w; } return q/sw; });
const dil = c => c.map((_, f) => { let m = 0; for (let k = -4; k <= 4; k++) { const j = ((f + k) % F + F) % F; m = Math.max(m, c[j]); } return m; });
for (const s of ['Left','Right']) ex[s] = smooth(dil(ex[s]));
const lift = [];
for (let f = 0; f < F; f++) { setFrame(f);
  for (const s of ['Left','Right']) { const e = ex[s][f]; if (e < 1e-3) continue;
    const shin = wp(s+'Foot').sub(wp(s+'Leg')), foot = wp(s+'ToeBase').sub(wp(s+'Foot')); const ax = foot.clone().cross(shin).normalize();
    const pq = new T.Quaternion(); O[s+'Foot'].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[s+'Foot'].getWorldQuaternion(wq); const save = O[s+'Foot'].quaternion.clone(); const a0 = ank(s);
    O[s+'Foot'].quaternion.copy(pq.clone().invert().multiply(new T.Quaternion().setFromAxisAngle(ax, e).multiply(wq.clone()))); root.updateMatrixWorld(true);
    if (ank(s) > a0) { O[s+'Foot'].quaternion.copy(pq.clone().invert().multiply(new T.Quaternion().setFromAxisAngle(ax, -e).multiply(wq.clone()))); root.updateMatrixWorld(true); }
    O[s+'Foot'].quaternion.toArray(C.tracks[s+'Foot'], f * 4); }
  lift.push(Math.max(0, ball0[f] - Math.min(wp('LeftToeBase').y, wp('RightToeBase').y))); }
const ls = smooth(dil(lift)); for (let f = 0; f < F; f++) C.hips[f*3+1] += ls[f];
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5)); C.hips = C.hips.map(v => +(+v).toFixed(4));
let mx = 0; for (let f = 0; f < F; f++) { setFrame(f); mx = Math.max(mx, ank('Left'), ank('Right')); }
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'max ankle after', (mx*180/Math.PI).toFixed(0), 'max body lift', Math.max(...ls).toFixed(3));
