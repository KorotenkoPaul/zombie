// Wind thread — rain (game/rain.js): streaks that lean in the wind, splashes on roofs, landings and the ground,
// drips from the roof edges. Everything moves in vertex shaders; the CPU only sets a few uniforms per frame.
//
// createRain({THREE, scene, wind, groundH, skip: [objects not to rain on, e.g. TREE.group], MOBILE})
//   -> {update(dt, T, rainK, fogColor), roofNear(pos), ready, mesh: {drops, splash, drips}}
// A height map of everything solid under the sky (roofs, decks, landings, rails) is built once after load, a few
// rays per frame, so drops stop on the roofs instead of falling into the rooms, and splashes/drips know where to be.

export function createRain({ THREE, scene, wind, groundH = () => 0, skip = [], MOBILE = false }) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const rnd = (a, b) => a + Math.random() * (b - a);
  // the rain box: around the tree, where the camera looks
  const X0 = -16, Z0 = -8, W = 32, D = 20, TOP = 24, CS = 0.5, NX = W / CS, NZ = D / CS;
  const hm = new Float32Array(NX * NZ).fill(-99);           // top surface height per cell (-99 = not known yet)
  const kind = new Uint8Array(NX * NZ);                     // 0 ground, 1 something built (roof, deck, landing)
  const hTex = new THREE.DataTexture(hm, NX, NZ, THREE.RedFormat, THREE.FloatType);
  hTex.minFilter = hTex.magFilter = THREE.NearestFilter; hTex.needsUpdate = true;

  const U = { uT: { value: 0 }, uK: { value: 0 }, uCol: { value: new THREE.Color(0.7, 0.75, 0.8) }, uH: { value: hTex },
    uBox: { value: new THREE.Vector4(X0, Z0, W, D) }, uTop: { value: TOP } };
  const COMMON = `uniform float uT,uK,uTop;uniform vec4 uBox;uniform sampler2D uH;
    float topAt(vec2 xz){vec2 uv=(xz-uBox.xy)/uBox.zw;if(uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.)return -99.;return texture2D(uH,uv).r;}
    vec2 windVel(vec3 p){
#ifdef WIND
     return uWind.xy*windStrength(p)*3.2;
#else
     return vec2(.6,.3);
#endif
    }`;
  const mk = (vs, fs, blending = THREE.NormalBlending) => {
    const m = new THREE.ShaderMaterial({ uniforms: Object.assign({}, U), transparent: true, depthWrite: false, blending,
      vertexShader: COMMON + vs, fragmentShader: `uniform vec3 uCol;uniform float uK;` + fs });
    if (wind && wind.hookRaw) wind.hookRaw(m); return m;
  };
  const quadGeo = (n, attrs) => {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    for (const k in attrs) g.setAttribute(k, new THREE.InstancedBufferAttribute(attrs[k], 4));
    g.instanceCount = n; return g;
  };

  // ---------------- drops: thin streaks, fall ~11-14 m/s, pushed by the wind ----------------
  const ND = MOBILE ? 1600 : 3200;
  const dA = new Float32Array(ND * 4); for (let i = 0; i < ND; i++) dA.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  const drops = new THREE.Mesh(quadGeo(ND, { aD: dA }), mk(`attribute vec4 aD;varying float vA;
    void main(){float spd=11.+aD.w*3.;float fall=mod(uT*spd+aD.z*uTop*3.,uTop);vec3 p=vec3(uBox.x+aD.x*uBox.z,uTop-fall,uBox.y+aD.y*uBox.w);
     vec2 wv=windVel(p);p.xz+=wv*(fall/spd-1.);
     float on=step(fract(aD.w*7.31+aD.x*3.1),uK)*step(topAt(p.xz),p.y);
     vec3 tail=p+vec3(wv.x,spd,wv.y)*.032;
     vec4 a=viewMatrix*vec4(p,1.),b=viewMatrix*vec4(tail,1.);vec2 d=b.xy-a.xy;float L=length(d);d=L>1e-5?d/L:vec2(0.,1.);
     vec4 v=mix(a,b,position.y);v.xy+=vec2(d.y,-d.x)*position.x*max(.006,-a.z*.0026);/* about 1.5 px on screen at any distance */
     vA=on*(.14+.16*position.y)*smoothstep(1.,4.,-v.z);gl_Position=projectionMatrix*v;if(on<.5)gl_Position=vec4(2.,2.,2.,1.);}`,
    `varying float vA;void main(){gl_FragColor=vec4(uCol,vA);}`));
  drops.frustumCulled = false; drops.renderOrder = 8; drops.visible = false; scene.add(drops);

  // ---------------- splashes and drips (filled in once the height map is done) ----------------
  let splash = null, drips = null;
  function buildSplashes() {
    const cells = []; for (let i = 0; i < NX * NZ; i++) if (hm[i] > -50) { const x = X0 + (i % NX + 0.5) * CS, z = Z0 + (Math.floor(i / NX) + 0.5) * CS;
      // built surfaces everywhere in the box, the ground only near the tree (beyond it you can't see a splash anyway)
      if (kind[i] || Math.hypot(x, z - 2) < 11) cells.push([x, hm[i], z, kind[i]]); }
    const NS = Math.min(cells.length * 2, MOBILE ? 220 : 420); const sA = new Float32Array(NS * 4), sB = new Float32Array(NS * 4);
    for (let i = 0; i < NS; i++) { // roofs and decks get more than their share: that's where you look
      let c = cells[Math.floor(Math.random() * cells.length)]; if (!c[3] && Math.random() < 0.5) c = cells[Math.floor(Math.random() * cells.length)];
      sA.set([c[0] + rnd(-.24, .24), c[1] + 0.01, c[2] + rnd(-.24, .24), Math.random()], i * 4); sB.set([rnd(.35, .9), Math.random(), c[3], 0], i * 4); }
    splash = new THREE.Mesh(quadGeo(NS, { aS: sA, aP: sB }), mk(`attribute vec4 aS,aP;varying float vA;varying vec2 vUv;
      void main(){float age=fract(uT/aP.x+aS.w*7.);float k=age/.28;float on=step(aP.y,uK)*step(k,1.);
       vec4 v=viewMatrix*vec4(aS.xyz,1.);float s=(.03+.09*k)*(.8+.4*aP.y);v.xy+=vec2(position.x*s,position.y*s*.7);
       vUv=vec2(position.x,position.y);vA=on*(1.-k)*.55*smoothstep(1.,4.,-v.z);gl_Position=projectionMatrix*v;if(on<.5)gl_Position=vec4(2.,2.,2.,1.);}`,
      `varying float vA;varying vec2 vUv;void main(){float r=length(vUv*vec2(1.,1.3));
       float crown=smoothstep(.55,.8,r)*smoothstep(1.,.85,r)*(.6+.4*sin(atan(vUv.y,vUv.x)*9.));
       float a=(crown+smoothstep(.25,0.,length(vUv-vec2(0.,.35)))*.6)*vA;if(a<.01)discard;gl_FragColor=vec4(uCol*1.15,a);}`));
    splash.frustumCulled = false; splash.renderOrder = 8; splash.visible = drops.visible; scene.add(splash);

    // drips: where a roof/deck cell drops off to something much lower next to it. Find the edge more exactly with a few rays.
    const edges = [];
    for (let iz = 1; iz < NZ - 1; iz++) for (let ix = 1; ix < NX - 1; ix++) { const i = iz * NX + ix; if (!kind[i]) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const j = i + dx + dz * NX; if (hm[i] - hm[j] > 0.8) edges.push([ix, iz, dx, dz, hm[i], hm[j]]); } }
    for (let i = edges.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [edges[i], edges[j]] = [edges[j], edges[i]]; }
    const NDr = Math.min(edges.length, MOBILE ? 26 : 52); const rA = new Float32Array(NDr * 4), rB = new Float32Array(NDr * 4);
    for (let k = 0; k < NDr; k++) { const [ix, iz, dx, dz, h1, h0] = edges[k];
      const cx = X0 + (ix + 0.5) * CS, cz = Z0 + (iz + 0.5) * CS; let a = 0, b = CS, top = h1;
      for (let s = 0; s < 6; s++) { const m = (a + b) / 2; const y = castDown(cx + dx * m, cz + dz * m); if (y > h1 - 0.35) { a = m; top = y; } else b = m; }
      const off = rnd(-.2, .2); const ex = cx + dx * a + (dz ? off : 0), ez = cz + dz * a + (dx ? off : 0);
      rA.set([ex + dx * .01, top - .015, ez + dz * .01, Math.random()], k * 4); rB.set([rnd(1.4, 3.2), Math.max(.3, top - h0 - .05), Math.random(), 0], k * 4); }
    drips = new THREE.Mesh(quadGeo(NDr, { aR: rA, aQ: rB }), mk(`attribute vec4 aR,aQ;varying float vA;varying vec2 vUv;
      void main(){float age=fract(uT/aQ.x+aR.w*5.);const float H=.55;float on=step(aQ.z,uK*1.2);
       float grow=smoothstep(0.,H,age);float tf=max(0.,age-H)*aQ.x;float y=4.9*tf*tf;on*=step(y,aQ.y);
       vec3 p=aR.xyz-vec3(0.,y+grow*.012,0.);vec4 v=viewMatrix*vec4(p,1.);float st=1.+min(3.,tf*14.);
       v.xy+=vec2(position.x*.0065*(.5+.5*grow),(position.y-.5)*.016*st);vUv=vec2(position.x,position.y*2.-1.);
       vA=on*.8*smoothstep(1.,3.,-v.z);gl_Position=projectionMatrix*v;if(on<.5)gl_Position=vec4(2.,2.,2.,1.);}`,
      `varying float vA;varying vec2 vUv;void main(){float a=smoothstep(1.,.3,length(vUv))*vA;if(a<.01)discard;gl_FragColor=vec4(uCol*1.3,a);}`));
    drips.frustumCulled = false; drips.renderOrder = 8; drips.visible = drops.visible; scene.add(drips);
    R.mesh.splash = splash; R.mesh.drips = drips;
  }

  // ---------------- the height map: rays straight down, a few per frame ----------------
  const ray = new THREE.Raycaster(); ray.far = 60; const down = V(0, -1, 0); const o = V();
  let targets = null, buckets = null; const BS = 2, BX = Math.ceil(W / BS), BZ = Math.ceil(D / BS);
  function collect() {
    const sk = new Set(); for (const s of skip) s && s.traverse(x => sk.add(x));
    targets = []; scene.updateMatrixWorld(true);
    scene.traverse(m => {
      if (!m.isMesh || m.isInstancedMesh || sk.has(m) || m === drops || !m.visible) return;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.some(x => !x || x.transparent || x.isShaderMaterial || x.alphaTest > 0 || x.side === THREE.BackSide)) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      if (b.max.x - b.min.x > 14 || b.max.z - b.min.z > 14) return;   // ground, sky, backdrops
      if (b.max.y < 0.4) return; targets.push([m, b]);
    });
    buckets = Array.from({ length: BX * BZ }, () => []);
    for (const t of targets) { const b = t[1];
      for (let bz = Math.max(0, Math.floor((b.min.z - Z0) / BS)); bz <= Math.min(BZ - 1, Math.floor((b.max.z - Z0) / BS)); bz++)
        for (let bx = Math.max(0, Math.floor((b.min.x - X0) / BS)); bx <= Math.min(BX - 1, Math.floor((b.max.x - X0) / BS)); bx++) buckets[bz * BX + bx].push(t[0]); }
  }
  function castDown(x, z) {
    const bx = Math.floor((x - X0) / BS), bz = Math.floor((z - Z0) / BS); const g = groundH(x, z);
    const list = bx >= 0 && bz >= 0 && bx < BX && bz < BZ ? buckets[bz * BX + bx] : [];
    if (!list.length) return g;
    ray.set(o.set(x, 40, z), down); const hit = ray.intersectObjects(list, false)[0];
    return hit && hit.point.y > g ? hit.point.y : g;
  }
  let scan = 0, wait = 90;
  const R = {
    ready: false, mesh: { drops, splash: null, drips: null },
    update(dt, T, rainK, fogColor) {
      // build the map in the background, starting a little after load
      if (!R.ready) {
        if (wait-- > 0) return;
        if (!targets) collect();
        // a few ms per frame at most, so building the map never shows as a hitch
        const t0 = performance.now(), budget = MOBILE ? 3 : 5;
        for (; scan < NX * NZ && performance.now() - t0 < budget; scan++) { const ix = scan % NX, iz = Math.floor(scan / NX); const x = X0 + (ix + .5) * CS, z = Z0 + (iz + .5) * CS;
          const y = castDown(x, z); hm[scan] = y; kind[scan] = y > groundH(x, z) + 0.6 ? 1 : 0; }
        if (scan >= NX * NZ) { R.ready = true; hTex.needsUpdate = true; buildSplashes(); targets = null; }
        else return;
      }
      const on = rainK > 0.01; drops.visible = on; if (splash) splash.visible = on; if (drips) drips.visible = on;
      if (!on) return;
      U.uT.value = T; U.uK.value = rainK;
      if (fogColor) U.uCol.value.copy(fogColor).multiplyScalar(1.25).addScalar(0.12);
    },
    // 0..1: how much roof/deck is being rained on around a point (for the rain-on-roof sound)
    roofNear(p) {
      if (!R.ready) return 0; let n = 0, c = 0; const x = p.x ?? p[0], z = p.z ?? p[2];
      for (let dz = -6; dz <= 6; dz += 2) for (let dx = -6; dx <= 6; dx += 2) { const ix = Math.floor((x - X0) / CS) + dx, iz = Math.floor((z - Z0) / CS) + dz;
        if (ix < 0 || iz < 0 || ix >= NX || iz >= NZ) continue; c++; if (kind[iz * NX + ix]) n++; }
      return c ? Math.min(1, n / c * 2.5) * U.uK.value : 0;
    },
    heightAt(x, z) { const ix = Math.floor((x - X0) / CS), iz = Math.floor((z - Z0) / CS); return ix < 0 || iz < 0 || ix >= NX || iz >= NZ ? null : hm[iz * NX + ix]; }
  };
  return R;
}
