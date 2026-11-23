// Living forest soundscape (owned by the SOUND / AMBIENCE work).
//
// No synthetic hiss anywhere: every sound is a short real-sounding recording (game/sounds-mp3.txt, packed mp3,
// sources and prompts in assets/sounds/). Each creature is its own layer of "individuals" that sit at a
// place in the world (a robin in one tree, frogs by the pond, an owl far away) and call on a stochastic
// schedule: bouts of calls, rests, a personal pitch, and a per-night / per-day personality (some nights the
// wolf is not there, some mornings the blackbird is lazy). Activity curves follow the game clock, the
// season, rain and wind, and the hero waking up kicks the morning birds into a chorus.
//
// index.html: const AUDIO=createAudio({ac, camera, hour, rain, hero, lights, asset}); AUDIO.start() on the
// first user gesture; AUDIO.update(dt) every frame.
// API (window.__audio):
//   start()            -> unlock + load (call from a user gesture)
//   update(dt)         -> every frame
//   mute(b) / muted()  -> master on/off (remembered in localStorage)
//   setSeason(s)       -> 'spring' | 'summer' | 'autumn' | 'winter' (otherwise window.__season or ctx.season())
//   state()            -> {season, wind, rain, voices, layers:{name:activity}}
//   play(name)         -> force one call of a layer (debug)

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
// activity window over the clock with soft edges; handles windows that cross midnight
function win(h, a, b, f = 1) {
  const up = x => smooth(a - f / 2, a + f / 2, x), dn = x => 1 - smooth(b - f / 2, b + f / 2, x);
  return Math.min(up(h), dn(h));
}
const nightW = (h, a, b, f = 1) => Math.max(win(h, a, 24.5, f) * (h >= 12 ? 1 : 0), win(h, -0.5, b, f) * (h < 12 ? 1 : 0));
const SEASON_K = (s, k) => (k[s] ?? k.summer ?? 1);

