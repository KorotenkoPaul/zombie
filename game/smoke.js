// Wind thread — thin smoke from the kitchen stove pipe (game/smoke.js).
//
// A small plume of soft puffs rising from the pipe top. How thick it is follows the oven heat (lights.js owns the fire),
// and the wind (game/wind.js) bends it: a calm night gives a lazy column, a breeze lays it over, a gust tears it sideways.
// All motion is in the vertex shader (each puff loops on its own clock); the CPU sets a few uniforms per frame.
//
// createSmoke({THREE, scene, wind, P3, heat: () => 0..1, MOBILE}) -> {update(dt, T, fogColor), points, source()}
// The source is __props.chimneyTop (THREE.Vector3, the opening of the pipe, world space), added by Props.
// While there is no pipe, nothing is drawn: no smoke out of thin air.

export function createSmoke({ THREE, scene, wind, P3, heat = () => 0, MOBILE = false }) {
  const N = MOBILE ? 24 : 40, LIFE = 7;
  const g = new THREE.BufferGeometry();
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([i / N, Math.random(), Math.random(), Math.random()], i * 4);
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aS', new THREE.BufferAttribute(seed, 4));
  const U = { uSrc: { value: new THREE.Vector3() }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0.5, 0.52, 0.56) },
    uT: { value: 0 }, uPx: { value: Math.min(2, window.devicePixelRatio || 1) } };
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: U,
    vertexShader: `attribute vec4 aS;uniform vec3 uSrc;uniform float uAmt,uT,uPx;varying float vA,vR;
      void main(){float age=fract(uT/${LIFE.toFixed(1)}+aS.x);float tt=age*${LIFE.toFixed(1)};
       // rises fast out of the pipe, slows as it cools; spreads and wobbles as it goes
       vec3 p=uSrc+vec3(0.,1.25*(1.-exp(-tt*.55))*1.6+tt*.08,0.);
       vec3 w=vec3(0.);
#ifdef WIND
       float s=windStrength(uSrc);w=vec3(uWind.x,0.,uWind.y)*s*tt*1.2*(1.-exp(-tt*.8));
       vec2 sw=windSway(p+w,.4)*.12*tt;w.xz+=sw;p.y-=s*s*tt*.12;
#endif
       p+=w+vec3(sin(tt*1.3+aS.y*6.28),0.,cos(tt*1.1+aS.z*6.28))*.05*tt;
       vec4 mv=viewMatrix*vec4(p,1.);
       vA=uAmt*smoothstep(0.,.08,age)*(1.-age)*(1.-age)*.32;vR=aS.w;
       gl_PointSize=clamp((.35+tt*.32)*500./-mv.z,1.,128.)*uPx;gl_Position=projectionMatrix*mv;}`,
    fragmentShader: `uniform vec3 uCol;varying float vA,vR;
      void main(){vec2 d=gl_PointCoord-.5;float r=length(d);
       float n=sin(d.x*7.+vR*20.)*sin(d.y*6.-vR*13.)*.2;
       float k=1.-smoothstep(0.,.5,r+n*.15);float a=k*k*vA;if(a<.004)discard;gl_FragColor=vec4(uCol*(.9+n),a);}` });
  if (wind && wind.hookRaw) wind.hookRaw(mat);
  const points = new THREE.Points(g, mat); points.frustumCulled = false; points.renderOrder = 5; points.visible = false; scene.add(points);
  let amt = 0, forced = null;
  const source = () => (P3 && P3.chimneyTop) || (window.__props && window.__props.chimneyTop) || null;
  return {
    points, source,
    force(v) { forced = v; },  // tests: pin the smoke amount (null = follow the oven again)
    update(dt, T, fogColor) {
      const src = source();
      // thickens over ~10 s as the fire takes, thins out slowly when it dies
      const want = src ? (forced ?? Math.min(1, heat() * 1.1)) : 0; amt += (want - amt) * Math.min(1, dt / (want > amt ? 6 : 12));
      points.visible = amt > 0.01;
      if (!points.visible) return;
      U.uSrc.value.copy(src); U.uAmt.value = amt; U.uT.value = T;
      // grey smoke tinted by the air around it, so it reads at night and by day
      if (fogColor) U.uCol.value.copy(fogColor).multiplyScalar(1.05).lerp(new THREE.Color(0.55, 0.55, 0.57), 0.35);
    }
  };
}
