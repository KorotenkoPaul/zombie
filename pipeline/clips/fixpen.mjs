// Resolve self-penetration in a clip: forearms vs torso/head/thighs/other forearm (rotate the upper arm away),
// feet/shins crossing (rotate the thigh away). Corrections are smoothed over time. usage: node fixpen.mjs hero.glb in.json out.json
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp] = process.argv; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}); const doc = await io.read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
function closest(p1, q1, p2, q2) { const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2); const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r), c = d1.dot(r), b = d1.dot(d2), den = a*e - b*b;
  let s = den > 1e-9 ? Math.min(1, Math.max(0, (b*f - c*e) / den)) : 0; let t = e > 1e-9 ? (b*s + f) / e : 0;
  if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
  const A = p1.clone().add(d1.multiplyScalar(s)), B = p2.clone().add(d2.multiplyScalar(t)); return { A, B, s, d: A.distanceTo(B) }; }
const caps = s => ({ torso: ['Hips','Neck',.12], head: ['Neck','HeadTop_End',.09], [s+'Fore']: [s+'ForeArm',s+'Hand',.035] });
const MARGIN = 0.01; let fixed = 0;
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
// rotate bone `bn` (world pivot) so that point P moves by vector D (approx)
function nudge(bn, P, D) { const piv = wp(bn); const r = P.clone().sub(piv); const ax = r.clone().cross(D); const L = ax.length(); if (L < 1e-6) return; ax.normalize(); const ang = D.length() / Math.max(.05, r.length());
  const qW = new T.Quaternion().setFromAxisAngle(ax, ang); const par = O[bn].parent; const pq = new T.Quaternion(); par.getWorldQuaternion(pq);
  const wq = new T.Quaternion(); O[bn].getWorldQuaternion(wq); const nw = qW.multiply(wq); O[bn].quaternion.copy(pq.invert().multiply(nw)); root.updateMatrixWorld(true); }
const touched = new Set();
for (let f = 0; f < F; f++) { setFrame(f);
  for (let it = 0; it < 6; it++) { let any = false;
    for (const s of ['Left','Right']) { const o = s === 'Left' ? 'Right' : 'Left';
      const fa = [wp(s+'ForeArm'), wp(s+'Hand')];
      const others = [[wp('Hips'), wp('Neck'), .12], [wp('Neck'), wp('HeadTop_End'), .09], [wp(s+'UpLeg'), wp(s+'Leg'), .065], [wp(o+'ForeArm'), wp(o+'Hand'), .035]];
      for (const [p, q, r] of others) { const c = closest(fa[0], fa[1], p, q); const pen = .035 + r - 0.025 - c.d; if (pen > 0) { const n = c.A.clone().sub(c.B); if (n.length() < 1e-6) n.set(s === 'Left' ? 1 : -1, 0, 0); n.normalize();
          nudge(s+'Arm', c.A, n.multiplyScalar(pen)); touched.add(s+'Arm'); any = true; fixed++; } }
      // foot vs other shin / other foot
      const ft = [wp(s+'Foot'), wp(s+'Toe_End')]; const ot = [[wp(o+'Leg'), wp(o+'Foot'), .045], [wp(o+'Foot'), wp(o+'Toe_End'), .04]];
      for (const [p, q, r] of ot) { const c = closest(ft[0], ft[1], p, q); const pen = .04 + r - 0.02 - c.d; if (pen > 0) { const n = c.A.clone().sub(c.B); if (n.length() < 1e-6) n.set(s === 'Left' ? 1 : -1, 0, 0); n.normalize();
          nudge(s+'UpLeg', c.A, n.multiplyScalar(pen * .6)); touched.add(s+'UpLeg'); any = true; fixed++; } }
    }
    if (!any) break; }
  for (const b of touched) O[b].quaternion.toArray(C.tracks[b], f * 4); }
// smooth only the corrected bones (sigma 2 frames) so corrections ease in/out
for (const b of touched) { const a = C.tracks[b]; for (let f = 1; f < F; f++) { const d = a[f*4]*a[f*4-4]+a[f*4+1]*a[f*4-3]+a[f*4+2]*a[f*4-2]+a[f*4+3]*a[f*4-1]; if (d < 0) for (let k = 0; k < 4; k++) a[f*4+k] = -a[f*4+k]; }
  const src = Float64Array.from(a), sig = 2, R = 6; for (let f = 0; f < F; f++) { const q = [0,0,0,0]; let sw = 0; for (let k = -R; k <= R; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/(2*sig*sig)); for (let c = 0; c < 4; c++) q[c] += src[j*4+c]*w; sw += w; }
    const l = Math.hypot(...q); for (let c = 0; c < 4; c++) a[f*4+c] = +(q[c]/l).toFixed(5); } }
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'fix steps', fixed, 'bones', [...touched].join(','));
