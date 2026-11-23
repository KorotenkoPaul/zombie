// Retarget CMU mocap (ASF/AMC, http://mocap.cs.cmu.edu, free for any use incl. commercial) onto the hero's Mixamo skeleton.
// usage: node cmu2hero.mjs hero.glb subject.asf outDir clip1.amc [clip2.amc ...]
// Output per clip: {fps:30,frames,tracks:{Bone:[x,y,z,w,...]},hips:[x,y,z,...]} in the same format as pipeline/motion/retarget.mjs.
// ASF conventions (as in the Acclaim spec): global rotation of a bone = parent * C * M * C^-1, C/M = Rz*Ry*Rx of the axis / dof angles;
// at rest every global rotation is identity and the bone points along its `direction`. CMU: y up, faces +z, left = +x (like SMPL).
import fs from 'fs';
import path from 'path';
import * as T from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, asfPath, outDir, ...amcs] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(heroPath);
const nodes = {}, parent = {};
const walk = (n, p) => { nodes[n.getName()] = n; parent[n.getName()] = p; n.listChildren().forEach(c => walk(c, n.getName())); };
doc.getRoot().listScenes()[0].listChildren().forEach(n => walk(n, null));
const restW = {};
const worldOf = nm => { if (restW[nm]) return restW[nm]; const n = nodes[nm]; const m = new T.Matrix4().compose(new T.Vector3(...n.getTranslation()), new T.Quaternion(...n.getRotation()), new T.Vector3(...n.getScale()));
  const w = parent[nm] ? worldOf(parent[nm]).clone().multiply(m) : m; restW[nm] = w; return w; };
Object.keys(nodes).forEach(worldOf);
const wq = nm => new T.Quaternion().setFromRotationMatrix(restW[nm]);
const wp = nm => new T.Vector3().setFromMatrixPosition(restW[nm]);
const B = s => 'mixamorig:' + s;
// ---------- ASF ----------
const asf = fs.readFileSync(asfPath, 'utf8');
const bonesA = { root: { name: 'root', dir: new T.Vector3(), len: 0, axis: [0,0,0], dof: ['rx','ry','rz'], parent: null } };
for (const blk of asf.split(/\bbegin\b/).slice(1)) { const b = blk.split(/\bend\b/)[0];
  const g = k => (b.match(new RegExp('\\b' + k + '\\s+([^\\n]+)')) || [])[1];
  if (!g('name') || !g('direction')) continue; const name = g('name').trim(); const dir = g('direction').trim().split(/\s+/).map(Number); const len = +g('length');
  const ax = g('axis').trim().split(/\s+/).slice(0, 3).map(Number); const dof = (g('dof') || '').trim().split(/\s+/).filter(Boolean);
  bonesA[name] = { name, dir: new T.Vector3(...dir).normalize(), len, axis: ax, dof, parent: null }; }
