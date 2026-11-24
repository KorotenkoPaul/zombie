// Procedural 'listen at the window' built on a calm standing idle: lean in, tilt head toward the glass, hold (breathing from the base clip), ease out.
// usage: node listen.mjs hero.glb base.json out.json [dur=8]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, durArg = '8'] = process.argv; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const B = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = Math.min(B.frames, Math.round(+durArg * 30));
const C = { fps: 30, frames: F, tracks: {}, hips: B.hips.slice(0, F * 3) }; for (const k of Object.keys(B.tracks)) C.tracks[k] = B.tracks[k].slice(0, F * 4);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const ss = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
const env = t => ss(t / 1.3) * (1 - ss((t - (F / 30 - 1.4)) / 1.3)); // in 1.3 s, out 1.3 s
function rot(b, ax, ang) { const qW = new T.Quaternion().setFromAxisAngle(ax, ang); const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq);
  O[b].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); O[b].quaternion.toArray(C.tracks[b], 0); }
for (let f = 0; f < F; f++) { setFrame(f); const t = f / 30, e = env(t);
  const left = wp('LeftUpLeg').sub(wp('RightUpLeg')); left.y = 0; left.normalize(); const fwd = new T.Vector3(0, 1, 0).cross(left).normalize(); // forward = up x left? check sign below
  const fw = fwd.clone(); if (fw.dot(new T.Vector3(0, 0, 1)) < 0 && f === 0) fw.negate();
  const side = fw.clone(); // lean axis = left (rotating about left tips the chest forward)
  const tilt = 0.10 * Math.sin(t * 0.7); // slow small head drift while listening
  const parts = [['Spine', left, 0.06], ['Spine1', left, 0.07], ['Spine2', left, 0.06]];
  for (const [b, ax, a] of parts) { const tmp = C.tracks[b].slice(f * 4, f * 4 + 4); O[b].quaternion.fromArray(tmp); root.updateMatrixWorld(true); const qW = new T.Quaternion().setFromAxisAngle(ax, a * e);
    const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq); O[b].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); O[b].quaternion.toArray(C.tracks[b], f * 4); }
  // head: turn the right ear toward the glass (roll about forward) + slight yaw, with a slow drift
  for (const [ax, a] of [[left, -0.24 * e], [fw, -(0.28 + tilt) * e], [new T.Vector3(0, 1, 0), 0.22 * e]]) { const b = 'Head'; O[b].quaternion.fromArray(C.tracks[b], f * 4); root.updateMatrixWorld(true);
    const qW = new T.Quaternion().setFromAxisAngle(ax, a); const pq = new T.Quaternion(); O[b].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[b].getWorldQuaternion(wq); O[b].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); O[b].quaternion.toArray(C.tracks[b], f * 4); }
}
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
C.name = 'listen_window'; fs.writeFileSync(outp, JSON.stringify(C)); console.log('ok', F, 'frames');
