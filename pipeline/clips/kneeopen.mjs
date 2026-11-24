// Open over-folded knees: where the knee interior angle (thigh vs shin) < MIN deg, raise the hips just enough and re-solve
// both legs with 2-bone IK so the ankles stay where they were and the feet keep their world orientation.
// usage: node kneeopen.mjs hero.glb in.json out.json [MIN=40]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, mArg = '40'] = process.argv; const MIN = +mArg * Math.PI / 180; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const rotW = (n, axis, ang) => setWorldQ(n, new T.Quaternion().setFromAxisAngle(axis, ang).multiply(wq(n)));
const interior = s => { const a = wp(s+'UpLeg').sub(wp(s+'Leg')), b = wp(s+'Foot').sub(wp(s+'Leg')); return a.angleTo(b); };
setFrame(0); const LA = { }, LB = {}; for (const s of ['Left','Right']) { LA[s] = wp(s+'UpLeg').distanceTo(wp(s+'Leg')); LB[s] = wp(s+'Leg').distanceTo(wp(s+'Foot')); }
// pass 1: needed hip rise per frame
const need = [];
for (let f = 0; f < F; f++) { setFrame(f); let dy = 0;
  for (const s of ['Left','Right']) { if (interior(s) >= MIN) continue; const a = LA[s], b = LB[s]; const Dn = Math.sqrt(a*a + b*b - 2*a*b*Math.cos(MIN));
    const v = wp(s+'UpLeg').sub(wp(s+'Foot')); const h2 = v.x*v.x + v.z*v.z; const yN = Math.sqrt(Math.max(0, Dn*Dn - h2)); dy = Math.max(dy, yN - v.y + 0.003); }
  need.push(dy); }
const dil = need.map((_, f) => { let m = 0; for (let k = -5; k <= 5; k++) { const j = f + k; if (j >= 0 && j < F) m = Math.max(m, need[j]); } return m; });
const sm = dil.map((_, f) => { let q = 0, sw = 0; for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/32); q += dil[j]*w; sw += w; } return q / sw; });
let mx = 0, minAfter = 9;
for (let f = 0; f < F; f++) { setFrame(f); if (sm[f] < 1e-4) { for (const s of ['Left','Right']) minAfter = Math.min(minAfter, interior(s)); continue; }
  mx = Math.max(mx, sm[f]);
  const tgt = {}, footQ = {}, knee = {}; for (const s of ['Left','Right']) { tgt[s] = wp(s+'Foot'); footQ[s] = wq(s+'Foot'); knee[s] = wp(s+'Leg'); }
  C.hips[f*3+1] += sm[f]; O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true);
  for (const s of ['Left','Right']) { const a = LA[s], b = LB[s]; const H = wp(s+'UpLeg'); const T0 = tgt[s]; const d = Math.min(a + b - 1e-4, H.distanceTo(T0));
    // desired knee interior from law of cosines
    const want = Math.acos(Math.max(-1, Math.min(1, (a*a + b*b - d*d) / (2*a*b))));
    // 1) set knee interior: rotate Leg about the knee hinge axis
    const cur = interior(s); const thigh = wp(s+'UpLeg').sub(wp(s+'Leg')), shin = wp(s+'Foot').sub(wp(s+'Leg')); const hinge = shin.clone().cross(thigh).normalize();
    rotW(s+'Leg', hinge, -(want - cur)); if (Math.abs(interior(s) - want) > 0.01) rotW(s+'Leg', hinge, 2 * (want - cur));
    // 2) aim the hip->ankle line at the target, keeping the knee on the side it was
    const A = wp(s+'Foot').sub(H).normalize(), B = T0.clone().sub(H).normalize(); rotW(s+'UpLeg', A.clone().cross(B).normalize(), A.angleTo(B));
    // 3) twist about hip->ankle so the knee points where it did
    const axis = T0.clone().sub(H).normalize(); const k1 = wp(s+'Leg').sub(H), k0 = knee[s].clone().sub(H); k1.sub(axis.clone().multiplyScalar(k1.dot(axis))); k0.sub(axis.clone().multiplyScalar(k0.dot(axis)));
    if (k1.length() > 1e-4 && k0.length() > 1e-4) { let ang = k1.angleTo(k0); if (k1.clone().cross(k0).dot(axis) < 0) ang = -ang; rotW(s+'UpLeg', axis, ang); }
    setWorldQ(s+'Foot', footQ[s]); minAfter = Math.min(minAfter, interior(s));
    for (const n of [s+'UpLeg', s+'Leg', s+'Foot']) O[n].quaternion.toArray(C.tracks[n], f * 4); }
}
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5)); C.hips = C.hips.map(v => +(+v).toFixed(4));
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'max hip rise', mx.toFixed(3), 'min knee interior after', (minAfter * 180 / Math.PI).toFixed(0));
