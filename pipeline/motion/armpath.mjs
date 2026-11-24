// needs three, @gltf-transform/core+extensions, meshoptimizer installed alongside. ZERO=1 zeroes hips x/z (the root), VOX = voxel size in cm.
// arm path of a clip on the hero: node armpath.mjs hero.glb clip.json -> JSON [x,y,z,...] cm (side,up,forward), deduped, outermost first
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, clipPath, sx='1', sz='1'] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(clipPath, 'utf8')); const F = C.frames;
const set = new Map(); const w = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const add = (a, b, t0, t1) => { const L = a.distanceTo(b) * Math.abs(t1 - t0); const k = Math.max(1, Math.ceil(L / .02));
  for (let i = 0; i <= k; i++) { const p = a.clone().lerp(b, t0 + (t1 - t0) * i / k); const key = [Math.round(p.x*100*sx), Math.round(p.y*100), Math.round(p.z*100*sz)]; set.set(key.join(','), key); } };
for (let f = 0; f < F; f++) { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4);
  O.Hips.position.fromArray(C.hips, f * 3); if(process.env.ZERO){O.Hips.position.x = 0; O.Hips.position.z = 0;} root.updateMatrixWorld(true);
  for (const S of ['Left','Right']) { const A = w(S+'Arm'), E = w(S+'ForeArm'), W = w(S+'Hand'), M = w(S+'HandMiddle4');
    add(A, E, .5, 1); add(E, W, 0, 1); add(W, M, 0, 1.15); } }
let pts = [...set.values()];
// thin to 2 cm voxels
const vox = new Map(); for (const p of pts) { const k = p.map(v => Math.round(v / (+process.env.VOX||2))).join(','); if (!vox.has(k)) vox.set(k, p); }
pts = [...vox.values()].sort((a, b) => Math.hypot(b[0], b[2]) - Math.hypot(a[0], a[2]));
console.log(JSON.stringify(pts.flat()));
