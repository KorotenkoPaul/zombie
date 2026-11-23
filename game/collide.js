// collide.js — hard boundaries between the hero's body and the house (owner: Collision thread)
//
// The hero's motions are prerecorded clips; a clip knows nothing about walls, beams or the bunk bed.
// This module runs right after hero.js has posed the body each frame and pushes the body out of anything solid:
//  * World: every solid mesh around the house becomes a collider. Boards and beams (instanced boxes), and any
//    box / cylinder / sphere mesh, are exact oriented shapes. Merged furniture meshes (props.js bakes parts per
//    material) are voxelised once at 2 cm into an inside-distance grid, in the background, nearest first.
//    The trunk uses the game's own bark cross-sections. Moving parts (oven door, book, tools) are followed:
//    a shape re-reads its object's matrix when the hero is near, and things the hero carries are ignored.
//  * Body: ~900 points of the real skin (skinned on the CPU from the bones, the same way the GPU does it).
//  * Response, per body chain:
//      trunk, hips, shoulders -> a root offset (sideways; also up while seated or lying);
//      head                   -> the spine and neck bend away;
//      forearm / hand         -> arm IK moves the hand;
//      shin / foot            -> leg IK moves the foot (sole orientation kept).
//    Every correction is kept as an offset that is released slowly (exponential, ~0.4 s) and grown only by what
//    the current frame needs, so the body never pops and never sinks back in.
//  * The root offset is a display layer: it is taken off before hero.js runs, so the hero's own walking,
//    sitting and navigation logic never sees it.
// Intentional contact is allowed to the depths the animation QA test tolerates minus a margin: soles on boards,
// thighs on a seat, the body on the mattress and the head in the pillow.
// API: window.__collide = { stats(), enable(on), shapes, depthAt(x,y,z), navReport() }
import * as THREE from 'three';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// allowed depth (m) of skin inside a thing, per body part; the QA limits are 1 cm (head, feet), 1.5 cm (rest),
// 2 cm seat (hips/shins on chair/stool/bench), 3 cm soft (bed), 6 cm pillow while lying
const ALLOW = { hard: .004, feet: .008, seat: .011, soft: .017, pillow: .04 };
const SOFT = /quilt|mattress|pillow|blanket|bunk|bed|rug/i, SEAT = /chair|stool|bench/i;

