// FK + QA metrics for retargeted clips (retarget.mjs / cmu2hero.mjs format). usage: node fk.mjs hero.glb clip.json out.json
import fs from 'fs';
import * as T from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, clipPath, outPath] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(heroPath);
const O = {};
const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); o.scale.fromArray(n.getScale()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(clipPath, 'utf8')); const F = C.frames ?? C.n;
const J = ['Hips','Spine2','Neck','Head','HeadTop_End','LeftShoulder','LeftArm','LeftForeArm','LeftHand','RightShoulder','RightArm','RightForeArm','RightHand','LeftUpLeg','LeftLeg','LeftFoot','LeftToeBase','LeftToe_End','RightUpLeg','RightLeg','RightFoot','RightToeBase','RightToe_End'];
const P = []; const up = new T.Vector3(0,1,0);
const res = { clip: clipPath.split('/').pop(), frames: F, fps: C.fps || 30, joints: J, P: [] };
let kneeBad = { L: 0, R: 0 }, kneeMin = { L: 9, R: 9 }, kneeMaxBend = { L: 0, R: 0 }, slide = 0, slideN = 0, pen = 0, yaw = [], hipsLocalZ = [];
const prev = {};
for (let f = 0; f < F; f++) {
  for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4);
  O.Hips.position.fromArray(C.hips, f * 3);
  root.updateMatrixWorld(true);
  const w = {}; for (const j of J) w[j] = new T.Vector3().setFromMatrixPosition(O[j].matrixWorld);
  res.P.push(J.flatMap(j => w[j].toArray().map(v => +v.toFixed(4))));
  const left = w.LeftUpLeg.clone().sub(w.RightUpLeg); left.y = 0; left.normalize(); const fwd = left.clone().cross(up).normalize();
  yaw.push(Math.atan2(fwd.x, fwd.z));
  const hz = new T.Vector3(0,0,-1).transformDirection(O.Hips.matrixWorld); hipsLocalZ.push(Math.atan2(hz.x, hz.z));
  const leftW = w.LeftUpLeg.clone().sub(w.RightUpLeg).normalize();
  for (const s of ['L','R']) { const S = s === 'L' ? 'Left' : 'Right';
    const t = w[S+'Leg'].clone().sub(w[S+'UpLeg']), sh = w[S+'Foot'].clone().sub(w[S+'Leg']);
    const bend = t.angleTo(sh); kneeMaxBend[s] = Math.max(kneeMaxBend[s], bend);
    const n = t.clone().cross(sh); const sgn = n.dot(leftW) / (n.length() || 1);
    if (bend > 0.17 && sgn < -0.3) kneeBad[s]++; if (bend > 0.17) kneeMin[s] = Math.min(kneeMin[s], sgn);
    // foot slide: ankle within 4 cm of its clip-lowest and slow vertical motion
    const a = w[S+'Foot'], toe = w[S+'ToeBase'];
    if (prev[S]) { const v = a.clone().sub(prev[S]).multiplyScalar(res.fps); const lowY = Math.min(a.y, toe.y);
      if (lowY < 0.12 && Math.abs(v.y) < 0.15) { const hv = Math.hypot(v.x, v.z); slide += hv; slideN++; } }
    prev[S] = a.clone();
    pen = Math.min(pen, w[S+'Toe_End'].y, w[S+'ToeBase'].y, a.y - 0.05);
  }
}
const rd = v => +(v * 180 / Math.PI).toFixed(0);
const hipXZ = Math.hypot(C.hips[(F-1)*3] - C.hips[0], C.hips[(F-1)*3+2] - C.hips[2]);
res.metrics = { dur: +(F / res.fps).toFixed(2), facingStart: rd(yaw[0]), facingEnd: rd(yaw[F-1]), hipsMinusZStart: rd(hipsLocalZ[0]),
  kneeBackFrames: kneeBad, kneeWorstSign: { L: +kneeMin.L.toFixed(2), R: +kneeMin.R.toFixed(2) }, kneeMaxBendDeg: { L: rd(kneeMaxBend.L), R: rd(kneeMaxBend.R) },
  footSlideMps: +(slideN ? slide / slideN : 0).toFixed(3), floorMinY: +pen.toFixed(3), rootTravel: +hipXZ.toFixed(2),
  hipsY: [+Math.min(...C.hips.filter((_, i) => i % 3 === 1)).toFixed(2), +Math.max(...C.hips.filter((_, i) => i % 3 === 1)).toFixed(2)] };
fs.writeFileSync(outPath, JSON.stringify(res));
console.log(res.clip, JSON.stringify(res.metrics));
