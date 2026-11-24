// Bend the toes at the ball so they stay flat on the floor when the heel is raised (toe tip not below the ball).
// Only bends up (dorsiflex at ToeBase), capped at MAX deg vs the bind pose. Circular smoothing for loops.
// usage: node toeflat.mjs hero.glb in.json out.json [MAX=55]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, mArg = '55'] = process.argv; const MAX = +mArg * Math.PI / 180; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const want = { Left: [], Right: [] };
for (let f = 0; f < F; f++) { setFrame(f);
  for (const s of ['Left','Right']) { const b = wp(s+'ToeBase'), e = wp(s+'Toe_End'), d = e.clone().sub(b);
    // angle of the toe below horizontal; only when the ball is near the floor (planted)
    const below = Math.asin(Math.max(-1, Math.min(1, -d.y / d.length())));
    want[s].push(b.y < 0.06 && below > 0 ? Math.min(MAX, below) : 0); } }
const sm = c => c.map((_, f) => { let q = 0, sw = 0; for (let k = -6; k <= 6; k++) { const j = ((f + k) % F + F) % F, w = Math.exp(-k*k/12); q += c[j]*w; sw += w; } return q/sw; });
for (let f = 0; f < F; f++) { setFrame(f);
  for (const s of ['Left','Right']) { const a = sm(want[s])[f]; if (a < 1e-3) continue;
    const b = wp(s+'ToeBase'), d = wp(s+'Toe_End').sub(b); const ax = new T.Vector3(0,1,0).cross(d).normalize(); // rotating about this lifts the tip
    const pq = new T.Quaternion(); O[s+'ToeBase'].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[s+'ToeBase'].getWorldQuaternion(wq);
    O[s+'ToeBase'].quaternion.copy(pq.invert().multiply(new T.Quaternion().setFromAxisAngle(ax, -a).multiply(wq))); root.updateMatrixWorld(true);
    const d2 = wp(s+'Toe_End').sub(wp(s+'ToeBase')); if (d2.y < d.y) { O[s+'ToeBase'].quaternion.copy(new T.Quaternion()); /*wrong sign*/ const pq2 = new T.Quaternion(); O[s+'ToeBase'].parent.getWorldQuaternion(pq2); O[s+'ToeBase'].quaternion.copy(pq2.invert().multiply(new T.Quaternion().setFromAxisAngle(ax, a).multiply(wq))); }
    O[s+'ToeBase'].quaternion.toArray(C.tracks[s+'ToeBase'], f * 4); } }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
let mx = 0; for (let f = 0; f < F; f++) { setFrame(f); for (const s of ['Left','Right']) { const d = wp(s+'Toe_End').sub(wp(s+'ToeBase')); mx = Math.max(mx, -d.y / d.length()); } }
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'max toe below horizontal after', (Math.asin(mx)*180/Math.PI).toFixed(0));
