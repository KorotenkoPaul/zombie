// Pose discontinuities at clip switches ("pops"), from a recorded frames.json.gz (tests/anim/run.js or tests/mm/scenario.js).
// For every clip change: the worst per-frame acceleration of any bone in the hero's own frame (root motion removed) within
// -5..+25 frames, and the worst root acceleration (world). A pop = bone accel > POP cm/frame² (a smooth action stays < ~2).
// usage: node tests/mm/pops.js DIR [--json]
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const dir = process.argv[2]; const D = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, 'frames.json.gz'))));
const F = D.frames, NB = (F[0].b.length / 3) | 0, POP = 3;
const local = f => { const c = Math.cos(-f.ry), s = Math.sin(-f.ry), o = new Float64Array(NB * 3);
  for (let b = 0; b < NB; b++) { const x = f.b[b*3] - f.root[0], y = f.b[b*3+1] - f.root[1], z = f.b[b*3+2] - f.root[2]; o[b*3] = x*c + z*s; o[b*3+1] = y; o[b*3+2] = -x*s + z*c; } return o; };
const L = F.map(local);
const acc = new Float64Array(F.length), racc = new Float64Array(F.length), worstB = new Int16Array(F.length);
for (let i = 1; i < F.length - 1; i++) { if (F[i+1].f - F[i-1].f !== 2) continue; let m = 0, wb = 0;
  for (let b = 0; b < NB; b++) { let a = 0; for (let k = 0; k < 3; k++) { const d = L[i+1][b*3+k] - 2*L[i][b*3+k] + L[i-1][b*3+k]; a += d*d; } a = Math.sqrt(a) * 100; if (a > m) { m = a; wb = b; } }
  acc[i] = m; worstB[i] = wb; let r = 0; for (let k = 0; k < 3; k++) { const d = F[i+1].root[k] - 2*F[i].root[k] + F[i-1].root[k]; r += d*d; } racc[i] = Math.sqrt(r) * 100; }
const act = f => f.state === 'walk' ? (f.fl.includes('L') ? 'ladder' : 'walk') : (f.state || '?');
const ev = [];
for (let i = 1; i < F.length; i++) { if (F[i].clip === F[i-1].clip) continue;
  let m = 0, mi = i, r = 0; for (let k = Math.max(1, i - 5); k < Math.min(F.length - 1, i + 25); k++) { if (acc[k] > m) { m = acc[k]; mi = k; } r = Math.max(r, racc[k]); }
  ev.push({ f: F[i].f, from: F[i-1].clip, to: F[i].clip, act: act(F[i-1]) + '>' + act(F[i]), task: F[i].task, pose: +m.toFixed(2), root: +r.toFixed(2), at: mi - i, bone: D.BN ? D.BN[worstB[mi]] : worstB[mi], mm: F[i].mm ? F[i].mm[0] : 0 }); }
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : 0; };
const pose = ev.map(e => e.pose), root = ev.map(e => e.root);
const byKind = {}; for (const e of ev) { const k = e.act; (byKind[k] = byKind[k] || []).push(e); }
const kinds = Object.entries(byKind).map(([k, a]) => ({ kind: k, n: a.length, pops: a.filter(e => e.pose > POP).length, p90: q(a.map(e => e.pose), .9), max: q(a.map(e => e.pose), 1) })).sort((a, b) => b.pops - a.pops);
const rep = { frames: F.length, switches: ev.length, pops: ev.filter(e => e.pose > POP).length, rootPops: ev.filter(e => e.root > POP).length, poseMedian: q(pose, .5), poseP90: q(pose, .9), poseMax: q(pose, 1), rootP90: q(root, .9),
  kinds, worst: ev.slice().sort((a, b) => b.pose - a.pose).slice(0, 15) };
if (process.argv.includes('--json')) fs.writeFileSync(path.join(dir, 'pops.json'), JSON.stringify(rep, null, 1));
console.log(JSON.stringify({ ...rep, worst: rep.worst.map(e => `f${e.f} ${e.act} ${e.from}->${e.to} ${e.task} pose ${e.pose} root ${e.root} @${e.at} ${e.bone}`) }, null, 1));
