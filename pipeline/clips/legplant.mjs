// Re-plant one foot flat at a fixed floor point so the shin stays near vertical (flat sole without ankle dorsiflexion past CAP).
// Per frame: target ankle A (constant over the clip), 2-bone IK with the knee kept in its original bend plane, foot pitched level (heel over ball as in idle).
// usage: node legplant.mjs hero.glb in.json out.json Side [CAP=25] [HEELBALL=0.06]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, S = 'Left', capA = '25', hbA = '0.06'] = process.argv; const CAP = +capA * Math.PI / 180, HB = +hbA; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const aim = (bone, child, target) => { const p = wp(bone), c = wp(child); const q = new T.Quaternion().setFromUnitVectors(c.sub(p).normalize(), target.clone().sub(p).normalize()); setWorldQ(bone, q.multiply(wq(bone))); };
const U = S+'UpLeg', K = S+'Leg', A = S+'Foot', B = S+'ToeBase';
setFrame(0); const a = wp(U).distanceTo(wp(K)), b = wp(K).distanceTo(wp(A));
// floor height of the ankle for a level foot = ball height + HB ; per-frame tilt-cap ankle positions
let ballY = 9; const cand = [];
for (let f = 0; f < F; f++) { setFrame(f); ballY = Math.min(ballY, wp(B).y); }
const ay = ballY + HB;
for (let f = 0; f < F; f++) { setFrame(f); const H = wp(U), A0 = wp(A); const dir = new T.Vector3(A0.x - H.x, 0, A0.z - H.z); const d0 = dir.length(); dir.normalize();
  // search horizontal distance d along dir (from hip) so that the IK knee gives shin tilt == CAP; knee forward of the shin
  let best = null; for (let d = -0.3; d <= d0 + 0.05; d += 0.002) { const At = new T.Vector3(H.x + dir.x*d, ay, H.z + dir.z*d); const D = At.distanceTo(H); if (D > a + b - 0.005 || D < Math.abs(a-b)+0.01) continue;
    // knee: in the vertical plane through H and At, forward side
    const ca = (a*a + D*D - b*b) / (2*a*D), ang = Math.acos(Math.max(-1, Math.min(1, ca))); const u = At.clone().sub(H).normalize(); const side = dir.clone().cross(new T.Vector3(0,1,0)).normalize(); const perp = side.clone().cross(u).normalize(); if (perp.dot(dir) < 0) perp.negate();
    const Kp = H.clone().add(u.clone().multiplyScalar(a*Math.cos(ang))).add(perp.multiplyScalar(a*Math.sin(ang))); const sh = Kp.clone().sub(At); const tilt = Math.acos(sh.y / sh.length());
    if (best === null || Math.abs(tilt - CAP) < Math.abs(best.t - CAP)) best = { d, t: tilt, At }; }
  cand.push(best ? best.At : A0); }
const Afix = cand.reduce((s, v) => s.add(v), new T.Vector3()).multiplyScalar(1 / F); Afix.y = ay;
let tmin = 9, tmax = 0, ext = 0; const ballPos = [];
for (let f = 0; f < F; f++) { setFrame(f); const footW = wq(A); const H = wp(U); const Kold = wp(K);
  const D = Math.min(H.distanceTo(Afix), a + b - 0.002); const u = Afix.clone().sub(H).normalize(); const At = H.clone().add(u.clone().multiplyScalar(D)); if (D < H.distanceTo(Afix)) ext = Math.max(ext, H.distanceTo(Afix) - D);
  const ca = (a*a + D*D - b*b) / (2*a*D), ang = Math.acos(Math.max(-1, Math.min(1, ca)));
  let pole = Kold.clone().sub(H); pole.sub(u.clone().multiplyScalar(pole.dot(u))).normalize();
  const Kp = H.clone().add(u.clone().multiplyScalar(a*Math.cos(ang))).add(pole.multiplyScalar(a*Math.sin(ang)));
  aim(U, K, Kp); aim(K, A, At);
  // foot: original world orientation, pitched so heel-ball height == HB (level like idle), yaw kept
  setWorldQ(A, footW); for (let it = 0; it < 3; it++) { const h = wp(A), bl = wp(B); const fd = bl.clone().sub(h); const L = fd.length(); const want = Math.asin(Math.max(-1, Math.min(1, -HB / L))), now = Math.asin(fd.y / L);
    const ax = new T.Vector3(0,1,0).cross(fd).normalize(); setWorldQ(A, new T.Quaternion().setFromAxisAngle(ax, -(want - now)).multiply(wq(A))); const fd2 = wp(B).sub(wp(A)); if (Math.abs(Math.asin(fd2.y/fd2.length()) - want) > Math.abs(now - want)) setWorldQ(A, new T.Quaternion().setFromAxisAngle(ax, 2*(want - now)).multiply(wq(A))); }
  const sh = wp(K).sub(wp(A)); const t = Math.acos(sh.y / sh.length()); tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); ballPos.push(wp(B));
  for (const n of [U, K, A]) O[n].quaternion.toArray(C.tracks[n], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
let slide = 0; for (const p of ballPos) slide = Math.max(slide, p.distanceTo(ballPos[0]));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(S, 'shin tilt', (tmin*57.3).toFixed(0), '..', (tmax*57.3).toFixed(0), 'ball drift cm', (slide*100).toFixed(1), 'IK overreach cm', (ext*100).toFixed(1));
