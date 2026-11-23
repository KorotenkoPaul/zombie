// ================= props.js — furniture and objects inside the treehouse =================
// Every object is modelled in code: bevelled boards with painted wood grain, lathe-turned metal and
// ceramic, extruded tools. Static parts of each object are merged per material (few draw calls);
// interactive parts stay separate: oven door on a hinge, a book whose pages turn, grabbable tools.
// Local convention for every builder: floor at y=0, front of the object faces +z, centred on x/z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
let seed = 7; const R = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
const rr = (a, b) => a + R() * (b - a);

// ---------------- painted textures (canvas, generated once) ----------------
function canvas(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c; }
function texOf(c, { srgb = true, rep = 1 } = {}) { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = 8; return t; }
// painted Fal AI textures (game/*.jpg): start with the canvas version, swap in the image when it loads
function upgrade(t, url) { const img = new Image(); img.onload = () => { t.image = img; t.dispose(); t.needsUpdate = true; }; /* dispose: GPU storage is immutable and the size changes */ img.src = url; return t; }
function hexA(hex, a) { const c = new THREE.Color(hex); return `rgba(${c.r * 255 | 0},${c.g * 255 | 0},${c.b * 255 | 0},${a})`; }
// wood grain runs along canvas y (= texture v)
function woodCanvas(base, dark, light, { knots = 2, w = 256, h = 512 } = {}) {
  return canvas(w, h, (g) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { const x = R() * w, bw = rr(6, 40); g.fillStyle = hexA(R() < .6 ? dark : light, rr(.05, .16)); g.fillRect(x, 0, bw, h); g.fillRect(x - w, 0, bw, h); }
    for (let i = 0; i < 170; i++) {
      const x0 = R() * w, k = 1 + (R() * 3 | 0), amp = rr(1, 5), ph = R() * 6.28; g.strokeStyle = hexA(R() < .75 ? dark : light, rr(.06, .28)); g.lineWidth = rr(.5, 1.8);
      for (const off of [0, -w, w]) { g.beginPath(); for (let y = 0; y <= h; y += 8) { const x = x0 + off + Math.sin(y / h * 6.283 * k + ph) * amp; y ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    }
    for (let i = 0; i < knots; i++) { const x = rr(30, w - 30), y = rr(40, h - 40); for (let r = 14; r > 1; r -= 2.5) { g.strokeStyle = hexA(dark, .25 + (14 - r) / 30); g.lineWidth = 1.4; g.beginPath(); g.ellipse(x, y, r * .55, r * 1.3, 0, 0, 6.283); g.stroke(); } g.fillStyle = hexA(dark, .7); g.beginPath(); g.ellipse(x, y, 2.5, 4.5, 0, 0, 6.283); g.fill(); }
  });
}
function quiltCanvas() {
  const cols = ['#D88E8C', '#A3C47E', '#B7A0D0', '#8EB8DA', '#E9CB78', '#F1E7D6', '#DDA27E', '#C98FB4', '#9FD0C0'];
  return canvas(512, 512, (g) => {
    const n = 4, s = 512 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const c = cols[(i * 5 + j * 3 + (i * j) % 4) % cols.length]; const x = i * s, y = j * s;
      const gr = g.createRadialGradient(x + s / 2, y + s / 2, 4, x + s / 2, y + s / 2, s * .75); gr.addColorStop(0, c); gr.addColorStop(1, hexA(new THREE.Color(c).multiplyScalar(.82).getHex(), 1)); g.fillStyle = gr; g.fillRect(x, y, s, s);
      const pat = (i + j * 2) % 4; g.fillStyle = 'rgba(255,255,255,.22)';
      if (pat === 0) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { g.beginPath(); g.arc(x + 12 + a * 21, y + 12 + b * 21, 3, 0, 6.283); g.fill(); }
      if (pat === 1) for (let a = 0; a < 8; a++) g.fillRect(x, y + a * 16 + 4, s, 5);
      if (pat === 2) { g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 3; for (let a = -s; a < s; a += 18) { g.beginPath(); g.moveTo(x + a, y); g.lineTo(x + a + s, y + s); g.stroke(); } }
      g.strokeStyle = 'rgba(80,50,40,.35)'; g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
      g.strokeStyle = 'rgba(255,250,235,.75)'; g.lineWidth = 1.6; g.setLineDash([6, 5]); g.strokeRect(x + 8, y + 8, s - 16, s - 16); g.setLineDash([]);
    }
  });
}
function rugCanvas(kind) {
  return canvas(256, 256, (g, w, h) => {
    if (kind === 'check') { g.fillStyle = '#E4DCCB'; g.fillRect(0, 0, w, h); for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(96,122,150,.45)'; g.fillRect(i * 16, 0, 8, h); g.fillRect(0, i * 16, w, 8); } }
    else if (kind === 'orange') { g.fillStyle = '#C9773A'; g.fillRect(0, 0, w, h); g.fillStyle = '#E39A52'; g.fillRect(18, 18, w - 36, h - 36); g.strokeStyle = '#A85A2A'; g.lineWidth = 5; g.strokeRect(30, 30, w - 60, h - 60); g.strokeStyle = 'rgba(255,220,160,.5)'; g.lineWidth = 2; g.strokeRect(40, 40, w - 80, h - 80); }
    else { g.fillStyle = '#7C8466'; g.fillRect(0, 0, w, h); g.fillStyle = '#A3A27E'; g.fillRect(16, 16, w - 32, h - 32); g.fillStyle = '#8A8D6C'; g.fillRect(34, 34, w - 68, h - 68); for (const y of [24, h - 30]) { g.fillStyle = '#C9B98A'; g.fillRect(16, y, w - 32, 6); } }
    const id = g.getImageData(0, 0, w, h); for (let i = 0; i < id.data.length; i += 4) { const n = (R() - .5) * 26; id.data[i] += n; id.data[i + 1] += n; id.data[i + 2] += n; } g.putImageData(id, 0, 0);
    g.strokeStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < h; y += 3) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  });
}
function fringeCanvas(col) { return canvas(128, 32, (g) => { for (let x = 0; x < 128; x += 3) { g.strokeStyle = col; g.globalAlpha = rr(.7, 1); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + rr(-2, 2), rr(22, 32)); g.stroke(); } }); }
function staveCanvas(base, dark, n) { const c = woodCanvas(base, dark, '#E0A86A', { knots: 1 }); const g = c.getContext('2d'); for (let i = 0; i < n; i++) { const x = i * c.width / n; g.fillStyle = hexA(dark, .7); g.fillRect(x, 0, 2.5, c.height); g.fillStyle = 'rgba(255,220,170,.15)'; g.fillRect(x + 3, 0, 2, c.height); } return c; }
function weaveCanvas() { return canvas(128, 128, (g) => { g.fillStyle = '#8A5E36'; g.fillRect(0, 0, 128, 128); for (let y = 0; y < 128; y += 8) for (let x = 0; x < 128; x += 16) { const o = (y / 8) % 2 ? 8 : 0; const gr = g.createLinearGradient(x + o, 0, x + o + 14, 0); gr.addColorStop(0, '#9C6D3E'); gr.addColorStop(.5, '#D2A066'); gr.addColorStop(1, '#9C6D3E'); g.fillStyle = gr; g.beginPath(); g.ellipse(x + o + 7, y + 4, 7, 3.4, 0, 0, 6.283); g.fill(); } }); }
function pageCanvas() { return canvas(128, 180, (g) => { g.fillStyle = '#F4ECD8'; g.fillRect(0, 0, 128, 180); g.fillStyle = 'rgba(60,45,30,.55)'; for (let y = 18; y < 166; y += 7) { let x = 12; while (x < 112) { const ww = rr(5, 18); if (x + ww > 116) break; g.fillRect(x, y, ww, 2.2); x += ww + 3.5; } } g.fillStyle = 'rgba(120,90,50,.08)'; g.fillRect(0, 0, 10, 180); }); }
function pageEdgeCanvas() { return canvas(64, 64, (g) => { g.fillStyle = '#EFE5CC'; g.fillRect(0, 0, 64, 64); for (let y = 0; y < 64; y += 2) { g.fillStyle = `rgba(150,120,80,${rr(.05, .25)})`; g.fillRect(0, y, 64, 1); } }); }
function paperPlanCanvas() { return canvas(256, 180, (g) => { g.fillStyle = '#EFE6CF'; g.fillRect(0, 0, 256, 180); g.strokeStyle = 'rgba(70,90,130,.18)'; for (let x = 0; x < 256; x += 12) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 180); g.stroke(); } for (let y = 0; y < 180; y += 12) { g.beginPath(); g.moveTo(0, y); g.lineTo(256, y); g.stroke(); } g.strokeStyle = 'rgba(40,50,80,.8)'; g.lineWidth = 2; g.strokeRect(40, 40, 120, 80); g.beginPath(); g.moveTo(40, 40); g.lineTo(100, 14); g.lineTo(160, 40); g.stroke(); g.strokeRect(70, 70, 26, 50); g.strokeRect(116, 58, 28, 22); g.lineWidth = 1; g.beginPath(); g.moveTo(180, 40); g.lineTo(180, 120); g.moveTo(175, 40); g.lineTo(185, 40); g.moveTo(175, 120); g.lineTo(185, 120); g.stroke(); }); }
function pictureCanvas() { return canvas(160, 120, (g) => { const s = g.createLinearGradient(0, 0, 0, 120); s.addColorStop(0, '#9DB8C9'); s.addColorStop(1, '#E7D2A8'); g.fillStyle = s; g.fillRect(0, 0, 160, 120); g.fillStyle = '#6F8B5E'; g.beginPath(); g.moveTo(0, 80); g.quadraticCurveTo(50, 50, 90, 78); g.quadraticCurveTo(130, 60, 160, 74); g.lineTo(160, 120); g.lineTo(0, 120); g.fill(); g.fillStyle = '#8A6A4A'; g.fillRect(60, 70, 34, 24); g.fillStyle = '#A44A36'; g.beginPath(); g.moveTo(56, 70); g.lineTo(77, 56); g.lineTo(98, 70); g.fill(); g.fillStyle = '#4C6B47'; for (const x of [20, 30, 128, 140]) { g.beginPath(); g.moveTo(x, 90); g.lineTo(x + 7, 60); g.lineTo(x + 14, 90); g.fill(); } }); }
function labelCanvas(c1, c2) { return canvas(64, 32, (g) => { g.fillStyle = c1; g.fillRect(0, 0, 64, 32); g.fillStyle = c2; g.fillRect(0, 10, 64, 12); g.fillStyle = 'rgba(255,255,255,.6)'; g.fillRect(8, 14, 30, 3); }); }

