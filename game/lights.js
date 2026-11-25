// Interior light sources. Every warm light in the house comes from a real source: a lantern, the workshop
// dome lamp, the candle, the oven fire, the glowing door in the trunk. A source that is off emits nothing:
// no light, no emissive, no halo, no fog glow, no warm window. There is no warm "room fill" anywhere.
//
// Owned by the "interior light" work. index.html calls createLights() once (after props) and
// lights.update() every frame. Props owns the lamp/oven meshes (props.js), Environment owns halos/fog (env.js).
//
// API (window.__lights):
//   list()                 -> [{name, room, kind, on, level, auto}]
//   set(name, on)          -> switch a source by hand (stays manual until auto(name))
//   toggle(name)           -> flip it
//   auto(name?)            -> give a source (or all of them) back to the day/night + routine logic
//   get(name)              -> {name, room, kind, on, level, auto, pos}
//   pos(name)              -> world Vector3 of the source (where the hero reaches to switch it)
//   room(roomName)         -> 0..1, how lit a room is right now (kitchen, bedroom, workshop, outside)
//   onChange(cb)           -> cb(name, on) whenever a source is switched
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const _v = new THREE.Vector3();

// how a source wakes up and dies down (seconds), and how it flickers
// ?decklamp=1 (option for Pavel, not the default): an oil lantern on the lookout deck, lit by the hero when he goes out there in the dark
// ?embers=1 (an option for Pavel): when he goes to bed at night he banks the stove, and the coals glow low in the dark
// kitchen through the night, dying out by morning (~7 game hours). Off by default: the base game is unchanged.
const EMBERS = (() => { try { return new URLSearchParams(location.search).get('embers') === '1'; } catch (e) { return false; } })();
const DECKLAMP = (() => { try { return new URLSearchParams(location.search).get('decklamp') === '1'; } catch (e) { return false; } })();
const GLOW = (() => { try { return new URLSearchParams(location.search).get('glow') === '1'; } catch (e) { return false; } })();
const GLOW_K = { kitchen: 1.8, workshop: 1.15, oven: 1.3, bedroom: 1.1 }   // workshop was 1.6: since the room gains (photo-matched) it overshot the photo by 20%; kitchen and bedroom still land on it, GLOW_C = new THREE.Color(0xFFD9A0);
const KINDS = {
  oil:      { on: .7,  off: .5,  flick: 'flame' },   // oil lanterns: catch, flare, settle
  electric: { on: .12, off: .08, flick: 'bulb' },    // dome lamp: quick, a small stutter
  candle:   { on: 1.0, off: .35, flick: 'candle' },
  fire:     { on: 9,   off: 14,  flick: 'fire' },    // oven: the kindling catches, the fire spreads over the logs (~9 s); the embers die slowly
  door:     { on: 1.5, off: 1.5, flick: 'flame' },
  glow:     { on: .4,  off: .3,  flick: 'bulb' },     // a radio dial, an indicator: emissive only
};

