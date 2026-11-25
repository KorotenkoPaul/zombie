// HERO CLOTHES (v6 hero, thread "Обновить облик героя до концепта 6", 2026-11-25): cloth that reads as cloth up close.
// The "wood grain" streaks on the sleeves were painted into the generated texture: the pipeline (clothfix.mjs) blurs them out of
// the sleeve texels and flattens the normal map there. Here, a procedural surface in the bind pose, so it sticks to the cloth as he moves and never depends on the UVs:
//  - sweater (mustard texels): stockinette knit, columns along the limb (V stitches), soft fibre shading, roughness .95
//  - trousers (green texels): diagonal twill and canvas noise, worn pale knees, roughness .9
//  - vest: darker, less red leather with grain, creases, mottled patina and rubbed pale edges, roughness .75 (.6 rubbed)
//  - boots: pull-up leather grain, scuffed pale toe and heel, dark ankle creases, roughness .6
// Fine relief is a bump from screen derivatives of the pattern and fades out by pixel footprint (no shimmer at the game camera);
// the colour work (patina, wear) stays at every distance. No texture reads, no extra draw calls or triangles.
// ?cloth=0 turns it off.
export function dressHero({ THREE, root }) {
  const q = new URLSearchParams(location.search).get('cloth');
  if (q === '0') return null;
  const meshes = {};
  root.traverse(o => { if (!o.isSkinnedMesh || !o.material || Array.isArray(o.material)) return;
    if (o.name === 'Mesh_0' || (o.parent && o.parent.name === 'Mesh_0' && o.material.name === 'Material_0')) { if (o.material.name === 'Material_0') meshes.body = o; }
    else if (o.name === 'vest' || (o.parent && o.parent.name === 'vest')) meshes.vest = o;
    else if (o.name === 'boots' || (o.parent && o.parent.name === 'boots')) meshes.boots = o;
    else if (o.name === 'undershirt' || (o.parent && o.parent.name === 'undershirt')) meshes.under = o; });
  if (!meshes.body || !meshes.vest) return null;
  if (!meshes.under) return null; // v6 only
  const sk = meshes.body.skeleton; const bn = sk.bones.map(b => b.name.replace('mixamorig', '').replace(':', ''));
  const bi = n => bn.indexOf(n); const bindPos = n => { const i = bi(n); return i < 0 ? null : new THREE.Vector3().setFromMatrixPosition(sk.boneInverses[i].clone().invert()); };
  // skeleton space -> metres: the spine chain's length in the bind pose against the same bones in the world now
  root.updateMatrixWorld(true);
  let lb = 0, lw = 0; { const ch = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head']; for (let k = 1; k < ch.length; k++) { const a = bindPos(ch[k - 1]), b = bindPos(ch[k]); if (!a || !b) continue; lb += a.distanceTo(b);
    lw += sk.bones[bi(ch[k - 1])].getWorldPosition(new THREE.Vector3()).distanceTo(sk.bones[bi(ch[k])].getWorldPosition(new THREE.Vector3())); } }
  const S = lb > 0 && lw > 0 ? lw / lb : 1;
  // frames: one per limb (straight in the bind pose), the torso's vertical
  const fwd0 = new THREE.Vector3(0, 0, 1);
  function frame(a, b) { const A = bindPos(a), B = bindPos(b); if (!A || !B) return null; const ax = B.clone().sub(A).normalize();
    const f = fwd0.clone().addScaledVector(ax, -fwd0.dot(ax)); if (f.lengthSq() < 1e-4) f.set(0, 1, 0).addScaledVector(ax, -ax.y); f.normalize(); const s = new THREE.Vector3().crossVectors(ax, f);
    return { o: A, x: s, y: f, z: ax }; }
  const FR = { torso: frame('Hips', 'Neck'), armL: frame('LeftArm', 'LeftHand'), armR: frame('RightArm', 'RightHand'), legL: frame('LeftUpLeg', 'LeftFoot'), legR: frame('RightUpLeg', 'RightFoot') };
  if (!FR.torso) return null;
  const grpOf = n => /^Left(Arm|ForeArm|Hand)/.test(n) ? 'armL' : /^Right(Arm|ForeArm|Hand)/.test(n) ? 'armR' : /^Left(UpLeg|Leg|Foot|Toe)/.test(n) ? 'legL' : /^Right(UpLeg|Leg|Foot|Toe)/.test(n) ? 'legR' : 'torso';
  const kneeF = ['Left', 'Right'].map(sd => { const k = bindPos(sd + 'Leg'); const fr = FR['leg' + sd[0]]; return k && fr ? k.clone().addScaledVector(fr.y, .045 / S) : null; });
  const toes = ['Left', 'Right'].map(sd => bindPos(sd + 'ToeBase')), heels = ['Left', 'Right'].map(sd => bindPos(sd + 'Foot'));
  const GC = (a, i, c) => c === 0 ? a.getX(i) : c === 1 ? a.getY(i) : c === 2 ? a.getZ(i) : a.getW(i);
  // the vest's span around the torso axis (72 bins of angle): body torso points between its hem and its top there are under the
  // vest. Where the vest's jagged collar and armhole edges leave notches, the sweater behind showed as orange zigzags (critic
  // pass 20b): those body points take the vest's leather while it is on. Notches are filled by a max/min filter over the bins.
  const NB = 72; const ENV = (() => { const vg = meshes.vest.geometry, VPa = vg.attributes.position; if (!VPa) return null; const fr = FR.torso; const top = new Float32Array(NB).fill(-1e9), bot = new Float32Array(NB).fill(1e9); const q = new THREE.Vector3();
    for (let i = 0; i < VPa.count; i++) { q.fromBufferAttribute(VPa, i).applyMatrix4(meshes.vest.bindMatrix).sub(fr.o); const x = q.dot(fr.x) * S, y = q.dot(fr.y) * S, z = q.dot(fr.z) * S; const b = ((Math.floor((Math.atan2(y, x) + Math.PI) / (2 * Math.PI) * NB)) % NB + NB) % NB; top[b] = Math.max(top[b], z); bot[b] = Math.min(bot[b], z); }
    const T2 = new Float32Array(NB), B2 = new Float32Array(NB); for (let b = 0; b < NB; b++) { let t = -1e9, m = 1e9; for (let k = -2; k <= 2; k++) { const j = (b + k + NB) % NB; t = Math.max(t, top[j]); m = Math.min(m, bot[j]); } T2[b] = t; B2[b] = m; }
    return { top: T2, bot: B2 }; })();
  const uVest = { value: 1 };
  const v = new THREE.Vector3(), n3 = new THREE.Vector3(), nm = new THREE.Matrix3();
  function attrs(mesh, cls) {
    const g = mesh.geometry; const P = g.attributes.position, N = g.attributes.normal, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight; if (!P || !N || !SI) return;
    const cnt = P.count; const kp = new Float32Array(cnt * 3), kn = new Float32Array(cnt * 3), kx = new Float32Array(cnt * 3);
    nm.getNormalMatrix(mesh.bindMatrix); const bp = new Array(cnt);
    for (let i = 0; i < cnt; i++) {
      let m = -1, mb = 0; for (let c = 0; c < 4; c++) { const w = GC(SW, i, c); if (w > m) { m = w; mb = GC(SI, i, c); } }
      const fr = FR[grpOf(bn[mb] || '')] || FR.torso;
      v.fromBufferAttribute(P, i).applyMatrix4(mesh.bindMatrix); bp[i] = v.clone(); n3.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      const d = v.clone().sub(fr.o);
      kp[i * 3] = d.dot(fr.x) * S; kp[i * 3 + 1] = d.dot(fr.y) * S; kp[i * 3 + 2] = d.dot(fr.z) * S;
      kn[i * 3] = n3.dot(fr.x); kn[i * 3 + 1] = n3.dot(fr.y); kn[i * 3 + 2] = n3.dot(fr.z);
      let wear = 0;
      if (cls === 0) { for (const k of kneeF) if (k) wear = Math.max(wear, Math.exp(-((v.distanceTo(k) * S) ** 2) / (2 * .05 * .05))); }
      if (cls === 2) { for (let s = 0; s < 2; s++) { const t = toes[s], h = heels[s]; if (!t || !h) continue; const ax = t.clone().sub(h); const L = ax.length(); ax.normalize();
        const along = v.clone().sub(h).dot(ax) / L; const low = Math.max(0, 1 - Math.max(0, v.y - h.y + .02 / S) * S / .05);
        // toe cap and heel counter scuff; the ankle front creases darker (negative)
        const toe = THREE.MathUtils.smoothstep(along, 1.05, 1.5) * (.4 + .6 * low), heel = THREE.MathUtils.smoothstep(-along, .15, .45) * low;
        const dx = v.clone().sub(h); const crease = Math.exp(-((dx.y * S - .04) ** 2) / (2 * .02 * .02)) * Math.max(0, n3.dot(ax)) * THREE.MathUtils.smoothstep(along, -.2, .4) * (1 - THREE.MathUtils.smoothstep(along, .6, 1));
        if (v.distanceTo(h) * S < .3) wear = Math.max(wear, Math.max(toe, heel) * (1 - crease)) - crease * .5; } }
      // the body's own feet (under the boots, with collapsed UVs: a flat orange smear when the boots are off) become wool socks
      kx[i * 3] = cls === 0 && /^(Left|Right)(Foot|ToeBase|Toe_End)/.test(bn[mb] || '') ? 3 : cls; kx[i * 3 + 1] = wear;
      if (cls === 0 && ENV && grpOf(bn[mb] || '') === 'torso' && fr === FR.torso) { const th = Math.atan2(kp[i * 3 + 1], kp[i * 3]); const b = ((Math.floor((th + Math.PI) / (2 * Math.PI) * NB)) % NB + NB) % NB; const z = kp[i * 3 + 2];
        kx[i * 3 + 2] = z > ENV.bot[b] && z < ENV.top[b] - .002 && kp[i * 3 + 1] < .01 ? 1 : 0; } // back half only: in front, the gap between the flaps rightly shows the sweater
    }
    // vest: rubbed edges, by the distance (along the surface) to its open border
    if (cls === 1 && g.index) {
      const wid = new Int32Array(cnt); const key = new Map(); for (let i = 0; i < cnt; i++) { const p = bp[i]; const k = Math.round(p.x * 4000) + ',' + Math.round(p.y * 4000) + ',' + Math.round(p.z * 4000); if (!key.has(k)) key.set(k, key.size); wid[i] = key.get(k); }
      const nw = key.size; const I = g.index.array; const ec = new Map(); const adj = Array.from({ length: nw }, () => []); const rep = new Int32Array(nw); for (let i = 0; i < cnt; i++) rep[wid[i]] = i;
      for (let t = 0; t < I.length; t += 3) for (let e = 0; e < 3; e++) { const a = wid[I[t + e]], b = wid[I[t + (e + 1) % 3]]; if (a === b) continue; const k = a < b ? a + ',' + b : b + ',' + a; ec.set(k, (ec.get(k) || 0) + 1); adj[a].push(b); adj[b].push(a); }
      const dist = new Float32Array(nw).fill(1e9); const Q = []; for (const [k, c] of ec) if (c === 1) { for (const s of k.split(',')) { const w = +s; if (dist[w] > 0) { dist[w] = 0; Q.push(w); } } }
      // Bellman-Ford style relaxation over edge lengths (small mesh): good enough as a geodesic distance
      for (let it = 0; it < 60 && Q.length; it++) { const nx = []; for (const a of Q) for (const b of adj[a]) { const dd = dist[a] + bp[rep[a]].distanceTo(bp[rep[b]]) * S; if (dd < dist[b] - 1e-5) { dist[b] = dd; nx.push(b); } } Q.length = 0; Q.push(...new Set(nx)); }
      for (let i = 0; i < cnt; i++) kx[i * 3 + 1] = 1 - THREE.MathUtils.smoothstep(dist[wid[i]], .004, .022);
    }
    g.setAttribute('kp', new THREE.BufferAttribute(kp, 3)); g.setAttribute('kn', new THREE.BufferAttribute(kn, 3)); g.setAttribute('kx', new THREE.BufferAttribute(kx, 3));
  }
  const GLSL_NOISE = `
float hcH(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float hcN(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
 return mix(mix(mix(hcH(i),hcH(i+vec3(1,0,0)),f.x),mix(hcH(i+vec3(0,1,0)),hcH(i+vec3(1,1,0)),f.x),f.y),mix(mix(hcH(i+vec3(0,0,1)),hcH(i+vec3(1,0,1)),f.x),mix(hcH(i+vec3(0,1,1)),hcH(i+vec3(1,1,1)),f.x),f.y),f.z);}
// stockinette: columns of V stitches; t across the columns, s along them (metres)
float hcKnit(float t,float s){float cw=.0062,rh=.0050;float x=fract(t/cw)-.5,y=fract(s/rh);float lx=abs(abs(x)-(.08+.30*y));return (1.-smoothstep(.05,.2,lx))*(.45+.55*sin(3.14159*y));}
float hcTwill(float t,float s){return .5+.5*sin(6.28318*(s+t)/.0024);}
`;
  function hook(mesh, cls) {
    attrs(mesh, cls);
    const m = mesh.material;
    m.onBeforeCompile = sh => {
      sh.uniforms.uVestOn = uVest;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 kp;attribute vec3 kn;attribute vec3 kx;varying vec3 vKp;varying vec3 vKn;varying vec3 vKx;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvKp=kp;vKn=kn;vKx=kx;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uVestOn;varying vec3 vKp;varying vec3 vKn;varying vec3 vKx;' + GLSL_NOISE + '\nfloat hcHgt=0.;float hcAmp=0.;float hcRough=-1.;')
        .replace('#include <map_fragment>', '#include <map_fragment>\n{' +
          `vec3 sc=pow(max(diffuseColor.rgb,vec3(0.)),vec3(1./2.2));float mx=max(sc.r,max(sc.g,sc.b)),mn=min(sc.r,min(sc.g,sc.b)),sat=mx>0.?(mx-mn)/mx:0.;
float fw=length(fwidth(vKp));vec3 an=abs(normalize(vKn));vec2 tw=an.xy/(an.x+an.y+1e-4);
float cls=vKx.x;` +
          (cls === 0 ? `
// sweater: mustard (red > green > blue, saturated, light); trousers: green over red
float knitM=smoothstep(.35,.5,sat)*step(sc.b,sc.g)*step(sc.g,sc.r)*smoothstep(.45,.6,sc.g/max(sc.r,.01))*smoothstep(.3,.42,mx);
float pantM=smoothstep(-.01,.04,sc.g-sc.r)*smoothstep(.05,.12,sc.g-sc.b);
float fk=1.-smoothstep(.0012,.0028,fw);
float hk=tw.y*hcKnit(vKp.x,vKp.z)+tw.x*hcKnit(vKp.y,vKp.z);
float fib=hcN(vKp*900.);
float ht=tw.y*hcTwill(vKp.x,vKp.z)+tw.x*hcTwill(vKp.y,vKp.z);float can=hcN(vKp*1500.);
float ft=1.-smoothstep(.0006,.0014,fw);
diffuseColor.rgb*=mix(1.,mix(.86,1.08,hk)*(.96+.08*fib),knitM*fk);
diffuseColor.rgb*=mix(1.,.93+.1*ht*can+.04,pantM*ft);
// trousers: worn knees, a paler dusty green broken by noise; and a soft mottle at every distance
float mot=hcN(vKp*35.);diffuseColor.rgb*=mix(1.,.9+.2*mot,pantM*.6);
vec3 kq=mat3(.8,.36,-.48,-.6,.48,-.64,0.,.8,.6)*vKp;float kw=vKx.y*clamp(.25+.6*hcN(kq*29.+1.7)+.35*hcN(kq*83.)-.2,0.,1.);float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));
diffuseColor.rgb=mix(diffuseColor.rgb,mix(vec3(lum),diffuseColor.rgb,.55)*1.45,pantM*kw*.75);
hcHgt=knitM*hk*.0007*fk+pantM*(ht*.6+can*.4)*.00025*ft;hcAmp=1.;
hcRough=mix(mix(-1.,.95,knitM),.9,pantM);
// under the vest (seen through notches in its collar and armhole edges): the vest's leather while it is on
float uvM=smoothstep(.5,1.,vKx.z)*uVestOn;if(uvM>0.){float pt=hcN(vKp*22.)*.55+hcN(vKp*70.+3.1)*.45;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.15,.074,.042)*(.8+.36*pt),uvM);hcHgt*=1.-uvM;hcRough=mix(hcRough,.78,uvM);}
// socks: grey-brown wool with the knit
float sockM=smoothstep(1.5,2.6,cls);if(sockM>0.){float hs=tw.y*hcKnit(vKp.x,vKp.z)+tw.x*hcKnit(vKp.y,vKp.z);vec3 sk=vec3(.16,.14,.12)*mix(.8,1.1,mix(.5,hs,fk))*(.9+.2*hcN(vKp*60.));
 diffuseColor.rgb=mix(diffuseColor.rgb,sk,sockM);hcHgt=mix(hcHgt,hs*.0006*fk,sockM);hcRough=mix(hcRough,.95,sockM);}` : cls === 1 ? `
// the vest mesh also carries the sweater's chest strip between its flaps (mustard texels): knit there, leather elsewhere
// (its texels are the same hue as the leather: the strip is told by place too, front centre of the torso)
float knitM=smoothstep(.45,.55,sat)*step(sc.b,sc.g)*step(sc.g,sc.r)*smoothstep(.58,.64,sc.g/max(sc.r,.01))*smoothstep(.6,.7,mx)*(1.-smoothstep(.035,.06,abs(vKp.x)))*step(0.,vKp.y);float lea=1.-knitM;
float fk=1.-smoothstep(.0012,.0028,fw);float hk=tw.y*hcKnit(vKp.x,vKp.z)+tw.x*hcKnit(vKp.y,vKp.z);
diffuseColor.rgb*=mix(1.,mix(.86,1.08,hk),knitM*fk);
// leather: a warmer, less red brown than the bake, darker, a mottled patina, pale rubbed edges and high points
vec3 c0=diffuseColor.rgb;/* bright sweater texels bled onto the vest's hem in the atlas (orange specks on its back hem): the vest's mean leather */c0=mix(c0,vec3(.38,.13,.048),smoothstep(.82,.92,mx)*smoothstep(.6,.66,sc.g/max(sc.r,.01))*lea);float lum=dot(c0,vec3(.3,.59,.11));vec3 lc=mix(vec3(lum),c0,.7)*vec3(1.,.97,1.)*.8;
float pat=hcN(vKp*22.)*.55+hcN(vKp*70.+3.1)*.45;lc*=.8+.36*pat;
float rub=clamp(vKx.y*(.75+.8*(hcN(vKp*120.)-.5))+smoothstep(.66,.82,pat)*.3,0.,1.);
lc=mix(lc,lc*vec3(1.7,1.6,1.45)+vec3(.012,.008,.004),rub*.85);
float fg=1.-smoothstep(.0008,.002,fw);float gr=hcN(vKp*1100.);float cr=pow(1.-abs(hcN(vKp*vec3(160.,90.,160.))*2.-1.),6.);
lc*=mix(1.,.94+.1*gr-.18*cr,fg);diffuseColor.rgb=mix(diffuseColor.rgb,lc,lea);
hcHgt=lea*(gr*.00012-cr*.00035)*fg+knitM*hk*.0007*fk;hcAmp=1.;hcRough=mix(mix(.78,.6,rub),.95,knitM);` : `
// boots: pull-up leather
float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));float pale=smoothstep(.55,.75,mx)*(1.-smoothstep(.55,.7,sat));diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.62,.48,.36),pale);diffuseColor.rgb=mix(vec3(dot(diffuseColor.rgb,vec3(.3,.59,.11))),diffuseColor.rgb,.85)*.9;
float pat=hcN(vKp*40.)*.6+hcN(vKp*120.)*.4;diffuseColor.rgb*=.86+.26*pat;
float sc2=max(vKx.y,0.)*smoothstep(.25,.65,hcN(vKp*180.)*.7+.3);diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.6,1.5,1.35),sc2*.8);
diffuseColor.rgb*=1.-max(-vKx.y,0.)*.5;
float fg=1.-smoothstep(.0008,.002,fw);float gr=hcN(vKp*1200.);float cr=pow(1.-abs(hcN(vKp*vec3(120.,260.,120.))*2.-1.),6.);
diffuseColor.rgb*=mix(1.,.95+.08*gr-.15*cr,fg);
hcHgt=(gr*.0001-cr*.0003)*fg;hcAmp=1.;hcRough=mix(.62,.5,sc2);`) + '}')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if(hcAmp>0.){vec3 dpx=dFdx(-vViewPosition),dpy=dFdy(-vViewPosition);float dhx=dFdx(hcHgt),dhy=dFdy(hcHgt);vec3 r1=cross(dpy,normal),r2=cross(normal,dpx);float det=dot(dpx,r1);
 vec3 grd=sign(det)*(dhx*r1+dhy*r2);normal=normalize(abs(det)*normal-grd);}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif(hcRough>0.)roughnessFactor=hcRough;');
    };
    m.customProgramCacheKey = () => 'heroCloth1-' + cls;
    m.needsUpdate = true;
  }
  hook(meshes.body, 0); hook(meshes.vest, 1); if (meshes.boots) hook(meshes.boots, 2); if (meshes.under) hook(meshes.under, 0);
  return { S, meshes: Object.keys(meshes), vestOn(on) { uVest.value = on ? 1 : 0; } };
}
