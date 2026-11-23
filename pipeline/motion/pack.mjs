// Pack retargeted clips into game/hero-moves.txt (JSON). usage: node pack.mjs moves.json clipsDir out.txt
// moves.json: { name: { src, loop?, rm?, speed?: playback multiplier (text-to-motion clips run slow), trim?:[t0,t1] seconds, step?: keep every Nth frame, close?: seconds of loop blending } }
import fs from 'fs';
import * as T from 'three';
const [,, selPath, dir, outPath] = process.argv;
const sel = JSON.parse(fs.readFileSync(selPath, 'utf8')); const out = {};
const r3 = x => Math.round(x * 1e4) / 1e4;
for (const [name, o] of Object.entries(sel)) {
  const C = JSON.parse(fs.readFileSync(`${dir}/${o.src}.json`, 'utf8'));
  const fps = C.fps; let a = Math.round((o.trim?.[0] || 0) * fps), b = o.trim?.[1] ? Math.round(o.trim[1] * fps) : C.frames - 1; b = Math.min(b, C.frames - 1);
  const step = o.step || 1; const idx = []; for (let f = a; f <= b; f += step) idx.push(f);
  const n = idx.length; const bones = Object.keys(C.tracks);
  const Q = {}; for (const bn of bones) Q[bn] = idx.map(f => new T.Quaternion().fromArray(C.tracks[bn], f * 4));
  const Hp = idx.map(f => new T.Vector3().fromArray(C.hips, f * 3));
  // hips: start at x=z=0
  const h0 = Hp[0].clone(); Hp.forEach(v => { v.x -= h0.x; v.z -= h0.z; });
  if (o.loop) { // blend the tail into the head so the loop has no seam
    const k = Math.min(n - 2, Math.round((o.close ?? .6) * fps / step));
    for (let i = 0; i < k; i++) { const f = n - k + i, w = (i + 1) / k, ws = w * w * (3 - 2 * w);
      for (const bn of bones) Q[bn][f].slerp(Q[bn][0], ws);
      Hp[f].y += (Hp[0].y - Hp[f].y) * ws; }
    if (!o.rm) Hp.forEach(v => { v.x = 0; v.z = 0; }); }
  for (const bn of bones) { const arr = Q[bn]; for (let i = 1; i < n; i++) if (arr[i].dot(arr[i - 1]) < 0) arr[i].set(-arr[i].x, -arr[i].y, -arr[i].z, -arr[i].w); }
  // low-pass: generated motion has high-frequency tremor (fingers of noise in hands, head, feet); a Gaussian over time removes it
  const sig = (o.smooth ?? 1.5) / step; if (sig > .2) { const R = Math.ceil(sig * 3); const wts = []; for (let k = -R; k <= R; k++) wts.push(Math.exp(-k * k / (2 * sig * sig)));
    const at = i => o.loop ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i));
    for (const bn of bones) { const src = Q[bn].map(q => q.clone()); const ref = src;
      for (let i = 0; i < n; i++) { let x = 0, y = 0, z = 0, w = 0, s = 0; for (let k = -R; k <= R; k++) { const q = src[at(i + k)]; const sg = q.dot(ref[i]) < 0 ? -1 : 1; const c = wts[k + R]; x += q.x * c * sg; y += q.y * c * sg; z += q.z * c * sg; w += q.w * c * sg; s += c; }
        Q[bn][i].set(x / s, y / s, z / s, w / s).normalize(); } }
    const hs = Hp.map(v => v.clone()); for (let i = 0; i < n; i++) { const a = new T.Vector3(); let s = 0; for (let k = -R; k <= R; k++) { a.addScaledVector(hs[at(i + k)], wts[k + R]); s += wts[k + R]; } Hp[i].copy(a.multiplyScalar(1 / s)); }
    for (const bn of bones) { const arr = Q[bn]; for (let i = 1; i < n; i++) if (arr[i].dot(arr[i - 1]) < 0) arr[i].set(-arr[i].x, -arr[i].y, -arr[i].z, -arr[i].w); } }
  out[name] = { fps: fps / step * (o.speed || 1), n, loop: !!o.loop, rm: !!o.rm, q: Object.fromEntries(bones.map(bn => [bn, Q[bn].flatMap(q => [r3(q.x), r3(q.y), r3(q.z), r3(q.w)])])), hips: Hp.flatMap(v => [r3(v.x), r3(v.y), r3(v.z)]) };
}
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(outPath, Object.keys(out).join(','), (fs.statSync(outPath).size / 1e3).toFixed(0) + ' KB');
