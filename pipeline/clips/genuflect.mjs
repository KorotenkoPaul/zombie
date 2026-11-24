// Turn a deep crouch into a one-knee kneel: front foot flat on a fixed floor spot with a near-vertical shin,
// back knee resting on the floor, back foot on its toes. All contacts fixed over the loop (no sliding).
// usage: node genuflect.mjs hero.glb in.json out.json [FRONT=Left] [HIPY=0.43] [TILT=15]
import fs from 'fs'; import * as T from 'three';
import { NodeIO } from '@gltf-transform/core'; import { ALL_EXTENSIONS } from '@gltf-transform/extensions'; import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, inp, outp, FR = 'Left', hyA = '0.43', tA = '15'] = process.argv; const BK = FR === 'Left' ? 'Right' : 'Left'; const HIPY = +hyA, TILT = +tA * Math.PI / 180; await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder}).read(heroPath);
const O = {}; const mk = (n, par) => { const o = new T.Object3D(); o.name = n.getName().replace('mixamorig:', ''); o.position.fromArray(n.getTranslation()); o.quaternion.fromArray(n.getRotation()); O[o.name] = o; par && par.add(o); n.listChildren().forEach(c => mk(c, o)); return o; };
const root = new T.Object3D(); doc.getRoot().listScenes()[0].listChildren().forEach(n => root.add(mk(n, null)));
const C = JSON.parse(fs.readFileSync(inp, 'utf8')); const F = C.frames;
const wp = n => new T.Vector3().setFromMatrixPosition(O[n].matrixWorld);
const wq = n => { const q = new T.Quaternion(); O[n].getWorldQuaternion(q); return q; };
const setFrame = f => { for (const b of Object.keys(C.tracks)) if (O[b]) O[b].quaternion.fromArray(C.tracks[b], f * 4); O.Hips.position.fromArray(C.hips, f * 3); root.updateMatrixWorld(true); };
const setWorldQ = (n, q) => { const pq = new T.Quaternion(); O[n].parent.getWorldQuaternion(pq); O[n].quaternion.copy(pq.invert().multiply(q)); root.updateMatrixWorld(true); };
const aim = (bone, child, target) => { const p = wp(bone), c = wp(child); const q = new T.Quaternion().setFromUnitVectors(c.sub(p).normalize(), target.clone().sub(p).normalize()); setWorldQ(bone, q.multiply(wq(bone))); };
const ik = (s, A, poleDir) => { const U = wp(s+'UpLeg'); const a = U.distanceTo(wp(s+'Leg')), b = wp(s+'Leg').distanceTo(wp(s+'Foot')); const D = Math.min(U.distanceTo(A), a + b - 0.001); const u = A.clone().sub(U).normalize(); const At = U.clone().add(u.clone().multiplyScalar(D));
  const ang = Math.acos(Math.max(-1, Math.min(1, (a*a + D*D - b*b) / (2*a*D)))); const p = poleDir.clone().sub(u.clone().multiplyScalar(poleDir.dot(u))).normalize();
  aim(s+'UpLeg', s+'Leg', U.clone().add(u.multiplyScalar(a*Math.cos(ang))).add(p.multiplyScalar(a*Math.sin(ang)))); aim(s+'Leg', s+'Foot', At); };
