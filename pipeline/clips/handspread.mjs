// Keep the hands at least DIST apart (holding a wide object) from frame G on (ramped in over 6 frames), by abducting both arms equally.
// usage: node handspread.mjs hero.glb in.json out.json G [DIST=0.30]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, gA, dA = '0.30'] = process.argv; const G = +gA, DIST = +dA; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
// per frame: find angle a so that rotating LeftArm by +a and RightArm by -a about the trunk forward axis gives distance >= DIST
const need = []; const fwdOf = () => { const r = wp('LeftShoulder').sub(wp('RightShoulder')); const up = wp('Neck').sub(wp('Spine')); return r.cross(up).normalize(); };
const apply = a => { const fw = fwdOf(); for (const [s, sg] of [['Left', 1], ['Right', -1]]) { const q0 = wq(s+'Arm'); const x0 = wp(s+'Hand').distanceTo(wp(s === 'Left' ? 'RightHand' : 'LeftHand')); setWorldQ(s+'Arm', new T.Quaternion().setFromAxisAngle(fw, sg * a).multiply(q0)); } };
for (let f = 0; f < F; f++) { setFrame(f); const d0 = wp('LeftHand').distanceTo(wp('RightHand')); if (f < G - 6 || d0 >= DIST) { need.push(0); continue; }
  let lo = -0.6, hi = 0.6, best = 0, bd = 9; for (let a = -0.6; a <= 0.6; a += 0.01) { setFrame(f); apply(a); const d = wp('LeftHand').distanceTo(wp('RightHand')); if (d >= DIST && Math.abs(a) < Math.abs(bd)) { bd = a; } } need.push(bd === 9 ? 0 : bd); }
const ramp = need.map((a, f) => a * Math.max(0, Math.min(1, (f - (G - 6)) / 6)));
const sm = ramp.map((_, f) => { let q = 0, s = 0; for (let k = -4; k <= 4; k++) { const j = Math.max(0, Math.min(F-1, f+k)), g = Math.exp(-k*k/6); q += ramp[j]*g; s += g; } return q/s; });
let mn = 9; for (let f = 0; f < F; f++) { setFrame(f); apply(sm[f]); if (f >= G) mn = Math.min(mn, wp('LeftHand').distanceTo(wp('RightHand'))); for (const s of ['LeftArm','RightArm']) O[s].quaternion.toArray(C.tracks[s], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('min hand distance after G', mn.toFixed(2), 'max abduction deg', (Math.max(...sm.map(Math.abs))*57.3).toFixed(0));
