// Pack retargeted CMU clips (cmu2hero.mjs output) into game/motion-db.txt for game/motion.js.
// usage: node pack.mjs hero.glb retDir out.txt clip1 clip2 ...   (clip = file name without .json)
// Format: JSON {v,fps,bones,rest:{q,p},clips:[{name,n}],q:base64 Int16 (frame,bone,xyzw)*32767,h:base64 Int16 (frame,xyz) mm}
import fs from 'fs';
import * as T from 'three';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const [,, heroPath, dir, outPath, ...names] = process.argv;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder});
const doc = await io.read(heroPath); const nodes = {}; const walk = n => { nodes[n.getName().replace('mixamorig:', '')] = n; n.listChildren().forEach(walk); };
doc.getRoot().listScenes()[0].listChildren().forEach(walk);
const first = JSON.parse(fs.readFileSync(`${dir}/${names[0]}.json`, 'utf8')); const bones = Object.keys(first.tracks);
const rest = { q: bones.map(b => nodes[b].getRotation().map(v => +v.toFixed(5))), p: bones.map(b => nodes[b].getTranslation().map(v => +v.toFixed(5))) };
let total = 0; const clips = []; const Q = [], Hh = [];
// generated clips (hy_*, Hunyuan Motion) carry a high-frequency tremor: Gaussian over time (sigma 1.5 frames), as pipeline/motion/pack.mjs does
function smoothClip(C, sig) { const n = C.frames, R = Math.ceil(sig * 3), w = []; for (let k = -R; k <= R; k++) w.push(Math.exp(-k*k / (2*sig*sig)));
  const at = i => Math.max(0, Math.min(n - 1, i));
  for (const b of Object.keys(C.tracks)) { const a = C.tracks[b]; for (let f = 1; f < n; f++) { const d = a[f*4]*a[f*4-4] + a[f*4+1]*a[f*4-3] + a[f*4+2]*a[f*4-2] + a[f*4+3]*a[f*4-1]; if (d < 0) for (let k = 0; k < 4; k++) a[f*4+k] = -a[f*4+k]; }
    const src = Float64Array.from(a); for (let f = 0; f < n; f++) { const q = [0, 0, 0, 0]; let s = 0; for (let k = -R; k <= R; k++) { const j = at(f + k); for (let c = 0; c < 4; c++) q[c] += src[j*4+c] * w[k+R]; s += w[k+R]; }
      const l = Math.hypot(...q) || 1; for (let c = 0; c < 4; c++) a[f*4+c] = q[c] / l; } }
  const hs = Float64Array.from(C.hips); for (let f = 0; f < n; f++) for (let c = 0; c < 3; c++) { let v = 0, s = 0; for (let k = -R; k <= R; k++) { v += hs[at(f+k)*3+c] * w[k+R]; s += w[k+R]; } C.hips[f*3+c] = v / s; } }
for (const nm of names) { const C = JSON.parse(fs.readFileSync(`${dir}/${nm}.json`, 'utf8')); const n = C.frames;
  if (nm.startsWith('hy_')) smoothClip(C, 1.5);
  for (let f = 0; f < n; f++) { let prev = null;
    for (const b of bones) { const a = C.tracks[b]; let q = [a[f*4], a[f*4+1], a[f*4+2], a[f*4+3]];
      // keep each bone's quaternion in the same hemisphere as its previous frame so interpolation never takes the long way
      if (f > 0) { const p = C.tracks[b]; const d = q[0]*p[f*4-4] + q[1]*p[f*4-3] + q[2]*p[f*4-2] + q[3]*p[f*4-1]; if (d < 0) { q = q.map(v => -v); a[f*4] = q[0]; a[f*4+1] = q[1]; a[f*4+2] = q[2]; a[f*4+3] = q[3]; } }
      for (const v of q) Q.push(Math.round(Math.max(-1, Math.min(1, v)) * 32767)); }
    for (let k = 0; k < 3; k++) Hh.push(Math.round(C.hips[f*3+k] * 1000)); }
  clips.push({ name: nm, n }); total += n; }
const b64 = a => Buffer.from(Int16Array.from(a).buffer).toString('base64');
fs.writeFileSync(outPath, JSON.stringify({ v: 1, fps: 30, src: 'CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), free for commercial use', bones, rest, clips, q: b64(Q), h: b64(Hh) }));
console.log(outPath, total, 'frames', (fs.statSync(outPath).size / 1e6).toFixed(2), 'MB');
