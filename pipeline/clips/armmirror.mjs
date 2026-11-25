// Make the SIDE hand mirror the other hand (across the pelvis sagittal plane) in the deep part (weight from hip depth), by 2-bone arm IK.
// usage: node armmirror.mjs hero.glb in.json out.json [SIDE=Left] [HIPTOP=0.75]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, S = 'Left', htA = '0.75'] = process.argv; const OT = S === 'Left' ? 'Right' : 'Left', HT = +htA; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const aim = (bone, child, target) => { const p = wp(bone), c = wp(child); const q = new T.Quaternion().setFromUnitVectors(c.sub(p).normalize(), target.clone().sub(p).normalize()); setWorldQ(bone, q.multiply(wq(bone))); };
let hmin = 9; for (let f = 0; f < F; f++) hmin = Math.min(hmin, C.hips[f*3+1]);
const w0 = []; for (let f = 0; f < F; f++) w0.push(Math.max(0, Math.min(1, (HT - C.hips[f*3+1]) / (HT - hmin))));
const w = w0.map((_, f) => { let q = 0, s = 0; for (let k = -5; k <= 5; k++) { const j = Math.max(0, Math.min(F-1, f+k)), g = Math.exp(-k*k/8); q += w0[j]*g; s += g; } return q/s; }).map(x => x*x*(3-2*x));
let mn = 9;
for (let f = 0; f < F; f++) { setFrame(f); if (w[f] > 1e-3) {
  const hq = wq(S+'Hand'); const lat = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize(); const mid = wp('Hips');
  const o = wp(OT+'Hand'); const d = o.clone().sub(mid).dot(lat); const m = o.clone().sub(lat.clone().multiplyScalar(2 * d));
  const cur = wp(S+'Hand'); const tgt = cur.clone().lerp(m, w[f]);
  const Sh = wp(S+'Arm'), El = wp(S+'ForeArm'); const a = Sh.distanceTo(El), b = El.distanceTo(cur); const D = Math.min(Sh.distanceTo(tgt), a + b - 0.002);
  const u = tgt.clone().sub(Sh).normalize(); const ang = Math.acos(Math.max(-1, Math.min(1, (a*a + D*D - b*b) / (2*a*D))));
  const p = El.clone().sub(Sh); p.sub(u.clone().multiplyScalar(p.dot(u))); if (p.length() < 1e-4) p.copy(lat.clone().multiplyScalar(S === 'Left' ? 1 : -1)); p.normalize();
  aim(S+'Arm', S+'ForeArm', Sh.clone().add(u.clone().multiplyScalar(a*Math.cos(ang))).add(p.multiplyScalar(a*Math.sin(ang)))); aim(S+'ForeArm', S+'Hand', Sh.clone().add(u.multiplyScalar(D)));
  setWorldQ(S+'Hand', hq); }
  mn = Math.min(mn, wp(S+'Hand').y); for (const n of ['Arm','ForeArm','Hand']) O[S+n].quaternion.toArray(C.tracks[S+n], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(S, 'hand min y', mn.toFixed(3));
