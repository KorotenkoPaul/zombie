// TIGHT SKIN (thread "Сделать героя как в нормальных играх", 2026-11-25)
// The v6 body came out of an auto-rig of a generated mesh: its weights are smeared wide (thighs: the biggest weight averages 0.66,
// upper arms 0.71, the pelvis 0.49) and the chest hardly belongs to the spine at all (Spine1 + Spine2 own 146 of 15k verts; the
// chest hangs off Hips and the two Shoulder bones). So every spine turn, breath or lean bent the chest like jelly and every leg swing
// dragged the belly and the seat with it. Game characters are skinned tight: each limb segment moves as one piece, joints blend in a
// narrow band, the spine carries the chest.
// tightSkin() recomputes the weights at load, from the bind pose alone (same bones, same skeleton, so clips, IK, collide, grab work
// unchanged): every vertex keeps the body part it had (torso / left or right arm / left or right leg, from the old weights), is put
// on the nearest bone segment of that part, and blends with the neighbour bone only within a few cm of the joint. A few passes of
// smoothing over the welded surface close the seams between parts. Body, vest, boots and the shadow proxy get the same function of
// position, so clothes stay on the body. The grafted head (100% Head) and the eyelids / mouth are left as they are.
export function tightSkin(root, THREE, opt = {}) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const nm = b => b.name.replace('mixamorig', '').replace(':', '');
  const BW = Object.assign({ shoulder: .07, elbow: .045, wrist: .03, hip: .07, knee: .05, ankle: .035, toe: .025, spine: .09, neck: .05 }, opt.bw || {});
  const ITER = opt.iter ?? 4;
  const CH = {
    T: ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'],
    LA: ['LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand'],
    RA: ['RightShoulder', 'RightArm', 'RightForeArm', 'RightHand'],
    LL: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase'],
    RL: ['RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'],
  };
  // blend width at the START of each bone of a chain (joint with the previous bone)
  const JW = { T: [0, BW.spine, BW.spine, BW.spine, BW.neck, BW.neck], LA: [0, BW.shoulder, BW.elbow, BW.wrist], RA: [0, BW.shoulder, BW.elbow, BW.wrist],
    LL: [0, BW.knee, BW.ankle, BW.toe], RL: [0, BW.knee, BW.ankle, BW.toe] };
  const stats = [], done = [];
  root.updateMatrixWorld(true);
  // joint positions by name from a skin that has every chain bone (the vest and boots skins carry only the bones they use)
  const ALL = [].concat(...Object.values(CH)); let REF = null;
  // (each skin has its own bind frame: quantized meshes fold their dequantization into the inverse bind matrices, so the vest's
  // and boots' frames are scaled and shifted against the body's; every vertex is brought into the reference frame first)
  let REFW = null;
  root.traverse(o => { if (REF || !o.isSkinnedMesh || !o.skeleton) return; const nmz = o.skeleton.bones.map(nm); if (ALL.every(n => nmz.includes(n))) { REF = {}; REFW = {}; o.skeleton.bones.forEach((b, i) => { const W = o.skeleton.boneInverses[i].clone().invert(); REFW[nm(b)] = W; REF[nm(b)] = V().setFromMatrixPosition(W); }); } });
  if (!REF) return stats;
  // a bone this skin lacks hands its weight to the nearest bone of the same chain it has (towards the body first)
  const fallback = (name, bi) => { if (bi[name] != null) return bi[name]; for (const k in CH) { const c = CH[k], j = c.indexOf(name); if (j < 0) continue;
      for (let d = 1; d < c.length; d++) { if (j - d >= 0 && bi[c[j - d]] != null) return bi[c[j - d]]; if (j + d < c.length && bi[c[j + d]] != null) return bi[c[j + d]]; } }
    return bi.Hips ?? bi.Spine ?? 0; };
  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.skeleton) return;
    if (/eyelid|mouth/i.test(o.name)) return;
    const g = o.geometry, P = g.attributes.position, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    if (!P || !SI || !SW) return;
    const bones = o.skeleton.bones, bi = {}; bones.forEach((b, i) => bi[nm(b)] = i);
    // joint positions in the bind space (= bindMatrix * position)
    // work in bone NAMES with the reference joints; map to this skin's own indices at the end
    const chains = {}; for (const k in CH) chains[k] = CH[k];
    const regionOf = {}; for (const k in CH) for (const n of CH[k]) if (bi[n] != null) regionOf[bi[n]] = k;
    const headI = bi.Head; const J = REF;
    // this skin's frame -> the reference frame, through any bone both have
    const cb = bones.findIndex(b => REFW[nm(b)]); if (cb < 0) return;
    const toRef = REFW[nm(bones[cb])].clone().multiply(o.skeleton.boneInverses[cb]).multiply(o.bindMatrix);
    // chain polylines: joint points + an end point past the last joint (direction of the last bone)
    const lines = {};
    for (const k in chains) {
      const pts = chains[k].map(n => J[n].clone()); const n = pts.length;
      let end = pts[n - 1].clone().add(pts[n - 1].clone().sub(pts[n - 2]).multiplyScalar(.6));
      if (k === 'T') end = pts[n - 1].clone().add(V(0, .3, 0));
      if (k === 'LL' || k === 'RL') end = pts[n - 1].clone().add(pts[n - 1].clone().sub(pts[n - 2]).setY(0).setLength(.08));
      pts.push(end);
      // legs start at the hip joint; torso at the hips joint; the torso's s also gets a start below the hips
      const s = [0]; for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
      lines[k] = { pts, s };
    }
    const N = P.count; const nw = new Float32Array(N * 4), ni = new Uint16Array(N * 4);
    const bm = toRef, v = V(), tmp = V(), ab = V(), av = V();
    const keep = new Uint8Array(N); let changed = 0;
    const regW = { T: 0, LA: 0, RA: 0, LL: 0, RL: 0 };
    const getW = (i, k) => [SW.getX, SW.getY, SW.getZ, SW.getW][k].call(SW, i);
    const getI = (i, k) => [SI.getX, SI.getY, SI.getZ, SI.getW][k].call(SI, i);
    const sm = x => x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);
    // weights of one chain at point v: nearest point on the chain polyline -> arc length s; bone k owns [s_k, s_k+1),
    // blending with its neighbour over JW centred on each joint
    function chainW(reg, v) { const L = lines[reg]; let bd = 1e9, bs = 0;
      for (let k = 0; k < L.pts.length - 1; k++) {
        ab.subVectors(L.pts[k + 1], L.pts[k]); const l2 = ab.lengthSq(); av.subVectors(v, L.pts[k]);
        let t = l2 > 0 ? av.dot(ab) / l2 : 0; const open0 = k === 0, open1 = k === L.pts.length - 2;
        if (!open0) t = Math.max(0, t); if (!open1) t = Math.min(1, t);
        tmp.copy(L.pts[k]).addScaledVector(ab, t); const d = tmp.distanceToSquared(v);
        if (d < bd) { bd = d; bs = L.s[k] + t * Math.sqrt(l2); } }
      const ids = chains[reg], res = [];
      for (let k = 0; k < ids.length; k++) {
        const a = k === 0 ? -1e9 : L.s[k], b = k === ids.length - 1 ? 1e9 : L.s[k + 1];
        const wa = JW[reg][k] || .001, wb = (JW[reg][k + 1] || .001);
        const w = (k === 0 ? 1 : sm((bs - (a - wa / 2)) / wa)) - (k === ids.length - 1 ? 0 : sm((bs - (b - wb / 2)) / wb));
        if (w > 1e-3) res.push([ids[k], w]); }
      return res; }
    // welded adjacency (positions rounded to 1 mm)
    const key = new Map(), weld = new Int32Array(N);
    for (let i = 0; i < N; i++) { v.fromBufferAttribute(P, i).applyMatrix4(bm); const k = Math.round(v.x * 1000) + ',' + Math.round(v.y * 1000) + ',' + Math.round(v.z * 1000); if (!key.has(k)) key.set(k, i); weld[i] = key.get(k); }
    const nb = Array.from({ length: N }, () => new Set());
    if (g.index) { const I = g.index.array; for (let t = 0; t < I.length; t += 3) { const a = weld[I[t]], b = weld[I[t + 1]], c = weld[I[t + 2]]; nb[a].add(b).add(c); nb[b].add(a).add(c); nb[c].add(a).add(b); } }
    // body part per vertex from the old weights, smoothed over the surface first: a hem or a collar whose vertices flip between
    // torso and leg (or arm) from one vertex to the next bent into a saw edge
    const RK = ['T', 'LA', 'RA', 'LL', 'RL']; let R = new Float32Array(N * 5);
    for (let i = 0; i < N; i++) for (let c = 0; c < 4; c++) { const w = getW(i, c); if (w > 0) R[weld[i] * 5 + RK.indexOf(regionOf[getI(i, c)] || 'T')] += w; }
    for (let it = 0; it < (opt.regIter ?? 6); it++) { const E = new Float32Array(N * 5);
      for (let i = 0; i < N; i++) { if (weld[i] !== i) continue; let n = 1; for (let k = 0; k < 5; k++) E[i * 5 + k] = R[i * 5 + k]; for (const j of nb[i]) { if (j === i) continue; n++; for (let k = 0; k < 5; k++) E[i * 5 + k] += R[j * 5 + k]; } for (let k = 0; k < 5; k++) E[i * 5 + k] /= n; }
      R = E; }
    for (let i = 0; i < N; i++) {
      // old weights: Head-only vertices (the grafted head) keep theirs
      let hw = 0, sum = 0; for (const k in regW) regW[k] = 0;
      for (let c = 0; c < 4; c++) { const w = getW(i, c), b = getI(i, c); if (w <= 0) continue; sum += w; if (b === headI) hw += w; const r = regionOf[b] || 'T'; regW[r] += w; }
      if (sum <= 0 || hw / sum > .97) { for (let c = 0; c < 4; c++) { nw[i * 4 + c] = getW(i, c); ni[i * 4 + c] = getI(i, c); } keep[i] = 1; continue; }
      let reg = 'T', best = -1; for (let k = 0; k < 5; k++) if (R[weld[i] * 5 + k] > best) { best = R[weld[i] * 5 + k]; reg = RK[k]; }
      v.fromBufferAttribute(P, i).applyMatrix4(bm);
      const out = chainW(reg, v);
      // arms / legs right at the body blend into the TORSO's own weights for this point (not one fixed bone): neighbours on
      // both sides of a part border then move alike, so a hem or a collar stays one smooth edge
      if (reg !== 'T') { const L = lines[reg]; let h = 0;
        if (reg === 'LL' || reg === 'RL') { const hipJ = L.pts[0], kneeJ = L.pts[1]; const dir = kneeJ.clone().sub(hipJ).normalize(); const t = v.clone().sub(hipJ).dot(dir); h = 1 - sm((t + BW.hip * .3) / BW.hip); }
        else { const sJ = L.pts[0], aJ = L.pts[1]; const dir = aJ.clone().sub(sJ); const len = dir.length(); dir.normalize(); const t = v.clone().sub(sJ).dot(dir) / len; h = 1 - sm((t - .05) / .45); }
        if (h > 1e-3) { for (const e of out) e[1] *= 1 - h; for (const [n, x] of chainW('T', v)) out.push([n, x * h]); } }
      const acc = new Map(); for (const [n, x] of out) { const id = fallback(n, bi); acc.set(id, (acc.get(id) || 0) + x); }
      const arr = [...acc].sort((x, y) => y[1] - x[1]); const tot = arr.slice(0, 4).reduce((a, e) => a + e[1], 0) || 1;
      for (let c = 0; c < 4; c++) { const e = arr[c]; ni[i * 4 + c] = e ? e[0] : 0; nw[i * 4 + c] = e ? e[1] / tot : 0; }
      changed++;
    }
    // smoothing over the welded surface (positions rounded to 1 mm), dense per-bone weights during smoothing
    if (ITER > 0 && g.index) {
      const NB = bones.length; let D = new Float32Array(N * NB);
      for (let i = 0; i < N; i++) for (let c = 0; c < 4; c++) D[i * NB + ni[i * 4 + c]] += nw[i * 4 + c];
      for (let it = 0; it < ITER; it++) {
        const E = new Float32Array(N * NB);
        for (let i = 0; i < N; i++) {
          const r = weld[i]; if (r !== i) continue; if (keep[i]) { for (let b = 0; b < NB; b++) E[i * NB + b] = D[i * NB + b]; continue; }
          const s = nb[i]; let n = 1; for (let b = 0; b < NB; b++) E[i * NB + b] = D[i * NB + b];
          for (const j of s) { if (j === i) continue; n++; for (let b = 0; b < NB; b++) E[i * NB + b] += D[j * NB + b]; }
          for (let b = 0; b < NB; b++) E[i * NB + b] /= n;
        }
        for (let i = 0; i < N; i++) { const r = weld[i]; if (r !== i) for (let b = 0; b < NB; b++) E[i * NB + b] = E[r * NB + b]; }
        D = E;
      }
      for (let i = 0; i < N; i++) {
        if (keep[i]) continue; const arr = []; for (let b = 0; b < NB; b++) { const x = D[i * NB + b]; if (x > 1e-3) arr.push([b, x]); }
        arr.sort((x, y) => y[1] - x[1]); const tot = arr.slice(0, 4).reduce((a, e) => a + e[1], 0) || 1;
        for (let c = 0; c < 4; c++) { const e = arr[c]; ni[i * 4 + c] = e ? e[0] : 0; nw[i * 4 + c] = e ? e[1] / tot : 0; }
      }
    }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(ni, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(nw, 4));
    stats.push([o.name, N, changed]);
    done.push({ o, toRef, bones, bi });
  });
  // clothes and the shadow proxy take the weights of the nearest body vertex (weight transfer): computed on their own, the vest
  // hem and collar bent a few mm differently from the sweater under them and the sweater showed through in a saw edge
  const body = done.find(d => d.o.name === 'Mesh_0_1') || done[0];
  if (body && opt.transfer !== false) {
    const bg = body.o.geometry, BP = bg.attributes.position, BI = bg.attributes.skinIndex, BWt = bg.attributes.skinWeight; const cell = .03, grid = new Map(); const pv = V();
    const bpos = new Float32Array(BP.count * 3);
    for (let i = 0; i < BP.count; i++) { pv.fromBufferAttribute(BP, i).applyMatrix4(body.toRef); bpos.set([pv.x, pv.y, pv.z], i * 3); const k = Math.floor(pv.x / cell) + ',' + Math.floor(pv.y / cell) + ',' + Math.floor(pv.z / cell); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(i); }
    const nearest = p => { const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell), cz = Math.floor(p.z / cell); let best = -1, bd = 1e9;
      for (let r = 1; r <= 3 && best < 0; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) { const a = grid.get((cx + x) + ',' + (cy + y) + ',' + (cz + z)); if (!a) continue;
        for (const i of a) { const dx = bpos[i * 3] - p.x, dy = bpos[i * 3 + 1] - p.y, dz = bpos[i * 3 + 2] - p.z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = i; } } }
      return best; };
    for (const d of done) { if (d === body || /^Mesh_0_[23]$/.test(d.o.name)) continue; const g = d.o.geometry, P = g.attributes.position, N = P.count;
      const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight; let moved = 0;
      for (let i = 0; i < N; i++) { pv.fromBufferAttribute(P, i).applyMatrix4(d.toRef); const j = nearest(pv); if (j < 0) continue;
        // keep the grafted head's own weights on the proxy (its head verts were Head-only)
        if (/heroShadow/.test(d.o.name) && SW.getX(i) > .97 && d.bones[SI.getX(i)] && /Head$/.test(d.bones[SI.getX(i)].name)) continue;
        const acc = new Map(); for (let c = 0; c < 4; c++) { const w = [BWt.getX, BWt.getY, BWt.getZ, BWt.getW][c].call(BWt, j); if (w <= 0) continue; const n = nm(body.bones[[BI.getX, BI.getY, BI.getZ, BI.getW][c].call(BI, j)]); const id = fallback(n, d.bi); acc.set(id, (acc.get(id) || 0) + w); }
        const arr = [...acc].sort((x, y) => y[1] - x[1]); const tot = arr.slice(0, 4).reduce((a, e) => a + e[1], 0) || 1;
        for (let c = 0; c < 4; c++) { const e = arr[c]; SI.array[i * 4 + c] = e ? e[0] : 0; SW.array[i * 4 + c] = e ? e[1] / tot : 0; }
        moved++; }
      SI.needsUpdate = SW.needsUpdate = true; stats.push([d.o.name + ':transfer', moved]); }
  }
  return stats;
}
