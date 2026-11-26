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
      // the photo's oak: smooth bark, but deep folds running up the trunk with a slow twist, and big rounded lobes between
      // them (Pavel 2026-11-23: the character is in the form, not the texture). Trunk only (near the axis, y 0.2..12).
      let xr = (x * cr + z * sr) * sp2, zr = (-x * sr + z * cr) * sp2; const d0 = Math.hypot(xr, zr);
      if (o.folds !== false && d0 > 0.3 && d0 < 3.4 && yy > -0.4 && yy < 12.5) {
        const an = Math.atan2(zr, xr), nearDoor = Math.max(0, 1 - Math.max(0, Math.abs(angDiff(an, doorAng)) - 0.45) / 0.35) * Math.max(0, Math.min(1, (door.y1 + 1.4 - yy) / 0.6)), w = (1 - nearDoor) * Math.min(1, (yy + 0.4) / 0.8) * Math.min(1, (12.5 - yy) / 1.5) * Math.min(1, (3.4 - d0) / 0.6);
        const ph = 5 * an + 0.22 * yy + 0.9 * Math.sin(2 * an + 0.35 * yy), gr = Math.pow(Math.max(0, Math.cos(ph)), 2.5), ph2 = 11 * an - 0.3 * yy + 2.1, gr2 = Math.pow(Math.max(0, Math.cos(ph2)), 6);
        const lobe = Math.sin(3 * an - 0.18 * yy + 0.7) * 0.5 + Math.sin(5 * an + 0.4 * yy) * 0.25;
        const dr = (o.foldDepth ?? 1) * w * (-0.5 * gr - 0.14 * gr2 + 0.16 * lobe) * Math.min(1, d0 / 1.6);
        const fk = (d0 + dr) / d0; xr *= fk; zr *= fk;
      }
      // the base flares out like a skirt (photo): an outward push strongest at the ground and near the trunk, so the
      // buttresses splay wide and the roots reach further out
      { const d1 = Math.hypot(xr, zr) || 1e-6, ts = Math.min(1, Math.max(0, (2.8 - yy) / 2.8));
        const sk = (o.flare ?? 1.1) * Math.pow(ts, 2) * Math.min(1, d1 / 1.4) * Math.max(0.35, 1 - Math.max(0, d1 - 3.2) / 5);
        const fk = (d1 + sk) / d1; xr *= fk; zr *= fk; }
      // the photo's main roots reach ~1.5x further, diagonally to the bottom corners of the frame, and stand taller where
      // they leave the trunk (Ground's side-by-side). The front centre (ladder foot, path, pond) keeps its short roots.
      let yo = yy, rs = 1;
      if (o.rootReach !== false) { /* the walk from the ladder foot to the woodpile/chopping block (Anim QA: he stepped over a 70 cm root): no stretching into it, no lift */ const pa = o.rootPath || [-4.9, 0.6, 3.5, 5.5], zin = (qx, qz) => Math.min(1, Math.max(0, Math.min(qx - pa[0], pa[1] - qx, qz - pa[2], pa[3] - qz) / 0.5 + 0.5)); const d2 = Math.hypot(xr, zr) || 1e-6, an = Math.atan2(zr, xr), offDoor = Math.min(1, Math.max(0, (Math.abs(angDiff(an, doorAng)) - 0.55) / 0.3)); /* the hollow landing sits on the roots there: leave them as they were */
        if (yy < 1.6 && d2 > 3.2) { const low = Math.min(1, (1.6 - yy) / 0.8), front = Math.max(0, Math.sin(an)), centre = Math.max(0, 1 - Math.abs(angDiff(an, Math.PI / 2)) / 0.55);
          const kk = (o.rootReach ?? 0.6) * low * (0.4 + 0.6 * front) * (1 - 0.85 * centre) * offDoor, nd0 = 3.2 + (d2 - 3.2) * (1 + kk), px = AX + xr * nd0 / d2, pz = AZ + zr * nd0 / d2; const inP = Math.max(zin(px, pz), zin(AX + xr, AZ + zr)), nd = 3.2 + (d2 - 3.2) * (1 + kk * (1 - inP)); xr *= nd / d2; zr *= nd / d2; rs = nd / d2; }
        if (yy > -0.3 && yy < 1.5) { const d3 = Math.hypot(xr, zr), hump = Math.max(0, 1 - Math.abs(d3 - 3.1) / 2.4);
          yo = yy + 0.32 * offDoor * (1 - zin(AX + xr, AZ + zr)) * hump * Math.min(1, (yy + 0.3) / 0.7) * Math.min(1, (1.5 - yy) / 0.5); } /* [TREE] a stretched root keeps its round body (photo: tall rounded roots out to the tips), not a flat ribbon: the crest rises with the stretch, the underside stays on the ground */ yo += (o.rootThick ?? 1.2) * (rs - 1) * Math.max(0, Math.min(yy + 0.15, 1.2)); }
      P.push(AX + xr, yo, AZ + zr);
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
    // the bark's radius all round the hollow (17 bins, -1.6..1.6 rad from the door): the cave is clipped against the bark on
    // its own side only. One global minimum (the thin flank on one side) cut the cave's far wall away where the bark is thick,
    // and the night sky showed through the trunk (Lights, after the door moved right of the ladder)
    const arch = (x, y, z) => {
      const rx = x - ccx, rz = z - ccz, u = rx * ddx + rz * ddz, v = -rx * ddz + rz * ddx;
      if (u < 0.2 || u > 3) return 99;
      const da = Math.abs(v) / (door.w / 2), vy = (y - door.y0) / (door.y1 - door.y0);
      if (vy < 0 || vy > 1) return 99; if (vy < 0.62) return da; return Math.hypot(da, (vy - 0.62) / 0.38 * 1.05);
    };
    const RA = new Array(17).fill(9);
    for (let i = 0; i < P.length; i += 3) { const y = P[i + 1]; if (y < door.y0 - 0.1 || y > door.y1 + 0.5) continue;
      const dx = P[i] - AX, dz = P[i + 2] - AZ, sd = angDiff(Math.atan2(dz, dx), doorAng); if (Math.abs(sd) > 1.7) continue;
      // critic T25: the bins next to the door were left unclipped (99), so beside and above the arch the lit shell poked out
      // through the bark as an orange crescent. Measure them too, skipping only the bark at the opening itself.
      if (Math.abs(sd) < 0.3 && arch(P[i], y, P[i + 2]) < 1.25) continue;
      const k = Math.round((sd + 1.6) / 0.2); if (k < 0 || k > 16) continue; RA[k] = Math.min(RA[k], Math.hypot(dx, dz)); }
    for (let k = 0; k < 17; k++) if (RA[k] >= 9) { let m = 9; for (let j = 1; j < 17 && m >= 9; j++) m = Math.min(RA[Math.max(0, k - j)], RA[Math.min(16, k + j)]); RA[k] = m < 9 ? m : 99; }
    ARCH = { cx: ccx, cz: ccz, dx: ddx, dz: ddz, rs: rs < 9 ? rs : 0, ra: RA };
    for (let i = 0; i < P.length / 3; i++) { const m = arch(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]); if (m < 1.5 && m > 0.9) G[i] = (1 - (m - 0.9) / 0.6) * 0.5; }
    const n3 = si ? si.count : sp.count;
    for (let t = 0; t < n3; t += 3) {
      const a = si ? si.getX(t) : t, b = si ? si.getX(t + 1) : t + 1, c = si ? si.getX(t + 2) : t + 2;
      // drop only triangles wholly inside the opening; the bark shader trims the rest along the exact arch, so the
      // edge is a clean curve instead of broken triangles (critic N4)
      const m = Math.max(arch(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]), arch(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]), arch(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]));
      if (m < 1.0) continue; I.push(a, b, c);
    }
    // autumn: a few dead twigs on the big limbs, bare grey and snapped off short (the photo's oak has small broken twigs
    // between the leaf clumps). Part of the bark mesh: no new draw call, ~40 verts each.
    if (o.deadTwigs !== false) { let tS = 7919; const tr = (a, b) => { tS = (tS * 16807) % 2147483647; return a + (b - a) * (tS / 2147483647); }; /* own seeded stream: the twigs must not shift the leaf layout's tr() */ const AVB = (o.avoidLeaves || []).concat(o.avoid || []), inAvT = (x, y, z) => AVB.some(b => x > b[0] - 0.6 && x < b[1] + 0.6 && y > b[2] - 0.6 && y < b[3] + 0.6 && z > b[4] - 0.6 && z < b[5] + 0.6);
      const tc = []; for (let i = 0; i < P.length; i += 30) { const x = P[i] - AX, y = P[i + 1], z = P[i + 2] - AZ, d = Math.hypot(x, z); if (d > 3.8 && d < 9.5 && y > 6.5 && y < 16 && z > -2.5 && z < 4.2 && !inAvT(P[i], y, P[i + 2])) tc.push([P[i], y, P[i + 2], tr(0, 1)]); }
      tc.sort((a, b) => a[3] - b[3]); const tw = [];
      for (const c of tc) { if (tw.length >= (MOB(o) ? 8 : 14)) break; if (tw.some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 1.6)) continue; tw.push(c); }
      for (const c of tw) { const out = V(c[0] - AX, 0, c[2] - AZ).normalize(), dir = V(out.x + tr(-.5, .5), tr(.35, .9), out.z + tr(-.5, .5)).normalize(), L = tr(.45, .85), r0 = tr(.035, .055);
        const b0 = V(c[0], c[1], c[2]).addScaledVector(dir, -0.08), side = V(-dir.z, 0, dir.x).normalize();
        const kink = b0.clone().addScaledVector(dir, L * 0.55).addScaledVector(side, tr(-.08, .08)), tip = kink.clone().addScaledVector(dir.clone().addScaledVector(side, tr(-.35, .35)).normalize(), L * 0.45);
        for (const tb of [tube([b0, kink, tip], 4, 5, t => r0 * (1 - 0.65 * t))].concat(tr(0, 1) < .5 ? [tube([kink.clone(), kink.clone().addScaledVector(V(tr(-.5, .5), .8, tr(-.5, .5)).normalize(), L * .35)], 2, 4, t => r0 * .5 * (1 - .6 * t))] : [])) {
          const off = P.length / 3; P.push(...tb.P); UV.push(...tb.UV); for (let k = 0; k < tb.G.length; k++) G.push(0); for (const q of tb.I) I.push(q + off); } } }
    // leaves: clumps at the limb tips and a crown at the top, with gaps between them
    const cand = [];
    for (let i = 0; i < P.length; i += 3) { const d = Math.hypot(P[i] - AX, P[i + 2] - AZ), y = P[i + 1]; if ((d > 3.6 && y > 4.5 && (Math.abs(P[i] - AX) > 3 || y > 15)) || y > 15.5) cand.push([P[i], y, P[i + 2], d + y * 0.35]); }
    cand.sort((a, b) => b[3] - a[3]);
    const picked = [];
    for (const c of cand) { if (picked.length >= (o.leafClumps || 40)) break; if (picked.some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 2.3)) continue; /* Pavel: a fuller crown */ picked.push(c); }
    for (const c of picked) leafSpots.push({ p: V(c[0], c[1] + 0.3, c[2]), s: c[1] > 15 ? rnd(2.3, 2.9) : rnd(1.6, 2.2) });
    // the photo frames the house with leaf clumps at mid height: left beside the bedroom/kitchen, right beside the deck and
    // the workshop roof. Clumps on the camera-facing limb ends there (Env's side-by-side), clear of the rooms.
    { const AVL = o.avoidLeaves || [], inAv = (x, y, z, p) => AVL.some(b => x > b[0] - p && x < b[1] + p && y > b[2] - p && y < b[3] + p && z > b[4] - p && z < b[5] + p);
      const side = []; for (let i = 0; i < P.length; i += 3) { const x = P[i] - AX, y = P[i + 1], z = P[i + 2] - AZ;
        if (y < 5.5 || y > 12.5) continue;
        /* never in front of the house (the photo never puts leaves over a room): left just behind the bedroom/kitchen wall line, inside the
           phone frame (its left edge is x ~ AX-5.7 at the trunk); right behind the deck/workshop plane */
        if (x < -4.9 && x > -8.5 && z > -3.8 && z < -1.2) side.push([P[i], y, P[i + 2], 10 - Math.abs(x)]);
        else if (x > 4.9 && x < 10.5 && z > -3 && z < 0.4) side.push([P[i], y, P[i + 2], 10 - x]); }
      side.sort((a, b) => b[3] - a[3]); const got = [];
      for (const c of side) { if (got.length >= (o.sideClumps ?? 14)) break; if (inAv(c[0], c[1], c[2], 1.4)) continue;
        if ([...got, ...picked].some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 2.2)) continue; got.push(c); }
      for (const c of got) leafSpots.push({ p: V(c[0], c[1] + 0.2, c[2] + 0.2), s: rnd(1.6, 2.1) }); }
    // the photo has no sky between the two big limbs above the bedroom roof: one or two clumps behind the ridge close it
    { const hole = []; for (let i = 0; i < P.length; i += 3) { const x = P[i] - AX, y = P[i + 1], z = P[i + 2] - AZ;
        if (x > -0.5 && x < 3 && y > 12.8 && y < 15.5 && z < -2.5 && z > -5.5) hole.push([P[i], y, P[i + 2], -Math.abs(y - 14) - Math.abs(x - 1.2)]); }
      hole.sort((a, b) => b[3] - a[3]); const hg = [];
      for (const c of hole) { if (hg.length >= 2) break; if (hg.some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 2.4)) continue; hg.push(c); }
      hg.push([AX + 1.7, 13.6, AZ - 3.1]); /* the gap right of the main stem, seen from the home view */
      for (const c of hg) leafSpots.push({ p: V(c[0], c[1] + 0.2, c[2] - 0.3), s: rnd(2.0, 2.4) }); }
    // the crown: the photo's top is a full canopy of big clumps with only small sky gaps
    const top = [];
    for (let i = 0; i < P.length; i += 3) if (P[i + 1] > 15.2 && Math.abs(P[i] - AX) < 7.5) top.push([P[i], P[i + 1], P[i + 2]]);
    for (let j = top.length - 1; j > 0; j--) { const r = Math.floor(rnd(0, j + 1)); [top[j], top[r]] = [top[r], top[j]]; }
    const crown = [];
    for (const c of top) { if (crown.length >= 16) break; if ([...crown, ...picked].some(q => Math.hypot(q[0] - c[0], q[1] - c[1], q[2] - c[2]) < 1.9)) continue; crown.push(c); }
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
  // the model's limbs are big triangles: a vertex pushed out of a room drags long faces that still cut across it (a limb lay
  // diagonally through the bedroom behind the bunk, in front of the back wall). Split the faces near a room first, so the
  // pushed surface folds round the room's sides instead of cutting through it.
  if ((o.avoid || []).length) {
    const near = (x, y, z) => o.avoid.some(b => x > b[0] - 0.45 && x < b[1] + 0.45 && y > b[2] - 0.45 && y < b[3] + 0.45 && z > b[4] - 0.45 && z < b[5]);
    for (let pass = 0; pass < 2; pass++) {
      const mid = new Map(), out = [];
      const split = (a, b) => { const k = a < b ? a * 4194304 + b : b * 4194304 + a; let m = mid.get(k); if (m !== undefined) return m;
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2], mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
        if (Math.hypot(ax - bx, ay - by, az - bz) < 0.16 || !(near(mx, my, mz) || near(ax, ay, az) || near(bx, by, bz))) { mid.set(k, -1); return -1; }
        m = P.length / 3; P.push(mx, my, mz); UV.push((UV[a * 2] + UV[b * 2]) / 2, (UV[a * 2 + 1] + UV[b * 2 + 1]) / 2); G.push((G[a] + G[b]) / 2); mid.set(k, m); return m; };
      let any = false;
      for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]], m = [split(v[0], v[1]), split(v[1], v[2]), split(v[2], v[0])], n = (m[0] >= 0) + (m[1] >= 0) + (m[2] >= 0);
        if (!n) { out.push(v[0], v[1], v[2]); continue; } any = true;
        if (n === 3) { out.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]); continue; }
        const r = m[0] >= 0 && (n === 1 || m[2] < 0) ? 0 : m[1] >= 0 && (n === 1 || m[0] < 0) ? 1 : 2;
        const A = v[r], B = v[(r + 1) % 3], C = v[(r + 2) % 3], mAB = m[r], mBC = m[(r + 1) % 3];
        if (n === 1) out.push(A, mAB, C, mAB, B, C); else out.push(A, mAB, C, mAB, B, mBC, mAB, mBC, C); }
      I.length = 0; for (const q of out) I.push(q); if (!any) break;
    }
  }
  const M = 0.1;
  for (let i = 0; i < P.length; i += 3) {
    let x = P[i], y = P[i + 1], z = P[i + 2];
    for (const b of o.avoid || []) {
      if (x > b[0] - M && x < b[1] + M && y > b[2] - M && y < b[3] + M && z > b[4] - M && z < b[5]) {
        // push out through the nearest side, never through the open front
        // a limb lying along the back wall goes out the back (flat against the wall, hidden from the room), not split between
        // the back, a side and the floor, which tore it apart across the room's corner
        const d = [[x - (b[0] - M), 0], [(b[1] + M) - x, 1], [Math.max(0, z - (b[4] - M) - 0.45), 4], [y - (b[2] - M), 2], [(b[3] + M) - y, 3]].sort((a, c) => a[0] - c[0])[0];
        if (d[1] === 0) x = b[0] - M; else if (d[1] === 1) x = b[1] + M; else if (d[1] === 4) z = b[4] - M; else if (d[1] === 2) y = b[2] - M; else y = b[3] + M;
      }
    }
    P[i] = x; P[i + 1] = y; P[i + 2] = z;
  }
  // a face whose corners went out through different sides of a room still bridges across it (two corners on the floor, one
  // on the side wall: a sheet of bark cutting the room's corner). Its middle is inside the room: drop it. What is left
  // ends at the room's walls and floor, which hide the cut.
  if ((o.avoid || []).length) { const E = 0.03, keep = [];
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const x = (P[a] + P[b] + P[c]) / 3, y = (P[a + 1] + P[b + 1] + P[c + 1]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
      if (o.avoid.some(q => x > q[0] - M + E && x < q[1] + M - E && y > q[2] - M + E && y < q[3] + M - E && z > q[4] - M + E && z < q[5] - E)) continue;
      keep.push(I[t], I[t + 1], I[t + 2]); }
    I.length = 0; for (const q of keep) I.push(q); }
  // ---------- roots (Pavel / critic T22): the model's roots are a few big flat faces. Refine them where they lie on the
  // ground and carve irregular folds running out along each root, a few sharp cuts across them, and bark lumps, all
  // deep enough to read from the normal camera. Edges are split by a rule that depends only on the edge itself
  // (length + where its midpoint is), so neighbours always agree: no cracks, UV seams included. Phones: coarser.
  let GR = null;
  if (o.model && o.rootDetail !== false) {
    const MOBI = MOB(o), Lmax = MOBI ? 0.5 : 0.28, LmaxT = MOBI ? 0.38 : 0.2, passes = 2; /* phones: coarser (day budget) */
    const rootW = (x, y, z) => { const d = Math.hypot(x - AX, z - AZ); return Math.min(1, Math.max(0, (d - 2.3) / 0.8)) * Math.min(1, Math.max(0, (2.0 - y) / 0.8)) * Math.min(1, Math.max(0, (y + 0.6) / 0.4)) * Math.min(1, Math.max(0, (11 - d) / 2)); };
    // the trunk itself (Pavel: too smooth from the normal view): long irregular cuts and bark plates, carved inwards only
    // (the house's beams and landings sit against it), never round the hollow's mouth
    const trunkW = (x, y, z) => { const d = Math.hypot(x - AX, z - AZ); if (d > 3.6 || d < 0.3 || y < 0.2 || y > 9.8) return 0;
      const an = Math.atan2(z - AZ, x - AX), nd = Math.max(0, 1 - Math.max(0, Math.abs(angDiff(an, doorAng)) - 0.5) / 0.35) * Math.max(0, Math.min(1, (door.y1 + 1.5 - y) / 0.6));
      return (1 - nd) * Math.min(1, (y - 0.2) / 0.6) * Math.min(1, (9.8 - y) / 1.2) * Math.min(1, (3.6 - d) / 0.5); };
    const zoneW = (x, y, z) => Math.max(rootW(x, y, z), trunkW(x, y, z));
    const n0 = P.length / 3, t0 = I.length / 3;
    for (let pass = 0; pass < passes; pass++) {
      const mid = new Map(), out = [];
      const split = (a, b) => { const k = a < b ? a * 4194304 + b : b * 4194304 + a; let m = mid.get(k); if (m !== undefined) return m;
        const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
        const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
        const el = Math.hypot(ax - bx, ay - by, az - bz), wr = rootW(mx, my, mz), wt = trunkW(mx, my, mz);
        if (!((wr > 0 && el > Lmax) || (wt > 0 && el > LmaxT))) { mid.set(k, -1); return -1; }
        m = P.length / 3; P.push(mx, my, mz); UV.push((UV[a * 2] + UV[b * 2]) / 2, (UV[a * 2 + 1] + UV[b * 2 + 1]) / 2); G.push((G[a] + G[b]) / 2); mid.set(k, m); return m; };
      for (let t = 0; t < I.length; t += 3) { const v = [I[t], I[t + 1], I[t + 2]], m = [split(v[0], v[1]), split(v[1], v[2]), split(v[2], v[0])], n = (m[0] >= 0) + (m[1] >= 0) + (m[2] >= 0);
        if (!n) { out.push(v[0], v[1], v[2]); continue; }
        if (n === 3) { out.push(v[0], m[0], m[2], m[0], v[1], m[1], m[2], m[1], v[2], m[0], m[1], m[2]); continue; }
        // rotate so the first split edge is v0-v1 (m0)
        let r = m[0] >= 0 && (n === 1 || m[2] < 0) ? 0 : m[1] >= 0 && (n === 1 || m[0] < 0) ? 1 : 2;
        const A = v[r], B = v[(r + 1) % 3], C = v[(r + 2) % 3], mAB = m[r], mBC = m[(r + 1) % 3];
        if (n === 1) out.push(A, mAB, C, mAB, B, C);
        else out.push(A, mAB, C, mAB, B, mBC, mAB, mBC, C); }
      I.length = 0; for (const q of out) I.push(q);
    }
    // vertex normals of the refined mesh (area weighted) to push along
    const nv = P.length / 3, Nn = new Float32Array(nv * 3);
    for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; for (const q of [a, b, c]) { Nn[q] += nx; Nn[q + 1] += ny; Nn[q + 2] += nz; } }
    // weld normals of coincident vertices (UV seams) so both sides move the same way
    { const wm = new Map(); for (let i = 0; i < nv; i++) { const k = Math.round(P[i * 3] * 2e3) + ',' + Math.round(P[i * 3 + 1] * 2e3) + ',' + Math.round(P[i * 3 + 2] * 2e3); const j = wm.get(k);
        if (j === undefined) wm.set(k, i); else { Nn[j * 3] += Nn[i * 3]; Nn[j * 3 + 1] += Nn[i * 3 + 1]; Nn[j * 3 + 2] += Nn[i * 3 + 2]; Nn[i * 3] = -1e9; Nn[i * 3 + 1] = j; } }
      for (let i = 0; i < nv; i++) if (Nn[i * 3] === -1e9) { const j = Nn[i * 3 + 1]; Nn[i * 3] = Nn[j * 3]; Nn[i * 3 + 1] = Nn[j * 3 + 1]; Nn[i * 3 + 2] = Nn[j * 3 + 2]; } }
    GR = new Float32Array(nv);
    const hsh = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < nv; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], w = rootW(x, y, z), wt = trunkW(x, y, z); if (w <= 0 && wt <= 0) continue;
      let nx = Nn[i * 3], ny = Nn[i * 3 + 1], nz = Nn[i * 3 + 2]; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const d = Math.hypot(x - AX, z - AZ), an = Math.atan2(z - AZ, x - AX);
      let h = 0;
      if (w > 0) {
        // roots, sized to read from the normal camera (~20 m): broad folds running out along the root, finer furrows,
        // slanted cuts, burls and swellings
        const f0 = Math.pow(Math.max(0, Math.cos(an * 16 + Math.sin(d * 0.9 + an * 2) * 1.6 + y * 1.4)), 2);
        const f1 = Math.pow(Math.max(0, Math.cos(an * 34 + Math.sin(d * 1.3 + an * 3) * 1.4 + y * 2.2)), 3);
        const f2 = Math.pow(Math.max(0, Math.cos(an * 71 - d * 0.8 + y * 3.1 + 1.7)), 6);
        const ck = Math.pow(Math.max(0, Math.cos(d * 4.1 + an * 9 + Math.sin(an * 5) * 2)), 40) * Math.max(0, Math.sin(an * 7 + d * 0.6 + 0.8) - 0.35) * 1.6;
        const lp = Math.sin(x * 2.3 + Math.sin(z * 1.7)) * Math.sin(z * 2.1 + y * 1.9) * Math.sin(y * 2.7 + x * 1.1);
        const big = Math.max(0, Math.sin(an * 4 + d * 0.9 + 2.2)) * Math.max(0, Math.sin(d * 1.6 - an * 2));
        const up = 0.55 + 0.45 * Math.max(0, ny);
        h += w * up * (-0.2 * f0 - 0.1 * f1 - 0.05 * f2 - 0.18 * ck + 0.09 * lp + 0.16 * big + (hsh(Math.round(x * 6), Math.round(z * 6)) - 0.5) * 0.015);
      }
      if (wt > 0) {
        // trunk: long splits that wander and stop, finer furrows between them, and the bark broken across into plates
        const ph = an * 13 + 0.7 * Math.sin(y * 0.45 + an * 2) + 0.05 * y;
        const cut = Math.pow(Math.max(0, Math.cos(ph)), 26) * Math.min(1, Math.max(0, (Math.sin(y * 0.55 + an * 4.3 + 1.1) - 0.05) * 2.5));
        const fur = Math.pow(Math.max(0, Math.cos(an * 29 - y * 0.15 + Math.sin(y * 0.8 + an) * 0.6)), 4);
        const plate = Math.pow(Math.max(0, Math.cos(y * 3.3 + an * 6 + Math.sin(an * 11) * 1.5)), 18) * (0.4 + 0.6 * fur);
        const kd = Math.min(1, d / 1.4);
        h += wt * kd * -(0.17 * cut + 0.055 * fur + 0.04 * plate + 0.012 * hsh(Math.round(an * 40), Math.round(y * 5)));
      }
      GR[i] = Math.min(1, Math.max(0, -h - 0.03) / 0.14); /* how deep in a groove: the bark shader darkens it (reads from afar) */
      P[i * 3] += nx * h; P[i * 3 + 1] += ny * h; P[i * 3 + 2] += nz * h; }
    // the big twisting folds (model pass above) shade dark in their troughs too, so the fluted trunk reads from the home view
    // like the photo's, not as a flat brown wall (same phase as the folds; off near the hollow)
    if (o.folds !== false) for (let i = 0; i < nv; i++) { const x = P[i * 3] - AX, y = P[i * 3 + 1], z = P[i * 3 + 2] - AZ, d0 = Math.hypot(x, z);
      if (d0 < 0.3 || d0 > 3.6 || y < -0.4 || y > 12.5) continue; const an = Math.atan2(z, x);
      const nearDoor = Math.max(0, 1 - Math.max(0, Math.abs(angDiff(an, doorAng)) - 0.45) / 0.35) * Math.max(0, Math.min(1, (door.y1 + 1.4 - y) / 0.6));
      const w = (1 - nearDoor) * Math.min(1, (y + 0.4) / 0.8) * Math.min(1, (12.5 - y) / 1.5) * Math.min(1, (3.6 - d0) / 0.6);
      const ph = 5 * an + 0.22 * y + 0.9 * Math.sin(2 * an + 0.35 * y), gr = Math.pow(Math.max(0, Math.cos(ph)), 1.6);
      GR[i] = Math.max(GR[i], (o.foldShade ?? 0.7) * w * gr); }
    if (typeof window !== 'undefined') window.__rootDetail = { verts: P.length / 3 - n0, tris: I.length / 3 - t0 };
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('glow', new THREE.Float32BufferAttribute(G, 1));
  { const gr = new Float32Array(P.length / 3); if (GR) gr.set(GR.subarray(0, Math.min(GR.length, gr.length))); g.setAttribute('tdGr', new THREE.BufferAttribute(gr, 1)); } // groove depth (roots / trunk cuts)
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
        // Pavel: smooth painted bark like the photo, the character in the forms: the texture's fine noise is toned down
        diffuseColor.rgb=mix(vec3(.13,.08,.052),diffuseColor.rgb,.5);
