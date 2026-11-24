// Wind thread — small autumn particles, cheap on the phone (game/particles.js).
//
//  - Dust in the lamplight: in each room whose lamp is on, a few dozen specks of dust hang and drift in the air. They
//    only show where the lamp light reaches them (a soft glow around the source) and they vanish when it goes out.
//    One Points draw per room (3 in all), all motion in the vertex shader.
//  - Breath vapour: on cold mornings and nights (__weather.cold) the hero's breath shows as a small cloud on each
//    exhale, drifting with the wind. 10 points updated on the CPU, one draw, only while it is cold.
//
// createParticles({THREE, scene, wind, lights, rooms, hero: {head: () => Bone|null, mouth?: () => Vector3|null}, MOBILE})
//   -> {update(dt, T, fogColor), dust: [Points], breath: Points, addPerfSteps(PERF)}
// rooms: [[x0,x1,y0,y1,z0,z1], ...] room boxes (index.html's LEAF_AVOID). A light source belongs to the box it is in.

export function createParticles({ THREE, scene, wind, lights, rooms = [], hero = {}, groundH = () => 0, MOBILE = false }) {
  const PR = Math.min(2, window.devicePixelRatio || 1);
  const api = { dust: [], breath: null };

  // ---------------- dust in the lamplight ----------------
  const ND = MOBILE ? 140 : 240;
  const dustU = () => ({ uT: { value: 0 }, uB0: { value: new THREE.Vector3() }, uB1: { value: new THREE.Vector3() },
    uL: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uCol: { value: new THREE.Color(1, 0.86, 0.62) }, uPx: { value: PR }, uK: { value: 1 } });
  const dustVS = `attribute vec4 aS;uniform float uT,uPx,uK;uniform vec3 uB0,uB1;uniform vec4 uL[3];varying float vA;
    void main(){vec3 sz=uB1-uB0;
     // each speck drifts on its own slow loop and sinks very slowly through the room (it wraps around)
     vec3 f=aS.xyz+vec3(sin(uT*.07+aS.w*6.)*.04,-uT*.004*(.5+aS.w),cos(uT*.05+aS.w*9.)*.04);
     f+=vec3(sin(uT*.31+aS.w*40.),sin(uT*.23+aS.w*17.),cos(uT*.27+aS.w*29.))*.012;
     vec3 p=uB0+fract(f)*sz;
     float L=0.;for(int i=0;i<3;i++){vec3 d=p-uL[i].xyz;L+=uL[i].w*exp(-dot(d,d)*.7);}
     // a faint twinkle as a speck turns in the light
     float tw=.55+.45*sin(uT*(1.3+aS.w*2.)+aS.x*50.);
     vA=min(1.,L*2.)*tw*uK;vec4 mv=modelViewMatrix*vec4(p,1.);
     gl_PointSize=clamp(2.2*uPx*(4./-mv.z),1.5,4.*uPx);gl_Position=projectionMatrix*mv;if(vA<.01)gl_Position=vec4(2.,2.,2.,1.);}`;
  const dustFS = `uniform vec3 uCol;varying float vA;void main(){float k=smoothstep(.5,.1,length(gl_PointCoord-.5));gl_FragColor=vec4(uCol*k*vA*1.6,k*vA);}`;
  const roomsDust = [];
  for (const b of rooms) {
    const g = new THREE.BufferGeometry(); const s = new Float32Array(ND * 4);
    for (let i = 0; i < ND; i++) s.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ND * 3), 3)); g.setAttribute('aS', new THREE.BufferAttribute(s, 4));
    const U = dustU(); U.uB0.value.set(b[0] + 0.5, b[2] + 0.25, b[4] + 0.5); U.uB1.value.set(b[1] - 0.5, b[3] - 0.35, b[5] - 0.5);
    const m = new THREE.ShaderMaterial({ uniforms: U, vertexShader: dustVS, fragmentShader: dustFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.visible = false; pts.renderOrder = 6; scene.add(pts); pts.matrixAutoUpdate = false;
    roomsDust.push({ b, U, pts, src: null }); api.dust.push(pts);
  }
  const inBox = (p, b) => p.x > b[0] && p.x < b[1] && p.y > b[2] - 0.3 && p.y < b[3] + 0.3 && p.z > b[4] && p.z < b[5];
  let srcT = 0, dustOn = true, dustK = 1;
  const lv = {};
  function updateDust(dt, T) {
    if (!lights || !lights.list) return;
    // which sources light which room (re-checked now and then: lamps can be moved by other code)
    const LL = lights.list();
    if ((srcT -= 1) <= 0) { srcT = 120; for (const r of roomsDust) r.src = [];
      for (const s of LL) { if (s.kind === 'glow') continue; const p = lights.pos ? lights.pos(s.name) : null; if (!p) continue;
        const r = roomsDust.find(r => inBox(p, r.b)); if (r && r.src.length < 3) r.src.push({ name: s.name, p: p.clone ? p.clone() : p }); } }
    // on/off with a short fade of our own (the sources' 'level' is a brightness scale, not 0..1)
    for (const s of LL) lv[s.name] = (lv[s.name] ?? 0) + ((s.on ? 1 : 0) - (lv[s.name] ?? 0)) * Math.min(1, dt / 0.6);
    dustK += ((dustOn ? 1 : 0) - dustK) * Math.min(1, dt * 0.5);   // the quality step fades it over ~2 s
    for (const r of roomsDust) {
      let any = 0; for (let i = 0; i < 3; i++) { const s = r.src && r.src[i]; const L = s ? Math.max(0, Math.min(1, lv[s.name] || 0)) : 0;
        r.U.uL.value[i].set(s ? s.p.x : 0, s ? s.p.y : -99, s ? s.p.z : 0, L); any = Math.max(any, L); }
      // the specks fill the air around (and mostly below) the main lamp of the room, not the whole room
      const m = r.src && r.src[0]; if (m) { const b = r.b;
        r.U.uB0.value.set(Math.max(b[0] + 0.3, m.p.x - 1.4), Math.max(b[2] + 0.2, m.p.y - 1.9), Math.max(b[4] + 0.3, m.p.z - 1.4));
        r.U.uB1.value.set(Math.min(b[1] - 0.3, m.p.x + 1.4), Math.min(b[3] - 0.2, m.p.y + 0.3), Math.min(b[5] - 0.3, m.p.z + 1.4)); }
      r.U.uK.value = dustK;
      r.pts.visible = dustK > 0.01 && any > 0.03; r.U.uT.value = T;
    }
  }

  // ---------------- breath vapour ----------------
  const NB = 10, bPos = new Float32Array(NB * 3), bA = new Float32Array(NB * 2);
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(bPos, 3)); bg.setAttribute('aA', new THREE.BufferAttribute(bA, 2));
  const bU = { uCol: { value: new THREE.Color(0.85, 0.87, 0.9) }, uPx: { value: PR } };
  const bm = new THREE.ShaderMaterial({ uniforms: bU, transparent: true, depthWrite: false,
    vertexShader: `attribute vec2 aA;uniform float uPx;varying float vA;void main(){vA=aA.x;vec4 mv=modelViewMatrix*vec4(position,1.);
      gl_PointSize=clamp(aA.y*420.*uPx/-mv.z,1.,140.*uPx);gl_Position=projectionMatrix*mv;if(vA<.003)gl_Position=vec4(2.,2.,2.,1.);}`,
    fragmentShader: `uniform vec3 uCol;varying float vA;void main(){vec2 d=gl_PointCoord-.5;float r=length(d);float k=1.-smoothstep(.1,.5,r);gl_FragColor=vec4(uCol,k*k*vA);}` });
  const breath = new THREE.Points(bg, bm); breath.frustumCulled = false; breath.renderOrder = 7; breath.visible = false; scene.add(breath); breath.matrixAutoUpdate = false; api.breath = breath;
  const B = []; for (let i = 0; i < NB; i++) B.push({ on: false, p: [0, 0, 0], v: [0, 0, 0], age: 0, life: 1.6 });
  const hv = new THREE.Vector3(), up = new THREE.Vector3(), fw = new THREE.Vector3(), m3 = new THREE.Matrix4();
  let cyc = Math.random() * 3.6, coldK = 0;
  // where the breath comes out: Character can give it exactly (hero.mouth()), else ~ in front of the face from the head bone
  function mouth() {
    const h = hero.head && hero.head();
    if (h) { h.updateWorldMatrix(true, false); m3.extractRotation(h.matrixWorld); up.set(0, 1, 0).applyMatrix4(m3).normalize(); fw.set(0, 0, 1).applyMatrix4(m3).normalize(); }
    const m = hero.mouth && hero.mouth(); if (m && m.lengthSq() > 0) return hv.copy(m);   // Character's own lip point (window.__hero.mouth)
    if (!h) return null;
    return h.getWorldPosition(hv).addScaledVector(up, 0.07).addScaledVector(fw, 0.09);
  }
  function updateBreath(dt) {
    const W = window.__weather && window.__weather.state ? window.__weather.state() : null;
    // how cold: shows from feels ~6 °C, clearly below ~2 °C; inside a room only when it is really cold there too
    let want = W ? Math.max(0, Math.min(1, (6 - W.feels) / 4)) : 0;
    const mo = want > 0 ? mouth() : null;
    if (mo && rooms.some(b => inBox(mo, b))) want *= W.feels < 2 ? 0.5 : 0;
    coldK += (want - coldK) * Math.min(1, dt / 4);
    let live = false;
    // a breath every ~3.6 s (a little irregular); the cloud comes out over the first ~1 s of the exhale
    cyc += dt; const per = 3.6;
    if (mo && coldK > 0.03) { const ph = cyc % per; if (ph < 1.0 && Math.random() < dt * 5) {
      const b = B.find(b => !b.on); if (b) { const w = wind ? wind.sample(mo) : { x: 0, z: 0 };
        b.on = true; b.age = 0; b.life = 1.3 + Math.random() * 0.6; b.p = [mo.x, mo.y, mo.z];
        b.v = [fw.x * 0.35 + w.x * 0.25 + (Math.random() - 0.5) * 0.06, 0.05 + Math.random() * 0.05, fw.z * 0.35 + w.z * 0.25 + (Math.random() - 0.5) * 0.06]; } } }
    for (let i = 0; i < NB; i++) { const b = B[i];
      if (b.on) { b.age += dt; if (b.age >= b.life) b.on = false; }
      if (!b.on) { bA[i * 2] = 0; continue; } live = true;
      const k = Math.exp(-dt * 1.6); b.v[0] *= k; b.v[2] *= k; b.v[1] += dt * 0.04;   // slows down, lifts a little as it warms
      b.p[0] += b.v[0] * dt; b.p[1] += b.v[1] * dt; b.p[2] += b.v[2] * dt;
      const a = b.age / b.life; bPos.set(b.p, i * 3);
      bA[i * 2] = 0.32 * coldK * Math.min(1, a * 6) * (1 - a) * (1 - a); bA[i * 2 + 1] = 0.05 + a * 0.22; }
    breath.visible = live;
    if (live) { bg.attributes.position.needsUpdate = true; bg.attributes.aA.needsUpdate = true; }
  }

  // ---------------- leaves and dust kicked up under his feet ----------------
  // Outside (on the ground and the landings, not in the rooms): when a foot comes down while he walks, a few leaf bits
  // (on the ground) or dust specks (on the boards) hop up and settle, drifting with the wind. 24 points, one draw.
  const NK = MOBILE ? 16 : 24, kPos = new Float32Array(NK * 3), kA = new Float32Array(NK * 4);
  const kg = new THREE.BufferGeometry(); kg.setAttribute('position', new THREE.BufferAttribute(kPos, 3)); kg.setAttribute('aK', new THREE.BufferAttribute(kA, 4));
  const km = new THREE.ShaderMaterial({ uniforms: { uPx: { value: PR } }, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 aK;uniform float uPx;varying vec4 vK;void main(){vK=aK;vec4 mv=modelViewMatrix*vec4(position,1.);
      gl_PointSize=clamp((aK.z>.5?.05:.025)*500.*uPx/-mv.z,1.,24.*uPx);gl_Position=projectionMatrix*mv;if(aK.x<.01)gl_Position=vec4(2.,2.,2.,1.);}`,
    fragmentShader: `varying vec4 vK;void main(){vec2 d=gl_PointCoord-.5;
      // leaf bit: a little flat flake turning (squashed by the spin phase); dust: a soft speck
      float leaf=step(.5,vK.z);vec2 q=vec2(d.x*(1.+2.*abs(sin(vK.w*6.28))),d.y);float k=leaf>.5?step(length(q),.42):smoothstep(.5,.15,length(d));
      vec3 c=leaf>.5?mix(vec3(.62,.34,.1),vec3(.8,.6,.18),fract(vK.w*7.)):vec3(.62,.56,.48);if(k*vK.x<.02)discard;gl_FragColor=vec4(c,k*vK.x*(leaf>.5?1.:.45));}` });
  const kick = new THREE.Points(kg, km); kick.frustumCulled = false; kick.renderOrder = 6; kick.visible = false; scene.add(kick); kick.matrixAutoUpdate = false; api.kick = kick;
  const K = []; for (let i = 0; i < NK; i++) K.push({ on: false, p: [0, 0, 0], v: [0, 0, 0], age: 0, life: 1, leaf: 0, sp: Math.random() });
  const feet = [{ b: 'LeftFoot', y: 0, vy: 0, cd: 0 }, { b: 'RightFoot', y: 0, vy: 0, cd: 0 }], fp = new THREE.Vector3(), hp = new THREE.Vector3(), lastHip = new THREE.Vector3(); let hipSp = 0, kickOn = true;
  function floorUnder(x, z, y) { const g = groundH(x, z); const h = window.__rain && window.__rain.ready ? window.__rain.heightAt(x, z) : null; return h != null && h > g + 0.3 && h <= y + 0.25 ? [h, 0] : [g, 1]; }
  function updateKick(dt) {
    const B = hero.bones && hero.bones(); let live = false;
    if (B && B.Hips && kickOn && dt > 0) {
      B.Hips.getWorldPosition(hp); hipSp += ((hp.distanceTo(lastHip) / dt) - hipSp) * Math.min(1, dt * 6); lastHip.copy(hp);
      for (const f of feet) { const b = B[f.b]; if (!b) continue; b.getWorldPosition(fp); const vy = (fp.y - f.y) / dt; f.cd -= dt;
        // a foot lands: it was coming down and now stops, close to the floor, while he is walking (not standing, not climbing)
        if (f.vy < -0.25 && vy > -0.05 && f.cd <= 0 && hipSp > 0.5 && hipSp < 4) {
          const [fy, ground] = floorUnder(fp.x, fp.z, fp.y);
          if (fp.y - fy < 0.18 && !rooms.some(bx => inBox(fp, bx))) { f.cd = 0.25; const n = ground ? 2 + (Math.random() < 0.5 ? 1 : 0) : 1 + (Math.random() < 0.4 ? 1 : 0);
            const w = wind ? wind.sample(fp) : { x: 0, z: 0 };
            for (let j = 0; j < n; j++) { const k = K.find(k => !k.on); if (!k) break; const a = Math.random() * 6.28, sp = 0.2 + Math.random() * 0.45;
              Object.assign(k, { on: true, age: 0, life: ground ? 0.9 + Math.random() * 0.6 : 0.6 + Math.random() * 0.4, leaf: ground && Math.random() < 0.7 ? 1 : 0,
                p: [fp.x + Math.cos(a) * 0.06, fy + 0.02, fp.z + Math.sin(a) * 0.06], v: [Math.cos(a) * sp + w.x * 0.2, 0.5 + Math.random() * 0.7, Math.sin(a) * sp + w.z * 0.2], fy }); } } }
        f.vy = vy; f.y = fp.y; }
    }
    for (let i = 0; i < NK; i++) { const k = K[i]; if (k.on) { k.age += dt; if (k.age >= k.life) k.on = false; }
      if (!k.on) { kA[i * 4] = 0; continue; } live = true;
      const drag = k.leaf ? 3 : 4, w = wind ? wind.sample({ x: k.p[0], z: k.p[2] }) : { x: 0, z: 0 };
      k.v[0] += (w.x * 0.5 - k.v[0]) * Math.min(1, dt * drag); k.v[2] += (w.z * 0.5 - k.v[2]) * Math.min(1, dt * drag); k.v[1] -= dt * (k.leaf ? 3.2 : 1.6);
      if (k.leaf) k.v[1] = Math.max(k.v[1], -0.6);   // a leaf flutters down, it doesn't drop
      k.p[0] += k.v[0] * dt; k.p[1] += k.v[1] * dt; k.p[2] += k.v[2] * dt; if (k.p[1] < k.fy + 0.01) { k.p[1] = k.fy + 0.01; k.v[0] *= 0.5; k.v[2] *= 0.5; k.v[1] = 0; }
      const a = k.age / k.life; kPos.set(k.p, i * 3); kA.set([Math.min(1, a * 10) * (1 - a * a), 0, k.leaf, k.sp + k.age * (1 + k.sp)], i * 4); }
    kick.visible = live; if (live) { kg.attributes.position.needsUpdate = true; kg.attributes.aK.needsUpdate = true; }
  }

  api.update = (dt, T, fogColor) => {
    updateDust(dt, T); updateBreath(dt); updateKick(dt);
    if (fogColor && breath.visible) bU.uCol.value.copy(fogColor).lerp(new THREE.Color(0.86, 0.88, 0.92), 0.7);
  };
  // quality: the dust goes first (pure decoration)
  api.addPerfSteps = PERF => { PERF.addStep('roomDust', () => { if (!dustOn) return false; dustOn = false; }, () => { dustOn = true; }, 60);
    PERF.addStep('footKick', () => { if (!kickOn) return false; kickOn = false; }, () => { kickOn = true; }, 58); };
  return api;
}
