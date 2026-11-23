// Wind thread — the morning fog bank (game/fogbank.js).
// On most mornings a light breeze carries a bank of low mist in from the forest (wind.js decides when and where the
// front is: uFogBank). It rolls through the clearing along the wind, hugging the ground, and lifts as the sun gets up.
// One or two big noise sheets near the ground, drawn only while a bank is out. Environment's own fog stays as it is.
//
// createFogBank({THREE, scene, wind, MOBILE}) -> {update(fogColor), sheets}

export function createFogBank({ THREE, scene, wind, MOBILE = false }) {
  const U = { uCol: { value: new THREE.Color(0.8, 0.82, 0.86) }, uOp: { value: 0.5 } };
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms: U,
    vertexShader: `varying vec3 vW;varying float vB;void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;
#ifdef WIND
      // how far the bank has come: thick behind the front, a soft 10 m leading edge
      vB=uFogBank.y*clamp((uFogBank.x-dot(w.xz,uWind.xy))/10.,0.,1.);
#else
      vB=0.;
#endif
      gl_Position=projectionMatrix*viewMatrix*w;}`,
    fragmentShader: `uniform vec3 uCol;uniform float uOp;varying vec3 vW;varying float vB;
#ifdef WIND
      uniform vec2 uDrift;
#endif
      float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
      float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
      void main(){if(vB<.004)discard;vec2 dr=vec2(0.);
#ifdef WIND
       dr=uDrift;
#endif
       vec2 p=(vW.xz-dr*.9)*.09+vec2(vW.y*2.3,0.);float d=n(p)*.55+n(p*2.13+3.1)*.3+n(p*4.4+7.7)*.15;
       float edge=smoothstep(70.,40.,length(vW.xz));float a=smoothstep(.32,.8,d)*vB*uOp*edge;gl_FragColor=vec4(uCol*(.9+.25*d),a);}` });
  // hookRaw adds the wind uniforms and the WIND define (the fragment shader reads uDrift through it too)
  if (wind && wind.hookRaw) wind.hookRaw(mat);
  const sheets = [];
  for (const [y, k] of (MOBILE ? [[0.6, 1]] : [[0.45, 1], [1.15, 0.7]])) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(140, 140).rotateX(-Math.PI / 2), mat.clone());
    m.material.uniforms = Object.assign({}, mat.uniforms, { uOp: { value: 0.5 * k } }); m.userData.k = k;
    m.position.y = y; m.renderOrder = 4; m.frustumCulled = false; m.visible = false; scene.add(m); sheets.push(m);
  }
  return {
    sheets,
    update(fogColor) {
      const fbk = wind && wind.fogBank ? wind.fogBank().k : 0; const on = fbk > 0.01;
      for (const m of sheets) { m.visible = on; if (on && fogColor) m.material.uniforms.uCol.value.copy(fogColor).lerp(new THREE.Color(1, 1, 1), 0.25); }
    }
  };
}
