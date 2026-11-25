// Low reach for squat pickups: in the deep part of the clip (weight from hip depth), bend the trunk forward up to LEAN deg
// (hips->neck from vertical) and swing both arms down/forward by up to ARM deg. Smooth, depth-weighted.
// usage: node reachdown.mjs hero.glb in.json out.json [LEAN=38] [ARM=25] [HIPTOP=0.80]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, lA = '38', aA = '25', htA = '0.80'] = process.argv; const LEAN = +lA * Math.PI / 180, ARM = +aA * Math.PI / 180, HT = +htA; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const lean = () => { const t = wp('Neck').sub(wp('Hips')); return Math.acos(t.y / t.length()); };
let hmin = 9; for (let f = 0; f < F; f++) hmin = Math.min(hmin, C.hips[f*3+1]);
const w0 = []; for (let f = 0; f < F; f++) w0.push(Math.max(0, Math.min(1, (HT - C.hips[f*3+1]) / (HT - hmin))));
const w = w0.map((_, f) => { let q = 0, s = 0; for (let k = -5; k <= 5; k++) { const j = Math.max(0, Math.min(F-1, f+k)), g = Math.exp(-k*k/8); q += w0[j]*g; s += g; } return q/s; }).map(x => x*x*(3-2*x));
let mxL = 0, hand = 9;
for (let f = 0; f < F; f++) { setFrame(f); const ax = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize();
  const tgtL = lean() + Math.max(0, LEAN - lean()) * w[f];
  for (let it = 0; it < 6; it++) { const e = tgtL - lean(); if (Math.abs(e) < 0.005) break;
    for (const n of ['Spine','Spine1','Spine2']) { const q0 = wq(n); const l0 = lean(); setWorldQ(n, new T.Quaternion().setFromAxisAngle(ax, e/3).multiply(q0)); if ((lean() - l0) * e < 0) setWorldQ(n, new T.Quaternion().setFromAxisAngle(ax, -e/3).multiply(q0)); } }
  if (lean() > LEAN + 0.02 || wp('Neck').y > wp('Hips').y + 9) {}
  // check direction: forward bend lowers the neck; if it rose, flip
  for (const s of ['Left','Right']) { const q0 = wq(s+'Arm'); setWorldQ(s+'Arm', new T.Quaternion().setFromAxisAngle(ax, +(process.env.ARMSIGN || 1) * ARM * w[f]).multiply(q0)); }
  mxL = Math.max(mxL, lean()); hand = Math.min(hand, wp('LeftHand').y, wp('RightHand').y);
  for (const n of ['Spine','Spine1','Spine2','LeftArm','RightArm']) O[n].quaternion.toArray(C.tracks[n], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('max lean', (mxL*57.3).toFixed(0), 'min hand y', hand.toFixed(2));
