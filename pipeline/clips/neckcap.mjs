// Cap neck/head flexion (Neck->Head <= NMAX, Head->HeadTop <= HMAX from vertical); give part of the removed bend back to the trunk
// (Spine1/Spine2) while Hips->Head lean stays <= TMAX. Smoothed. usage: node neckcap.mjs hero.glb in out [NMAX=30 HMAX=45 TMAX=35]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, a1 = '30', a2 = '45', a3 = '35'] = process.argv; const NMAX = +a1, HMAX = +a2, TMAX = +a3; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames; const D = Math.PI / 180;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld); const up = new T.Vector3(0, 1, 0);
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const tilt = (a, b) => wp(b).sub(wp(a)).angleTo(up) / D;
function rotToward(bone, a, b, ang) { // rotate bone so segment a->b tilts by -ang deg toward vertical (ang>0 = straighten)
  const v = wp(b).sub(wp(a)); const ax = v.clone().cross(up).normalize(); if (ax.length() < 1e-6) return; const qW = new T.Quaternion().setFromAxisAngle(ax, ang * D);
  const pq = new T.Quaternion(); O[bone].parent.getWorldQuaternion(pq); const wq = new T.Quaternion(); O[bone].getWorldQuaternion(wq); O[bone].quaternion.copy(pq.invert().multiply(qW.multiply(wq))); root.updateMatrixWorld(true); }
const need = { n: [], h: [], t: [] };
for (let f = 0; f < F; f++) { setFrame(f); need.n.push(Math.max(0, tilt('Neck','Head') - NMAX)); }
const sm = c => { const dl = c.map((_, f) => { let m = 0; for (let k = -4; k <= 4; k++) { const j = f + k; if (j >= 0 && j < F) m = Math.max(m, c[j]); } return m; }); return dl.map((_, f) => { let q = 0, sw = 0; for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/32); q += dl[j]*w; sw += w; } return q/sw; }); };
const N = sm(need.n);
for (let f = 0; f < F; f++) { setFrame(f); if (N[f] > .1) { rotToward('Neck', 'Neck', 'Head', N[f]); } for (const b of ['Neck']) O[b].quaternion.toArray(C.tracks[b], f*4); }
for (let f = 0; f < F; f++) { setFrame(f); need.h.push(Math.max(0, tilt('Head','HeadTop_End') - HMAX)); }
const H = sm(need.h);
for (let f = 0; f < F; f++) { setFrame(f); if (H[f] > .1) rotToward('Head', 'Head', 'HeadTop_End', H[f]); O.Head.quaternion.toArray(C.tracks.Head, f*4); }
// trunk: give back up to (N+H)/2 while Hips->Head lean <= TMAX
for (let f = 0; f < F; f++) { setFrame(f); const room = Math.max(0, TMAX - tilt('Hips','Head')); need.t.push(Math.min(room, (N[f] + H[f]) * .5)); }
const Tt = need.t.map((_, f) => { let q = 0, sw = 0; for (let k = -12; k <= 12; k++) { const j = Math.max(0, Math.min(F-1, f+k)), w = Math.exp(-k*k/32); q += need.t[j]*w; sw += w; } return q/sw; });
for (let f = 0; f < F; f++) { setFrame(f); if (Tt[f] > .1) { rotToward('Spine1', 'Hips', 'Head', -Tt[f] / 2); rotToward('Spine2', 'Hips', 'Head', -Tt[f] / 2); } for (const b of ['Spine1','Spine2']) O[b].quaternion.toArray(C.tracks[b], f*4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5));
let mN = 0, mH = 0, mT = 0; for (let f = 0; f < F; f++) { setFrame(f); mN = Math.max(mN, tilt('Neck','Head')); mH = Math.max(mH, tilt('Head','HeadTop_End')); mT = Math.max(mT, tilt('Hips','Head')); }
fs.writeFileSync(outp, JSON.stringify(C)); console.log(inp.split('/').pop(), 'after: neck', mN.toFixed(0), 'head', mH.toFixed(0), 'trunk', mT.toFixed(0));