// ---------------- geometry helpers ----------------
const rb = (w, h, d, r = .012, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.max(.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)));
// box-projected UVs in metres; wood grain follows `grain` axis (0=x,1=y,2=z)
function boxUV(geo, grain, scale = 1 / .9) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv; const ox = R() * 5, oy = R() * 5;
  for (let i = 0; i < p.count; i++) {
    const a = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))]; const ax = a[0] > a[1] ? (a[0] > a[2] ? 0 : 2) : (a[1] > a[2] ? 1 : 2);
    const o = [0, 1, 2].filter(k => k !== ax); let ua, va; if (o.includes(grain)) { va = grain; ua = o.find(k => k !== grain); } else { ua = o[0]; va = o[1]; }
    const P = [p.getX(i), p.getY(i), p.getZ(i)]; uv.setXY(i, P[ua] * scale + ox, P[va] * scale * .5 + oy);
  }
  uv.needsUpdate = true; return geo;
}
function lathe(pts, seg = 24) { return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg); }
function add(parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; }

// ---------------- materials ----------------
let M = null;
function makeMaterials(renderer) {
  // warm interior environment for the metals and glazes (only on these materials; scene lighting untouched)
  let env = null;
  try {
    const s = new THREE.Scene(); const geo = new THREE.SphereGeometry(10, 32, 16); const col = [];
    const top = new THREE.Color(0xFFD8A0), mid = new THREE.Color(0x9A6A40), bot = new THREE.Color(0x2E2018), c = new THREE.Color();
    for (let i = 0; i < geo.attributes.position.count; i++) { const y = geo.attributes.position.getY(i) / 10; if (y > 0) c.copy(mid).lerp(top, y); else c.copy(mid).lerp(bot, -y); col.push(c.r, c.g, c.b); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const win = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), new THREE.MeshBasicMaterial({ color: 0x8FB4D6 })); win.position.set(0, 2, -9); s.add(win);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xFFE2B0).multiplyScalar(3) })); lamp.position.set(3, 7, 3); s.add(lamp);
    const pm = new THREE.PMREMGenerator(renderer); env = pm.fromScene(s, .02).texture; pm.dispose();
  } catch (e) { env = null; }
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const wt = (b, d, l, k) => { const c = woodCanvas(b, d, l, { knots: k }); return { map: texOf(c), bumpMap: texOf(c, { srgb: false }), bumpScale: 1.2 }; };
  const metal = (color, metalness, roughness, ei = 1) => std({ color, metalness, roughness, envMap: env, envMapIntensity: ei });
  const qt = upgrade(texOf(quiltCanvas()), 'quilt.jpg'); const pg = texOf(pageCanvas()); pg.wrapS = pg.wrapT = THREE.ClampToEdgeWrapping;
  M = {
    env,
    wood: std({ ...wt('#C98A4E', '#7A4826', '#EDB477', 2), roughness: .72 }),          // honey furniture
    woodLight: std({ ...wt('#D9A066', '#8E5A30', '#F4C88E', 1), roughness: .72 }),     // table tops, shelves
    woodDark: std({ ...wt('#7E4E2E', '#3E2414', '#A8703F', 2), roughness: .78 }),      // frames, legs
    woodRed: std({ ...wt('#A85E34', '#5E2E16', '#D48A52', 1), roughness: .7 }),        // tool handles
    stave: std({ map: texOf(staveCanvas('#B87842', '#4A2A14', 14)), roughness: .75 }),
    staveDark: std({ map: texOf(staveCanvas('#9A6036', '#3A2010', 12)), roughness: .78 }),
    weave: std({ map: texOf(weaveCanvas(), { rep: 3 }), roughness: .9 }),
    iron: metal(0x34383F, .65, .45, .6),
    enamel: metal(0x4F5965, .35, .32, .9),
    enamelDark: metal(0x30353C, .4, .4, .6),
    steel: metal(0xB4BBC3, .9, .28, 1.1),
    chrome: metal(0xE2E6EA, 1, .14, 1.3),
    brass: metal(0xD8AE55, .85, .28, 1.2),
    copper: metal(0xC0754A, .9, .32, 1),
    hood: metal(0x7E858D, .85, .34, 1.0),
    fridge: metal(0xBDB7AA, .3, .3, .8),
    ceramic: metal(0xF2EDE3, 0, .22, .7),
    glazeBlue: metal(0x6F8FA8, 0, .25, .7),
    glazeCream: metal(0xE8D9B8, 0, .3, .7),
    glass: std({ color: 0xC8DCE6, roughness: .08, metalness: 0, transparent: true, opacity: .35, envMap: env, envMapIntensity: 1.2, depthWrite: false }),
    jarGlass: std({ color: 0xC88A3A, roughness: .15, transparent: true, opacity: .75, envMap: env, envMapIntensity: 1 }),
    rubber: std({ color: 0x24201E, roughness: .6 }),
    gripRed: std({ color: 0xB0412E, roughness: .45 }),
    gripYellow: std({ color: 0xD9A132, roughness: .45 }),
    gripBlue: std({ color: 0x3F6E9A, roughness: .45 }),
    linen: std({ color: 0xF4EDE0, roughness: .92 }),
    mattress: std({ color: 0xE6DFCF, roughness: .9 }),
    quilt: std({ map: qt, roughness: .95, side: THREE.DoubleSide }),
    clothBlue: std({ color: 0x7E9CB6, roughness: .95, side: THREE.DoubleSide }),
    felt: std({ color: 0x9A5A3A, roughness: 1 }),
    paper: std({ map: pg, roughness: .9, side: THREE.DoubleSide }),
    pageEdge: std({ map: texOf(pageEdgeCanvas()), roughness: .9 }),
    plan: std({ map: texOf(paperPlanCanvas()), roughness: .9 }),
    picture: std({ map: texOf(pictureCanvas()), roughness: .8 }),
    bread: std({ color: 0xC8884A, roughness: .8 }),
    darkInside: std({ color: 0x15100D, roughness: 1, side: THREE.BackSide }),
    fire: std({ color: 0x2A120A, emissive: 0xFF6A1E, emissiveIntensity: 1.2, roughness: 1 }),
    ovenGlass: std({ color: 0x2A160C, emissive: 0xFF7A2A, emissiveIntensity: .8, roughness: .1, metalness: 0, envMap: env, envMapIntensity: 1.2, transparent: true, opacity: .55, depthWrite: false }),
    covers: [0x8E3B2E, 0x2F5D7C, 0x4E6B3A, 0xB2803A, 0x6B4A7A, 0x9C5B2E, 0x3E4C5E].map(c => std({ color: c, roughness: .7 })),
    cans: [['#B8442E', '#E9D7A8'], ['#3F6E9A', '#F0E6CC'], ['#6E8F4A', '#F3E2B0'], ['#C99A3A', '#5A3A22']].map(([a, b]) => std({ map: texOf(labelCanvas(a, b)), metalness: .5, roughness: .4, envMap: env, envMapIntensity: .8 })),
  };
  return M;
}

// ---------------- merge static meshes per material (keeps draw calls low) ----------------
function bake(group) {
  group.updateMatrixWorld(true); const inv = group.matrixWorld.clone().invert(); const by = new Map(); const kill = [];
  group.traverse(o => { if (!o.isMesh || o.userData.live) return; let p = o.parent; while (p && p !== group) { if (p.userData.live) return; p = p.parent; } let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); if (!by.has(o.material)) by.set(o.material, []); by.get(o.material).push(g); kill.push(o); });
  for (const o of kill) o.removeFromParent();
  for (const [mat, gs] of by) { const m = new THREE.Mesh(mergeGeometries(gs, false), mat); m.castShadow = m.receiveShadow = true; group.add(m); gs.forEach(g => g.dispose()); }
  return group;
}

// ---------------- small shared parts ----------------
function W(parent, w, h, d, x, y, z, { mat = M.wood, r = .012, grain, rx = 0, ry = 0, rz = 0 } = {}) {
  if (grain === undefined) grain = w >= h && w >= d ? 0 : (h >= d ? 1 : 2);
  return add(parent, boxUV(rb(w, h, d, r), grain), mat, x, y, z, rx, ry, rz);
}
function knob(parent, x, y, z, mat = M.brass, r = .018) { add(parent, new THREE.SphereGeometry(r, 14, 10), mat, x, y, z + r * .6); add(parent, new THREE.CylinderGeometry(r * .45, r * .55, r * .9, 10), mat, x, y, z + r * .1, Math.PI / 2); }
function panelDoor(parent, w, h, x, y, z, mat = M.wood) { W(parent, w, h, .022, x, y, z + .011, { mat, r: .008, grain: 1 }); W(parent, w - .09, h - .09, .016, x, y, z + .024, { mat, r: .01, grain: 1 }); }
function screw(parent, x, y, z) { add(parent, new THREE.CylinderGeometry(.006, .006, .004, 8), M.iron, x, y, z, Math.PI / 2); }

// draped cloth: a plane laid over a w×d top that falls `drop` over the long sides
function drapeGeo(len, wid, drop, { r = .05, wrinkle = .01, endDrop = 0, puff = 0 } = {}) {
  const nx = puff ? 64 : 30, nz = puff ? 40 : 22; const geo = new THREE.PlaneGeometry(1, 1, nx, nz); const p = geo.attributes.position, uv = geo.attributes.uv;
  const fold = (s, half) => { const a = Math.abs(s), arcL = r * Math.PI / 2; if (a <= half - r) return [s, 0]; const d = a - (half - r); if (d < arcL) { const th = d / r; return [Math.sign(s) * (half - r + (r + .01) * Math.sin(th)), -(r - r * Math.cos(th))]; } return [Math.sign(s) * (half + .01), -r - (d - arcL)]; };
  for (let i = 0; i < p.count; i++) {
    const u = uv.getX(i), v = uv.getY(i); const s = (v - .5) * (wid + 2 * drop); let [z, y] = fold(s, wid / 2); let x = -len / 2 + u * (len + endDrop);
    if (x < -len / 2) { } if (endDrop && x > len / 2) { const d = x - len / 2; x = len / 2 + .004; y += -d; }
    const flat = y > -.001; y += flat ? wrinkle * (.5 + .5 * Math.sin(x * 11 + z * 4) * Math.sin(z * 9 + 1)) : 0; if (!flat) z += Math.sign(z) * wrinkle * (1.2 + Math.sin(x * 17));
    // quilted puff: each patch (4 per texture repeat) bulges up between its stitched seams
    if (puff) { const fu = ((x / .9 * 4) % 1 + 1) % 1, fv = ((s / .9 * 4) % 1 + 1) % 1; const b = Math.pow(Math.sin(Math.PI * fu) * Math.sin(Math.PI * fv), .6); if (flat) y += puff * b; else z += Math.sign(z) * puff * .7 * Math.pow(Math.sin(Math.PI * fu), .6); }
    p.setXYZ(i, x, y, z); uv.setXY(i, x / .9, s / .9); // v follows the unfolded cloth width, so the hanging sides are not smeared
  }
  geo.computeVertexNormals(); return geo;
}
function pillowGeo(w, h, d) { const g = rb(w, h, d, Math.min(w, h, d) * .45, 5); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const nx = p.getX(i) / (w / 2), nz = p.getZ(i) / (d / 2); const k = 1 - .55 * Math.pow(Math.max(Math.abs(nx), Math.abs(nz)), 3); p.setY(i, p.getY(i) * k); p.setZ(i, p.getZ(i) * (1 + .04 * Math.sin(nx * 3))); } g.computeVertexNormals(); return g; }