export function createCollide({ scene, HH, P3 = null, trunk = null, perf = null, voxCm = 2 }) {
  const hero = HH.hero, root = hero.root, bones = HH.bones;
  const mine = o => { while (o) { if (o === root) return true; o = o.parent; } return false; };
  const visible = o => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const solidMat = o => { const m = Array.isArray(o.material) ? o.material[0] : o.material; if (!m) return false; if (m.transparent && m.opacity < .6) return false; if (m.depthWrite === false || m.blending === THREE.AdditiveBlending) return false; return true; };
  const label = o => { const parts = []; let x = o; while (x && x !== scene) { if (x.name && !/^(Mesh|Object|Group|Scene)?_?\d*$/.test(x.name)) parts.push(x.name); x = x.parent; } return parts.reverse().join('/') || o.geometry.type; };

  // ---------- where the hero can be: the walk graph's box, padded ----------
  const REG = new THREE.Box3(); for (const k in HH.N) REG.expandByPoint(HH.N[k].p); REG.min.add(V(-1.2, -.6, -1.2)); REG.max.add(V(1.2, 2.4, 1.2));

  // ---------- shapes ----------
  // {kind:'box'|'cyl'|'sph'|'vox', c, ax[3] (unit), h[3], r, cls:0 hard 1 seat 2 soft 3 pillow, obj, inst, m (cached matrix)}
  const S = []; const pending = [];
  const m4 = new THREE.Matrix4(), mi = new THREE.Matrix4();
  function frameOf(s, mw) { // fill c, ax, h from a geometry box and a world matrix
    const bb = s.bb, e = mw.elements; const ax = [V(e[0], e[1], e[2]), V(e[4], e[5], e[6]), V(e[8], e[9], e[10])]; const sc = ax.map(a => a.length());
    if (sc.some(v => v < 1e-6)) return false; ax.forEach((a, i) => a.multiplyScalar(1 / sc[i]));
    const lh = bb.getSize(V()).multiplyScalar(.5); s.h = [lh.x * sc[0], lh.y * sc[1], lh.z * sc[2]]; s.c = bb.getCenter(V()).applyMatrix4(mw); s.ax = ax; s.sc = sc;
    if (s.kind === 'cyl') s.r = s.r0 * sc[0]; if (s.kind === 'sph') s.r = s.r0 * sc[0];
    if (s.kind === 'vox') { s.inv = (s.inv || new THREE.Matrix4()).copy(mw).invert(); s.sMin = Math.min(...sc); }
    return true;
  }
  const clsOf = name => SOFT.test(name) ? (/pillow/i.test(name) ? 3 : 2) : SEAT.test(name) ? 1 : 0;
  function add(obj, geo, mw, name, inst = -1) {
    if (!geo.boundingBox) geo.computeBoundingBox(); const t = geo.type, pr = geo.parameters || {};
    let kind = 'vox', r0 = 0;
    if (/Box/.test(t) || inst >= 0) kind = 'box'; // instanced parts (boards, uneven planks) are box-like: their box, as the QA test does
    else if (t === 'CylinderGeometry' && Math.abs((pr.radiusTop || 0) - (pr.radiusBottom || 0)) < .02 && !pr.openEnded) { kind = 'cyl'; r0 = Math.max(pr.radiusTop, pr.radiusBottom); }
    else if (t === 'SphereGeometry' && (pr.phiLength ?? 6.3) > 6.2 && (pr.thetaLength ?? 3.2) > 3.1) { kind = 'sph'; r0 = pr.radius; }
    const s = { kind, r0, bb: geo.boundingBox.clone(), geo, obj, inst, name, cls: clsOf(name), m: new Float32Array(16) };
    if (!frameOf(s, mw)) return; if (Math.min(...s.h) < .003) return; // flat: no volume
    if ((kind === 'cyl' || kind === 'sph') && Math.abs(s.sc[0] - s.sc[2]) > 1e-3) { s.kind = 'box'; }
    if (kind === 'sph' && Math.abs(s.sc[0] - s.sc[1]) > 1e-3) s.kind = 'box';
    s.m.set(mw.elements); S.push(s); if (s.kind === 'vox') { s.ready = false; pending.push(s); }
  }
  const skipped = {};
  root.updateMatrixWorld(true); scene.updateMatrixWorld(true);
  const wb = new THREE.Box3();
  scene.traverse(o => {
    if (!o.isMesh || o.isSkinnedMesh || mine(o) || !solidMat(o)) return; const t = o.geometry.type;
    if (/Plane|Circle|Shape|Ring/.test(t)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const name = label(o);
    if (o.isInstancedMesh) {
      if (o.count > 1500) { skipped['inst ' + name] = o.count; return; }
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, mi); m4.multiplyMatrices(o.matrixWorld, mi); wb.copy(o.geometry.boundingBox).applyMatrix4(m4); if (!wb.intersectsBox(REG)) continue; add(o, o.geometry, m4, name + '#' + i, i); }
      return;
    }
    wb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); if (!wb.intersectsBox(REG)) return;
    const sz = wb.getSize(V()); if (!/Box|Cylinder|Sphere/.test(t) && Math.hypot(sz.x, sz.y, sz.z) > 3.4) { skipped['big ' + name] = 1; return; }
    add(o, o.geometry, o.matrixWorld, name);
  });

  // ---------- voxelised furniture: inside-distance grid (chamfer), same method as the animation QA test ----------
  function voxelise(s) {
    const g = s.geo; const P = g.attributes.position; const I = g.index ? g.index.array : null; const nt = I ? I.length / 3 : P.count / 3; s.ready = true; if (nt < 4) { s.dead = true; return; }
    const bb = s.bb.clone(); const pad = .02; bb.min.subScalar(pad); bb.max.addScalar(pad); const sz = bb.getSize(V());
    const sMin = s.sMin; let cs = Math.max(voxCm / 100 / sMin, Math.cbrt(sz.x * sz.y * sz.z / 1.2e6)); const nx = Math.ceil(sz.x / cs), ny = Math.ceil(sz.y / cs), nz = Math.ceil(sz.z / cs);
    const occ = new Uint8Array(nx * ny * nz); const idx = (i, j, k) => (k * ny + j) * nx + i;
    const bins = new Map(); const T = [];
    const A = V(), B = V(), C = V();
    for (let t = 0; t < nt; t++) {
      const ia = I ? I[t * 3] : t * 3, ib = I ? I[t * 3 + 1] : t * 3 + 1, ic = I ? I[t * 3 + 2] : t * 3 + 2; A.fromBufferAttribute(P, ia); B.fromBufferAttribute(P, ib); C.fromBufferAttribute(P, ic);
      const nxv = (B.y - A.y) * (C.z - A.z) - (B.z - A.z) * (C.y - A.y); if (Math.abs(nxv) < 1e-12) continue; T.push([A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z, Math.sign(nxv)]); const ti = T.length - 1;
      const j0 = Math.max(0, Math.ceil((Math.min(A.y, B.y, C.y) - bb.min.y) / cs - .5)), j1 = Math.min(ny - 1, Math.floor((Math.max(A.y, B.y, C.y) - bb.min.y) / cs - .5));
      const k0 = Math.max(0, Math.ceil((Math.min(A.z, B.z, C.z) - bb.min.z) / cs - .5)), k1 = Math.min(nz - 1, Math.floor((Math.max(A.z, B.z, C.z) - bb.min.z) / cs - .5));
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) { const kk = k * ny + j; let a = bins.get(kk); if (!a) bins.set(kk, a = []); a.push(ti); }
    }
    for (const [kk, list] of bins) {
      const j = kk % ny, k = (kk - j) / ny; const y = bb.min.y + (j + .5) * cs, z = bb.min.z + (k + .5) * cs; const hits = [];
      for (const ti of list) {
        const t = T[ti]; const d = (t[4] - t[1]) * (t[8] - t[2]) - (t[5] - t[2]) * (t[7] - t[1]); if (Math.abs(d) < 1e-14) continue;
        const u = ((y - t[1]) * (t[8] - t[2]) - (z - t[2]) * (t[7] - t[1])) / d, v = ((t[4] - t[1]) * (z - t[2]) - (t[5] - t[2]) * (y - t[1])) / d; if (u < 0 || v < 0 || u + v > 1) continue;
        hits.push([t[0] + u * (t[3] - t[0]) + v * (t[6] - t[0]), t[9]]);
      }
      if (hits.length < 2) continue; hits.sort((a, b) => a[0] - b[0]); let w = 0;
      for (let h = 0; h < hits.length - 1; h++) { w += -hits[h][1]; if (w > 0) { const i0 = Math.max(0, Math.ceil((hits[h][0] - bb.min.x) / cs - .5)), i1 = Math.min(nx - 1, Math.floor((hits[h + 1][0] - bb.min.x) / cs - .5)); for (let i = i0; i <= i1; i++) occ[idx(i, j, k)] = 1; } }
    }
    const D = new Uint16Array(nx * ny * nz); let any = 0; for (let q = 0; q < D.length; q++) { D[q] = occ[q] ? 60000 : 0; any += occ[q]; } if (!any) { s.dead = true; return; }
    const W = [[1, 0, 0, 10], [0, 1, 0, 10], [0, 0, 1, 10], [1, 1, 0, 14], [1, -1, 0, 14], [1, 0, 1, 14], [1, 0, -1, 14], [0, 1, 1, 14], [0, 1, -1, 14], [1, 1, 1, 17], [1, 1, -1, 17], [1, -1, 1, 17], [1, -1, -1, 17]];
    for (const dir of [1, -1]) {
      const ks = dir > 0 ? [0, nz, 1] : [nz - 1, -1, -1], js = dir > 0 ? [0, ny, 1] : [ny - 1, -1, -1], is = dir > 0 ? [0, nx, 1] : [nx - 1, -1, -1];
      for (let k = ks[0]; k !== ks[1]; k += ks[2]) for (let j = js[0]; j !== js[1]; j += js[2]) for (let i = is[0]; i !== is[1]; i += is[2]) {
        const q = idx(i, j, k); if (!D[q]) continue; let m = D[q];
        for (const [a, b, c, wt] of W) { const ii = i - dir * c, jj = j - dir * b, kk2 = k - dir * a; if (ii < 0 || jj < 0 || kk2 < 0 || ii >= nx || jj >= ny || kk2 >= nz) { m = Math.min(m, wt); continue; } const v = D[idx(ii, jj, kk2)] + wt; if (v < m) m = v; }
        D[q] = m;
      }
    }
    Object.assign(s, { bmin: bb.min.clone(), cs, nx, ny, nz, D });
  }

  // ---------- spatial hash ----------
  const CS = .4; const G = new Map(); const key = (i, j, k) => ((i + 2048) * 4096 + (j + 2048)) * 4096 + (k + 2048);
  const corners = (s, pad) => { const mn = V(1e9, 1e9, 1e9), mx = V(-1e9, -1e9, -1e9); for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) { const p = s.c.clone().addScaledVector(s.ax[0], sx * s.h[0]).addScaledVector(s.ax[1], sy * s.h[1]).addScaledVector(s.ax[2], sz * s.h[2]); mn.min(p); mx.max(p); } mn.subScalar(pad); mx.addScalar(pad); return [mn, mx]; };
  function hashIn(s, n) {
    const [mn, mx] = corners(s, s.inst >= 0 ? .02 : .25);
    // guard: nothing in the house spans more than ~12 m; a sky dome, a NaN or a degenerate matrix would flood the hash
    if (![mn.x, mn.y, mn.z, mx.x, mx.y, mx.z].every(Number.isFinite) || mx.x - mn.x > 12 || mx.y - mn.y > 12 || mx.z - mn.z > 12) { s.off = true; s.dead = true; skipped['huge ' + s.name] = 1; return; }
    for (let i = Math.floor(mn.x / CS); i <= Math.floor(mx.x / CS); i++) for (let j = Math.floor(mn.y / CS); j <= Math.floor(mx.y / CS); j++) for (let k = Math.floor(mn.z / CS); k <= Math.floor(mx.z / CS); k++) { const kk = key(i, j, k); let a = G.get(kk); if (!a) G.set(kk, a = []); if (!a.includes(n)) a.push(n); }
  }
  S.forEach(hashIn);
  // moving things (hatch lid, oven door, book, tools): every half second re-read their matrices; one that moved is hashed
  // into the cells it now covers (old cells keep a harmless stale entry: the depth test uses the real pose)
  const MOV = S.map((s, n) => n).filter(n => S[n].inst < 0); let movK = 0;
  function trackMoving() {
    if (++movK % 30) return;
    for (const n of MOV) { const s = S[n], e = s.obj.matrixWorld.elements; let same = true; for (let i = 0; i < 16; i++) if (Math.abs(e[i] - s.m[i]) > 1e-6) { same = false; break; } if (same) continue; s.m.set(e); frameOf(s, s.obj.matrixWorld); hashIn(s, n); }
  }
  // background voxelisation: nearest to the hero first, a few ms per frame
  function buildSome(budgetMs) {
    if (!pending.length) return; const t0 = performance.now(); const hp = root.position;
    pending.sort((a, b) => b.c.distanceToSquared(hp) - a.c.distanceToSquared(hp));
    while (pending.length && performance.now() - t0 < budgetMs) voxelise(pending.pop());
  }

  // ---------- depth of a point inside a shape (>0 inside) and the way out ----------
  const tq = V(), vq = V(); const OUT = { d: 0, n: V() };
  let frameNo = 0;
  function refresh(s) { // follow moving objects; ignore what the hero carries or what is hidden
    if (s.seen === frameNo) return !s.off; s.seen = frameNo;
    const o = s.obj; if (s.inst < 0) { if (mine(o) || !visible(o)) { s.off = true; return false; } } else if (!o.visible) { s.off = true; return false; }
    s.off = false;
    let mw; if (s.inst >= 0) { o.getMatrixAt(s.inst, mi); m4.multiplyMatrices(o.matrixWorld, mi); mw = m4; } else mw = o.matrixWorld;
    const e = mw.elements; let same = true; for (let i = 0; i < 16; i++) if (Math.abs(e[i] - s.m[i]) > 1e-6) { same = false; break; }
    if (!same) { s.m.set(e); frameOf(s, mw); }
    return true;
  }
  function depth(s, p) {
    tq.copy(p).sub(s.c); const x = tq.dot(s.ax[0]), y = tq.dot(s.ax[1]), z = tq.dot(s.ax[2]); const n = OUT.n;
    if (s.kind === 'box') {
      const dx = s.h[0] - Math.abs(x), dy = s.h[1] - Math.abs(y), dz = s.h[2] - Math.abs(z); if (dx <= 0 || dy <= 0 || dz <= 0) return -1;
      if (dx <= dy && dx <= dz) { n.copy(s.ax[0]).multiplyScalar(Math.sign(x) || 1); return dx; }
      if (dy <= dz) { n.copy(s.ax[1]).multiplyScalar(Math.sign(y) || 1); return dy; }
      n.copy(s.ax[2]).multiplyScalar(Math.sign(z) || 1); return dz;
    }
    if (s.kind === 'cyl') {
      const rr = Math.hypot(x, z), dr = s.r - rr, dy = s.h[1] - Math.abs(y); if (dr <= 0 || dy <= 0) return -1;
      if (dy < dr) { n.copy(s.ax[1]).multiplyScalar(Math.sign(y) || 1); return dy; }
      if (rr < 1e-6) n.copy(s.ax[0]); else n.copy(s.ax[0]).multiplyScalar(x / rr).addScaledVector(s.ax[2], z / rr); return dr;
    }
    if (s.kind === 'sph') { const rr = Math.hypot(x, y, z); const d = s.r - rr; if (d <= 0) return -1; if (rr < 1e-6) n.set(0, 1, 0); else n.copy(tq).multiplyScalar(1 / rr); return d; }
    // voxel grid
    if (!s.ready) voxelise(s); if (s.dead) return -1;
    vq.copy(p).applyMatrix4(s.inv); const fi = (vq.x - s.bmin.x) / s.cs, fj = (vq.y - s.bmin.y) / s.cs, fk = (vq.z - s.bmin.z) / s.cs; const i = Math.floor(fi), j = Math.floor(fj), k = Math.floor(fk);
    if (i < 1 || j < 1 || k < 1 || i >= s.nx - 1 || j >= s.ny - 1 || k >= s.nz - 1) return -1;
    const D = s.D, nx = s.nx, ny = s.ny, at = (a, b, c) => D[(c * ny + b) * nx + a]; const d0 = at(i, j, k); if (!d0) return -1;
    const gx = at(i + 1, j, k) - at(i - 1, j, k), gy = at(i, j + 1, k) - at(i, j - 1, k), gz = at(i, j, k + 1) - at(i, j, k - 1);
    // way out = down the distance slope, in world space (local axes scaled by the object)
    n.set(0, 0, 0).addScaledVector(s.ax[0], -gx / s.sc[0]).addScaledVector(s.ax[1], -gy / s.sc[1]).addScaledVector(s.ax[2], -gz / s.sc[2]);
    if (n.lengthSq() < 1e-12) return -1; n.normalize();
    return (d0 / 10 - .5) * s.cs * s.sMin;
  }
  // trunk: bark cross-sections every 10 cm (index.html SL), exact 2D distance to the outline
  function trunkDepth(p) {
    if (!trunk) return -1; const { SL, TAX } = trunk; if (Math.hypot(p.x - TAX[0], p.z - TAX[1]) > 2.4) return -1;
    const s = SL[clamp(Math.round(p.y * 10), 0, SL.length - 1)]; let cr = 0, best = 1e9, bx = 0, bz = 0;
    for (let i = 0; i < s.length; i += 4) {
      const x1 = s[i], z1 = s[i + 1], x2 = s[i + 2], z2 = s[i + 3];
      if ((z1 > p.z) !== (z2 > p.z)) { const xi = x1 + (p.z - z1) / (z2 - z1) * (x2 - x1); if (xi > p.x) cr++; }
      const dx = x2 - x1, dz = z2 - z1, L = dx * dx + dz * dz; let t = L ? ((p.x - x1) * dx + (p.z - z1) * dz) / L : 0; t = clamp(t, 0, 1); const ex = x1 + dx * t - p.x, ez = z1 + dz * t - p.z; const d2 = ex * ex + ez * ez;
      if (d2 < best) { best = d2; bx = ex; bz = ez; }
    }
    if ((cr & 1) !== 1) return -1; const d = Math.sqrt(best); if (d < 1e-6) return -1; OUT.n.set(bx / d, 0, bz / d); return d;
  }
  // deepest shape at p: returns depth beyond the allowance for this body part, OUT.n = way out
  const nB = V();
  function probe(p, part, lying) { const GR = window.__grab;
    const kk = key(Math.floor(p.x / CS), Math.floor(p.y / CS), Math.floor(p.z / CS)); const a = G.get(kk); let best = 0;
    if (a) for (const n of a) {
      const s = S[n]; if (s.dead) continue; if ((part === 1 || part === 2) && GR && GR.held(s.obj)) continue;/* a hand is never pushed out of what it holds (game/grab.js) */ if (!refresh(s)) continue; const d = depth(s, p); if (d <= 0) continue;
      let allow = part === 3 ? ALLOW.feet : ALLOW.hard;
      if (s.cls >= 2) allow = (lying && p.y < root.position.y + .6) ? ALLOW.pillow : ALLOW.soft;
      else if (s.cls === 1 && (part === 4 || part === 5)) allow = ALLOW.seat;
      const ex = d - allow; if (ex > best) { best = ex; nB.copy(OUT.n); }
    }
    const td = trunkDepth(p); if (td - ALLOW.hard > best) { best = td - ALLOW.hard; nB.copy(OUT.n); }
    OUT.n.copy(nB); return best;
  }

  // ---------- body: skin points ----------
  const sk = []; root.traverse(o => { if (o.isSkinnedMesh) sk.push(o); });
  // body part (allowance): 0 head 1 handL 2 handR 3 feet 4 shins 5 hips 6 arms 7 torso; chain: 0 root 1 head 2 armL 3 armR 4 legL 5 legR
  const partOf = n => /Head|Neck/.test(n) ? 0 : /LeftHand|LeftForeArm/.test(n) ? 1 : /RightHand|RightForeArm/.test(n) ? 2 : /Foot|Toe/.test(n) ? 3 : /Leg$/.test(n) ? 4 : /Hips/.test(n) ? 5 : /Arm|Shoulder/.test(n) ? 6 : 7;
  const chainOf = n => /Head|Neck/.test(n) ? 1 : /LeftHand|LeftForeArm/.test(n) ? 2 : /RightHand|RightForeArm/.test(n) ? 3 : /Left(Leg|Foot|Toe)/.test(n) && !/UpLeg/.test(n) ? 4 : /Right(Leg|Foot|Toe)/.test(n) && !/UpLeg/.test(n) ? 5 : 0;
  const PTS = []; // {m: mesh index, b:[4 bone idx], w:[4], v: bind-space pos, part, chain}
  let nVerts = 0; for (const M of sk) nVerts += M.geometry.attributes.position.count;
  const step = Math.max(1, Math.round(nVerts / 1100));
  sk.forEach((M, mIdx) => {
    const g = M.geometry, pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight; const bm = M.bindMatrix;
    for (let i = 0; i < pos.count; i += step) {
      const b = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)], w = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)]; let bi = 0; for (let k = 1; k < 4; k++) if (w[k] > w[bi]) bi = k;
      const bn = M.skeleton.bones[b[bi]].name; const v = V().fromBufferAttribute(pos, i).applyMatrix4(bm);
      PTS.push({ m: mIdx, b, w, v, part: partOf(bn), chain: chainOf(bn), p: V() });
    }
  });
  const KM = sk.map(M => M.skeleton.bones.map(() => new THREE.Matrix4())); const tmpM = new THREE.Matrix4(), base = new THREE.Matrix4();
  function skin() {
    for (let m = 0; m < sk.length; m++) { const M = sk[m]; base.multiplyMatrices(M.matrixWorld, M.bindMatrixInverse); const bs = M.skeleton.bones, inv = M.skeleton.boneInverses;
      for (let i = 0; i < bs.length; i++) KM[m][i].multiplyMatrices(base, tmpM.multiplyMatrices(bs[i].matrixWorld, inv[i])); }
    for (const P of PTS) {
      const K = KM[P.m]; const v = P.v; let x = 0, y = 0, z = 0;
      for (let k = 0; k < 4; k++) { const w = P.w[k]; if (w <= 0) continue; const e = K[P.b[k]].elements; x += w * (e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12]); y += w * (e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13]); z += w * (e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]); }
      P.p.set(x, y, z);
    }
  }

  // ---------- IK helpers ----------
  const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion();
  function turnBone(bone, childPos, goal, w = 1) {
    const bp = bone.getWorldPosition(V()); const v1 = childPos.clone().sub(bp), v2 = goal.clone().sub(bp); if (v1.lengthSq() < 1e-8 || v2.lengthSq() < 1e-8) return; v1.normalize(); v2.normalize();
    const dq = new THREE.Quaternion().setFromUnitVectors(v1, v2); if (w < 1) dq.slerp(new THREE.Quaternion(), 1 - w); bone.getWorldQuaternion(_q); bone.parent.getWorldQuaternion(_pq); bone.quaternion.copy(_pq.invert().multiply(dq.multiply(_q))); bone.updateMatrixWorld(true);
  }
  function ik2(A, Bb, C, target) {
    if (!A || !Bb || !C) return; const endQ = C.getWorldQuaternion(new THREE.Quaternion());
    const a = A.getWorldPosition(V()), b = Bb.getWorldPosition(V()), c = C.getWorldPosition(V()); const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    let pole = b.clone().sub(a.clone().add(c).multiplyScalar(.5)); if (pole.lengthSq() < 1e-8) pole = V(Math.sin(root.rotation.y), 0, Math.cos(root.rotation.y));
    const tv = target.clone().sub(a); const dd = clamp(tv.length(), Math.abs(l1 - l2) + .01, l1 + l2 - 1e-4); /* no forced knee bend on a straight leg (that pops) */ const dir = tv.normalize();
    const ca = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1), sa = Math.sqrt(1 - ca * ca); let pp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))); if (pp.lengthSq() < 1e-8) pp = V(0, 0, 1); pp.normalize();
    const knee = a.clone().addScaledVector(dir, ca * l1).addScaledVector(pp, sa * l1); turnBone(A, b, knee); turnBone(Bb, C.getWorldPosition(V()), a.clone().addScaledVector(dir, dd));
    C.parent.getWorldQuaternion(_pq); C.quaternion.copy(_pq.invert().multiply(endQ)); C.updateMatrixWorld(true);
  }
  const LIMB = [null, null,
    { A: bones.LeftArm, B: bones.LeftForeArm, C: bones.LeftHand }, { A: bones.RightArm, B: bones.RightForeArm, C: bones.RightHand },
    { A: bones.LeftUpLeg, B: bones.LeftLeg, C: bones.LeftFoot }, { A: bones.RightUpLeg, B: bones.RightLeg, C: bones.RightFoot }];
  const SPINE = ['Spine', 'Spine1', 'Spine2', 'Neck'].map(n => bones[n]).filter(Boolean), SPF = [.3, .45, .65, 1];
  function bendHead(delta) { // move the head by delta, shared down the spine
    const Hd = bones.Head; if (!Hd || !SPINE.length) return; const goal = Hd.getWorldPosition(V()).add(delta);
    for (let i = 0; i < SPINE.length; i++) { const h = Hd.getWorldPosition(V()); const rem = goal.clone().sub(h); turnBone(SPINE[i], h, h.clone().addScaledVector(rem, SPF[i])); }
  }

  // ---------- per frame ----------
  const off = { root: V(), head: V(), limb: [null, null, V(), V(), V(), V()] };
  const anim = [null, null, V(), V(), V(), V()]; // animated end-effector positions (after root + head corrections)
  let on = true, applied = V(); const st = { ms: 0, msMax: 0, iters: 0, pushes: 0, frames: 0, worst: 0, floorFix: 0, freed: 0, pts: PTS.length, shapes: S.length, vox: 0, pending: 0 };
  const push = [V(), V(), V(), V(), V(), V()], pd = new Float32Array(6), sumN = [V(), V()], sumW = [0, 0];
  // smoothness: a correction may grow only so fast (m/frame) and speed up only so fast (m/frame per frame); it is held
  // while still needed and released slowly afterwards, so push / release never alternate (no jitter, no pops)
  const MAXS = [.005, .02, .025, .025, .03, .03], ACC = [.0012, .01, .014, .014, .03, .03];
  const grow = new Float32Array(6), lastGrow = new Float32Array(6), hold = new Float32Array(6);
  const budget = c => Math.max(0, Math.min(MAXS[c], lastGrow[c] + ACC[c]) - grow[c]);
  const take = (c, v) => { const L = v.length(), b = budget(c); if (L > b) v.multiplyScalar(b / Math.max(L, 1e-9)); grow[c] += Math.min(L, b); return v; };
  // the floor: the top of the house boards under a point (instanced boards and beams only, lying flat)
  const fq = V();
  function boardTop(x, y, z, up = .45, down = .05) {
    let best = null; for (const yy of [y - down, y + up * .5, y + up]) { fq.set(x, yy, z); const a = G.get(key(Math.floor(x / CS), Math.floor(yy / CS), Math.floor(z / CS))); if (!a) continue;
      for (const n of a) { const s = S[n]; if (s.inst < 0 || s.kind !== 'box') continue; if (!refresh(s)) continue; let u = 0; for (let k = 1; k < 3; k++) if (Math.abs(s.ax[k].y) > Math.abs(s.ax[u].y)) u = k; if (Math.abs(s.ax[u].y) < .97) continue;
        const a1 = (u + 1) % 3, a2 = (u + 2) % 3; const dx = x - s.c.x, dz = z - s.c.z; const l1 = dx * s.ax[a1].x + dz * s.ax[a1].z, l2 = dx * s.ax[a2].x + dz * s.ax[a2].z; if (Math.abs(l1) > s.h[a1] || Math.abs(l2) > s.h[a2]) continue; if (Math.min(s.h[a1], s.h[a2]) < .06) continue; // rungs and rails are not floor
        const top = s.c.y + s.h[u] * Math.abs(s.ax[u].y) + (l1 * s.ax[a1].y + l2 * s.ax[a2].y); if (top < y - down || top > y + up) continue; if (best == null || top > best) best = top; } }
    return best;
  }
  let guardV = 0, guardT = 0, prevGap = 0;
  function floorGuard(dt) { if (window.__colOff && window.__colOff.floor) return; // the root never stands below the boards (hero.js only climbs back up from 12 cm)
    if (!hero.ground || hero.fit || hero.lad || hero.swing || hero.inBed || (hero.path[0] && hero.path[0].t === 'ladder')) return; const p = root.position; if (p.y < 1.5) return; /* house floors only: on the ground hero.js follows the terrain */ const top = boardTop(p.x, p.y, p.z); if (top == null) return;
    const gap = top - p.y; if (gap <= .004) { guardV = 0; guardT = 0; prevGap = 0; return; }
    // hero.js climbs back onto the boards itself in most cases: step in only when he stays under them (0.4 s without rising)
    if (!guardV) { guardT = (prevGap - gap > .002) ? 0 : guardT + dt; prevGap = gap; if (guardT < .4) return; } guardV = Math.min(guardV + .004, .03); const k = Math.min(gap, guardV); p.y += k; hero.floorY = top; st.floorFix++; root.updateMatrixWorld(true);
  }
  function pre() { if (applied.lengthSq() > 0) { root.position.sub(applied); applied.set(0, 0, 0); } }
  function post(dt) {
    if (!on || dt <= 0) return; const t0 = performance.now(); frameNo++;
    buildSome(1.5); trackMoving();
    floorGuard(dt);
    const rel = Math.exp(-dt * 2.5), relFoot = Math.exp(-dt * 14);// feet: a lift lasts only while the sole touches (each step is a new contact)// release of a correction once it is no longer needed (~0.4 s)
    for (let c = 0; c < 6; c++) { hold[c] = Math.max(0, hold[c] - dt); lastGrow[c] = grow[c]; grow[c] = 0; }
    { const GR = window.__grab; if (GR) for (const c of [2, 3]) if (GR.grip[c === 2 ? 'Left' : 'Right']) { off.limb[c].set(0, 0, 0); hold[c] = 0; } }// a gripping hand stays on its handle (game/grab.js)
    if (!hold[0]) off.root.multiplyScalar(rel); if (!hold[1]) off.head.multiplyScalar(rel); for (let c = 2; c < 6; c++) if (!hold[c]) off.limb[c].multiplyScalar(c >= 4 ? relFoot : rel);
    const fit = !!hero.fit, lying = !!(hero.inBed || hero.swing);
    root.position.add(off.root); applied.copy(off.root); root.updateMatrixWorld(true);
    if (off.head.lengthSq() > 1e-8) bendHead(off.head);
    for (let c = 2; c < 6; c++) { const L = LIMB[c]; if (!L.C) continue; L.C.getWorldPosition(anim[c]); if (off.limb[c].lengthSq() > 1e-8) ik2(L.A, L.B, L.C, anim[c].clone().add(off.limb[c])); }
    let it = 0, worst = 0;
    for (; it < 4; it++) {
      skin(); pd.fill(0); let anyP = false; sumN[0].set(0, 0, 0); sumN[1].set(0, 0, 0); sumW[0] = sumW[1] = 0;
      for (const P of PTS) {
        const ex = probe(P.p, P.part, lying); if (ex <= 0) continue; if (it === 0 && ex > worst) worst = ex;
        anyP = true;
        // body and head: the excess-weighted mean way out (contacts on opposite sides cancel instead of bouncing between them);
        // a shin or foot caught at the side (bed rail, bench) also moves the body away, like a step aside
        const tc = P.chain;
        if (tc <= 1) { sumN[tc].addScaledVector(OUT.n, ex); sumW[tc] += ex; if (ex > pd[tc]) pd[tc] = ex; }
        // legs: only lift a foot / shin out of what is under it; a sideways nudge of a planted foot is a visible slide
        if (P.chain >= 4 && OUT.n.y < .5) continue;
        if (P.chain >= 2 && ex > pd[P.chain]) { pd[P.chain] = ex; push[P.chain].copy(OUT.n).multiplyScalar(ex + .001); if (P.chain >= 4 && OUT.n.y >= .5) { push[P.chain].x = push[P.chain].z = 0; push[P.chain].y = (ex + .001) / Math.max(.5, OUT.n.y); } }
      }
      // on a ladder only hands and feet are corrected (moving the body or bending the head pops on the pull-up)
      if (hero.lad) { pd[0] = 0; pd[1] = 0; anyP = pd.some(v => v > 0); }
      for (const c of [0, 1]) if (sumW[c] > 0) push[c].copy(sumN[c]).multiplyScalar(1 / sumW[c]).multiplyScalar(pd[c] + .001);
      // while walking the gait belongs to hero.js / motion matching: no body shove (it reads as a surge or a stall); a sole is
      // only lifted straight up out of a board (never moved sideways); arms and head give way. Walking into things is the walk graph's job.
      if (hero.path && hero.path.length && !hero.lad) { pd[0] = 0; anyP = pd.some(v => v > 0); }
      { const X = window.__colOff; if (X) { if (X.root) pd[0] = 0; if (X.head) pd[1] = 0; if (X.arms) pd[2] = pd[3] = 0; if (X.legs) pd[4] = pd[5] = 0; anyP = pd.some(v => v > 0); } }
      if (!anyP) break; st.pushes++; for (let c = 0; c < 6; c++) if (pd[c] > 0) hold[c] = c >= 4 ? 0 : .35;
      // root: sideways (and up while seated / lying); a push straight down or up while standing goes to the head / spine instead
      if (pd[0] > 0) {
        // the body itself moves only for a real contact, sideways, at most 0.3 m/s, and stays where it was pushed (no offset
        // that is released later: nothing surges while he walks freely); never while seated, lying or on a ladder
        const pr = push[0].clone(); pr.y = 0; const hl = Math.hypot(pr.x, pr.z);
        if (!fit && !lying && hl > .25 * pd[0]) { take(0, pr); if (pr.lengthSq() > 1e-10) { root.position.add(pr); root.updateMatrixWorld(true); for (let c = 2; c < 6; c++) anim[c].add(pr); } }
        else if (pd[1] < pd[0]) { pd[1] = pd[0]; push[1].copy(push[0]); }
      }
      if (pd[1] > 0) {
        const d = take(1, push[1].clone()); const carry = [2, 3].map(c => LIMB[c].C ? LIMB[c].C.getWorldPosition(V()) : null);
        bendHead(d); off.head.add(d); if (off.head.length() > .12) off.head.setLength(.12);
        [2, 3].forEach((c, i) => { if (carry[i]) anim[c].add(LIMB[c].C.getWorldPosition(V()).sub(carry[i])); });
      }
      for (let c = 2; c < 6; c++) { if (pd[c] <= 0) continue; const L = LIMB[c]; if (!L.C) continue; const d = take(c, push[c].clone()); if (d.lengthSq() < 1e-10) continue; off.limb[c].add(d); ik2(L.A, L.B, L.C, anim[c].clone().add(off.limb[c])); }
    }
    const ms = performance.now() - t0; st.frames++; st.ms += (ms - st.ms) * .02; st.msMax = Math.max(st.msMax * .995, ms); st.iters = it; st.worst = Math.max(st.worst * .999, worst); st.vox = S.filter(s => s.kind === 'vox' && s.ready).length; st.pending = pending.length;
  }
  // wrap the hero's update: corrections go on after hero.js has posed the body, and come off before it runs again
  const upd = HH.update; HH.update = dt => { pre(); upd(dt); post(dt); };

  // ---------- nav: clearance of the walk graph for the body (a 0.2 m wide column from knee to head height) ----------
  function clearance(x, y, z, r = .2) { let worst = 0; const p = V(); for (const hy of [.35, .7, 1.0, 1.3]) for (let a = 0; a < 8; a++) { p.set(x + Math.cos(a * Math.PI / 4) * r, y + hy, z + Math.sin(a * Math.PI / 4) * r); const d = probe(p, 7, false); if (d > worst) worst = d; } return worst; }
  function navReport(r = .2) {
    const bad = []; for (const [a, b, t] of HH.E) { if (t === 'ladder') continue; const A = HH.N[a].p, B = HH.N[b].p; for (let k = 0; k <= 12; k++) { const q = A.clone().lerp(B, k / 12); const d = clearance(q.x, q.y, q.z, r); if (d > .01) { bad.push([a + '-' + b, k, +(d * 100).toFixed(1)]); break; } } }
    return bad;
  }

  // nodes of the walk graph that stand too close to something solid move to the nearest spot with room for the body
  // (not ladder ends, seats or the tight approach spots: hero.js aligns those to the furniture itself)
  const navMoved = [];
  { const lad = new Set(); for (const [a, b, t] of HH.E) if (t === 'ladder') { lad.add(a); lad.add(b); }
    for (const k in HH.N) { const n = HH.N[k]; if (lad.has(k) || n.sit || n.seat != null || n.tight) continue; const p = n.p; if (clearance(p.x, p.y, p.z) <= .003) continue;
      let best = null; for (let r = .03; r <= .3 && !best; r += .03) for (let a = 0; a < 16; a++) { const x = p.x + Math.cos(a * Math.PI / 8) * r, z = p.z + Math.sin(a * Math.PI / 8) * r; if (clearance(x, p.y, z) <= .003) { best = [x, z]; break; } }
      if (best) { navMoved.push([k, +(best[0] - p.x).toFixed(3), +(best[1] - p.z).toFixed(3)]); p.x = best[0]; p.z = best[1]; } } }
  // free(p): move a standing / walking spot (root on the floor) to the nearest place where the body has room:
  // legs, swinging arms and head clear of everything solid. hero.js calls it from pushOut (walking, approaching a job).
  const RAD = [[.35, .17], [.7, .22], [.95, .26], [1.25, .23]], fp = V();
  function room(x, y, z) { let worst = 0; for (const [hy, r] of RAD) for (let a = 0; a < 12; a++) { fp.set(x + Math.cos(a * Math.PI / 6) * r, y + hy, z + Math.sin(a * Math.PI / 6) * r); const d = probe(fp, 7, false); if (d > worst) { worst = d; if (worst > .02) return worst; } } return worst; }
  const freeC = { x: 1e9, y: 0, z: 0, ox: 0, oz: 0 };
  function free(p) {
    if (!on) return p; if (Math.abs(p.x - freeC.x) < .015 && Math.abs(p.z - freeC.z) < .015 && Math.abs(p.y - freeC.y) < .05) { p.x += freeC.ox; p.z += freeC.oz; return p; }
    freeC.x = p.x; freeC.y = p.y; freeC.z = p.z; freeC.ox = freeC.oz = 0;
    if (room(p.x, p.y, p.z) <= .004) return p;
    for (let r = .04; r <= .3; r += .04) for (let a = 0; a < 12; a++) { const x = p.x + Math.cos(a * Math.PI / 6) * r, z = p.z + Math.sin(a * Math.PI / 6) * r; if (room(x, p.y, z) <= .004) { freeC.ox = x - p.x; freeC.oz = z - p.z; p.x = x; p.z = z; st.freed++; return p; } }
    return p;
  }
  const api = { stats: () => ({ ...st, ms: +st.ms.toFixed(3), msMax: +st.msMax.toFixed(3), worst: +(st.worst * 100).toFixed(2) }), enable: v => { on = !!v; if (!on) { pre(); off.root.set(0, 0, 0); off.head.set(0, 0, 0); for (let c = 2; c < 6; c++) off.limb[c].set(0, 0, 0); } }, shapes: S, skipped,
    depthAt: (x, y, z) => probe(V(x, y, z), 7, false), navReport, clearance, navMoved, free, room, buildAll: () => buildSome(1e9) };
  return api;
}
