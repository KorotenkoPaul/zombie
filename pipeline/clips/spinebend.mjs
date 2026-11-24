// Extra forward bend spread over Spine/Spine1/Spine2 (about the pelvis left-right axis) by DEG degrees total.
// usage: node spinebend.mjs hero.glb in.json out.json DEG
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, dA = '15'] = process.argv; const DEG = +dA * Math.PI / 180; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
for (let f = 0; f < F; f++) { setFrame(f);
  for (const n of ['Spine','Spine1','Spine2']) { const ax = wp('LeftUpLeg').sub(wp('RightUpLeg')).normalize(); const h0 = wp('Head');
    setWorldQ(n, new T.Quaternion().setFromAxisAngle(ax, DEG/3).multiply(wq(n)));
    const fwd = wp('Head').sub(h0); const fz = wp('Hips').clone(); // check it bent forward (head went down)
    if (wp('Head').y > h0.y) setWorldQ(n, new T.Quaternion().setFromAxisAngle(ax, -2*DEG/3).multiply(wq(n)));
    O[n].quaternion.toArray(C.tracks[n], f * 4); } }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('spine bend', dA);