for (const line of asf.split(':hierarchy')[1].split('\n')) { const w = line.trim().split(/\s+/); if (w.length < 2 || w[0] === 'begin' || w[0] === 'end') continue; for (const c of w.slice(1)) if (bonesA[c]) bonesA[c].parent = w[0]; }
const D = Math.PI / 180;
const eul = (x, y, z) => new T.Quaternion().setFromEuler(new T.Euler(x * D, y * D, z * D, 'ZYX')); // three 'ZYX' = Rz*Ry*Rx applied to column vectors
for (const b of Object.values(bonesA)) { b.C = eul(...b.axis); b.Ci = b.C.clone().invert(); }
const order = []; const seen = new Set(); const visit = n => { if (seen.has(n)) return; const b = bonesA[n]; if (b.parent) visit(b.parent); seen.add(n); order.push(n); }; Object.keys(bonesA).forEach(visit);
const lenS = 1 / 0.45 * 2.54 / 100; // ASF length units -> metres
// hero bone <- CMU bone (global rotation), CMU rest direction of that segment, hero child node (rest direction)
const MAP = [
 ['Hips','root','lowerback','Spine'],['Spine','lowerback','lowerback','Spine1'],['Spine1','upperback','upperback','Spine2'],['Spine2','thorax','thorax','Neck'],['Neck','lowerneck','lowerneck','Head'],['Head','head','head','HeadTop_End'],
 ['LeftShoulder','lclavicle','lclavicle','LeftArm'],['LeftArm','lhumerus','lhumerus','LeftForeArm'],['LeftForeArm','lradius','lradius','LeftHand'],['LeftHand','lhand','lhand','LeftHandMiddle4'],
 ['RightShoulder','rclavicle','rclavicle','RightArm'],['RightArm','rhumerus','rhumerus','RightForeArm'],['RightForeArm','rradius','rradius','RightHand'],['RightHand','rhand','rhand','RightHandMiddle4'],
 ['LeftUpLeg','lfemur','lfemur','LeftLeg'],['LeftLeg','ltibia','ltibia','LeftFoot'],['LeftFoot','lfoot','lfoot','LeftToeBase'],['LeftToeBase','ltoes','ltoes','LeftToe_End'],
 ['RightUpLeg','rfemur','rfemur','RightLeg'],['RightLeg','rtibia','rtibia','RightFoot'],['RightFoot','rfoot','rfoot','RightToeBase'],['RightToeBase','rtoes','rtoes','RightToe_End'],
];
const Wt = {};
for (const [hb, , dsb, hc] of MAP) { const dh = wp(B(hc)).sub(wp(B(hb))).normalize(); const ds = bonesA[dsb].dir.clone(); Wt[hb] = new T.Quaternion().setFromUnitVectors(dh, ds).multiply(wq(B(hb))); }
// scale: hero leg length / CMU leg length
const legH = wp(B('LeftUpLeg')).distanceTo(wp(B('LeftLeg'))) + wp(B('LeftLeg')).distanceTo(wp(B('LeftFoot')));
const legC = (bonesA.lfemur.len + bonesA.ltibia.len) * lenS; const S = legH / legC;
const heroAnkle = wp(B('LeftFoot')).y;
const armW = wq('Armature');
fs.mkdirSync(outDir, { recursive: true });
for (const amcPath of amcs) {
  const lines = fs.readFileSync(amcPath, 'utf8').split('\n'); const frames = []; let cur = null;
  for (const l of lines) { const t = l.trim(); if (!t || t[0] === '#' || t[0] === ':') continue; if (/^\d+$/.test(t)) { cur = {}; frames.push(cur); continue; } const w = t.split(/\s+/); cur[w[0]] = w.slice(1).map(Number); }
  const step = 4; const out = { fps: 30, src: path.basename(amcPath), frames: 0, S, tracks: {}, hips: [] }; for (const [hb] of MAP) out.tracks[hb] = [];
  const G = {}, P = {}; let floor = Infinity; const rows = [];
  for (let f = 0; f < frames.length; f += step) { const fr = frames[f];
    for (const n of order) { const b = bonesA[n]; const v = fr[n] || []; const a = { rx: 0, ry: 0, rz: 0 };
      if (n === 'root') { a.rx = v[3]; a.ry = v[4]; a.rz = v[5]; } else b.dof.forEach((d, i) => { a[d] = v[i] || 0; });
      const M = eul(a.rx, a.ry, a.rz); const loc = b.C.clone().multiply(M).multiply(b.Ci);
      G[n] = b.parent ? G[b.parent].clone().multiply(loc) : loc;
      if (n === 'root') P[n] = new T.Vector3(v[0], v[1], v[2]).multiplyScalar(lenS); else P[n] = P[b.parent].clone().add(b.dir.clone().applyQuaternion(G[n]).multiplyScalar(b.len * lenS)); }
    floor = Math.min(floor, P.ltibia.y, P.rtibia.y); // ankles
    rows.push({ W: Object.fromEntries(MAP.map(([hb, cb]) => [hb, G[cb].clone().multiply(Wt[hb])])), hip: P.root.clone() }); }
  floor -= heroAnkle / S;
  for (const r of rows) { for (const [hb] of MAP) { const pn = parent[B(hb)].replace('mixamorig:', ''); const pw = r.W[pn] || (pn === 'Armature' ? armW : wq(B(pn)));
      out.tracks[hb].push(...pw.clone().invert().multiply(r.W[hb]).toArray().map(v => +v.toFixed(5))); }
    out.hips.push(+(r.hip.x * S).toFixed(4), +((r.hip.y - floor) * S).toFixed(4), +(r.hip.z * S).toFixed(4)); }
  out.frames = rows.length;
  const fn = path.join(outDir, path.basename(amcPath, '.amc') + '.json'); fs.writeFileSync(fn, JSON.stringify(out));
  console.log(fn, out.frames, 'frames, scale', S.toFixed(3));
}
