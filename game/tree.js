// The giant oak, built in code so it fits the house exactly (no bark poking through walls).
// Trunk with flowing vertical ridges and root buttresses, big roots, side branches, crown limbs,
// a glowing hollow in the trunk, and oak-leaf clumps made of a few hundred painted cards.
// Everything is a handful of meshes: cheap on phones, easy to port (plain vertex/index buffers).
//
// buildTree(THREE, {barkT, leafT, MOBILE, avoid, avoidLeaves, door}) -> {group, bark, leaves, tris, axis}
//   avoid:        [[x0,x1,y0,y1,z0,z1],...] room volumes the wood must stay out of (front side is open)
//   avoidLeaves:  boxes the leaf cards must stay out of
//   door:         {x, y0, y1, w, depth} the glowing hollow at the trunk base
//   tris:         flat world-space triangle list (x,y,z * 9 per tri) for the physics mesh and plank cutting

export const TREE_AXIS = [0, -0.6];

export function buildTree(THREE, o) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const AX = TREE_AXIS[0], AZ = TREE_AXIS[1];
  let seed = 7; const rnd = (a, b) => { seed = (seed * 16807) % 2147483647; return a + (b - a) * (seed / 2147483647); };
  const group = new THREE.Group();

  // ---------- generic tube with a radius function and parallel-transport frames ----------
  // rf(t, ang, p) -> radius;  ang = world angle of the outward direction in xz (for ridges)
  function tube(pts, nT, nR, rf, opt = {}) {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const frames = curve.computeFrenetFrames(nT, false);
    const len = curve.getLength();
    const P = [], N = [], UV = [], G = [], I = [], H = [];
    const circ = rf(0, 0, pts[0]) * 2 * Math.PI;
    const uRep = Math.max(1, Math.round(circ / (opt.tile || 1.7)));
    for (let i = 0; i <= nT; i++) {
      const t = i / nT, c = curve.getPointAt(t), T = frames.tangents[i], Nn = frames.normals[i], Bn = frames.binormals[i];
      for (let j = 0; j <= nR; j++) {
        const a = j / nR * Math.PI * 2;
        const d = Nn.clone().multiplyScalar(Math.cos(a)).addScaledVector(Bn, Math.sin(a));
        if (opt.flat) d.y *= opt.flat;
        const ang = Math.atan2(d.z, d.x);
        const r = rf(t, ang, c, d);
        const p = c.clone().addScaledVector(d, r);
        P.push(p.x, p.y, p.z); UV.push(j / nR * uRep, t * len / (opt.tile || 1.7)); G.push(opt.glow ? opt.glow(p, t, ang) : 0); H.push(opt.hole && opt.hole(c, ang) ? 1 : 0);
      }
    }
    for (let i = 0; i < nT; i++) for (let j = 0; j < nR; j++) {
      const a = i * (nR + 1) + j, b = a + nR + 1;
      if (!(H[a] && H[b] && H[a + 1])) I.push(a, b, a + 1);
      if (!(H[b] && H[b + 1] && H[a + 1])) I.push(b, b + 1, a + 1);
    }
    return { P, UV, G, I };
  }

  // ---------- the trunk ----------
  const rootAng = [0.35, 0.95, 2.2, 2.75, 3.6, 4.35, 5.2, 5.85];
  const door = o.door;
  const doorAng = door.ang ?? Math.atan2(1.0, door.x - AX); // aim the hollow at the front-right
  let ARCH = null; // the carved opening (model trunk): cut per pixel in the bark shader so its edge is a clean arch
  let R = y => {
    let r = 2.0 + 1.35 * Math.exp(-Math.max(y, 0) / 0.95);
    if (y > 3) r -= 0.03 * (y - 3);
    if (y > 10.5) r -= 0.12 * (y - 10.5);
    return r;
  };
  const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  function doorMask(ang, y) {
    const half = door.w / 2 / R(y);
    const da = Math.abs(angDiff(ang, doorAng)) / half;
    const yc = (door.y0 + door.y1) / 2, hy = (door.y1 - door.y0) / 2;
    let vy = (y - door.y0) / (door.y1 - door.y0);
    // arch: full width below 65% height, round top above
    let inside;
    if (vy < 0 || vy > 1) inside = 99; else if (vy < 0.62) inside = da; else { const k = (vy - 0.62) / 0.38; inside = Math.hypot(da, k * 1.05); }
    return inside;
  }
  const trunkR = (t, ang, c) => {
    const y = c.y;
    let r = R(y);
    // root buttresses flare out towards the big roots
    const A = 0.55 * Math.exp(-Math.max(y, 0) / 1.25);
    let lob = 0; for (const a of rootAng) lob += Math.pow(Math.max(0, Math.cos(angDiff(ang, a))), 10);
    r *= 1 + A * lob;
    // flowing vertical ridges (like the painted oak), slowly winding up the trunk
    // big rounded ridges like the painted oak: smooth bulges with narrow grooves between them
    const w = 0.35 * Math.sin(y * 0.45) + y * 0.05;
    const rid = (a, k) => Math.pow(0.5 + 0.5 * Math.sin(a), k);
    r *= 1 + 0.085 * rid(8 * ang + w * 3, 0.6) + 0.035 * rid(15 * ang - w * 2 + 1.3, 0.8) + 0.04 * Math.sin(3 * ang + y * 0.6) - 0.06;
    // the hollow: pushed in deep behind an arched opening with a thick bark lip
    const m = doorMask(ang, y);
    if (m >= 0.9 && m < 1.4) r += 0.12 * Math.sin((m - 0.9) / 0.5 * Math.PI);
    return r;
  };
  const trunkPts = []; for (let y = -0.6; y <= 14.6; y += 0.6) trunkPts.push(V(AX + 0.12 * Math.sin(y * 0.33), y, AZ + 0.1 * Math.sin(y * 0.27 + 1)));
  const parts = [];
  parts.push(tube(trunkPts, MOB(o) ? 110 : 150, MOB(o) ? 72 : 96, trunkR, { tile: 3.2, hole: (c, ang) => doorMask(ang, c.y) < 0.97, glow: (p, t, ang) => { const m = doorMask(ang, p.y); return m < 1.5 ? Math.max(0, 1 - (m - 0.9) / 0.6) * 0.5 : 0; } }));

  // ---------- roots: spread over the ground, sinking into it ----------
  const roots = [[0.35, 6.5], [0.95, 5.2], [2.2, 5.6], [2.75, 7.0], [3.6, 5.0], [4.35, 6.0], [5.2, 5.4], [5.85, 6.2]];
  for (const [a, L] of roots) {
    const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
    const r0 = R(0.5) * 0.85;
    const wig = rnd(-0.6, 0.6);
    const pts = [V(AX + dx * r0 * 0.6, 2.0, AZ + dz * r0 * 0.6), V(AX + dx * (r0 + 0.4), 1.05, AZ + dz * (r0 + 0.4)),
      V(AX + dx * (r0 + L * 0.35) + sx * wig * 0.5, 0.55, AZ + dz * (r0 + L * 0.35) + sz * wig * 0.5),
      V(AX + dx * (r0 + L * 0.7) + sx * wig, 0.22, AZ + dz * (r0 + L * 0.7) + sz * wig),
      V(AX + dx * (r0 + L) + sx * wig * 0.6, -0.35, AZ + dz * (r0 + L) + sz * wig * 0.6)];
    parts.push(tube(pts, 34, 18, (t, ang) => (1.15 * Math.pow(1 - t, 1.2) + 0.1) * (1 + 0.06 * Math.sin(ang * 5 + t * 9)), { tile: 1.4, flat: 0.72 }));
  }

  // ---------- branches: all leave from the back half of the trunk so they pass behind the rooms ----------
  const BR = [
    // branches traced from the photo (heights in metres, the house levels match the photo):
    // left low S-curve under the kitchen, left behind the bedroom, left high; the same three on the right
    { p: [[-0.5, 6.2, -1.0], [-2.8, 5.4, -1.4], [-5.2, 5.6, -1.6], [-7.4, 6.8, -1.3], [-9.6, 8.2, -0.8]], r0: 0.82, r1: 0.14, leaf: [1, 3, 3] },
    { p: [[-0.3, 10.4, -1.0], [-2.6, 10.8, -1.6], [-5.0, 10.2, -1.6], [-7.6, 11.0, -1.0], [-9.8, 12.4, -0.5]], r0: 0.72, r1: 0.12, leaf: [1, 3, 3] },
    { p: [[-0.4, 13.0, -0.8], [-2.2, 14.4, -1.0], [-4.4, 15.4, -1.0], [-6.8, 16.4, -0.5]], r0: 0.9, r1: 0.16, leaf: [1, 3, 3] },
    { p: [[0.5, 5.4, -1.0], [2.8, 5.0, -1.5], [5.2, 5.2, -1.4], [7.4, 6.2, -0.9], [9.6, 7.6, -0.4]], r0: 0.78, r1: 0.13, leaf: [1, 3, 3] },
    { p: [[0.5, 9.4, -1.0], [3.0, 9.2, -1.4], [5.4, 9.8, -1.2], [7.8, 11.0, -0.7], [9.8, 12.2, -0.3]], r0: 0.72, r1: 0.12, leaf: [1, 3, 3] },
    { p: [[0.4, 13.2, -0.8], [2.0, 14.6, -1.0], [3.8, 16.0, -1.2], [5.6, 17.4, -0.8]], r0: 0.9, r1: 0.16, leaf: [1, 3, 3] },
    // the trunk forks at the top into two thick limbs
    { p: [[0, 14.0, -0.7], [-0.6, 16.2, -0.9], [-1.4, 18.2, -1.2]], r0: 1.1, r1: 0.3, leaf: [1, 2] },
    { p: [[0.1, 14.0, -0.7], [0.9, 16.4, -0.6], [1.8, 18.6, -1.0]], r0: 1.0, r1: 0.28, leaf: [1, 2] },
    // a couple of small branches reaching to the back, so the tree is round from every side
    { p: [[0, 8.5, -1.4], [-0.6, 9.6, -3.8], [-1.0, 11.2, -6.0]], r0: 0.45, r1: 0.1, leaf: [1, 2] },
    { p: [[0.3, 6, -1.4], [1.6, 6.6, -3.8], [2.6, 8, -6.0]], r0: 0.45, r1: 0.1, leaf: [1, 2] }
  ];
  const leafSpots = [];
  for (const b of BR) {
    const pts = b.p.map(q => V(q[0], q[1], q[2]));
    parts.push(tube(pts, 30, MOB(o) ? 14 : 18, (t, ang) => {
      let r = b.r0 + (b.r1 - b.r0) * Math.pow(t, 0.8);
      r *= 1 + 0.35 * Math.exp(-t * 14); // flare where it grows out of the trunk
      return r * (1 + 0.05 * Math.sin(ang * 7 + t * 12));
    }, { tile: 1.5 }));
    // leaves only at the branch tips (the photo shows bare limbs against the sky, foliage at the ends)
    const curve = new THREE.CatmullRomCurve3(pts);
    leafSpots.push({ p: curve.getPointAt(1), s: b.tip || 2.5 });
    if (b.leaf.length >= 3) leafSpots.push({ p: curve.getPointAt(0.78), s: 1.7 });
  }
  // the crown: a few big clumps high up, with gaps between them
  for (const [x, y, z, s] of [[-3.4, 18.6, -1.6, 2.8], [0.6, 19.8, -2.6, 3.0], [3.6, 18.4, -1.4, 2.7], [-1.2, 20.4, 0.4, 2.4], [5.6, 16.4, -0.6, 2.2], [-6.0, 16.8, -0.6, 2.2], [1.8, 17.6, 1.2, 2.0]])
    leafSpots.push({ p: V(AX + x, y, AZ + z), s });

  // ---------- merge, keep the wood out of the rooms ----------
  const P = [], UV = [], G = [], I = [];
  for (const p of parts) { const off = P.length / 3; P.push(...p.P); UV.push(...p.UV); G.push(...p.G); for (const i of p.I) I.push(i + off); }
  let modelMap = null;
  if (o.model) {
    // ---------- sculpted oak from the photo (Fal: photo -> bare tree picture -> Meshy image-to-3D) ----------
    // scaled so the trunk is as thick as in the photo, roots sunk into the ground, axis on TREE_AXIS
    o.model.updateMatrixWorld(true);
    let src = null; o.model.traverse(m => { if (m.isMesh && !src) src = m; });
    const sg = src.geometry.clone(); sg.applyMatrix4(src.matrixWorld);
    modelMap = src.material.map || null;
    const sp = sg.attributes.position, su = sg.attributes.uv, si = sg.index;
    let y0 = 1e9, y1 = -1e9; for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const H = y1 - y0; let cx = 0, cz = 0, cn = 0;
    for (let i = 0; i < sp.count; i++) { const t = (sp.getY(i) - y0) / H; if (t > 0.12 && t < 0.24) { cx += sp.getX(i); cz += sp.getZ(i); cn++; } }
    cx /= cn; cz /= cn; let rr = 0, rn = 0;
    for (let i = 0; i < sp.count; i++) { const t = (sp.getY(i) - y0) / H; if (t > 0.12 && t < 0.24) { const d = Math.hypot(sp.getX(i) - cx, sp.getZ(i) - cz); if (d < H * 0.25) { rr += d; rn++; } } }
    rr /= rn; const k = (o.height || 18) / H; const _k = k, ry = o.modelRot || 0, cr = Math.cos(ry), sr = Math.sin(ry);
    parts.length = 0; P.length = 0; UV.length = 0; G.length = 0; I.length = 0; leafSpots.length = 0;
    for (let i = 0; i < sp.count; i++) {
      const x = (sp.getX(i) - cx) * k * (o.widen || 1.3), z = (sp.getZ(i) - cz) * k * (o.widen || 1.3);
      // roots like the photo: long, clearly visible forms spreading over the ground (the model's are short and sink in)
      const yy = (sp.getY(i) - y0) * k - (o.sink ?? 0.15), t = Math.min(1, Math.max(0, (1.9 - yy) / 1.9)), sp2 = 1 + 0.55 * t * t * (3 - 2 * t);
      P.push(AX + (x * cr + z * sr) * sp2, yy + (t > 0.8 ? -0.12 * (t - 0.8) / 0.2 * 0 : 0), AZ + (-x * sr + z * cr) * sp2);
      UV.push(su ? su.getX(i) : 0, su ? su.getY(i) : 0); G.push(0);
    }
    // trunk radius along the hollow's direction, measured from the mesh (for the hollow, the cave and the door light)
    const Rt = new Float32Array(260);
    for (let i = 0; i < P.length; i += 3) { const dx = P[i] - AX, dz = P[i + 2] - AZ, d = Math.hypot(dx, dz); if (d > 4.5) continue; if (Math.abs(angDiff(Math.atan2(dz, dx), doorAng)) > 0.3) continue; const b = Math.round(P[i + 1] * 10); if (b >= 0 && b < 260) Rt[b] = Math.max(Rt[b], d); }
    for (let b = 1; b < 260; b++) if (!Rt[b]) Rt[b] = Rt[b - 1]; for (let b = 258; b >= 0; b--) if (!Rt[b]) Rt[b] = Rt[b + 1];
    const Rs = Float32Array.from(Rt, (v, b) => { let a = 0, n = 0; for (let j = -3; j <= 3; j++) { const q = Rt[Math.min(259, Math.max(0, b + j))]; if (q) { a += q; n++; } } return n ? a / n : 1.5; });
    R = y => Rs[Math.min(259, Math.max(0, Math.round(y * 10)))];
    // around the hollow, measure the real front surface with rays so the opening and the cave sit in the bark
    {
      const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      const tri = []; const n3 = si ? si.count : sp.count; for (let t = 0; t < n3; t++) tri.push(si ? si.getX(t) : t); tg.setIndex(tri);
      const tm = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); const rc = new THREE.Raycaster();
      const dx = Math.cos(doorAng), dz = Math.sin(doorAng);
      for (let b = Math.round((door.y0 - 0.6) * 10); b <= Math.round((door.y1 + 0.6) * 10); b++) {
        const y = b / 10; rc.set(V(AX + dx * 9, y, AZ + dz * 9), V(-dx, 0, -dz)); rc.far = 9;
        const h = rc.intersectObject(tm, false).find(q => 9 - q.distance < 3.2); if (h) Rs[b] = 9 - h.distance;
      }
      const lo = Math.round((door.y0 - 0.6) * 10), hi = Math.round((door.y1 + 0.6) * 10), cp = Rs.slice();
      for (let b = lo; b <= hi; b++) { let a = 0, n = 0; for (let j = -2; j <= 2; j++) { a += cp[Math.min(259, Math.max(0, b + j))]; n++; } Rs[b] = a / n; }
      tg.dispose();
    }
    // carve the arched hollow: a tunnel from the cave (just inside the bark) out through anything in front of it
    const ddx = Math.cos(doorAng), ddz = Math.sin(doorAng), cdist = R((door.y0 + door.y1) / 2) - 1.13;
    const ccx = AX + ddx * cdist, ccz = AZ + ddz * cdist;
    // the thinnest bark beside the opening: the cave is clipped to it so its shell never shows through the side of the trunk
    let rs = 9; for (let i = 0; i < P.length; i += 3) { const y = P[i + 1]; if (y < door.y0 - 0.1 || y > door.y1 + 0.5) continue;
      const dx = P[i] - AX, dz = P[i + 2] - AZ, ad = Math.abs(angDiff(Math.atan2(dz, dx), doorAng)); if (ad < 0.3 || ad > 1.6) continue; rs = Math.min(rs, Math.hypot(dx, dz)); }
    ARCH = { cx: ccx, cz: ccz, dx: ddx, dz: ddz, rs: rs < 9 ? rs : 0 };
    const arch = (x, y, z) => {
      const rx = x - ccx, rz = z - ccz, u = rx * ddx + rz * ddz, v = -rx * ddz + rz * ddx;
      if (u < 0.2 || u > 3) return 99;
      const da = Math.abs(v) / (door.w / 2), vy = (y - door.y0) / (door.y1 - door.y0);
      if (vy < 0 || vy > 1) return 99; if (vy < 0.62) return da; return Math.hypot(da, (vy - 0.62) / 0.38 * 1.05);
    };
    for (let i = 0; i < P.length / 3; i++) { const m = arch(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (m < 1.5 && m > 0.9) G[i] = (1 - (m - 0.9) / 0.6) * 0.5; }
    const n3 = si ? si.count : sp.count;
    for (let t = 0; t < n3; t += 3) {
      const a = si ? si.getX(t) : t, b = si ? si.getX(t + 1) : t + 1, c = si ? si.getX(t + 2) : t + 2;
      // drop only triangles wholly inside the opening; the bark shader trims the rest along the exact arch, so the
      // edge is a clean curve instead of broken triangles (critic N4)
      const m = Math.max(arch(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), arch(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), arch(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]));
      if (m < 1.0) continue; I.push(a, b, c);
    }
    // leaves: clumps at the limb tips and a crown at the top, with gaps between them
    const cand = [];
    for (let i = 0; i < P.length; i += 3) { const d = Math.hypot(P[i] - AX, P[i + 2] - AZ), y = P[i + 1]; if ((d > 3.6 && y > 4.5 && (Math.abs(P[i] - AX) > 3 || y > 15)) || y > 15.5) cand.push([P[i], y, P[i + 2], d + y * 0.35]); }
    cand.sort((a, b) => b[3] - a[3]);
    const picked = [];
    for (const c of cand) { if (picked.length >= (o.leafClumps || 24)) break; if (picked.some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 2.8)) continue; picked.push(c); }
    for (const c of picked) leafSpots.push({ p: V(c[0], c[1] + 0.3, c[2]), s: c[1] > 15 ? rnd(2.3, 2.9) : rnd(1.6, 2.2) });
    // the crown: the photo's top is a full canopy of big clumps with only small sky gaps
    const top = [];
    for (let i = 0; i < P.length; i += 3) if (P[i + 1] > 15.2 && Math.abs(P[i] - AX) < 7.5) top.push([P[i], P[i + 1], P[i + 2]]);
    for (let j = top.length - 1; j > 0; j--) { const r = Math.floor(rnd(0, j + 1)); [top[j], top[r]] = [top[r], top[j]]; }
    const crown = [];
    for (const c of top) { if (crown.length >= 10) break; if ([...crown, ...picked].some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 2.2)) continue; crown.push(c); }
    for (const c of crown) leafSpots.push({ p: V(c[0], c[1] + 1.0, c[2] + 0.4), s: rnd(2.3, 2.9) });
  }
  // roofs (critic T15): a limb crossing a roof is lifted clear of it as a whole (a smooth height field over the
  // roof's footprint), so it arches over the roof instead of being squashed flat onto the shingles
  for (const rf of o.roofs || []) {
    const CS = 0.4, PAD = 2.4, gx0 = rf.x0 - PAD, gz0 = rf.z0 - PAD, nx = Math.ceil((rf.x1 - rf.x0 + 2 * PAD) / CS) + 1, nz = Math.ceil((rf.z1 - rf.z0 + 2 * PAD) / CS) + 1;
    let L = new Float32Array(nx * nz); const xc = (rf.x0 + rf.x1) / 2, hw = (rf.x1 - rf.x0) / 2;
    const surf = x => rf.yb + rf.h * Math.max(0, 1 - Math.abs(x - xc) / hw) + rf.top;
    const wood = (x, y, z) => Math.hypot(x - AX, z - AZ) > R(Math.min(Math.max(y, 0), 14)) + 0.35;
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2];
      if (x < rf.x0 || x > rf.x1 || z < rf.z0 || z > rf.z1 || y < rf.yb - 0.25 || !wood(x, y, z)) continue;
      const need = surf(x) + rf.clear - y; if (need <= 0) continue;
      const k = Math.floor((x - gx0) / CS) + nx * Math.floor((z - gz0) / CS); L[k] = Math.max(L[k], need); }
    // spread: dilate, then blur, so the lift eases in over a couple of metres
    for (let pass = 0; pass < 9; pass++) { const N = new Float32Array(nx * nz);
      for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { let m = 0, sm = 0, c = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= nz) continue; const v = L[a + nx * b]; m = Math.max(m, v); sm += v; c++; }
        N[i + nx * j] = pass < 3 ? m : sm / c; }
      L = N; }
    const at = (x, z) => { const fx = (x - gx0) / CS - .5, fz = (z - gz0) / CS - .5; const i = Math.floor(fx), j = Math.floor(fz); if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return 0;
      const u = fx - i, v = fz - j; return (L[i + nx * j] * (1 - u) + L[i + 1 + nx * j] * u) * (1 - v) + (L[i + nx * (j + 1)] * (1 - u) + L[i + 1 + nx * (j + 1)] * u) * v; };
    for (let i = 0; i < P.length; i += 3) { const x = P[i], y = P[i + 1], z = P[i + 2];
      if (y < rf.yb - 1.2 || !wood(x, y, z)) continue;
      const w = Math.min(1, (y - (rf.yb - 1.2)) / 1.0); P[i + 1] = y + at(x, z) * w; }
  }
  const M = 0.1;
  for (let i = 0; i < P.length; i += 3) {
    let x = P[i], y = P[i + 1], z = P[i + 2];
    for (const b of o.avoid || []) {
      if (x > b[0] - M && x < b[1] + M && y > b[2] - M && y < b[3] + M && z > b[4] - M && z < b[5]) {
        // push out through the nearest side, never through the open front
        const d = [[x - (b[0] - M), 0], [(b[1] + M) - x, 1], [z - (b[4] - M), 4], [y - (b[2] - M), 2], [(b[3] + M) - y, 3]].sort((a, c) => a[0] - c[0])[0];
        if (d[1] === 0) x = b[0] - M; else if (d[1] === 1) x = b[1] + M; else if (d[1] === 4) z = b[4] - M; else if (d[1] === 2) y = b[2] - M; else y = b[3] + M;
      }
    }
    P[i] = x; P[i + 1] = y; P[i + 2] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(G, 1));
  g.setIndex(I); g.computeVertexNormals();
  // critic T16: the thin, curling side shoots of the model wrap around the house like snakes. Cut every thin piece
  // (under ~0.5 m thick) in the house band around the trunk; the main limbs and the crown's twigs stay.
  if (o.model && o.pruneThin === true) { // off: Pavel wants every branch kept (2026-11-23)
    const pa = g.attributes.position, na = g.attributes.normal, n = pa.count, CS = 0.35, grid = new Map();
    const key = (x, y, z) => Math.floor(x / CS) + ',' + Math.floor(y / CS) + ',' + Math.floor(z / CS);
    for (let i = 0; i < n; i++) { const k = key(pa.getX(i), pa.getY(i), pa.getZ(i)); let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i); }
    const TH = o.thinT || 0.3, thin = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      if (y < 4 || y > 13.5) continue; const hr = Math.hypot(x - AX, z - AZ); if (hr < R(y) + 0.4 || hr > 9.5) continue;
      const nx = na.getX(i), ny = na.getY(i), nz = na.getZ(i);
      const cx = Math.floor(x / CS), cy = Math.floor(y / CS), cz = Math.floor(z / CS); let best = 9;
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) for (let c = -2; c <= 2; c++) { const L = grid.get((cx + a) + ',' + (cy + b) + ',' + (cz + c)); if (!L) continue;
        for (const j of L) { if (na.getX(j) * nx + na.getY(j) * ny + na.getZ(j) * nz > -0.4) continue;
          const dx = pa.getX(j) - x, dy = pa.getY(j) - y, dz = pa.getZ(j) - z; if (-(dx * nx + dy * ny + dz * nz) < 0.02) continue;
          best = Math.min(best, Math.hypot(dx, dy, dz)); } }
      thin[i] = best < TH ? 1 : 0;
    }
    const idx = g.index.array, keep = []; let cut = 0;
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (thin[a] && thin[b] && thin[c]) { cut++; continue; } keep.push(a, b, c); }
    // drop the scraps left floating once the shoots are cut (small pieces not connected to the main tree)
    const par = new Int32Array(n).map((_, i) => i); const f = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
    for (let t = 0; t < keep.length; t += 3) { const a = f(keep[t]), b = f(keep[t + 1]), c = f(keep[t + 2]); par[b] = a; par[f(c)] = a; }
    const cnt = new Map(); for (let t = 0; t < keep.length; t += 3) { const r = f(keep[t]); cnt.set(r, (cnt.get(r) || 0) + 1); }
    let big = 0; for (const v of cnt.values()) big = Math.max(big, v);
    // only scraps that touch a cut (pieces of the model that were separate to begin with stay)
    const touched = new Set(); for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; if (thin[a] && thin[b] && thin[c]) for (const v of [a, b, c]) touched.add(f(v)); }
    const keep2 = []; for (let t = 0; t < keep.length; t += 3) { const r = f(keep[t]); if (cnt.get(r) > Math.min(400, big * 0.02) || !touched.has(r)) keep2.push(keep[t], keep[t + 1], keep[t + 2]); }
    g.setIndex(keep2); window.__thinCut = { cut, scraps: (keep.length - keep2.length) / 3, tris: keep2.length / 3 };
  }

  // ---------- bark: the painted texture along the wood, relief from the same texture, cool-warm painted shading ----------
  const barkT = o.barkT; barkT.wrapS = barkT.wrapT = THREE.RepeatWrapping; barkT.repeat.set(1, 1);
  const mat = modelMap ? new THREE.MeshStandardMaterial({ map: modelMap, roughness: 0.92, color: 0xE2D6D0 })
    : new THREE.MeshStandardMaterial({ map: barkT, bumpMap: barkT, bumpScale: 1.4, roughness: 0.9, color: 0xF0B080 });
  mat.onBeforeCompile = sh => {
    // [WIND] the far limbs and the top of the crown sway slowly with the wind (game/wind.js); trunk and house stay still
    const W = o.wind || window.__wind;
    if (W) { W.hook(sh); sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\ntransformed+=windBranch(transformed,vec2(${AX.toFixed(3)},${AZ.toFixed(3)}));`); }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;varying float vGlow;varying float vY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGlow=glow;vY=(modelMatrix*vec4(transformed,1.)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;varying float vY;uniform float doorGlow;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb*=mix(.8,1.,smoothstep(-.3,2.2,vY));
        // photo bark: cool grey-brown rather than orange (the Meshy paint is warm), shadows go violet-blue below
        diffuseColor.rgb=mix(vec3(dot(diffuseColor.rgb,vec3(.3,.59,.11))),diffuseColor.rgb,.62)*vec3(.97,.97,1.04);
`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat fac=max(dot(normal,normalize(vViewPosition)),0.);diffuseColor.rgb*=mix(vec3(.38,.37,.47),vec3(1.06,1.05,1.02),pow(fac,.7));\ntotalEmissiveRadiance+=vec3(1.,.5,.18)*vGlow*diffuseColor.rgb*doorGlow*1.6+diffuseColor.rgb*vec3(.05,.065,.09)*fac;');
    sh.uniforms.doorGlow = mat.userData.doorGlow;
    if (ARCH) {
      sh.uniforms.aC = { value: new THREE.Vector2(ARCH.cx, ARCH.cz) }; sh.uniforms.aD = { value: new THREE.Vector2(ARCH.dx, ARCH.dz) };
      sh.uniforms.aY = { value: new THREE.Vector3(door.y0, door.y1, door.w) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAW=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAW;uniform vec2 aC;uniform vec2 aD;uniform vec3 aY;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{vec2 r=vAW.xz-aC;float u=dot(r,aD),v=-r.x*aD.y+r.y*aD.x,da=abs(v)/(aY.z*.5),vy=(vAW.y-aY.x)/(aY.y-aY.x);
 if(u>.2&&u<3.&&vy>0.&&vy<1.&&(vy<.62?da:length(vec2(da,(vy-.62)/.38*1.05)))<1.)discard;}`);
    }
  };
  mat.userData.doorGlow = { value: 0 };
  const bark = new THREE.Mesh(g, mat); bark.castShadow = true; bark.receiveShadow = true; group.add(bark);

  // ---------- leaves: clumps of painted oak-leaf cards, facing outwards like the painted crown ----------
  const LA = o.avoidLeaves || [];
  const inB = (x, y, z, p) => LA.some(b => x > b[0] - p && x < b[1] + p && y > b[2] - p && y < b[3] + p && z > b[4] - p && z < b[5] + p);
  const leafT = o.leafT; leafT.wrapS = leafT.wrapT = THREE.ClampToEdgeWrapping; leafT.repeat.set(1, 1);
  // [PERF] phones: Lambert (per-pixel, no PBR) is a fraction of the fragment cost; the leaves are matte anyway
  const lmat = MOB(o) ? new THREE.MeshLambertMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  // soft, lit-from-above clumps: cards near the clump centre are darker (painted volume)
  lmat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float shade;varying float vShade;varying float vFacing;varying float vDep;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvShade=shade;').replace('#include <project_vertex>', '#include <project_vertex>\nvFacing=abs(dot(normalize(transformedNormal),normalize(-mvPosition.xyz)));vDep=-mvPosition.z;');
    // [WIND] leaves sway with the global wind (game/wind.js): each card drifts with its clump and flutters on its own
    const W = o.wind || window.__wind;
    if (W) {
      W.hook(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
{vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
 float s=windStrength(ip);vec2 wv=windSway(ip,2.3)*.15;
 float h=fract(sin(dot(ip,vec3(12.99,78.23,37.71)))*4375.5);
 float a=sin(uWT*(6.+h*5.)+h*30.)*(.04+.25*s),b=sin(uWT*(4.7+h*4.)+h*17.)*(.03+.15*s);
 // flutter as ripples running across the cupped card (the centre stays, the rim waves in several places at
 // different phases), never a tilt of the whole card, which would show it as a flat plane
 float r2=dot(position.xy,position.xy)*2.;
 transformed.z+=r2*(a*sin(position.x*7.+uWT*3.1+h*9.)+b*sin(position.y*6.+uWT*2.4+h*13.)+.5*(a+b)*sin((position.x+position.y)*9.+uWT*4.3))*.45;
 transformed+=windLocal(vec3(wv.x,wv.x*.15,wv.y)+windBranch(ip,vec2(${AX.toFixed(3)},${AZ.toFixed(3)})));}`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vShade;varying float vFacing;varying float vDep;').replace('#include <alphatest_fragment>', '/* oblique cards shrink towards their centre instead of showing a flat sheet; cards right at the camera fade out */\nfloat ff=smoothstep(.18,.6,vFacing)*smoothstep(.8,3.,vDep);diffuseColor.a*=step(length(vMapUv-.5)*2.,ff*1.3);\n#include <alphatest_fragment>').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb*=vShade;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(.06,.09,.08)*vShade;');
  };
  const total = MOB(o) ? (o.leafCards || 760) : 2800; // [PERF] phones: fewer, slightly bigger cards (same coverage, less overdraw)
  const want = []; let sumS = 0; for (const s of leafSpots) sumS += s.s * s.s;
  // cupped cards (not flat planes): seen from the side a card is a soft curve, never a straight sheet
  const qg = MOB(o) ? new THREE.PlaneGeometry(1, 1, 2, 2) : new THREE.PlaneGeometry(1, 1, 3, 3); // [PERF] 8 / 18 tris a card: still cupped, a quarter of the old cost
  { const pa = qg.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i); pa.setZ(i, 0.28 * (0.5 - (x * x + y * y))); } qg.computeVertexNormals(); }
  const im = new THREE.InstancedMesh(qg, lmat, total);
  const shade = new Float32Array(total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1), col = new THREE.Color();
  let n = 0;
  for (const s of leafSpots) {
    const k = Math.round(total * s.s * s.s / sumS);
    for (let i = 0; i < k && n < total; i++) {
      // points on a squashed sphere shell (more on top), facing out
      let dx, dy, dz; do { dx = rnd(-1, 1); dy = rnd(-0.45, 1); dz = rnd(-1, 1); } while (dx * dx + dy * dy + dz * dz > 1);
      // [PERF] phones: only the outer shell of each clump (inner cards are hidden but still shaded: overdraw)
      const dir = V(dx, dy, dz); const rr = MOB(o) ? rnd(0.8, 1.0) : Math.max(0.35, dir.length()); dir.normalize();
      const p = s.p.clone().add(V(dir.x * s.s * rr, dir.y * s.s * (dir.y < 0 ? 0.5 : 0.7) * rr, dir.z * s.s * rr)); // flatter underside: clumps don't droop
      if (inB(p.x, p.y, p.z, 0.8)) continue;
      // cards turned mostly towards the viewer, like the painted clumps in the photo
      // the underside of a clump (Wind: low clumps under the big limb read as vertical curtains): those cards face
      // out and down at random angles, like leaves seen from below, never a stack of upright sheets
      const fw = dir.y < -0.1 ? dir.clone().add(V(rnd(-.6, .6), rnd(-.5, -.1), rnd(-.6, .6)))
        : rnd(0, 1) < 0.5 ? dir.clone().multiplyScalar(0.55).add(V(0, 0.25, 1)) : dir.clone().add(V(rnd(-.4, .4), rnd(0, .5), rnd(-.4, .4)));
      const look = new THREE.Matrix4().lookAt(V(0, 0, 0), fw.normalize(), V(0, 1, 0));
      q.setFromRotationMatrix(look).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(0, 6.28))));
      sc.setScalar(MOB(o) ? rnd(1.55, 2.3) : rnd(1.25, 2.0));
      m4.compose(p, q, sc); im.setMatrixAt(n, m4);
      // phones have no inner cards, so some shell cards take the darker inner shade to keep the clumps' depth
      const rs = MOB(o) && rnd(0, 1) < 0.35 ? rnd(0.4, 0.78) : rr;
      const r = rnd(0.82, 1.08); col.setRGB(r, r * rnd(0.97, 1.04), r * rnd(0.88, 1));
      // lighter, yellow-green leaves on the clump edges and the odd autumn-yellow card, like the photo
      if (rs > 0.8 && (!MOB(o) || rnd(0, 1) < 0.75) && dir.y > -0.2) col.multiply(new THREE.Color(1.18, 1.14, 0.8));
      if (rnd(0, 1) < 0.07) col.setRGB(1.5, 1.25, 0.45);
      im.setColorAt(n, col);
      shade[n] = (0.5 + 0.5 * Math.min(1, rs)) * (0.7 + 0.5 * Math.max(0, dir.y));
      n++;
    }
  }
  im.count = n;
  qg.setAttribute('shade', new THREE.InstancedBufferAttribute(shade, 1));
  im.castShadow = !MOB(o); im.receiveShadow = true; group.add(im);

  // ---------- the hollow: a real cavity in the wood behind the arched opening (critic N4) ----------
  // A closed ellipsoid seen from inside, big enough that no line of sight through the opening reaches the trunk's
  // open shell (so nothing behind the tree shows through). Anything of it outside the bark is discarded in the
  // shader, so the bark lip is the edge. Inside: rough end-grain wood with growth rings and fibres, darker further in;
  // warm light only from the cave lamp (Lights) and the faint door glow.
  {
    const hh = door.y1 - door.y0, Rm = R(door.y0 + hh / 2);
    const dirx = Math.cos(doorAng), dirz = Math.sin(doorAng);
    const A = 1.55, B = hh * 0.95, Cl = Math.max(1.0, door.w * 1.0), off = Rm - 1.25;
    const cx = AX + dirx * off, cz = AZ + dirz * off, cy = door.y0 + hh * 0.38; // tall: wide at the floor, no gap under the walls
    const U = { doorGlow: mat.userData.doorGlow, cAx: { value: new THREE.Vector2(AX, AZ) }, cDir: { value: new THREE.Vector2(dirx, dirz) }, cR: { value: Rm - 0.04 }, cRs: { value: ARCH && ARCH.rs ? ARCH.rs - 0.08 : 99 }, cW: { value: door.w * 0.5 + 0.12 },
      cC: { value: new THREE.Vector3(cx, cy, cz) }, cS: { value: new THREE.Vector3(A, B, Cl) } };
    const clip = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCW;uniform float doorGlow;uniform vec2 cAx;uniform vec2 cDir;uniform float cR;uniform float cRs;uniform float cW;uniform vec3 cC;uniform vec3 cS;
float cH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cH(i),cH(i+vec2(1,0)),f.x),mix(cH(i+vec2(0,1)),cH(i+vec2(1,1)),f.x),f.y);}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n{vec2 r=vCW.xz-cAx;if(dot(r,cDir)>cR)discard;if(length(r)>cRs&&abs(-r.x*cDir.y+r.y*cDir.x)>cW)discard;}');
    };
    const cmat = new THREE.MeshStandardMaterial({ color: 0x6E4A32, roughness: 1, side: THREE.BackSide });
    cmat.onBeforeCompile = sh => {
      clip(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
 {vec3 q=vCW-cC;vec2 dd=cDir;float u=dot(q.xz,dd);float v=-q.x*dd.y+q.z*dd.x;
  float inn=clamp((cS.x*.55-u)/(cS.x*1.4),0.,1.);              // 0 at the mouth .. 1 at the back
  float r=length(vec2(v,q.y))*7.+cN(vec2(v,q.y)*3.)*1.4;        // growth rings round the hollow's axis
  float ring=smoothstep(.35,.5,abs(fract(r)-.5));
  float fib=cN(vec2(atan(q.y,v)*9.,u*2.5))*.6+cN(vec2(atan(q.y,v)*31.,u*7.))*.4; // fibres running in
  float crack=smoothstep(.08,.0,abs(cN(vec2(atan(q.y,v)*4.,u*1.3))-.5));
  vec3 c=mix(vec3(.2,.12,.07),vec3(.34,.22,.13),fib)*(.78+.3*ring)*(1.-.5*crack);
  diffuseColor.rgb=c*mix(1.,.15,pow(inn,.8));}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
 {vec3 q=vCW-cC;float u=dot(q.xz,cDir);float v=-q.x*cDir.y+q.z*cDir.x;float an=atan(q.y,v);
  float hgt=cN(vec2(an*9.,u*2.5))*.6+cN(vec2(an*31.,u*7.))*.4-smoothstep(.08,0.,abs(cN(vec2(an*4.,u*1.3))-.5));
  vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition);float hx=dFdx(hgt),hy=dFdy(hgt);
  vec3 r1=cross(dpy,normal),r2=cross(normal,dpx);float det=dot(dpx,r1);
  normal=normalize(abs(det)*normal-sign(det)*(hx*r1+hy*r2)*.06);}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{float u2=dot((vCW-cC).xz,cDir);totalEmissiveRadiance+=vec3(1.,.55,.22)*diffuseColor.rgb*doorGlow*.3*smoothstep(-.6,1.2,u2);}');
    };
    cmat.customProgramCacheKey = () => 'hollow';
    // rough, uneven walls (critic N4: a smooth dome reads as plastic): ridges of wood fibre running into the trunk and
    // lumps of rot, pushed inwards only so the cave never grows past the bark
    const cgeo = new THREE.SphereGeometry(1, MOB(o) ? 40 : 64, MOB(o) ? 26 : 40);
    { const pa = cgeo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        const a = Math.atan2(y, z), k = 1 - 0.07 * Math.pow(0.5 + 0.5 * Math.sin(a * 11 + x * 2.2 + Math.sin(a * 3) * 1.5), 2) - 0.05 * (0.5 + 0.5 * Math.sin(a * 5 - x * 4 + 1.3)) * (0.5 + 0.5 * Math.sin(x * 7 + a * 2))
          - 0.03 * Math.sin(x * 13 + a * 17) * Math.sin(a * 23);
        pa.setXYZ(i, x * k, y * (y < -0.6 ? 1 : k), z * k); }
      cgeo.computeVertexNormals(); }
    const cav = new THREE.Mesh(cgeo, cmat);
    cav.position.set(cx, cy, cz); cav.rotation.y = -doorAng; cav.scale.set(A, B, Cl); cav.receiveShadow = true; group.add(cav);
    // a floor of packed, rotten wood and leaf litter in the bottom of the hollow
    const fmat = new THREE.MeshStandardMaterial({ color: 0x5A3A24, roughness: 1 });
    fmat.onBeforeCompile = sh => { clip(sh); sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
 {vec3 q=vCW-cC;float inn=clamp((cS.x*.55-dot(q.xz,cDir))/(cS.x*1.4),0.,1.);float n=cN(vCW.xz*9.)*.6+cN(vCW.xz*31.)*.4;
  diffuseColor.rgb=mix(vec3(.13,.085,.05),vec3(.24,.16,.09),n)*mix(1.,.3,inn);}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.55,.22)*diffuseColor.rgb*doorGlow*.25;'); };
    fmat.customProgramCacheKey = () => 'hollowfloor';
    const fy = door.y0 + 0.03, k = Math.sqrt(Math.max(0, 1 - ((fy - cy) / B) ** 2));
    const fl = new THREE.Mesh(new THREE.CircleGeometry(1, 32), fmat); fl.rotation.x = -Math.PI / 2; fl.scale.set(A * k, Cl * k, 1);
    const flg = new THREE.Group(); flg.position.set(cx, fy, cz); flg.rotation.y = -doorAng; flg.add(fl); fl.receiveShadow = true; group.add(flg);
  }

  // world-space triangle soup for physics / slicing
  const tris = new Float32Array(I.length * 3);
  for (let i = 0; i < I.length; i++) { tris[i * 3] = P[I[i] * 3]; tris[i * 3 + 1] = P[I[i] * 3 + 1]; tris[i * 3 + 2] = P[I[i] * 3 + 2]; }
  return { group, bark, leaves: im, tris, axis: [AX, AZ], doorAngle: doorAng, R };
}
function MOB(o) { return !!o.MOBILE; }