// reference: mean hip height, forward direction (hip -> original front ankle), toe/ball heights from bind-ish idle
let hy = 0, fwd = new T.Vector3(), ballY = 9; for (let f = 0; f < F; f++) { setFrame(f); hy += C.hips[f*3+1] / F; const d = wp('LeftUpLeg').sub(wp('RightUpLeg')).cross(new T.Vector3(0,1,0)); d.y = 0; fwd.add(d); ballY = Math.min(ballY, wp(FR+'ToeBase').y, wp(BK+'ToeBase').y); }
fwd.normalize(); const up = new T.Vector3(0,1,0); const dy = HIPY - hy;
setFrame(0); const a = wp(FR+'UpLeg').distanceTo(wp(FR+'Leg')), b = wp(FR+'Leg').distanceTo(wp(FR+'Foot')); const footL = wp(FR+'Foot').distanceTo(wp(FR+'ToeBase'));
const HB = 0.06, KNEEY = 0.06; // ankle above ball for a level foot; knee joint height when resting on the floor
// fixed contact points from the mean pose
let Hm = new T.Vector3(), Lh = new T.Vector3(), Rh = new T.Vector3(); for (let f = 0; f < F; f++) { setFrame(f); O.Hips.position.y += dy; root.updateMatrixWorld(true); Hm.add(wp('Hips').multiplyScalar(1/F)); Lh.add(wp(FR+'UpLeg').multiplyScalar(1/F)); Rh.add(wp(BK+'UpLeg').multiplyScalar(1/F)); }
// front: knee at thigh-forward, shin tilted TILT
const kneeYf = ballY + HB + b * Math.cos(TILT); const thH = Math.sqrt(Math.max(0, a*a - (Lh.y - kneeYf)**2));
const Kf = Lh.clone().add(fwd.clone().multiplyScalar(thH)); Kf.y = kneeYf; const Af = Kf.clone().add(fwd.clone().multiplyScalar(-b * Math.sin(TILT))); Af.y = ballY + HB;
// back: knee on the floor below/behind the hip, shin back along the floor, ankle raised a little, foot on its toes
const thB = Math.sqrt(Math.max(0, a*a - (Rh.y - KNEEY)**2)); const Kb = Rh.clone().add(fwd.clone().multiplyScalar(-thB * 0.35)); Kb.y = KNEEY;
const AY = ballY + footL * 0.8; const shB = Math.sqrt(Math.max(0, b*b - (AY-KNEEY)**2)); const Ab = Kb.clone().add(fwd.clone().multiplyScalar(-shB)); Ab.y = AY;
const Bb = Ab.clone().add(fwd.clone().multiplyScalar(-footL * 0.6)); Bb.y = ballY;
console.log('front knee', Kf.toArray().map(v=>v.toFixed(2)), 'ankle', Af.toArray().map(v=>v.toFixed(2)), '| back knee', Kb.toArray().map(v=>v.toFixed(2)), 'ankle', Ab.toArray().map(v=>v.toFixed(2)), 'hip dy', dy.toFixed(3), 'back thigh horiz', thB.toFixed(2));
const levelFoot = (s, target) => { aim(s+'Foot', s+'ToeBase', target); };
let worst = 0;
for (let f = 0; f < F; f++) { setFrame(f); C.hips[f*3+1] = HIPY + (C.hips[f*3+1] - hy) * +(process.env.SWAY || 0.3); O.Hips.position.fromArray(C.hips, f*3); root.updateMatrixWorld(true);
  const fq = wq(FR+'Foot');
  ik(FR, Af, fwd); const fb = Af.clone().add(fwd.clone().multiplyScalar(Math.sqrt(footL*footL - HB*HB))); fb.y = ballY;
  // keep the foot's sideways yaw: blend fwd target with original toe direction
  levelFoot(FR, fb);
  ik(BK, Ab, fwd); levelFoot(BK, Bb);
  // toes of the back foot flat on the floor
  { const tb = wp(BK+'ToeBase'), te = wp(BK+'Toe_End'); const tgt = tb.clone().add(fwd.clone().multiplyScalar(-te.distanceTo(tb))); tgt.y = tb.y; aim(BK+'ToeBase', BK+'Toe_End', tgt); }
  { const tb = wp(FR+'ToeBase'), te = wp(FR+'Toe_End'); const tgt = tb.clone().add(fwd.clone().multiplyScalar(te.distanceTo(tb))); tgt.y = tb.y; aim(FR+'ToeBase', FR+'Toe_End', tgt); }
  worst = Math.max(worst, wp(FR+'Foot').distanceTo(Af), wp(BK+'Foot').distanceTo(Ab));
  for (const s of [FR, BK]) for (const n of ['UpLeg','Leg','Foot','ToeBase']) O[s+n].quaternion.toArray(C.tracks[s+n], f * 4); }
for (const k of Object.keys(C.tracks)) C.tracks[k] = C.tracks[k].map(v => +(+v).toFixed(5)); C.hips = C.hips.map(v => +(+v).toFixed(4));
fs.writeFileSync(outp, JSON.stringify(C)); console.log('max ankle target miss cm', (worst*100).toFixed(1));
