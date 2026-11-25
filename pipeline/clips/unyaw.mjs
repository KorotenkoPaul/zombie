// Remove pelvis yaw drift: rotate the Hips about world Y so the pelvis faces its frame-0 heading in every frame.
// usage: node unyaw.mjs hero.glb in.json out.json
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const yaw = () => { const r = wp('LeftUpLeg').sub(wp('RightUpLeg')); return Math.atan2(-r.z, r.x); };
setFrame(0); const y0 = yaw(); let mx = 0;
for (let f = 0; f < F; f++) { setFrame(f); let d = yaw() - y0; d = Math.atan2(Math.sin(d), Math.cos(d)); mx = Math.max(mx, Math.abs(d));
  const pq = new T.Quaternion(); O.Hips.parent.getWorldQuaternion(pq); const wq = pq.clone().multiply(O.Hips.quaternion);
  O.Hips.quaternion.copy(pq.invert().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0), -d).multiply(wq))); O.Hips.quaternion.toArray(C.tracks.Hips, f * 4); }
fs.writeFileSync(outp, JSON.stringify(C)); console.log('max yaw removed deg', (mx*57.3).toFixed(0));