export function createLights({ scene, ENV, P3, TREE, MOBILE, LV, windows = [] }) {
  const { KT, BD, WS, DK, LC, LG } = LV;
  const PL = (P3 && P3.lights) || {};
  const pm = (P3 && P3.materials) || {};
  const src = new Map();
  const listeners = [];
  let shadowBudget = MOBILE ? 0 : 2;     // point-light shadows (6 passes each, tiny frusta); the spot always has one

  function pointShadow(l, far) {
    if (shadowBudget <= 0) return;
    shadowBudget--;
    l.castShadow = true; l.shadow.camera.layers.enable(6); /* layer 6: the hero's shadow proxy */ l.shadow.mapSize.set(512, 512); l.shadow.camera.near = .06; l.shadow.camera.far = far;
    l.shadow.bias = -.004; l.shadow.normalBias = .03; l.shadow.radius = 3; l.shadow.autoUpdate = false;
  }

  // the lamp's own housing must not swallow its light; give each lantern its own pane material so panes glow per lamp
  function claimHousing(pos, r = .32) {
    const panes = [];
    const wp = V();
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.getWorldPosition(wp);
      if (wp.distanceTo(pos) > r) return;
      o.castShadow = false;
      if (pm.lampGlass && o.material === pm.lampGlass) {
        if (!panes.length) panes.push(pm.lampGlass.clone());
        const m = panes[0]; if (!m.userData.pane) { m.emissive = new THREE.Color(0xFFA852); m.emissiveIntensity = 0;
          // clear, not milky: by day the sky in Props' pale glass (35%, env x1.2) made the lantern a white box from the home view.
          // Out, the panes are thin, faintly grey-green and you see the burner through them; lit, the glass fills with light (update)
          m.color.set(0x8FA3A6); m.opacity = .16; m.envMapIntensity = .45; m.userData.pane = true; }
          o.material = m;
      }
    });
    return panes;
  }

  // a standing/wall lantern body (Props' lantern housing) at a point, for the lanterns Props doesn't place itself
  function housing(pos, rod = .02) { if (!P3 || !P3.lanternHousing) return null; const g = new THREE.Group(); g.position.copy(pos); scene.add(g); P3.lanternHousing(g, rod); g.updateMatrixWorld(true); return g; }

  // nothing floats: a lantern hangs on a chain from whatever is above it (ceiling, roof, floor of the room above);
  // if nothing is above, an iron bracket comes out of the nearest wall, post or trunk and the chain hangs from its tip
  const ironM = new THREE.MeshStandardMaterial({ color: 0x2C2F35, metalness: .7, roughness: .45 });
  // links: a 3-sided ring of 4 segments (24 tris) reads as a chain link at any distance the camera gets; the old 5x10 ring
  // was 100 tris x ~55 links = 5.5k tris for one chain (Optimization)
  const linkGeo = new THREE.TorusGeometry(.016, .0045, 3, 4);
  // one static mesh out of several (world-space) meshes of one material: the chain, its hook, a bracket = one draw
  const _m4 = new THREE.Matrix4();
  function bakeGeo(meshes, into = null) {
    const gs = meshes.map(m => { m.updateMatrixWorld(true); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
      if (into) g.applyMatrix4(_m4.copy(into.matrixWorld).invert()); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; });
    return mergeGeometries(gs, false);
  }
  // fold the chain/bracket mesh into the lantern body's iron mesh (Props' housing is already one mesh per material)
  function fuse(hg, extra) {
    if (!hg || !extra) return false; let body = null, n = -1;
    hg.traverse(o => { if (!o.isMesh || (o.material && o.material.emissive && o.material.emissive.getHex() !== 0) || (o.material && o.material.transparent)) return;
      const c = o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count; if (c > n) { n = c; body = o; } });
    if (!body) return false; hg.updateMatrixWorld(true);
    // Props draws the body with a shared vertex-coloured material (colour + roughness in alpha, metalness in 'vmet'):
    // the chain takes the body's first vertex values for every extra attribute, so it is the same iron
    const mine = body.geometry.index ? body.geometry.toNonIndexed() : body.geometry.clone();
    const add = bakeGeo([extra], body), cnt = add.attributes.position.count;
    for (const [k, a] of Object.entries(mine.attributes)) { if (add.attributes[k]) continue;
      const arr = new a.array.constructor(cnt * a.itemSize); for (let i = 0; i < cnt; i++) for (let j = 0; j < a.itemSize; j++) arr[i * a.itemSize + j] = a.array[j];
      add.setAttribute(k, new THREE.BufferAttribute(arr, a.itemSize, a.normalized)); }
    const g = mergeGeometries([mine, add], false); if (!g) return false;
    body.geometry = g; body.castShadow = false; extra.parent && extra.parent.remove(extra); extra.geometry.dispose(); return true;
  }
  const rc = new THREE.Raycaster();
  function solids() { const out = []; scene.traverse(o => { const m = o.material; if ((o.isMesh || o.isInstancedMesh) && o.visible && !o.isSprite && m && !Array.isArray(m) && !m.transparent && !(m.alphaTest > 0) && !m.isShaderMaterial && !o.userData.noHang) out.push(o); }); return out; }
  const postM = new THREE.MeshStandardMaterial({ color: 0x5E3B24, roughness: .85 });
  function chain(a, b) {      // links from a (bottom) to b (top)
    const L = a.distanceTo(b), n = Math.max(1, Math.round(L / .058));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = b.clone().sub(a).normalize(), base = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), up);
    const gs = [];
    for (let i = 0; i < n; i++) { q.copy(base).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (i % 2) * Math.PI / 2, Math.PI / 2))); m.compose(a.clone().lerp(b, (i + .5) / n), q, V(1, 1.75, 1)); gs.push(linkGeo.clone().applyMatrix4(m)); }
    const im = new THREE.Mesh(mergeGeometries(gs, false), ironM); im.userData.noHang = true; im.castShadow = false;
    scene.add(im); lastChain = im; return im;
  }
  let lastChain = null, lastHang = null;  // [WIND] what the last hang() built, so a lantern outside can swing in the wind
  function hang(pos, topOff = .23, wallOnly = false) {
    const top = pos.clone().add(V(0, topOff, 0)), list = solids();
    rc.set(top, V(0, 1, 0)); rc.far = 2.6; const up = wallOnly ? null : rc.intersectObjects(list, false)[0];
    if (up) { const ch = chain(top, up.point.clone().add(V(0, .02, 0))); const hook = new THREE.Mesh(new THREE.TorusGeometry(.025, .006, 4, 10), ironM); hook.position.copy(up.point).add(V(0, -.02, 0)); scene.add(hook);
      ch.geometry = bakeGeo([ch, hook]); ch.position.set(0, 0, 0); ch.quaternion.identity(); ch.scale.set(1, 1, 1); scene.remove(hook); lastHang = { top: up.point.clone(), chain: ch }; return 'chain'; }
    // bracket: find the nearest vertical surface around the lantern's top
    let best = null;
    for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, d = V(Math.cos(a), 0, Math.sin(a)); const o = top.clone().add(V(0, .25, 0)); rc.set(o, d); rc.far = 1.3; const h = rc.intersectObjects(list, false)[0]; if (h && (!best || h.distance < best.h.distance)) best = { h, d }; }
    let tip = top.clone().add(V(0, .25, 0)), wall;
    if (best) wall = best.h.point;
    else {
      // nothing around: a little wooden lamp post on the floor below, with the iron arm reaching over
      rc.set(pos, V(0, -1, 0)); rc.far = 4; const fl = rc.intersectObjects(list, false)[0]; if (!fl) return 'none';
      const toAxis = V((LV.TAX ? LV.TAX[0] : 0) - pos.x, 0, (LV.TAX ? LV.TAX[1] : 0) - pos.z).normalize();
      const base = V(pos.x + toAxis.x * .35, fl.point.y, pos.z + toAxis.z * .35), h = tip.y + .06 - base.y;
      const post = new THREE.Mesh(new THREE.BoxGeometry(.09, h, .09), postM); post.position.set(base.x, base.y + h / 2, base.z); post.castShadow = post.receiveShadow = true; post.userData.noHang = true; scene.add(post);
      wall = V(base.x, tip.y, base.z);
    }
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, wall.distanceTo(tip), 6), ironM);
    arm.position.copy(wall).lerp(tip, .5); arm.quaternion.setFromUnitVectors(V(0, 1, 0), tip.clone().sub(wall).normalize()); arm.userData.noHang = true; scene.add(arm);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(.03, .16, .08), ironM); plate.position.copy(wall); plate.lookAt(tip); plate.rotateY(Math.PI / 2); plate.userData.noHang = true; scene.add(plate);
    const brace = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, 1, 5), ironM); const b0 = wall.clone().add(V(0, -.16, 0)), b1 = wall.clone().lerp(tip, .6);
    brace.scale.y = b0.distanceTo(b1); brace.position.copy(b0).lerp(b1, .5); brace.quaternion.setFromUnitVectors(V(0, 1, 0), b1.clone().sub(b0).normalize()); brace.userData.noHang = true; scene.add(brace);
    chain(top, tip); lastHang = { top: tip.clone(), chain: lastChain }; return 'bracket';
  }

  // oil lanterns: no bulb. A small oil font with a burner collar on the lantern's floor and a little flame over the wick that
  // exists only while it burns (by day a cream sphere in the glass read as a plastic egg). The font joins the housing's
  // iron body draw when there is one. Returns the flame's material (opacity follows the lamp) and the meshes to carry along.
  const flameGeo = (() => { const pts = [[0, 0], [.008, .005], [.012, .016], [.0105, .027], [.006, .041], [0, .056]].map(([x, y]) => new THREE.Vector2(x, y)); return new THREE.LatheGeometry(pts, 8); })();
  const fontM = new THREE.MeshStandardMaterial({ color: 0x5A4A32, metalness: .55, roughness: .5 });
  function oilFlame(pos, hg) {
    const fg = new THREE.CylinderGeometry(.034, .04, .042, 10).translate(0, -.077, 0);
    const col = new THREE.CylinderGeometry(.011, .017, .016, 8).translate(0, -.048, 0);
    const wick = new THREE.CylinderGeometry(.0028, .0028, .012, 5).translate(0, -.035, 0);
    const font = new THREE.Mesh(bakeGeo([new THREE.Mesh(fg), new THREE.Mesh(col), new THREE.Mesh(wick)]), fontM); font.position.copy(pos); font.castShadow = false; scene.add(font); font.updateMatrixWorld(true);
    const keep = [];
    if (!(hg && fuse(hg, font))) keep.push(font); else scene.remove(font);
    // the flame's core is hotter than the screen's white (not tone-mapped, > 1): it stays the brightest thing in the lantern and
    // blooms, so the lit glass around it can't swallow it
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.75, .8), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const fl = new THREE.Mesh(flameGeo, m); fl.position.copy(pos).add(V(0, -.033, 0)); fl.visible = false; fl.castShadow = false; fl.renderOrder = 3; /* after the panes: clear glass barely dims a flame, the milky pane drawn over it did */ scene.add(fl); keep.push(fl);
    const extra = (k, f) => { fl.visible = k > .02; if (fl.visible) { const g = Math.min(1.35, k), a = 1.25 * (.85 + .15 * f) * (.25 + .75 * Math.min(1, g)); fl.scale.set(a, 1.3 * (.1 + .9 * g) * (.9 + .2 * f), a); } };   // grows from a bead on the wick as it catches, flares, settles
    return { m, keep, extra, fl };
  }
  function bulbMesh(pos, r, col = 0xFFE0A0) {
    const m = new THREE.MeshStandardMaterial({ color: col, emissive: 0xFFAE45, emissiveIntensity: 0, roughness: .4 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), m); b.position.copy(pos); scene.add(b); return m;
  }

  // a source: lights (with their full intensity), emissive materials (with full emissiveIntensity / opacity)
  function add(name, room, kind, pos, { lights = [], emis = [], opac = [], halo = null, haloSize = 1.5, haloTint = null, extra = null, autoFn }) {
    // ?glow=1 (critic L1, for Pavel to compare; not the default): the lit room closer to the photo's warmer, creamier glow.
    // Kitchen and workshop lamps (and the oven) ~1.6-1.8x and creamier, reaching further; the bedroom only a touch, it stays cosy and dim.
    const gk = GLOW && GLOW_K[name];
    if (gk) for (const L of lights) { L.I *= gk; L.l.color.lerp(GLOW_C, .35); if (L.l.isPointLight && name !== 'bedroom') { L.l.distance *= 1.25; L.l.decay *= .85; } }
    let haloObj = null;
    if (ENV && ENV.addHalo) {
      // halos follow .intensity; an emissive-only lantern gets a light-less proxy so it still glows in the fog
      haloObj = halo || (lights[0] && lights[0].l) || Object.assign(new THREE.Object3D(), { intensity: 0 });
      if (!haloObj.parent) { haloObj.position.copy(pos); scene.add(haloObj); }
      const spr = ENV.addHalo(haloObj, haloSize);
      if (haloTint && spr && spr.material) spr.material.color.set(haloTint);
    }
    const s = { idx: src.size, name, room, kind, pos: pos.clone(), lights, emis, opac, haloObj, extra, autoFn, on: false, level: 0, manual: null, seed: Math.random() * 9, flare: 0 };
    src.set(name, s); return s;
  }

  // ---------- kitchen: hanging lantern over the counter (the old front lantern hung in mid-air and was removed) ----------
  const kPos = PL.kitchenLamp ? PL.kitchenLamp.pos.clone() : V(-2.3, KT + 1.78, 1.75);
  {
    const l = new THREE.PointLight(0xFFC373, 0, MOBILE ? 6.5 : 5.5, MOBILE ? 1.25 : 1.6); l.position.copy(kPos); scene.add(l); pointShadow(l, 5.5);
    // on Props' wall bracket by the fridge the light sat 15 cm off the wall and burned it white beside the fridge while the stove
    // side (the photo's warmest corner) stayed dim: the light's centre a little out into the room, as the glass throws it
    if (PL.kitchenLamp) { const c = V(-2.65, kPos.y, 2.5).sub(kPos); c.y = 0; l.position.addScaledVector(c.normalize(), .3); }
    const panes = claimHousing(kPos);
    const fo = oilFlame(kPos, null);
    add('kitchen', 'kitchen', 'oil', kPos, { lights: [{ l, I: MOBILE ? 5.2 : 4.6 }], emis: panes.map(m => [m, .24]), opac: [[fo.m, 1]], extra: fo.extra, autoFn: c => c.lamps > .45 });
  }

  // ---------- workshop: dome lamp, a real downward cone with a soft shadow, plus a faint bounce off the bench ----------
  const wPos = PL.workshopLamp ? PL.workshopLamp.pos.clone() : V(3.75, WS + 1.5, 2.45);
  {
    const sp = new THREE.SpotLight(0xFFC27A, 0, 6, 1.05, .75, 1.5); sp.position.copy(wPos).add(V(0, -.04, 0));
    sp.target.position.copy(wPos).add(V(-.35, -2, -.25)); scene.add(sp, sp.target);
    sp.castShadow = true; sp.shadow.camera.layers.enable(6); /* layer 6: the hero's shadow proxy */ sp.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024); sp.shadow.camera.near = .08; sp.shadow.camera.far = 6;
    sp.shadow.bias = -.002; sp.shadow.normalBias = .03; sp.shadow.radius = 3; sp.shadow.autoUpdate = false;
    claimHousing(wPos, .3);
    // no power anywhere in the world (no wire, no generator), so this is a hanging kerosene lamp under the enamel shade, as
    // old workshops had: a brass font below the shade on its burner, a glass chimney rising into the shade, a flame in the
    // chimney. Lit, the shade's white inside catches the light (domeInner); out, it's just a lamp.
    const kf = new THREE.Group(); kf.position.copy(wPos); scene.add(kf);
    const brass = new THREE.MeshStandardMaterial({ color: 0x8A6A36, metalness: .7, roughness: .38 });
    const fontG = bakeGeo([new THREE.Mesh(new THREE.SphereGeometry(.052, 14, 8, 0, Math.PI * 2, Math.PI * .32, Math.PI * .68).scale(1, .62, 1).translate(0, -.085, 0)),
      new THREE.Mesh(new THREE.CylinderGeometry(.02, .03, .026, 12).translate(0, -.052, 0)),   // burner
      new THREE.Mesh(new THREE.CylinderGeometry(.03, .026, .008, 12).translate(0, -.037, 0)),  // chimney gallery
      new THREE.Mesh(new THREE.CylinderGeometry(.004, .004, .3, 5).translate(0, .08, 0))]);    // centre rod up to the shade's crown
    const fontMesh = new THREE.Mesh(fontG, brass); fontMesh.castShadow = false; kf.add(fontMesh);
    const chimM = new THREE.MeshStandardMaterial({ color: 0xF2EADB, transparent: true, opacity: .32, roughness: .1, emissive: 0xFFB060, emissiveIntensity: 0, depthWrite: false });
    const chim = new THREE.Mesh(new THREE.LatheGeometry([[.022, 0], [.024, .02], [.03, .045], [.019, .075], [.017, .11]].map(([x, y]) => new THREE.Vector2(x, y)), 14, 0, Math.PI * 2).translate(0, -.034, 0), chimM);
    chim.castShadow = false; kf.add(chim);
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.75, .8), transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const wfl = new THREE.Mesh(flameGeo, fm); wfl.position.y = -.032; wfl.scale.set(1.5, 1.1, .45 * 1.5); wfl.visible = false; wfl.renderOrder = 3; kf.add(wfl);   // a flat wick: a wide, thin flame
    const emis = [[chimM, .5]]; if (pm.domeInner) { pm.domeInner.emissive = new THREE.Color(0xFFD9A0); emis.push([pm.domeInner, .9]); }
    // bounce: the bench and floor under the cone throw warm light back over the whole room (the photo's workshop is warm
    // wall to wall; ours was a bright corner under the dome and a dark left half). Unshadowed, phones take it from the pool.
    const wb = new THREE.PointLight(0xFFB066, 0, 3.4, 2); wb.position.copy(wPos).add(V(-1.0, -.7, .15)); scene.add(wb);
    // phones: light bounced off the bench and floor travels UP (walls, pegboard, the hero's body and face), so its pool cone
    // looks up and stops at the ceiling; a down cone lit only the floor under the bench and left him and the walls dark
    wb.userData.poolUp = WS + 3.3;
    add('workshop', 'workshop', 'oil', wPos, { lights: [{ l: sp, I: 11.5 }, { l: wb, I: MOBILE ? 2.9 : 2.6 }], emis, opac: [[fm, 1]], extra: k => { wfl.visible = k > .02; const g = Math.min(1.35, k); wfl.scale.set(1.5 * (.3 + .7 * Math.min(1, g)), 1.1 * (.1 + .9 * g), .67 * (.3 + .7 * Math.min(1, g))); }, halo: sp, haloSize: 1.3, autoFn: c => c.lamps > .55 });
  }

  // ---------- bedroom: wall lantern + the candle on the reading table ----------
  // photo: a wall lamp high on the back wall above the bunk, by the ladder end. Its light falls forward and down, so the
  // upper bunk lies in the light and the lower one sits in the upper's shadow, with the floor in front lit.
  // (The hero switches it at Props' wall switch, so it can hang out of his reach.)
  // Props may hang it on a hook he can reach (P3.lights.bedroomLamp = { pos, hook?, own? }): then it hangs there. own: Props built the
  // housing itself (as the kitchen's), so no housing/chain here.
  const BL = PL.bedroomLamp || null;
  const bPos = BL ? BL.pos.clone() : V(-1.0, BD + 2.55, 1.6);   // on the back wall just past the ladder end of the bunk (photo)
  {
    // Pavel: cosy, not bright. A warm, muted lantern whose main light is a shadowed cone falling down and back onto the
    // bunk, so the upper bunk throws its shadow over the lower one (one 512/1024 spot map, redrawn only while the hero
    // is in the room); a weak unshadowed fill keeps the corners and the walls above the cone from going black.
    const l = new THREE.PointLight(0xFFB866, 0, MOBILE ? 5.5 : 5, MOBILE ? 1.4 : 1.6); l.position.copy(bPos); scene.add(l);
    if (BL) { const c = V(-1.9, bPos.y, 2.3).sub(bPos); c.y = 0; l.position.addScaledVector(c.normalize(), .35); }   // on the door-side hook: the fill a step into the room (the wall by the door burned white, the bunk sat dim; photo: the bunk is the lit heart of the room)
    // a narrower cone keeps the 512 map sharp enough (no self-shadowing)
    const bs = new THREE.SpotLight(0xFFB866, 0, 6, .95, .8, 1.4); bs.position.copy(bPos).add(BL ? V(0, -.03, 0) : V(0, -.15, .06));   /* on Props' hook (BL): from the flame itself */   // just under the lantern's base plate (it would shade the whole cone)
    if (BL) bs.target.position.set(-2.0, BD + .75, 2.05); else bs.target.position.set(-2.1, BD + .6, 2.2); scene.add(bs, bs.target);
    bs.castShadow = true; bs.shadow.camera.layers.enable(6); /* layer 6: the hero's shadow proxy */ bs.shadow.mapSize.set(MOBILE ? 512 : 1024, MOBILE ? 512 : 1024); bs.shadow.camera.near = .1; bs.shadow.camera.far = 5;
    bs.shadow.bias = -.008; bs.shadow.normalBias = .1; bs.shadow.radius = 4; bs.shadow.autoUpdate = false;
    // bounce: the cone's light comes back off the rug and the boards in front of the bunk (the photo has that floor lit, ours
    // sat in the upper bunk's shadow). Low, short and unshadowed, so it lifts only the floor strip and the bunk's foot.
    const bb = new THREE.PointLight(0xFFAE62, 0, 2.2, 2); bb.position.set(-2.0, BD + .4, 2.85); if (!MOBILE) scene.add(bb);   // phones: the room bounce (pooled) lights this floor strip; a 5th pooled light here pushed the landing lantern out of the pool
    const hg = BL && BL.own ? null : housing(bPos); lastHang = null; if (!(BL && BL.own)) hang(bPos, .23, !BL); const panes = claimHousing(bPos);
    if (lastHang && lastHang.chain && fuse(hg, lastHang.chain)) lastHang.chain = null;   // chain + hook + body: one draw
    const fo = oilFlame(bPos, hg);
    add('bedroom', 'bedroom', 'oil', bPos, { lights: [{ l: bs, I: MOBILE ? 9 : 8 }, { l, I: MOBILE ? 1.3 : 1.7 }, ...(MOBILE ? [] : [{ l: bb, I: 1.25 }])], emis: panes.map(m => [m, .24]), opac: [[fo.m, 1]], extra: fo.extra,
      autoFn: c => c.lamps > .4 && !(c.task === 'sleep' && c.asleep) });
  }
  if (PL.candle) {
    const cPos = PL.candle.pos.clone();
    let lights = [];
    // the light sits a little above the flame: a point light 6 cm from the wax burned the candle and its holder to white,
    // which no candle does (the wax glows softly through instead, below)
    if (!MOBILE) { const l = new THREE.PointLight(0xFF9C45, 0, 2.6, 2); l.position.copy(cPos).add(V(0, .09, 0)); scene.add(l); lights = [{ l, I: 1.3, sway: .012 }]; }
    // a real candle: a black wick standing out of a little pool of melted wax, a flame with a hot near-white core (drawn after
    // the glass and not tone-mapped, like the lanterns'), and wax, not cloth, that the flame lights from inside near the top
    const fmC = PL.candle.mats[0] || pm.candleFlame, cObj = PL.candle.obj, cEmis = [];
    if (fmC) { fmC.blending = THREE.NormalBlending; fmC.color.setRGB(2.3, 1.45, .62); fmC.toneMapped = false; fmC.needsUpdate = true; }
    if (cObj) {
      let flameMesh = null, waxMesh = null;
      cObj.traverse(o => { if (!o.isMesh) return; if (o.material === fmC) { flameMesh = o; return; } o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox;
        if (bb.max.x - bb.min.x < .045 && bb.max.y - bb.min.y > .07) waxMesh = o; });
      if (flameMesh) { flameMesh.renderOrder = 3; flameMesh.scale.set(.9, 1.05, .9); flameMesh.position.y += .005; }   // lifted off the wax: the wick shows black in the flame's foot
      if (waxMesh) { const wm = new THREE.MeshStandardMaterial({ color: 0xEDE2CC, roughness: .42, emissive: 0xFFB25E, emissiveIntensity: 0 }); waxMesh.material = wm; cEmis.push([wm, .22]); }
      const top = waxMesh ? (waxMesh.geometry.boundingBox.max.y + waxMesh.position.y) : .105;
      const wick = new THREE.Mesh(new THREE.CylinderGeometry(.0013, .0016, .016, 5).translate(0, .008, 0), new THREE.MeshStandardMaterial({ color: 0x161210, roughness: .9 }));
      wick.position.set(0, top - .001, 0); wick.rotation.z = .12; wick.castShadow = false; cObj.add(wick);
      const pool = new THREE.Mesh(new THREE.CircleGeometry(.014, 14).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xF6EBD4, roughness: .15, emissive: 0xFFB25E, emissiveIntensity: 0 }));
      pool.position.set(0, top + .0006, 0); pool.castShadow = false; cObj.add(pool); cEmis.push([pool.material, .55]);
    }
    add('candle', 'bedroom', 'candle', cPos, { lights, emis: cEmis, opac: [[fmC, .95]], haloSize: .45,
      // lit when he reads in the dark; only the hero puts it out (lights.set('candle', false) at lights.pos('candle'))
      autoFn: () => false });
  }

  // ---------- outside: lantern by the ladder landing (the deck lantern was removed: it read as a lantern on the bedroom roof) ----------
  {
    // it hangs below the kitchen floor: a downward cone (no light upward), so it lights the landing and the ladders but
    // can't shine up through the boards into the kitchen and make it look lit (no shadow map on this one)
    const p = V(-.62, LC + 1.25, 3.84); const l = new THREE.SpotLight(0xFFC373, 0, 5.5, 1.1, .7, 1.6); l.position.copy(p);
    l.target.position.copy(p).add(V(0, -3, .2)); scene.add(l, l.target);
    const hg = housing(p); lastHang = null; hang(p); const panes = claimHousing(p);
    if (lastHang && lastHang.chain && fuse(hg, lastHang.chain)) lastHang.chain = null;
    const fo = oilFlame(p, hg);
    add('landing', 'outside', 'oil', p, { lights: [{ l, I: 5 }], emis: panes.map(m => [m, .24]), opac: [[fo.m, 1]], extra: fo.extra, haloSize: 1.15, autoFn: c => c.lamps > .6 });   // a smaller fog halo: the flame inside stays readable
    // [WIND] the whole lantern (body, bulb, light, chain) hangs from one pivot at the chain's top: game/housewind.js swings it
    if (lastHang) { const piv = new THREE.Group(); piv.position.copy(lastHang.top); scene.add(piv); piv.updateMatrixWorld(true);
      for (const o of [hg, lastHang.chain, ...fo.keep, l, l.target]) if (o) piv.attach(o);
      (window.__swing = window.__swing || []).push({ name: 'landing lantern', piv, len: lastHang.top.y - p.y + .1, mass: 1 }); }
  }

  // ---------- ?decklamp=1: an oil lantern on the lookout deck (the photo's deck boards and rail read warm-lit) ----------
  // Hangs on an iron arm off the front-right rail post, just outside the rail (so it lights the rail and the deck's
  // front as the camera sees them), by the telescope. Manual only: the hero lights it when he goes out on the
  // deck in the dark and puts it out when he leaves (brain.js); it never goes out by itself. A downward cone like the
  // landing lantern: it lights the boards, the rail and the telescope, not up into the leaves.
  if (DECKLAMP) {
    const p = V(3.95, DK + 1.15, 3.32); const l = new THREE.SpotLight(0xFFBA66, 0, 5.2, 1.2, .75, 1.5); l.position.copy(p);
    l.target.position.copy(p).add(V(-.8, -3, -.9)); scene.add(l, l.target);
    const hg = housing(p); lastHang = null; hang(p); const panes = claimHousing(p);
    if (lastHang && lastHang.chain && fuse(hg, lastHang.chain)) lastHang.chain = null;
    const fo = oilFlame(p, hg);
    add('decklamp', 'outside', 'oil', p, { lights: [{ l, I: 7 }], emis: panes.map(m => [m, .24]), opac: [[fo.m, 1]], extra: fo.extra, autoFn: () => false });
    if (lastHang) { const piv = new THREE.Group(); piv.position.copy(lastHang.top); scene.add(piv); piv.updateMatrixWorld(true);
      for (const o of [hg, lastHang.chain, ...fo.keep, l, l.target]) if (o) piv.attach(o);
      (window.__swing = window.__swing || []).push({ name: 'deck lantern', piv, len: lastHang.top.y - p.y + .1, mass: 1 }); }
  }

  // ---------- oven fire (Props draws the fire; we own whether it burns) ----------
  if (PL.oven || (P3 && P3.oven)) {
    const p = PL.oven ? PL.oven.pos.clone() : V(-3.25, KT + .3, 1.45);
    // a half-space cone out of the firebox, tilted down: it lights the kitchen and the cook in front of the stove, but
    // not up through the ceiling boards into the bedroom (no shadow map on this one)
    const l = new THREE.SpotLight(0xFF7A2A, 0, 4.2, Math.PI / 2 * .97, .35, 1.8); l.position.copy(p).add(V(.05, .1, .55));
    l.target.position.copy(l.position).add(V(0, -.55, 1)); scene.add(l, l.target);
    const aim = l.target.position.clone();
    // door open: the firelight falls out over the open door onto the floorboards. The door (hinged at the bottom,
    // lying almost flat when open) shades the boards right in front, so the warm patch starts past its edge and
    // widens away from the stove. An additive decal on the floor: no extra light, works the same on phones.
    let patch = null;
    const door = P3 && P3.oven && P3.oven.door;
    if (door && door.parent) {
      door.parent.updateMatrixWorld(true);
      const fwd = V(0, 0, 1).applyQuaternion(door.parent.getWorldQuaternion(new THREE.Quaternion())); fwd.y = 0; fwd.normalize();
      const d0 = door.getWorldPosition(V());
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uK: { value: 0 }, uC: { value: new THREE.Color(0xFF7A2A) } },
        vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
        // u across, v away from the stove: a soft trapezoid, bright near the door edge, fading out by ~1.3 m
        fragmentShader: 'uniform float uK; uniform vec3 uC; varying vec2 vU; void main(){ float w = .32 + .68 * vU.y; float x = abs(vU.x - .5) * 2. / w;' +
          ' float a = smoothstep(1., .55, x) * smoothstep(0., .12, vU.y) * pow(1. - vU.y, 1.6); gl_FragColor = vec4(uC * a * uK, 1.); }' });
      patch = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.25).rotateX(-Math.PI / 2), mat);   // uv v runs along -z ...
      patch.rotation.y = Math.atan2(fwd.x, fwd.z) + Math.PI;                                         // ... which now points away from the stove
      patch.position.copy(d0).addScaledVector(fwd, .42 + .62).setY(KT + .028);   // above the kitchen rug (it lies over the boards here)
      patch.name = 'ovenFloorGlow'; patch.renderOrder = 2; patch.visible = false; patch.userData.noHang = true; scene.add(patch);
    }
    // lighting it: a pine splinter (kindling) laid across the left log catches first and burns down from its tip while the
    // flames spread from it across the logs one by one (Props' flame shader: uSpread), and the light grows with the fire;
    // going out, the flames drop out in reverse until only the coals breathe, then cool
    const OV = P3 && P3.oven; let spl = null, splM = null, splF = null, splDir = null;
    if (OV && OV.fireGroup && OV.fireGroup.parent) {
      splM = new THREE.MeshStandardMaterial({ color: 0xC9A570, roughness: .9, emissive: 0xFF6A1E, emissiveIntensity: 0 });
      spl = new THREE.Mesh(new THREE.BoxGeometry(.2, .007, .012).translate(.1, 0, 0), splM);   // origin at the held (unburnt) end: it burns down toward it
      spl.position.copy(OV.fireGroup.position).add(V(.08, .07, .035)); spl.rotation.set(0, Math.PI + .2, -.22);   // laid over the logs from the right, the tip down among the left flames, where the fire starts
      spl.castShadow = false; spl.visible = false; OV.fireGroup.parent.add(spl);
      // its burning tip: a small flame where the wood is being eaten (the stick itself only chars)
      splF = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.4, .55), transparent: true, depthWrite: false, toneMapped: false }));
      splF.renderOrder = 3; splF.castShadow = false; splF.visible = false; OV.fireGroup.parent.add(splF);
      splDir = V(1, 0, 0).applyEuler(spl.rotation);
    }
    // a bed of real coals under the logs (critic E14: the embers were a flat orange pane): 18 irregular lumps, each with a
    // hot glowing underside and grey ash on its top, so the bed has depth and texture behind the glass. One mesh, vertex
    // colours (unlit, scaled by the heat): one draw, no light.
    let coals = null;
    if (OV && OV.fireGroup && OV.fireGroup.parent) {
      const gs = []; let sd = 7; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
      for (let i = 0; i < 34; i++) {
        const r = .01 + rnd() * .013; const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1 + rnd() * .5, .55 + rnd() * .3, 1 + rnd() * .4); g.rotateY(rnd() * 6.28);
        const a = rnd() * 6.28, d = Math.sqrt(rnd()); g.translate(Math.cos(a) * d * .15, -.004 + rnd() * .014, Math.sin(a) * d * .055 + .03);   // heaped round and in front of the logs, so they show over the door's window sill
        const pos = g.attributes.position, col = new Float32Array(pos.count * 3), cy = -.004, heat = .55 + rnd() * .45;
        for (let v = 0; v < pos.count; v++) { const up = THREE.MathUtils.clamp((pos.getY(v) - cy) / .022, 0, 1);   // top: ash; underside and edges: glowing
          const ash = up > .55 && ((v * 7 + i * 3) % 5) < 2 ? 1 : 0, glow = (1 - ash * .9) * (1 - up * .35) * heat; /* glowing all over, with grey ash flecks on the tops */ col[v * 3] = .16 * ash + 1.0 * glow; col[v * 3 + 1] = .15 * ash + .3 * glow * glow; col[v * 3 + 2] = .14 * ash + .05 * glow * glow * glow; }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); gs.push(g.index ? g.toNonIndexed() : g);
      }
      coals = new THREE.Mesh(mergeGeometries(gs, false), new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      coals.position.copy(OV.fireGroup.position); coals.castShadow = false; coals.visible = false; OV.fireGroup.parent.add(coals);
    }
    const s0Oven = () => ovenS && !ovenS.on;
    let ovenS = null;
    ovenS = add('oven', 'kitchen', 'fire', p, { lights: [{ l, I: 4.2, sway: .03 }], haloSize: .9, extra: (k, f) => {
      if (ovenS && OV) { const L = ovenS.level, up = ovenS.on;
        if (OV.setSpread) OV.setSpread(up ? smooth(.04, .7, L) : smooth(.22, .72, L));
        if (spl) { const burn = up ? smooth(.02, .5, L) : 1; spl.visible = up && burn < .98;
          splF.visible = spl.visible;
          if (spl.visible) { spl.scale.x = 1 - burn * .85; splM.emissiveIntensity = .12 * smooth(0, .05, L);
            const fk = smooth(0, .04, L) * (1 - smooth(.35, .5, L)) * (.85 + .3 * noise(t * 8));
            splF.position.copy(spl.position).addScaledVector(splDir, .2 * spl.scale.x - .004); splF.scale.set(.9 * fk, 1.1 * fk, .9 * fk); } } }
      // index.html passes this level to props.update(), which calls oven.setHeat once per frame
      const open = P3.oven ? P3.oven.open || 0 : 0; l.userData.open = open;
      // embers: as the fire dies the bed of coals keeps breathing (slow, uneven), until it is cold
      const emb = (ovenS && ovenS.on ? 0 : 1) * smooth(0, .25, k) * (1 - smooth(.3, .7, k)) * (.55 + .45 * noise(t * .5 + 3) * noise(t * 1.3 + 9));   // only while it dies: lighting, there are no coals yet
      if (pm.fire) pm.fire.emissiveIntensity = .5 * k * (f || 1) + .12 * emb;   // the ash bed: dull; the coals heaped on it carry the glow
      if (pm.ovenGlass) pm.ovenGlass.emissiveIntensity = .12 * k * (f || 1) + .04 * emb;   // dark glass: what glows is behind it (critic E14)
      if (coals) { const hot = Math.max(emb, EMBERS && s0Oven() ? emberK * .9 : 0, (ovenS ? Math.pow(ovenS.level, 1.5) : k) * .85);
        coals.visible = hot > .02; if (coals.visible) coals.material.color.setScalar((.3 + 3.2 * hot) * (.8 + .35 * noise(t * .7 + 11) * noise(t * 2.1 + 4))); }
      // firelight on the walls: with the door open the flames throw a restless light, so the lit patch drifts a few
      // centimetres on the boards (target wobble); shut, it only breathes with the fire
      const wob = .04 + .1 * open;
      l.target.position.set(aim.x + (noise(t * 2.3 + 1) - .5) * wob, aim.y + (noise(t * 3.1 + 5) - .5) * wob * .5, aim.z + (noise(t * 1.9 + 7) - .5) * wob);
      if (patch) { const v = open * k * (f || 1) * (.85 + .3 * (noise(t * 7 + 2) - .5)); patch.visible = v > .01; patch.material.uniforms.uK.value = .55 * v; }
    }, autoFn: c => c.cookT > 0 });
  }

  // ---------- the hero's hand lantern (Character attaches it to a hand bone when he goes out at night) ----------
  const hand = { g: new THREE.Group(), attached: null, swing: 0, prev: V() };
  {
    const g = hand.g; g.visible = false; scene.add(g);
    if (P3 && P3.lanternHousing) { const hh = new THREE.Group(); hand.housing = hh; hh.scale.setScalar(.62); hh.position.y = -.17; P3.lanternHousing(hh, .02); g.add(hh); hh.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
    const bm = new THREE.MeshStandardMaterial({ color: 0xFFE0A0, emissive: 0xFFAE45, emissiveIntensity: 0, roughness: .4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.035, 10, 8), bm); bulb.position.y = -.17; g.add(bulb);
    // a carried oil lantern lights a pool of ground ~3 m round him and the fog around it (the halo, and Environment's fog
    // puffs pick up the lowest lit halos). Indoors it is dimmer so it doesn't fight the room lamps.
    const l = new THREE.PointLight(0xFFB458, 0, 4.2, 1.5); l.position.y = -.17; g.add(l);   // short reach: no shadow map, so it must not climb through the floors above
    hand.bulbPos = bulb; hand.light = l; hand.bulb = bulb;
    const s0 = add('hand', 'outside', 'oil', V(), { lights: [{ l, I: 3.4 }], emis: [[bm, 5]], haloSize: 1.5, autoFn: () => false });
    hand.L = s0.lights[0];
    // his own shadow from the lantern (no shadow map for it on any device): one soft dark decal on the ground from his
    // feet away from the lantern, darkest at the feet. One draw call, a small quad, only while he carries it lit outside.
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 32; const x = cv.getContext('2d'), im = x.createImageData(128, 32);
    for (let j = 0; j < 32; j++) for (let i = 0; i < 128; i++) {
      const u = i / 127, w = (j - 15.5) / 15.5, wid = .45 + .55 * u;          // widens away from the feet
      const a = Math.pow(1 - u, 1.4) * Math.exp(-(w * w) / (wid * wid) * 2.2) * Math.min(1, u * 9 + .35);
      im.data[(j * 128 + i) * 4 + 3] = Math.round(255 * a);
    }
    x.putImageData(im, 0, 0); const tex = new THREE.CanvasTexture(cv);
    const geo = new THREE.PlaneGeometry(1.7, .8); geo.rotateX(-Math.PI / 2); geo.translate(.85 - .12, 0, 0);
    const sm = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    hand.shadow = new THREE.Mesh(geo, sm); hand.shadow.renderOrder = 2; hand.shadow.visible = false; hand.shadow.userData.noHang = true; scene.add(hand.shadow);
  }
  function updateHand(dt) {
    const g = hand.g, hs = src.get('hand');
    if (!hand.attached) { if (hs && hs.manual) hs.manual = null; return; }     // nothing to light while nobody carries it
    hand.bulbPos.getWorldPosition(hs.pos);
    // outdoors (below the house floors or out on the open ground) the lantern is the only light around: full strength,
    // enough for a warm pool on the dark grass and roots through the blue ground fog (at 4.2 the fog swallowed it)
    const outdoors = hs.pos.y < (LV.LC || 4.4) - .3 || hs.pos.z > 4.7; hand.outdoors = outdoors;
    hand.L.I += ((outdoors ? 7.5 : 1.6) - hand.L.I) * Math.min(1, dt * 2);
    { const sh = hand.shadow, r = window.__dbg && window.__dbg.hero && window.__dbg.hero.root, k = outdoors ? hs.level : 0;
      sh.visible = !!r && k > .02;
      // only on something: the ground (or a root) right under his soles, or boards (collide grid). On a ladder it hides.
      let fy = null;
      if (sh.visible) { const G = window.__ground, C = window.__collide, p = r.position;
        const gy = G && G.standAt ? G.standAt(p.x, p.z) : null;
        if (gy != null && Math.abs(p.y - gy) < .2) fy = gy;
        else if (C && C.depthAt && C.depthAt(p.x, p.y - .05, p.z) > .005) fy = p.y;
        if (fy == null) sh.visible = false; }
      if (sh.visible) { const dx = r.position.x - hs.pos.x, dz = r.position.z - hs.pos.z, d = Math.hypot(dx, dz) || 1;
        sh.position.set(r.position.x, fy + .025, r.position.z); sh.rotation.y = Math.atan2(-dz, dx);
        // a lantern held out to the side throws a long shadow; one held close in front a short one under him
        sh.scale.set(.75 + Math.min(1, d / .45) * .55, 1, 1); sh.material.opacity = .62 * k; } }
    if (hand.fixed) { hand.g.quaternion.identity(); return; }
    // hangs from the fingers, stays upright and swings a little with the walk
    const pq = hand.attached.getWorldQuaternion(new THREE.Quaternion()).invert();
    const wp = hand.attached.getWorldPosition(V()); const v = wp.clone().sub(hand.prev).divideScalar(Math.max(dt, 1e-3)); hand.prev.copy(wp);
    hand.swing += (Math.max(-.35, Math.min(.35, v.x * .12)) - hand.swing) * Math.min(1, dt * 4);
    g.quaternion.copy(pq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.max(-.35, Math.min(.35, -v.z * .12)), 0, -hand.swing)));
  }

  // ---------- the floor hatch between the kitchen and the bedroom ----------
  // Open with the bedroom lit and the kitchen dark: warm light falls down the ladder (and the other way round, a lit
  // kitchen glows up into a dark bedroom). A soft additive shaft through the opening; on desktop also a shadowless
  // spot that lays the square of light on the ladder and the kitchen floor. Phones: the shaft only.
  const hatchFx = (() => {
    const x0 = -4.28, x1 = -3.68, z0 = 2.32, z1 = 3.25, y = LV.BD + .03, depth = LV.BD - LV.KT;
    const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const u = { k: { value: 0 }, up: { value: 0 }, col: { value: new THREE.Color(0xFFC274) } };
    const geo = new THREE.BoxGeometry(W, depth, D, 1, 1, 1); geo.translate(0, -depth / 2, 0);
    const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: 'varying float vY;varying vec2 vXZ;void main(){vY=position.y;vXZ=position.xz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform float k,up;uniform vec3 col;varying float vY;varying vec2 vXZ;void main(){float t=clamp(-vY/${depth.toFixed(2)},0.,1.);
        float a=mix(1.-t,t,up);a=a*a*(.35+.65*smoothstep(0.,.15,t))*smoothstep(1.,.85,t);
        vec2 e=vec2(${(W / 2).toFixed(3)},${(D / 2).toFixed(3)})-abs(vXZ);float edge=smoothstep(0.,.08,min(e.x,e.y));
        gl_FragColor=vec4(col*a*k*(.55+.45*edge),1.);}` });
    const m = new THREE.Mesh(geo, mat); m.position.set(cx, y, cz); m.renderOrder = 3; m.frustumCulled = false; m.visible = false; scene.add(m);
    let spot = null;
    if (!MOBILE) { spot = new THREE.SpotLight(0xFFC274, 0, depth + 1.2, .3, .8, 1.4); spot.position.set(cx, y + .25, cz); spot.target.position.set(cx, LV.KT, cz + .15); scene.add(spot, spot.target); }
    return { m, u, spot, y };
  })();
  function updateHatch(dayK) {
    const h = window.__house && window.__house.hatch; let open = 0;
    if (h) open = Math.max(0, Math.min(1, (h.angle ?? (h.isOpen() ? 1.95 : 0)) / 1.95));
    const bed = Math.min(1, warm.bedroom || 0), kit = Math.min(1, warm.kitchen || 0);
    const down = Math.max(0, bed - kit * .6), upK = Math.max(0, kit - bed * .6);
    const k = open * Math.max(down, upK) * (1 - dayK * .85);
    hatchFx.u.k.value = k * .5; hatchFx.u.up.value = upK > down ? 1 : 0; hatchFx.m.visible = k > .01;
    if (hatchFx.spot) hatchFx.spot.intensity = open * down * 2.2 * (1 - dayK * .8);
  }

  // ---------- the glowing door in the trunk ----------
  let doorLight = null, doorCave = null;
  if (TREE && TREE.doorAngle !== undefined && TREE.R) {
    const dd = V(Math.cos(TREE.doorAngle), 0, Math.sin(TREE.doorAngle));
    const ax = LV.TAX; const r = TREE.R(LG + .7) - .3;
    doorLight = new THREE.Object3D(); doorLight.position.set(ax[0] + dd.x * r, LG + .75, ax[1] + dd.z * r);
    // the lantern-lit cave inside the hollow: a warm light deep in it lights the carved walls, the one at the mouth spills onto the platform
    const rIn = TREE.R(LG + .7) - 1.0;
    const cave = new THREE.PointLight(0xFF8A36, 0, 3.6, 1.3); cave.position.set(ax[0] + dd.x * rIn, LG + .85, ax[1] + dd.z * rIn); scene.add(cave); doorCave = cave;
    doorLight.position.set(ax[0] + dd.x * (r + .25), LG + .8, ax[1] + dd.z * (r + .25));
    const glow = TREE.bark && TREE.bark.material.userData.doorGlow;
    // the warm wedge that falls out of the doorway onto the landing, the roots and the path below it
    const spill = new THREE.SpotLight(0xFFA04C, 0, 9, .75, 1, 1.4);
    spill.position.set(ax[0] + dd.x * (r - .2), LG + 1.25, ax[1] + dd.z * (r - .2));
    spill.target.position.set(ax[0] + dd.x * (r + 2.6), 0, ax[1] + dd.z * (r + 2.6)); scene.add(spill, spill.target);
    /* phones: the doorway's warm wedge on the doorstep is the brightest warm spot at the foot of the photo and always in the
       home view; scored on the hero's distance alone it lost its pool slot whenever he was up in the house (doorstep 82 vs
       the photo's 118). It counts x3 in the slot race (only while lit, and a lantern by the hero still wins its slot back) */
    spill.userData.poolPri = 3;
    add('door', 'outside', 'door', doorLight.position, { lights: [{ l: cave, I: 5.5, sway: .02 }, { l: spill, I: 13 }], haloSize: 2.0, haloTint: 0xFF9E52,
      // the photo's brightest warm spot at the foot of the tree (door moved down into view, ab2ddf4): a hotter hollow and spill
      extra: (k, f) => { if (glow) glow.value = 4.6 * k * f; }, autoFn: c => c.lamps > .3 });
  }

  // ---------- windows: warm only while their room is lit; otherwise a faint cold sky reflection ----------
  const PANE_DAY = new THREE.Color(0x9CC4E0), PANE_NIGHT = new THREE.Color(0x1C2A3E), SKY_DAY = new THREE.Color(0x5E8CC0), SKY_NIGHT = new THREE.Color(0x24406A);
  for (const w of windows) { w.mat.emissive = w.mat.emissive.clone(); }

  // ---------- room glow, driven only by the room's own sources ----------
  // A lit room is warm all over (walls, ceiling, corners), not just a hotspot by the lamp: a soft unshadowed
  // bounce light in the middle of the room stands in for the light the warm planks throw back.
  // Light also leaves through the back windows onto the trunk (desktop: a small spill light; phones: halo only).
  const ROOMS = {
    kitchen:  { c: V(-2.85, KT + 1.05, 2.5), bounce: 2.0 },   // toward the stove: the lamp now hangs by the fridge
    bedroom:  { c: V(-2.2, BD + 1.1, 2.3), bounce: .9 },   // centred on the bunk side: the lamp now hangs by the door   // cosy: little bounce, the corners stay dusky
    workshop: { c: V(2.75, WS + 1.1, 2.9), bounce: 2.6 },
  };
  const glows = [];
  // the camera, captured as the scene renders: a window's outside halo must not shine into the room through the glass
  let cam = null, rdr = null;
  { const prev = scene.onBeforeRender; scene.onBeforeRender = function (r, sc, c, ...a) { cam = c; rdr = r; if (prev) prev.call(this, r, sc, c, ...a); }; }
  for (const [room, R] of Object.entries(ROOMS)) {
    // bounce = light thrown back by the lit walls: no falloff inside the room (decay 0, soft cut at the walls), so it
    // never makes a hot spot on whatever stands next to it (the upper bunk sat 10 cm from the old one and burned white)
    // Phones too (it joins the light pool): without it a phone room was a lamp hot spot in dark red-brown walls, ~35%
    // darker than desktop and the photo's warm-tan wall-to-wall glow. A pool light is a downward half-space, so on phones
    // it sits higher (near head height) to reach the walls as well as the floor.
    // creamy: the light off warm-tan planks (the lamps' own orange made the rooms read deep orange; photo: cream-tan)
    const b = new THREE.PointLight(MOBILE ? 0xFFDDBA : 0xFFD6A8, 0, 3.6, 0); b.position.copy(R.c); if (MOBILE) b.position.y += .9; scene.add(b);
    glows.push({ room, l: b, I: R.bounce * .5, bounce: true });
  }
  for (const w of windows) {
    if (!w.g || !ROOMS[w.room]) continue;
    w.g.updateMatrixWorld(true); const p = w.g.getWorldPosition(V());
    const n = V(0, 0, 1).applyQuaternion(w.g.quaternion); n.y = 0; n.normalize();
    const out = p.clone().sub(ROOMS[w.room].c); out.y = 0; if (out.dot(n) < 0) n.negate();
    const hp = p.clone().addScaledVector(n, .12);
    w.n = n; w.room0 = ROOMS[w.room].c; w.glowAt = p.clone().addScaledVector(n, .5);
    if (ENV && ENV.addHalo) { const h = Object.assign(new THREE.Object3D(), { intensity: 0 }); h.position.copy(hp); scene.add(h); ENV.addHalo(h, 1.25); glows.push({ room: w.room, halo: h, I: 2.6, hp, n, win: w }); }
    const back = Math.abs(n.z) > .7;
    // spill: a cone thrown OUT of the window onto the bark and leaves. A spot pointing away from the room, so it can't
    // reach the inside walls through the boards (the old point light lit a hot stripe beside the kitchen window).
    if (back && !MOBILE) {
      const l = new THREE.SpotLight(0xFFBA66, 0, 3.6, 1.05, .85, 1.6); l.position.copy(p).addScaledVector(n, .2);
      l.target.position.copy(p).addScaledVector(n, 2).add(V(0, -.5, 0)); scene.add(l, l.target);
      glows.push({ room: w.room, l, I: 3, spill: true, win: w });
    }
  }
  const warm = {};

  // ---------- curtains ----------
  // Two cloth panels inside each window on a little rod. Day: pulled to the sides. Evening and night: half drawn,
  // so the lit window shows a warm gap with glowing fabric either side (the lamp shines through the cloth).
  // Lockdown (the brain bars the house for zombies): drawn shut, and the window leaks only a faint glow.
  // On desktop the kitchen and bedroom lanterns cast real shadows, so the curtains throw folds of shadow in the room.
  const CUR_COL = { kitchen: 0xB0473A, bedroom: 0xD8B886, workshop: 0x6F7C55 };
  // [PROPS] The panels are real cloth now, not a flat card with a ripple: a gathered heading hung from rings on the rod,
  // folds whose depth follows how much fabric is bunched (the cloth keeps its length: pulled aside the folds go deep,
  // drawn shut they open out), folds that wander a little and widen toward the weighted hem, and a hem that flares a
  // touch when the panel is gathered. Each panel is a 42 x 9 indexed grid (~750 tris) laid on the CPU only while it moves.
  const CNX = 42, CNY = 9, CNV = (CNX + 1) * (CNY + 1);
  const curIdx = (() => { const a = []; for (let j = 0; j < CNY; j++) for (let i = 0; i < CNX; i++) { const q = j * (CNX + 1) + i; a.push(q, q + 1, q + CNX + 1, q + 1, q + CNX + 2, q + CNX + 1); } return a; })();
  const ringGeo = (() => { const g = new THREE.TorusGeometry(.011, .0024, 3, 6); g.rotateY(Math.PI / 2); return g; })();
  // All curtains, rods and rings of the house are ONE mesh (was 3 draws per window): vertex colours give each room its
  // cloth and the rods their iron; the panels are moved on the CPU when they draw (only while moving);
  // aGlow (per vertex, per frame) is the lamp shining through the cloth; the hem sway in a draught is in the vertex
  // shader with one slot per window (aWin), fed from Wind's own per-window uniforms (see windSlots below).
  const curtains = [], CUR_MAX = 8;
  const curParts = [];   // {c, kind panel|rod|ring, side, geo (rod/ring, window-local), start vertex in the merged buffer, n}
  for (const w of windows) {
    const glassM = w.g && w.g.children.find(c => c.geometry && c.geometry.type === 'PlaneGeometry');
    if (!glassM || !w.n || curtains.length >= CUR_MAX) continue;
    const { width: W, height: H } = glassM.geometry.parameters;
    const inL = w.n.clone().negate().applyQuaternion(w.g.quaternion.clone().invert()); const sz = Math.sign(inL.z) || 1;
    // Wind's hook (housewind.js) wants a material per curtain: a stand-in that is never drawn; its uniforms are read back
    const c = { w, W, H, sz, idx: curtains.length, mat: new THREE.MeshStandardMaterial(), closed: 0, dirty: true, col: new THREE.Color(CUR_COL[w.room] || 0xC9A57A) };
    c.pos = w.g.getWorldPosition(V());
    c.Lf = (W / 2 + .05) * 1.75;                       // fabric width of one panel (fullness 1.75)
    c.nf = Math.min(6, Math.max(4, Math.round(c.Lf / .15)));   // pleats per panel (7 grid columns each)
    curtains.push(c);
    for (const side of [-1, 1]) { curParts.push({ c, kind: 'panel', side, n: CNV, seed: c.idx * 2.3 + side * .9 });
      for (let k = 0; k <= c.nf; k++) curParts.push({ c, kind: 'ring', side, k, geo: ringGeo }); }
    const rg = new THREE.CylinderGeometry(.008, .008, W + .16, 6); rg.rotateZ(Math.PI / 2); rg.translate(0, H / 2 + .085, sz * .075);
    curParts.push({ c, kind: 'rod', side: 0, geo: rg });
    w.leak = 1;
  }
  let curMesh = null, curPosA = null, curNorA = null, curGlowA = null, curAOA = null;
  const curU = { uCT: { value: 0 }, uCK: { value: new Array(CUR_MAX).fill(0) }, uCS: { value: new Array(CUR_MAX).fill(0) },
    uCN: { value: Array.from({ length: CUR_MAX }, () => V()) }, uCX: { value: Array.from({ length: CUR_MAX }, () => V()) } };
  if (curParts.length) {
    let n = 0; const idx = [];
    for (const p of curParts) { p.start = n; if (p.kind !== 'panel') p.n = p.geo.attributes.position.count;
      const ix = p.kind === 'panel' ? curIdx : p.geo.index.array; for (let i = 0; i < ix.length; i++) idx.push(ix[i] + n); n += p.n; }
    const geo = new THREE.BufferGeometry();
    curPosA = new THREE.BufferAttribute(new Float32Array(n * 3), 3); curNorA = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    curGlowA = new THREE.BufferAttribute(new Float32Array(n), 1);
    curAOA = new THREE.BufferAttribute(new Float32Array(n).fill(1), 1);   // cavity light: the deep of a fold sees less of the room
    const col = new Float32Array(n * 3), win = new Float32Array(n), loc = new Float32Array(n * 2), iron = new THREE.Color(0x2C2F35);
    for (const p of curParts) { const k = p.c.col, pan = p.kind === 'panel', cc = pan ? k : iron;
      for (let i = 0; i < p.n; i++) { const j = p.start + i; col.set([cc.r, cc.g, cc.b], j * 3); win[j] = pan ? p.c.idx : -1;
        loc[j * 2] = pan ? (i % (CNX + 1)) / CNX : 0; loc[j * 2 + 1] = pan ? Math.floor(i / (CNX + 1)) / CNY - .5 : .5; } }
    geo.setIndex(idx);
    geo.setAttribute('position', curPosA); geo.setAttribute('normal', curNorA); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', curGlowA); geo.setAttribute('aAO', curAOA); curAOA.setUsage(THREE.DynamicDrawUsage); geo.setAttribute('aWin', new THREE.BufferAttribute(win, 1)); geo.setAttribute('aLoc', new THREE.BufferAttribute(loc, 2));
    curPosA.setUsage(THREE.DynamicDrawUsage); curNorA.setUsage(THREE.DynamicDrawUsage); curGlowA.setUsage(THREE.DynamicDrawUsage);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => { Object.assign(sh.uniforms, curU);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
attribute float aGlow, aWin, aAO; attribute vec2 aLoc; varying float vGlow, vAO;
uniform float uCT, uCK[${CUR_MAX}], uCS[${CUR_MAX}]; uniform vec3 uCN[${CUR_MAX}], uCX[${CUR_MAX}];`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = aGlow; vAO = aAO;
if (aWin > -.5) { int wi = int(aWin + .5); float k = uCK[wi], sd = uCS[wi];
  float hw = clamp(.5 - aLoc.y, 0., 1.); hw *= hw;     // the hem moves, the rod end stays (same draught as housewind.js)
  float wv = sin(uCT * 2.1 + aLoc.x * 5. + sd) * .6 + sin(uCT * 3.3 - aLoc.x * 8. + sd * 2.) * .4;
  transformed += uCN[wi] * (k * hw * (.04 + .05 * wv)) + uCX[wi] * (k * hw * .02 * sin(uCT * 1.7 + sd)); }`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow, vAO;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vAO;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vGlow;'); };
    mat.customProgramCacheKey = () => 'curtainsMerged2';
    curMesh = new THREE.Mesh(geo, mat); curMesh.castShadow = true; curMesh.receiveShadow = true; curMesh.userData.noHang = true; curMesh.name = 'curtains';
    scene.add(curMesh);
  }
  const _cm = new THREE.Matrix4(), _cn = new THREE.Matrix3(), _cv = V(), _pm = new THREE.Matrix4();
  const _cg = new Float32Array(CNV * 3), _ca = V(), _cb = V(), _cq = new THREE.Quaternion(), _c1 = V(1, 1, 1);
  function layCurtain(c) {      // cloth and rings in the window's frame -> world, written into the merged buffer
    c.w.g.updateMatrixWorld(true);
    const half = c.W / 2 + .05, wd = .1 + (half - .1) * c.closed;     // each panel: bunched 10 cm .. meets in the middle
    // the cloth keeps its width: a sine of nf periods over wd with arc length ~Lf has this depth (eased, clamped)
    const r = c.Lf / wd, a = Math.min(.036, Math.max(.009, wd / (Math.PI * c.nf) * Math.sqrt(Math.max(0, r * r - 1)) * .75));
    const Hc = c.H + .12, y0 = .02 - Hc / 2, zr = c.sz * .075;
    _cm.copy(c.w.g.matrixWorld); _cn.getNormalMatrix(_cm);
    for (const p of curParts) { if (p.c !== c) continue;
      if (p.kind === 'panel') {
        const s = p.side, x0 = s * (c.W / 2 + .03), sd = p.seed;
        for (let j = 0; j <= CNY; j++) { const v = j / CNY, lo = 1 - v;
          const flare = 1 + .1 * lo * lo * (1 - c.closed);                    // a gathered panel spreads a little at the hem
          const head = v > .93 ? .75 : 1;                                     // the heading is stitched flatter under the rings
          for (let i = 0; i <= CNX; i++) { const u = i / CNX, q = (j * (CNX + 1) + i) * 3;
            const ph = Math.PI * 2 * c.nf * u + lo * .55 * Math.sin(u * 7.1 + sd) + .3 * Math.sin(u * 13.7 + sd * 2.1) * lo;
            const av = a * head * (.85 + .35 * lo) * (1 + .2 * Math.sin(u * c.nf * 1.7 + sd * 3));
            const edge = Math.min(1, u * CNX / 1.5);                          // the outer edge is held to the wall
            _cg[q] = x0 - s * Math.min(u * wd * flare, half + .02);
            _cg[q + 1] = y0 + v * Hc - (u > .9 ? .006 * lo * (u - .9) * 10 : 0);   // the leading corner drops a hair
            const sn = Math.sin(ph); _cg[q + 2] = zr + c.sz * (a * .35 + av * sn * edge);
            // the trough between two pleats is shaded by its neighbours (deeper fold, darker trough)
            curAOA.array[p.start + q / 3] = 1 - Math.min(.55, av / .036 * .5) * edge * (1 - sn) * .5; } }
        curAOA.needsUpdate = true;
        for (let j = 0; j <= CNY; j++) for (let i = 0; i <= CNX; i++) { const q = (j * (CNX + 1) + i) * 3;
          const il = Math.max(0, i - 1) * 3, ir = Math.min(CNX, i + 1) * 3, jd = Math.max(0, j - 1) * (CNX + 1) * 3, ju = Math.min(CNY, j + 1) * (CNX + 1) * 3, row = j * (CNX + 1) * 3, cl = i * 3;
          _ca.set(_cg[row + ir] - _cg[row + il], _cg[row + ir + 1] - _cg[row + il + 1], _cg[row + ir + 2] - _cg[row + il + 2]);
          _cb.set(_cg[ju + cl] - _cg[jd + cl], _cg[ju + cl + 1] - _cg[jd + cl + 1], _cg[ju + cl + 2] - _cg[jd + cl + 2]);
          _cv.crossVectors(_ca, _cb).applyMatrix3(_cn).normalize(); curNorA.setXYZ(p.start + q / 3, _cv.x, _cv.y, _cv.z);
          _cv.set(_cg[q], _cg[q + 1], _cg[q + 2]).applyMatrix4(_cm); curPosA.setXYZ(p.start + q / 3, _cv.x, _cv.y, _cv.z); }
        continue; }
      if (p.kind === 'ring') {     // a ring on the rod over every pleat crest of the heading
        const u = (p.k + .25) / c.nf; _pm.compose(_cb.set(p.side * (c.W / 2 + .03) - p.side * Math.min(u * wd, half + .02), c.H / 2 + .085, zr), _cq, _c1);
        _pm.premultiply(_cm); } else _pm.copy(_cm);
      _cn.getNormalMatrix(_pm);
      const P = p.geo.attributes.position, N = p.geo.attributes.normal;
      for (let i = 0; i < P.count; i++) { const j = p.start + i;
        _cv.fromBufferAttribute(P, i).applyMatrix4(_pm); curPosA.setXYZ(j, _cv.x, _cv.y, _cv.z);
        _cv.fromBufferAttribute(N, i).applyMatrix3(_cn).normalize(); curNorA.setXYZ(j, _cv.x, _cv.y, _cv.z); }
      _cn.getNormalMatrix(_cm); }
    curPosA.needsUpdate = true; curNorA.needsUpdate = true; c.dirty = false;
    // sway axes for the shader: the window's in/out direction and its width direction, in world space
    curU.uCN.value[c.idx].set(0, 0, 1).transformDirection(c.w.g.matrixWorld); curU.uCX.value[c.idx].set(1, 0, 0).transformDirection(c.w.g.matrixWorld);
  }
  for (const c of curtains) layCurtain(c);
  if (curMesh) { curMesh.geometry.computeBoundingSphere(); curMesh.geometry.boundingSphere.radius += .3; }
  // Wind hooks each stand-in material (onBeforeCompile + uniforms uCurK/uCurT/uCurS). They are never compiled, so we
  // run that hook once on a dummy shader to get Wind's uniform objects, then copy their values into our arrays.
  function windSlots() {
    for (const c of curtains) {
      if (!c.wu && c.mat.userData.windCur && c.mat.onBeforeCompile) { const sh = { uniforms: {}, vertexShader: '', fragmentShader: '' }; try { c.mat.onBeforeCompile(sh); } catch (e) {} c.wu = sh.uniforms.uCurK ? sh.uniforms : null; }
      if (c.wu) { curU.uCK.value[c.idx] = c.wu.uCurK.value; curU.uCS.value[c.idx] = c.wu.uCurS.value; curU.uCT.value = c.wu.uCurT.value; }
    }
  }
  window.__curtains = curtains;   // [WIND] housewind.js lets them stir in a draught on gusty days
  let lockK = 0, curForce = false;
  function updateCurtains(dt, dayK) {
    const locked = curForce || !!(window.__brain && window.__brain.locked);
    lockK += ((locked ? 1 : 0) - lockK) * Math.min(1, dt * .6);
    for (const c of curtains) {
      const want = locked ? 1 : dayK > .55 ? 0 : .42;
      if (c.want !== undefined && want !== c.want && window.__audio && window.__audio.play) {   // Sound's cloth + rings, at this window
        const pos = new THREE.Vector3(); c.w.g.getWorldPosition(pos);
        window.__audio.play(want === 1 ? 'curtain_close' : want === 0 ? 'curtain_open' : 'curtain', pos, { delay: Math.random() * .8 });
      }
      c.want = want;
      c.closed += (want - c.closed) * Math.min(1, dt * .5);
      if (Math.abs(c.closed - (c.laid ?? -1)) > .002) { c.laid = c.closed; layCurtain(c); }
      const wr = Math.min(1, warm[c.w.room] || 0) * (1 - dayK) * .55;
      if (Math.abs(wr - (c.glow ?? -1)) > .003) { c.glow = wr; for (const p of curParts) if (p.c === c && p.kind === 'panel') curGlowA.array.fill(wr, p.start, p.start + p.n); curGlowA.needsUpdate = true; }
      c.w.leak = 1 - .3 * Math.min(1, c.closed / .5) - .62 * Math.max(0, (c.closed - .5) / .5);
    }
    if (curMesh) windSlots();
  }

  // ---------- lit windows warm the leaves and branches right next to them (photo) ----------
  // No lights: the oak's bark and leaf shaders (tree.js) get two small uniform arrays, one warm point per window,
  // and add a soft emissive glow that fades out within ~1.8 m. Chained onto Tree's own onBeforeCompile.
  const WG_N = 12, wgP = { value: Array.from({ length: WG_N }, () => new THREE.Vector4(0, -99, 0, 0)) }, wgC = { value: Array.from({ length: WG_N }, () => new THREE.Vector3()) };
  const wgWins = windows.filter(w => w.glowAt).slice(0, WG_N);
  // each entry: a warm point, its reach, and how bright it is now (photo: the bark around the house is warm brown at night,
  // lit by the windows, the lanterns and the open room fronts). Windows reach 3.4 m; the rooms' open fronts and the
  // outdoor lanterns reach further. Lit with a soft wrap toward the source, so the bark keeps its relief.
  const wgSrc = wgWins.map(w => ({ p: w.glowAt, r: 3.4, k: () => Math.min(1, warm[w.room] || 0) * 4.5 * (w.leak ?? 1) }));
  for (const [room, R] of Object.entries(ROOMS)) wgSrc.push({ p: R.c, r: 5.5, k: () => Math.min(1, warm[room] || 0) * 3.2 * (1 - .7 * lockK) });
  for (const [n, r, I] of [['landing', 3.6, 6], ['door', 3.2, 5]]) { const s0 = src.get(n); if (s0) wgSrc.push({ p: s0.pos, r, k: () => s0.level * I }); }
  wgSrc.length = Math.min(wgSrc.length, WG_N);
  wgSrc.forEach((w, i) => wgP.value[i].set(w.p.x, w.p.y, w.p.z, w.r));
  let wgOn = true; const wgMats = [];
  function treeGlow(mat) {
    if (!mat || mat.userData.winGlow) return; mat.userData.winGlow = true; wgMats.push(mat);
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      if (prev) prev.call(mat, sh, r);
      if (!wgOn) return;
      sh.uniforms.wgP = wgP; sh.uniforms.wgC = wgC;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWGp;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{vec4 q=vec4(transformed,1.);\n#ifdef USE_INSTANCING\nq=instanceMatrix*q;\n#endif\nvWGp=(modelMatrix*q).xyz;}');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vWGp;uniform vec4 wgP[${WG_N}];uniform vec3 wgC[${WG_N}];`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{vec3 wg=vec3(0.);vec3 nW=normalize((vec4(normal,0.)*viewMatrix).xyz);for(int i=0;i<${WG_N};i++){vec3 dv=wgP[i].xyz-vWGp;float d=length(dv)/max(wgP[i].w,.001);float k=clamp(1.-d,0.,1.);float wr=clamp(dot(nW,dv/max(length(dv),.001))*.6+.4,0.,1.);wg+=wgC[i]*k*k*wr;}
 totalEmissiveRadiance+=wg*diffuseColor.rgb;}`);
    };
    // explicit program key: the material's own key if it had one, else the source of the hook we wrapped (three's default
    // key is onBeforeCompile.toString(), which after wrapping would be OUR wrapper for every material -> shared programs)
    const own = Object.prototype.hasOwnProperty.call(mat, 'customProgramCacheKey') ? mat.customProgramCacheKey.bind(mat) : null, prevSrc = prev ? prev.toString() : '';
    mat.customProgramCacheKey = () => (own ? own() : prevSrc) + (wgOn ? '|winglow' : '');
    mat.needsUpdate = true;
  }
  if (TREE && wgSrc.length) { if (TREE.bark) treeGlow(TREE.bark.material); if (TREE.leaves) treeGlow(TREE.leaves.material); }

  // ---------- daytime: sunbeams through the windows, with warm dust drifting in them ----------
  // A soft additive prism from each window pane, along the real sun direction (the scene's shadow-casting
  // directional light), only for windows that face the sun, strongest when the sun is low (morning/evening).
  // Positions are built on the GPU from the window corners and the sun vector, so nothing is re-meshed per frame.
  let sunL = null; scene.traverse(o => { if (o.isDirectionalLight && o.castShadow && !sunL) sunL = o; });
  const beamU = { uT: { value: 0 } };
  // beam prism: position = (u, v, t) on the window (u, v) pushed t along the light; aS = across coordinate for soft edges
  const beamVS = `
    attribute float aS; uniform vec3 c0, eu, ev, dir; varying float vS, vT;
    void main(){ vS = aS; vT = position.z; vec3 p = c0 + eu*position.x + ev*position.y + dir*position.z;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`;
  const beamFS = `
    uniform float k; varying float vS, vT;
    void main(){ float a = k * pow(sin(3.14159*vS), 1.6) * pow(1.-vT, 1.4) * smoothstep(0., .06, vT);
      gl_FragColor = vec4(vec3(1., .86, .62) * a, 1.); }`;
  const dustVS = `
    attribute vec4 aD; uniform vec3 c0, eu, ev, dir; uniform float uT, px; varying float vA;
    void main(){ float t = fract(aD.z + uT*.012*(.5+aD.w));
      float u = clamp(aD.x + sin(uT*.31 + aD.w*40.)*.05, 0., 1.), v = clamp(aD.y + sin(uT*.23 + aD.w*70.)*.06, 0., 1.);
      vec3 p = c0 + eu*u + ev*v + dir*t; vec4 mv = viewMatrix * vec4(p, 1.);
      vA = sin(3.14159*u) * sin(3.14159*v) * (1.-t) * smoothstep(0., .08, t) * (.55 + .45*sin(uT*2.1 + aD.w*90.));
      gl_PointSize = px * (1.2 + aD.w*1.6) * 3. / max(.5, -mv.z); gl_Position = projectionMatrix * mv; }`;
  const dustFS = `
    uniform float k; varying float vA;
    void main(){ vec2 q = gl_PointCoord - .5; float d = 1. - smoothstep(.15, .5, length(q)); gl_FragColor = vec4(vec3(1., .85, .6) * d * vA * k, 1.); }`;
  const prism = (() => {
    const pos = [], across = [];
    for (const [a, b] of [[[0, 0], [1, 0]], [[1, 0], [1, 1]], [[1, 1], [0, 1]], [[0, 1], [0, 0]]]) {
      for (const [e, t] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { const c = e ? b : a; pos.push(c[0], c[1], t); across.push(e); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.Float32BufferAttribute(across, 1)); return g;
  })();
  const beams = [];
  const nDust = MOBILE ? 22 : 40;
  for (const w of windows) {
    const pane = w.g && w.g.children[0];
    if (!pane || !pane.geometry || !pane.geometry.parameters || !w.n) continue;
    const { width: pw, height: ph } = pane.geometry.parameters;
    pane.updateMatrixWorld(true);
    const corner = (x, y) => pane.localToWorld(V(x * pw * .46, y * ph * .46, 0));
    const c0 = corner(-1, -1);
    const U = { c0: { value: c0 }, eu: { value: corner(1, -1).sub(c0) }, ev: { value: corner(-1, 1).sub(c0) }, dir: { value: V() }, uT: beamU.uT };
    const bm = new THREE.ShaderMaterial({ uniforms: { ...U, k: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexShader: beamVS, fragmentShader: beamFS });
    const m = new THREE.Mesh(prism, bm); m.frustumCulled = false; m.renderOrder = 3; m.visible = false; scene.add(m);
    const dg = new THREE.BufferGeometry(); const d = new Float32Array(nDust * 4);
    for (let i = 0; i < nDust * 4; i++) d[i] = Math.random();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nDust * 3), 3)); dg.setAttribute('aD', new THREE.BufferAttribute(d, 4));
    const dm = new THREE.ShaderMaterial({ uniforms: { ...U, k: { value: 0 }, px: { value: MOBILE ? 1.5 : 2 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexShader: dustVS, fragmentShader: dustFS });
    const pts = new THREE.Points(dg, dm); pts.frustumCulled = false; pts.renderOrder = 3; pts.visible = false; scene.add(pts);
    beams.push({ w, U, m, pts });
  }
  const sunV = V();
  function updateBeams(dayK, T) {
    beamU.uT.value = T;
    let on = 0;
    // the scene's directional light swaps from moon to sun at dayK .5: beams only appear well after that, so they never jump
    const dk = Math.max(0, Math.min(1, (dayK - .6) / .3)), dkS = dk * dk * (3 - 2 * dk);
    if (sunL && dkS > 0) { sunV.copy(sunL.position).sub(sunL.target.position).normalize(); on = dkS * Math.min(1, sunL.intensity / 2.2); }
    const low = 1 - Math.min(1, Math.max(0, sunV.y - .15) / .7);      // low sun: long golden beams
    for (const b of beams) {
      const face = on > 0 ? sunV.x * b.w.n.x + sunV.z * b.w.n.z : 0;     // sun on the outer side of this window?
      const k = on * Math.max(0, Math.min(1, (face - .05) * 3)) * (.35 + .65 * low);
      b.m.visible = b.pts.visible = k > .01;
      if (!b.m.visible) continue;
      b.U.dir.value.copy(sunV).multiplyScalar(-(2.2 + low * 1.3));
      b.m.material.uniforms.k.value = k * .16; b.pts.material.uniforms.k.value = k;
    }
  }

  // ---------- the switching logic ----------
  function fire(name, on) { for (const cb of listeners) { try { cb(name, on); } catch (e) { console.error(e); } } }
  // an oil lamp is lit with a match, not switched: when the hero's hand is at the lamp, a match strikes in his fingers
  // (a flash, then a small flame), is held to the wick, and only then the wick catches and the flame and its light grow
  // from nothing (KINDS.oil.on); the match is shaken out. Without a hand there (a test, a far switch) the wick just catches.
  const MATCH = { strike: .12, catch: .62, out: 1.35 };   // s after the strike: the match burns, the wick catches, the match is out
  const match = (() => { const g = new THREE.Group(); g.visible = false; scene.add(g);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(.0018, .0018, .05, 5).translate(0, -.025, 0), new THREE.MeshStandardMaterial({ color: 0xD8C29A, roughness: .8 }));
    const head = new THREE.Mesh(new THREE.SphereGeometry(.0034, 6, 4).scale(1, 1.4, 1), new THREE.MeshStandardMaterial({ color: 0x3A1E14, roughness: .7 }));
    const fm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.8, 1.9, .9), transparent: true, opacity: 1, depthWrite: false, toneMapped: false });
    const fl = new THREE.Mesh(flameGeo, fm); fl.renderOrder = 3; fl.position.y = -.002;
    for (const o of [stick, head, fl]) { o.castShadow = false; g.add(o); }
    return { g, fl, fm, owner: null }; })();
  const _mh = V(), _mw = V();
  function heroHand(p) { const B = window.__dbg && window.__dbg.heroBones; if (!B) return null; let best = null, bd = .95;
    for (const n of ['RightHand', 'LeftHand']) { const b = B[n]; if (!b) continue; b.getWorldPosition(_mh); const d = _mh.distanceTo(p); if (d < bd) { bd = d; best = b; } } return best; }
  function updateMatch(s, dt) {
    const ig = s.ign; ig.t += dt; const M = match;
    if (!ig.hand || M.owner && M.owner !== s) { if (ig.t > .15) s.ign = null; return; }
    M.owner = s; const T = ig.t;
    if (T > MATCH.out) { M.g.visible = false; M.owner = null; s.ign = null; return; }
    // in the fingers: from the hand toward the wick, held up; at the catch it touches the wick, then it comes away
    ig.hand.getWorldPosition(_mh); const wick = s.pos.clone().add(V(0, -.035, 0)); _mw.copy(wick).sub(_mh); const d = _mw.length(); _mw.normalize();
    const reach = T < MATCH.catch ? .06 + Math.min(1, T / MATCH.catch) * Math.max(0, d - .12) * .8 : .06 + Math.max(0, d - .12) * .8 * (1 - smooth(MATCH.catch, MATCH.out, T));
    M.g.position.copy(_mh).addScaledVector(_mw, Math.min(reach + .03, Math.max(.09, d - .02))).add(V(0, .04, 0)); M.g.visible = true;   // at the fingertips, held up: at the wrist bone the fist hid it
    M.g.rotation.set(.35, Math.atan2(_mw.x, _mw.z), 0);
    // strike: a bright flash that settles into a small flame; shaken out after the catch
    const fk = T < MATCH.strike ? 1.6 * T / MATCH.strike : T < MATCH.catch + .3 ? 1 + .08 * Math.sin(T * 37) : Math.max(0, 1 - (T - MATCH.catch - .3) / .25);
    M.fl.visible = fk > .02; M.fl.scale.set(.55 * fk, .65 * fk, .55 * fk);
  }
  function setOn(s, on) { if (s.on === on) return; s.on = on;
    if (on && s.kind === 'oil' && s.name !== 'hand') { s.ign = { t: 0, hand: heroHand(s.pos) }; if (!s.ign.hand) s.ign.t = MATCH.catch - .15; }
    if (on) s.flare = 1; else if ((s.kind === 'candle' || s.kind === 'oil') && s.level > .3) wisp(s); fire(s.name, on); }
  // a thin curl of smoke where a flame was just put out
  const smokeTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 1, 32, 32, 31);
    g.addColorStop(0, 'rgba(255,255,255,.9)'); g.addColorStop(.6, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const wisps = [];
  function wisp(s) {
    const top = s.pos.clone().add(V(0, s.kind === 'candle' ? .02 : .08, 0));
    for (let i = 0; i < 5; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xB8B4AE, transparent: true, opacity: 0, depthWrite: false }));
      sp.position.copy(top); sp.scale.setScalar(.03); sp.visible = false; scene.add(sp); wisps.push({ sp, age: -i * .25, life: 2.6, x0: top.x, z0: top.z, y0: top.y, ph: Math.random() * 6 }); }
  }
  function updateWisps(dt) {
    for (let i = wisps.length - 1; i >= 0; i--) { const w = wisps[i]; w.age += dt; const a = Math.max(0, w.age) / w.life;
      if (a >= 1) { scene.remove(w.sp); w.sp.material.dispose(); wisps.splice(i, 1); continue; }
      w.sp.position.set(w.x0 + Math.sin(w.age * 2.2 + w.ph) * .03 * a, w.y0 + a * .38, w.z0 + Math.cos(w.age * 1.7 + w.ph) * .02 * a);
      w.sp.scale.setScalar(.03 + a * .12); w.sp.material.opacity = w.age < 0 ? 0 : .35 * Math.sin(Math.PI * a); w.sp.visible = w.sp.material.opacity > .004; }
  }
  let cookT = 0, t = 0, frame = 0, emberK = 0, wasAsleep = false;
  // Phone and desktop light a room differently (phones: four pooled half-space cones, no point shadows; desktop: omni
  // lights and bloom), so the same lamp read ~40% too bright on desktop in the workshop and 25-45% too dark on phones.
  // One gain per room and platform brings both to the reference photo's room brightness (home view, one room lit with the
  // hero in it; mean luminance photo/desktop/phone: bedroom 89/80/68 (cosy, kept under the photo), kitchen 108/91/87, workshop 84/94/83).
  // (re-measured after the clear lantern glass and the bedroom lantern's move to its hook: kitchen and bedroom had dropped ~12%)
  const ROOM_GAIN = MOBILE ? { bedroom: 2.8, kitchen: 1.7, workshop: 1.05 } : { bedroom: 1.2, kitchen: 1.45, workshop: .42 };
  const roomGain = r => { const o = window.__lgain; return (o && o[r] != null ? o[r] : ROOM_GAIN[r]) ?? 1; };
  let quality = 2, shadowEvery = MOBILE ? 3 : 2;   // shadow maps redrawn every Nth frame
  // [PERF] a lamp's shadow map only needs redrawing when what it sees has moved, and the one thing that moves under a lamp
  // is the hero. So besides the cadence, a redraw needs the hero (root, head, hands, feet: everything he holds moves with
  // them) to have moved more than 1 cm since this map was last drawn; a still hero (diary, sitting, reading at the lamp)
  // costs no shadow passes (~30 draws each). Every 2 s near the lamp it redraws anyway (hatch, curtains, carried props).
  const poseNow = new Float32Array(18), _pv = V(); let poseBones = null, poseOK = false, shadowDraws = 0, shadowChances = 0;
  function samplePose() {
    const d = window.__dbg; poseOK = false; if (!d || !d.hero || !d.hero.root) return;
    if (!poseBones) { const B = d.heroBones || {}; poseBones = [d.hero.root, ...['Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'].map(n => B[n]).filter(Boolean)]; }
    for (let i = 0; i < poseBones.length && i < 6; i++) { _pv.setFromMatrixPosition(poseBones[i].matrixWorld); poseNow[i * 3] = _pv.x; poseNow[i * 3 + 1] = _pv.y; poseNow[i * 3 + 2] = _pv.z; }
    poseOK = true;
  }
  function poseMoved(L) {
    if (!poseOK) return true; if (!L.pose) { L.pose = new Float32Array(18); return true; }
    for (let i = 0; i < 18; i += 3) { const dx = poseNow[i] - L.pose[i], dy = poseNow[i + 1] - L.pose[i + 1], dz = poseNow[i + 2] - L.pose[i + 2]; if (dx * dx + dy * dy + dz * dz > 1e-4) return true; }
    return false;
  }

  // smooth 1D value noise in [-1, 1]: flames breathe instead of pulsing like a sine
  const hash = n => { const x = Math.sin(n * 127.1) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const noise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
  function flick(s, T) {
    const k = s.seed * 17;
    switch (KINDS[s.kind].flick) {
      // oil lantern: steady, a slow breath and a rare small dip when the wick gutters
      case 'flame': return .93 + noise(T * 1.3 + k) * .035 + noise(T * 7 + k) * .02 + noise(T * 17 + k) * .008 - Math.max(0, noise(T * .45 + k) - .55) * .25;
      case 'candle': return .84 + noise(T * 2.2 + k) * .07 + noise(T * 9 + k) * .04 + noise(T * 23 + k) * .02;
      case 'fire': return .8 + noise(T * 1.6 + k) * .1 + noise(T * 6 + k) * .07 + noise(T * 15 + k) * .03;
      default: return 1 + noise(T * 40) * .004;
    }
  }


  // ---------- contact shadows / ambient occlusion on the room floors ----------
  // Furniture stood "floating" in the warm lamp light: no darkening where the floor meets a wall, a leg, the bunk or the
  // stove. Cheap and the same on phones: every ~2 s one room is baked from BELOW (an orthographic camera just above the
  // floor looking up, so it sees the lowest thing over each spot of floor: legs and walls at 0 cm, the bunk's underside at
  // 30 cm, a table top at 75 cm), 128x128 per room, on the GPU (no read-back). A soft blur of "how close is the nearest
  // thing above" gives the occlusion; one transparent decal over the three floors darkens by it (1 draw call for all).
  // The hero is left out of the bake (he moves): his own soft contact blob follows him indoors (1 more draw call).
  // Floor rectangles and the two ladder openings follow index.html (floorBoards/wall* of each room).
  const AO = (() => {
    const TOP = .035;   // board tops sit ~3.5 cm above the level
    const RM = [
      { room: 'kitchen', y: KT, x0: -4.4, x1: -.9, z0: 1.0, z1: 4.6, holes: [[-1.5, -.92, 3.0, 3.9]] },
      { room: 'bedroom', y: BD, x0: -4.2, x1: .4, z0: .95, z1: 3.95, holes: [[-4.3, -3.55, 2.32, 3.25]] },
      { room: 'workshop', y: WS, x0: .9, x1: 4.6, z0: 1.2, z1: 5.3, holes: [] },
      // outside: the deck and the three round landings (index.html floorBoards with disc(cx, cz, r, zmin) shapes)
      { room: 'deck', y: DK, x0: .8, x1: 4.25, z0: .3, z1: 3.0, holes: [] },
      { room: 'landing', y: LC, x0: -3.2, x1: 2.2, z0: .5, z1: 3.9, holes: [], disc: [-.5, 1.2, 2.7, .5] },
      { room: 'lower', y: 2.45 /* LL */, x0: -3.45, x1: -.55, z0: .4, z1: 2.35, holes: [], disc: [-2.0, .9, 1.45, .4] },
      { room: 'door', y: LG, x0: .57, x1: 2.67, z0: .9, z1: 3.0, holes: [], disc: [1.62, 1.95, 1.05, .9] },
    ];
    const inShape = (R, x, z) => x > R.x0 && x < R.x1 && z > R.z0 && z < R.z1 && (!R.disc || ((x - R.disc[0]) ** 2 + (z - R.disc[1]) ** 2 <= R.disc[2] ** 2 && z >= R.disc[3]));
    const N = RM.length, RES = 128, H = 1.0;   // 7 tiles of 128x128 in one 896x128 target   // the bake sees up to 1 m above the floor
    const rtA = new THREE.WebGLRenderTarget(RES * N, RES, { depthBuffer: true }), rtB = new THREE.WebGLRenderTarget(RES * N, RES, { depthBuffer: false });
    for (const t of [rtA.texture, rtB.texture]) { t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; }
    // bake material: the height of the surface over the floor -> occlusion (1 at the floor, 0 from 60 cm up)
    const uF = { value: 0 };
    const bakeM = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    bakeM.onBeforeCompile = sh => { sh.uniforms.uF = uF;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vAoW;').replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 w = vec4( transformed, 1. );\n#ifdef USE_INSTANCING\n w = instanceMatrix * w;\n#endif\n vAoW = ( modelMatrix * w ).xyz; }');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAoW; uniform float uF;').replace('#include <dithering_fragment>', '#include <dithering_fragment>\nvec3 fn = normalize( cross( dFdx( vAoW ), dFdy( vAoW ) ) ); if ( vAoW.y < uF - .012 || ( abs( fn.y ) > .8 && !gl_FrontFacing ) ) discard;\ngl_FragColor = vec4( 1. - smoothstep( 0., .9, vAoW.y - uF ), 0., 0., 1. );'); };
    bakeM.customProgramCacheKey = () => 'lightsAOBake';
    const bc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, H);
    const mats = RM.map(() => new THREE.Matrix4());
    // blur: 2D gaussian-ish, ~14 cm, inside each room's tile
    const blur = new THREE.ShaderMaterial({ uniforms: { t: { value: rtA.texture }, px: { value: new THREE.Vector2(1 / (RES * N), 1 / RES) }, n: { value: N } },
      vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = vec4( position.xy, 0., 1. ); }',
      fragmentShader: 'uniform sampler2D t; uniform vec2 px; uniform float n; varying vec2 vU;\n' +
        'void main(){ float tile = floor( vU.x * n ), lo = tile / n + px.x * .5, hi = ( tile + 1. ) / n - px.x * .5; float s = 0., w = 0.;\n' +
        ' for ( int i = -4; i <= 4; i++ ) for ( int j = -4; j <= 4; j++ ) { float k = exp( -float( i * i + j * j ) / 10. ); vec2 u = vU + vec2( float( i ), float( j ) ) * px * 2.2; u.x = clamp( u.x, lo, hi );\n' +
        '  s += texture2D( t, u ).r * k; w += k; }\n gl_FragColor = vec4( s / w, 0., 0., 1. ); }', depthTest: false, depthWrite: false });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blur); quad.frustumCulled = false; const qs = new THREE.Scene(); qs.add(quad); const qc = new THREE.Camera();
    // the decal: one mesh, rectangles over each floor minus its ladder opening
    const pos = [], tl = [], idx = [];
    const rect = (x0, x1, z0, z1, y, t) => { if (x1 - x0 < .01 || z1 - z0 < .01) return; const b = pos.length / 3;
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1); tl.push(t, t, t, t); idx.push(b, b + 2, b + 1, b, b + 3, b + 2); };
    RM.forEach((R, i) => { const y = R.y + TOP + .012;   // just over the rugs too (a contact shadow lies on the rug as well)
      if (R.disc) { const c = .15; for (let x = R.x0; x < R.x1; x += c) for (let z = R.z0; z < R.z1; z += c) if (inShape(R, x + c / 2, z + c / 2)) rect(x, Math.min(R.x1, x + c), z, Math.min(R.z1, z + c), y, i); }
      else if (!R.holes.length) rect(R.x0, R.x1, R.z0, R.z1, y, i);
      else { const [hx0, hx1, hz0, hz1] = R.holes[0], ax0 = Math.max(R.x0, hx0), ax1 = Math.min(R.x1, hx1);
        rect(R.x0, ax0, R.z0, R.z1, y, i); rect(ax1, R.x1, R.z0, R.z1, y, i); rect(ax0, ax1, R.z0, Math.max(R.z0, hz0), y, i); rect(ax0, ax1, Math.min(R.z1, hz1), R.z1, y, i); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('tile', new THREE.Float32BufferAttribute(tl, 1)); g.setIndex(idx);
    const uK = { value: 0 };
    const dm = new THREE.ShaderMaterial({ uniforms: { t: { value: rtB.texture }, m: { value: mats }, n: { value: N }, k: uK },
      vertexShader: 'attribute float tile; uniform mat4 m[' + N + ']; varying vec3 vC; varying float vT;\n' +
        'void main(){ vec4 w = modelMatrix * vec4( position, 1. ); int ti = int( tile + .5 ); mat4 M = m[0];\n' + RM.map((_, i) => i ? ` if ( ti == ${i} ) M = m[${i}];` : '').join('') +
        '\n vec4 c = M * w; vC = c.xyz / c.w; vT = tile; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: 'uniform sampler2D t; uniform float n, k; varying vec3 vC; varying float vT;\n' +
        'void main(){ vec2 u = vC.xy * .5 + .5; float o = texture2D( t, vec2( ( vT + clamp( u.x, .004, .996 ) ) / n, u.y ) ).r;\n' +
        ' gl_FragColor = vec4( 0., 0., 0., k * pow( o, .7 ) ); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    const mesh = new THREE.Mesh(g, dm); mesh.name = 'roomAO'; mesh.renderOrder = 1; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
    let next = 0, baked = 0, clock = 0, heroIn = -1, age = 0, late = false; const dirty = new Set();
    const hidden = [], _bx = new THREE.Box3(), _sz = V();
    // rugs, mats, papers: flat things lying on the boards cast no occlusion (from below they would cover the whole floor)
    const thin = o => { if (!o.isMesh || o.isInstancedMesh || !o.geometry) return false; if (o.userData.aoThin === undefined) { if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); _bx.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).getSize(_sz); o.userData.aoThin = _sz.y < .05 && _sz.x * _sz.z > .02; } return o.userData.aoThin; };
    function bake(r, i) {
      const R = RM[i], fy = R.y + TOP, cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, hw = (R.x1 - R.x0) / 2 + .05, hd = (R.z1 - R.z0) / 2 + .05;
      bc.left = -hw; bc.right = hw; bc.top = hd; bc.bottom = -hd; bc.near = 0; bc.far = H + .4; bc.updateProjectionMatrix();
      bc.position.set(cx, fy - .4, cz); bc.up.set(0, 0, 1); bc.lookAt(cx, fy + 5, cz); bc.updateMatrixWorld(true);
      mats[i].multiplyMatrices(bc.projectionMatrix, bc.matrixWorldInverse);
      uF.value = fy;
      const hr = window.__dbg && window.__dbg.hero && window.__dbg.hero.root;
      hidden.length = 0; scene.traverseVisible(o => { if (o === mesh || o === hr || o === heroBlob || o.name === 'groundAO' || o.isSprite || o.isPoints || o.isLine || (o.material && o.material.transparent && !o.isSkinnedMesh) || thin(o)) hidden.push(o); });
      for (const o of hidden) o.visible = false;
      const prevRT = r.getRenderTarget(), ov = scene.overrideMaterial, bg = scene.background, fog = scene.fog, su = r.shadowMap.autoUpdate, ac = r.autoClear, cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
      const obr = scene.onBeforeRender, oar = scene.onAfterRender; scene.onBeforeRender = scene.onAfterRender = () => {};
      scene.overrideMaterial = bakeM; scene.background = null; scene.fog = null; r.shadowMap.autoUpdate = false; r.autoClear = false;
      try {
      r.setRenderTarget(rtA); rtA.viewport.set(RES * i, 0, RES, RES); rtA.scissor.set(RES * i, 0, RES, RES); rtA.scissorTest = true;
      r.setRenderTarget(rtA); r.setClearColor(0x000000, 1); r.clear(true, true, false); r.render(scene, bc);
      rtA.viewport.set(0, 0, RES * N, RES); rtA.scissor.set(0, 0, RES * N, RES); rtA.scissorTest = false;
      r.setRenderTarget(rtB); r.render(qs, qc);
      } finally {
      r.setRenderTarget(prevRT); scene.overrideMaterial = ov; scene.background = bg; scene.fog = fog; r.shadowMap.autoUpdate = su; r.autoClear = ac; r.setClearColor(cc, ca);
      scene.onBeforeRender = obr; scene.onAfterRender = oar;
      for (const o of hidden) o.visible = true; }
    }
    function update(dt, dayK) {
      clock += dt; if (!rdr) return;
      // all three rooms once at the start (behind the loading screen); after that a room is baked again only right after
      // the hero leaves it (he is the one who moves a chair, a bucket or the dishes): a bake costs ~90 draws, so it must
      // not be a steady cadence on phones
      const hr = window.__dbg && window.__dbg.hero && window.__dbg.hero.root; let inR = -1;
      if (hr) { const p = hr.position; RM.forEach((R, i) => { if (p.x > R.x0 - .3 && p.x < R.x1 + .3 && p.z > R.z0 - .3 && p.z < R.z1 + .3 && Math.abs(p.y - R.y - 1) < 1.3) inR = i; }); }
      if (baked >= N && inR !== heroIn) { if (heroIn >= 0) dirty.add(heroIn); heroIn = inR; clock = 0; }
      if (!late && (age += dt) > 10) { late = true; for (let i = 0; i < N; i++) dirty.add(i); }   // once more after the late-loading models are in
      let job = baked < N ? next : -1;
      if (job < 0 && clock > 1.5) for (const i of dirty) if (i !== heroIn) { job = i; break; }   // 1.5 s after he left, so the door/hatch has settled
      if (job >= 0) { try { bake(rdr, job); } catch (e) { console.warn('lights AO', e); mesh.visible = false; return; } if (baked < N) { next = (next + 1) % N; baked++; } else dirty.delete(job); }
      if (baked >= N) { mesh.visible = true; uK.value = .9 - .25 * dayK; }
    }
    return { update, mesh, rtA, rtB, RM, inShape, bakeAll: () => { if (rdr) for (let i = 0; i < N; i++) bake(rdr, i); } };
  })();

  // ---------- contact shadows on the ground under the things standing there (log pile, chopping block, sawhorse) ----------
  // The ground is uneven, so not the floor bake: one soft decal per object, a 10x10 grid laid on the ground (and roots)
  // around its footprint, dark next to it and fading over ~40 cm. All in one mesh (1 draw call). Rebuilt now and then:
  // the log pile shrinks and grows. The roots' own contact shadow is Ground's (ground.js).
  const GAO = (() => {
    const OBJ = [['logpile', .6], ['chopblock', .55], ['sawhorse', .35]];
    const m = new THREE.ShaderMaterial({ uniforms: { k: { value: 0 } },
      vertexShader: 'attribute float a; varying float vA; void main(){ vA = a; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1. ); }',
      fragmentShader: 'uniform float k; varying float vA; void main(){ gl_FragColor = vec4( 0., 0., 0., vA * k ); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m); mesh.name = 'groundAO'; mesh.frustumCulled = false; mesh.renderOrder = 1; mesh.visible = false; scene.add(mesh);
    let age = 0, next = 2, sig = '';
    const bx = new THREE.Box3(), sz = V(), ctr = V();
    function build() {
      const G = window.__ground, H = G && (G.standAt || G.heightAt); if (!H) return false;
      const pos = [], al = [], idx = []; let sg = '';
      for (const [name, S] of OBJ) {
        const o = scene.getObjectByName(name); if (!o || !o.visible) continue;
        const ry = o.rotation.y; o.rotation.y = 0; o.updateMatrixWorld(true); bx.setFromObject(o); o.rotation.y = ry; o.updateMatrixWorld(true);
        bx.getSize(sz); bx.getCenter(ctr); sg += name + sz.x.toFixed(2) + sz.z.toFixed(2);
        const hx = sz.x / 2, hz = sz.z / 2, E = .42, NX = 10, cs = Math.cos(ry), sn = Math.sin(ry), ox = o.position.x, oz = o.position.z, lx0 = ctr.x - ox, lz0 = ctr.z - oz, b = pos.length / 3;
        for (let j = 0; j < NX; j++) for (let i = 0; i < NX; i++) {
          const lx = lx0 + (-hx - E + (2 * (hx + E)) * i / (NX - 1)), lz = lz0 + (-hz - E + (2 * (hz + E)) * j / (NX - 1));
          const wx = ox + lx * cs + lz * sn, wz = oz - lx * sn + lz * cs;
          const dx = Math.max(0, Math.abs(lx - lx0) - hx), dz = Math.max(0, Math.abs(lz - lz0) - hz), d = Math.hypot(dx, dz);
          pos.push(wx, H(wx, wz) + .012, wz); al.push(S * (1 - smooth(0, E, d)));
        }
        for (let j = 0; j < NX - 1; j++) for (let i = 0; i < NX - 1; i++) { const q = b + j * NX + i; idx.push(q, q + NX, q + 1, q + 1, q + NX, q + NX + 1); }
      }
      if (sg === sig) return true; sig = sg;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('a', new THREE.Float32BufferAttribute(al, 1)); g.setIndex(idx);
      mesh.geometry.dispose(); mesh.geometry = g; mesh.visible = pos.length > 0; return true;
    }
    function update(dt, dayK) { age += dt; if (age > next) { age = 0; next = 12; build(); } m.uniforms.k.value = .85 - .2 * dayK; }
    return { update, mesh, build };
  })();
  // the hero's own contact blob indoors (he is not in the bake): a soft dark oval under his feet on a room floor
  const heroBlob = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.45, 'rgba(0,0,0,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), color: 0x000000, transparent: true, depthWrite: false, opacity: 0, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false }));
    m.name = 'heroContact'; m.renderOrder = 2; m.visible = false; scene.add(m); return m;
  })();
  let blobK = 0;
  function updateHeroBlob(dt, task, asleep) {
    const r = window.__dbg && window.__dbg.hero && window.__dbg.hero.root; if (!r) return;
    const p = r.position; let fy = null;
    for (const R of AO.RM) if (AO.inShape(R, p.x, p.z) && Math.abs(p.y - (R.y + .035)) < .08) fy = R.y + .035;
    // the hips over the feet: the blob sits under his centre of mass, wider when he crouches or sits low
    const want = fy != null && r.visible && task !== 'sleep' && !asleep ? 1 : 0;   // in the bunk he lies on the mattress, not on the floor blobK += (want - blobK) * Math.min(1, dt * 8);
    heroBlob.visible = blobK > .01; if (!heroBlob.visible) return;
    let cx = p.x, cz = p.z; const B = window.__dbg.heroBones; if (B && B.Hips) { const v = _v.setFromMatrixPosition(B.Hips.matrixWorld); cx = v.x; cz = v.z; }
    heroBlob.position.set(cx, (fy ?? p.y) + .006, cz); heroBlob.rotation.y = r.rotation.y; heroBlob.scale.set(.62, 1, .5);
    heroBlob.material.opacity = .5 * blobK;
  }

  function update({ dt, T, lampOn = 0, dayK = 0, task = null, state = null, asleep = false }) {
    t += dt; frame++;
    if (EMBERS) {
      const sl = (task === 'sleep' || asleep) && dayK < .5;
      if (sl && !wasAsleep) emberK = Math.max(emberK, 1);
      wasAsleep = sl; emberK = Math.min(Math.max(0, emberK - dt / 420), 1 - smooth(.4, .9, dayK));   // 7 game hours (1 game hour = 60 s), gone by full day
    }
    samplePose();
    // cooking, or stoking (the log goes in while the little door is open): the fire is fed
    const cooking = (task === 'cook' && state === 'work') || (task === 'stoke' && P3 && P3.oven && (P3.oven.open || 0) > .3);
    cookT = cooking ? 78 : Math.max(0, cookT - dt);     // fed while cooking, then burns down in ~1.3 game hours (24-minute day: an hour is 60 s)
    const ctx = { lamps: lampOn, dayK, task, state, asleep, cookT };
    for (const r in warm) warm[r] = 0;
    for (const s of src.values()) {
      // Pavel: a lamp or candle never goes out by itself. If the hero forgot it, it keeps burning until he puts it out.
      // The candle lights when he sits down to read in the dark and then stays lit (manual) until set('candle', false).
      if (s.name === 'candle' && s.manual === null && ctx.task === 'read' && ctx.state === 'work' && ctx.lamps > .25) s.manual = true;
      const want = s.manual !== null ? s.manual : !!s.autoFn(ctx);
      setOn(s, want);
      const K = KINDS[s.kind];
      if (s.ign) updateMatch(s, dt);
      const lighting = s.on && s.ign && s.ign.t < MATCH.catch;   // the match is still on its way to the wick: nothing burns yet
      s.level = lighting ? s.level : s.on ? Math.min(1, s.level + dt / K.on) : Math.max(0, s.level - dt / K.off);
      s.flare = lighting ? 1 : Math.max(0, s.flare - dt * 1.6);
      // ignition: oil/candle flare up then settle; the bulb stutters once
      let k = s.level;
      if (s.kind === 'oil' || s.kind === 'candle') k = s.level * (1 + s.flare * .35 * Math.max(0, Math.sin(t * 31 + s.seed)));
      else if (s.kind === 'electric' && s.flare > .85) k *= (Math.sin(t * 90) > 0 ? 1 : .35);
      else if (s.kind === 'fire') k = s.level * s.level * (3 - 2 * s.level);
      if (EMBERS && s.name === 'oven') k = Math.max(k, emberK * .3);   // banked coals: a low, breathing glow (extra() turns it into embers)
      // lockdown: he turns the wicks down / the bulb to a glow, so little light shows from outside (never off: Pavel)
      if (lockK > 0 && (s.name === 'kitchen' || s.name === 'bedroom' || s.name === 'workshop')) k *= 1 - .65 * lockK;
      let f = k > 0 ? flick(s, T) : 0;
      // he is at the stove feeding it: the fire is livelier, its glow dances on him and the kitchen
      if (s.name === 'oven' && cooking) f = .86 + (f - .8) * 1.5;   // livelier, but a room lit by a fire breathes; it doesn't strobe (was x2.2: the walls swung 3x)
      if (s.name === 'oven' && s.lights[0] && s.lights[0].l.userData.open) f += s.lights[0].l.userData.open * ((noise(T * 9 + 4) - .5) * .12 + (noise(T * 23 + 8) - .5) * .05);
      // outdoor flames feel the wind (game/wind.js): a gust makes the flame duck and stutter, then it steadies again.
      // Indoor flames stay calm. The glass of a lantern shelters it, so the dip is small.
      if (f > 0 && (s.name === 'landing' || (s.name === 'hand' && hand.outdoors)) && window.__wind && window.__wind.sample) {
        const w = window.__wind.sample(s.pos), g = Math.min(1.5, (w.gust || 0) + Math.max(0, (w.s || 0) - .5) * .4);
        if (g > .02) f *= 1 - Math.min(.32, g * .2) * (.55 + .45 * noise(T * 11 + s.seed * 7));
      }
      const open = s.extra && s.lights[0] && s.lights[0].l.userData.open || 0;
      for (const L of s.lights) {
        L.l.intensity = L.I * k * f * (s.name === "oven" ? .45 + 1.2 * open : 1 + open * 1.2) * roomGain(s.room);   // oven shut: only what the small glass lets out
        if (L.sway) { if (!L.home) L.home = L.l.position.clone(); const a = T * 1.7 + s.seed * 5; L.l.position.set(L.home.x + noise(a) * L.sway, L.home.y + noise(a + 40) * L.sway * .6, L.home.z + noise(a + 80) * L.sway); }
        if (L.l.castShadow) { const lit = k > .01;
          // the lamp's shadows only change when the hero (the one thing that moves) is in its reach: an empty lit room keeps its map
          const hr = window.__dbg && window.__dbg.hero && window.__dbg.hero.root, near = !hr || hr.position.distanceTo(L.l.position) < (L.l.shadow.camera.far || 6) + .5;
          if (lit && L.wasLit && near && (frame + s.idx) % shadowEvery === 0) shadowChances++;
          if (lit && (!L.wasLit || (near && (frame + s.idx) % shadowEvery === 0 && (poseMoved(L) || t - (L.drawnT || 0) > 2)))) {
            L.l.shadow.needsUpdate = true; L.drawnT = t; if (L.pose) L.pose.set(poseNow); else { L.pose = new Float32Array(poseNow); } shadowDraws++; }
          L.wasLit = lit; }
      }
      for (const [m, I] of s.emis) { m.emissiveIntensity = I * k * f; if (m.userData.pane) m.opacity = .16 + .3 * clamp01(k); }
      for (const [m, O] of s.opac) if (m) m.opacity = O * clamp01(k) * (.85 + f * .15);
      if (s.extra) s.extra(k, f);
      if (!s.lights.length && s.haloObj) s.haloObj.intensity = (s.kind === 'glow' ? .5 : 4.5) * k * f;
      const share = s.kind === 'glow' ? .04 : s.kind === 'candle' ? .3 : s.kind === 'fire' ? .55 : 1;
      warm[s.room] = Math.min(1.2, (warm[s.room] || 0) + k * f * share);
    }
    wgSrc.forEach((w, i) => { const v = w.k() * (1 - dayK); wgC.value[i].set(1.0 * v, .64 * v, .32 * v); });
    for (const g of glows) {
      let v = g.off ? 0 : (warm[g.room] || 0) * g.I * (1 - dayK * .8) * (g.win ? g.win.leak ?? 1 : 1);
      if (g.bounce) v *= roomGain(g.room);
      if (g.l) g.l.intensity = v;
      if (g.halo) {
        // seen from inside the room (or right at the pane) the window is just glass: no glow sprite in front of your eyes
        if (cam && g.n) { const d = _v.copy(cam.position).sub(g.hp), sd = d.dot(g.n), far = d.length(); v *= smooth(-.05, .5, sd) * smooth(.6, 1.6, far); }
        g.halo.intensity = v;
      }
    }
    AO.update(dt, dayK); GAO.update(dt, dayK); updateHeroBlob(dt, task, asleep); updateCurtains(dt, dayK); updateBeams(dayK, T); updateWisps(dt); updateHand(dt); updateHatch(dayK);
    if (pool) updatePool(dt);
    updateHeroRim(dayK);
    // Pavel: the bedroom textiles must read warm, not moon-blue. Environment's interior mask (a LightProbe used as a parameter)
    // turns the leftover blue night fill warm inside the rooms, same luminance (no brighter room); the moon stays outside.
    if (!inProbe) scene.traverse(o => { if (o.isLightProbe && o.name === 'envInteriorK') inProbe = o; });
    if (inProbe) {
      inProbe.sh.coefficients[0].y = .85 * (1 - dayK);
      /* per room (Env's box order: kitchen, bedroom, workshop): the warm tint only where the hero is or a lamp/fire burns.
         An empty dark room keeps the cool moonlit fill, so from outside it reads dark, not lamp-lit (phones: the empty
         workshop read orange, as if its lamp were on). Eased over ~1 s so walking in never pops. */
      const B = window.__env && window.__env.interiorBoxes, hr = window.__dbg && window.__dbg.hero && window.__dbg.hero.root;
      const c1 = inProbe.sh.coefficients[1], kk = 1 - Math.exp(-dt * 2.5);
      ['kitchen', 'bedroom', 'workshop'].forEach((room, i) => {
        let t = roomLevel(room) > .02 ? 1 : 0;
        if (!t && hr && B && B[i]) { const p = hr.position, r = B[i]; if (p.x > r[0] - .2 && p.x < r[1] + .2 && p.y > r[2] - .3 && p.y < r[3] && p.z > r[4] - .2 && p.z < r[5] + .2) t = 1; }
        if (!B) t = 1;
        c1.setComponent(i, c1.getComponent(i) + (t - c1.getComponent(i)) * kk);
      });
    }
    // the bedroom by day: its walls read red-orange in daylight (blue ~10/255); half the kitchen's honey toward the photo's
    // tone, by day only, so the approved cosy, dim night bedroom is exactly as before
    if (window.__wearHy) window.__wearHy[1] = .5 * smooth(.3, .8, dayK);
    for (const w of windows) {
      // Seen from inside the room a window is dark glass with the night (or the day sky) behind it, never a lamp:
      // no warm self-glow (critic T14). The warm glow of a lit window lives outside: halo + spill light (room glow).
      // Tree owns the panes; if they become real transparent glass, lights.js leaves them alone.
      if (w.mat.transparent || w.mat.userData.ownGlass) continue;
      w.mat.color.copy(PANE_NIGHT).lerp(PANE_DAY, dayK); w.mat.roughness = .06; w.mat.metalness = .1;
      w.mat.emissive.copy(SKY_NIGHT).lerp(SKY_DAY, dayK); w.mat.emissiveIntensity = .1 + dayK * .45;
    }
  }

  function roomLevel(room) {
    let v = 0;
    for (const s of src.values()) if (s.room === room) v = Math.max(v, s.kind === 'candle' ? s.level * .35 : s.kind === 'fire' ? s.level * .55 : s.level);
    return v;
  }

  // quality for a frame-rate governor: 2 full, 1 no lantern (point) shadows + slower shadow redraws + no window spill
  // lights, 0 no shadows at all. The look of the rooms stays (same lights, bounce, halos); only shadows thin out.
  const shadowed = []; for (const s of src.values()) for (const L of s.lights) if (L.l.castShadow) shadowed.push(L.l);
  function setQuality(q) {
    q = Math.max(0, Math.min(2, q | 0)); if (q === quality) return quality; quality = q;
    for (const l of shadowed) { l.castShadow = l.isSpotLight ? q >= 1 : q >= 2; l.shadow.needsUpdate = true; }
    shadowEvery = q >= 2 ? (MOBILE ? 3 : 2) : 4;
    for (const g of glows) if (g.spill) g.off = q < 2;
    return quality;
  }
  const degrade = () => quality > 0 && setQuality(quality - 1) !== null;
  const upgrade = () => quality < 2 && setQuality(quality + 1) !== null;

  const view = s => ({ name: s.name, room: s.room, kind: s.kind, on: s.on, level: +s.level.toFixed(2), auto: s.manual === null, pos: s.pos.clone() });
  // ---------- phones: a small pool of real point lights ----------
  // Every lit shader on a phone loops over all lights in the scene. So on phones the sources' point lights are only
  // bookkeeping (kept invisible: three.js leaves invisible lights out of the shaders, and their .intensity still drives
  // the halos and fog glow), and POOL_N real lights take the place of the ones that matter most this frame: lit, and
  // near the hero or the camera. A slot fades out before it moves to another source, so nothing pops. Sources without a
  // slot still glow (bulb emissive, halo, warm windows and bark glow). The light count never changes: no recompiles.
  const POOL_N = 4;
  let pool = null;
  if (MOBILE) {
    // the pool lights are wide cones (a half-space): a hanging lamp shines down into its own room and not up through
    // the ceiling boards into the room above (phones have no point shadows, so a plain point light bled through floors).
    // Every unshadowed source joins: room lanterns, oven, hand lantern, the landing cone and the door spill. The
    // workshop dome keeps its own shadowed spot. Four slots cover a normal night without swaps.
    const SC = THREE.ShaderChunk, LINE = 'light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );';
    if (SC.lights_pars_begin.includes(LINE)) SC.lights_pars_begin = SC.lights_pars_begin.replace(LINE,
      'float spDec = spotLight.decay;\n' +
      'if ( spDec > 9.5 ) { float k = floor( ( spDec - 10.0 ) / 4.0 ); if ( dot( lVector, spotLight.direction ) > spDec - 10.0 - 4.0 * k ) light.color = vec3( 0.0 ); spDec = k / 4.0; }\n' +
      'light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spDec );');
    else console.warn('lights: spot floor clip not installed (three changed)');
    const virt = [];
    for (const s of src.values()) for (const L of s.lights) if ((L.l.isPointLight || (L.l.isSpotLight && !L.l.castShadow)) && L.l !== doorCave) virt.push(L.l);
    for (const g of glows) if (g.bounce) virt.push(g.l);
    for (const l of virt) { l.visible = false; l.castShadow = false; }
    if (doorCave) doorCave.visible = false;
    const slots = Array.from({ length: POOL_N }, () => { const l = new THREE.SpotLight(0xFFC373, 0, 5, Math.PI / 2 * .97, .3, 1.5); scene.add(l, l.target); return { l, v: null, w: 0, sc: 0 }; });
    // A slot has no shadow map, so a room lamp would light the room below through its floor (bedroom lamp -> kitchen
    // ceiling, fridge top, hood). The slot's spot shader gets a floor plane instead: nothing deeper than the lamp's own
    // floor (along the slot's straight-down axis) is lit. Encoded in the decay uniform (>= 10: 10 + 4*round(decay*4) + h),
    // so no new uniforms: every material keeps the stock program, only getSpotLightInfo learns to read it.
    const FLOOR = { kitchen: KT, bedroom: BD, workshop: WS }, clip = new Map();
    for (const s of src.values()) for (const L of s.lights) if (L.l.isPointLight) {
      if (s.name === 'hand') clip.set(L.l, () => { const r = window.__dbg && window.__dbg.hero && window.__dbg.hero.root; return hand.outdoors || !r ? null : r.position.y; });
      else if (FLOOR[s.room] != null) clip.set(L.l, () => FLOOR[s.room]);
    }
    for (const g of glows) if (g.bounce && FLOOR[g.room] != null) clip.set(g.l, () => FLOOR[g.room]);
    pool = { virt, slots, clip, wp: V(), hero: V(), tp: V(), stats: { swaps: 0, frames: 0, missFrames: 0, maxMiss: 0 } };
  }
  function updatePool(dt) {
    const { virt, slots, wp, stats } = pool; stats.frames++;
    const hr = window.__dbg && window.__dbg.hero && window.__dbg.hero.root;
    const hp = hr ? pool.hero.copy(hr.position).add(V(0, 1, 0)) : null;
    const score = l => { if (l.intensity < .02) return 0; l.getWorldPosition(wp);
      const dh = hp ? wp.distanceTo(hp) : 99, dc = cam ? wp.distanceTo(cam.position) * .7 : 99, d = Math.min(dh, dc);
      return l.intensity * (l.userData.poolPri || 1) / (.5 + d * d); };
    const sc = new Map(); for (const l of virt) sc.set(l, score(l));
    for (const sl of slots) sl.sc = sl.v ? sc.get(sl.v) : 0;
    // a lit source without a slot takes a free one at once; it takes a busy one only from a source that went dark,
    // or from one it clearly beats (x1.8, so two lamps at similar distance don't trade the slot back and forth)
    const cand = virt.filter(l => sc.get(l) > 0 && !slots.some(sl => sl.v === l || sl.next === l)).sort((a, b) => sc.get(b) - sc.get(a));
    for (const l of cand) {
      const free = slots.find(sl => !sl.v); if (free) { free.v = l; free.w = 0; stats.swaps++; continue; }
      const weak = slots.filter(sl => !sl.leaving).sort((a, b) => a.sc - b.sc)[0];
      if (weak && (weak.sc === 0 || sc.get(l) > weak.sc * 1.8)) { weak.leaving = true; weak.next = l; }
    }
    let miss = 0;
    for (const l of virt) if (sc.get(l) > 0 && !slots.some(sl => sl.v === l && !sl.leaving)) miss = Math.max(miss, l.intensity);
    if (miss > .1) { stats.missFrames++; stats.maxMiss = Math.max(stats.maxMiss, miss); }
    for (const sl of slots) {
      const l = sl.l;
      if (sl.leaving) {
        // a source that is already dark hands over at once; a lit one fades out over ~0.6 s first
        sl.w = sl.sc === 0 ? 0 : Math.max(0, sl.w - dt * 1.6);
        if (sl.w === 0) { sl.v = sl.next || null; sl.next = null; sl.leaving = false; if (sl.v) stats.swaps++; }
      } else if (sl.v) sl.w = Math.min(1, sl.w + dt * 2.5);
      const v = sl.v;
      if (!v) { l.intensity = 0; continue; }
      v.getWorldPosition(l.position); l.color.copy(v.color); l.distance = v.distance; l.decay = v.decay;
      if (v.isSpotLight) { v.target.getWorldPosition(l.target.position); l.angle = v.angle; l.penumbra = v.penumbra; }
      else {
        const up = v.userData.poolUp;
        l.target.position.copy(l.position).y += up != null ? 1 : -1; l.angle = Math.PI / 2 * .97; l.penumbra = .3;
        const fy = up != null ? null : pool.clip.has(v) ? pool.clip.get(v)() : null;
        if (up != null) l.decay = 10 + 4 * Math.round(v.decay * 4) + Math.min(3.9, Math.max(0, up - l.position.y + .06));   // ceiling clip (the cone looks up)
        else if (fy != null) l.decay = 10 + 4 * Math.round(v.decay * 4) + Math.min(3.9, Math.max(0, l.position.y - fy + .06));
      }
      l.intensity = v.intensity * sl.w;
    }
  }

  // ---------- the hero reads against the warm wood (Pavel: v6 melted into the orange interior) ----------
  // No extra light: a thin rim on the hero's own materials only (fresnel edge in the fragment shader). At night it is
  // the cool moonlit edge of the reference painting, by day a faint neutral edge. It brightens nothing else in the room,
  // costs no light slot and no draw call. Hooked lazily, so a hero swap (?hero=old, v6, LOD) gets it too.
  const rimU = { uRimC: { value: new THREE.Color() }, uRimW: { value: new THREE.Color() }, uFill: { value: new THREE.Color() }, uHue: { value: 0 } }, RIM_NIGHT = new THREE.Color(0x7FA6E0), RIM_DAY = new THREE.Color(0xFFF1DC), FILL_C = new THREE.Color(0xFFD9BC);
  let inProbe = null;
  let rimRoot = null, rimN = 0; const rimShared = new Set();
  function rimHook(m) {
    if (!m || m.userData.heroRim || !(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial)) return;
    m.userData.heroRim = true; const prev = m.onBeforeCompile, prevSrc = prev ? prev.toString() : '';
    const own = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey') ? m.customProgramCacheKey.bind(m) : null;
    m.onBeforeCompile = (sh, r) => { if (prev) prev.call(m, sh, r); sh.uniforms.uRimC = rimU.uRimC; sh.uniforms.uRimW = rimU.uRimW; sh.uniforms.uFill = rimU.uFill; sh.uniforms.uHue = rimU.uHue;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uRimC, uRimW, uFill; uniform float uHue;')
        .replace('#include <opaque_fragment>', '{ float hl = dot(outgoingLight, vec3(.3, .59, .11)), al = max(dot(diffuseColor.rgb, vec3(.3, .59, .11)), .02); outgoingLight = mix(outgoingLight, diffuseColor.rgb * hl / al, uHue); }\n#include <opaque_fragment>')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{ float rv = 1. - clamp(dot(normalize(normal), normalize(vViewPosition)), 0., 1.); float rim = rv * rv * rv;
  float lum = dot(diffuseColor.rgb, vec3(.3, .59, .11));
  // dark parts (hair, boots) take a weak edge in their own warm colour instead of the cool one: no blue-black helmet
  vec3 rc = mix(uRimW * (.3 + 1.6 * diffuseColor.rgb), uRimC * (.45 + .55 * diffuseColor.rgb), smoothstep(.06, .3, lum));
  totalEmissiveRadiance += rc * rim;
  // the room lamp's warm light wrapping round to the side the camera sees (his face when he turns to us): hero only
  totalEmissiveRadiance += uFill * diffuseColor.rgb * (.35 + .65 * (1. - rv)); }`); };
    m.customProgramCacheKey = () => (own ? own() : prevSrc) + '|heroRim'; m.needsUpdate = true;
  }
  function updateHeroRim(dayK) {
    const r = window.__dbg && window.__dbg.hero && window.__dbg.hero.root; if (!r) return;
    if (r !== rimRoot || ++rimN % 120 === 0) {
      // only the hero's own materials: a tool or lantern in his hand shares Props' materials with the whole house
      if (r !== rimRoot) { rimRoot = r; rimShared.clear(); const mine = new Set(); r.traverse(o => mine.add(o));
        scene.traverse(o => { if ((o.isMesh || o.isInstancedMesh) && !mine.has(o)) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => rimShared.add(m)); }); }
      r.traverse(o => { if (o.isSkinnedMesh || (o.isMesh && !o.userData.noRim)) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (!rimShared.has(m) && !(m && (m.transparent || (m.emissive && m.emissive.getHex() !== 0 && !o.isSkinnedMesh)))) rimHook(m); }); }); }
    // night: a cool edge strong enough to cut him out of the orange planks; day: barely there
    rimU.uRimC.value.copy(RIM_DAY).multiplyScalar(.1).lerp(_rc.copy(RIM_NIGHT).multiplyScalar(.42), 1 - dayK);
    rimU.uRimW.value.copy(FILL_C).multiplyScalar(.12 * (1 - dayK));
    // warm fill = how lit the room around him is (its own lamps), fading with distance from the room's middle; night only
    const hp = r.position; let w = 0;
    for (const [room, R] of Object.entries(ROOMS)) { const d = Math.hypot(hp.x - R.c.x, (hp.y + 1.1 - R.c.y) * 2, hp.z - R.c.z); w = Math.max(w, Math.min(1, warm[room] || 0) * smooth(3, 1.6, d)); }
    if (hand.g.visible) w = Math.max(w, Math.min(1, (src.get('hand') || {}).level || 0) * .8);
    rimU.uFill.value.copy(FILL_C).multiplyScalar(FILL_K * w * (1 - dayK * .85));
    // hero-look: out in the moonlight his olive trousers went teal and his brown hair grey-pink (the cool night light tints
    // his albedo). Outside the lit rooms half his light keeps his own colour at the same brightness: concept 6's olive,
    // chestnut and mustard read at night. His materials only; inside a lit room the lamp's warmth on him stays.
    rimU.uHue.value = .5 * (1 - dayK) * (1 - Math.min(1, w));
    // the moon has phases (Environment: a random start, one step a night), and outside the moon is most of his light, so he
    // read ~25% darker on a thin-moon night than at full moon. Less moon -> a little more of his own soft fill (his materials
    // only: the night itself still gets darker with the moon, he just stays readable)
    const ml = window.__env && window.__env.moonLight != null ? window.__env.moonLight : 1;
    rimU.uFill.value.add(_rc.copy(MOON_FILL).multiplyScalar(MF_K * Math.max(0, 1 - ml) * (1 - dayK) * (1 - Math.min(1, w))));
  }
  const _rc = new THREE.Color();
  // hero-look thread: his face still read dark in the lit rooms at the normal camera (face luma ~88 of 255, deep orange).
  // The lamp light bounced back off the walls and floor in front of him: .42 lifts the face to ~120 and lets the eyes read.
  // Hero materials only, so the rooms are exactly as bright as before.
  const FILL_K = .42;
  const MOON_FILL = new THREE.Color(0xD8DEE8), MF_K = .55;   // face 180 at full moon, 140 -> ~173 at new moon

  const api = {
    names: [...src.keys()],
    list: () => [...src.values()].map(view),
    _dbg: () => ({ match, scene, cam, pool, shadowDraws, shadowChances, rimU, AO, GAO, heroBlob, emberK: () => emberK }),
    get: n => src.has(n) ? view(src.get(n)) : null,
    pos: n => src.has(n) ? src.get(n).pos.clone() : null,
    set: (n, on) => { const s = src.get(n); if (!s) return false; s.manual = !!on; setOn(s, !!on); return true; },
    // oil lamps light with a match from the hero's hand when it is within ~1 m: the wick catches MATCH.catch s after set(n, true)
    // and the match is out at MATCH.out (Character: keep the hand at the lantern's door that long)
    matchTimes: MATCH,
    toggle: n => { const s = src.get(n); if (!s) return false; return api.set(n, !s.on); },
    auto: n => { for (const s of src.values()) if (!n || s.name === n) s.manual = null; },
    room: roomLevel,
    // Brain at lockdown start/end: curtains(true) draws every curtain shut and dims the rooms; curtains(false) hands
    // them back to the clock (open by day, half drawn at night). __brain.locked does the same on its own.
    curtains: on => { curForce = !!on; return curForce; },
    onChange: cb => listeners.push(cb),
    // the oven's 'level' is its heat (Props' coal bed and flame height, Wind's chimney smoke, the kettle's steam): lighting,
    // the kindling burns for a while before any coals form (heat lags the fire); going out, the coals keep their heat longest
    level: n => { const s = src.get(n); if (!s) return 0; if (s.kind !== 'fire') return s.level; return s.on ? Math.pow(s.level, 1.5) : Math.pow(s.level, .8); },
    // hand lantern: attachHand(bone, offset?) shows it in the hero's hand (then set('hand', true) lights it);
    // detachHand() hides it again (and puts it out)
    // attachHand(bone): if that hand already holds Props' lantern, the light and flame go inside it (no second lantern);
    // otherwise our own small lantern hangs from the fingers
    attachHand: (bone, off = V(0, -.04, .02), carried = null) => {
      if (!bone) return false; const ws = bone.getWorldScale(V()).x || 1;
      // the carried lantern is a child with meshes: the rig's end-effector helpers (mixamorigRightHandMiddle4, a bare Object3D)
      // also hang off the hand bone, and picking one put the flame at the world origin (an empty box's centre), far below him:
      // on night trips his lantern stayed dark and lit nothing
      const hasMesh = o => { let m = false; o.traverse(x => { if (x.isMesh) m = true; }); return m; };
      if (!carried) carried = bone.children.find(c => c !== hand.g && !c.isBone && !c.isLight && c.visible !== false && hasMesh(c)) || null;
      bone.add(hand.g); hand.g.scale.setScalar(1 / ws); hand.g.visible = true; hand.attached = bone; bone.getWorldPosition(hand.prev);
      if (carried) {
        bone.updateMatrixWorld(true); const c = new THREE.Box3().setFromObject(carried).getCenter(V()); bone.worldToLocal(c);
        hand.g.position.copy(c); if (hand.housing) hand.housing.visible = false;
        hand.bulb.position.set(0, 0, 0); hand.light.position.set(0, 0, 0); hand.bulb.scale.setScalar(.8); hand.fixed = true;
      } else {
        hand.g.position.copy(off).multiplyScalar(1 / ws); if (hand.housing) hand.housing.visible = true;
        hand.bulb.position.set(0, -.17, 0); hand.light.position.set(0, -.17, 0); hand.bulb.scale.setScalar(1); hand.fixed = false;
      }
      return true;
    },
    detachHand: () => { const s = src.get('hand'); if (s) { s.manual = null; setOn(s, false); } scene.add(hand.g); hand.g.visible = false; hand.attached = null; },
    // window glow on the oak can be compiled out (one shader rebuild) by a frame-rate governor
    winGlow: on => { if (on === undefined) return wgOn; on = !!on; if (on === wgOn) return false; wgOn = on; for (const m of wgMats) m.needsUpdate = true; return true; },
    // new sources from other systems (Props' radio dial, a new lamp...): addSource('radio', { room: 'workshop', kind: 'glow',
    //   pos: Vector3, mats: [[material, emissiveIntensityWhenOn]], opac: [[material, opacityWhenOn]], light: { color, I, dist } })
    // kind: oil | electric | candle | glow. A real light is only made on desktop (phones keep the light budget); the switch
    // logic, halo, room warmth and API are the same as for the built-in sources. Starts off; set(name, true) to turn on.
    addSource: (n, o = {}) => {
      if (src.has(n) || !o.pos) return false;
      const lights = [];
      if (o.light && !MOBILE) { const l = new THREE.PointLight(o.light.color ?? 0xFFC373, 0, o.light.dist ?? 2.5, 1.6); l.position.copy(o.pos); scene.add(l); lights.push({ l, I: o.light.I ?? 1.5 }); }
      add(n, o.room || 'outside', KINDS[o.kind] ? o.kind : 'glow', o.pos, { lights, emis: o.mats || [], opac: o.opac || [], haloSize: o.haloSize ?? .35, autoFn: () => false });
      for (const [m] of o.mats || []) if (m) m.emissiveIntensity = 0;
      api.names = [...src.keys()]; return true;
    },
    update, degrade, upgrade, quality: q => q === undefined ? quality : setQuality(q),
  };
  return api;
}