// ---------- the creatures ----------
// clips: names in sounds-mp3.txt. act(h, env) -> 0..1. n: individuals. place: where they live.
// bout: calls per bout, gap: seconds between calls in a bout, rest: seconds between bouts (divided by activity).
// p: chance the creature is around on a given night/day. vol: gain. pitch: personal pitch spread.
// the pond: window.__ground.pond if Ground provides it ({x,z,r} | {center|pos: Vector3, radius|r}), else a spot ~20 m back-left
function pondGeo() {
  const g = window.__ground && window.__ground.pond; let P = null;
  try { if (g) { const c = g.center || g.pos || g; P = { x: +c.x || 0, y: +(c.y ?? g.y ?? 0) || 0, z: +c.z || 0, r: +(g.radius ?? g.r ?? 3) || 3 }; } } catch (e) {}
  return P || { x: Math.cos(2.4) * 20, y: 0, z: Math.sin(2.4) * 20, r: 4 };
}
const PLACE = {
  ground: () => ({ r: rnd(5, 22), y: rnd(0, .6) }),
  pond: () => { const P = pondGeo(), a = rnd(0, Math.PI * 2), r = P.r * rnd(.7, 1.05); return { abs: { x: P.x + Math.cos(a) * r, y: P.y + .05, z: P.z + Math.sin(a) * r } }; },
  trees: () => ({ r: rnd(9, 28), y: rnd(3, 12) }),
  far: () => ({ r: rnd(28, 50), y: rnd(4, 14) }),
  veryfar: () => ({ r: rnd(70, 110), y: rnd(0, 10) }),
  house: () => ({ r: rnd(2.5, 7), y: rnd(3, 9) }),
};
const L = {
  // ---- night ----
  cricket: { clips: ['cricket_a', 'cricket_b', 'cricket_c'], n: 5, place: 'ground', vol: .22, pitch: .07, p: 1,
    act: (h, e) => nightW(h, 19.8, 5.2, 1.4) * SEASON_K(e.season, { summer: 1, spring: .55, autumn: .3, winter: 0 }) * (1 - .75 * e.rain),
    texture: [2.5, 6], gap: [.3, 2.5], rest: [.3, 2.5] },
  frog: { clips: ['frog_a', 'frog_b', 'frog_c', 'frog_d', 'toad_a'], n: 3, place: 'pond', vol: .34, pitch: .06, p: .9,
    pondy: 1,
    act: (h, e) => (nightW(h, 20.3, 4.6, 1.2) + .7 * win(h, 18.8, 20.6, .8)) * SEASON_K(e.season, { summer: 1, spring: 1, autumn: .25, winter: 0 }) * (1 + .7 * e.rain),
    bout: [1, 4], gap: [1, 3.5], rest: [5, 18] },
  owl: { clips: ['owl_a', 'owl_a', 'owl_c', 'owl_b'], n: 2, place: 'far', vol: .5, pitch: .04, p: .85, sticky: true,
    act: (h, e) => nightW(h, 20.6, 5.2, 1) * (1 - .6 * e.rain),
    bout: [2, 4], gap: [5, 11], rest: [22, 60] },
  wolf: { clips: ['wolf_a', 'wolf_b'], n: 1, place: 'veryfar', vol: .55, pitch: .05, rev: .9,
    p: e => SEASON_K(e.season, { summer: .35, spring: .3, autumn: .55, winter: .8 }),
    act: (h, e) => nightW(h, 21.3, 4.4, 1) * (1 - .8 * e.rain),
    bout: [1, 2], gap: [7, 14], rest: [30, 70] },
  fox: { clips: ['fox_a'], n: 1, place: 'far', vol: .32, pitch: .06, p: .35,
    act: (h, e) => nightW(h, 21, 4.5, 1) * (1 - e.rain), bout: [1, 1], rest: [40, 120] },
  nightjar: { clips: ['nightjar_a'], n: 1, place: 'trees', vol: .22, pitch: .03, p: .5,
    act: (h, e) => (win(h, 20, 22.3, .8) + win(h, 3.2, 4.6, .6)) * SEASON_K(e.season, { summer: 1, spring: .7, autumn: 0, winter: 0 }) * (1 - e.rain),
    bout: [1, 2], gap: [2, 5], rest: [20, 50] },
  twig: { clips: ['branch_a'], n: 2, place: 'ground', vol: .3, pitch: .12, p: .8,
    act: h => nightW(h, 20.5, 5, 1), bout: [1, 1], rest: [35, 100] },
  // ---- dawn, morning, day ----
  robin: { clips: ['robin_a', 'robin_b'], n: 2, place: 'trees', vol: .32, pitch: .05, p: .95, song: true,
    act: (h, e) => (win(h, 4.4, 9, .9) + .25 * win(h, 9, 18, 1) + .7 * win(h, 18, 20.6, .8)) * SEASON_K(e.season, { winter: .7 }),
    bout: [2, 6], gap: [2.5, 6.5], rest: [8, 26] },
  blackbird: { clips: ['blackbird_a', 'blackbird_b'], n: 2, place: 'trees', vol: .34, pitch: .05, p: .9, song: true,
    act: (h, e) => (win(h, 4.7, 8.6, .9) + .2 * win(h, 8.6, 18, 1) + .9 * win(h, 18.4, 20.4, .8)) * SEASON_K(e.season, { winter: .08, autumn: .3 }),
    bout: [2, 5], gap: [3, 7], rest: [10, 30] },
  thrush: { clips: ['thrush_a'], n: 1, place: 'trees', vol: .3, pitch: .04, p: .75, song: true,
    act: (h, e) => (win(h, 4.9, 8.2, .8) + .6 * win(h, 18.6, 20.3, .7)) * SEASON_K(e.season, { winter: 0, autumn: .2 }),
    bout: [2, 4], gap: [3, 7], rest: [14, 34] },
  wren: { clips: ['wren_a'], n: 1, place: 'trees', vol: .26, pitch: .05, p: .8, song: true,
    act: (h, e) => (win(h, 5.2, 10, .8) + .4 * win(h, 10, 17, 1)) * SEASON_K(e.season, { winter: .5 }),
    bout: [1, 3], gap: [4, 9], rest: [12, 36] },
  chaffinch: { clips: ['chaffinch_a'], n: 2, place: 'trees', vol: .28, pitch: .05, p: .9, song: true,
    act: (h, e) => (win(h, 5.4, 11, .8) + .5 * win(h, 11, 17.5, 1)) * SEASON_K(e.season, { winter: 0, autumn: .15 }),
    bout: [2, 5], gap: [4, 9], rest: [10, 30] },
  tit: { clips: ['tit_a', 'tit_b'], n: 2, place: 'trees', vol: .24, pitch: .06, p: .9, song: true,
    act: (h, e) => (win(h, 5.6, 16.5, 1) * .7) * SEASON_K(e.season, { winter: .6 }),
    bout: [1, 4], gap: [2, 6], rest: [12, 34] },
  warbler: { clips: ['warbler_a'], n: 1, place: 'trees', vol: .24, pitch: .04, p: .7, song: true,
    act: (h, e) => win(h, 5.8, 13, 1) * .65 * SEASON_K(e.season, { summer: 1, spring: 1, autumn: 0, winter: 0 }),
    bout: [2, 4], gap: [4, 8], rest: [14, 36] },
  chorus: { clips: ['chorus_a', 'chorus_b'], n: 3, place: 'far', vol: .2, pitch: .03, p: 1, song: true,
    act: (h, e) => win(h, 4.8, 7.8, 1.1) * SEASON_K(e.season, { winter: .12, autumn: .4 }),
    texture: [5, 10], gap: [2, 5], rest: [2, 5] },
  cuckoo: { clips: ['cuckoo_a'], n: 1, place: 'far', vol: .32, pitch: .03, p: .55,
    act: (h, e) => win(h, 7, 17, 1) * SEASON_K(e.season, { summer: 1, spring: 1, autumn: 0, winter: 0 }) * (1 - .8 * e.rain),
    bout: [1, 1], rest: [25, 70] },
  dove: { clips: ['dove_a'], n: 1, place: 'trees', vol: .26, pitch: .04, p: .7,
    act: (h, e) => win(h, 7, 18, 1) * SEASON_K(e.season, { winter: .4 }) * (1 - .7 * e.rain), bout: [1, 2], gap: [6, 12], rest: [20, 55] },
  woodpecker: { clips: ['woodpecker_a', 'woodpecker_b'], n: 1, place: 'far', vol: .3, pitch: .05, p: .7,
    act: (h, e) => win(h, 8, 17, 1) * SEASON_K(e.season, { winter: .8 }) * (1 - .7 * e.rain), bout: [1, 3], gap: [4, 9], rest: [18, 55] },
  crow: { clips: ['crow_a', 'raven_a', 'jay_a'], n: 2, place: 'far', vol: .3, pitch: .05, p: .85,
    act: (h, e) => win(h, 6.5, 18.5, 1) * .7 * SEASON_K(e.season, { winter: 1.3, autumn: 1.2 }), bout: [1, 2], gap: [3, 8], rest: [16, 50] },
  bee: { clips: ['bee_a'], n: 1, place: 'house', vol: .16, pitch: .1, p: .8,
    act: (h, e) => win(h, 10, 17, 1) * SEASON_K(e.season, { summer: 1, spring: .6, autumn: .1, winter: 0 }) * (1 - e.rain), bout: [1, 1], rest: [18, 55] },
  insects: { clips: ['fly_a', 'grasshopper_a'], n: 2, place: 'ground', vol: .12, pitch: .06, p: .8,
    act: (h, e) => win(h, 11, 17, 1.2) * SEASON_K(e.season, { summer: 1, spring: .3, autumn: .2, winter: 0 }) * (1 - e.rain),
    texture: [3, 6], gap: [4, 14], rest: [4, 14] },
  // ---- the shelter at night: rare, distant, unexplained (Little Nightmares mood). More often when the hero is anxious
  // (Brain's need.safety); listeners get __audio.on('unease') so the hero can stop and listen.
  unease: { clips: ['un_crack', 'un_cry', 'un_metal', 'un_thud', 'un_moan', 'un_rustle'], n: 1, place: 'far', vol: .3, pitch: .07, p: .9, rev: .8, uneasy: true,
    act: (h, e) => nightW(h, 21, 4.6, 1) * (.2 + 1.1 * (e.anx ?? .3)) * (1 - .4 * e.rain),
    bout: [1, 1], rest: [70, 170] },
  // ---- the pond (all only when the camera is within ~45 m of it) ----
  lap: { clips: ['slosh_a', 'slosh_b'], n: 3, place: 'pond', vol: .1, pitch: .06, p: 1, pondy: 1, rate: .62, rev: .15,
    act: (h, e) => SEASON_K(e.season, { winter: .1 }) * (.25 + e.wind),                       // little waves when the wind blows
    texture: [.6, 1.2], gap: [1.2, 3.5], rest: [1, 3] },
  fish: { clips: ['drip_bucket_b', 'drip_bucket_a'], n: 1, place: 'pond', vol: .3, pitch: .05, p: .9, pondy: 1, rate: .5, rev: .3,
    act: (h, e) => (win(h, 5.5, 20.5, 1) + .4 * nightW(h, 20.5, 5.5, 1)) * SEASON_K(e.season, { winter: 0, autumn: .6 }),
    bout: [1, 1], rest: [25, 70] },
  dragonfly: { clips: ['fly_a'], n: 2, place: 'pond', vol: .09, pitch: .1, p: .85, pondy: 1, rate: 1.45, flit: 1,
    act: (h, e) => win(h, 10, 17.5, 1) * SEASON_K(e.season, { summer: 1, spring: .5, autumn: .25, winter: 0 }) * (1 - e.rain),
    texture: [1, 2.2], gap: [4, 12], rest: [4, 12] },
  // ---- autumn ----
  geese: { clips: ['geese_a', 'geese_b', 'cranes_a'], n: 1, place: 'far', vol: .42, pitch: .04, p: .8, fly: true,
    act: (h, e) => (win(h, 6.5, 11, 1) + .8 * win(h, 15, 19.5, 1)) * SEASON_K(e.season, { autumn: 1, spring: .5, summer: 0, winter: 0 }),
    bout: [1, 1], rest: [40, 110] },
  deer: { clips: ['deer_a', 'deer_b', 'elk_a'], n: 1, place: 'veryfar', vol: .5, pitch: .04, p: .55, rev: .7,
    act: (h, e) => (nightW(h, 18.5, 6.5, 1)) * SEASON_K(e.season, { autumn: 1, winter: .2, summer: .15, spring: 0 }) * (1 - .6 * e.rain),
    bout: [1, 2], gap: [5, 12], rest: [35, 90] },
  damp: { clips: ['wetdrip_a', 'drip_a'], n: 3, place: 'house', vol: .2, pitch: .12, p: 1,
    act: (h, e) => SEASON_K(e.season, { autumn: .8, winter: .1, summer: 0, spring: .3 }) * (1 - e.rain),
    texture: [1.2, 3], gap: [5, 16], rest: [6, 16] },
  coldwind: { clips: ['windw_a', 'windw_b'], n: 2, place: 'far', vol: .16, pitch: .06, p: 1,
    act: (h, e) => SEASON_K(e.season, { winter: 1, autumn: .35, summer: 0, spring: 0 }) * (.6 + .4 * nightW(h, 19, 6, 2)),
    texture: [4, 7], gap: [6, 18], rest: [4, 10] },
  winterbirds: { clips: ['bullfinch_a', 'wtit_a'], n: 2, place: 'trees', vol: .26, pitch: .05, p: .9, song: true,
    act: (h, e) => win(h, 8, 16, 1) * SEASON_K(e.season, { winter: 1, autumn: .4, summer: 0, spring: 0 }), bout: [1, 3], gap: [3, 7], rest: [12, 32] },
};
const MASTER = 2.2;   // the clips are mixed quiet on purpose; the compressor keeps the peaks soft
const SONG = Object.keys(L).filter(k => L[k].song);

