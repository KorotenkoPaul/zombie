// Retarget a Hunyuan Motion (fal-ai/hunyuan-motion, output_format "dict") SMPL-H clip onto the hero's Mixamo skeleton.
// usage: node retarget.mjs hero.glb motion.json out.json [name] [--fps 30]
// SMPL: y up, faces +z, left = +x, rest = T-pose with identity joint frames. rot6d = interleaved 3x2 (columns = [0::2],[1::2]).
import fs from 'fs';
import * as T from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, motionPath, outPath, clipName='hy'] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(heroPath);
// ---- hero rest pose ----
const nodes = {}; const parent = {};
const walk = (n, p) => { nodes[n.getName()] = n; parent[n.getName()] = p; n.listChildren().forEach(c => walk(c, n.getName())); };
doc.getRoot().listScenes()[0].listChildren().forEach(n => walk(n, null));
const restL = {}, restW = {}, restP = {};
const worldOf = nm => { if (restW[nm]) return restW[nm]; const n = nodes[nm]; const m = new T.Matrix4().compose(new T.Vector3(...n.getTranslation()), new T.Quaternion(...n.getRotation()), new T.Vector3(...n.getScale()));
  restL[nm] = m; const w = parent[nm] ? worldOf(parent[nm]).clone().multiply(m) : m; restW[nm] = w; return w; };
Object.keys(nodes).forEach(worldOf);
const wq = nm => new T.Quaternion().setFromRotationMatrix(restW[nm]);
const wp = nm => new T.Vector3().setFromMatrixPosition(restW[nm]);
const B = s => 'mixamorig:' + s;
// ---- motion ----
const M = JSON.parse(fs.readFileSync(motionPath, 'utf8'));
const r6 = M.rot6d[0], kp = M.keypoints3d[0]; const F = r6.length;
// keypoints are root-relative: add the global root translation
const TR = M.transl[0]; for (let f = 0; f < F; f++) for (const j of kp[f]) { j[0] += TR[f][0]; j[1] += TR[f][1]; j[2] += TR[f][2]; }
const P = [-1,0,0,0,1,2,3,4,5,6,7,8,9,9,9,12,13,14,16,17,18,19];
const rot = x => { const a1 = new T.Vector3(x[0],x[2],x[4]), a2 = new T.Vector3(x[1],x[3],x[5]); const b1 = a1.clone().normalize(); const b2 = a2.clone().sub(b1.clone().multiplyScalar(b1.dot(a2))).normalize(); const b3 = b1.clone().cross(b2);
  return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(b1, b2, b3)); };
const G = []; // global joint rotations per frame
for (let f = 0; f < F; f++) { const g = []; for (let j = 0; j < 22; j++) { const q = rot(r6[f][j]); g[j] = P[j] < 0 ? q : g[P[j]].clone().multiply(q); } G.push(g); }
// face +z at the first frame: turn the whole clip about y (pelvis forward = its local +z) and start the hips at x=z=0
const pf = new T.Vector3(0,0,1).applyQuaternion(G[0][0]); const head = Math.atan2(pf.x, pf.z);
const Ry = new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0), -head);
const k0 = new T.Vector3(...kp[0][0]);
for (let f = 0; f < F; f++) { for (let j = 0; j < 22; j++) G[f][j].premultiply(Ry); for (let j = 0; j < kp[f].length; j++) { const v = new T.Vector3(...kp[f][j]); v.x -= k0.x; v.z -= k0.z; v.applyQuaternion(Ry); kp[f][j] = [v.x, v.y, v.z]; } }
// SMPL rest offsets (child joint in parent frame) from frame 0
const kv = (f, j) => new T.Vector3(...kp[f][j]);
const off = j => kv(0, j).sub(kv(0, P[j])).applyQuaternion(G[0][P[j]].clone().invert());
// mapping: hero bone, smpl joint, smpl child joint (rest direction), hero child node (rest direction)
const MAP = [
 ['Hips',0,3,'Spine'],['Spine',3,6,'Spine1'],['Spine1',6,9,'Spine2'],['Spine2',9,12,'Neck'],['Neck',12,15,'Head'],['Head',15,null,'HeadTop_End'],
 ['LeftShoulder',13,16,'LeftArm'],['LeftArm',16,18,'LeftForeArm'],['LeftForeArm',18,20,'LeftHand'],['LeftHand',20,'L','LeftHandMiddle4'],
 ['RightShoulder',14,17,'RightArm'],['RightArm',17,19,'RightForeArm'],['RightForeArm',19,21,'RightHand'],['RightHand',21,'R','RightHandMiddle4'],
 ['LeftUpLeg',1,4,'LeftLeg'],['LeftLeg',4,7,'LeftFoot'],['LeftFoot',7,10,'LeftToeBase'],['LeftToeBase',10,'Z','LeftToe_End'],
 ['RightUpLeg',2,5,'RightLeg'],['RightLeg',5,8,'RightFoot'],['RightFoot',8,11,'RightToeBase'],['RightToeBase',11,'Z','RightToe_End'],
];
// correction: hero rest bone world rotation -> same bone posed in the SMPL T-pose (swing the bone direction onto SMPL's)
const Wt = {};
for (const [hb, j, c, hc] of MAP) {
  const dh = wp(B(hc)).sub(wp(B(hb))).normalize();
  let ds; if (c === null) ds = new T.Vector3(0,1,0); else if (c === 'L') ds = new T.Vector3(1,0,0); else if (c === 'R') ds = new T.Vector3(-1,0,0); else if (c === 'Z') ds = new T.Vector3(0,-.25,1).normalize(); else ds = off(c).normalize();
  const sw = new T.Quaternion().setFromUnitVectors(dh, ds);
  Wt[hb] = sw.multiply(wq(B(hb)));
}
// hips height: scale SMPL by leg length, floor = lowest ankle minus SMPL ankle height
const legH = wp(B('LeftUpLeg')).distanceTo(wp(B('LeftLeg'))) + wp(B('LeftLeg')).distanceTo(wp(B('LeftFoot')));
const legS = off(4).length() + off(7).length(); const S = legH / legS;
const heroAnkle = wp(B('LeftFoot')).y; // hero ankle height in rest (feet on y=0)
let floor = Infinity; for (let f = 0; f < F; f++) floor = Math.min(floor, kp[f][7][1], kp[f][8][1]);
floor -= heroAnkle / S;
const fps = 30; const times = []; const tracks = {}; const hips = [];
const out = { name: clipName, fps, frames: F, S, tracks: {} };
for (const [hb] of MAP) out.tracks[hb] = [];
const armW = wq('Armature');
for (let f = 0; f < F; f++) {
  const W = {};
  for (const [hb, j] of MAP) W[hb] = G[f][j].clone().multiply(Wt[hb]);
  for (const [hb] of MAP) {
    const pn = parent[B(hb)].replace('mixamorig:', '');
    const pw = W[pn] || (pn === 'Armature' ? armW : wq(B(pn)));
    const lq = pw.clone().invert().multiply(W[hb]);
    out.tracks[hb].push(...lq.toArray().map(v => +v.toFixed(5)));
  }
  const pk = kv(f, 0); hips.push(+(pk.x * S).toFixed(4), +((pk.y - floor) * S).toFixed(4), +(pk.z * S).toFixed(4));
}
out.hips = hips;
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(outPath, F, 'frames', 'scale', S.toFixed(3), 'hipsY0', hips[1], 'bytes', fs.statSync(outPath).size);