// ================= builders =================
function bunkBed() {
  const g = new THREE.Group(); const L = 2.0, D = .95, H = 1.78, p = .085; const lv = [.30, 1.07]; const info = { levels: [] };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { W(g, p, H, p, sx * (L / 2 - p / 2), H / 2, sz * (D / 2 - p / 2), { r: .016, grain: 1 }); add(g, rb(p + .012, .03, p + .012, .01), M.wood, sx * (L / 2 - p / 2), H + .012, sz * (D / 2 - p / 2)); }
  for (const y of lv) {
    for (const sz of [-1, 1]) W(g, L - 2 * p + .01, .13, .055, 0, y, sz * (D / 2 - .035));
    for (const sx of [-1, 1]) W(g, .055, .13, D - 2 * p + .01, sx * (L / 2 - .035), y, 0);
    for (let i = 0; i < 9; i++) W(g, .13, .022, D - .12, -L / 2 + .16 + i * (L - .32) / 8, y + .03, 0, { mat: M.woodDark, r: .006, grain: 2 });
    const top = y + .045 + .15; add(g, rb(L - .17, .15, D - .15, .055, 3), M.mattress, 0, y + .045 + .075, 0);
    // pillow at the head end (+x)
    add(g, pillowGeo(.36, .16, .6), M.linen, L / 2 - .28, top + .05, 0, 0, 0, -.12);
    // quilt over the foot two-thirds, folded sheet edge at its head
    const qL = L - .62; const q = add(g, drapeGeo(qL, D - .15, .12, { wrinkle: .008, puff: .026 }), M.quilt, -L / 2 + .08 + qL / 2, top + .012, 0); q.castShadow = false;
    add(g, rb(.09, .05, D - .12, .024, 3), M.linen, -L / 2 + .08 + qL + .02, top + .02, 0);
    info.levels.push({ top: top + .012, x0: -L / 2 + .09, x1: L / 2 - .09, z0: -(D - .15) / 2, z1: (D - .15) / 2, head: 1 });
  }
  // head and foot boards
  for (const sx of [-1, 1]) for (const y of [.62, 1.42, 1.62]) W(g, .05, .11, D - 2 * p + .01, sx * (L / 2 - .04), y, 0);
  // upper guard rail on the front with a short post
  W(g, L * .58, .09, .05, -L * .21, 1.4, D / 2 - .035); W(g, .06, .36, .06, -L * .21 + L * .29, 1.28, D / 2 - .035, { grain: 1 });
  // ladder at the front right
  { const lg = new THREE.Group(); lg.position.set(L / 2 - .3, 0, D / 2 + .07); lg.rotation.x = -.16; g.add(lg); for (const sx of [-1, 1]) W(lg, .05, 1.52, .045, sx * .16, .76, 0, { grain: 1 }); for (let i = 0; i < 5; i++) W(lg, .3, .04, .035, 0, .25 + i * .27, 0, { r: .008 }); }
  bake(g); g.userData.info = info; return g;
}
function slippers() { const g = new THREE.Group(); for (const [x, a] of [[-.07, .25], [.08, -.1]]) { const s = add(g, new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.felt, x, 0, 0, 0, a); s.scale.set(.05, .045, .115); const sole = add(g, new THREE.CylinderGeometry(1, 1, 1, 18), M.rubber, x, .004, 0, 0, a); sole.scale.set(.052, .008, .117); } return bake(g); }
function basket() { const g = new THREE.Group(); add(g, lathe([[0, 0], [.17, 0], [.2, .05], [.22, .3], [.215, .34], [.2, .34], [.19, .06], [0, .06]], 28), M.weave); add(g, new THREE.TorusGeometry(.218, .018, 8, 32), M.weave, 0, .34, 0, Math.PI / 2);
  const c = add(g, new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * .55), M.clothBlue, .02, .3, 0, .1, 0, .15); c.scale.set(.24, .14, .2); return bake(g); }
function chair() {
  const g = new THREE.Group(); const S = .46, w = .44, d = .42;
  for (const sx of [-1, 1]) { W(g, .045, S - .04, .045, sx * .18, (S - .04) / 2, d / 2 - .04, { grain: 1, mat: M.woodDark }); W(g, .045, .95, .045, sx * .18, .475, -d / 2 + .04, { grain: 1, mat: M.woodDark, rx: -.05 }); }
  W(g, w, .045, d, 0, S - .0225, 0, { r: .014 });
  for (const sz of [-1, 1]) W(g, .34, .03, .025, 0, .16, sz * (d / 2 - .04), { mat: M.woodDark, r: .008 }); for (const sx of [-1, 1]) W(g, .025, .03, .3, sx * .18, .2, 0, { mat: M.woodDark, r: .008 });
  for (const y of [.9, .7]) W(g, .4, y > .8 ? .09 : .05, .03, 0, y, -d / 2 + .02 - (y - S) * .05, { r: .012 });
  for (const x of [-.08, 0, .08]) W(g, .035, .17, .02, x, .8, -d / 2 + .02 - .015, { r: .008, grain: 1 });
  bake(g); g.userData.info = { seat: S }; return g;
}
function table() { const g = new THREE.Group(); W(g, .82, .04, .56, 0, .72, 0, { mat: M.woodLight, r: .012 }); for (const [x, z] of [[-.35, -.22], [.35, -.22], [-.35, .22], [.35, .22]]) W(g, .05, .7, .05, x, .35, z, { mat: M.woodDark, grain: 1 }); for (const sz of [-1, 1]) W(g, .66, .08, .025, 0, .66, sz * .22, { mat: M.woodDark }); for (const sx of [-1, 1]) W(g, .025, .08, .4, sx * .35, .66, 0, { mat: M.woodDark }); return bake(g); }
function mug(mat = M.glazeBlue) { const g = new THREE.Group(); add(g, lathe([[0, .002], [.035, 0], [.04, .01], [.042, .09], [.038, .09], [.036, .012], [0, .012]], 20), mat); add(g, new THREE.TorusGeometry(.024, .007, 8, 16, Math.PI), mat, .042, .05, 0, 0, 0, -Math.PI / 2); return g; }
function candle() { const g = new THREE.Group(); const fm = new THREE.MeshBasicMaterial({ color: 0xFFB050, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }); const fl = new THREE.Mesh(lathe([[0, 0], [.007, .006], [.008, .016], [.004, .03], [0, .038]], 10), fm); fl.position.y = .107; fl.userData.live = true; g.add(fl); g.userData.flame = fm; add(g, lathe([[0, 0], [.05, 0], [.055, .012], [.03, .016], [0, .016]]), M.brass); add(g, new THREE.CylinderGeometry(.018, .018, .09, 14), M.linen, 0, .06, 0); return g; }

// a book: covers on a hinge, page blocks and one page that can turn
function book({ w = .145, h = .205, cover = M.covers[1], open = 1 } = {}) {
  const g = new THREE.Group(); g.userData.live = true; const t = .012;
  const L = new THREE.Group(), Rr = new THREE.Group(); g.add(L, Rr);
  add(L, rb(w + .008, .004, h + .01, .002), cover, -(w + .008) / 2, .002, 0); add(L, rb(w, t, h, .002), M.pageEdge, -w / 2 - .002, .004 + t / 2, 0);
  add(Rr, rb(w + .008, .004, h + .01, .002), cover, (w + .008) / 2, .002, 0); add(Rr, rb(w, t, h, .002), M.pageEdge, w / 2 + .002, .004 + t / 2, 0);
  add(g, new THREE.CylinderGeometry(.012, .012, h + .01, 10, 1, true, 0, Math.PI), cover, 0, .006, 0, Math.PI / 2, 0, Math.PI);
  const pgL = add(L, new THREE.PlaneGeometry(w, h), M.paper, -w / 2 - .002, .004 + t + .0005, 0, -Math.PI / 2); pgL.receiveShadow = true;
  const pgR = add(Rr, new THREE.PlaneGeometry(w, h), M.paper, w / 2 + .002, .004 + t + .0005, 0, -Math.PI / 2);
  const seg = 12; const pg = new THREE.PlaneGeometry(w, h, seg, 1); pg.translate(w / 2, 0, 0); pg.rotateX(-Math.PI / 2);
  const page = add(g, pg, M.paper, .002, .004 + t + .002, 0); page.castShadow = false; page.visible = false;
  const base = pg.attributes.position.array.slice();
  const st = { open, turning: 0, a: 0, page, pageL: pgL, pageR: pgR };
  function setOpen(k) { st.open = k; const a = (1 - k) * (Math.PI / 2 - .02); L.rotation.z = -a; Rr.rotation.z = a; }
  function shapePage(a) { // a: 0 = lying on the right, PI = on the left; the free edge lags and curls
    const p = pg.attributes.position; const c = -.75 * Math.sin(a);
    for (let i = 0; i < p.count; i++) { const u = clamp01(base[i * 3] / w); let x = 0, y = 0; const n = 16; for (let k = 0; k < n; k++) { const uu = (k + .5) / n * u; const phi = a + c * uu * (1.6 - uu); x += Math.cos(phi) * u * w / n; y += Math.sin(phi) * u * w / n; } p.setXYZ(i, x, y, base[i * 3 + 2]); }
    p.needsUpdate = true; pg.computeVertexNormals();
  }
  function turn(dir = 1) { if (st.turning) return false; st.turning = dir; st.a = 0; page.visible = true; shapePage(dir > 0 ? 0 : Math.PI); return true; }
  function update(dt) { if (!st.turning) return; st.a = Math.min(1, st.a + dt / .85); const e = st.a < .5 ? 2 * st.a * st.a : 1 - Math.pow(-2 * st.a + 2, 2) / 2; const a = st.turning > 0 ? e * Math.PI : (1 - e) * Math.PI; shapePage(a); if (st.a >= 1) { st.turning = 0; page.visible = false; } }
  // world position of the corner a hand would lift to turn the page
  function corner(target = V()) { return g.localToWorld(target.set(w * .95, .02, h * .4)); }
  setOpen(open);
  g.userData.book = { setOpen, turn, update, corner, state: st };
  return g;
}
const clamp01 = x => Math.max(0, Math.min(1, x));
function closedBook(w, h, d, mat) { const g = new THREE.Group(); add(g, rb(w, h, d, .004), mat, 0, h / 2, 0); add(g, rb(w - .006, h - .01, d - .004, .002), M.pageEdge, .004, h / 2, 0); for (const y of [.2, .8]) add(g, new THREE.BoxGeometry(.003, .008, d + .002), M.brass, -w / 2, h * y, 0); return g; }

