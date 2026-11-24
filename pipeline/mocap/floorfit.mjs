// Shift hips height so the lowest foot point over the clip (toe end, toe base, ankle-5cm) touches y=0. usage: node floorfit.mjs hero.glb in.json out.json
import fs from 'fs'; import * as T from 'three'; import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, out] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); let lo = 1e9; const v = new T.Vector3();
for (let f = 0; f < C.frames; f++) { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true);
  for (const s of ['Left','Right']) { lo = Math.min(lo, v.setFromMatrixPosition(O[s+'Toe_End'].matrixWorld).y, v.setFromMatrixPosition(O[s+'ToeBase'].matrixWorld).y, v.setFromMatrixPosition(O[s+'Foot'].matrixWorld).y - 0.05); } }
for (let f = 0; f < C.frames; f++) C.hips[f * 3 + 1] = +(C.hips[f * 3 + 1] - lo).toFixed(4);
fs.writeFileSync(out, JSON.stringify(C)); console.log(inp.split('/').pop(), 'lift', (-lo).toFixed(3));
