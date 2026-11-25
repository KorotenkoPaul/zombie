// House wear you can see (Pavel: wear builds up over time, faster in rain and wind; 5-10 repair actions put it right).
// Real parts of the house move, nothing is painted on:
//  * floor   - a loose board: the end away from where he kneels lifts ~1.4 cm and the board twists a little (gap and shadow under it)
//  * wall    - a warped board: one end springs out ~1.8 cm from its neighbours
//  * beam    - a rail post leans out ~4 cm at the top, or a rail brace sags ~3 cm at one end
//  * shingle - a slate slips: it swings on its last nail (~9 deg), slides 1.2 cm down and its lower edge lifts off the roof
//  * rope    - the gate rope ladder frays at its two tie knots (loose fibres) while it wears
// The damaged part's centre never moves more than ~3 cm, so the hero's hammer (hero.js nailOf) still lands on it.
// Repairs: brain.js markRepaired -> __planks.setFresh(id, 1) clears that part (it eases back into place, then looks new);
// list() reports dmg and lowers `fresh` by it, so Brain's and hero.js pickPart's "oldest part" choice goes to a damaged one.
// The rope mends while he works the knots (fix_rope). QA runs (__fixedStart) get no wear unless ?wear is in the URL.
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function createHouseWear({ THREE, planks, N, hour, hero, ladder, windows = [] }) {
  const OFF = (window.__fixedStart && !/[?&]wear\b/.test(location.search)) || /[?&]nowear\b/.test(location.search);
  // own random stream: never draws from Math.random (the QA harness seeds it; other code must keep its numbers)
  let seed = (Date.now() ^ 0x9E3779B9) >>> 0;
  const rnd = (a = 0, b = 1) => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return a + (b - a) * (((t ^ t >>> 14) >>> 0) / 4294967296); };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
  const crackMat = new THREE.MeshBasicMaterial({ color: 0xDDE6EA, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
  const nodes = []; for (const k in N) { const n = N[k]; if (n && n.p && n.seat == null) nodes.push(n.p); }
  const nearNode = p => { let b = null, bd = 1e9; for (const q of nodes) { const d = Math.hypot(q.x - p.x, q.z - p.z) + Math.abs(q.y - p.y) * 2; if (d < bd) { bd = d; b = q; } } return b; };

  // ---------- candidates: parts he can really get at ----------
  const parts = new Map();   // id -> part state
  const setFresh0 = planks.setFresh, list0 = planks.list;
  const M = new THREE.Matrix4(), P = V(), Q = new THREE.Quaternion(), S = V();
  // nothing lies on or against it: a lifted board under a rug or a chest, a warped one behind the tool board would cut into them
  let boxes = null;
  function propBoxes() {
    if (boxes) return boxes; boxes = []; const skip = new Set(Object.values(planks.meshes || {})); let root = planks.meshes.boards; while (root.parent) root = root.parent;
    const b = new THREE.Box3(), sz = V();
    root.traverse(o => { if (!o.isMesh || skip.has(o) || o.isSkinnedMesh || !o.geometry) return; if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); b.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
      b.getSize(sz); if (sz.x > 3 || sz.z > 3 || sz.y > 3 || b.max.y < 2) return; boxes.push(b.clone()); });
    return boxes;
  }
  function clear(c, ax, sz, pad) {
    const B = propBoxes(), q = V();
    for (let a = -1; a <= 1; a += .5) for (let w = -1; w <= 1; w += 1) {
      q.copy(c).addScaledVector(ax[0], a * sz[0] / 2).addScaledVector(ax[1], w * sz[1] / 2).addScaledVector(ax[2], w * sz[2] / 2);
      for (const bx of B) if (q.x > bx.min.x - pad && q.x < bx.max.x + pad && q.y > bx.min.y - pad && q.y < bx.max.y + pad && q.z > bx.min.z - pad && q.z < bx.max.z + pad) return false;
    }
    return true;
  }
  function candidates() {
    for (const kind of ['floor', 'wall', 'beam', 'shingle']) for (const it of planks.list(kind)) {
      const pl = planks.part && planks.part(it.id); if (!pl || !pl.mesh) continue;
      pl.mesh.getMatrixAt(pl.i, M); M.decompose(P, Q, S);
      const ax = [V(1, 0, 0).applyQuaternion(Q), V(0, 1, 0).applyQuaternion(Q), V(0, 0, 1).applyQuaternion(Q)];
      const sz = [S.x, S.y, S.z]; const ord = [0, 1, 2].sort((a, b) => sz[b] - sz[a]); const L = ord[0], Wd = ord[1], T = ord[2];
      const c = P.clone(), n = nearNode(c); if (!n) continue;
      const hd = Math.hypot(n.x - c.x, n.z - c.z), dy = c.y - n.y;
      const long = ax[L], thin = ax[T];
      let ok = false, mode = kind;
      if (kind === 'floor') ok = Math.abs(thin.y) > .95 && sz[L] > .8 && hd < 2.2 && Math.abs(dy) < .2;
      else if (kind === 'wall') ok = Math.abs(thin.y) < .2 && sz[L] > .8 && sz[T] < .08 && hd < 1.6 && dy > .4 && dy < 1.35;
      else if (kind === 'beam') {
        if (Math.abs(long.y) > .97 && Math.abs(sz[L] - .94) < .03 && sz[Wd] < .14) { ok = hd < 1.6 && dy > .3 && dy < .7; mode = 'post'; }
        else if (Math.abs(long.y) < .1 && sz[Wd] < .1 && sz[L] > .6 && sz[L] < 4) { ok = hd < 1.6 && dy > .4 && dy < 1.05; mode = 'brace'; }
      } else if (kind === 'shingle') ok = hd < 1.5 && dy > .75 && dy < 1.3;
      if (ok && (mode === 'floor' || mode === 'wall' || mode === 'post' || mode === 'brace') && !clear(c, ax, sz, mode === 'floor' ? .04 : .07)) ok = false;
      if (!ok) continue;
      parts.set(it.id, { id: it.id, kind, mode, mesh: pl.mesh, i: pl.i, home: M.clone(), c, ax, sz, L, Wd, T, n: n.clone(), d: 0, vis: 0, sgn: rnd() < .5 ? -1 : 1, sgn2: rnd() < .5 ? -1 : 1 });
    }
  }

  // ---------- the damaged pose of one part at damage d (0..1) ----------
  const R = new THREE.Matrix4(), T1 = new THREE.Matrix4(), T2 = new THREE.Matrix4(), RQ = new THREE.Quaternion();
  function about(out, pivot, axis, ang) { RQ.setFromAxisAngle(axis, ang); R.makeRotationFromQuaternion(RQ); T1.makeTranslation(pivot.x, pivot.y, pivot.z); T2.makeTranslation(-pivot.x, -pivot.y, -pivot.z); return out.premultiply(T2).premultiply(R).premultiply(T1); }
  function pose(p, d) {
    const m = p.home.clone(); if (d <= 1e-4) return m;
    const long = p.ax[p.L].clone(), wid = p.ax[p.Wd].clone(), thin = p.ax[p.T].clone(), hl = p.sz[p.L] / 2;
    const away = V(p.c.x - p.n.x, 0, p.c.z - p.n.z); if (away.lengthSq() < 1e-6) away.set(1, 0, 0); away.normalize();
    if (p.mode === 'floor') {
      // pivot at the end nearer to where he kneels, the far end lifts (his knee and boots stay on the flat end)
      const u = long.clone().multiplyScalar(long.dot(away) >= 0 ? 1 : -1);
      const pivot = p.c.clone().addScaledVector(u, -hl), n = thin.y > 0 ? thin : thin.clone().negate();
      about(m, pivot, u.clone().cross(n).normalize(), (.014 * d + .04 * sstep(.5, .9, d)) / (2 * hl));   // a bad one: the end stands up ~5 cm (its collider moves too: his boots step onto it)
      about(m, p.c.clone().addScaledVector(u, hl * .5), u, .035 * d * p.sgn);   // cupped/twisted: one edge up a few mm
    } else if (p.mode === 'wall') {
      const out = thin.dot(away) >= 0 ? thin.clone() : thin.clone().negate();   // away from the room's walkway
      const u = long.clone().multiplyScalar(p.sgn), pivot = p.c.clone().addScaledVector(u, -hl);
      about(m, pivot, u.clone().cross(out).normalize(), .025 * d / (2 * hl));
      about(m, p.c, u, .03 * d * p.sgn2);
    } else if (p.mode === 'post') {
      const pivot = p.c.clone().addScaledVector(UP, -hl);                       // the foot stays nailed, the top leans out
      about(m, pivot, UP.clone().cross(away).normalize(), (.07 * d + .06 * sstep(.6, 1, d)) / (2 * hl));
      about(m, p.c, UP, .05 * d * p.sgn);
    } else if (p.mode === 'brace') {
      // it sags; a short rail between two posts works loose at one end and hangs out and down off the post
      const u = long.clone().multiplyScalar(p.sgn), pivot = p.c.clone().addScaledVector(u, -hl), L2 = 2 * hl;
      const off = L2 < 1.2 ? sstep(.5, .9, d) : 0;
      about(m, pivot, u.clone().cross(V(0, -1, 0)).normalize(), (.05 * d + .3 * off) / L2);
      about(m, pivot, UP, Math.sign(u.clone().cross(UP).dot(away) || 1) * -.14 * off / L2);   // swings out past the post's face
      about(m, p.c, u, .06 * d * p.sgn2);
    } else if (p.mode === 'shingle') {
      // the slate hangs from its last nail near the top edge and swings, slides a little and its lower edge lifts off
      const lu = Math.abs(long.y) > Math.abs(wid.y);
      const up = (lu ? long : wid).clone(), hu = (lu ? p.sz[p.L] : p.sz[p.Wd]) / 2; if (up.y < 0) up.negate();
      const side = (lu ? wid : long).clone(), hs = (lu ? p.sz[p.Wd] : p.sz[p.L]) / 2;
      const n = thin.y > 0 ? thin : thin.clone().negate();
      const nail = p.c.clone().addScaledVector(up, hu * .8).addScaledVector(side, hs * .45 * p.sgn);
      const slip = sstep(.55, 1, d);                         // a bad one has slid well down, the roof board shows above it
      about(m, nail, n, (.16 * d + .45 * slip) * -p.sgn);   // hangs on its one nail
      const lowEdge = p.c.clone().addScaledVector(up, hu);
      about(m, lowEdge, side, -.07 * d * Math.sign(side.clone().cross(up).dot(n) || 1));
      const sl = up.clone().multiplyScalar(-.012 * d - .24 * slip).addScaledVector(n, .012 * slip); T1.makeTranslation(sl.x, sl.y, sl.z); m.premultiply(T1);
    }
    return m;
  }

  // ---------- the gate rope ladder: loose fibres at the two tie knots and where the rope rubs over the floor edge ----------
  let fray = null;
  if (ladder) {
    const { x, z, top } = ladder, groups = [];
    const strand = (o, dir, len, r) => { const pts = []; const bend = V(rnd(-1, 1), rnd(-.2, 1), rnd(-1, 1)).normalize().multiplyScalar(len * .35);
      for (let k = 0; k <= 5; k++) { const t = k / 5; pts.push(o.clone().addScaledVector(dir, len * t).addScaledVector(bend, t * t).add(V(0, -len * .25 * t * t, 0))); }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 5, r, 3); };
    const spots = [];
    for (const sx of [-.29, .29]) {
      const knot = V(x + sx * 1.05, top + .04, z - .34);
      for (let k = 0; k < 14; k++) { const a = rnd(0, Math.PI * 2), e = rnd(-.3, .9); const dir = V(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e)); spots.push([knot.clone().addScaledVector(dir, .05).add(V(0, -.005, 0)), dir, rnd(.03, .075), rnd(.0012, .0019), rnd()]); }
      const edge = V(x + sx, top + .045, z - .1);   // where the rope goes over the floor edge
      for (let k = 0; k < 6; k++) { const dir = V(rnd(-1, 1), rnd(.2, 1), rnd(-.6, .6)).normalize(); spots.push([edge.clone().add(V(rnd(-.012, .012), 0, rnd(-.05, .05))), dir, rnd(.02, .05), rnd(.001, .0016), rnd()]); }
    }
    spots.sort((a, b) => a[4] - b[4]);   // the first fibres to come loose come first in the buffer: drawRange shows the wear
    const geos = spots.map(s => strand(s[0], s[1], s[2], s[3]));
    const counts = []; let acc = 0; for (const g of geos) { acc += g.index.count; counts.push(acc); }
    const merged = mergeGeos(THREE, geos);
    const mat = new THREE.MeshStandardMaterial({ color: 0xC4AC80, roughness: 1 });
    const mesh = new THREE.Mesh(merged, mat); mesh.name = 'ropeFray'; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    fray = { mesh, counts, d: 0, vis: -1, at: V(x, top, z - .2) };
    mesh.geometry.setDrawRange(0, 0); mesh.visible = false;
  }

  // ---------- nails: bright new heads where he drove them, dulling to old iron over ~3 game days ----------
  const NMAX = 240, nailGeo = new THREE.CylinderGeometry(.0048, .0052, .004, 8); nailGeo.translate(0, .0012, 0);
  const nails = new THREE.InstancedMesh(nailGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: .85, roughness: .32 }), NMAX);
  nails.name = 'repairNails'; nails.count = 0; nails.frustumCulled = false; nails.castShadow = false; nails.receiveShadow = true;
  nails.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nails.setColorAt(0, new THREE.Color(1, 1, 1));
  const born = new Float32Array(NMAX); let nNext = 0, gameT = 0, nailCT = 0;
  const NEW = new THREE.Color(.95, .95, .98), OLD = new THREE.Color(.34, .3, .26), tc = new THREE.Color();
  function nail(pos, nrm) {
    if (!pos) return -1; const p = pos.isVector3 ? pos : V(...pos), n = nrm ? (nrm.isVector3 ? nrm.clone() : V(...nrm)).normalize() : UP.clone();
    const i = nNext; nNext = (nNext + 1) % NMAX; if (nails.count < NMAX) nails.count++;
    Q.setFromUnitVectors(UP, n); const tw = new THREE.Quaternion().setFromAxisAngle(UP, rnd(0, 6.28)); Q.multiply(tw);
    M.compose(p, Q, S.set(1, 1, 1)); nails.setMatrixAt(i, M); nails.instanceMatrix.needsUpdate = true;
    born[i] = gameT; nails.setColorAt(i, NEW); nails.instanceColor.needsUpdate = true; return i;
  }
  // the frame of any house part (for nails at its ends)
  function frameOf(id) {
    const p = parts.get(id); if (p) return p; const pl = planks.part && planks.part(id); if (!pl || !pl.mesh) return null;
    const m = new THREE.Matrix4(); pl.mesh.getMatrixAt(pl.i, m); const pp = V(), q = new THREE.Quaternion(), sc = V(); m.decompose(pp, q, sc);
    const ax = [V(1, 0, 0).applyQuaternion(q), V(0, 1, 0).applyQuaternion(q), V(0, 0, 1).applyQuaternion(q)], sz = [sc.x, sc.y, sc.z];
    const ord = [0, 1, 2].sort((a, b) => sz[b] - sz[a]); const n = nearNode(pp);
    return { id, kind: pl.kind, mode: pl.kind, c: pp, ax, sz, L: ord[0], Wd: ord[1], T: ord[2], n: n ? n.clone() : pp.clone().add(V(0, 0, 1)) };
  }
  // a board he renailed: two heads at each end, on the face he worked from (floor: the top; a wall or rail: the room side)
  function nailPart(id) {
    const f = frameOf(id); if (!f || f.kind === 'shingle' || f.kind === 'roof') return;
    const long = f.ax[f.L], wid = f.ax[f.Wd]; let n = f.ax[f.T].clone();
    if (Math.abs(n.y) > .7) { if (n.y < 0) n.negate(); } else { const to = V(f.n.x - f.c.x, 0, f.n.z - f.c.z); if (n.dot(to) < 0) n.negate(); }
    const hl = f.sz[f.L] / 2, hw = f.sz[f.Wd] / 2, ht = f.sz[f.T] / 2, ends = hl > .35 ? [-1, 1] : [0];
    for (const e of ends) for (const w of (hw > .05 ? [-.45, .45] : [0])) nail(f.c.clone().addScaledVector(long, e * (hl - .045) + rnd(-.01, .01)).addScaledVector(wid, w * hw).addScaledVector(n, ht), n);
  }

  // ---------- windows: a cracked pane (a stone, a branch in a storm): real shards, one small piece gone ----------
  const panes = [];
  for (const w of windows) {
    if (!w || !w.g || w.room === 'trunk') continue; const pm = w.g.children.find(o => o.isMesh && o.material === w.mat && o.geometry.parameters && o.geometry.parameters.width);
    if (!pm) continue; const { width: pw, height: ph } = pm.geometry.parameters;
    // impact point and radial cracks to the frame, a ring of short cracks round it; the shards tilt a hair each (the reflection breaks up)
    // the frame's cross divides it into four panes of glass: one of them breaks, the crack stops at its muntins
    const qx = rnd() < .5 ? -1 : 1, qy = rnd() < .5 ? -1 : 1, mb = .018, X0 = qx < 0 ? -pw / 2 : mb, X1 = qx < 0 ? -mb : pw / 2, Y0 = qy < 0 ? -ph / 2 : mb, Y1 = qy < 0 ? -mb : ph / 2;
    const ix = (X0 + X1) / 2 + rnd(-.25, .25) * (X1 - X0), iy = (Y0 + Y1) / 2 + rnd(-.25, .25) * (Y1 - Y0), nr = 6 + Math.floor(rnd() * 3), ang = []; for (let k = 0; k < nr; k++) ang.push((k + rnd(-.3, .3)) / nr * Math.PI * 2);
    const toEdge = a => { const dx = Math.cos(a), dy = Math.sin(a); let t = 1e9; if (Math.abs(dx) > 1e-6) t = Math.min(t, ((dx > 0 ? X1 : X0) - ix) / dx); if (Math.abs(dy) > 1e-6) t = Math.min(t, ((dy > 0 ? Y1 : Y0) - iy) / dy); return t; };
    const r1 = Math.min(X1 - X0, Y1 - Y0) * rnd(.14, .2), pos = [], crk = [], gone = Math.floor(rnd() * nr);
    const pt = (a, r) => [ix + Math.cos(a) * r, iy + Math.sin(a) * r];
    for (let k = 0; k < nr; k++) {
      const a0 = ang[k], a1 = ang[(k + 1) % nr] + (k === nr - 1 ? Math.PI * 2 : 0), tilt = [rnd(-.012, .012), rnd(-.012, .012)];
      const poly = [];   // outer piece: ring arc to the frame (corners included)
      const e0 = toEdge(a0), e1 = toEdge(a1); poly.push(pt(a0, r1), pt(a0, e0));
      for (const c of [[X1, Y1], [X0, Y1], [X0, Y0], [X1, Y0]]) { let ca = Math.atan2(c[1] - iy, c[0] - ix); while (ca < a0) ca += Math.PI * 2; if (ca < a1) poly.push(c); }
      poly.sort((u, v) => { const au = (Math.atan2(u[1] - iy, u[0] - ix) - a0 + Math.PI * 4) % (Math.PI * 2), av = (Math.atan2(v[1] - iy, v[0] - ix) - a0 + Math.PI * 4) % (Math.PI * 2); return au - av || Math.hypot(u[0] - ix, u[1] - iy) - Math.hypot(v[0] - ix, v[1] - iy); });
      poly.push(pt(a1, e1), pt(a1, r1));
      const cx = poly.reduce((s, q) => s + q[0], 0) / poly.length, cy = poly.reduce((s, q) => s + q[1], 0) / poly.length;
      const zf = q => (q[0] - cx) * tilt[0] + (q[1] - cy) * tilt[1];
      for (let j = 1; j < poly.length - 1; j++) for (const q of [poly[0], poly[j], poly[j + 1]]) pos.push(q[0], q[1], zf(q));
      if (k !== gone) for (const q of [[ix, iy], pt(a0, r1), pt(a1, r1)]) pos.push(q[0], q[1], zf(q) * .5);   // inner shard (one is gone: a hole)
      // the fracture faces catch the light: thin pale lines along each crack, a few mm proud
      const line = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * .0011, ny = dx / l * .0011; for (const q of [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] - nx, a[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]) crk.push(q[0], q[1], .002); };
      line([ix, iy], pt(a0, e0)); line(pt(a0, r1), pt(a1, r1));
    }
    for (const [a0, a1, b0, b1] of [[-pw / 2, 0, -ph / 2, 0], [0, pw / 2, -ph / 2, 0], [-pw / 2, 0, 0, ph / 2], [0, pw / 2, 0, ph / 2]]) {   // the three whole panes
      if ((a0 < 0) === (qx < 0) && (b0 < 0) === (qy < 0)) continue; pos.push(a0, b0, 0, a1, b0, 0, a1, b1, 0, a0, b0, 0, a1, b1, 0, a0, b1, 0); }
    const gG = new THREE.BufferGeometry(); gG.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); gG.computeVertexNormals();
    const shards = new THREE.Mesh(gG, w.mat); shards.renderOrder = pm.renderOrder; shards.position.copy(pm.position); shards.quaternion.copy(pm.quaternion); shards.visible = false; w.g.add(shards);
    const cG = new THREE.BufferGeometry(); cG.setAttribute('position', new THREE.Float32BufferAttribute(crk, 3)); cG.computeVertexNormals();
    const cracks = new THREE.Mesh(cG, crackMat); cracks.position.copy(pm.position); cracks.quaternion.copy(pm.quaternion); cracks.visible = false; w.g.add(cracks);
    w.g.updateMatrixWorld(true); const at = pm.getWorldPosition(V());
    panes.push({ room: w.room, pm, shards, cracks, at, d: 0, work: 0 });
  }
  function setPane(p, d) { p.d = d; const on = d > 0; p.pm.visible = !on; p.shards.visible = on; p.cracks.visible = on; }

  // ---------- wear over time ----------
  const windy = () => { try { const w = window.__wind; const g = w && (w.strength ? w.strength() : w.gust ? w.gust() : 0); return Math.max(0, Math.min(1, +g || 0)); } catch (e) { return 0; } };
  const raining = () => { try { const W = window.__weather; const s = W && W.state ? W.state() : null; if (s) return !!s.rain && s.rain !== 'none'; const w = window.__wind; return !!(w && w.raining && w.raining()); } catch (e) { return false; } };
  const CAP = { floor: 3, wall: 3, beam: 3, shingle: 5 };
  const damaged = k => [...parts.values()].filter(p => p.d > 0 && (!k || p.kind === k));
  function hit(kind) {
    const pool = [...parts.values()].filter(p => p.kind === kind); if (!pool.length) return null;
    const bad = pool.filter(p => p.d > 0);
    if (bad.length && (bad.length >= CAP[kind] || rnd() < .4)) { const p = bad[Math.floor(rnd() * bad.length)]; p.d = Math.min(1, p.d + rnd(.25, .45)); p.cap = null; return p; }
    const p = pool[Math.floor(rnd() * pool.length)]; if (p.d > 0 || (planks.fresh && planks.fresh(p.id) > .01)) return null;   // a part he just fixed holds for a while
    p.d = rnd(.45, .8); p.cap = null; return p;
  }
  const KINDS = ['shingle', 'shingle', 'beam', 'floor', 'wall', 'floor', 'beam', 'wall'];
  function crackPane() { if (!panes.length || panes.some(p => p.d > 0)) return null; const p = panes[Math.floor(rnd() * panes.length)]; setPane(p, 1); p.work = 0; return { kind: 'window', id: p.room, d: 1 }; }
  function event() { if (rnd() < .08) return crackPane(); return hit(KINDS[Math.floor(rnd() * KINDS.length)]); }

  let ready = false, lastH = null, dirty = new Set();
  function init() {
    ready = true; candidates();
    if (OFF) return;
    // the house is lived in: a few things already need doing on day one
    const n0 = 3 + Math.floor(rnd() * 3); for (let k = 0; k < n0; k++) event();
    if (fray) fray.d = rnd(.3, .7);
    for (const p of parts.values()) if (p.d > 0) { p.vis = p.d; apply(p); }
  }
  // a worn board also looks it: water-stained, greyer, more weathered (the plank shader's 'fresh' run below 0), the whole board
  const ROT = { floor: .9, wall: .8, post: .7, brace: .7, shingle: .6 };
  function apply(p) { const m = pose(p, p.vis); p.mesh.setMatrixAt(p.i, m); dirty.add(p.mesh); p.cur = V().setFromMatrixPosition(m);
    if (planks.move && p.mode !== 'shingle') planks.move(p.id, m);   // the physics board goes with it: feet, hands and rays meet the board where it is
    if (!(p.fr > 0)) { setFresh0(p.id, -ROT[p.mode] * p.vis); p.fr = 0; } }

  // repairs: Brain marks the parts he fixed as fresh; anything at >= .7 is fixed
  planks.setFresh = (id, f) => { const r = setFresh0(id, f); const p = parts.get(id); if (p) { p.fr = f; if (f >= .7) { p.d = 0; p.cap = null; } } if (f >= .99) { if (nailedBy.has(id)) nailedBy.delete(id); else try { nailPart(id); } catch (e) {} } return r; };
  const nailedBy = new Set();   // parts whose nails hero.js already placed blow by blow
  planks.list = k => { const L = list0(k); for (const it of L) { const p = parts.get(it.id); const d = p ? +p.d.toFixed(2) : 0; it.dmg = d; if (d) { it.fresh = Math.min(it.fresh, -.7 * d); if (p.cur) it.pos = p.cur.toArray().map(v => +v.toFixed(2)); } } return L; };   // pos: where the part is now (a slipped slate, a hanging rail)

  function update(dt) {
    if (!ready) init();
    if (!OFF) {
      const h = hour(); if (lastH == null) lastH = h; let dh = h - lastH; if (dh < -12) dh += 24; lastH = h; if (dh < 0 || dh > 3) dh = 0;
      if (dh > 0) {
        const wnd = windy(), rain = raining();
        const rate = .12 * (rain ? 2.5 : 1) * (1 + wnd);          // ~3 new faults a calm game day, ~14 in a stormy one
        if (rnd() < rate * dh) { const p = event(); if (p && window.__wearLog) console.log('wear', p.kind, p.id, p.d.toFixed(2)); }
        if (fray && fray.d < 1) fray.d = Math.min(1, fray.d + dh * .012 * (rain ? 1.6 : 1) * (1 + wnd));
      }
    }
    // eases: a fault creaks in over a few seconds, a repair settles it in under a second
    for (const p of parts.values()) {
      const tgt = p.cap != null ? Math.min(p.d, p.cap) : p.d;   // blows press it back bit by bit (hero.js __wear.blow)
      if (Math.abs(p.vis - tgt) < 1e-3) continue;
      const k = tgt > p.vis ? .6 : (p.cap != null ? 1.8 : 2.2); p.vis += Math.sign(tgt - p.vis) * Math.min(Math.abs(tgt - p.vis), k * dt);
      apply(p);
    }
    if (fray) {
      // he mends the rope while he works at its knots
      try { const H = hero && hero(); if (H && H.task === 'fix_rope' && H.pos && H.pos.distanceTo(fray.at) < 1.6 && H.still) fray.d = Math.max(0, fray.d - dt / 10); } catch (e) {}
      const want = Math.round(fray.counts.length * Math.min(1, fray.d * 1.15));
      if (want !== fray.vis) { fray.vis = want; fray.mesh.geometry.setDrawRange(0, want ? fray.counts[want - 1] : 0); fray.mesh.visible = want > 0; }
    }
    // nails dull with the days
    { const h = hour(); if (api._h == null) api._h = h; let dh = h - api._h; if (dh < -12) dh += 24; api._h = h; if (dh > 0 && dh < 3) gameT += dh; }
    if ((nailCT -= dt) <= 0 && nails.count) { nailCT = 2; for (let i = 0; i < nails.count; i++) { const k = Math.min(1, Math.max(0, (gameT - born[i]) / 72)); nails.setColorAt(i, tc.copy(NEW).lerp(OLD, Math.sqrt(k))); } nails.instanceColor.needsUpdate = true; }
    // a cracked pane: he takes the broken glass out and puts a new one in while he works at that window (fix_window)
    for (const p of panes) if (p.d > 0) { try { const H = hero && hero(); if (H && H.task === 'fix_window' && H.still && H.pos && Math.hypot(H.pos.x - p.at.x, H.pos.z - p.at.z) < 1.1 && Math.abs(H.pos.y + 1.2 - p.at.y) < 1.2) { p.work += dt; if (p.work > 6) setPane(p, 0); } } catch (e) {} }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true; dirty.clear();
  }

  // where the fault is, on the part's visible (displaced) surface, and the outward normal there (hero.js aims the hammer / the palm at it)
  function faultLocal(p) {
    const long = p.ax[p.L], wid = p.ax[p.Wd], thin = p.ax[p.T], hl = p.sz[p.L] / 2, ht = p.sz[p.T] / 2;
    const away = V(p.c.x - p.n.x, 0, p.c.z - p.n.z); if (away.lengthSq() < 1e-6) away.set(1, 0, 0); away.normalize();
    const toward = away.clone().negate();
    if (p.mode === 'floor') { const u = long.clone().multiplyScalar(long.dot(away) >= 0 ? 1 : -1), n = thin.y > 0 ? thin.clone() : thin.clone().negate(); return [p.c.clone().addScaledVector(u, hl - .08).addScaledVector(n, ht), n]; }
    if (p.mode === 'wall') { const u = long.clone().multiplyScalar(p.sgn), n = thin.dot(away) >= 0 ? thin.clone().negate() : thin.clone(); return [p.c.clone().addScaledVector(u, hl - .06).addScaledVector(n, ht), n]; }   // his side of it
    if (p.mode === 'post') { const hw = Math.min(p.sz[p.Wd], p.sz[p.T]) / 2; return [p.c.clone().addScaledVector(UP, hl - .05).addScaledVector(toward, hw), toward]; }
    if (p.mode === 'brace') { const u = long.clone().multiplyScalar(p.sgn), hw = p.sz[p.Wd] / 2; return [p.c.clone().addScaledVector(u, hl - .06).addScaledVector(toward, hw), toward]; }
    if (p.mode === 'shingle') { const lu = Math.abs(long.y) > Math.abs(wid.y); const up = (lu ? long : wid).clone(), hu = (lu ? p.sz[p.L] : p.sz[p.Wd]) / 2; if (up.y < 0) up.negate(); const n = thin.y > 0 ? thin.clone() : thin.clone().negate(); return [p.c.clone().addScaledVector(up, -hu * .85).addScaledVector(n, ht), n]; }
    return [p.c.clone(), UP.clone()];
  }
  const _inv = new THREE.Matrix4(), _dl = new THREE.Matrix4(), _nm = new THREE.Matrix3();
  function fault(id) {
    const p = parts.get(id); if (!p || !(p.d > 0)) return null; const [q, n] = faultLocal(p);
    _dl.multiplyMatrices(pose(p, p.vis), _inv.copy(p.home).invert()); q.applyMatrix4(_dl); _nm.setFromMatrix4(_dl); n.applyMatrix3(_nm).normalize();
    return { p: q.toArray().map(v => +v.toFixed(3)), n: n.toArray().map(v => +v.toFixed(3)) };
  }
  const api = {
    fault,
    blow: (id, k = .25) => { const p = parts.get(id); if (!p || !(p.d > 0)) return false; p.cap = Math.max(0, (p.cap != null ? Math.min(p.cap, p.vis) : p.vis) - k); return +p.cap.toFixed(2); },
    mesh: fray && fray.mesh, update,
    state: () => ({ parts: parts.size, damaged: damaged().map(p => ({ id: p.id, kind: p.mode, d: +p.d.toFixed(2), pos: p.c.toArray().map(v => +v.toFixed(2)) })), rope: fray ? +fray.d.toFixed(2) : null, windows: panes.filter(p => p.d > 0).map(p => p.room), nails: nails.count }),
    set: (id, d) => { if (!ready) init(); const p = parts.get(id); if (!p) return false; p.d = Math.max(0, Math.min(1, d)); return true; },
    rope: d => { if (fray && d != null) fray.d = d; return fray ? fray.d : null; },
    hit: k => { if (!ready) init(); const p = k ? hit(k) : event(); return p ? p.id : null; },
    snap: () => { for (const p of parts.values()) { p.vis = p.d; apply(p); } for (const m of dirty) m.instanceMatrix.needsUpdate = true; dirty.clear(); },
    nails, nail: (pos, nrm, id) => { if (id != null) nailedBy.add(id); return nail(pos, nrm); },
    nailPart: id => nailPart(id),
    windows: () => panes.map((p, i) => ({ i, room: p.room, cracked: p.d > 0, pos: p.at.toArray().map(v => +v.toFixed(2)) })),
    crack: (i, on = true) => { const p = panes[i]; if (!p) return false; setPane(p, on ? 1 : 0); p.work = 0; return true; },
    candidates: k => [...parts.values()].filter(p => !k || p.kind === k || p.mode === k).map(p => p.id),
  };
  return api;
}

function mergeGeos(THREE, geos) {
  let nv = 0, ni = 0; for (const g of geos) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), idx = new Uint32Array(ni); let ov = 0, oi = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, ov * 3); nor.set(g.attributes.normal.array, ov * 3); const I = g.index.array; for (let k = 0; k < I.length; k++) idx[oi + k] = I[k] + ov; ov += g.attributes.position.count; oi += I.length; g.dispose(); }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setIndex(new THREE.BufferAttribute(idx, 1)); out.computeBoundingSphere(); return out;
}