function stove() {
  const g = new THREE.Group(); const Wd = .8, D = .62, legH = .08, top = .9; const ow = Wd - .2, oy0 = .17, oy1 = .66;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, lathe([[0, 0], [.03, 0], [.035, .02], [.025, legH]], 12), M.iron, sx * (Wd / 2 - .06), 0, sz * (D / 2 - .06));
  for (const sx of [-1, 1]) add(g, rb(.1, top - legH - .03, D, .02, 3), M.enamel, sx * (Wd / 2 - .05), legH + (top - legH - .03) / 2, 0);
  add(g, rb(Wd - .18, oy0 - legH, D, .01), M.enamel, 0, legH + (oy0 - legH) / 2, 0);
  add(g, rb(Wd - .18, top - .03 - oy1, D, .01), M.enamel, 0, oy1 + (top - .03 - oy1) / 2, 0);
  add(g, rb(Wd - .18, oy1 - oy0, .04), M.enamel, 0, (oy0 + oy1) / 2, -D / 2 + .02);
  // oven cavity: inside faces only, glowing back wall and a rack
  add(g, new THREE.BoxGeometry(ow, oy1 - oy0, D - .06), M.darkInside, 0, (oy0 + oy1) / 2, .01);
  // fire: two small logs and live teardrop flames at the back of the cavity (flicker in update)
  for (const [x, a] of [[-.06, .35], [.07, -.3]]) add(g, new THREE.CylinderGeometry(.022, .025, ow * .55, 10), M.woodDark, x * .6, oy0 + .03, -D / 2 + .12, 0, a, Math.PI / 2);
  add(g, new THREE.CylinderGeometry(ow * .32, ow * .34, .012, 18), M.fire, 0, oy0 + .006, -D / 2 + .14); // embers bed
  const fire = new THREE.Group(); fire.userData.live = true; fire.position.set(0, oy0 + .03, -D / 2 + .13); g.add(fire);
  const flameGeo = lathe([[0, 0], [.022, .01], [.028, .035], [.02, .07], [.008, .1], [0, .115]], 10);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xFFA040, transparent: true, opacity: .85, blending: THREE.AdditiveBlending, depthWrite: false });
  const flames = []; for (let i = 0; i < 6; i++) { const f = new THREE.Mesh(flameGeo, flameMat); f.position.set(-.13 + i * .052 + rr(-.01, .01), 0, rr(-.03, .03)); f.userData.k = rr(.7, 1.3); f.userData.ph = R() * 6.28; f.userData.live = true; fire.add(f); flames.push(f); }
  // baking tray with buns on the rack
  { const tr = new THREE.Group(); tr.position.set(0, oy0 + .206, .02); g.add(tr); add(tr, rb(ow * .78, .012, D * .55, .004), M.iron, 0, .006, 0); for (let i = 0; i < 4; i++) { const b = add(tr, new THREE.SphereGeometry(.035, 14, 8, 0, 6.283, 0, Math.PI / 2), M.bread, -.13 + i * .087, .012, rr(-.03, .03)); b.scale.y = .7; } }
  for (let i = 0; i < 7; i++) add(g, new THREE.CylinderGeometry(.004, .004, D - .1, 6), M.steel, -ow / 2 + .04 + i * (ow - .08) / 6, oy0 + .2, .02, Math.PI / 2);
  // cooktop, backsplash, burners
  add(g, rb(Wd + .02, .035, D + .02, .01), M.enamelDark, 0, top - .0175, 0);
  add(g, rb(Wd + .02, .16, .04, .012), M.enamel, 0, top + .08, -D / 2 + .01);
  for (const [x, z] of [[-.19, -.12], [.19, -.12], [-.19, .13], [.19, .13]]) {
    add(g, new THREE.CylinderGeometry(.065, .07, .012, 20), M.iron, x, top + .006, z);
    add(g, new THREE.TorusGeometry(.085, .008, 6, 24), M.iron, x, top + .02, z, Math.PI / 2);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 4; add(g, rb(.19, .012, .012, .004), M.iron, x, top + .026, z, 0, a); }
  }
  // control strip and knobs
  add(g, rb(Wd - .06, .1, .03, .01), M.enamelDark, 0, top - .09, D / 2 + .005);
  for (let i = 0; i < 4; i++) { const x = -.27 + i * .18; add(g, lathe([[0, 0], [.022, 0], [.024, .012], [.018, .03], [0, .032]], 16), M.chrome, x, top - .09, D / 2 + .02, Math.PI / 2); add(g, rb(.006, .03, .01, .002), M.rubber, x, top - .09, D / 2 + .055); }
  // oven door on a hinge at its bottom edge
  const door = new THREE.Group(); door.userData.live = true; door.position.set(0, oy0 - .005, D / 2); g.add(door);
  const dh = oy1 - oy0 + .03, dw = Wd - .1;
  add(door, rb(dw, dh, .035, .012, 3), M.enamel, 0, dh / 2, .0175);
  add(door, rb(dw - .16, dh - .17, .012, .006), M.enamelDark, 0, dh / 2 - .015, .036);
  add(door, new THREE.PlaneGeometry(dw - .2, dh - .21), M.ovenGlass, 0, dh / 2 - .015, .0425);
  add(door, new THREE.CylinderGeometry(.011, .011, dw - .14, 12), M.chrome, 0, dh - .05, .075, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) add(door, new THREE.CylinderGeometry(.008, .008, .045, 8), M.chrome, sx * (dw / 2 - .1), dh - .05, .055, Math.PI / 2);
  door.traverse(o => { if (o.isMesh) o.userData.live = true; });
  const glow = add(g, new THREE.PlaneGeometry(.0001, .0001), M.fire, 0, 0, 0); glow.visible = false; void glow; void fire;
  bake(g);
  let openK = 0, heatK = 0;
  g.userData.oven = {
    door, handle: () => door.localToWorld(V(0, dh - .05, .075)), flameMat, fireGroup: fire,
    setOpen(k) { openK = clamp01(k); door.rotation.x = openK * 1.45; }, get open() { return openK; },
    setHeat(k) { M.fire.emissiveIntensity = .25 + 2.2 * k; M.ovenGlass.emissiveIntensity = .1 + .6 * k; heatK = k; },
    flicker(t) { fire.visible = heatK > .05; if (!fire.visible) return; for (const f of flames) { const u = f.userData, n = Math.sin(t * 9 * u.k + u.ph) * .5 + Math.sin(t * 23 * u.k + u.ph * 2) * .3; f.scale.set(1 + n * .12, (.6 + heatK * .7) * (1 + n * .35), 1 + n * .12); f.rotation.z = Math.sin(t * 5 + u.ph) * .12; } flameMat.opacity = .55 + heatK * .4; M.fire.emissiveIntensity = (.25 + 2.2 * heatK) * (.88 + Math.sin(t * 13) * .08 + Math.sin(t * 31) * .05); },
  };
  return g;
}
function kettle() { const g = new THREE.Group(); g.userData.live = true; add(g, lathe([[0, 0], [.08, 0], [.095, .02], [.1, .06], [.09, .11], [.06, .135], [.035, .14], [.035, .145], [0, .145]], 28), M.enamel);
  add(g, lathe([[0, 0], [.038, 0], [.04, .008], [.02, .02], [.012, .032], [0, .036]], 16), M.enamelDark, 0, .142, 0);
  add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(.07, .05, 0), V(.12, .09, 0), V(.15, .14, 0), V(.17, .155, 0)]), 12, .012, 8), M.enamel);
  add(g, new THREE.TorusGeometry(.07, .009, 8, 20, Math.PI), M.rubber, 0, .14, 0); return g; }
function hood(height) { const g = new THREE.Group(); const c = add(g, new THREE.CylinderGeometry(.13, .5, .3, 4, 1, true), M.hood, 0, .15, 0, 0, Math.PI / 4); c.scale.set(1.15, 1, .72); c.material.side = THREE.DoubleSide;
  add(g, rb(.84, .045, .54, .01), M.hood, 0, .0, 0); add(g, rb(.2, height, .18, .01), M.hood, 0, .3 + height / 2, -.04); for (const y of [.33, .3 + height * .5]) add(g, rb(.22, .02, .2, .006), M.iron, 0, y, -.04); return bake(g); }