`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nfloat fac=max(dot(normal,normalize(vViewPosition)),0.);diffuseColor.rgb*=mix(vec3(.38,.37,.47),vec3(1.06,1.05,1.02),pow(fac,.7));\ntotalEmissiveRadiance+=vec3(1.,.5,.18)*vGlow*diffuseColor.rgb*doorGlow*1.6+diffuseColor.rgb*vec3(.05,.065,.09)*fac;');
    sh.uniforms.doorGlow = mat.userData.doorGlow;
    // [ENV] limbs (Pavel / photo: smooth bark with long folds following the wood): the trunk's folds are carved in the mesh, the
    // limbs only had the painted crackle. Shading-only grooves that run along each limb (axis estimated from the trunk outwards),
    // wandering and merging, darkened in the furrow and caught on the ridge; they fade out where they would be under a pixel.
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vOkW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvOkW=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vOkW;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{vec3 wp=vOkW;float dT=length(wp.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)}));float bw=max(smoothstep(3.3,4.4,dT),smoothstep(9.6,10.8,wp.y));
 if(bw>0.){vec3 wn=normalize((vec4(normal,0.)*viewMatrix).xyz);vec3 ax=normalize(wp-vec3(${AX.toFixed(3)},wp.y*.6,${AZ.toFixed(3)}));
  vec3 u=normalize(cross(ax,vec3(0.,1.,0.))+vec3(1e-4,0.,0.));vec3 w=cross(ax,u);float an=atan(dot(wn,w),dot(wn,u));float al=dot(wp,ax);
  float ph=an*7.+1.4*sin(al*.8+an*2.)+.7*sin(al*2.1-an*3.);float gr=smoothstep(.55,.97,abs(sin(ph)));float aa=1.-smoothstep(.6,1.6,fwidth(an*7.));
  float k=bw*aa;diffuseColor.rgb*=1.-.42*gr*k;diffuseColor.rgb*=1.+.1*(1.-gr)*k*smoothstep(0.,.5,cos(ph));}}`);
    // rain: wet bark darkens and gets a sheen (Env's env.wet, like the forest: roughness x(1-.55w), colour x(1-.35w)),
    // most on the up-facing, rain-exposed sides, less under the crown and the house
    const WET = (o.env || window.__env || {}).wet;
    if (WET) {
      sh.uniforms.bWet = WET;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float bWet;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{vec3 nWw=normalize((vec4(normal,0.)*viewMatrix).xyz);float wk=bWet*(.45+.55*smoothstep(-.3,.6,nWw.y))*(1.-.45*smoothstep(4.,9.,vY));
 roughnessFactor*=1.-.55*wk;diffuseColor.rgb*=1.-.35*wk;}`);
    }
    // warm bark round the house at night (Environment drives env.barkWarm): diffuse only, the bark stays matte
    const BW = (o.env || window.__env || {}).barkWarm;
    if (BW) {
      sh.uniforms.bwC = BW.color; sh.uniforms.bwS = BW.strength;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvBW=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBW;uniform vec3 bwC;uniform float bwS;')
        .replace('#include <opaque_fragment>', `{vec2 bwd=vBW.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)});/* down to the ground on the camera side, fading out over the roots (Env, photo: warm lower trunk) */