export function createAudio(ctx) {
  const getAC = ctx.ac || (() => null);
  let NYQ = 15000, A = null, master = null, rev = null, revIn = null, outBus = null, outLP = null, inBus = null, roomIn = null, loaded = false, loading = null, started = false;
  let muted = false; try { muted = localStorage.getItem('th_mute') === '1'; } catch (e) {}
  let season0 = null;
  // Memory: the packs stay compressed (RAW, ~3 MB); a clip is decoded the first time it is needed and the
  // least recently used ones are dropped beyond a budget, so a phone never holds all ~6 min of PCM (70+ MB).
  const RAW = {}, B = {}, USED = {}, PENDING = {};
  const BUDGET_S = 140;   // seconds of decoded audio kept at most (~27 MB at 48 kHz, ~18 MB at 32 kHz)
  let decodedS = 0;
  function getBuf(k) { const b = B[k]; if (b) { USED[k] = now; return b; } decode(k); return null; }
  function decode(k) {
    if (B[k]) return Promise.resolve(B[k]); if (PENDING[k]) return PENDING[k]; if (!RAW[k] || !A) return Promise.resolve(null);
    return PENDING[k] = new Promise(res => A.decodeAudioData(RAW[k].slice().buffer, res, () => res(null))).then(b => {
      delete PENDING[k]; if (!b) return null; B[k] = b; USED[k] = now; decodedS += b.duration; evict(); return b;
    });
  }
  function evict() {
    if (decodedS <= BUDGET_S) return;
    const busy = new Set([...voices].map(v => v.name));
    for (const k of Object.keys(B).sort((a, b) => USED[a] - USED[b])) {
      if (decodedS <= BUDGET_S * .85) break; if (busy.has(k)) continue;
      decodedS -= B[k].duration; delete B[k];
    }
  }
  const voices = new Set();
  const LOG = [];
  const LS = {}; const emit = (k, e) => { for (const f of LS[k] || []) try { f(e); } catch (er) { console.error('audio', k, er); } };
  const MOB = !!ctx.mobile;
  const MAXV = MOB ? 9 : 14;   // phones: fewer simultaneous voices (each is a panner + filter + gain)
  let pondSig = null, pondFar = false, layerAcc = 0, now = 0, lastH = null, kick = 0, wasAsleep = null, wind = .3, windT = 0, rainMem = 0;
  const ind = {};          // individuals per layer
  const mult = {};         // today's / tonight's personality per layer
  const center = { x: 0, z: 0 };

  function season() {
    if (season0) return season0;
    const s = typeof window.__season === 'function' ? window.__season() : window.__season;
    return s || (ctx.season && ctx.season()) || 'autumn';   // the reference world is autumn
  }

  function buildGraph() {
    master = A.createGain(); master.gain.value = muted ? 0 : MASTER;
    const comp = A.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .3;
    master.connect(comp).connect(A.destination);
    // one shared forest reverb: a soft decaying impulse response (only heard through the calls, never on its own)
    const len = Math.floor(A.sampleRate * (MOB ? 1.7 : 2.6)), ir = A.createBuffer(2, len, A.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.5 - .42 * t); d[i] = lp * Math.pow(1 - t, 2.4) * (i < 300 ? i / 300 : 1); } }
    rev = A.createConvolver(); rev.buffer = ir; revIn = A.createGain(); revIn.gain.value = .55;
    // the forest goes through one low-pass + gain: from inside a room it is muffled and quieter
    NYQ = A.sampleRate / 2 - 100; outLP = A.createBiquadFilter(); outLP.type = 'lowpass'; outLP.frequency.value = NYQ; outLP.Q.value = .4;
    outBus = A.createGain(); outBus.connect(outLP).connect(master); revIn.connect(rev).connect(outBus);
    // sounds in the house: dry bus + a short wooden-room reverb (early reflections off the planks)
    inBus = A.createGain(); inBus.connect(master);
    const rl = Math.floor(A.sampleRate * .45), rir = A.createBuffer(2, rl, A.sampleRate);
    for (let c = 0; c < 2; c++) { const d = rir.getChannelData(c); let lp = 0; for (let i = 0; i < rl; i++) { const t = i / rl; lp += ((Math.random() * 2 - 1) - lp) * .35; d[i] = lp * Math.pow(1 - t, 3.5) * (i < 40 ? i / 40 : 1); } }
    const room = A.createConvolver(); room.buffer = rir; roomIn = A.createGain(); roomIn.gain.value = .5; roomIn.connect(room).connect(inBus);
  }
  // ---------- rooms: where the camera is decides what we hear ----------
  const LV = ctx.lv || { KT: 5.0, BD: 7.4, WS: 3.6 };
  const ROOMS = ctx.rooms || [
    { n: 'kitchen', c: { x: -2.65, y: LV.KT + 1.05, z: 2.5 }, r: 2.8 },
    { n: 'bedroom', c: { x: -1.9, y: LV.BD + 1.1, z: 2.3 }, r: 2.6 },
    { n: 'workshop', c: { x: 2.75, y: LV.WS + 1.1, z: 2.9 }, r: 2.8 },
  ];
  function indoorK(p) {     // 0 outside .. 1 well inside a room
    let k = 0; for (const R of ROOMS) { const dx = p.x - R.c.x, dy = (p.y - R.c.y) * 1.6, dz = p.z - R.c.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz); k = Math.max(k, 1 - smooth(R.r * .8, R.r * 1.7, d)); }   // the rooms are open to the camera: being zoomed close counts as being in the room
    return k;
  }
  let inK = 0, inKa = -1;
  function acoustics(dt) {
    const c = ctx.camera; if (!c || !outLP) return;
    inK += (indoorK(c.position) - inK) * Math.min(1, dt * 2.5);
    if (Math.abs(inK - inKa) < .01) return; inKa = inK; const t = A.currentTime;
    outLP.frequency.setTargetAtTime(NYQ * Math.pow(1500 / NYQ, inK), t, .15);   // open -> 1.5 kHz
    outBus.gain.setTargetAtTime(1 - .55 * inK, t, .15);
    roomIn.gain.setTargetAtTime(.35 + .5 * inK, t, .15);                                 // the room rings more when we are in it
  }

  let actLoaded = false;
  async function load() {
    await loadPack('sounds-mp3.txt');
    loaded = true; console.log('audio: ' + Object.keys(RAW).length + ' forest clips ready');
    await loadPack('sounds-act-mp3.txt').catch(e => console.warn('audio actions', e));   // the hero's foley comes second
    actLoaded = true;
    for (const k in FT) for (const c of FT[k]) decode(c);   // footsteps are short and frequent: keep them warm
  }
  async function loadPack(file) {
    const url = new URL((ctx.asset || '') + file, document.baseURI).href;
    const pack = await fetch(url).then(r => r.json());
    for (const k in pack) { const bin = atob(pack[k]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); RAW[k] = u8; }
  }

  // iOS (Safari and home-screen apps): audio only unlocks inside a real gesture (touchend/click count; touchstart and
  // pointerdown not always), and it can come back 'suspended' or 'interrupted' after a call, Siri or the app switcher.
  // So every gesture re-tries, and the first one also plays a silent sample, which is what actually opens the output on iOS.
  function unlock() {
    if (!A) return;
    if (A.state !== 'running') A.resume().catch(() => {});
    if (!unlock.done) { try { const b = A.createBuffer(1, 1, A.sampleRate), s0 = A.createBufferSource(); s0.buffer = b; s0.connect(A.destination); s0.start(0); unlock.done = true; } catch (e) {} }
  }
  const onGesture = () => { if (!started) start(); else unlock(); };
  for (const ev of ['touchend', 'click', 'pointerup', 'keydown']) document.addEventListener(ev, onGesture, { capture: true, passive: true });
  function start() {
    if (!A) { A = getAC(); if (!A) return; buildGraph(); A.onstatechange = () => { if (A.state === 'interrupted') unlock.done = false; }; }
    unlock();
    if (!loading) loading = load().catch(e => console.warn('audio load', e));
    started = true;
  }

  // ---------- voices ----------
  const L3 = { x: 0, y: 0, z: 0 };
  function listener() { const c = ctx.camera; if (c) { L3.x = c.position.x; L3.y = c.position.y; L3.z = c.position.z; } return L3; }
  function syncListener() {
    if (!A || !ctx.camera) return; const c = ctx.camera, l = A.listener, e = c.matrixWorld.elements;
    // only when the camera actually moved (and at most ~30 times a second): each call queues 9 automation events
    const tn = A.currentTime, sig = e[12] + e[13] * 3.1 + e[14] * 7.3 + e[8] * 11 + e[10] * 13 + e[5] * 17;
    if (Math.abs(sig - (syncListener.sig ?? 1e9)) < 1e-3 || tn - (syncListener.t ?? -1) < .033) return; syncListener.sig = sig; syncListener.t = tn;
    const f = { x: 0, y: 0, z: -1 }, u = { x: 0, y: 1, z: 0 };
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10]; u.x = e[4]; u.y = e[5]; u.z = e[6];
    const t = A.currentTime + .05;
    if (l.positionX) { l.positionX.linearRampToValueAtTime(c.position.x, t); l.positionY.linearRampToValueAtTime(c.position.y, t); l.positionZ.linearRampToValueAtTime(c.position.z, t);
      l.forwardX.linearRampToValueAtTime(f.x, t); l.forwardY.linearRampToValueAtTime(f.y, t); l.forwardZ.linearRampToValueAtTime(f.z, t);
      l.upX.linearRampToValueAtTime(u.x, t); l.upY.linearRampToValueAtTime(u.y, t); l.upZ.linearRampToValueAtTime(u.z, t); }
    else { l.setPosition(c.position.x, c.position.y, c.position.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // play a buffer at a world position. o: {gain, rate, offset, dur, ref, rev, fadeIn, fadeOut, pos|null, pan}
  function voice(name, o) {
    if (!A || (!o.bed && voices.size >= (o.prio ? MAXV + 6 : MAXV))) return null;   // the hero's own sounds get extra room
    const buf = getBuf(name); if (!buf) return null;
    if (o.prio) { duckUntil = A.currentTime + 3; lastActT = now; }   // the music steps back for the hero's sounds
    const t = A.currentTime + (o.delay || 0);
    const src = A.createBufferSource(); src.buffer = buf; src.playbackRate.value = o.rate || 1;
    const off = Math.min(o.offset || 0, Math.max(0, buf.duration - .3));
    const dur = Math.min(o.dur || buf.duration, (buf.duration - off));
    const realDur = dur / (o.rate || 1);
    const g = A.createGain(); const fi = o.fadeIn ?? .02, fo = Math.min(o.fadeOut ?? .3, realDur * .4);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(o.gain, t + fi);
    g.gain.setValueAtTime(o.gain, t + Math.max(fi, realDur - fo)); g.gain.linearRampToValueAtTime(0, t + realDur);
    let out = g;
    let dist = 10;
    if (o.pos) {
      const l = listener(); dist = Math.hypot(o.pos.x - l.x, o.pos.y - l.y, o.pos.z - l.z);
      const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(1400, NYQ * Math.exp(-dist / (o.far ? 45 : 70))); lp.Q.value = .5;
      const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 10; p.rolloffFactor = o.roll ?? .9; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      if (o.move) { const m = o.move; if (p.positionX) { p.positionX.setValueAtTime(o.pos.x, t); p.positionX.linearRampToValueAtTime(m.x, t + realDur); p.positionY.setValueAtTime(o.pos.y, t); p.positionY.linearRampToValueAtTime(m.y, t + realDur); p.positionZ.setValueAtTime(o.pos.z, t); p.positionZ.linearRampToValueAtTime(m.z, t + realDur); } }
      src.connect(lp).connect(g).connect(p).connect(o.indoor ? inBus : outBus); out = p;
    } else {
      const sp = A.createStereoPanner ? A.createStereoPanner() : null;
      const bus = o.indoor ? inBus : outBus; if (sp) { sp.pan.value = o.pan || 0; src.connect(g).connect(sp).connect(bus); } else src.connect(g).connect(bus);
    }
    const sendAmt = o.rev ?? clamp01(.12 + dist / 60);
    if (sendAmt > .01) { const s = A.createGain(); s.gain.value = sendAmt; g.connect(s).connect(o.indoor ? roomIn : revIn); }
    src.start(t, off, dur);
    const v = { src, g, end: t + realDur, name };
    LOG.push([+now.toFixed(1), name]); if (LOG.length > 60) LOG.shift();
    voices.add(v); src.onended = () => { voices.delete(v); try { out.disconnect(); g.disconnect(); } catch (e) {} };
    return v;
  }

  // ---------- individuals ----------
  function place(kind) {
    const P = PLACE[kind](); if (P.abs) return P.abs; const a = P.a ?? rnd(0, Math.PI * 2);
    // keep most creatures off the very front of the view so they surround the house
    return { x: center.x + Math.cos(a) * P.r, y: P.y, z: center.z + Math.sin(a) * P.r };
  }
  function populate(names, env) {
    for (const k of names) {
      const S = L[k]; const p = typeof S.p === 'function' ? S.p(env) : S.p;
      mult[k] = Math.random() < p ? rnd(.45, 1.5) : 0;
      if (S.sticky && ind[k] && Math.random() < .6) continue;            // the owl often keeps its tree
      const n = Math.max(1, Math.round(S.n * rnd(.6, 1.2)));
      ind[k] = Array.from({ length: n }, () => ({ pos: place(S.place), pitch: 1 + rnd(-S.pitch, S.pitch), next: now + rnd(0, 2), bout: 0, lazy: rnd(.7, 1.3) }));
    }
  }
  const NIGHT = ['cricket', 'frog', 'owl', 'wolf', 'fox', 'nightjar', 'twig', 'deer', 'unease'];
  const DAY = Object.keys(L).filter(k => !NIGHT.includes(k));

  function call(k, I, act, env) {
    const S = L[k]; let name = pick(S.clips); if (S.uneasy && name === S.last) name = pick(S.clips); S.last = name;
    const buf = getBuf(name); if (!buf) return;
    if (S.uneasy) { const q = I.pos; emit('unease', { name, pos: [q.x, q.y, q.z], anx: env.anx ?? 0 }); }
    const rate = I.pitch * (1 + rnd(-.025, .025));
    const o = { pos: I.pos, rate: rate * (S.rate ?? 1), gain: S.vol * rnd(.6, 1.05) * (.55 + .45 * Math.min(1, act)), rev: S.rev, far: S.place === 'veryfar', ref: S.place === 'house' ? 4 : 10 };
    if (S.texture) { o.dur = rnd(S.texture[0], S.texture[1]); o.offset = rnd(0, Math.max(0, buf.duration - o.dur)); o.fadeIn = rnd(.4, 1.2); o.fadeOut = rnd(.6, 1.5); }
    else if (S.song && Math.random() < .3) { o.dur = buf.duration * rnd(.45, .8); o.fadeOut = .35; }   // a shorter phrase now and then
    if (S.flit) { const p0 = I.pos; o.pos = { x: p0.x + rnd(-1, 1), y: rnd(.4, 1.4), z: p0.z + rnd(-1, 1) }; o.move = { x: o.pos.x + rnd(-3, 3), y: rnd(.4, 1.4), z: o.pos.z + rnd(-3, 3) }; o.ref = 3; }
    // a flock passes over: from one side of the sky to the other
    if (S.fly) { const a = rnd(0, Math.PI * 2), r = rnd(35, 60), y = rnd(25, 45); o.pos = { x: Math.cos(a) * r, y, z: Math.sin(a) * r }; o.move = { x: -Math.cos(a) * r, y, z: -Math.sin(a) * r }; o.ref = 30; }
    // birds sing from a slightly different twig each time
    if (S.place === 'trees') o.pos = { x: I.pos.x + rnd(-1.5, 1.5), y: I.pos.y + rnd(-1, 1), z: I.pos.z + rnd(-1.5, 1.5) };
    voice(name, o);
  }

  // Each individual is either in a bout (calls spaced by `gap`) or resting. A resting creature starts a bout
  // as a Poisson process whose rate follows its activity right now, so a frog that was quiet at dusk joins
  // in as soon as the night comes, and nothing waits on a long timer drawn when it was still day.
  function tickLayers(h, env, dt) {
    const morning = clamp01(win(h, 4.5, 9.5, 1)) * kick;
    { const P = pondGeo(), c = ctx.camera ? ctx.camera.position : P0; pondFar = Math.hypot(P.x - c.x, P.z - c.z) > 45; }
    for (const k in L) {
      const S = L[k], list = ind[k]; if (!list) continue;
      let act = S.act(h, env) * (mult[k] ?? 0);
      if (S.pondy && k !== 'frog' && pondFar) act = 0;               // nothing to hear from the pond from far away: no voices, no cost
      if (S.song) act *= (1 - .8 * env.rain) * (1 + morning * 1.2) * (env.awake || h < 4 || h > 10 ? 1 : .6);
      if (act <= .01) { for (const I of list) I.bout = 0; continue; }
      const meanRest = (S.rest[0] + S.rest[1]) / 2;
      for (const I of list) {
        if (S.texture) {
          if (now < I.next) continue;
          if (Math.random() < Math.min(1, act)) { call(k, I, act, env); I.next = now + rnd(S.gap[0], S.gap[1]); } else I.next = now + rnd(.5, 2);
          continue;
        }
        if (I.bout > 0) { if (now >= I.next) { call(k, I, act, env); I.bout--; I.next = now + rnd(S.gap[0], S.gap[1]); } continue; }
        if (now < I.next) continue;                                         // a short breather after a bout
        if (Math.random() < dt * Math.min(2, act * I.lazy) / meanRest) {
          I.bout = Math.round(rnd(S.bout[0], S.bout[1] + .49));
          call(k, I, act, env); I.bout--; I.next = now + (I.bout > 0 ? rnd(S.gap[0], S.gap[1]) : rnd(S.rest[0], S.rest[1]) * .35);
        }
      }
    }
  }

  // ---------- beds: rain, oven fire, wind gusts ----------
  const beds = {};
  function bed(key, clips, level, mk) {
    const b = beds[key] || (beds[key] = { cur: null, lvl: 0 });
    b.lvl += (level - b.lvl) * .05;
    if (b.lvl < .01) return;
    const t = A.currentTime;
    if (!b.cur || b.cur.end - t < 2.2) { b.applied = b.lvl; b.cur = voice(pick(clips), Object.assign({ bed: true, fadeIn: 2, fadeOut: 2.2 }, mk(b.lvl))); }
    else if (Math.abs(b.lvl - (b.applied ?? 0)) > .08) { b.applied = b.lvl; holdGain(b.cur.g.gain, t); b.cur.g.gain.setTargetAtTime(mk(b.lvl).gain, t, .4); b.cur.g.gain.setTargetAtTime(0, Math.max(t + .5, b.cur.end - 2), .5); }
  }

  function windLevel(dt) {
    const W = window.__wind;
    if (W && typeof W.level === 'function') { try { return clamp01(W.level()); } catch (e) {} }
    windT += dt; return clamp01(.28 + .22 * Math.sin(windT * .11) * Math.sin(windT * .037 + 1) + .18 * Math.max(0, Math.sin(windT * .23 + Math.sin(windT * .07) * 3)) ** 3);
  }
  // wind.js events: a gust reaching the tree rustles the crown, big limbs creak in strong wind
  let windHooked = false, lastGust = -9, gustNext = 4;
  const gustClips = env => env.season === 'winter' ? ['windw_a', 'windw_b', 'rustle_c'] : env.season === 'autumn' ? ['leaves_a', 'leaves_b', 'rustle_a', 'rustle_c'] : ['rustle_a', 'rustle_b', 'rustle_c'];
  function gustSound(amp, env) {
    if (now - lastGust < 2.5) return; lastGust = now;
    const a = rnd(0, Math.PI * 2), r = rnd(5, 16);
    voice(pick(gustClips(env)), { pos: { x: Math.cos(a) * r, y: rnd(6, 14), z: Math.sin(a) * r }, gain: Math.min(.55, .1 + .32 * amp) * rnd(.8, 1.1), rate: rnd(.9, 1.08), fadeIn: rnd(.5, 1.2), fadeOut: 1.2, rev: .15, ref: 12 });
  }
  let envNow = { season: 'summer', rain: 0, wind: .3, awake: true };
  function hookWind() {
    const W = window.__wind; if (windHooked || !W || typeof W.on !== 'function') return;
    windHooked = true;
    W.on('gust', e => { if (e && e.phase === 'start' && loaded && !muted) gustSound(e.amp ?? .5, envNow); });
    W.on('creak', e => {
      if (!loaded || muted || !e) return; const q = e.pos || [0, 12, 0];
      voice(pick(['bcreak_a', 'bcreak_b']), { pos: { x: q[0], y: q[1], z: q[2] }, gain: .14 + .34 * (e.strength ?? .5), rate: rnd(.85, 1.08), fadeIn: .15, fadeOut: .6, ref: 9, rev: .2 });
    });
  }
  function gusts(env) {             // only when wind.js is not there
    if (windHooked || now < gustNext) return;
    gustSound(env.wind, env); gustNext = now + rnd(3, 9) / Math.max(.2, env.wind) + rnd(0, 4);
  }

  const FRIDGE = ctx.fridge || { x: -1.43, y: (ctx.lv ? ctx.lv.KT : 5.0) + .8, z: 1.38 };
  let fridgeOn = false, fridgeT = 0;
  let dripNext = 0, creakNext = 6, autoSleep = true, snoreNext = 0, turnNext = 0;
  // ---------- footsteps: surface under the foot, at the moment the foot lands ----------
  // Character can drive them exactly with __audio.footstep(side, pos?, {surface}); until it does, audio.js watches
  // the toe bones itself: a foot that comes down to the floor after being lifted is a step.
  let gnow = 0, breathNext = 0, clothNext = 0, moving = false, carrying = false, dbgF = null, autoFeet = true, ladderNext = 0, cadNext = 0, cadSide = 'L', frameDt = .016;
  const FT = { boards: ['step_wood_a', 'step_wood_b', 'step_wood_c'], dirt: ['fs_dirt_a', 'fs_dirt_b', 'fs_dirt_c'], wet: ['fs_wet_a', 'fs_wet_b', 'fs_wet_c'],
    leaves: ['fs_leaves_a', 'fs_leaves_b', 'fs_leaves_c'], ladder: ['fs_ladder_a', 'fs_ladder_b'], rope: ['fs_rope_a', 'fs_rope_b'] };
  const FV = { boards: .2, dirt: .2, wet: .22, leaves: .24, ladder: .22, rope: .24 };
  const footSt = { L: { armed: false }, R: { armed: false } };
  function surfaceAt(p, env) {
    if (p.y > .6) return 'boards';
    if (env.rain > .2 || rainMem > .3) return 'wet';
    if (env.season === 'autumn') return Math.random() < .65 ? 'leaves' : 'dirt';
    return 'dirt';
  }
  function step(side, pos, surface, gain = 1) {
    if (!loaded || muted) return;
    const list = FT[surface] || FT.boards, q = toPos(pos);
    const clip = pick(list), o = { pos: q, gain: (FV[surface] || .2) * gain * rnd(.75, 1.05), rate: rnd(.9, 1.1), ref: 3, roll: 1, rev: .15, prio: true, indoor: q.y > .6, fadeIn: .005, fadeOut: .08 };
    if (B[clip]) voice(clip, o); else decode(clip).then(() => voice(clip, o));
  }
  const _w = { x: 0, y: 0, z: 0 };
  function feet(p, mv, vy, env) {
    const B2 = ctx.bones; if (!B2) return;
    // climbing: a rung every ~0.45 s
    if (Math.abs(vy) > .25 && mv < .35) { if (vy > 0 && gnow > breathNext) { playAct('breath_climb'); breathNext = gnow + rnd(2.2, 3.4); }
      if (gnow > ladderNext) { step('L', { x: p.x, y: p.y + .2, z: p.z }, ctx.ropeAt && ctx.ropeAt(p) ? 'rope' : 'ladder'); ladderNext = gnow + rnd(.4, .55); } return; }
    if (mv < .25) { footSt.L.armed = footSt.R.armed = false; moving = false; return; }
    // clothes rustle as he sets off, and now and then on the way; heavier breath when carrying something
    if (!moving || gnow > clothNext) { if (!moving && Math.random() < .55 || moving) playAct('cloth', { x: p.x, y: p.y + 1.1, z: p.z }); clothNext = gnow + rnd(4, 9); }
    moving = true;
    if (carrying && gnow > breathNext) { playAct('breath_heavy'); breathNext = gnow + rnd(2.8, 4.5); }
    // slow frames (a weak phone, a background tab): the toe lift falls between frames, so walk by cadence instead
    if (frameDt > .08) { if (gnow > cadNext) { cadSide = cadSide === 'L' ? 'R' : 'L'; step(cadSide, p, surfaceAt(p, env), Math.min(1.2, .6 + mv * .4)); cadNext = gnow + .62 / Math.max(.6, mv); } return; }
    for (const [side, bn] of [['L', B2.LeftToeBase || B2.LeftFoot], ['R', B2.RightToeBase || B2.RightFoot]]) {
      if (!bn) continue; const w = bn.getWorldPosition(ctx.v3 || (ctx.v3 = new bn.position.constructor()));
      const hgt = w.y - p.y, st = footSt[side];
      st.base = Math.min(hgt, (st.base ?? hgt) + frameDt * .03);          // the planted height of this foot (adapts to the clip)
      if (hgt > st.base + .05) st.armed = true;
      else if (st.armed && hgt < st.base + .018) { st.armed = false; step(side, w, surfaceAt(w, env), Math.min(1.2, .6 + mv * .4)); }
    }
  }
  const lastHero = { x: 0, y: 0, z: 0 };

  function update(dt) {
    if (!started || !A) return;
    syncListener();
    if (!loaded || muted || A.state !== 'running') return;
    // real seconds from the audio clock: the frame dt is clamped and slows down on weak devices
    const pn = performance.now() / 1000, rawDt = update.pn ? pn - update.pn : .016; update.pn = pn;
    const gdt = Math.max(1e-3, dt); gnow += gdt;   // game-time frame step (the hero's animation runs on it)
    const t = A.currentTime; dt = clamp01(t - (update.t ?? t)); update.t = t; now += dt;
    acoustics(dt);
    if (loops.size) tickLoops();
    tickMusic(ctx.hour ? ctx.hour() : 12, dt);
    const h = ctx.hour ? ctx.hour() : 12;
    const rain = clamp01(ctx.rain ? ctx.rain() : 0);
    wind = windLevel(dt);
    const hero = ctx.hero, asleep = !!(hero && hero.inBed);
    let anx = .3; try { const nb = window.__brain && window.__brain.need; if (nb && nb.safety != null) anx = clamp01(nb.safety); } catch (e) {}
    const env = envNow = { season: season(), rain, wind, awake: !asleep, anx };
    hookWind();
    // the hero getting up in the morning wakes the garden
    if (wasAsleep && !asleep && h > 4 && h < 10.5) kick = 1;
    wasAsleep = asleep; kick = Math.max(0, kick - dt / 70);
    // a new night / a new day: new personalities, new territories
    if (lastH === null) { populate(Object.keys(L), env); }
    else {
      if (lastH < 18 && h >= 18) populate(NIGHT, env);
      if (lastH < 4 && h >= 4) populate(DAY, env);
    }
    lastH = h;
    { const P = pondGeo(), sig = P.x + P.z * 7 + P.r * 13; if (sig !== pondSig) { if (pondSig !== null) for (const k in L) if (L[k].pondy && ind[k]) for (const I of ind[k]) I.pos = place('pond'); pondSig = sig; } }
    layerAcc += dt; if (layerAcc >= .1) { tickLayers(h, env, layerAcc); layerAcc = 0; }   // creatures decide 10x a second, not every frame
    gusts(env);
    // rain on leaves and roof
    // rain: leaves all around, and drumming on the roof when the camera (or hero) is near one
    const R = window.__rain, cp = ctx.camera ? ctx.camera.position : null;
    let roof = .35; if (R && typeof R.roofNear === 'function' && cp) { try { roof = clamp01(R.roofNear(cp)); } catch (e) {} }
    bed('rain', ['rain_a'], rain, l => ({ gain: .34 * l, pan: rnd(-.5, .5), offset: rnd(0, 3), rev: .1 }));
    // the roofs are slate: hard, dense tapping. Inside a room it is right above us (house bus, not muffled with the forest)
    bed('roof', ['rain_slate_a', 'rain_slate_b'], rain * Math.min(1, .15 + .85 * Math.max(roof, inK)), l => ({ gain: (.3 + .25 * inK) * l, pan: rnd(-.3, .3), offset: rnd(0, 3), rev: .05, indoor: true }));
    rainMem = rain > .3 ? 1 : Math.max(0, rainMem - dt / 60);
    if (rainMem > .05 && rain < .4 && now > dripNext) { const a = rnd(0, 6.28); voice('drip_a', { pos: { x: Math.cos(a) * rnd(2, 8), y: rnd(1, 6), z: Math.sin(a) * rnd(2, 8) }, gain: .25 * rainMem, rate: rnd(.85, 1.2), dur: rnd(1, 3), offset: rnd(0, 2), ref: 4 }); dripNext = now + rnd(2, 7); }
    // the oven fire, where the oven is
    const L2 = ctx.lights; const fireLvl = L2 && L2.level ? L2.level('oven') : 0;
    const op = L2 && L2.pos ? L2.pos('oven') : null;
    const cam = ctx.camera ? ctx.camera.position : P0, near = (q, r) => q && Math.hypot(q.x - cam.x, q.y - cam.y, q.z - cam.z) < r;
    // the stove crackles only for a listener near it (nothing is played at all from afar: no cost)
    if (op) bed('fire', ['fire_a', 'fire_b'], near(op, 14) ? fireLvl : 0, l => ({ gain: .5 * l, pos: op, ref: 1.8, roll: 2, rev: .2, indoor: true, offset: rnd(0, 2) }));
    // the old fridge hums in cycles (on 40-90 s, off 25-60 s), audible only up close in the kitchen
    if (now > fridgeT) { fridgeOn = !fridgeOn; fridgeT = now + (fridgeOn ? rnd(40, 90) : rnd(25, 60)); }
    bed('fridge', ['fridge_hum'], fridgeOn && near(FRIDGE, 7) ? 1 : 0, l => ({ gain: .32 * l, pos: FRIDGE, ref: 1, roll: 2.5, rev: .1, indoor: true, offset: rnd(0, 3) }));
    // the hero asleep: soft snores now and then, and turning over (Character/Brain can switch this off: __audio.autoSleep(false))
    if (autoSleep && asleep && hero.root && actLoaded) {
      const hp = hero.root.position, at = { x: hp.x, y: hp.y + .5, z: hp.z };
      if (now > snoreNext) { if (snoreNext > 0) playAct('snore', at); snoreNext = now + rnd(7, 16); }
      if (now > turnNext) { if (turnNext > 0) playAct('bed_turn', at); turnNext = now + rnd(35, 90); }
    } else { snoreNext = now + rnd(4, 9); turnNext = now + rnd(25, 60); }
    // old planks creak under the hero now and then
    if (hero && hero.root) {
      const p = hero.root.position, mv = Math.hypot(p.x - lastHero.x, p.z - lastHero.z) / gdt, vy = (p.y - lastHero.y) / gdt;
      lastHero.x = p.x; lastHero.y = p.y; lastHero.z = p.z;
      frameDt = frameDt * .8 + Math.min(.5, rawDt) * .2;
      dbgF = [+mv.toFixed(2), +vy.toFixed(2), +frameDt.toFixed(3), +p.y.toFixed(2)];
      if (autoFeet) feet(p, mv, vy, env);
      if (mv > .4 && p.y > 1.2 && now > creakNext) { voice('creak_a', { pos: { x: p.x, y: p.y, z: p.z }, gain: rnd(.12, .22), rate: rnd(.85, 1.15), dur: rnd(.5, 1.1), offset: rnd(0, 1), ref: 2.5, roll: 1.2, rev: .2, indoor: true }); creakNext = now + rnd(4, 14); }
    }
  }

  // ---------- the hero's actions (foley) ----------
  // __audio.play(name, pos?, {gain, rate, delay}) -> one sound at pos (THREE.Vector3, [x,y,z] or {x,y,z}; default: the hero's chest).
  // __audio.loop(name, pos?) -> handle {stop(fade), move(pos), set(gain)} for long actions (radio music, sizzling, sweeping...).
  // Every call picks a variant and nudges pitch and level, so repeated hits never sound identical.
  // A layer name (e.g. 'owl') plays one call of that creature (debug).
  const ACT = {
    kettle: { c: ['kettle_whistle'], v: .26 }, tea_pour: { c: ['tea_pour'], v: .45 }, cup: { c: ['cup_set'], v: .4 }, sip: { c: ['sip'], v: .3 },
    chop_veg: { c: ['knife_board'], v: .42 }, stir: { c: ['stir_pot'], v: .38 }, firewood_oven: { c: ['log_in_stove'], v: .5 },
    oven_open: { c: ['stove_door_open'], v: .45 }, oven_close: { c: ['stove_door_close'], v: .45 }, wash: { c: ['wash_dishes'], v: .4 },
    saw: { c: ['saw_a'], v: .45 }, hammer: { c: ['hammer_a', 'hammer_b'], v: .5 }, sharpen: { c: ['sharpen'], v: .4 },
    lantern_fix: { c: ['lantern_fix'], v: .4 }, match: { c: ['match_strike'], v: .4 }, lamp_light: { c: ['lamp_light'], v: .4 },
    stretch: { c: ['stretch'], v: .32 }, yawn: { c: ['yawn'], v: .3 }, write: { c: ['pencil_write'], v: .35 }, sweep: { c: ['sweep_a'], v: .38 },
    water: { c: ['water_plant'], v: .38 }, bucket: { c: ['bucket_water'], v: .42 }, window: { c: ['window_open'], v: .4 }, shutter: { c: ['shutter'], v: .4 },
    bolt: { c: ['bolt_lock', 'bolt_open'], v: .45 }, bolt_lock: { c: ['bolt_lock'], v: .45 }, bolt_open: { c: ['bolt_open'], v: .45 },
    supplies: { c: ['supplies'], v: .38 }, drawer: { c: ['drawer'], v: .4 }, chest: { c: ['chest_open'], v: .4 },
    radio_on: { c: ['radio_on'], v: .3 }, radio_off: { c: ['radio_off'], v: .32 }, radio_tune: { c: ['radio_tune'], v: .26 }, radio_music: { c: ['radio_music'], v: .2, rate: .01 },
    telescope: { c: ['telescope'], v: .4 }, edge_sit: { c: ['edge_sit', 'creak_a'], v: .4 },
    firewood_carry: { c: ['firewood_carry'], v: .35 }, firewood_drop: { c: ['firewood_drop'], v: .45 }, logs_stack: { c: ['logs_stack'], v: .42 }, axe: { c: ['axe_chop_a', 'axe_chop_b'], v: .5 },
    step: { c: ['step_wood_a', 'step_wood_b', 'step_wood_c'], v: .22, rate: .08 }, ladder: { c: ['ladder_step'], v: .28 }, rope_ladder: { c: ['rope_ladder'], v: .32 },
    sit: { c: ['chair_sit'], v: .35 }, stand: { c: ['chair_stand'], v: .35 }, bed: { c: ['bed_lie'], v: .35 }, blanket: { c: ['blanket'], v: .3 },
    page: { c: ['page_a'], v: .3 }, book_close: { c: ['book_close'], v: .35 }, tool: { c: ['tool_pickup'], v: .35 }, plank: { c: ['plank_place'], v: .42 },
    bow_draw: { c: ['bow_draw'], v: .45, out: 1 }, bow_release: { c: ['bow_release'], v: .45, out: 1 }, arrow: { c: ['arrow_quiver'], v: .4 },
    jacket: { c: ['jacket_on'], v: .38 }, backpack: { c: ['backpack'], v: .38 }, fridge_open: { c: ['fridge_open'], v: .42 }, fridge_close: { c: ['fridge_close'], v: .42 },
    meat_pan: { c: ['meat_pan'], v: .42 }, eat: { c: ['eat'], v: .32 }, plate: { c: ['plate_set'], v: .38 },
    forest_steps: { c: ['forest_steps'], v: .32, out: 1 }, door_open: { c: ['trunk_door'], v: .42 }, door_close: { c: ['trunk_door_close'], v: .42 }, woodpile: { c: ['logs_stack', 'firewood_drop'], v: .42 },
    sizzle: { c: ['sizzle', 'meat_pan'], v: .3 },
    bucket_fill: { c: ['bucket_fill'], v: .45, out: 1 }, slosh: { c: ['slosh_a', 'slosh_b'], v: .26, rate: .08 }, tap: { c: ['tap_stream'], v: .32 },
    drip_bucket: { c: ['drip_bucket_a', 'drip_bucket_b'], v: .22, rate: .12 }, bucket_dump: { c: ['bucket_dump'], v: .45, out: 1 },
    hatch_open: { c: ['hatch_open'], v: .45 }, hatch_close: { c: ['hatch_close'], v: .5 },
    nails: { c: ['nail_a', 'nail_b', 'hammer_b'], v: .48, out: 1 }, saw_shingle: { c: ['saw_shingle'], v: .42, out: 1 },
    bed_turn: { c: ['bed_turn_a', 'bed_turn_b', 'blanket'], v: .3 },
    // the hero's body: always quiet, one at a time (see body())
    breath_climb: { c: ['breath_climb_a', 'breath_climb_b'], v: .15, body: 1 }, breath_heavy: { c: ['breath_heavy_a', 'breath_heavy_b'], v: .16, body: 1 },
    grunt: { c: ['grunt_b', 'grunt_c'], v: .18, body: 1 }, cloth: { c: ['cloth_a', 'cloth_b', 'cloth_c'], v: .13, rate: .08 },
    zip_up: { c: ['zip_up'], v: .26 }, zip_down: { c: ['zip_down'], v: .26 }, sigh: { c: ['sigh_a', 'sigh_b'], v: .2, body: 1 }, snore: { c: ['snore_a', 'snore_b'], v: .16, rate: .05 }, creak: { c: ['creak_a'], v: .25 }, footsteps: { c: ['step_a'], v: .25 },
  };
  // the 20 approved actions by their plain names (Character may call either)
  const ALIAS = { tea: 'tea_pour', kettle_tea: 'kettle', chopping: 'chop_veg', vegetables: 'chop_veg', stir_pot: 'stir', stove_wood: 'firewood_oven', dishes: 'wash',
    sawing: 'saw', nail: 'hammer', hammering: 'hammer', sharpening: 'sharpen', fix_lantern: 'lantern_fix', diary: 'write', writing: 'write', sweeping: 'sweep',
    water_plant: 'water', watering: 'water', door_bolt: 'bolt', check_bolt: 'bolt', count_supplies: 'supplies', radio: 'radio_tune', ledge_sit: 'edge_sit',
    carry_firewood: 'firewood_carry', armful: 'firewood_carry', listen: 'window',
    bow: 'bow_release', shoot: 'bow_release', fridge: 'fridge_open', meat: 'meat_pan', fry: 'meat_pan', eating: 'eat', forest: 'forest_steps', forest_walk: 'forest_steps', logs_to_pile: 'woodpile', put_on_jacket: 'jacket',
    pond: 'bucket_fill', fill_bucket: 'bucket_fill', carry_water: 'slosh', water_tap: 'tap', drain_drip: 'drip_bucket', dump_water: 'bucket_dump', hatch: 'hatch_open', trapdoor: 'hatch_open',
    repair_nail: 'nails', roof_nail: 'nails', shingle: 'saw_shingle', turn_over: 'bed_turn', snoring: 'snore',
    lift: 'grunt', effort: 'grunt', breath: 'breath_heavy', zip: 'zip_up', unzip: 'zip_down', jacket_off: 'zip_down', rustle: 'cloth' };
  const P0 = { x: 0, y: 0, z: 0 };
  function toPos(p) {
    if (!p) { const r = ctx.hero && ctx.hero.root; return r ? { x: r.position.x, y: r.position.y + 1, z: r.position.z } : P0; }
    if (Array.isArray(p)) return { x: p[0], y: p[1], z: p[2] };
    return { x: p.x, y: p.y, z: p.z };
  }
  function actOpts(a, pos, o = {}) {
    const sp = a.rate ?? .04;
    return { pos: toPos(pos), gain: (o.gain ?? 1) * a.v * rnd(.82, 1.05), rate: (o.rate ?? 1) * (1 + rnd(-sp, sp)), ref: 3.5, roll: 1, rev: .25, delay: o.delay || 0, fadeIn: .01, fadeOut: .12, prio: true, indoor: !o.outdoor };
  }
  // freeze a gain where it is right now before a new ramp (cancelScheduledValues alone can jump: a click)
  function holdGain(p, t) { if (p.cancelAndHoldAtTime) p.cancelAndHoldAtTime(t); else { const v = p.value; p.cancelScheduledValues(t); p.setValueAtTime(v, t); } }
  function stopVoice(v, f) { if (!v || !A) return; try { const t = A.currentTime; holdGain(v.g.gain, t); v.g.gain.linearRampToValueAtTime(0, t + f); v.src.stop(t + f + .05); } catch (e) {} }
  function playAct(name, pos, o = {}) {
    if (!A || muted || !loaded) return null;
    if (L[name]) { const I = ind[name] && ind[name][0]; if (I) call(name, I, 1, envNow); return null; }
    const a = ACT[name] || ACT[ALIAS[name]];
    const clip = a ? pick(a.c) : RAW[name] ? name : null;
    if (!clip) { console.warn('audio: no sound', name); return null; }
    if (a && a.body) { if (A.currentTime < bodyUntil) return null; }
    const opts = actOpts(a || { v: .4 }, pos, Object.assign({ outdoor: a && a.out }, o));
    if (a && (a.body || a === ACT.cloth)) opts.prio = false;   // a breath is the first thing to give up its voice
    if (a && a.body) bodyUntil = A.currentTime + 1.6;
    const h = { v: null, dead: false, stop: (f = .15) => { h.dead = true; stopVoice(h.v, f); } };
    if (B[clip]) h.v = voice(clip, opts);
    else decode(clip).then(() => { if (!h.dead && !muted) h.v = voice(clip, opts); });   // first use: decoded in a few ms, then played
    return h;
  }
  let bodyUntil = 0;
  const loops = new Set();
  function loopAct(name, pos, o = {}) {
    const a = ACT[name] || ACT[ALIAS[name]]; if (!a) return null;
    const Lp = { a, pos, o, gain: 1, cur: null };
    loops.add(Lp);
    return { stop: (f = .6) => { loops.delete(Lp); stopVoice(Lp.cur, f); }, move: p => { Lp.pos = p; }, set: g => { Lp.gain = g; } };
  }
  function tickLoops() {
    for (const Lp of loops) {
      if (Lp.cur && Lp.cur.end - A.currentTime > 1.2) continue;
      const name = pick(Lp.a.c), buf = getBuf(name); if (!buf) continue;
      const o = actOpts(Lp.a, Lp.pos, Lp.o); o.gain *= Lp.gain; o.bed = true; o.fadeIn = Lp.cur ? 1.2 : .25; o.fadeOut = 1.2;
      if (Lp.cur && buf.duration > 4) o.offset = rnd(0, buf.duration * .4);
      Lp.cur = voice(name, o);
    }
  }

  // ---------- the score: a sparse procedural music box (no samples, no Fal) ----------
  // Little Nightmares mood, but cosy: a slow music-box lullaby in A minor over a barely-there pad, through a long
  // soft reverb. Off most of the time. A "session" (60-120 s) may start at dusk or in a quiet moment (hero idle,
  // reading, asleep; no actions for 20 s), then rests 2.5-5 min. Every hero action ducks it for a few seconds.
  // __audio.music(on?) -> on/off (remembered); __audio.music() returns the state. __audio.musicNow() forces a session.
  let musicOn = true; try { musicOn = localStorage.getItem('th_music') !== '0'; } catch (e) {}
  let mBus = null, mDuck = null, mRev = null, mSession = 0, mRestUntil = 30, mNext = 0, mPhrase = null, mPad = null, duckUntil = 0, lastActT = -99, mDuskDay = -1;
  const SCALE = [0, 2, 3, 5, 7, 8, 10];                          // natural minor
  const ROOT = 57;                                                // A3
  // hand-written motifs in scale degrees (0 = A), with relative durations: melancholic, lullaby-like, unresolved
  const MOTIFS = [
    [[4, 1], [3, 1], [2, 1], [0, 2.5]], [[0, 1], [2, 1], [4, 1.5], [3, 2.5]], [[7, 1.5], [6, 1], [4, 1], [5, 3]],
    [[4, 1], [4, .5], [2, 1], [3, 1.5], [1, 3]], [[2, 1], [4, 1], [7, 2], [6, 1], [4, 3]], [[0, 1.5], [-1, 1], [-3, 1], [-2, 3.5]],
    [[9, 1], [7, 1], [6, 1], [4, 1], [2, 3]], [[4, 2], [3, 1], [4, 1], [2, 3]],
  ];
  const CHORDS = [[0, 4], [-2, 2], [-4, 0], [3, 7], [-1, 4]];   // pad: two notes (scale degrees) under the melody: Am, F, Dm-ish, Dm/F, Em
  const midiOf = d => { const o = Math.floor(d / 7), i = ((d % 7) + 7) % 7; return ROOT + 12 * o + SCALE[i]; };
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  function musicGraph() {
    if (mBus) return;
    mDuck = A.createGain(); mDuck.gain.value = 1; mDuck.connect(master);
    mBus = A.createGain(); mBus.gain.value = 0; mBus.connect(mDuck);
    const len = Math.floor(A.sampleRate * (MOB ? 2.6 : 3.8)), ir = A.createBuffer(2, len, A.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (.25 - .2 * t); d[i] = lp * Math.pow(1 - t, 1.8) * (i < 600 ? i / 600 : 1); } }
    mRev = A.createConvolver(); mRev.buffer = ir; const wet = A.createGain(); wet.gain.value = .9; mRev.connect(wet).connect(mBus);
  }
  // one music-box note: a sine with two faint inharmonic partials, a tiny click of attack, a long bell decay
  function mNote(m, t, vel, pan) {
    const f = hz(m), dur = 2.2 + Math.random() * 1.8, g = A.createGain(), out = A.createGain(), sp = A.createStereoPanner ? A.createStereoPanner() : null;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vel, t + .006); g.gain.exponentialRampToValueAtTime(vel * .25, t + .35); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(NYQ, 2600 + f); lp.Q.value = .3;
    for (const [k, a] of [[1, 1], [2.01, .22], [3.98, .07]]) { const o = A.createOscillator(); o.type = 'sine'; o.frequency.value = f * k; o.detune.value = (Math.random() - .5) * 6; const ga = A.createGain(); ga.gain.value = a; o.connect(ga).connect(g); o.start(t); o.stop(t + dur + .05); }
    g.connect(lp).connect(out); out.gain.value = 1; if (sp) { sp.pan.value = pan; out.connect(sp); sp.connect(mBus); sp.connect(mRev); } else { out.connect(mBus); out.connect(mRev); }
  }
  // the pad: two soft detuned triangles through a dark filter, swelling in and out over many seconds
  function padChord(t, ch, len) {
    const g = A.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + len * .4); g.gain.linearRampToValueAtTime(0, t + len);
    const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = .2; g.connect(lp); lp.connect(mBus); lp.connect(mRev);
    for (const d of ch) for (const det of [-5, 5]) { const o = A.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(midiOf(d) - 12); o.detune.value = det; o.connect(g); o.start(t); o.stop(t + len + .1); }
  }
  function quietMoment(h) {
    const H = ctx.hero; if (!H) return false;
    const idle = H.inBed || /read|sleep|sit|telescope|listen|diary|tea/.test(String(H.task || '')) || H.state === 'idle';
    return idle && now - lastActT > 20;
  }
  function tickMusic(h, dt) {
    if (!musicOn) { if (mBus && mSession) { holdGain(mBus.gain, A.currentTime); mBus.gain.setTargetAtTime(0, A.currentTime, 1.5); mSession = 0; } return; }
    const t = A.currentTime;
    // ducking under the hero's own sounds
    const dk = t < duckUntil; if (mDuck && dk !== tickMusic.dk) { tickMusic.dk = dk; holdGain(mDuck.gain, t); mDuck.gain.setTargetAtTime(dk ? .3 : 1, t, dk ? .15 : 1.2); }
    if (!mSession) {
      if (now < mRestUntil) return;
      const dusk = h >= 18.3 && h < 20.6, day = Math.floor(gnow / 180);
      let start = !!tickMusic.force; tickMusic.force = false;
      if (dusk && mDuskDay !== day && Math.random() < .7) { start = true; mDuskDay = day; }
      else if (quietMoment(h) && Math.random() < dt / 90) start = true;                // in a quiet moment: about once in a minute and a half
      if (!start) return;
      musicGraph(); mSession = now + rnd(60, 120); mNext = now + 1.5; mPhrase = null;
      holdGain(mBus.gain, t); mBus.gain.linearRampToValueAtTime(.5, t + 6);
      padChord(t + .5, pick(CHORDS), rnd(14, 20)); mPad = now + rnd(12, 18);
      return;
    }
    if (now > mSession) {                                          // the session fades away
      holdGain(mBus.gain, t); mBus.gain.setTargetAtTime(0, t, 3); mSession = 0; mRestUntil = now + rnd(150, 300); return;
    }
    if (now > mPad) { padChord(t, pick(CHORDS), rnd(14, 22)); mPad = now + rnd(14, 22); }
    if (now < mNext) return;
    if (!mPhrase || !mPhrase.length) {                             // a new phrase after a breath of silence
      const M = pick(MOTIFS), oct = Math.random() < .3 ? 7 : 0, tempo = rnd(.55, .8);
      mPhrase = M.map(([d, l]) => [d + oct, l * tempo]); mNext = now + rnd(2.5, 7); if (Math.random() < .25) mNext += rnd(5, 10); return;
    }
    const [d, l] = mPhrase.shift();
    mNote(midiOf(d) + 12, t + .02, rnd(.07, .1), rnd(-.35, .35));
    if (Math.random() < .18) mNote(midiOf(d) + 24, t + .02 + rnd(.01, .03), .025, rnd(-.5, .5));   // a faint octave sparkle now and then
    mNext = now + l * rnd(.9, 1.15);
  }
  function setMusic(b) { musicOn = !!b; try { localStorage.setItem('th_music', musicOn ? '1' : '0'); } catch (e) {} if (!musicOn && mBus) { holdGain(mBus.gain, A.currentTime); mBus.gain.setTargetAtTime(0, A.currentTime, .4); } }

  function setMute(b) {
    muted = !!b; try { localStorage.setItem('th_mute', muted ? '1' : '0'); } catch (e) {}
    if (master) { holdGain(master.gain, A.currentTime); master.gain.setTargetAtTime(muted ? 0 : MASTER, A.currentTime, .15); }
    if (muted) for (const v of voices) try { v.src.stop(A.currentTime + .7); } catch (e) {}   // after the master has faded: no click
  }
  // phones: stop the audio clock in the background
  document.addEventListener('visibilitychange', () => { if (!A) return; if (document.hidden) A.suspend(); else if (started) A.resume(); });

  const api = {
    start, update, mute: setMute, muted: () => muted, started: () => started, loaded: () => loaded, actionsReady: () => actLoaded, actions: () => Object.keys(ACT).concat(Object.keys(ALIAS)),
    music: b => { if (b !== undefined) setMusic(b); return musicOn; }, musicNow: () => { mRestUntil = 0; mSession = 0; tickMusic.force = true; },
    loop: loopAct, carry: b => { carrying = !!b; if (b) playAct('grunt'); }, autoSleep: b => { autoSleep = !!b; },
    footstep: (side, pos, o = {}) => { autoFeet = false; const q = toPos(pos); step(side, q, o.surface || surfaceAt(q, envNow), o.gain ?? 1); },
    on: (k, f) => { (LS[k] = LS[k] || []).push(f); return () => { LS[k] = LS[k].filter(x => x !== f); }; },
    setSeason: s => { season0 = s || null; populate(Object.keys(L), { season: season(), rain: 0, wind }); },
    state: () => { const cp = ctx.camera ? ctx.camera.position : P0; const tb = ctx.bones && (ctx.bones.LeftToeBase || ctx.bones.LeftFoot), hr = ctx.hero && ctx.hero.root; const toe = tb && hr ? +(tb.getWorldPosition(new tb.position.constructor()).y - hr.position.y).toFixed(3) : null;
      const ext = { toe, autoFeet, feet: dbgF, indoor: +inK.toFixed(2), cam: [+cp.x.toFixed(1), +cp.y.toFixed(1), +cp.z.toFixed(1)], decodedS: Math.round(decodedS), decoded: Object.keys(B).length }; const h = ctx.hour ? ctx.hour() : 12, env = { season: season(), rain: ctx.rain ? ctx.rain() : 0, wind, awake: true }; const layers = {}; for (const k in L) layers[k] = +(L[k].act(h, env) * (mult[k] ?? 0)).toFixed(2); return { ...ext, loaded, season: env.season, wind: +wind.toFixed(2), rain: +env.rain.toFixed(2), voices: [...voices].map(v => v.name), layers }; },
    node: () => master, log: () => LOG.slice(),
    play: playAct,
  };
  window.__audio = api;
  return api;
}