function sinkCounter() {
  const g = new THREE.Group(); const Wd = .96, D = .6, H = .9;
  W(g, Wd, H - .1, D - .04, 0, .06 + (H - .1) / 2, -.02, { mat: M.wood, grain: 1 }); W(g, Wd - .06, .06, D - .1, 0, .03, -.05, { mat: M.woodDark });
  panelDoor(g, .44, .58, -.235, .44, D / 2 - .04); panelDoor(g, .44, .58, .235, .44, D / 2 - .04); knob(g, -.04, .58, D / 2 - .01); knob(g, .04, .58, D / 2 - .01);
  W(g, .9, .1, .02, 0, H - .14, D / 2 - .03, { mat: M.wood });
  // countertop with a cut for the sink (two slabs and front/back strips)
  const sx0 = .02, sx1 = .44; W(g, sx0 + Wd / 2 + .02, .05, D + .03, (-Wd / 2 - .02 + sx0) / 2, H - .025, 0, { mat: M.woodLight }); W(g, Wd / 2 + .02 - sx1, .05, D + .03, (sx1 + Wd / 2 + .02) / 2, H - .025, 0, { mat: M.woodLight }); W(g, sx1 - sx0, .05, .12, (sx0 + sx1) / 2, H - .025, -D / 2 + .045, { mat: M.woodLight });
  // farmhouse basin
  const bx = (sx0 + sx1) / 2, bw = sx1 - sx0, bd = D - .1, bz = .04;
  add(g, rb(bw, .025, bd, .01), M.ceramic, bx, H - .2, bz); for (const s of [-1, 1]) add(g, rb(.03, .2, bd, .012), M.ceramic, bx + s * (bw / 2 - .015), H - .1, bz); add(g, rb(bw, .2, .03, .012), M.ceramic, bx, H - .1, bz - bd / 2 + .015); add(g, rb(bw + .02, .24, .045, .018, 3), M.ceramic, bx, H - .12, bz + bd / 2);
  add(g, new THREE.CylinderGeometry(.022, .022, .004, 16), M.steel, bx, H - .185, bz);
  // faucet
  const fz = -D / 2 + .07; add(g, new THREE.CylinderGeometry(.022, .026, .03, 14), M.chrome, bx, H + .015, fz);
  add(g, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, .2, 0), V(0, .27, .05), V(0, .25, .13), V(0, .2, .15)]), 24, .012, 10), M.chrome, bx, H + .02, fz);
  for (const s of [-1, 1]) { add(g, new THREE.CylinderGeometry(.008, .01, .05, 10), M.chrome, bx + s * .08, H + .025, fz); for (const a of [0, Math.PI / 2]) add(g, rb(.05, .008, .008, .003), M.chrome, bx + s * .08, H + .05, fz, 0, a); add(g, new THREE.SphereGeometry(.009, 10, 8), M.ceramic, bx + s * .08, H + .056, fz); }
  // on the counter: cutting board with bread, jar, canister
  add(g, new THREE.CylinderGeometry(.13, .13, .02, 28), M.woodLight, -.27, H + .01, .02); const br = add(g, new THREE.SphereGeometry(1, 20, 12), M.bread, -.27, H + .045, .02); br.scale.set(.09, .045, .06);
  add(g, lathe([[0, 0], [.06, 0], [.075, .05], [.07, .13], [.045, .17], [.04, .19], [0, .19]], 22), M.glazeCream, -.38, H, -.2); add(g, lathe([[0, 0], [.048, 0], [.05, .01], [.03, .03], [0, .034]], 16), M.glazeCream, -.38, H + .19, -.2);
  add(g, lathe([[0, 0], [.045, 0], [.047, .11], [.035, .12], [0, .12]], 18), M.glazeBlue, -.12, H, -.2);
  bake(g); g.userData.info = { top: H }; return g;
}
function fridge() {
  const g = new THREE.Group(); const Wd = .64, D = .6, H = 1.58, split = 1.02;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, new THREE.CylinderGeometry(.025, .03, .05, 10), M.rubber, sx * (Wd / 2 - .07), .025, sz * (D / 2 - .08));
  add(g, rb(Wd, H - .05, D - .05, .09, 5), M.fridge, 0, .05 + (H - .05) / 2, -.025);
  add(g, rb(Wd - .01, split - .07, .06, .05, 4), M.fridge, 0, .06 + (split - .07) / 2, D / 2 - .05);
  add(g, rb(Wd - .01, H - split - .02, .06, .07, 4), M.fridge, 0, split + (H - split - .02) / 2, D / 2 - .05);
  add(g, rb(Wd - .04, .012, .02, .004), M.rubber, 0, split - .006, D / 2 - .07);
  const hd = (y0, y1) => { const x = -Wd / 2 + .07, z = D / 2 + .035; add(g, rb(.035, y1 - y0, .03, .014, 3), M.chrome, x, (y0 + y1) / 2, z + .02); for (const y of [y0 + .02, y1 - .02]) add(g, rb(.03, .03, .04, .01), M.chrome, x, y, z); };
  hd(split - .3, split - .06); hd(split + .05, split + .27);
  for (const y of [.25, split - .2, split + .15, H - .15]) add(g, rb(.03, .07, .03, .01), M.chrome, Wd / 2 - .02, y, D / 2 - .03);
  add(g, rb(.14, .025, .006, .006), M.chrome, .1, H - .12, D / 2 - .016);
  return bake(g);
}
function barrel(h = .78, mat) { const g = new THREE.Group(); const r0 = h * .3, b = h * .055; const pts = []; for (let i = 0; i <= 12; i++) { const y = i / 12 * h; pts.push([r0 + b * Math.sin(Math.PI * i / 12), y]); } pts.push([r0 - .02, h], [r0 - .02, h - .03], [0, h - .03]);
  add(g, lathe([[0, 0], ...pts], 32), mat || M.stave); add(g, new THREE.CylinderGeometry(r0 - .02, r0 - .02, .01, 32), M.staveDark, 0, h - .03, 0);
  for (const t of [.1, .3, .7, .9]) { const y = t * h, r = r0 + b * Math.sin(Math.PI * t) + .006; const tor = add(g, new THREE.TorusGeometry(r, .012, 6, 40), M.iron, 0, y, 0, Math.PI / 2); tor.scale.z = 1.8; } return bake(g); }
function bucket(h = .36, metal = false) { const g = new THREE.Group(); const r0 = h * .5, r1 = h * .62; add(g, lathe([[0, 0], [r0, 0], [r1, h], [r1 - .012, h], [r0 - .012, .015], [0, .015]], 28), metal ? M.steel : M.stave);
  for (const t of metal ? [.97] : [.15, .8]) { const r = r0 + (r1 - r0) * t + .004; const tor = add(g, new THREE.TorusGeometry(r, metal ? .008 : .01, 6, 32), metal ? M.steel : M.iron, 0, h * t, 0, Math.PI / 2); if (!metal) tor.scale.z = 1.6; }
  add(g, new THREE.TorusGeometry(r1, .004, 6, 24, Math.PI), M.iron, 0, h, 0, 0, Math.PI / 2, 0); return bake(g); }
const RUG_IMG = { check: 'rug-blue.jpg', orange: 'rug-orange.jpg', green: 'rug-green.jpg' };
function rug(w, d, kind, fringe) { const g = new THREE.Group(); const t = upgrade(texOf(rugCanvas(kind)), RUG_IMG[kind]); if (kind === 'check') t.repeat.set(w / .7, d / .7); const m = new THREE.MeshStandardMaterial({ map: t, roughness: 1 }); add(g, rb(w, .012, d, .004), m, 0, .006, 0).castShadow = false;
  if (fringe) { const fm = new THREE.MeshStandardMaterial({ map: texOf(fringeCanvas(fringe)), transparent: true, alphaTest: .4, roughness: 1, side: THREE.DoubleSide }); fm.map.repeat.set(w * 6, 1); for (const s of [-1, 1]) add(g, new THREE.PlaneGeometry(w * .96, .06), fm, 0, .004, s * (d / 2 + .03), -Math.PI / 2, 0, s > 0 ? 0 : Math.PI).castShadow = false; }
  g.traverse(o => { if (o.isMesh) o.receiveShadow = true; }); return g; }
function wallShelf(w, { brackets = true, mat = M.woodLight } = {}) { const g = new THREE.Group(); W(g, w, .035, .24, 0, 0, .12, { mat }); if (brackets) for (const s of [-1, 1]) { const sh = new THREE.Shape(); sh.moveTo(0, 0); sh.lineTo(.18, 0); sh.quadraticCurveTo(.06, -.04, 0, -.17); sh.lineTo(0, 0); const e = new THREE.ExtrudeGeometry(sh, { depth: .03, bevelEnabled: true, bevelSize: .004, bevelThickness: .004, bevelSegments: 2 }); add(g, e, M.woodDark, s * (w / 2 - .08) - .015, -.018, .01, 0, -Math.PI / 2, 0); } return g; }
function jar(h, r, mat) { const g = new THREE.Group(); add(g, lathe([[0, 0], [r, 0], [r * 1.05, h * .1], [r * 1.05, h * .8], [r * .8, h * .9], [r * .8, h], [0, h]], 18), mat); add(g, new THREE.CylinderGeometry(r * .85, r * .85, h * .12, 18), M.woodDark, 0, h + h * .04, 0); return g; }
function can(h, r, mat) { const g = new THREE.Group(); add(g, new THREE.CylinderGeometry(r, r, h, 20), mat, 0, h / 2, 0); for (const y of [.003, h - .003]) add(g, new THREE.TorusGeometry(r, .003, 4, 20), M.steel, 0, y, 0, Math.PI / 2); return g; }
function picture(w, h) { const g = new THREE.Group(); for (const [ww, hh, x, y] of [[w, .035, 0, h / 2], [w, .035, 0, -h / 2], [.035, h, w / 2, 0], [.035, h, -w / 2, 0]]) W(g, ww, hh, .03, x, y, .015, { mat: M.woodDark, r: .008 }); add(g, new THREE.PlaneGeometry(w - .03, h - .03), M.picture, 0, 0, .012); return bake(g); }
function lanternHousing(rod) { const g = new THREE.Group(); const s = .17, h = .2; add(g, new THREE.CylinderGeometry(.02, s * .78, .08, 4), M.iron, 0, h / 2 + .04, 0, 0, Math.PI / 4); add(g, new THREE.CylinderGeometry(s * .5, s * .5, .02, 4), M.iron, 0, -h / 2 - .01, 0, 0, Math.PI / 4);
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) add(g, new THREE.BoxGeometry(.012, h, .012), M.iron, x * s * .35, 0, z * s * .35);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; add(g, new THREE.PlaneGeometry(s * .7, h * .95), M.glass, Math.sin(a) * s * .35, 0, Math.cos(a) * s * .35, 0, a); }
  add(g, new THREE.TorusGeometry(.025, .005, 6, 16), M.iron, 0, h / 2 + .09, 0); add(g, new THREE.CylinderGeometry(.006, .006, rod, 6), M.iron, 0, h / 2 + .1 + rod / 2, 0); return g; }
function domeShade(rod) { const g = new THREE.Group(); const m = add(g, lathe([[.2, 0], [.19, .03], [.14, .1], [.07, .15], [.035, .17], [0, .18]], 28), M.enamelDark); m.material = M.enamelDark; const inner = add(g, lathe([[.19, .002], [.14, .095], [.07, .145], [0, .17]], 28), new THREE.MeshStandardMaterial({ color: 0xF0E2C0, roughness: .6, side: THREE.BackSide, emissive: 0xFFC27A, emissiveIntensity: 0 }));
  g.userData.inner = inner.material; inner.userData.live = true; add(g, new THREE.CylinderGeometry(.006, .006, rod, 6), M.iron, 0, .18 + rod / 2, 0); add(g, new THREE.TorusGeometry(.2, .008, 6, 32), M.iron, 0, 0, 0, Math.PI / 2); return g; }
