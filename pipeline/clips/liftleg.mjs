// Separate crossed feet (e.g. in bed rolls) by lifting the TOP leg along the hip line, as a smooth time bump.
// usage: node liftleg.mjs hero.glb in.json out.json [Left|Right|auto]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, sideArg = 'auto'] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
function closest(p1, q1, p2, q2) { const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2); const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a*e - b*b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b*f - c*e) / den)) : 0; let t = e > 1e-9 ? (b*s + f) / e : 0;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  return p1.clone().add(d1.multiplyScalar(s)).distanceTo(p2.clone().add(d2.multiplyScalar(t))); }
const segs = s => [[s+'Leg', s+'Foot', .045], [s+'Foot', s+'Toe_End', .04]];
const NEED = 0.085; // centre distance wanted between foot capsules (radii .08 + 0.5 cm)
function penAt(f) { setFrame(f); let worst = 0;
  for (const [a, b, ra] of segs('Left')) for (const [c, d, rb] of segs('Right')) { if (a.endsWith('Leg') && c.endsWith('Leg')) continue; const dd = closest(wp(a), wp(b), wp(c), wp(d)); worst = Math.max(worst, ra + rb + .005 - dd); }
  return worst; }
let top = sideArg; let total = 0;
for (let it = 0; it < 8; it++) {
  const pen = []; for (let f = 0; f < F; f++) pen.push(penAt(f)); const mx = Math.max(...pen); if (it === 0) console.log('max pen before', mx.toFixed(3));
  if (mx <= 0.002) break;
  // need[f]: extra lift in metres; dilate 6 frames then gaussian sigma 4
  const dil = pen.map((_, f) => { let m = 0; for (let k = -6; k <= 6; k++) { const j = f + k; if (j >= 0 && j < F) m = Math.max(m, pen[j]); } return Math.max(0, m); });
  const need = dil.map((_, f) => { let q = 0, sw = 0; for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/32); q += dil[j]*w; sw += w; } return q / sw * 1.15 + (dil[f] > 0 ? .004 : 0); });
  for (let f = 0; f < F; f++) { if (need[f] < 1e-4) continue; setFrame(f);
    const hipLine = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize();
    let s = top; if (s === 'auto') { const up = new T.Vector3(0, 1, 0); s = hipLine.dot(up) >= 0 ? 'Left' : 'Right'; }
    const dir = s === 'Left' ? hipLine : hipLine.clone().negate();
    const piv = wp(s+'UpLeg'), foot = wp(s+'Foot'); const r = foot.clone().sub(piv); const ax = r.clone().cross(dir).normalize(); const ang = need[f] / r.length();
    const qW = new T.Quaternion().setFromAxisAngle(ax, ang); const pq = new T.Quaternion(); O[s+'UpLeg'].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[s+'UpLeg'].getWorldQuaternion(wq);
    O[s+'UpLeg'].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); O[s+'UpLeg'].quaternion.toArray(C.tracks[s+'UpLeg'], f * 4); total = Math.max(total, ang); }
}
{ const pen = []; for (let f = 0; f < F; f++) pen.push(penAt(f)); console.log('max pen after', Math.max(...pen).toFixed(3), 'max lift deg', (total * 57.3).toFixed(1)); }
for (const b of ['LeftUpLeg','RightUpLeg']) { const a = C.tracks[b]; for (let i = 0; i < a.length; i++) a[i] = +a[i].toFixed(5); }
fs.writeFileSync(outp, JSON.stringify(C));
