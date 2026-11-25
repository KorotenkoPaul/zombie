// HERO LOOK, game style (thread "Сделать героя как в нормальных играх", 2026-11-25), flag ?look=game (or ?style=game)
// At the game camera the hero is ~65 px tall and his browns and oranges sit on brown boards and bark: he reads as a soft
// blob. Characters in mobile games read at that size because of a clean dark silhouette line. This draws one: an inverted
// hull (back faces pushed out along smooth normals by a constant number of screen pixels) for the body+head (the 4.6k-tri
// shadow proxy, smoothed) and the boots. Each hull follows its source's visibility (vest and boots come off at bed time).
// Cost: 2 draw calls, ~7k tris.
export function createHeroLook({ THREE, root, camera, renderer, opts = {} }) {
  const P = Object.assign({ px: 1.4, color: 0x2a160c }, opts);
  const hulls = [];
  const uOW = { value: 0 };
  function hullOf(src, name, opt2 = {}) {
    if (!src || !src.isSkinnedMesh) return null;
    let g = src.geometry.clone();
    // smooth normals over welded positions (the shadow proxy has flat normals; the clothes have UV seams)
    const pos = g.attributes.position; const n = pos.count; const key = new Map(); const sum = new Float32Array(n * 3);
    const tmp = new THREE.Vector3();
    g.computeVertexNormals();
    const N0 = g.attributes.normal; const id = new Int32Array(n);
    for (let i = 0; i < n; i++) { tmp.fromBufferAttribute(pos, i); const k = Math.round(tmp.x * 2000) + ',' + Math.round(tmp.y * 2000) + ',' + Math.round(tmp.z * 2000); if (!key.has(k)) key.set(k, i); id[i] = key.get(k); }
    for (let i = 0; i < n; i++) { const j = id[i]; sum[j * 3] += N0.getX(i); sum[j * 3 + 1] += N0.getY(i); sum[j * 3 + 2] += N0.getZ(i); }
    const nn = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const j = id[i]; tmp.set(sum[j * 3], sum[j * 3 + 1], sum[j * 3 + 2]).normalize(); nn[i * 3] = tmp.x; nn[i * 3 + 1] = tmp.y; nn[i * 3 + 2] = tmp.z; }
    g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
    for (const k of Object.keys(g.attributes)) if (!/^(position|normal|skinIndex|skinWeight)$/.test(k)) g.deleteAttribute(k);
    g.morphAttributes = {};
    // the body under the vest is open (the vest was split off it): seen through the vest's front opening, the hull's inside
    // showed as dark patches. The torso is inside the vest anyway, so its triangles get no hull (head, arms, legs keep theirs).
    if (opt2.dropTorso && g.index) { const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, bn = src.skeleton.bones.map(b => b.name.replace('mixamorig', '').replace(':', ''));
      const torso = i => { let m = -1, mb = 0; for (let c = 0; c < 4; c++) { const w = [SW.getX, SW.getY, SW.getZ, SW.getW][c].call(SW, i); if (w > m) { m = w; mb = [SI.getX, SI.getY, SI.getZ, SI.getW][c].call(SI, i); } } return /^(Hips|Spine|Spine1|Spine2|Neck|LeftShoulder|RightShoulder)$/.test(bn[mb]); };
      // plus everything of the legs above the crotch (the seat and belly under the vest's hem)
      const J = n => { const i = bn.indexOf(n); return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(src.skeleton.boneInverses[i].clone().invert()); };
      const lu = J('LeftUpLeg'), ru = J('RightUpLeg'), lk = J('LeftLeg'); const yC = lu && ru && lk ? (lu.y + ru.y) / 2 - .25 * ((lu.y + ru.y) / 2 - lk.y) : -1e9;
      const armOrHead = i => { let m = -1, mb = 0; for (let c = 0; c < 4; c++) { const w = [SW.getX, SW.getY, SW.getZ, SW.getW][c].call(SW, i); if (w > m) { m = w; mb = [SI.getX, SI.getY, SI.getZ, SI.getW][c].call(SI, i); } } return /Arm|Hand|Head/.test(bn[mb]); };
      const P0 = g.attributes.position, c3 = new THREE.Vector3(), t3 = new THREE.Vector3();
      const high = (a, b, c) => { c3.set(0, 0, 0); for (const i of [a, b, c]) c3.add(t3.fromBufferAttribute(P0, i).applyMatrix4(src.bindMatrix)); c3.multiplyScalar(1 / 3); return c3.y > yC && !armOrHead(a); };
      // nor the hands: the proxy's low-poly mitten does not match the real fingers and read as a black lump on them in close-ups
      const hand = i => { let m = -1, mb = 0; for (let c = 0; c < 4; c++) { const w = [SW.getX, SW.getY, SW.getZ, SW.getW][c].call(SW, i); if (w > m) { m = w; mb = [SI.getX, SI.getY, SI.getZ, SI.getW][c].call(SI, i); } } return /Hand/.test(bn[mb]); };
      const I = g.index.array, keep = []; for (let t = 0; t < I.length; t += 3) if (!(torso(I[t]) && torso(I[t + 1]) && torso(I[t + 2])) && !high(I[t], I[t + 1], I[t + 2]) && !(hand(I[t]) || hand(I[t + 1]) || hand(I[t + 2]))) keep.push(I[t], I[t + 1], I[t + 2]);
      g.setIndex(keep); }
    const m = new THREE.MeshBasicMaterial({ color: P.color, side: THREE.BackSide, fog: true });
    m.onBeforeCompile = sh => { sh.uniforms.uOW = uOW; sh.vertexShader = 'uniform float uOW;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  mvPosition.xyz += normalize(transformedNormal) * uOW * max(.05, -mvPosition.z);\n  gl_Position = projectionMatrix * mvPosition;'); };
    m.customProgramCacheKey = () => 'heroHull1';
    const h = new THREE.SkinnedMesh(g, m); h.name = name; h.bind(src.skeleton, src.bindMatrix); try { window.__clothes && window.__clothes.knee && window.__clothes.knee(h); } catch (e) { } h.frustumCulled = false; h.castShadow = false; h.receiveShadow = false;
    h.layers.set(0); src.parent.add(h); h.position.copy(src.position); h.quaternion.copy(src.quaternion); h.scale.copy(src.scale);
    hulls.push({ h, src, vis: src.name === 'heroShadow' ? root.getObjectByName('Mesh_0') : src });
    return h;
  }
  hullOf(root.getObjectByName('heroShadow'), 'heroHull', { dropTorso: true });
  for (const nm of ['boots'])/* not the vest: it is an open shell, its hull showed through the front opening as dark patches */ { const o = root.getObjectByName(nm); let sm = null; if (o) o.traverse(c => { if (c.isSkinnedMesh && !sm) sm = c; }); hullOf(sm, nm + 'Hull'); }
  const _s = new THREE.Vector2();
  function update() {
    renderer.getDrawingBufferSize(_s); const fov = camera.fov * Math.PI / 180;
    const dpr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1; const px = P.px * Math.min(2.2, Math.max(1, dpr));
    uOW.value = px * 2 * Math.tan(fov / 2) / Math.max(1, _s.y);
    for (const H of hulls) { let v = !window.__noHull; for (let o = H.vis; o && o !== root.parent; o = o.parent) if (!o.visible) { v = false; break; } H.h.visible = v; }
  }
  return { update, hulls, P };
}