function plankDoor(h = 2.0, w = .86) { const g = new THREE.Group(); const n = 5, pw = w / n; for (let i = 0; i < n; i++) W(g, pw - .008, h - .01, .045, -w / 2 + pw * (i + .5), h / 2, 0, { mat: M.wood, r: .01, grain: 1 });
  for (const y of [.35, h - .35]) W(g, w - .06, .12, .03, 0, y, -.035, { mat: M.woodDark }); for (const [ww, hh, x, y] of [[.09, h + .09, -w / 2 - .045, h / 2], [.09, h + .09, w / 2 + .045, h / 2], [w + .18, .09, 0, h + .045]]) W(g, ww, hh, .07, x, y, .01, { mat: M.woodDark });
  for (const y of [.35, h - .35]) { add(g, rb(.2, .035, .008, .004), M.iron, w / 2 - .1, y, .027); for (const k of [0, 1, 2]) screw(g, w / 2 - .17 + k * .06, y, .032); }
  add(g, rb(.05, .16, .012, .006), M.brass, -w / 2 + .1, h * .48, .028); knob(g, -w / 2 + .1, h * .46, .03, M.brass, .022); return bake(g); }
function switchPlate() { const g = new THREE.Group(); add(g, rb(.08, .12, .012, .006), M.ceramic, 0, 0, .006); add(g, rb(.018, .035, .02, .004), M.ceramic, 0, 0, .014); return g; }

// ------------- workshop -------------
function workbench() {
  const g = new THREE.Group(); const L = 1.7, D = .66, H = .9; const info = {};
  for (let i = 0; i < 3; i++) W(g, L, .065, D / 3 - .006, 0, H - .0325, -D / 2 + (i + .5) * D / 3, { mat: M.woodLight, r: .01 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W(g, .085, H - .065, .085, sx * (L / 2 - .1), (H - .065) / 2, sz * (D / 2 - .08), { mat: M.wood, grain: 1 });
  for (const sz of [-1, 1]) { W(g, L - .2, .11, .04, 0, H - .12, sz * (D / 2 - .06), { mat: M.wood }); W(g, L - .2, .07, .05, 0, .17, sz * (D / 2 - .08), { mat: M.wood }); }
  for (let i = 0; i < 4; i++) W(g, L - .24, .025, (D - .2) / 4 - .01, 0, .215, -D / 2 + .1 + (i + .5) * (D - .2) / 4, { mat: M.woodDark, r: .006 });
  // things on the lower shelf
  { const b = new THREE.Group(); b.position.set(.35, .23, 0); g.add(b); W(b, .36, .14, .22, 0, .07, 0, { mat: M.woodDark }); add(b, new THREE.CylinderGeometry(.01, .01, .3, 8), M.iron, 0, .2, 0, 0, 0, Math.PI / 2); for (const s of [-1, 1]) W(b, .02, .2, .02, s * .15, .15, 0, { mat: M.woodDark, grain: 1 }); }
  add(g, lathe([[0, 0], [.12, 0], [.12, .1], [0, .1]]), M.steel, -.4, .228, .02);
  // front vice at the left end
  { const v = new THREE.Group(); v.position.set(-L / 2 + .22, H - .06, D / 2); g.add(v); add(v, rb(.24, .11, .05, .01), M.iron, 0, -.02, .025); W(v, .26, .1, .045, 0, -.02, .08, { mat: M.woodDark }); add(v, new THREE.CylinderGeometry(.014, .014, .18, 10), M.steel, 0, -.03, .14, Math.PI / 2); add(v, new THREE.CylinderGeometry(.01, .01, .22, 8), M.steel, 0, -.03, .23, 0, 0, Math.PI / 2); for (const s of [-1, 1]) add(v, new THREE.SphereGeometry(.018, 10, 8), M.steel, s * .11, -.03, .23); }
  // on top: plans, a tin of screwdrivers, a box of nails, a block plane
  add(g, new THREE.PlaneGeometry(.42, .3), M.plan, -.05, H + .002, .05, -Math.PI / 2, 0, .12);
  { const t = can(.13, .045, M.cans[1]); t.position.set(.62, H, -.2); g.add(t); for (let i = 0; i < 4; i++) { const sd = screwdriver([M.gripRed, M.gripYellow, M.gripBlue, M.gripRed][i], .17); sd.position.set(.62 + Math.cos(i * 1.6) * .02, H + .05, -.2 + Math.sin(i * 1.6) * .02); sd.rotation.set(rr(-.2, .2), 0, rr(-.25, .25)); g.add(sd); } }
  { const b = new THREE.Group(); b.position.set(.35, H, -.18); g.add(b); W(b, .16, .05, .1, 0, .025, 0, { mat: M.woodDark, r: .006 }); for (let i = 0; i < 10; i++) add(b, new THREE.CylinderGeometry(.002, .002, .05, 5), M.steel, rr(-.06, .06), .05, rr(-.035, .035), rr(-.6, .6), 0, Math.PI / 2 + rr(-.3, .3)); }
  { const p = new THREE.Group(); p.position.set(-.5, H, -.15); p.rotation.y = .4; g.add(p); W(p, .22, .05, .06, 0, .025, 0, { mat: M.woodRed, r: .012 }); add(p, rb(.12, .04, .05, .015), M.iron, -.01, .065, 0); add(p, new THREE.SphereGeometry(.02, 10, 8), M.woodRed, .07, .07, 0); }
  bake(g); g.userData.info = { top: H }; return g;
}
function stool(S = .48) { const g = new THREE.Group(); add(g, lathe([[0, 0], [.15, 0], [.165, .008], [.172, .024], [.166, .04], [.15, .048], [0, .048]], 32), M.wood, 0, S - .048, 0);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const l = add(g, new THREE.CylinderGeometry(.022, .018, S - .03, 10), M.woodDark, Math.cos(a) * .12, (S - .03) / 2, Math.sin(a) * .12); l.rotation.set(Math.sin(a) * .13, 0, -Math.cos(a) * .13); }
  const ring = add(g, new THREE.TorusGeometry(.14, .011, 6, 28), M.woodDark, 0, .17, 0, Math.PI / 2); void ring; bake(g); g.userData.info = { seat: S }; return g; }
// ---- tools: built with their handle along +y and the grip point at the origin region ----
const EX = (sh, depth, bev = .003) => { const e = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelSize: bev, bevelThickness: bev, bevelSegments: 2, curveSegments: 18 }); e.translate(0, 0, -depth / 2); return e; };
function roundRect(w, h, r) { const s = new THREE.Shape(); s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r); s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2); s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2); return s; }
function wrench(len = .26) {
  const g = new THREE.Group(); const R0 = len * .12, t = len * .05, hw = len * .095;
  // open jaw head at the top
  const s = R0 * .42, yt = Math.sqrt(R0 * R0 - s * s); const head = new THREE.Shape(); head.moveTo(s, yt); head.absarc(0, 0, R0, Math.atan2(yt, s), Math.atan2(yt, -s), true); head.lineTo(-s, -R0 * .05); head.absarc(0, -R0 * .05, s, Math.PI, 2 * Math.PI, false); head.lineTo(s, yt);
  add(g, EX(head, t), M.steel, 0, len / 2, 0, 0, 0, .3);
  // box end with a hole at the bottom
  const ring = new THREE.Shape(); ring.absarc(0, 0, R0 * .82, 0, Math.PI * 2, false); const hole = new THREE.Path(); hole.absarc(0, 0, R0 * .48, 0, Math.PI * 2, true); ring.holes.push(hole);
  add(g, EX(ring, t * .9), M.steel, 0, -len / 2, 0);
  add(g, EX(roundRect(hw, len - R0 * 1.6, hw * .45), t * .7), M.steel, 0, 0, 0);
  add(g, EX(roundRect(hw * .45, len * .5, hw * .2), t * .3, .001), M.chrome, 0, 0, t * .45);
  g.userData.grip = V(0, -len * .05, 0); return g;
}
function hammer() { const g = new THREE.Group(); add(g, lathe([[0, -.15], [.014, -.15], [.017, -.12], [.015, 0], [.012, .1], [.014, .14], [0, .14]], 14), M.woodRed); add(g, rb(.12, .035, .035, .008), M.iron, .02, .155, 0); add(g, new THREE.CylinderGeometry(.022, .02, .035, 16), M.iron, .085, .155, 0, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) add(g, new THREE.TorusGeometry(.05, .008, 6, 12, Math.PI * .45), M.iron, -.03, .115, s * .009, 0, 0, Math.PI * .55); g.userData.grip = V(0, -.07, 0); return g; }
function screwdriver(mat, len = .2) { const g = new THREE.Group(); const hl = len * .45; add(g, lathe([[0, 0], [.012, 0], [.016, hl * .2], [.016, hl * .8], [.011, hl], [0, hl]], 16), mat, 0, -hl, 0); add(g, new THREE.CylinderGeometry(.0035, .0035, len - hl, 8), M.steel, 0, (len - hl) / 2, 0); add(g, rb(.009, .012, .002, .0008), M.steel, 0, len - hl + .004, 0); g.userData.grip = V(0, -hl / 2, 0); return g; }
function pliers() { const g = new THREE.Group(); for (const s of [-1, 1]) { const h = new THREE.Group(); h.rotation.z = s * .12; g.add(h); add(h, rb(.012, .11, .008, .003), M.steel, 0, .03, 0); add(h, new THREE.CylinderGeometry(.009, .007, .1, 10), M.gripRed, s * -.004, -.07, 0); add(h, rb(.012, .06, .01, .004), M.steel, 0, .11, 0, 0, 0, -s * .14); } add(g, new THREE.CylinderGeometry(.012, .012, .016, 14), M.steel, 0, .085, 0, Math.PI / 2); g.userData.grip = V(0, -.07, 0); return g; }
function saw() { const g = new THREE.Group(); const sh = new THREE.Shape(); sh.moveTo(0, -.05); sh.lineTo(.44, -.03); for (let x = .44; x > 0; x -= .016) sh.lineTo(x - .008, -.03 - .012 * (1 - x / .44) - .012); sh.lineTo(0, -.11); sh.lineTo(0, -.05);
  const b = add(g, new THREE.ShapeGeometry(sh), M.steel, .02, 0, 0); b.material = M.steel; add(g, new THREE.ShapeGeometry(sh), M.steel, .02, 0, -.0005, 0, Math.PI, 0).scale.x = -1;
  const hs = roundRect(.13, .13, .03); const hole = new THREE.Path(); hole.absellipse(-.01, .01, .03, .042, 0, Math.PI * 2, true); hs.holes.push(hole); add(g, EX(hs, .025), M.woodRed, -.04, -.06, 0); for (const y of [-.04, -.08]) screw(g, .015, y, .015); g.userData.grip = V(-.04, -.06, 0); return g; }
