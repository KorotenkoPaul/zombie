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
export function createHouseWear({ THREE, planks, N, hour, hero, ladder }) {
  const OFF = (window.__fixedStart && !/[?&]wear\b/.test(location.search)) || /[?&]nowear\b/.test(location.search);
  // own random stream: never draws from Math.random (the QA harness seeds it; other code must keep its numbers)
  let seed = (Date.now() ^ 0x9E3779B9) >>> 0;
  const rnd = (a = 0, b = 1) => { seed = (seed + 0x6D2B79F5) >>> 0; let t = seed; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return a + (b - a) * (((t ^ t >>> 14) >>> 0) / 4294967296); };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const UP = V(0, 1, 0);
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
      about(m, pivot, u.clone().cross(n).normalize(), .014 * d / (2 * hl));
      about(m, p.c.clone().addScaledVector(u, hl * .5), u, .035 * d * p.sgn);   // cupped/twisted: one edge up a few mm
    } else if (p.mode === 'wall') {
      const out = thin.dot(away) >= 0 ? thin.clone() : thin.clone().negate();   // away from the room's walkway
      const u = long.clone().multiplyScalar(p.sgn), pivot = p.c.clone().addScaledVector(u, -hl);
      about(m, pivot, u.clone().cross(out).normalize(), .025 * d / (2 * hl));
      about(m, p.c, u, .03 * d * p.sgn2);
    } else if (p.mode === 'post') {
      const pivot = p.c.clone().addScaledVector(UP, -hl);                       // the foot stays nailed, the top leans out
      about(m, pivot, UP.clone().cross(away).normalize(), .07 * d / (2 * hl));
      about(m, p.c, UP, .05 * d * p.sgn);
    } else if (p.mode === 'brace') {
      // it sags; a short rail between two posts works loose at one end and hangs out and down off the post
      const u = long.clone().multiplyScalar(p.sgn), pivot = p.c.clone().addScaledVector(u, -hl), L2 = 2 * hl;
      const off = L2 < 1.2 ? sstep(.5, .9, d) : 0;
      about(m, pivot, u.clone().cross(V(0, -1, 0)).normalize(), (.03 * d + .2 * off) / L2);
      about(m, pivot, UP, Math.sign(u.clone().cross(UP).dot(away) || 1) * -.12 * off / L2);   // swings out past the post's face
      about(m, p.c, u, .06 * d * p.sgn2);
    } else if (p.mode === 'shingle') {
      // the slate hangs from its last nail near the top edge and swings, slides a little and its lower edge lifts off
      const lu = Math.abs(long.y) > Math.abs(wid.y);
      const up = (lu ? long : wid).clone(), hu = (lu ? p.sz[p.L] : p.sz[p.Wd]) / 2; if (up.y < 0) up.negate();
      const side = (lu ? wid : long).clone(), hs = (lu ? p.sz[p.Wd] : p.sz[p.L]) / 2;
      const n = thin.y > 0 ? thin : thin.clone().negate();
      const nail = p.c.clone().addScaledVector(up, hu * .8).addScaledVector(side, hs * .45 * p.sgn);
      const slip = sstep(.55, 1, d);                         // a bad one has slid well down, the roof board shows above it
      about(m, nail, n, (.16 * d + .2 * slip) * -p.sgn);
      const lowEdge = p.c.clone().addScaledVector(up, hu);
      about(m, lowEdge, side, -.07 * d * Math.sign(side.clone().cross(up).dot(n) || 1));
      const sl = up.clone().multiplyScalar(-.012 * d - .13 * slip).addScaledVector(n, .012 * slip); T1.makeTranslation(sl.x, sl.y, sl.z); m.premultiply(T1);
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

  // ---------- wear over time ----------
  const windy = () => { try { const w = window.__wind; const g = w && (w.strength ? w.strength() : w.gust ? w.gust() : 0); return Math.max(0, Math.min(1, +g || 0)); } catch (e) { return 0; } };
  const raining = () => { try { const W = window.__weather; const s = W && W.state ? W.state() : null; if (s) return !!s.rain && s.rain !== 'none'; const w = window.__wind; return !!(w && w.raining && w.raining()); } catch (e) { return false; } };
  const CAP = { floor: 3, wall: 3, beam: 3, shingle: 5 };
  const damaged = k => [...parts.values()].filter(p => p.d > 0 && (!k || p.kind === k));
  function hit(kind) {
    const pool = [...parts.values()].filter(p => p.kind === kind); if (!pool.length) return null;
    const bad = pool.filter(p => p.d > 0);
    if (bad.length && (bad.length >= CAP[kind] || rnd() < .4)) { const p = bad[Math.floor(rnd() * bad.length)]; p.d = Math.min(1, p.d + rnd(.25, .45)); return p; }
    const p = pool[Math.floor(rnd() * pool.length)]; if (p.d > 0 || (planks.fresh && planks.fresh(p.id) > .01)) return null;   // a part he just fixed holds for a while
    p.d = rnd(.45, .8); return p;
  }
  const KINDS = ['shingle', 'shingle', 'beam', 'floor', 'wall', 'floor', 'beam', 'wall'];
  function event() { return hit(KINDS[Math.floor(rnd() * KINDS.length)]); }

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
  const ROT = { floor: .6, wall: .5, post: .45, brace: .45, shingle: .5 };
  function apply(p) { const m = pose(p, p.vis); p.mesh.setMatrixAt(p.i, m); dirty.add(p.mesh); p.cur = V().setFromMatrixPosition(m);
    if (!(p.fr > 0)) { setFresh0(p.id, -ROT[p.mode] * p.vis); p.fr = 0; } }

  // repairs: Brain marks the parts he fixed as fresh; anything at >= .7 is fixed
  planks.setFresh = (id, f) => { const r = setFresh0(id, f); const p = parts.get(id); if (p) { p.fr = f; if (f >= .7) p.d = 0; } return r; };
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
      if (Math.abs(p.vis - p.d) < 1e-3) continue;
      const k = p.d > p.vis ? .6 : 2.2; p.vis += Math.sign(p.d - p.vis) * Math.min(Math.abs(p.d - p.vis), k * dt);
      apply(p);
    }
    if (fray) {
      // he mends the rope while he works at its knots
      try { const H = hero && hero(); if (H && H.task === 'fix_rope' && H.pos && H.pos.distanceTo(fray.at) < 1.6 && H.still) fray.d = Math.max(0, fray.d - dt / 10); } catch (e) {}
      const want = Math.round(fray.counts.length * Math.min(1, fray.d * 1.15));
      if (want !== fray.vis) { fray.vis = want; fray.mesh.geometry.setDrawRange(0, want ? fray.counts[want - 1] : 0); fray.mesh.visible = want > 0; }
    }
    for (const m of dirty) m.instanceMatrix.needsUpdate = true; dirty.clear();
  }

  const api = {
    mesh: fray && fray.mesh, update,
    state: () => ({ parts: parts.size, damaged: damaged().map(p => ({ id: p.id, kind: p.mode, d: +p.d.toFixed(2), pos: p.c.toArray().map(v => +v.toFixed(2)) })), rope: fray ? +fray.d.toFixed(2) : null }),
    set: (id, d) => { if (!ready) init(); const p = parts.get(id); if (!p) return false; p.d = Math.max(0, Math.min(1, d)); return true; },
    rope: d => { if (fray && d != null) fray.d = d; return fray ? fray.d : null; },
    hit: k => { if (!ready) init(); const p = k ? hit(k) : event(); return p ? p.id : null; },
    snap: () => { for (const p of parts.values()) { p.vis = p.d; apply(p); } for (const m of dirty) m.instanceMatrix.needsUpdate = true; dirty.clear(); },
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
