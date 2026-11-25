// From frame G (ramped over RAMP frames) bend both elbows so the hands rise toward height Y (carrying in front of the chest),
// also swinging the upper arms forward a little (SH share). Ramp keeps it smooth.
// usage: node carryup.mjs hero.glb in.json out.json G Y [RAMP=15] [SH=0.35]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, gA, yA, rA = '15', sA = '0.35'] = process.argv; const G = +gA, Y = +yA, RAMP = +rA, SH = +sA; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const rot = (n, ax, a) => setWorldQ(n, new T.Quaternion().setFromAxisAngle(ax, a).multiply(wq(n)));
// solve per frame the elbow angle e (and shoulder SH*e) that brings the mean hand height to Y
const sol = [];
const tryA = (f, e) => { setFrame(f); const lat = wp('LeftShoulder').sub(wp('RightShoulder')).normalize();
  for (const s of ['Left','Right']) { rot(s+'Arm', lat, -e * SH); rot(s+'ForeArm', lat, -e); } return (wp('LeftHand').y + wp('RightHand').y) / 2; };
let sign = 1; { setFrame(F-1); const y0 = (wp('LeftHand').y + wp('RightHand').y) / 2; if (tryA(F-1, 0.3) < y0) sign = -1; }
for (let f = 0; f < F; f++) { if (f < G) { sol.push(0); continue; } let best = 0; for (let e = 0; e <= 2.2; e += 0.02) { best = e; if (tryA(f, sign * e) >= Y) break; } sol.push(sign * best); }
const r = sol.map((e, f) => e * Math.max(0, Math.min(1, (f - G) / RAMP)));
const sm = r.map((_, f) => { let q = 0, s = 0; for (let k = -4; k <= 4; k++) { const j = Math.max(0, Math.min(F-1, f+k)), g = Math.exp(-k*k/6); q += r[j]*g; s += g; } return q/s; });
let yEnd = 0; for (let f = 0; f < F; f++) { tryA(f, sm[f]); yEnd = (wp('LeftHand').y + wp('RightHand').y) / 2; for (const n of ['LeftArm','RightArm','LeftForeArm','RightForeArm']) O[n].quaternion.toArray(C.tracks[n], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('hands y at end', yEnd.toFixed(2), 'max elbow deg', (Math.max(...sm.map(Math.abs))*57.3).toFixed(0));
