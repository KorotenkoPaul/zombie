// Wind thread — shared half-resolution fog pass (game/fogpass.js).
//
// All the soft fog layers (Environment's ground sheets, rolling puffs and mist bands, the morning fog bank) are big,
// overlapping transparent surfaces: on a phone they cost a lot of fill rate at full resolution. Here they are drawn
// once into a half-resolution target (a quarter of the pixels) and laid over the frame in one blend.
//
// How:
//  - the fog meshes move to their own layer (FOG_LAYER), so the main scene render skips them;
//  - right after the scene render, they are drawn into the half-res target. There is no depth buffer there, so
//    each fog shader gets a small patch: it reads the scene depth (the composer's depth texture, already there for the
//    depth of field) and fades out behind solid things, with a soft edge (this replaces Environment's own depth
//    pre-pass, so that pass is switched off while this one runs);
//  - the target holds premultiplied fog; one full-screen blend puts it over the frame (the frame keeps its depth, so
//    the depth of field after it still works).
//
// createFogPass({THREE, renderer, scene, camera, composer, FullScreenQuad, Pass, MOBILE})
//   -> {pass, add(meshes), setEnabled(on), enabled, scale}   (scale 0.5 = half resolution; 0.35 is even cheaper)
// Toggle for comparisons: __fogpass.setEnabled(false) draws the fog the old way (full resolution, in the scene).

export const FOG_LAYER = 5;

export function createFogPass({ THREE, renderer, scene, camera, composer, FullScreenQuad, Pass, MOBILE = false }) {
  const rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
  const FP = { fpDepth: { value: null }, fpRes: { value: new THREE.Vector2(1, 1) }, fpNear: { value: 0.1 }, fpFar: { value: 300 }, fpOn: { value: 0 } };
  const meshes = [], patched = new Set(), envU = new Set(); const saved = new Map();
  const size = new THREE.Vector2();

  // occlusion patch for a fog ShaderMaterial: fade the fragment out where the scene is in front of it
  function patch(mat) {
    if (!mat || patched.has(mat) || !mat.isShaderMaterial) return; patched.add(mat);
    Object.assign(mat.uniforms, FP);
    // Environment's fog has its own soft-edge test (softK: tDepth/uRes/cNear/cFar, on when soft=1, desktop). We feed it
    // our depth and keep its look; where it's off (phones, soft=0) our own test does the occlusion instead.
    const envSoft = !!(mat.uniforms.soft && mat.uniforms.tDepth && mat.uniforms.uRes);
    if (envSoft) envU.add(mat.uniforms);
    let fs = mat.fragmentShader;
    const head = `uniform sampler2D fpDepth;uniform vec2 fpRes;uniform float fpNear,fpFar,fpOn;
float fpVZ(float d){return (fpNear*fpFar)/((fpFar-fpNear)*d-fpFar);}
float fpOcc(){if(fpOn<.5${envSoft ? '||soft>.5' : ''})return 1.;float sd=texture2D(fpDepth,gl_FragCoord.xy/fpRes).x;
 float sz=-fpVZ(sd),fz=-fpVZ(gl_FragCoord.z);return clamp((sz-fz)/(.15+fz*.012),0.,1.);}
`;
    // multiply the final alpha: rename the shader's main and call it from a new one
    // (the helpers go right before main, after the shader's own uniforms such as Environment's 'soft')
    fs = fs.replace(/void\s+main\s*\(\s*\)/, head + 'void fpMain()') + `
void main(){fpMain();gl_FragColor.a*=fpOcc();
#ifdef FP_PREMUL
 gl_FragColor.rgb*=fpOcc();
#endif
}`;
    mat.fragmentShader = fs; mat.needsUpdate = true;
  }

  const blend = new THREE.ShaderMaterial({
    uniforms: { tFog: { value: rt.texture } }, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader: 'uniform sampler2D tFog;varying vec2 vUv;void main(){gl_FragColor=texture2D(tFog,vUv);}'
  });
  const fsq = new FullScreenQuad(blend);

  const api = { enabled: !!MOBILE, scale: 0.5, merged: false, merge: null, fogTexture: rt.texture };  // on by default on phones (the fill-rate problem); desktop keeps the old way
  function setLayers(on) {
    for (const m of meshes) { if (on) m.layers.set(FOG_LAYER); else m.layers.set(0); }
    if (!on) for (const u of envU) { const sv = saved.get(u.tDepth); if (sv) { u.tDepth.value = sv[0]; u.uRes.value.copy(sv[1]); } }
  }
  class FogPass extends Pass {
    constructor() { super(); this.needsSwap = false; }
    render(rd, write, read) {
      if (!api.enabled || !meshes.length) return;
      rd.getDrawingBufferSize(size); const w = Math.max(4, Math.round(size.x * api.scale)), h = Math.max(4, Math.round(size.y * api.scale));
      if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
      FP.fpDepth.value = read.depthTexture; FP.fpRes.value.set(w, h);
      for (const u of envU) { if (!saved.has(u.tDepth)) saved.set(u.tDepth, [u.tDepth.value, u.uRes.value.clone()]);
        u.tDepth.value = read.depthTexture; u.uRes.value.set(w, h); u.cNear.value = camera.near; u.cFar.value = camera.far; } FP.fpNear.value = camera.near; FP.fpFar.value = camera.far; FP.fpOn.value = read.depthTexture ? 1 : 0;
      const mask = camera.layers.mask, bg = scene.background, su = rd.shadowMap.autoUpdate, ac = rd.autoClear, cc = rd.getClearAlpha(), col = rd.getClearColor(new THREE.Color());
      camera.layers.set(FOG_LAYER); scene.background = null; rd.shadowMap.autoUpdate = false;
      rd.setRenderTarget(rt); rd.setClearColor(0x000000, 0); rd.clear(true, false, false); rd.autoClear = false;
      rd.render(scene, camera);
      // give Environment's soft-edge uniforms back their own depth texture straight away: a material outside the fog layer
      // that shares them must never sample the composer's depth while that target is being drawn (WebGL feedback loop)
      for (const u of envU) { const sv = saved.get(u.tDepth); if (sv) { u.tDepth.value = sv[0]; u.uRes.value.copy(sv[1]); } }
      FP.fpDepth.value = null;
      camera.layers.mask = mask; scene.background = bg; rd.shadowMap.autoUpdate = su; rd.setClearColor(col, cc);
      // lay it over the frame (no clear: keep the frame and its depth for the passes after this one)
      // [ENV] merged mode (phones): the output pass composites the fog texture itself (one full-screen pass less);
      // api.merge() is set by index.html and says whether that is safe this frame (no pass between this one and the output)
      api.merged = !!(api.merge && api.merge() && !this.renderToScreen);
      if (api.merged) { rd.setRenderTarget(read); rd.autoClear = ac; return; }
      rd.setRenderTarget(this.renderToScreen ? null : read); fsq.render(rd); rd.autoClear = ac;
    }
    setSize() {}
  }
  api.pass = new FogPass(); api.pass.enabled = api.enabled;
  api.add = list => { for (const m of list) { if (!m) continue; m.traverse(o => { if (o.isMesh || o.isPoints) { meshes.push(o); patch(o.material); } }); }
    setLayers(api.enabled); };
  api.setEnabled = on => { api.enabled = !!on; api.pass.enabled = api.enabled; setLayers(api.enabled); FP.fpOn.value = 0; };
  api.meshes = meshes;
  return api;
}
