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
  function hullOf(src, name) {
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
    const m = new THREE.MeshBasicMaterial({ color: P.color, side: THREE.BackSide, fog: true });
    m.onBeforeCompile = sh => { sh.uniforms.uOW = uOW; sh.vertexShader = 'uniform float uOW;\n' + sh.vertexShader.replace('#include <project_vertex>',
      '#include <project_vertex>\n  mvPosition.xyz += normalize(transformedNormal) * uOW * max(.05, -mvPosition.z);\n  gl_Position = projectionMatrix * mvPosition;'); };
    m.customProgramCacheKey = () => 'heroHull1';
    const h = new THREE.SkinnedMesh(g, m); h.name = name; h.bind(src.skeleton, src.bindMatrix); h.frustumCulled = false; h.castShadow = false; h.receiveShadow = false;
    h.layers.set(0); src.parent.add(h); h.position.copy(src.position); h.quaternion.copy(src.quaternion); h.scale.copy(src.scale);
    hulls.push({ h, src, vis: src.name === 'heroShadow' ? root.getObjectByName('Mesh_0') : src });
    return h;
  }
  hullOf(root.getObjectByName('heroShadow'), 'heroHull');
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