function toolWall() {
  const g = new THREE.Group(); const Wd = 1.4, H = .78; const tools = {};
  for (let i = 0; i < 3; i++) W(g, Wd, H / 3 - .012, .035, 0, (i + .5) * H / 3, 0, { mat: M.wood, r: .008 });
  for (const [w, h, x, y] of [[Wd + .08, .06, 0, H + .02], [Wd + .08, .06, 0, -.02], [.06, H + .1, Wd / 2 + .01, H / 2], [.06, H + .1, -Wd / 2 - .01, H / 2]]) W(g, w, h, .05, x, y, .01, { mat: M.woodDark, r: .01 });
  const peg = (x, y) => add(g, new THREE.CylinderGeometry(.007, .007, .05, 8), M.woodDark, x, y, .04, Math.PI / 2);
  const hang = (name, obj, x, y, rz = 0, s = 1.3) => { obj.position.set(x, y, .045); obj.rotation.z = rz; obj.scale.setScalar(s); obj.userData.live = true; g.add(obj); tools[name] = obj; };
  // big wrench on the left, a row of spanners, hammer, saw, screwdrivers, pliers, adjustable bar
  hang('wrenchBig', wrench(.36), -.58, .4, .08); peg(-.58, .66);
  [.22, .2, .18, .16, .14].forEach((l, i) => { hang('wrench' + (i + 1), wrench(l), -.38 + i * .1, .55 + (.22 - l) * .65, 0); peg(-.38 + i * .1, .72); });
  hang('hammer', hammer(), .17, .5, 0); peg(.17, .74);
  hang('saw', saw(), .42, .74, -Math.PI / 2 + .02); peg(.38, .74);
  ['gripRed', 'gripYellow', 'gripBlue'].forEach((c, i) => { hang('screwdriver' + (i + 1), screwdriver(M[c], .2), -.36 + i * .08, .2, Math.PI); });
  add(g, rb(.3, .02, .05, .006), M.woodDark, -.28, .3, .04);
  hang('pliers', pliers(), -.02, .2, 0); peg(-.02, .33);
  hang('wrenchLong', wrench(.3), .3, .16, Math.PI / 2 - .1);
  bake(g); return { g, tools };
}
function workshopShelves(w = .95) { const g = new THREE.Group(); const levels = [0, .42, .84];
  for (const y of levels) { const s = wallShelf(w); s.position.y = y; g.add(s); }
  // books, jars, cans, a box
  let x = -w / 2 + .06; for (let i = 0; i < 6; i++) { const bw = rr(.025, .045), bh = rr(.17, .23); const b = closedBook(bw, bh, .16, M.covers[i % M.covers.length]); b.position.set(x + bw / 2, .84 + .018, .12); b.rotation.z = i === 5 ? -.25 : 0; g.add(b); x += bw + .004; }
  { const j = jar(.12, .045, M.jarGlass); j.position.set(.25, .858, .12); g.add(j); const c = can(.1, .04, M.cans[0]); c.position.set(.36, .858, .1); g.add(c); }
  [[-.3, M.cans[2]], [-.18, M.cans[3]], [.05, M.cans[1]]].forEach(([x, m]) => { const c = can(rr(.08, .12), rr(.035, .045), m); c.position.set(x, .438, .12); g.add(c); });
  { const j = jar(.1, .05, M.jarGlass); j.position.set(.28, .438, .12); g.add(j); }
  W(g, .22, .1, .16, -.25, .018 + .05, .12, { mat: M.woodRed }); { const j = jar(.09, .04, M.glazeBlue); j.position.set(.05, .018, .12); g.add(j); } { const c = can(.13, .05, M.cans[3]); c.position.set(.25, .018, .12); g.add(c); }
  return bake(g); }