outgoingLight+=diffuseColor.rgb*bwC*bwS*.8*smoothstep(-.3,.8,vBW.y)*mix(.75,1.,smoothstep(1.,3.,vBW.y))*smoothstep(12.,10.,vBW.y)*smoothstep(-1.5,1.,bwd.y)*smoothstep(7.,3.2,length(bwd));}
#include <opaque_fragment>`);
    }
    if (ARCH) {
      sh.uniforms.aC = { value: new THREE.Vector2(ARCH.cx, ARCH.cz) }; sh.uniforms.aD = { value: new THREE.Vector2(ARCH.dx, ARCH.dz) };
      sh.uniforms.aY = { value: new THREE.Vector3(door.y0, door.y1, door.w) };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAW=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAW;uniform vec2 aC;uniform vec2 aD;uniform vec3 aY;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
{vec2 r=vAW.xz-aC;float u=dot(r,aD),v=-r.x*aD.y+r.y*aD.x,da=abs(v)/(aY.z*.45),vy=(vAW.y-aY.x)/(aY.y-aY.x);
 if(u>.2&&u<2.1&&vy>0.&&vy<1.&&(vy<.62?da:length(vec2(da,(vy-.62)/.38*1.16)))<1.)discard;}`);
    }
  };
  mat.userData.doorGlow = { value: 0 };
  mat.customProgramCacheKey = () => 'oakBark-grooves1'; /* [ENV] explicit key (SHADERS rule) */
  const bark = new THREE.Mesh(g, mat); bark.castShadow = true; bark.receiveShadow = true; group.add(bark);

  // ---------- leaves: clumps of painted oak-leaf cards, facing outwards like the painted crown ----------
  const LA = o.avoidLeaves || [];
  const inB = (x, y, z, p) => LA.some(b => x > b[0] - p && x < b[1] + p && y > b[2] - p && y < b[3] + p && z > b[4] - p && z < b[5] + p);
  const SPR = o.leafSprigT || null; /* [TREE] Pavel 2026-11-25: no flat planes, round clumps built of these same leaves, twice the foliage: each card is one sprig of ~7 leaves and many sprigs make a rounded clump */ const ROS = SPR && MOB(o) && o.leafRosT ? o.leafRosT : null; /* [PERF] phones: a rosette of four sprigs on one card (73% of its outline is leaf vs ~45%): the same leaves and clumps at about half the overdraw */ const leafT = ROS || SPR || o.leafT; leafT.wrapS = leafT.wrapT = THREE.ClampToEdgeWrapping; leafT.repeat.set(1, 1);
  // [PERF] phones: Lambert (per-pixel, no PBR) is a fraction of the fragment cost; the leaves are matte anyway
  const lmat = MOB(o) ? new THREE.MeshLambertMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide })
    : new THREE.MeshStandardMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  // soft, lit-from-above clumps: cards near the clump centre are darker (painted volume)
  lmat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float shade;attribute vec3 aCC;varying float vShade;varying float vFacing;varying float vDep;').replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\n'+(SPR ? '/* [TREE] clump normals: each sprig is lit as part of a round ball (out from its clump centre), so a clump shades like a volume, never as separate flat cards */{vec3 wp=(instanceMatrix*vec4(position,1.)).xyz;transformedNormal=normalize(normalMatrix*normalize(mix(normalize(mat3(instanceMatrix)*objectNormal),normalize(wp-aCC),.78)));}' : '')).replace('#include <uv_vertex>', '#include <uv_vertex>\nvShade=shade;').replace('#include <project_vertex>', '#include <project_vertex>\n/* [ENV] per CARD, not per pixel: an oblique or too-near card goes whole (each at its own threshold), so no leaf is ever cut across */{vec4 cC=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);vec3 cN=normalize(mat3(modelViewMatrix)*mat3(instanceMatrix)*vec3(0.,0.,1.));float cH=fract(sin(dot(instanceMatrix[3].xyz,vec3(12.99,78.23,37.71)))*4375.5);float th='+(SPR ? 'mix(.13,.3,cH)' : 'mix(.24,.5,cH)')+',dh=mix(1.6,3.2,fract(cH*7.31));/* shrinks smoothly towards its centre over a short band (no pop when the camera turns or zooms) */float cf=smoothstep(th-.07,th+.07,abs(dot(cN,normalize(-cC.xyz))))*smoothstep(dh-.5,dh+.5,-cC.z);/* [TREE] orbiting to the back or sides, a big clump between the camera and the house hid it all: cards in the middle of the view that are nearer than the trunk go */{vec4 cp=projectionMatrix*cC;vec2 nd=abs(cp.xy/max(cp.w,.01));float ax=length(cameraPosition.xz-vec2('+AX.toFixed(2)+','+AZ.toFixed(2)+'));cf*=1.-(1.-smoothstep(.28,.48,max(nd.x*.85,nd.y)))*(1.-smoothstep(ax-5.,ax-2.5,-cC.z));}mvPosition=cC+(mvPosition-cC)*cf;gl_Position=projectionMatrix*mvPosition;vFacing=step(.001,cf);vDep=1.;}');
    // [WIND] leaves sway with the global wind (game/wind.js): each card drifts with its clump and flutters on its own
    const W = o.wind || window.__wind;
    if (W) {
      W.hook(sh);
      sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
{vec3 ip=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
 // [ENV wind] cards on one twig move together (phase from a ~1.6 m cell, not per card: no shimmering jelly), the outer crown
 // more than the cards near the trunk; the flutter is a quick small tremble that wakes with the wind (almost still in calm)
 float s=windStrength(ip);float hc=fract(sin(dot(floor(ip/1.6),vec3(12.99,78.23,37.71)))*4375.5);
 vec2 wv=windSwayH(ip,1.7,hc*6.28)*.13*(.45+.55*smoothstep(2.5,8.,length(ip.xz-vec2(${AX.toFixed(3)},${AZ.toFixed(3)}))));
 float h=fract(sin(dot(ip,vec3(12.99,78.23,37.71)))*4375.5);float fl=min(s,1.6);
 float a=sin(uWT*(10.+h*7.)+h*30.)*(.012+.13*fl*fl*.6),b=sin(uWT*(8.3+h*6.)+h*17.)*(.01+.08*fl*fl*.6);
 // flutter as ripples running across the cupped card (the centre stays, the rim waves in several places at
 // different phases), never a tilt of the whole card, which would show it as a flat plane
 float r2=dot(position.xy,position.xy)*2.;
 transformed.z+=r2*(a*sin(position.x*7.+uWT*3.1+h*9.)+b*sin(position.y*6.+uWT*2.4+h*13.)+.5*(a+b)*sin((position.x+position.y)*9.+uWT*4.3))*.3;
 transformed+=windLocal(vec3(wv.x,wv.x*.15,wv.y)+windBranch(ip,vec2(${AX.toFixed(3)},${AZ.toFixed(3)})));}`);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vShade;varying float vFacing;varying float vDep;').replace('#include <color_fragment>', '#include <color_fragment>\n'+(SPR ? '/* autumn sprigs: a warm-tinted card turns its leaves gold, orange or rust (the green sprig art only went olive under a plain multiply) */\n#ifdef USE_COLOR\n{vec3 ic=vColor.rgb;float w=smoothstep(.55,.9,ic.r-ic.b);float l=dot(diffuseColor.rgb,vec3(.3,.59,.11))/max(dot(ic,vec3(.3,.59,.11)),.01);diffuseColor.rgb=mix(diffuseColor.rgb,l*ic*2.6,w);}\n#endif' : '')).replace('#include <lights_fragment_begin>', SPR ? /* [TREE] critic T28: up close the sun's shadow of one sprig on the next read as a ghost leaf seen through it; on the leaves the sun shadow is softened to 55% (the crown keeps its depth) */ THREE.ShaderChunk.lights_fragment_begin.replace('? getShadow( directionalShadowMap', '? .45+.55*getShadow( directionalShadowMap') : '#include <lights_fragment_begin>').replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n'+(SPR ? 'normal*=faceDirection;/* clump normals face out on both sides of a card */' : '')).replace('#include <alphatest_fragment>', '/* oblique cards shrink towards their centre instead of showing a flat sheet; cards right at the camera fade out */\ndiffuseColor.a*=vFacing*vDep;\n#include <alphatest_fragment>').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb*=vShade;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(.06,.09,.08)*vShade;\n/* [TREE] like the photo, the crown reads as layered leaves lit from the sky (sage tops, darker inside), not a near-black mass: a sky-fill term from the hemisphere light, stronger on upward-facing and outer (vShade) cards; it dims with the sky at night and under rain */\n#if NUM_HEMI_LIGHTS>0\n{vec3 up=normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz);float uf=.45+.55*max(dot(normal,up),0.);totalEmissiveRadiance+=diffuseColor.rgb*hemisphereLights[0].skyColor*('+(o.leafSky ?? 0.5).toFixed(2)+')*uf*vShade*vShade;}\n#endif\n/* [TREE] golden hour: a low warm sun shines through and along the leaves (they stayed noon-green next to the glowing bark and walls). Only a warm sun counts (noon white, blue night fill and rim: none), so it fades by itself under cloud, rain and at night */\n#if NUM_DIR_LIGHTS>0\n{vec3 vc=normalize(vViewPosition);for(int i=0;i<NUM_DIR_LIGHTS;i++){vec3 lc=directionalLights[i].color;float gw=smoothstep(.5,.85,(lc.r-lc.b)/max(lc.r,.001));vec3 L=directionalLights[i].direction;float fr=max(dot(normal,L),0.),bk=max(-dot(vc,L),0.);totalEmissiveRadiance+=diffuseColor.rgb*lc*gw*vShade*(.1*fr+.22*bk*bk);}}\n#endif');
  };
  lmat.customProgramCacheKey = () => 'oakLeaf-cardFade2-gold-sky' + (SPR ? '-sprig3' : ''); /* [ENV] explicit key (SHADERS rule) */
  // Pavel (2026-11-23): like the photo, big clearly drawn leaves: few large cards (each card is a painted clump of ~35 oak
  // leaves, so at this size a leaf is ~0.5 m like the photo's), not hundreds of small ones that read as mush
  const total = SPR ? (MOB(o) ? (o.leafCards || (ROS ? 370 : 520)) : 4200) : MOB(o) ? (o.leafCards || 110) : 430; /* x0.55 count at x1.38 size (Env vs photo: a leaf ~0.85 m) plus the side clumps */ // [PERF] round cards (below) and fewer: overdraw <= 1 screen on phones
  // the photo keeps open sky behind the telescope deck (critic T26): no clump in the window above and behind it
  { const SW = o.skyWindow || [AX + 2.2, AX + 8, 9.6, 15.2, AZ - 13, AZ + 2.5];
    for (let i = leafSpots.length - 1; i >= 0; i--) { const p = leafSpots[i].p; if (p.x > SW[0] && p.x < SW[1] && p.y > SW[2] && p.y < SW[3] && p.z > SW[4] && p.z < SW[5]) leafSpots.splice(i, 1); } if (SPR) { /* [TREE] Pavel: at least twice the foliage, visible from the home view: a second ring of clumps grows out of the crown (outwards and up from the trunk axis), so the crown gets bigger and fuller, not just more layers inside */
      const inSW = p => p.x > SW[0] && p.x < SW[1] && p.y > SW[2] && p.y < SW[3] && p.z > SW[4] && p.z < SW[5], n0 = leafSpots.length;
      for (let i = 0; i < n0; i++) { const s0 = leafSpots[i]; for (let j = 0; j < 2; j++) { const out = V(s0.p.x - AX, 0, s0.p.z - AZ); if (out.lengthSq() < 0.01) out.set(rnd(-1, 1), 0, rnd(-1, 1)); out.normalize(); const a = rnd(-1.1, 1.1), c = Math.cos(a), sn = Math.sin(a); const d = V(out.x * c - out.z * sn, 0, out.x * sn + out.z * c);
        const p = s0.p.clone().addScaledVector(d, s0.s * rnd(0.8, 1.3)).add(V(0, rnd(-0.3, 1.0) * s0.s, d.z < 0 ? 0 : rnd(0, 0.6))); if (inSW(p) || inB(p.x, p.y, p.z, 1.2) || p.y < 8.5) continue; /* no new clumps down by the kitchen (stray leaves by the trunk) */ leafSpots.push({ p, s: s0.s * rnd(0.7, 0.95) }); } } } }
  const want = []; let sumS = 0; const wS = s => ROS ? Math.pow(s.s, 1.2) : s.s * s.s; /* phones: small side clumps get their share too (the rosette cards are smaller than the old big ones, which spilled wide) */ for (const s of leafSpots) sumS += wS(s);
  // cupped cards (not flat planes): seen from the side a card is a soft curve, never a straight sheet
  const qg = SPR ? (() => { /* the sprig's outline (convex hull of its leaves): no empty corners to shade */ const H = ROS ? [[.036,.604],[.324,.908],[.452,.951],[.628,.926],[.817,.831],[.929,.411],[.798,.152],[.666,.086],[.579,.08],[.214,.134],[.111,.227],[.047,.388]] : [[.019,.541],[.175,.824],[.565,1],[.583,1],[.856,.859],[.967,.662],[.977,.379],[.879,.053],[.631,0],[.28,.033],[.226,.061],[.021,.525]], pos = [0, 0, 0], uv = [.5, .5], ix = []; for (const [u, v] of H) { pos.push(u - .5, v - .5, 0); uv.push(u, v); } for (let i = 1; i <= H.length; i++) ix.push(0, i, i % H.length + 1); const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(ix); return g; })() : new THREE.CircleGeometry(0.5, MOB(o) ? 10 : 12); // round like the painted clump: no empty quad corners to shade // [PERF] 8 / 18 tris a card: still cupped, a quarter of the old cost
  { const pa = qg.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i); pa.setZ(i, (SPR ? 0.2 : 0.28) * (0.5 - (x * x + y * y))); } qg.computeVertexNormals(); }
  let im = new THREE.InstancedMesh(qg, lmat, total);
  const shade = new Float32Array(total), cc = new Float32Array(total * 3);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1), col = new THREE.Color();
  let n = 0;
  for (const s of leafSpots) {
    const k = Math.round(total * wS(s) / sumS);
    for (let i = 0; i < k && n < total; i++) {
      // points on a squashed sphere shell (more on top), facing out
      let dx, dy, dz; do { dx = rnd(-1, 1); dy = rnd(-0.45, 1); dz = rnd(-1, 1); } while (dx * dx + dy * dy + dz * dz > 1);
      if (SPR) { /* sprigs: a few lumpy sub-balls per clump (irregular round shapes), filled through the volume; every sprig turned its own way */
        const nb = s.sub || (s.sub = Array.from({ length: 2 + Math.floor(rnd(0, 2.99)) }, () => [rnd(-.6, .6) * s.s, rnd(-.15, .35) * s.s, rnd(-.6, .6) * s.s, s.s * rnd(.85, 1.15) + (ROS ? 1.1 : 0.7)]));
        const b = nb[Math.floor(rnd(0, nb.length - 0.001))], d0 = V(dx, dy, MOB(o) && dz < 0.1 ? Math.abs(dz) * 0.6 + 0.1 : dz), rr = MOB(o) ? rnd(0.8, 1) : Math.cbrt(rnd(0.12, 1)); d0.normalize(); /* [PERF] phones: the back of a clump is hidden by its front from the home view, so its sprigs go to the front half (same look, half the overdraw) */
        const p = s.p.clone().add(V(b[0], b[1], b[2])).add(V(d0.x * b[3] * rr, d0.y * b[3] * rr * (d0.y < 0 ? 0.6 : 0.85), d0.z * b[3] * rr));
        if (inB(p.x, p.y, p.z, 0.8)) continue;
        const fw = V(0, 0.3, 1).multiplyScalar(0.75).addScaledVector(d0, 0.55).add(V(rnd(-1, 1), rnd(-.6, 1), rnd(-1, 1)).normalize().multiplyScalar(0.5)); /* mostly towards the home view (the camera never goes behind), each its own way */
        q.setFromRotationMatrix(new THREE.Matrix4().lookAt(V(0, 0, 0), fw.normalize(), V(rnd(-1, 1), 1, rnd(-1, 1)).normalize())).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, rnd(0, 6.28))));
        sc.setScalar(ROS ? rnd(3.3, 3.9) * (1 + 0.35 * Math.min(1, Math.max(0, (Math.abs(p.x - AX) - 4) / 3))) * (Math.hypot(d0.x, d0.y) < 0.55 ? 0.85 : 1) /* [PERF] the front middle of a clump only doubles the cards around it: smaller there */ : MOB(o) ? rnd(2.5, 3.1) : rnd(2.3, 2.9)); m4.compose(p, q, sc); im.setMatrixAt(n, m4);
        const c0 = s.p.clone().add(V(b[0], b[1] - b[3] * 0.25, b[2])); cc[n * 3] = c0.x; cc[n * 3 + 1] = c0.y; cc[n * 3 + 2] = c0.z;
        const r = rnd(0.92, 1.15); col.setRGB(r, r * rnd(0.98, 1.06), r * rnd(0.88, 1));
        if (rr > 0.8 && d0.y > -0.2 && rnd(0, 1) < 0.6) col.multiply(new THREE.Color(1.14, 1.12, 0.84));
        { const smooth01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }; const edge = rr > 0.8 && d0.y > -0.3 ? 0.12 : 0, trr = smooth01((p.x - AX) / 6) * smooth01((p.y - 13) / 5) * 0.2;
          if (rnd(0, 1) < 0.17 + edge + trr) { const k = rnd(0, 1); if (k < 0.5) col.setRGB(1.5, 1.08, 0.22); else if (k < 0.85) col.setRGB(1.6, 0.78, 0.2); else col.setRGB(1.3, 0.5, 0.18); /* saturated gold, orange, rust (Env: the sprigs went tan) */ col.multiplyScalar(rnd(0.85, 1.05)); } }
        im.setColorAt(n, col); shade[n] = (0.45 + 0.55 * rr) * (0.72 + 0.4 * Math.max(0, d0.y)); n++; continue; }
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
      sc.setScalar(MOB(o) ? rnd(4.7, 6.1) : rnd(4.4, 5.8));
      m4.compose(p, q, sc); im.setMatrixAt(n, m4);
      // phones have no inner cards, so some shell cards take the darker inner shade to keep the clumps' depth
      const rs = MOB(o) && rnd(0, 1) < 0.35 ? rnd(0.4, 0.78) : rr;
      if (MOB(o) && rs < 0.62 && rnd(0, 1) < 0.5) continue; // [ENV perf] half of the deepest-shade shell cards: mostly covered by the cards in front (overdraw)
      const r = rnd(0.82, 1.08); col.setRGB(r, r * rnd(0.97, 1.04), r * rnd(0.88, 1));
      // lighter, yellow-green leaves on the clump edges and the odd autumn-yellow card, like the photo
      if (rs > 0.8 && (!MOB(o) || rnd(0, 1) < 0.75) && dir.y > -0.2) col.multiply(new THREE.Color(1.18, 1.14, 0.8));
      // autumn (Environment, per the coordinator): ~30% warm cards, most on the clump edges and the crown's top-right like the
      // photo: gold, orange and a few rust; the crown stays mostly green
      { const smooth01 = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); }; const edge = rs > 0.8 && dir.y > -0.3 ? 0.22 : 0, tr = smooth01((p.x - AX) / 6) * smooth01((p.y - 13) / 5) * 0.22;
        const w = rnd(0, 1); if (w < 0.14 + edge + tr) { const k = rnd(0, 1); if (k < 0.5) col.setRGB(1.5, 1.22, 0.42); else if (k < 0.85) col.setRGB(1.6, 0.98, 0.38); else col.setRGB(1.3, 0.68, 0.32); col.multiplyScalar(rnd(0.85, 1.05)); } }
      im.setColorAt(n, col);
      shade[n] = (0.5 + 0.5 * Math.min(1, rs)) * (0.7 + 0.5 * Math.max(0, dir.y));
      n++;
    }
  }
  im.count = n;
  qg.setAttribute('shade', new THREE.InstancedBufferAttribute(shade, 1)); qg.setAttribute('aCC', new THREE.InstancedBufferAttribute(cc, 3));
  im.castShadow = !MOB(o); im.receiveShadow = true; group.add(im);

  // ---------- phones: clump impostors (Optimization: the leaf cards were the biggest per-pixel cost) ----------
  // A few leaf cards are rendered once into a small atlas (two sub-clumps, lit top/front, with the odd autumn-yellow
  // leaf), and each clump gets a handful of camera-facing quads with it: far less overlap than hundreds of cards, the
  // same full silhouette. Quads turn to the camera in the vertex shader, so they never show as flat planes edge-on.
  if (MOB(o) && o.renderer && o.leafImpostors === true) { // off: Pavel wants the crisp big leaves of the photo, not baked clumps // (2026-11-23 the first try baked off-atlas at the phone's pixel ratio: no foliage)
    try {
      const R2 = o.renderer, S = 256, rt = new THREE.WebGLRenderTarget(S * 2, S, { depthBuffer: true });
      rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter; rt.texture.colorSpace = leafT.colorSpace;
      const bs = new THREE.Scene(), bm = new THREE.MeshBasicMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide }), NB = 90;
      const bq = new THREE.PlaneGeometry(1, 1), cam = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.1, 20); cam.position.set(0, 0, 8); cam.lookAt(0, 0, 0);
      const prev = R2.getRenderTarget(), cc = R2.getClearColor(new THREE.Color()), ca = R2.getClearAlpha(), vp = new THREE.Vector4(); R2.getViewport(vp);
      const ac = R2.autoClear; R2.autoClear = false; /* each render would clear the other half */ R2.setRenderTarget(rt); R2.setClearColor(0x000000, 0); R2.clear();
      for (let v = 0; v < 2; v++) {
        const bim = new THREE.InstancedMesh(bq, bm, NB); bs.clear(); bs.add(bim);
        for (let k = 0; k < NB; k++) {
          let x, y, z; do { x = rnd(-1, 1); y = rnd(-1, 1); z = rnd(-1, 1); } while (x * x + y * y + z * z > 1);
          const r = Math.hypot(x, y, z), d = V(x, y * 0.9, z).multiplyScalar(0.92);
          q.setFromEuler(new THREE.Euler(rnd(-0.7, 0.7), rnd(-0.7, 0.7), rnd(0, 6.28))); sc.setScalar(rnd(0.55, 0.85));
          m4.compose(d, q, sc); bim.setMatrixAt(k, m4);
          let sh = (0.62 + 0.42 * (y + 1) / 2) * (z > 0 ? 1.06 : 0.86) * (0.75 + 0.25 * Math.min(1, r + 0.2));
          col.setRGB(sh, sh * rnd(0.97, 1.04), sh * rnd(0.88, 1));
          if (r > 0.75 && y > -0.2) col.multiply(new THREE.Color(1.15, 1.12, 0.82));
          if (rnd(0, 1) < 0.08) col.setRGB(1.45 * sh, 1.2 * sh, 0.45 * sh);
          bim.setColorAt(k, col);
        }
        // the target's own viewport (setViewport would scale by the device pixel ratio and miss the atlas on phones)
        rt.viewport.set(v * S, 0, S, S); R2.setRenderTarget(rt); R2.render(bs, cam); bim.dispose();
      }
      // safety: if the bake came out empty (any GPU surprise), keep the leaf cards
      { const px = new Uint8Array(S * 2 * S * 4); R2.readRenderTargetPixels(rt, 0, 0, S * 2, S, px); let on = [0, 0];
        for (let i = 3; i < px.length; i += 4 * 7) if (px[i] > 128) on[((i >> 2) % (S * 2)) < S ? 0 : 1]++;
        if (on[0] < 1500 || on[1] < 1500) { rt.viewport.set(0, 0, S * 2, S); R2.setRenderTarget(prev); R2.setClearColor(cc, ca); R2.autoClear = ac; throw new Error('empty bake ' + on); } }
      rt.viewport.set(0, 0, S * 2, S); R2.setRenderTarget(prev); R2.autoClear = ac; R2.setClearColor(cc, ca); bm.dispose(); bq.dispose();
      const imat = new THREE.MeshLambertMaterial({ map: rt.texture, alphaTest: 0.5, side: THREE.DoubleSide });
      imat.onBeforeCompile = sh => {
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aVar;varying float vDep;')
          .replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv=vec2((vMapUv.x+aVar)*.5,vMapUv.y);\n#endif')
          .replace('#include <beginnormal_vertex>', `vec3 ipI=vec3(instanceMatrix[3][0],instanceMatrix[3][1],instanceMatrix[3][2]);
vec3 objectNormal=normalize(vec3(ipI.x-(${AX.toFixed(3)}),0.,ipI.z-(${AZ.toFixed(3)}))*.8+vec3(0.,.75,0.)+vec3(viewMatrix[0][2],viewMatrix[1][2],viewMatrix[2][2])*.5);
#ifdef USE_TANGENT
vec3 objectTangent=vec3(tangent.xyz);
#endif`)
          .replace('#include <begin_vertex>', `float hh=fract(sin(dot(ipI,vec3(12.99,78.23,37.71)))*4375.5)*6.283;vec2 pr=mat2(cos(hh),sin(hh),-sin(hh),cos(hh))*position.xy;
 vec3 rgt=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),upv=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
 vec3 transformed=rgt*pr.x+upv*pr.y;`);
        const W = o.wind || window.__wind;
        if (W) { W.hook(sh); sh.vertexShader = sh.vertexShader.replace('vec3 transformed=rgt*pr.x+upv*pr.y;', `vec3 transformed=rgt*pr.x+upv*pr.y;
 float isz=max(length(instanceMatrix[0].xyz),.001);vec2 wv=windSway(ipI,2.3)*.15;float s=windStrength(ipI);
 transformed+=(windLocal(vec3(wv.x,wv.x*.15,wv.y)+windBranch(ipI,vec2(${AX.toFixed(3)},${AZ.toFixed(3)})))+vec3(sin(uWT*2.1+hh)*.02,0.,cos(uWT*1.7+hh)*.02)*(1.+3.*s))/isz;`); }
        sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvDep=-mvPosition.z;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vDep;')
          .replace('#include <alphatest_fragment>', 'diffuseColor.a*=smoothstep(.9,3.2,vDep);\n#include <alphatest_fragment>')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=diffuseColor.rgb*vec3(.06,.09,.08);');
      };
      imat.customProgramCacheKey = () => 'oakImp';
      const KQ = o.impK ?? 2, QS = o.impQ ?? 1.6, imps = [];
      for (const s2 of leafSpots) for (let i = 0; i < KQ; i++) {
        let dx, dy, dz; do { dx = rnd(-1, 1); dy = rnd(-0.5, 1); dz = rnd(-1, 1); } while (dx * dx + dy * dy + dz * dz > 1);
        const rr = rnd(0.15, 0.4), Q = s2.s * QS * rnd(0.85, 1.1);
        const p = s2.p.clone().add(V(dx * s2.s * rr, dy * s2.s * 0.6 * rr, dz * s2.s * rr));
        if (inB(p.x, p.y, p.z, Q * 0.42)) continue;
        imps.push([p, Q]);
      }
      const ig = new THREE.CircleGeometry(0.5, 8) /* octagon: the round clump without the empty quad corners */, imp = new THREE.InstancedMesh(ig, imat, imps.length), av = new Float32Array(imps.length);
      imps.forEach(([p, Q], i) => { m4.compose(p, q.identity(), V(Q, Q, Q)); imp.setMatrixAt(i, m4); const r = rnd(0.86, 1.08); imp.setColorAt(i, col.setRGB(r, r * rnd(0.97, 1.03), r * rnd(0.9, 1))); av[i] = i % 2; });
      ig.setAttribute('aVar', new THREE.InstancedBufferAttribute(av, 1));
      imp.frustumCulled = false; imp.castShadow = false; imp.receiveShadow = true; imp.name = 'oakLeafImpostors';
      group.remove(im); im.geometry.dispose(); group.add(imp); im = imp;
    } catch (e) { console.warn('oak leaf impostors', e); }
  }

  // ---------- the hollow: a real cavity in the wood behind the arched opening (critic N4) ----------
  // A closed ellipsoid seen from inside, big enough that no line of sight through the opening reaches the trunk's
  // open shell (so nothing behind the tree shows through). Anything of it outside the bark is discarded in the
  // shader, so the bark lip is the edge. Inside: rough end-grain wood with growth rings and fibres, darker further in;
  // warm light only from the cave lamp (Lights) and the faint door glow.
  {
    const hh = door.y1 - door.y0, Rm = R(door.y0 + hh / 2);
    const dirx = Math.cos(doorAng), dirz = Math.sin(doorAng);
    const A = 1.55, B = hh * 0.95, Cl = Math.max(1.0, door.w * 1.0), off = Rm - 1.25;
    const cx = AX + dirx * off, cz = AZ + dirz * off, cy = door.y0 + hh * 0.38;
    const U = { doorGlow: mat.userData.doorGlow, cAx: { value: new THREE.Vector2(AX, AZ) }, cDir: { value: new THREE.Vector2(dirx, dirz) }, cR: { value: Rm - 0.04 }, cRs: { value: ARCH && ARCH.rs ? ARCH.rs - 0.08 : 99 }, cRa: { value: ARCH && ARCH.ra ? ARCH.ra.map(v => v - 0.08) : new Array(17).fill(99) }, cW: { value: door.w * 0.5 + 0.12 }, /* critic T25: only the shell seen through the arch may pass the bark; a straight lateral band let it poke out beside and above the arch as an orange crescent */ cY: { value: new THREE.Vector3(door.y0, door.y1, door.w * 0.47) },
      cC: { value: new THREE.Vector3(cx, cy, cz) }, cS: { value: new THREE.Vector3(A, B, Cl) } };
    const clip = sh => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vCW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvCW=(modelMatrix*vec4(transformed,1.)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vCW;uniform float doorGlow;uniform vec2 cAx;uniform vec2 cDir;uniform float cR;uniform float cRs;uniform float cRa[17];uniform float cW;uniform vec3 cY;uniform vec3 cC;uniform vec3 cS;
float cH(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float cN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(cH(i),cH(i+vec2(1,0)),f.x),mix(cH(i+vec2(0,1)),cH(i+vec2(1,1)),f.x),f.y);}`)
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n{vec2 r=vCW.xz-cAx;if(dot(r,cDir)>cR)discard;float lat=-r.x*cDir.y+r.y*cDir.x;float an=atan(lat,dot(r,cDir));float fk=clamp((an+1.6)/.2,0.,16.);int k0=int(floor(fk));int k1=min(k0+1,16);float rr=mix(cRa[k0],cRa[k1],fk-float(k0));float cvy=(vCW.y-cY.x)/(cY.y-cY.x),cda=abs(lat)/cY.z;bool inA=cvy<.62?cda<1.:length(vec2(cda,(cvy-.62)/.38*1.1))<1.;if(length(r)>min(rr,99.)&&!inA)discard;}');
    };
    const cmat = new THREE.MeshStandardMaterial({ color: 0x6E4A32, roughness: 1, side: THREE.BackSide });
    cmat.onBeforeCompile = sh => {
      clip(sh);
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
 {vec3 q=vCW-cC;vec2 dd=cDir;float u=dot(q.xz,dd);float v=-q.x*dd.y+q.z*dd.x;
  float inn=clamp((cS.x*.55-u)/(cS.x*1.4),0.,1.);              // 0 at the mouth .. 1 at the back
  // Critic T21: no growth rings (they only show on a saw cut; round the axis they read as a painted disc on the back wall).
  // Inside a hollow trunk the grain runs UP: torn vertical fibres, dark splits, soft rot patches.
  float ha=atan(v,u);
  float fib=cN(vec2(ha*14.,q.y*1.3))*.55+cN(vec2(ha*43.,q.y*4.))*.3+cN(vec2(ha*120.,q.y*9.))*.15;
  float crack=smoothstep(.07,.0,abs(cN(vec2(ha*5.,q.y*.7))-.5));
  float rot=smoothstep(.55,.8,cN(vec2(ha*3.,q.y*1.6)+7.));
  vec3 c=mix(vec3(.13,.08,.05),vec3(.28,.18,.11),fib)*(1.-.6*crack)*mix(1.,.6,rot);
  diffuseColor.rgb=c*mix(1.,.15,pow(inn,.8));}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
 {vec3 q=vCW-cC;float u=dot(q.xz,cDir);float v=-q.x*cDir.y+q.z*cDir.x;float an=atan(q.y,v);
  float ha=atan(v,u); float hgt=cN(vec2(ha*14.,q.y*1.3))*.55+cN(vec2(ha*43.,q.y*4.))*.3-smoothstep(.07,0.,abs(cN(vec2(ha*5.,q.y*.7))-.5))*1.2;
  vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition);float hx=dFdx(hgt),hy=dFdy(hgt);
  vec3 r1=cross(dpy,normal),r2=cross(normal,dpx);float det=dot(dpx,r1);
  normal=normalize(abs(det)*normal-sign(det)*(hx*r1+hy*r2)*.1);}`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{float u2=dot((vCW-cC).xz,cDir);totalEmissiveRadiance+=vec3(1.,.55,.22)*diffuseColor.rgb*doorGlow*2.3*(.35+.65*smoothstep(-1.,1.,u2));}');
    };
    cmat.customProgramCacheKey = () => 'hollow2';
    // rough, uneven walls (critic N4: a smooth dome reads as plastic): ridges of wood fibre running into the trunk and
    // lumps of rot, pushed inwards only so the cave never grows past the bark
    const cgeo = new THREE.SphereGeometry(1, MOB(o) ? 40 : 64, MOB(o) ? 26 : 40);
    { const pa = cgeo.attributes.position; for (let i = 0; i < pa.count; i++) { const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
        // vertical ridges of torn heartwood and lumps of rot all round, deepest on the back wall facing the opening (T21)
        const a = Math.atan2(z, x), bf = 0.6 + 0.6 * Math.min(1, Math.max(0, (0.2 - x) / 1.0)), w = Math.sin(y * 3.1) * 0.8 + y * 0.6;
        const k = 1 - bf * (0.09 * Math.pow(0.5 + 0.5 * Math.sin(a * 9 + w), 3) + 0.05 * (0.5 + 0.5 * Math.sin(a * 4 + y * 5 + 1.3)) * (0.5 + 0.5 * Math.sin(y * 9 + a * 2))
          + 0.03 * (0.5 + 0.5 * Math.sin(a * 23 + y * 2.3)) + 0.02 * Math.sin(a * 41 + y * 13) * Math.sin(y * 17 - a * 5));
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
    fmat.customProgramCacheKey = () => 'hollowfloor2';
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
