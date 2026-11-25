// Plant both feet: each ball (ToeBase) is pinned to one floor point for the whole clip; the foot keeps its world orientation
// from the data (heel lift stays), legs re-solved with 2-bone IK (knee pole from the data).
// usage: node plantfeet.mjs hero.glb in.json out.json [f0 f1 = frames whose mean ball position is used] [BALLY=0.075]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, f0A, f1A, byA = '0.075'] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames; const f0 = f0A != null ? +f0A : 0, f1 = f1A != null ? +f1A : F - 1, BY = +byA;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const aim = (bone, child, target) => { const p = wp(bone), c = wp(child); const q = new T.Quaternion().setFromUnitVectors(c.sub(p).normalize(), target.clone().sub(p).normalize()); setWorldQ(bone, q.multiply(wq(bone))); };
const B = {}; for (const s of ['Left','Right']) { B[s] = new T.Vector3(); for (let f = f0; f <= f1; f++) { setFrame(f); B[s].add(wp(s+'ToeBase')); } B[s].multiplyScalar(1 / (f1 - f0 + 1)); B[s].y = BY; }
if (process.env.PL) { const [l, r] = process.env.PL.split(';').map(t => t.split(',').map(Number)); B.Left.set(l[0], BY, l[1]); B.Right.set(r[0], BY, r[1]); }
let miss = 0, minY = 9;
for (let f = 0; f < F; f++) { setFrame(f);
  for (const s of ['Left','Right']) { const fq = wq(s+'Foot'); const off = wp(s+'ToeBase').sub(wp(s+'Foot'));
    // ball never below the floor: if the data ball is higher than BY (heel/toe lift), keep its height
    const by = Math.max(BY, wp(s+'ToeBase').y); const tb = B[s].clone(); tb.y = by; const A = tb.sub(off);
    const U = wp(s+'UpLeg'), Kd = wp(s+'Leg'); const a = U.distanceTo(Kd), b = Kd.distanceTo(wp(s+'Foot'));
    const D = Math.min(U.distanceTo(A), a + b - 0.001); const u = A.clone().sub(U).normalize(); const At = U.clone().add(u.clone().multiplyScalar(D));
    const ang = Math.acos(Math.max(-1, Math.min(1, (a*a + D*D - b*b) / (2*a*D)))); const fw = wp('LeftUpLeg').sub(wp('RightUpLeg')).cross(new T.Vector3(0,1,0)).normalize(); const p = Kd.clone().sub(U); p.sub(u.clone().multiplyScalar(p.dot(u))); if (p.dot(fw) < 0.02) p.add(fw.clone().multiplyScalar(0.02 - p.dot(fw))); { const lat = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize().multiplyScalar((s === 'Left' ? 1 : -1) * +(process.env.KOUT || 0)); p.normalize().add(lat); } p.sub(u.clone().multiplyScalar(p.dot(u))).normalize();
    aim(s+'UpLeg', s+'Leg', U.clone().add(u.clone().multiplyScalar(a*Math.cos(ang))).add(p.multiplyScalar(a*Math.sin(ang)))); aim(s+'Leg', s+'Foot', At); setWorldQ(s+'Foot', fq);
    miss = Math.max(miss, wp(s+'Foot').distanceTo(A)); minY = Math.min(minY, wp(s+'ToeBase').y);
    for (const n of ['UpLeg','Leg','Foot']) O[s+n].quaternion.toArray(C.tracks[s+n], f * 4); } }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('planted at', B.Left.toArray().map(v => v.toFixed(2)), B.Right.toArray().map(v => v.toFixed(2)), 'max miss cm', (miss*100).toFixed(1));