function sideBench() {
  const g = new THREE.Group(); const L = 1.0, D = .42, H = .78;
  W(g, L, .05, D, 0, H - .025, 0, { mat: M.woodLight, r: .01 }); W(g, L - .02, .045, D - .02, 0, .14, 0, { mat: M.woodDark, r: .008 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) W(g, .06, H - .05, .06, sx * (L / 2 - .05), (H - .05) / 2, sz * (D / 2 - .05), { mat: M.wood, grain: 1 });
  W(g, L - .1, .08, .03, 0, H - .09, D / 2 - .03, { mat: M.wood });
  // on top: pencil cup, jars of screws, a small toolbox, an oil can, a rag
  { const c = can(.11, .035, M.cans[2]); c.position.set(.36, H, .05); g.add(c); for (let i = 0; i < 5; i++) { const pc = add(g, new THREE.CylinderGeometry(.004, .004, .15, 6), [M.gripYellow, M.gripRed, M.gripBlue][i % 3], .36 + rr(-.015, .015), H + .14, .05 + rr(-.015, .015), rr(-.2, .2), 0, rr(-.2, .2)); void pc; } }
  for (const [x, z, h] of [[.18, -.08, .1], [.07, -.1, .08]]) { const j = jar(h, .035, M.jarGlass); j.position.set(x, H, z); g.add(j); }
  { const b = new THREE.Group(); b.position.set(-.2, H, -.02); b.rotation.y = .15; g.add(b); add(b, rb(.26, .1, .14, .01), M.gripRed, 0, .05, 0); add(b, rb(.27, .015, .15, .006), M.iron, 0, .1, 0); add(b, new THREE.TorusGeometry(.04, .007, 6, 14, Math.PI), M.iron, 0, .108, 0); }
  { const o = new THREE.Group(); o.position.set(-.4, H, .08); g.add(o); add(o, lathe([[0, 0], [.04, 0], [.042, .05], [.02, .08], [.006, .09], [.004, .17], [0, .17]], 18), M.copper); }
  { const r = add(g, drapeGeo(.18, .12, .02, { wrinkle: .006 }), M.clothBlue, .02, H + .002, .1); r.rotation.y = .5; }
  // under-shelf crate with offcuts
  { const b = new THREE.Group(); b.position.set(-.15, .165, 0); g.add(b); W(b, .4, .16, .3, 0, .08, 0, { mat: M.woodDark }); for (let i = 0; i < 4; i++) W(b, rr(.25, .38), .03, .05, rr(-.03, .03), .17 + i * .01, -.1 + i * .065, { mat: M.woodLight, ry: rr(-.15, .15) }); }
  bake(g); g.userData.info = { top: H }; return g;
}

// ------------- deck -------------
function telescope() {
  const g = new THREE.Group(); const top = 1.08;
  for (let i = 0; i < 3; i++) { const l = new THREE.Group(); l.position.set(0, top, 0); l.rotation.y = i * Math.PI * 2 / 3 + .4; g.add(l); W(l, .035, 1.16, .025, 0, -.55, .19, { mat: M.woodDark, grain: 1, r: .008, rx: -.33 }); add(l, rb(.04, .025, .035, .008), M.brass, 0, -.02, .02); }
  add(g, new THREE.CylinderGeometry(.05, .06, .05, 20), M.brass, 0, top, 0);
  add(g, new THREE.CylinderGeometry(.012, .012, .3, 8), M.brass, 0, top - .25, 0); // centre column
  const yoke = new THREE.Group(); yoke.position.set(0, top + .05, 0); g.add(yoke);
  for (const s of [-1, 1]) add(yoke, rb(.015, .1, .03, .006), M.brass, 0, .05, s * .06);
  const tube = new THREE.Group(); tube.position.set(0, .1, 0); tube.rotation.z = .38; yoke.add(tube); tube.userData.live = true;
  const prof = [[0, -.42], [.02, -.42], [.02, -.36], [.03, -.355], [.03, -.25], [.038, -.24], [.038, -.2], [.045, -.19], [.046, .25], [.054, .26], [.054, .3], [.058, .32], [.058, .5], [.062, .51], [.062, .53], [.054, .53], [.054, .52], [0, .52]];
  const tg = lathe(prof.map(([r, y]) => [r, y]), 28); tg.rotateZ(-Math.PI / 2); add(tube, tg, M.brass);
  for (const x of [-.19, .25, .32]) add(tube, new THREE.TorusGeometry(x > 0 ? .056 : .046, .005, 6, 24), M.copper, x, 0, 0, 0, Math.PI / 2);
  add(tube, new THREE.CircleGeometry(.052, 24), new THREE.MeshStandardMaterial({ color: 0x1A2A3A, roughness: .05, metalness: .2, envMap: M.env, envMapIntensity: 1.5 }), .515, 0, 0, 0, Math.PI / 2);
  add(tube, new THREE.CylinderGeometry(.012, .012, .14, 8), M.brass, 0, 0, 0, Math.PI / 2);
  add(tube, lathe([[0, 0], [.024, 0], [.026, .012], [.022, .05], [0, .05]], 18), M.rubber, -.47, 0, 0, 0, 0, Math.PI / 2); // eyepiece cup
  { const f = lathe([[0, -.09], [.011, -.09], [.011, .07], [.016, .08], [.016, .1], [0, .1]], 14); f.rotateZ(-Math.PI / 2); add(tube, f, M.brass, .1, .07, 0); for (const x of [.04, .16]) add(tube, rb(.012, .025, .01, .003), M.brass, x, .052, 0); }
  bake(g); g.userData.tube = tube; return g;
}

// ================= placement =================
export function buildProps(ctx) {
  let shiftRooms = () => {}, candleObj = null;
  const { scene, renderer, OBST, floors = [], L } = ctx; const { KT, BD, WS, DK, LL } = L;
  makeMaterials(renderer);
  const rc = new THREE.Raycaster();
  // put an object on the real floor top (boards are 7 cm thick, their top is not the level value)
  const floorAt = (x, y, z) => { rc.set(V(x + roomDx(x, y), y + .4, z), V(0, -1, 0)); rc.far = .7; const h = floors.length ? rc.intersectObjects(floors, false)[0] : null; return h ? h.point.y : y + .035; };
  const placed = {};
  // room offsets from the house builder: L.dxL moves the left rooms (kitchen, bedroom), L.dxR the workshop.
  // Everything below is written in the original coordinates and shifted at the end (see shiftRooms).
  const nScene0 = scene.children.length, nObst0 = OBST.length;
  shiftRooms = () => {
    for (let i = nScene0; i < scene.children.length; i++) { const o = scene.children[i]; const dx = roomDx(o.position.x, o.position.y); if (!dx) continue; o.position.x += dx; o.updateMatrixWorld(true); if (o.userData.box) o.userData.box.translate(V(dx, 0, 0)); if (o.userData.home) o.userData.home.pos.x += dx; }
    for (let i = nObst0; i < OBST.length; i++) { const b = OBST[i]; const dx = roomDx((b.x0 + b.x1) / 2, b.y); b.x0 += dx; b.x1 += dx; }
  };
  const roomDx = (x, y) => (x < .8 && y > KT - .3 && y < DK + 1) ? (L.dxL || 0) : (x > .8 && y > WS - .3 && y < KT + 1.2) ? (L.dxR || 0) : 0;
  function place(name, g, x, y, z, { ry = 0, solid = true, seat = false, floor = true, wall = false } = {}) {
    const fy = floor && !wall ? floorAt(x, y, z) : y; g.position.set(x, fy, z); g.rotation.y = ry; g.traverse(o => { if (o.isMesh) { o.castShadow = o.castShadow !== false; } }); scene.add(g); g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g); g.userData.box = b; g.userData.floorY = fy; g.name = name; if (solid && !wall) OBST.push({ x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y, seat, n: name }); placed[name] = g; return g;
  }
  const out = { objects: placed, tools: {}, surfaces: {} };

  // ---------- kitchen (back wall z≈1.05, open front +z) ----------
  const st = place('stove', stove(), -3.25, KT, 1.4); out.oven = st.userData.oven;
  const ket = kettle(); ket.position.set(-.19, .91, -.12); st.add(ket); out.tools.kettle = ket; ket.userData.home = { parent: st, pos: ket.position.clone(), quat: ket.quaternion.clone() };
  place('hood', hood(Math.max(.2, (BD - .2) - (KT + 1.42) - .3)), -3.25, KT + 1.42, 1.32, { solid: false, wall: true });
  place('counter', sinkCounter(), -2.3, KT, 1.38);
  place('fridge', fridge(), -1.43, KT, 1.38);
  place('picture', picture(.34, .26), -1.45, KT + 1.92, 1.06, { solid: false, wall: true });
  { const s = wallShelf(.86); const items = [[-.3, jar(.14, .05, M.glazeCream)], [-.15, jar(.11, .045, M.jarGlass)], [0, can(.12, .045, M.cans[0])], [.14, jar(.09, .04, M.glazeBlue)], [.28, mug(M.glazeCream)]]; for (const [x, o] of items) { o.position.set(x, .018, .12); s.add(o); } bake(s); place('kshelf', s, -2.3, KT + 1.97, 1.04, { solid: false, wall: true }); }
  place('kbarrel', barrel(.78), -4.0, KT, 3.0);
  place('kbucket', bucket(.34), -3.55, KT, 3.28);
  place('krug', rug(1.7, 1.0, 'orange'), -2.6, KT, 2.72, { solid: false });
  place('klamp', lanternHousing(Math.max(.05, (BD - .15) - (KT + 1.78) - .2)), -2.3, KT + 1.78, 1.75, { solid: false, wall: true });

  // ---------- bedroom ----------
  const bunk = place('bunkbed', bunkBed(), -2.4, BD, 1.71, { seat: true });
  place('slippers', slippers(), -2.95, BD, 2.32, { solid: false, ry: .2 });
  place('basket', basket(), -1.05, BD, 1.18); // by the bed head against the back wall, clear of the ladder exit and walkways
  const chairO = place('chair', chair(), -.58, BD, 2.3, { ry: Math.PI, seat: true }); out.surfaces.chairSeat = chairO.userData.floorY + chairO.userData.info.seat;
  const tbl = place('table', table(), -.35, BD, 1.45); const tTop = tbl.userData.floorY + .74;
  const bk = book({ cover: M.covers[0] }); bk.position.set(-.33, tTop, 1.6); bk.rotation.y = 0; scene.add(bk); out.book = bk.userData.book; out.book.obj = bk; out.tools.book = bk; bk.userData.home = { parent: scene, pos: bk.position.clone(), quat: bk.quaternion.clone() };
  { const m = mug(M.glazeBlue); m.position.set(-.06, tTop, 1.35); scene.add(m); const c = candle(); c.position.set(-.62, tTop, 1.32); scene.add(c); candleObj = c; const st2 = new THREE.Group(); st2.position.set(-.62, tTop, 1.6); for (let i = 0; i < 3; i++) { const b = closedBook(.03, .16 - i * .012, .21 - i * .012, M.covers[(i + 2) % 7]); b.rotation.z = Math.PI / 2; b.position.set(.08 - i * .006, .015 + .03 * i, 0); b.rotation.y = rr(-.15, .15); st2.add(b); } scene.add(st2); bake(st2); }
  place('door', plankDoor(2.0), .33, BD, 1.82, { ry: -Math.PI / 2, solid: false });
  { const s = switchPlate(); s.position.set(.37, BD + 1.15, 2.5); s.rotation.y = -Math.PI / 2; scene.add(s); }
  place('brug', rug(1.8, 1.05, 'check', '#D8CFBD'), -2.0, BD, 2.85, { solid: false });
  { const s = wallShelf(.7); for (let i = 0, x = -.28; i < 7; i++) { const bw = rr(.025, .04); const b = closedBook(bw, rr(.16, .22), .15, M.covers[i]); b.position.set(x + bw / 2, .018, .12); s.add(b); x += bw + .003; } const j = jar(.1, .04, M.glazeCream); j.position.set(.22, .018, .12); s.add(j); bake(s); place('bshelf', s, -.35, BD + 1.25, .99, { solid: false, wall: true }); }

  // ---------- workshop ----------
  const wb = place('workbench', workbench(), 2.75, WS, 1.86); out.surfaces.benchTop = wb.userData.floorY + .9;
  const tw = toolWall(); place('toolwall', tw.g, 2.6, WS + 1.05, 1.28, { solid: false, wall: true });
  for (const [k, o] of Object.entries(tw.tools)) { o.userData.home = { parent: o.parent, pos: o.position.clone(), quat: o.quaternion.clone(), scale: o.scale.x }; out.tools[k] = o; }
  // a hammer and a wrench lying on the bench, ready to be picked up
  { const h = hammer(); h.position.set(2.2, wb.userData.floorY + .9 + .018, 1.98); h.rotation.set(-Math.PI / 2, 0, -1.2); h.userData.live = true; scene.add(h); out.tools.benchHammer = h; h.userData.home = { parent: scene, pos: h.position.clone(), quat: h.quaternion.clone(), scale: 1 };
    const w = wrench(.2); w.position.set(3.25, wb.userData.floorY + .9 + .008, 2.0); w.rotation.set(-Math.PI / 2, 0, .5); scene.add(w); out.tools.benchWrench = w; w.userData.home = { parent: scene, pos: w.position.clone(), quat: w.quaternion.clone(), scale: 1 }; }
  place('wshelves', workshopShelves(.95), 4.4, WS + .95, 1.85, { ry: -Math.PI / 2, solid: false, wall: true });
  const stl = place('stool', stool(), 1.85, WS, 2.6, { seat: true }); out.surfaces.stoolSeat = stl.userData.floorY + .48;
  place('wbarrel', barrel(.8), 1.55, WS, 1.55);
  place('wbucket', bucket(.36, true), 4.05, WS, 3.4);
  place('wrug', rug(1.6, .95, 'green', '#D9C99A'), 2.8, WS, 3.05, { solid: false });
  place('wlamp', domeShade(.6), 3.75, WS + 1.44, 2.45, { solid: false, wall: true });
  place('sidebench', sideBench(), 4.12, WS, 2.45, { ry: -Math.PI / 2 });

  // ---------- deck and landings ----------
  place('telescope', telescope(), 3.5, DK, 1.3, { ry: -.6 + Math.PI });
  place('dbasket', basket(), 1.4, DK, .95);
  place('lbarrel', barrel(.75), -2.6, LL, 1.4);
  place('lbucket', bucket(.34), -1.9, LL, 1.8);

  // ---------- grab / release for the hero's hands ----------
  const tq = new THREE.Quaternion();
  out.grab = (name, bone, { offset = V(0, .08, .03), rot = null } = {}) => {
    const o = out.tools[name]; if (!o || !bone) return null; const ws = bone.getWorldScale(V()).x || 1; bone.add(o);
    o.scale.setScalar(((o.userData.home && o.userData.home.scale) || 1) / ws); if (rot) o.quaternion.copy(rot); else o.quaternion.identity();
    const grip = (o.userData.grip || V()).clone().applyQuaternion(o.quaternion).multiplyScalar(o.scale.x); o.position.copy(offset).multiplyScalar(1 / ws).sub(grip); return o;
  };
  out.release = (name) => { const o = out.tools[name]; const h = o && o.userData.home; if (!h) return; h.parent.add(o); o.position.copy(h.pos); o.quaternion.copy(h.quat); o.scale.setScalar(h.scale || 1); };
  out.chairO = chairO; out.bunk = bunk;
  out.lanternHousing = (parent, rod = .15) => { const h = lanternHousing(rod); bake(h); parent.add(h); return h; };
  void tq;

  // ---------- per-frame: book pages, oven heat ----------
  let pageT = 4, tAcc = 0;
  out.update = (dt, { reading = false, cooking = false, heat = 0 } = {}) => {
    out.book.update(dt);
    if (reading) { pageT -= dt; if (pageT <= 0) { out.book.turn(1); pageT = rr(5, 9); } }
    out.oven.setHeat(Math.max(heat, cooking ? .85 : 0)); tAcc += dt; out.oven.flicker(tAcc);
  };
  shiftRooms();
  // ---------- light sources for lights.js: world positions + the emissive materials to switch ----------
  // each: { pos: Vector3 (world), obj, mats: [materials whose emissive/opacity show the source is on] }
  { const wp = (o, x = 0, y = 0, z = 0) => { o.updateMatrixWorld(true); return o.localToWorld(V(x, y, z)); };
    const st = placed.stove, kl = placed.klamp, wl = placed.wlamp;
    out.lights = {
      oven: { pos: wp(st, 0, .3, .05), obj: st, mats: [M.fire, M.ovenGlass, out.oven.flameMat], setHeat: out.oven.setHeat },
      kitchenLamp: { pos: wp(kl, 0, 0, 0), obj: kl, mats: [M.glass] },
      workshopLamp: { pos: wp(wl, 0, .06, 0), obj: wl, mats: [wl.userData.inner] },
      candle: { pos: wp(candleObj, 0, .13, 0), obj: candleObj, mats: [candleObj.userData.flame] },
    };
    out.materials = { fire: M.fire, ovenGlass: M.ovenGlass, flame: out.oven.flameMat, lampGlass: M.glass, domeInner: wl.userData.inner, candleFlame: candleObj.userData.flame };
  }
  out.surfaces.bed = bunk.userData.info.levels.map(l => ({ top: bunk.userData.floorY + l.top, x0: bunk.position.x + l.x0, x1: bunk.position.x + l.x1, z0: bunk.position.z + l.z0, z1: bunk.position.z + l.z1, headDir: '+x' }));
  return out;
}
