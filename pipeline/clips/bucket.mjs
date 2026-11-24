// carry_bucket: from a one-hand carry walk, hold the carrying hand out so a bucket (r 0.14 m, ~0.25 m below the hand) clears the leg,
// and lean the torso slightly to the other side (counterweight). usage: node bucket.mjs hero.glb in.json out.json Right
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, side = 'Right'] = process.argv; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}); const doc = await io.read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames; const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const sg = side === 'Right' ? -1 : 1; const NEED = 0.30; // hand at least 0.30 m out from the pelvis centre, sideways
const rotW = (bn, axis, ang) => { const qW = new T.Quaternion().setFromAxisAngle(axis, ang); const pq = new T.Quaternion(); O[bn].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[bn].getWorldQuaternion(wq); O[bn].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); };
for (let f = 0; f < F; f++) { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true);
  const left = wp('LeftUpLeg').sub(wp('RightUpLeg')); left.y = 0; left.normalize(); const fwd = left.clone().cross(new T.Vector3(0, 1, 0)).normalize();
  // counter-lean: roll the spine 7 deg away from the load
  rotW('Spine', fwd, sg * -0.06); rotW('Spine1', fwd, sg * -0.06);
  for (let it = 0; it < 4; it++) { const lat = wp(side + 'Hand').sub(wp('Hips')).dot(left) * sg; if (lat >= NEED) break;
    const sh = wp(side + 'Arm'), h = wp(side + 'Hand'); const r = h.clone().sub(sh); const out = left.clone().multiplyScalar(sg); const ax = r.clone().cross(out).normalize();
    rotW(side + 'Arm', ax, Math.atan((NEED - lat) / r.length())); }
  // straighten the elbow a bit (a heavy bucket pulls the arm straight)
  for (const b of ['Spine', 'Spine1', side + 'Arm']) O[b].quaternion.toArray(C.tracks[b], f * 4); }
for (const b of ['Spine','Spine1',side+'Arm']) { const a = C.tracks[b]; for (let f = 1; f < F; f++) { const d = a[f*4]*a[f*4-4]+a[f*4+1]*a[f*4-3]+a[f*4+2]*a[f*4-2]+a[f*4+3]*a[f*4-1]; if (d < 0) for (let k = 0; k < 4; k++) a[f*4+k] = -a[f*4+k]; }
  const src = Float64Array.from(a), sig = 2, R = 6; for (let f = 0; f < F; f++) { const q = [0,0,0,0]; for (let k = -R; k <= R; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/(2*sig*sig)); for (let c = 0; c < 4; c++) q[c] += src[j*4+c]*w; } const l = Math.hypot(...q); for (let c = 0; c < 4; c++) a[f*4+c] = +(q[c]/l).toFixed(5); } }
C.name = 'carry_bucket_' + side[0]; C.note = 'Walking with a heavy bucket in the ' + side.toLowerCase() + ' hand: hand held 0.30 m out from the pelvis so a 0.28 m bucket clears the leg, torso leans ~7 deg away from the load.';
fs.writeFileSync(outp, JSON.stringify(C)); console.log('ok', outp);
