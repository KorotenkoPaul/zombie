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
  const R = y => {
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
  const trunkPts = []; for (let y = -0.6; y <= 13.6; y += 0.6) trunkPts.push(V(AX + 0.12 * Math.sin(y * 0.33), y, AZ + 0.1 * Math.sin(y * 0.27 + 1)));
  const parts = [];
  parts.push(tube(trunkPts, MOB(o) ? 110 : 150, MOB(o) ? 72 : 96, trunkR, { tile: 3.2, hole: (c, ang) => doorMask(ang, c.y) < 0.97, glow: (p, t, ang) => { const m = doorMask(ang, p.y); return m < 1.5 ? Math.max(0, 1 - (m - 0.9) / 0.6) * 0.5 : 0; } }));

  // ---------- roots: spread over the ground, sinking into it ----------
  const roots = [[0.35, 6.5], [0.95, 5.2], [2.2, 5.6], [2.75, 7.0], [3.6, 5.0], [4.35, 6.0], [5.2, 5.4], [5.85, 6.2]];
  for (const [a, L] of roots) {
    const dx = Math.cos(a), dz = Math.sin(a), sx = -dz, sz = dx;
    const r0 = R(0.5) * 0.85;
    const wig = rnd(-0.6, 0.6);
    const pts = [V(AX + dx * r0 * 0.6, 1.5, AZ + dz * r0 * 0.6), V(AX + dx * (r0 + 0.3), 0.75, AZ + dz * (r0 + 0.3)),
      V(AX + dx * (r0 + L * 0.35) + sx * wig * 0.5, 0.32, AZ + dz * (r0 + L * 0.35) + sz * wig * 0.5),
      V(AX + dx * (r0 + L * 0.7) + sx * wig, 0.12, AZ + dz * (r0 + L * 0.7) + sz * wig),
      V(AX + dx * (r0 + L) + sx * wig * 0.6, -0.35, AZ + dz * (r0 + L) + sz * wig * 0.6)];
    parts.push(tube(pts, 34, 18, (t, ang) => (0.95 * Math.pow(1 - t, 1.3) + 0.09) * (1 + 0.06 * Math.sin(ang * 5 + t * 9)), { tile: 1.4, flat: 0.72 }));
  }

  // ---------- branches: all leave from the back half of the trunk so they pass behind the rooms ----------
  const BR = [
    // side branches (from the photo: one long to the left at kitchen height, two to the right)
    { p: [[0, 6.4, -1.0], [-2.4, 6.8, -1.7], [-5.0, 7.5, -2.2], [-7.6, 8.7, -2.0], [-9.4, 10.3, -1.5]], r0: 0.62, r1: 0.12, leaf: [1, 3, 3] },
    { p: [[0.3, 7.2, -1.0], [2.6, 7.5, -1.6], [5.2, 7.8, -1.5], [7.6, 8.6, -0.9], [9.2, 9.8, -0.4]], r0: 0.56, r1: 0.1, leaf: [2, 3] },
    { p: [[0.4, 9.7, -1.0], [3.0, 9.4, -1.3], [5.6, 10.2, -1.1], [8.4, 11.6, -0.5]], r0: 0.5, r1: 0.1, leaf: [2, 3] },
    { p: [[-0.3, 11, -0.9], [-2.6, 11.9, -1.3], [-5.0, 13, -1.1], [-7.2, 14.4, -0.4]], r0: 0.55, r1: 0.12, leaf: [1, 3, 3] },
    // crown limbs
    { p: [[0, 10.8, -0.6], [-0.7, 13.4, -0.8], [-1.9, 16, -1.1], [-3.2, 18.4, -1.4]], r0: 1.0, r1: 0.25, leaf: [1, 3, 3] },
    { p: [[0.1, 10.8, -0.6], [1.3, 13.5, -0.4], [2.7, 15.8, -0.8], [3.8, 18.2, -1.2]], r0: 0.95, r1: 0.22, leaf: [1, 3, 3] },
    { p: [[0, 11.4, -0.9], [0.3, 14, -2.3], [0.5, 16.8, -3.0], [0.6, 19.4, -2.6]], r0: 0.8, r1: 0.2, leaf: [2, 3] },
    { p: [[-0.2, 12, -0.5], [-2.2, 14.2, 0.2], [-4.4, 15.6, 0.6], [-6.4, 16.2, 0.4]], r0: 0.55, r1: 0.12, leaf: [2, 3] },
    { p: [[0.2, 12.2, -0.5], [2.5, 13.6, 0.0], [4.8, 14.6, 0.4], [6.8, 15, 0.2]], r0: 0.5, r1: 0.12, leaf: [2, 3] },
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

  // ---------- bark: the painted texture along the wood, relief from the same texture, cool-warm painted shading ----------
  const barkT = o.barkT; barkT.wrapS = barkT.wrapT = THREE.RepeatWrapping; barkT.repeat.set(1, 1);
  const mat = new THREE.MeshStandardMaterial({ map: barkT, bumpMap: barkT, bumpScale: 1.4, roughness: 0.9, color: 0xFFDCC2 });
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;varying float vGlow;varying float vY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGlow=glow;vY=(modelMatrix*vec4(transformed,1.)).y;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;varying float vY;uniform float doorGlow;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb*=mix(.8,1.,smoothstep(-.3,2.2,vY));
`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.5,.18)*vGlow*diffuseColor.rgb*doorGlow*1.6+diffuseColor.rgb*vec3(.05,.065,.09);');
    sh.uniforms.doorGlow = mat.userData.doorGlow;
  };
  mat.userData.doorGlow = { value: 0 };
  const bark = new THREE.Mesh(g, mat); bark.castShadow = true; bark.receiveShadow = true; group.add(bark);

  // ---------- leaves: clumps of painted oak-leaf cards, facing outwards like the painted crown ----------
  const LA = o.avoidLeaves || [];
  const inB = (x, y, z, p) => LA.some(b => x > b[0] - p && x < b[1] + p && y > b[2] - p && y < b[3] + p && z > b[4] - p && z < b[5] + p);
  const leafT = o.leafT; leafT.wrapS = leafT.wrapT = THREE.ClampToEdgeWrapping; leafT.repeat.set(1, 1);
  const lmat = new THREE.MeshStandardMaterial({ map: leafT, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  // soft, lit-from-above clumps: cards near the clump centre are darker (painted volume)
  lmat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float shade;varying float vShade;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvShade=shade;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vShade;').replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb*=vShade;');
  };
  const total = MOB(o) ? 800 : 1300;
  const want = []; let sumS = 0; for (const s of leafSpots) sumS += s.s * s.s;
  const qg = new THREE.PlaneGeometry(1, 1);
  const im = new THREE.InstancedMesh(qg, lmat, total);
  const shade = new Float32Array(total);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = V(1, 1, 1), col = new THREE.Color();
  let n = 0;
  for (const s of leafSpots) {
    const k = Math.round(total * s.s * s.s / sumS);
    for (let i = 0; i < k && n < total; i++) {
      // points on a squashed sphere shell (more on top), facing out
      let dx, dy, dz; do { dx = rnd(-1, 1); dy = rnd(-0.45, 1); dz = rnd(-1, 1); } while (dx * dx + dy * dy + dz * dz > 1);
      const dir = V(dx, dy, dz); const rr = Math.max(0.35, dir.length()); dir.normalize();
      const p = s.p.clone().add(V(dir.x * s.s * rr, dir.y * s.s * 0.7 * rr, dir.z * s.s * rr));
      if (inB(p.x, p.y, p.z, 0.8)) continue;
      const look = new THREE.Matrix4().lookAt(V(0, 0, 0), dir, V(0, 1, 0));
      q.setFromRotationMatrix(look).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(0, 6.28))));
      sc.setScalar(rnd(1.5, 2.4));
      m4.compose(p, q, sc); im.setMatrixAt(n, m4);
      const r = rnd(0.82, 1.08); col.setRGB(r, r * rnd(0.97, 1.04), r * rnd(0.88, 1)); im.setColorAt(n, col);
      shade[n] = 0.55 + 0.45 * Math.min(1, rr) * (0.75 + 0.25 * Math.max(0, dir.y));
      n++;
    }
  }
  im.count = n;
  qg.setAttribute('shade', new THREE.InstancedBufferAttribute(shade, 1));
  im.castShadow = !MOB(o); im.receiveShadow = true; group.add(im);

  // ---------- the cave behind the glowing hollow: a warm little room carved into the trunk ----------
  {
    const yc0 = door.y0 - 0.02, hh = door.y1 - door.y0, cr = door.w * 0.62, dep = door.depth || 0.95;
    const cd = 0.95, dist = R(yc0 + hh / 2) - cd + 0.12;
    const cx = AX + Math.cos(doorAng) * dist, cz = AZ + Math.sin(doorAng) * dist;
    const cmat = new THREE.MeshStandardMaterial({ color: 0x7A4A2A, roughness: 0.95, side: THREE.BackSide });
    cmat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float doorGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.55,.22)*diffuseColor.rgb*doorGlow*.55;');
      sh.uniforms.doorGlow = mat.userData.doorGlow;
    };
    const cave = new THREE.Group(); cave.position.set(cx, yc0, cz); cave.rotation.y = -doorAng; group.add(cave);
    const sh0 = new THREE.Group(); sh0.scale.set(cd / cr, 1, door.w * 0.56 / cr); cave.add(sh0);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(cr, cr * 1.08, hh * 0.65, 20, 1, true), cmat); wall.position.y = hh * 0.325; sh0.add(wall);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(cr, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), cmat); dome.scale.y = hh * 0.35 / cr / 0.95; dome.position.y = hh * 0.65; sh0.add(dome);
    // plank floor, slightly worn, lit by the glow
    const fmat = new THREE.MeshStandardMaterial({ color: 0x9A6238, roughness: 0.85 });
    fmat.onBeforeCompile = sh => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float doorGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.55,.22)*diffuseColor.rgb*doorGlow*.4;');
      sh.uniforms.doorGlow = mat.userData.doorGlow;
    };
    const fl = new THREE.Mesh(new THREE.CircleGeometry(cr * 1.07, 20), fmat); fl.rotation.x = -Math.PI / 2; fl.position.y = 0.035; sh0.add(fl);
    const seamM = new THREE.MeshBasicMaterial({ color: 0x3A2214 });
    for (let i = -2; i <= 2; i++) { const g = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.004, cd * 2 * Math.sqrt(Math.max(0.01, 1 - (i * 0.11 / (door.w * 0.56)) ** 2))), seamM); g.rotation.y = Math.PI / 2; g.position.set(0, 0.038, i * 0.11); cave.add(g); }
    cave.traverse(m => { if (m.isMesh) m.receiveShadow = true; });
  }

  // world-space triangle soup for physics / slicing
  const tris = new Float32Array(I.length * 3);
  for (let i = 0; i < I.length; i++) { tris[i * 3] = P[I[i] * 3]; tris[i * 3 + 1] = P[I[i] * 3 + 1]; tris[i * 3 + 2] = P[I[i] * 3 + 2]; }
  return { group, bark, leaves: im, tris, axis: [AX, AZ], doorAngle: doorAng, R };
}
function MOB(o) { return !!o.MOBILE; }
