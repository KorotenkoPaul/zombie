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
    act: (h, e) => nightW(h, 19.8, 5.2, 1.4) * SEASON_K(e.season, { summer: 1, spring: .55, autumn: .4, winter: 0 }) * (1 - .75 * e.rain),
    texture: [2.5, 6], gap: [.3, 2.5], rest: [.3, 2.5] },
  frog: { clips: ['frog_a', 'frog_b', 'frog_c', 'frog_d', 'toad_a'], n: 3, place: 'pond', vol: .34, pitch: .06, p: .9,
    pondy: 1,
    act: (h, e) => (nightW(h, 20.3, 4.6, 1.2) + .7 * win(h, 18.8, 20.6, .8)) * SEASON_K(e.season, { summer: 1, spring: 1, autumn: .25, winter: 0 }) * (1 + .7 * e.rain),
    bout: [1, 4], gap: [1, 3.5], rest: [5, 18] },
  owl: { clips: ['owl_a', 'owl_a', 'owl_c', 'owl_b'], n: 2, place: 'far', vol: .32, pitch: .04, p: .85, sticky: true,
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
  lap: { clips: ['slosh_a', 'slosh_b'], n: 3, place: 'pond', vol: .08, pitch: .06, p: 1, pondy: 1, rate: .62, rev: .15,
    act: (h, e) => SEASON_K(e.season, { winter: .1 }) * (.25 + e.wind),                       // little waves when the wind blows
    texture: [.6, 1.2], gap: [3, 8], rest: [1, 3] },   // mix review: was every 1-3 s, read as a constant wash
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
    act: (h, e) => SEASON_K(e.season, { autumn: .8, winter: .1, summer: 0, spring: .3 }) * (1 - e.rain) * (.35 + .65 * nightW(h, 19, 9, 1.5)),   // dew drips mostly at night and in the morning
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
  // play now if decoded, else right after decoding (a first use must not be lost)
  function vplay(k, o) { if (B[k] || k.startsWith('syn_')) return voice(k, o); decode(k).then(b => { if (b && !muted) voice(k, o); }); return null; }
  function getBuf(k) { if (k.charCodeAt(0) === 115 && k.startsWith('syn_')) return synBuf(k); const b = B[k]; if (b) { USED[k] = now; return b; } decode(k); return null; }
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
  let gameDay = 0, pondSig = null, pondFar = false, layerAcc = 0, now = 0, lastH = null, kick = 0, wasAsleep = null, wind = .3, windT = 0, rainMem = 0;
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
  // ---------- weather: drizzle / rain / storm / mist / calm, and thunder ----------
  // State from window.__weather (Wind): state() or .state = 'clear'|'calm'|'drizzle'|'rain'|'storm'|'mist'; else derived
  // from rain, wind and the hour. Lightning: __weather.on('lightning', {pos|dist, strength}) -> thunder after dist/343 s.
  // Without those events a storm still rumbles far away now and then (lightning hidden behind the trees).
  let wState = 'clear', wHooked = false, thunderNext = 0, noiseBuf = null;
  function weatherState(h, rain, wind) {
    const W = window.__weather;
    if (W) { try { const s = typeof W.state === 'function' ? W.state() : W.state; const v = typeof s === 'string' ? s : s && s.state; if (v) return v; } catch (e) {} }
    if (rain > .05) return rain > .75 && wind > .65 ? 'storm' : rain < .4 ? 'drizzle' : 'rain';
    if (h > 4.8 && h < 8.5 && wind < .35) return 'mist';
    if (h > 17.5 && h < 21.5 && wind < .3) return 'calm';
    return 'clear';
  }
  function hookWeather() {
    if (wHooked) return; const W = window.__weather; if (!W || typeof W.on !== 'function') return; wHooked = true;
    W.on('lightning', e => {
      if (!loaded || muted || !e) return; let d = e.dist;
      if (d == null && e.pos) { const q = e.pos, x = q.x ?? q[0], y = q.y ?? q[1], z = q.z ?? q[2]; d = Math.hypot(x, (y || 0) * .3, z); }
      thunder(d ?? rnd(400, 3000), e.strength ?? .7); thunderNext = now + rnd(25, 60);
    });
  }
  // procedural thunder: a crack (only when close) and a long rumble of low-passed noise with a few swells
  function thunder(dist, strength) {
    if (!A || muted) return;
    if (!noiseBuf) { const n = A.sampleRate * 2; noiseBuf = A.createBuffer(1, n, A.sampleRate); const d = noiseBuf.getChannelData(0); let b = 0; for (let i = 0; i < n; i++) { b = b * .6 + (Math.random() * 2 - 1) * .4; d[i] = b; } }
    const t = A.currentTime + Math.min(12, dist / 343), near = clamp01(1 - dist / 2500), len = 3.5 + 5 * (1 - near) + rnd(0, 2);
    const src = A.createBufferSource(); src.buffer = noiseBuf; src.loop = true; src.loopStart = 0; src.loopEnd = noiseBuf.duration; src.playbackRate.value = rnd(.5, .8);
    const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .4;
    lp.frequency.setValueAtTime(220 + 900 * near, t); lp.frequency.exponentialRampToValueAtTime(90 + 120 * near, t + len);
    const g = A.createGain(), peak = (.3 + .3 * near) * (.5 + .5 * strength);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak * (near > .6 ? 1 : .4), t + (near > .6 ? .03 : .6));
    let tt = t + (near > .6 ? .4 : 1.2);                                    // a few rolling swells
    for (let i = 0; i < 2 + Math.floor(rnd(0, 3)); i++) { g.gain.linearRampToValueAtTime(peak * rnd(.25, .5), tt); tt += rnd(.5, 1.2); g.gain.linearRampToValueAtTime(peak * rnd(.5, .9), tt); tt += rnd(.4, 1); }
    g.gain.linearRampToValueAtTime(peak * .2, Math.min(t + len - 1, tt + .5)); g.gain.exponentialRampToValueAtTime(.0005, t + len);
    const sp = A.createStereoPanner ? A.createStereoPanner() : null; if (sp) sp.pan.value = rnd(-.6, .6);
    src.connect(lp).connect(g); (sp ? g.connect(sp) : g).connect(outBus); const s2 = A.createGain(); s2.gain.value = .6; g.connect(s2).connect(revIn);
    src.start(t, rnd(0, 1.5)); src.stop(t + len + .1);
    if (near > .6) {                                                         // the crack of a close strike
      const c = A.createBufferSource(); c.buffer = noiseBuf; const hp = A.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = 1800; hp.Q.value = .5;
      const cg = A.createGain(); cg.gain.setValueAtTime(0, t); cg.gain.linearRampToValueAtTime(.35 * near * strength, t + .008); cg.gain.exponentialRampToValueAtTime(.001, t + .35);
      c.connect(hp).connect(cg).connect(outBus); c.start(t, rnd(0, 1)); c.stop(t + .4);
    }
    LOG.push([+now.toFixed(1), 'thunder ' + Math.round(dist) + 'm']); if (LOG.length > 60) LOG.shift();
  }
  // mist hushes the forest (softer, darker); a storm makes it rougher. Folded into the acoustics bus targets.
  let mistK = 0;
  // ---------- rooms: where the camera is decides what we hear ----------
  const LV = ctx.lv || { KT: 6.0, BD: 8.4, WS: 4.6 };   // index.html levels include HY = 1.0
  const ROOMS = ctx.rooms || [
    { n: 'kitchen', c: { x: -2.65, y: LV.KT + 1.05, z: 2.5 }, r: 2.8 },
    { n: 'bedroom', c: { x: -1.9, y: LV.BD + 1.1, z: 2.3 }, r: 2.6 },
    { n: 'workshop', c: { x: 2.75, y: LV.WS + 1.1, z: 2.9 }, r: 2.8 },
  ];
  // each room's own colour: the bedroom's quilts and bunks soak up the highs and the ring; the kitchen's pots, kettle and
  // bare walls ring brightest; the workshop's tools and timber sit between. Outside a room (deck, landings, ladders,
  // the roof) a sound is in the open air: forest bus and forest reverb, no room ring.
  const ROOMC = { kitchen: { send: 1.3, lp: 16000 }, bedroom: { send: .5, lp: 4800 }, workshop: { send: 1, lp: 9000 } };
  function roomOf(p) {
    let best = null, bd = 1e9;
    for (const R of ROOMS) { const dx = p.x - R.c.x, dy = (p.y - R.c.y) * 1.6, dz = p.z - R.c.z, d = Math.sqrt(dx * dx + dy * dy + dz * dz) / R.r; if (d < bd) { bd = d; best = R; } }
    return bd < 1.15 ? best : null;
  }
  // the two roofs (index.html buildTree roofs): x/z extent and base height; standing on one = shingles underfoot
  const ROOFS = ctx.roofs || [{ x0: -4.65, x1: .85, z0: .45, z1: 4.15, yb: 10.7 }, { x0: .45, x1: 5.05, z0: .65, z1: 4.35, yb: 6.9 }];
  const onRoof = p => ROOFS.some(R => p.x > R.x0 - .5 && p.x < R.x1 + .5 && p.z > R.z0 - .5 && p.z < R.z1 + .5 && p.y > R.yb - .3);
  function indoorK(p) {     // 0 outside .. 1 well inside a room
    let k = 0; for (const R of ROOMS) { const dx = p.x - R.c.x, dy = (p.y - R.c.y) * 1.6, dz = p.z - R.c.z; const d = Math.sqrt(dx * dx + dy * dy + dz * dz); k = Math.max(k, 1 - smooth(R.r * .8, R.r * 1.7, d)); }   // the rooms are open to the camera: being zoomed close counts as being in the room
    return k;
  }
  let inK = 0, inKa = -1;
  function acoustics(dt) {
    const c = ctx.camera; if (!c || !outLP) return;
    inK += (indoorK(c.position) - inK) * Math.min(1, dt * 2.5);
    mistK += ((wState === 'mist' ? 1 : 0) - mistK) * Math.min(1, dt * .3);
    const key = inK + mistK * 3.7; if (Math.abs(key - inKa) < .01) return; inKa = key; const t = A.currentTime;
    const cut = Math.min(NYQ * Math.pow(1500 / NYQ, inK), NYQ * Math.pow(4500 / NYQ, mistK));
    outLP.frequency.setTargetAtTime(cut, t, .15);   // open -> 1.5 kHz in a room, -> 4.5 kHz in the morning mist
    outBus.gain.setTargetAtTime((1 - .55 * inK) * (1 - .3 * mistK), t, .15);
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
    let room = null; if (o.indoor && o.pos && !o.bed) { room = roomOf(o.pos); if (!room) o = Object.assign({}, o, { indoor: false }); }
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
      const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.min(room ? Math.min(NYQ, ROOMC[room.n].lp) : NYQ, Math.max(1400, NYQ * Math.exp(-dist / (o.far ? 45 : 70)))); lp.Q.value = .5;
      const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 10; p.rolloffFactor = o.roll ?? .9; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      if (o.move) { const m = o.move; if (p.positionX) { p.positionX.setValueAtTime(o.pos.x, t); p.positionX.linearRampToValueAtTime(m.x, t + realDur); p.positionY.setValueAtTime(o.pos.y, t); p.positionY.linearRampToValueAtTime(m.y, t + realDur); p.positionZ.setValueAtTime(o.pos.z, t); p.positionZ.linearRampToValueAtTime(m.z, t + realDur); } }
      src.connect(lp).connect(g).connect(p).connect(o.indoor ? inBus : outBus); out = p;
    } else {
      const sp = A.createStereoPanner ? A.createStereoPanner() : null;
      const bus = o.indoor ? inBus : outBus; if (sp) { sp.pan.value = o.pan || 0; src.connect(g).connect(sp).connect(bus); } else src.connect(g).connect(bus);
    }
    const sendAmt = (o.rev ?? clamp01(.12 + dist / 60)) * (room ? ROOMC[room.n].send : 1);
    if (sendAmt > .01) { const s = A.createGain(); s.gain.value = sendAmt; g.connect(s).connect(o.indoor ? roomIn : revIn); }
    src.start(t, off, dur);
    const v = { src, g, end: t + realDur, name };
    LOG.push([+now.toFixed(1), name]); if (LOG.length > 60) LOG.shift();
    if (window.__audioTrace) window.__audioTrace.push([+t.toFixed(2), name, +(o.gain || 0).toFixed(3), +dist.toFixed(1), o.indoor ? (room ? room.n : 1) : 0]);   // mix QA only
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
    if (!S.texture && !S.uneasy) lastLife = now;
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
  // lull guard (mix review): the forest never goes quiet for long. After LULL seconds without a creature call every
  // active layer's hazard rises (up to x8) until something answers, so sparse autumn middays and the dusk hand-over stay alive.
  let lastLife = 0;
  const MUSIC_LVL = .2;   // mix review: was .5, the music box sat ~15 dB over the dusk forest
  function tickLayers(h, env, dt) {
    const LULL = h > 20.5 || h < 5 ? 6 : 7, lull = Math.min(8, 1 + 3 * Math.max(0, now - lastLife - LULL) / LULL);
    const morning = clamp01(win(h, 4.5, 9.5, 1)) * kick;
    { const P = pondGeo(), c = ctx.camera ? ctx.camera.position : P0; pondFar = Math.hypot(P.x - c.x, P.z - c.z) > 45; }
    for (const k in L) {
      const S = L[k], list = ind[k]; if (!list) continue;
      let act = S.act(h, env) * (mult[k] ?? 0);
      if (S.pondy && k !== 'frog' && pondFar) act = 0;               // nothing to hear from the pond from far away: no voices, no cost
      if (S.song) act *= (env.w === 'mist' ? .55 : 1) * (1 - .8 * env.rain) * (1 + morning * 1.2) * (env.awake || h < 4 || h > 10 ? 1 : .6);
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
        if (Math.random() < dt * Math.min(2, act * I.lazy * (S.uneasy ? 1 : lull)) / meanRest) {
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
    if (now - lastGust < 2.5 || (wState === 'calm' && amp < .6)) return; lastGust = now;   // calm evenings stay still
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
  // ---------- daytime critters (Ground): bird hops and pecks, squirrel chitter and claws on bark, wing flutters ----------
  // No clips (no SFX budget): small procedural buffers, synthesized once per variant, never evicted (~0.8 MB in all).
  // __ground.on('critter', {kind:'bird'|'squirrel'|'butterfly', act:'hop'|'peck'|'chitter'|'climb'|'flee'|'land', pos, id, dur})
  // or __audio.critter(e). Rate-limited per critter; dropped beyond 30 m. Butterflies are silent.
  const SYN = {};
  function synth(kind, v) {
    const sr = A.sampleRate, R = Math.random;
    const len = { peck: .5, hop: .7, flutter: .9, claws: 2.2, chitter: 1.4, sniff: 1.6, squeak: .3, rings: .7, breath: 3.9 }[kind], n = Math.floor(sr * len), d = new Float32Array(n);
    // RBJ band-pass, run in place over a segment
    const bp = (x, f, Q) => { const w = 2 * Math.PI * f / sr, al = Math.sin(w) / (2 * Q), a0 = 1 + al, b0 = al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0; let x1 = 0, x2 = 0, y1 = 0, y2 = 0; for (let i = 0; i < x.length; i++) { const y = b0 * x[i] - b0 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = y; x[i] = y; } return x; };
    const burst = (at, ms, f, Q, amp, tau) => { const m = Math.floor(sr * ms / 1000), s = Math.floor(at * sr); if (s >= n) return; const x = new Float32Array(m); for (let i = 0; i < m; i++) x[i] = (R() * 2 - 1) * Math.exp(-i / (sr * tau / 1000)); bp(x, f, Q); for (let i = 0; i < m && s + i < n; i++) d[s + i] += x[i] * amp; };
    if (kind === 'peck') { let t = .01; for (let k = 0, m = 2 + (v % 3); k < m; k++) { burst(t, 8, 2600 + R() * 1400, 2.5, 3, .7); burst(t, 20, 700, 1.2, .5, 3); t += .08 + R() * .07; } }
    else if (kind === 'hop') { let t = .01; for (let k = 0, m = 2 + (v % 2); k < m; k++) { burst(t, 30, 600 + R() * 300, 1, 1.2, 6); for (let j = 0; j < 4; j++) burst(t + R() * .03, 4, 3500 + R() * 2500, 2, .6 * R(), .6); t += .15 + R() * .1; } }
    else if (kind === 'flutter') { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = R() * 2 - 1; bp(x, 900 + v * 250, .7); let ph = 0; const T = .55 + v * .1;
      for (let i = 0; i < n; i++) { const t = i / sr, f = 24 - 10 * Math.min(1, t / T); ph += f / sr; const flap = Math.pow(Math.abs(Math.sin(Math.PI * ph)), 3); d[i] = x[i] * (.3 + .7 * flap) * Math.exp(-t / (T * .55)) * Math.min(1, t / .01) * 2.2; } }
    else if (kind === 'claws') { let t = .005; while (t < len - .05) { const g = 3 + Math.floor(R() * 4); for (let j = 0; j < g; j++) burst(t + j * (.009 + R() * .008), 4, 2200 + R() * 2800, 2.5, .5 + R(), .9); t += .06 + R() * .14; } }
    else if (kind === 'chitter') { let t = .01, gap = .085 + R() * .02; const m = 8 + Math.floor(R() * 8) + v * 2;
      for (let k = 0; k < m && t < len - .05; k++) { const s = Math.floor(t * sr), L = Math.floor(sr * (.02 + R() * .008)), f0 = 4300 + R() * 600, f1 = 2500 + R() * 400; let ph = 0;
        const nz = new Float32Array(L); for (let i = 0; i < L; i++) nz[i] = R() * 2 - 1; bp(nz, 3200, 2);
        for (let i = 0; i < L && s + i < n; i++) { const u = i / L, f = f0 + (f1 - f0) * u; ph += 2 * Math.PI * f / sr; const env = Math.min(1, u * 25) * Math.pow(1 - u, 1.5); d[s + i] += (Math.tanh(1.5 * Math.sin(ph)) * .55 + nz[i] * .9) * env * .5; }
        t += gap * (k > m * .6 ? .7 : 1) + R() * .012; } }
    else if (kind === 'sniff') { let t = .02; while (t < len - .1) { const m = 2 + Math.floor(R() * 3); for (let j = 0; j < m; j++) burst(t + j * (.07 + R() * .03), 45, 1800 + R() * 1400, 1.2, .5 + R() * .5, 14); t += .25 + R() * .35; } }   // a hedgehog snuffling through the leaves
    else if (kind === 'squeak') { const s0 = Math.floor(.01 * sr), L = Math.floor(sr * (.06 + v * .03)), f0 = 3800 + R() * 500; let ph = 0; for (let i = 0; i < L; i++) { const u = i / L; ph += 2 * Math.PI * (f0 + 900 * Math.sin(Math.PI * u)) / sr; d[s0 + i] += Math.sin(ph) * Math.sin(Math.PI * u) * .8; } }
    else if (kind === 'rings') { let t = .01; const m = 6 + Math.floor(R() * 5); for (let k = 0; k < m; k++) { burst(t, 30, 2600 + R() * 1600, 16, .4 + R() * .6, 7); t += .03 + R() * .06; } }   // curtain rings sliding on the rod
    else if (kind === 'breath') { const x = new Float32Array(n); let lp = 0; for (let i = 0; i < n; i++) { lp += ((R() * 2 - 1) - lp) * .16; x[i] = lp; } bp(x, 520 + v * 90, .6);   // a slow, quiet breath: in, a pause, a longer out
      const iA = .1, iB = 1.5, oA = 1.75, oB = 3.75; for (let i = 0; i < n; i++) { const t = i / sr; let e = 0; if (t > iA && t < iB) e = .45 * Math.sin(Math.PI * (t - iA) / (iB - iA)) ** 2; else if (t > oA && t < oB) e = Math.sin(Math.PI * Math.pow((t - oA) / (oB - oA), .7)) ** 2; d[i] = x[i] * e; } }
    { let y = 0; const a = 1 - Math.exp(-2 * Math.PI * 6500 / sr); for (let i = 0; i < n; i++) { y += a * (d[i] - y); d[i] = y; } }   // soften the edges: nothing synthetic-bright
    let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); const k = pk > 0 ? .9 / pk : 0; for (let i = 0; i < n; i++) d[i] *= k;
    const b = A.createBuffer(1, n, sr); b.getChannelData(0).set(d); return b;
  }
  function synBuf(name) { if (SYN[name]) return SYN[name]; const m = /^syn_(\w+)_(\d)$/.exec(name); if (!m || !A) return null; return SYN[name] = synth(m[1], +m[2]); }
  // night critters (Ground): hedgehog snuffles and rustles, curls up with a dry crackle; a mouse patters and squeaks
  const CRITK = { 'hedgehog.step': ['hop', .03, .3, 2, .7], 'hedgehog.sniff': ['sniff', .06, 1.5, 2, 1], 'hedgehog.curl': ['claws', .05, 1, 2, .6], 'hedgehog.uncurl': ['claws', .035, 1, 2, .55],
    'hedgehog.appear': ['hop', .03, 2, 2, .65], 'hedgehog.leave': ['hop', .025, 2, 2, .65],
    'mouse.step': ['claws', .02, .35, 2, 1.5], 'mouse.flee': ['claws', .04, .6, 2, 1.6], 'mouse.dash': ['claws', .035, .6, 2, 1.6], 'mouse.squeak': ['squeak', .025, 2, 2, 1],
    'mouse.appear': ['claws', .015, 2, 2, 1.4], 'mouse.leave': ['claws', .015, 2, 2, 1.4] };
  const CRIT = { hop: ['hop', .05, .12, 2], peck: ['peck', .05, .1, 3], chitter: ['chitter', .16, 3, 2], climb: ['claws', .07, .9, 2], flee: ['flutter', .14, .8, 3], land: ['flutter', .06, .8, 3] };
  const critLast = {}; let critHooked = false;
  function critter(e) {
    if (!loaded || muted || !e || e.kind === 'butterfly' || !A) return;
    const CK = CRITK[e.kind + '.' + e.act], C = CK || CRIT[e.act]; if (!C) return; const q = e.pos || [0, 0, 8], p = { x: q[0] ?? q.x, y: q[1] ?? q.y, z: q[2] ?? q.z };
    const l = listener(); if (Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) > 45) return;
    const id = (e.id || e.kind) + e.act; if (now - (critLast[id] ?? -9) < C[2]) return; critLast[id] = now;
    let kind = C[0]; if (e.kind === 'squirrel' && e.act === 'flee') kind = 'claws';
    if (e.kind === 'mouse' && (e.act === 'flee' || e.act === 'dash') && Math.random() < .5) critter({ kind: 'mouse', act: 'squeak', pos: e.pos, id: e.id });   // a startled squeak
    const name = 'syn_' + kind + '_' + Math.floor(Math.random() * C[3]);
    const dur = kind === 'claws' ? Math.min(2.1, e.dur || (CK ? rnd(.15, .45) : rnd(.6, 1.4))) : kind === 'sniff' ? Math.min(1.5, e.dur || rnd(.6, 1.4)) : undefined;
    voice(name, { pos: p, gain: C[1] * rnd(.8, 1.15) * (e.act === 'land' ? .7 : 1), rate: rnd(.9, 1.12) * (CK ? CK[4] : 1), dur, offset: kind === 'claws' ? rnd(0, .4) : 0,
      fadeIn: .004, fadeOut: kind === "claws" ? .12 : .05, ref: 4, roll: 1.2, rev: .12 });
  }
  function hookCritters() {
    if (critHooked) return; const G = window.__ground; if (!G || typeof G.on !== 'function') return; critHooked = true;
    G.on('critter', critter);
    // the bucket dips into the pond: a splash, then the water rushing in (the hero's own bucket_fill gurgle follows)
    G.on('pond', e => { if (!e || !loaded || muted || (e.act && e.act !== 'splash')) return; const k = clamp01(e.k ?? .7), q = toPos(e.pos);
      vplay(pick(['slosh_a', 'slosh_b']), { pos: q, gain: .22 + .3 * k, rate: rnd(1.05, 1.2), dur: rnd(.45, .7), offset: 0, fadeIn: .004, fadeOut: .2, ref: 3, roll: 1, rev: .25, prio: true });
      if (k > .4) vplay('drip_bucket_a', { pos: q, gain: .18 * k, rate: rnd(.6, .75), delay: rnd(.08, .16), fadeIn: .003, fadeOut: .15, ref: 3, roll: 1, rev: .3, prio: true }); });
  }

  // ---------- house sway (Wind): ropes strain, lantern hooks squeak, hinges creak, a loose shutter knocks ----------
  // __wind.on('sway', {part, id, pos:[x,y,z], amp 0..1, hit?}) at each swing reversal. Rate-limited per object and
  // overall; routed to the forest bus, so indoors it is quieter and muffled like the rest of the outside.
  // Parts (Wind, fc33e5b): 'landing lantern', telescope (gusts only), 'ladder-ground' / 'ladder-deck'. The door is Props' own.
  const SWAY = {
    ladder: { c: ['fs_rope_a', 'fs_rope_b'], g: [.05, .2], rate: [.7, .9], dur: [.5, .9], ref: 3 },
    rope: { c: ['fs_rope_a', 'fs_rope_b'], g: [.04, .16], rate: [.75, .95], dur: [.4, .8], ref: 3 },
    lantern: { c: ['creak_a'], g: [.03, .11], rate: [1.5, 1.9], dur: [.22, .38], ref: 2 },
    telescope: { c: ['creak_a'], g: [.03, .1], rate: [1.2, 1.4], dur: [.25, .4], ref: 2 },
    door: { c: ['creak_a'], g: [.05, .18], rate: [.85, 1.05], dur: [.6, 1.2], ref: 3 },
    shutter: { c: ['creak_a'], g: [.04, .15], rate: [1, 1.2], dur: [.4, .8], ref: 3 },
    hit: { c: ['shutter', 'trunk_door_close'], g: [.06, .22], rate: [.9, 1.1], dur: [.25, .4], ref: 3 },
  };
  const swayLast = {}; let swayHooked = false, swayLastT = -9;
  function swaySound(e) {
    if (!loaded || muted || !e) return;
    const amp = clamp01(e.amp ?? .5) * (.35 + .65 * clamp01(wind / .6)), key = e.hit ? 'hit' : e.part, S = SWAY[key] || SWAY.rope, id = (e.id || e.part || '?') + (e.hit ? '!' : '');
    if (now - (swayLast[id] ?? -9) < (e.hit ? .8 : rnd(2.5, 5)) || now - swayLastT < .3) return;
    if (amp < .12 || Math.random() > .25 + .7 * amp) return;                                   // small swings mostly pass in silence
    swayLast[id] = now; swayLastT = now;
    const q = e.pos || [rnd(-6, 6), rnd(9, 16), rnd(-3, 1)], dur = rnd(S.dur[0], S.dur[1]);
    voice(pick(S.c), { pos: { x: q[0] ?? q.x, y: q[1] ?? q.y, z: q[2] ?? q.z }, gain: S.g[0] + (S.g[1] - S.g[0]) * amp, rate: rnd(S.rate[0], S.rate[1]),
      offset: e.hit ? 0 : rnd(0, 1.2), dur, fadeIn: e.hit ? .005 : .06, fadeOut: Math.min(.25, dur * .4), ref: S.ref, roll: 1.2, rev: .18 });
  }
  function hookSway() {
    if (swayHooked) return; const W = window.__wind; if (!W || typeof W.on !== 'function') return; swayHooked = true;
    W.on('sway', swaySound);
  }
  let sleepNight = { snorer: false, spellEnd: 0, snoring: false }, wasAsleepS = false, idleBreath = 0;
  const nearCam = (p, r) => { const l = listener(); return Math.hypot(p.x - l.x, p.y - l.y, p.z - l.z) < r; };
  let dripNext = 0, creakNext = 6, autoSleep = true, snoreNext = 0, turnNext = 0;
  // ---------- footsteps: surface under the foot, at the moment the foot lands ----------
  // Character can drive them exactly with __audio.footstep(side, pos?, {surface}); until it does, audio.js watches
  // the toe bones itself: a foot that comes down to the floor after being lifted is a step.
  let frameDtG = .016, gameRate = 1, gnow = 0, breathNext = 0, clothNext = 0, moving = false, carrying = false, dbgF = null, autoFeet = true, ladderNext = 0, cadNext = 0, cadSide = 'L', frameDt = .016;
  const FT = { boards: ['step_wood_a', 'step_wood_b', 'step_wood_c'], dirt: ['fs_dirt_a', 'fs_dirt_b', 'fs_dirt_c'], wet: ['fs_wet_a', 'fs_wet_b', 'fs_wet_c'],
    leaves: ['fs_leaves_a', 'fs_leaves_b', 'fs_leaves_c'], ladder: ['fs_ladder_a', 'fs_ladder_b'], rope: ['fs_rope_a', 'fs_rope_b'], roof: ['step_wood_c', 'step_wood_a'] };
  const FV = { boards: .2, dirt: .2, wet: .22, leaves: .24, ladder: .22, rope: .24, roof: .15 };
  const footSt = { L: { armed: false }, R: { armed: false } };
  function surfaceAt(p, env) {
    if (onRoof(p)) return 'roof';
    if (p.y > .6) return 'boards';
    if (env.rain > .2 || rainMem > .3) return 'wet';
    if (env.season === 'autumn') return Math.random() < .65 ? 'leaves' : 'dirt';
    return 'dirt';
  }
  function step(side, pos, surface, gain = 1, delay = 0, shuffle = false) {
    if (!loaded || muted) return;
    const list = FT[surface] || FT.boards, q = toPos(pos);
    if (surface === 'roof' && Math.random() < .45) { const o2 = { pos: q, gain: .035 * gain, rate: rnd(1.1, 1.4), fadeIn: .003, fadeOut: .05, ref: 3, roll: 1, rev: .15, delay: rnd(.03, .09) }; voice('syn_peck_' + (Math.random() < .5 ? 0 : 1), o2); }   // a loose shingle ticks
    const clip = pick(list), o = { pos: q, gain: (FV[surface] || .2) * gain * rnd(.75, 1.05), rate: surface === 'roof' ? rnd(1.15, 1.3) : rnd(.9, 1.1), ref: 3, roll: 1, rev: .15, prio: true, indoor: q.y > .6, fadeIn: .005, fadeOut: .08, delay };
    if (shuffle) { o.gain *= .3; o.rate *= 1.08; o.dur = rnd(.1, .16); o.offset = rnd(.02, .06); o.fadeIn = .02; o.fadeOut = .06; o.prio = false; }   // a soft scuff
    if (B[clip]) voice(clip, o); else decode(clip).then(() => voice(clip, o));
  }
  const _w = { x: 0, y: 0, z: 0 };
  function feet(p, mv, vy, env) {
    const B2 = ctx.bones; if (!B2) return;
    const FL = window.__feetLog;                                            // QA only: per-frame foot heights and step times
    // climbing: a rung sound when a foot settles on the next rung (its world speed drops after a lift), from the bones
    if (Math.abs(vy) > .25 && mv < .35) { /* Pavel 2026-11-25: no breathing sounds at all */
      const surf = ctx.ropeAt && ctx.ropeAt(p) ? 'rope' : 'ladder', fdt = Math.max(1e-3, frameDtG);
      for (const [side, bn] of [['L', B2.LeftFoot || B2.LeftToeBase], ['R', B2.RightFoot || B2.RightToeBase]]) {
        if (!bn) continue; const w = bn.getWorldPosition(ctx.v3 || (ctx.v3 = new bn.position.constructor())), st = footSt[side];
        const fv = st.ly == null ? 0 : (w.y - st.ly) / fdt; st.ly = w.y;
        if (Math.abs(fv) > .55) st.rung = Math.sign(fv);                         // the foot is travelling to the next rung
        else if (st.rung && Math.abs(fv) < .12) { st.rung = 0; if (gnow > ladderNext) { step(side, w, surf); ladderNext = gnow + .18; if (FL) FL.push(['S', +gnow.toFixed(3), side, 'rung']); } }
      }
      if (gnow > ladderNext + 1.2) { step('L', { x: p.x, y: p.y + .2, z: p.z }, surf); ladderNext = gnow + rnd(.4, .55); }   // no bone signal (an old clip): a rung by cadence
      footSt.L.lx = footSt.R.lx = null; return; }
    footSt.L.rung = footSt.R.rung = 0; footSt.L.ly = footSt.R.ly = null;
    if (mv < .12) { footSt.L.armed = footSt.R.armed = false; footSt.L.lx = footSt.R.lx = footSt.L.lsp = footSt.R.lsp = footSt.L.lsp2 = footSt.R.lsp2 = null; moving = false; return; }
    // clothes rustle as he sets off, and now and then on the way; heavier breath when carrying something
    if (!moving || gnow > clothNext) { if (!moving && Math.random() < .55 || moving) playAct('cloth', { x: p.x, y: p.y + 1.1, z: p.z }); clothNext = gnow + rnd(4, 9); }
    moving = true;
    // (no heavy breathing when carrying: Pavel 2026-11-25, he does not want to hear him breathe)
    // slow frames (a weak phone, a background tab): the toe lift falls between frames, so walk by cadence instead
    if (frameDt > .08 && !window.__feetBones) { if (gnow > cadNext) { cadSide = cadSide === 'L' ? 'R' : 'L'; step(cadSide, p, surfaceAt(p, env), Math.min(1.2, .6 + mv * .4)); cadNext = gnow + .62 / Math.max(.6, mv); } return; }
    // foot contact from the bones: a foot in swing travels at 2-3x walking speed, a planted foot stands still. The strike is
    // the moment the swinging foot stops (its world speed drops through a threshold scaled to the walk). It is predicted
    // from the deceleration, so the sound is scheduled inside the frame, not a frame late. (The new hero lifts the heel
    // only 4-6 cm, so height alone misses steps.)
    const fdt = Math.max(1e-3, frameDtG);
    for (const [side, hb, tb] of [['L', B2.LeftFoot, B2.LeftToeBase], ['R', B2.RightFoot, B2.RightToeBase]]) {
      const bn = hb || tb; if (!bn) continue; const w = bn.getWorldPosition(ctx.v3 || (ctx.v3 = new bn.position.constructor()));
      const st = footSt[side]; const sp = st.lx == null ? 0 : Math.hypot(w.x - st.lx, w.z - st.lz) / fdt; st.lx = w.x; st.lz = w.z;
      const rx = w.x - p.x, rz = w.z - p.z, still = st.rx != null && Math.hypot(rx - st.rx, rz - st.rz) < 2e-4; st.rx = rx; st.rz = rz;
      if (still && sp > .2) continue;                                          // the pose was not advanced this frame (the foot only rode along with the root)
      const prev = st.lsp ?? sp; st.lsp = sp;
      if (FL) FL.push(['H', +gnow.toFixed(3), side, +sp.toFixed(3), +mv.toFixed(3)]);
      const up = Math.max(1.1, 1.5 * mv), thr = Math.max(.3, .3 * mv);
      const med = Math.max(Math.min(sp, prev), Math.min(Math.max(sp, prev), st.lsp2 ?? sp)); st.lsp2 = prev;   // median of 3: a one-frame foot snap is not a swing
      if (med > up && gnow - (st.last ?? -9) > .3) { if (!st.armed) st.peak = 0; st.armed = true; }        // one strike per stride: never twice within .3 s
      if (st.armed) st.peak = Math.max(st.peak || 0, med);
      const shuf = (st.peak || 0) < Math.max(1.6, 1.9 * mv);                    // a small re-plant (turning, starting, stopping): a soft shuffle, not a footstep
      if (st.armed && !(med > up)) {
        const next = sp + (sp - prev);                                          // the speed one frame on
        if (sp < thr) { st.armed = false; st.last = gnow; step(side, w, surfaceAt(w, env), Math.min(1.2, .6 + mv * .4), 0, shuf); if (FL) FL.push(['S', +gnow.toFixed(3), side, shuf ? 'shuffle' : 'now']); }
        else if (sp < prev && sp < 2.2 * thr && next < thr) { st.armed = false; st.last = gnow; const dl = Math.min(fdt, fdt * (sp - thr) / Math.max(1e-3, sp - next)) / Math.max(.25, gameRate); step(side, w, surfaceAt(w, env), Math.min(1.2, .6 + mv * .4), dl, shuf); if (FL) FL.push(['S', +(gnow + dl * gameRate).toFixed(3), side, shuf ? 'shuffle' : 'pred']); }
      }
    }
  }
  const lastHero = { x: 0, y: 0, z: 0 };

  function update(dt) {
    if (!started || !A) return;
    syncListener();
    if (!loaded || muted || A.state !== 'running') return;
    // real seconds from the audio clock: the frame dt is clamped and slows down on weak devices
    const pn = performance.now() / 1000, rawDt = update.pn ? pn - update.pn : .016; update.pn = pn;
    const gdt = Math.max(1e-3, dt); gnow += gdt; frameDtG = gdt; gameRate = gameRate * .9 + Math.min(4, gdt / Math.max(1e-3, rawDt)) * .1;   // game-time frame step (the hero's animation runs on it)
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
    hookWind(); hookWeather(); hookSway(); hookCritters();
    wState = weatherState(h, rain, wind); env.w = wState;
    if (wState === 'storm' && !wHooked && now > thunderNext) { if (thunderNext > 0) thunder(rnd(1200, 4000), rnd(.4, .8)); thunderNext = now + rnd(25, 60); }
    // the hero getting up in the morning wakes the garden
    if (wasAsleep && !asleep && h > 4 && h < 10.5) kick = 1;
    wasAsleep = asleep; kick = Math.max(0, kick - dt / 180);   // the wake-up chorus fades over ~3 game hours (1 game hour = 1 real minute)
    // a new night / a new day: new personalities, new territories
    if (lastH === null) { populate(Object.keys(L), env); }
    else {
      if (lastH < 18 && h >= 18) populate(NIGHT, env);
      if (lastH < 4 && h >= 4) populate(DAY, env);
      if (h < lastH - 12) gameDay++;                                    // midnight
    }
    lastH = h;
    { const P = pondGeo(), sig = P.x + P.z * 7 + P.r * 13; if (sig !== pondSig) { if (pondSig !== null) for (const k in L) if (L[k].pondy && ind[k]) for (const I of ind[k]) I.pos = place('pond'); pondSig = sig; } }
    layerAcc += dt; if (layerAcc >= .1) { tickLayers(h, env, layerAcc); layerAcc = 0; }   // creatures decide 10x a second, not every frame
    gusts(env);
    // rain on leaves and roof
    // rain: leaves all around, and drumming on the roof when the camera (or hero) is near one
    const R = window.__rain, cp = ctx.camera ? ctx.camera.position : null;
    let roof = .35; if (R && typeof R.roofNear === 'function' && cp) { try { roof = clamp01(R.roofNear(cp)); } catch (e) {} }
    const rk = wState === 'drizzle' ? .55 : wState === 'storm' ? 1.35 : 1;   // drizzle: a fine whisper; storm: heavy
    bed('rain', ['rain_a'], rain * rk, l => ({ gain: .34 * l, pan: rnd(-.5, .5), offset: rnd(0, 3), rev: .1, rate: wState === 'drizzle' ? 1.1 : wState === 'storm' ? .92 : 1 }));
    // the roofs are slate: hard, dense tapping. Inside a room it is right above us (house bus, not muffled with the forest)
    bed('roof', ['rain_slate_a', 'rain_slate_b'], rain * Math.min(1, .15 + .85 * Math.max(roof, inK)), l => ({ gain: (.3 + .25 * inK) * l, pan: rnd(-.3, .3), offset: rnd(0, 3), rev: .05, indoor: true }));
    rainMem = rain > .3 ? 1 : Math.max(0, rainMem - dt / 120);   // the ground stays wet ~2 game hours after rain
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
      // a night has its own sleeper: some nights he snores in spells, some nights only breathes; between snores, slow breaths
      if (!wasAsleepS) { sleepNight = { snorer: Math.random() < .55, spellEnd: now + rnd(60, 200), snoring: false }; }
      const SN = sleepNight; if (now > SN.spellEnd) { SN.snoring = SN.snorer && !SN.snoring && Math.random() < .7; SN.spellEnd = now + (SN.snoring ? rnd(90, 300) : rnd(120, 420)); }
      if (now > snoreNext) { if (snoreNext > 0) { if (SN.snoring) playAct('snore', at); /* between snores: silence, no breathing (Pavel 2026-11-25) */ }
        snoreNext = now + (SN.snoring ? rnd(4.5, 7) : rnd(4.2, 5.6)); }
      if (now > turnNext) { if (turnNext > 0) playAct('bed_turn', at); turnNext = now + rnd(35, 90); }
    } else { snoreNext = now + rnd(4, 9); turnNext = now + rnd(25, 60); }
    wasAsleepS = asleep;
    // old planks creak under the hero now and then
    if (hero && hero.root) {
      const p = hero.root.position, mv = Math.hypot(p.x - lastHero.x, p.z - lastHero.z) / gdt, vy = (p.y - lastHero.y) / gdt;
      lastHero.x = p.x; lastHero.y = p.y; lastHero.z = p.z;
      frameDt = frameDt * .8 + Math.min(.5, rawDt) * .2;
      dbgF = [+mv.toFixed(2), +vy.toFixed(2), +frameDt.toFixed(3), +p.y.toFixed(2)];
      if (autoFeet) feet(p, mv, vy, env);
      houseWatch(hero, mv); toolSync(hero, mv);
      // (no idle breathing sound: Pavel 2026-11-25 asked to remove his breathing entirely)
      if (mv > .4 && p.y > 1.2 && now > creakNext) { voice('creak_a', { pos: { x: p.x, y: p.y, z: p.z }, gain: rnd(.12, .22), rate: rnd(.85, 1.15), dur: rnd(.5, 1.1), offset: rnd(0, 1), ref: 2.5, roll: 1.2, rev: .2, indoor: true }); creakNext = now + rnd(4, 14); }
    }
  }

  // ---------- tool contact (hammer hits, saw strokes, stir scrapes) ----------
  // Character can send exact contacts: __audio.contact({tool, kind:'hit'|'stroke'|'scrape', pos, strength, dur, dir}).
  // Until it does, they are read from the right hand while it holds a tool: a hammer hits when the downward swing stops,
  // a saw stroke starts at each reversal along the facing direction (and lasts as long as the last one did), a stir scrape
  // plays at each peak of hand speed. While this runs, hero.js's timer-based hammer / nails / saw calls are muted.
  let toolAuto = true; const TS = { tool: null, lx: 0, ly: 0, lz: 0, vy: 0, vs: 0, s: 0, ls: null, lt: 0, strokeT: .45, sp: 0, lsp: 0, last: -9 };
  const TOOLK = n => !n ? null : /hammer/i.test(n) ? 'hammer' : /saw/i.test(n) ? 'saw' : /ladle|spoon/i.test(n) ? 'spoon' : null;
  function contact(e, internal) {
    if (!e || !loaded || muted) return; if (!internal) toolAuto = false;
    if (window.__feetLog) window.__feetLog.push(['TC', +gnow.toFixed(3), e.tool || e.kind, +(e.dur || 0).toFixed(2)]);
    const q = toPos(e.pos), k = clamp01(e.strength ?? .8), t = e.tool;
    if (t === 'hammer' || e.kind === 'hit') { TS.last = now; if (now - (TS.hitT ?? -9) < .2) return; TS.hitT = now; playAct('hammer', q, { gain: .55 + .5 * k, internal: 1 }); return; }   // one sample per blow (critic pass 27: a nail layer on the same frame read as two hits)
    if (t === 'saw' || e.kind === 'stroke') { const d = Math.max(.15, Math.min(1.2, e.dur || .45)); const a = ACT.saw, o = actOpts(a, q, {}); o.gain *= .45 + .55 * k; o.rate = (e.dir < 0 ? .92 : 1.04) * rnd(.97, 1.03); o.dur = d; o.offset = rnd(0, 1.5); o.fadeIn = .03; o.fadeOut = Math.min(.12, d * .3); const c = pick(a.c); vplay(c, o); TS.last = now; return; }
    if (t === 'spoon' || e.kind === 'scrape') { const d = Math.max(.15, Math.min(.8, e.dur || .35)); const a = ACT.stir, o = actOpts(a, q, {}); o.gain *= .35 + .6 * k; o.dur = d; o.offset = rnd(0, 2); o.fadeIn = .04; o.fadeOut = d * .4; const c = pick(a.c); vplay(c, o); TS.last = now; }
  }
  function toolSync(hero, mv = 0) {
    if (!toolAuto || !hero || !hero.hold || !ctx.bones || !ctx.bones.RightHand) { TS.tool = null; return; }
    const h = hero.hold.Right, tool = TOOLK(h && (h.tool || h.name || (typeof h === 'string' ? h : '')));
    if (tool !== TS.tool) { TS.tool = tool; TS.ls = null; TS.vy = 0; TS.sp = TS.lsp = 0; TS.ext = TS.ext0 = null; TS.lt = 0; TS.pk = 0; }
    if (!tool) return;
    const fdt = Math.max(1e-3, frameDtG), r = hero.root, w = ctx.bones.RightHand.getWorldPosition(ctx.v6 || (ctx.v6 = new r.position.constructor()));
    const x = w.x - r.position.x, y = w.y - r.position.y, z = w.z - r.position.z;
    if (TS.ls === null) { TS.lx = x; TS.ly = y; TS.lz = z; TS.ls = 0; TS.lt = gnow; return; }
    const vx = (x - TS.lx) / fdt, vy = (y - TS.ly) / fdt, vz = (z - TS.lz) / fdt; TS.lx = x; TS.ly = y; TS.lz = z;
    const at = { x: w.x, y: w.y - .05, z: w.z };
    if (window.__feetLog) window.__feetLog.push(['TH', +gnow.toFixed(3), tool, +y.toFixed(3), +vy.toFixed(2), +(vx * Math.sin(r.rotation.y) + vz * Math.cos(r.rotation.y)).toFixed(2), +Math.hypot(vx, vz).toFixed(2)]);
    if (tool === 'hammer') {                                        // the head comes down fast, then stops on the nail
      // impact: after a downswing (peak < -1 m/s) the hand brakes hard on the nail; the hit is when its speed falls under
      // 40 % of the peak, interpolated inside the frame
      if (mv > .15 || hero.path && hero.path.length) { TS.pk = 0; TS.vy = vy; return; }   // walking with the hammer: the arm swing is no blow if (vy < -1) TS.pk = Math.min(TS.pk || 0, vy);
      if ((TS.pk || 0) < -1 && vy > .4 * TS.pk) { const k = clamp01((.4 * TS.pk - TS.vy) / Math.max(1e-3, vy - TS.vy)), dl = Math.max(0, (1 - k) * fdt) * 0;
        if (gnow - (TS.hitG ?? -9) > .25) { TS.hitG = gnow; contact({ tool: 'hammer', kind: 'hit', pos: at, strength: clamp01(-TS.pk / 3) }, true); } TS.pk = 0; }
      if (vy > .3) TS.pk = 0;                                        // lifted again without a hit
      TS.vy = vy; return;
    }
    if (tool === 'saw') {                                           // strokes along the way he faces: a reversal is 1.5 cm back from the last extreme
      const f = r.rotation.y, sx = x * Math.sin(f) + z * Math.cos(f);
      if (TS.ext == null) { TS.ext = TS.ext0 = sx; TS.dir = 1; }
      if (TS.dir > 0 ? sx > TS.ext : sx < TS.ext) TS.ext = sx;             // follow the stroke to its end
      if (Math.abs(sx - TS.ext) > .008) {                                   // it came back 8 mm: the stroke turned
        const nd = -TS.dir, half = TS.lt ? Math.min(1, Math.max(.2, gnow - TS.lt)) : TS.strokeT; TS.strokeT = half; TS.lt = gnow;
        const amp = Math.abs(TS.ext - TS.ext0); TS.ext0 = TS.ext; TS.ext = sx; TS.dir = nd;
        if (amp > .012) contact({ tool: "saw", kind: 'stroke', pos: at, strength: clamp01(.35 + amp / .15), dur: half / Math.max(.25, gameRate), dir: nd }, true);
      }
      return;
    }
    if (tool === 'spoon') {                                         // a scrape at each peak of the stirring hand's speed
      const sp = Math.hypot(vx, vz); if (TS.lsp > TS.sp && TS.lsp > sp && TS.lsp > .15 && gnow - (TS.scrG ?? -9) > .45) { TS.scrG = gnow; contact({ tool: 'spoon', kind: 'scrape', pos: at, strength: clamp01(TS.lsp / .5), dur: .5 / Math.max(.25, gameRate) }, true); }
      TS.sp = TS.lsp; TS.lsp = sp;
    }
  }

  // ---------- house watchers: the hatch lid, the door bolt, repairs, dishes ----------
  // Sounds follow the house's real state, read each frame (cheap): Tree's hatch (window.__house.hatch), Props' door bolt
  // and dishes, and the hero's current task. So they are right whoever moves things (the hero, Brain's lockdown, a test).
  const HW = { hatch: null, bolt: null, rack: null, task: null, taskT: 0, next: 0, loop: null, hatchT: -9 };
  // task foley while he works (standing at the job, not walking): [action or clip, every [a,b] s, gain, rate]
  const TASKF = {
    // repairs (fix_*, clear_roof) have NO timer foley (Pavel 2026-11-25: a constant scraping from the moment he took the hammer,
    // even walking to the job). hero.js sends each repair sound on its own animation event instead: a hammer hit exactly when
    // the face meets the nail (__audio.contact), a rag / rope / hinge sound at each stroke of the hands (wipeWindow), the
    // clear_roof sweep at each peak of the raking hand's speed. Nothing plays while he walks or stands.
    //
    //
    //
    dishes: [['plate', [3.5, 6], .55, 1.05], ['cup', [6, 10], .5, 1]],
  };
  function houseWatch(hero, mv) {
    const hc = window.__house && window.__house.hatch;
    if (hc && hc.isOpen) { const o = hc.isOpen(); if (HW.hatch !== null && o !== HW.hatch && now - HW.hatchT > 1.5) { const g = hc.grab; playAct(o ? 'hatch_open' : 'hatch_close', g ? { x: g.x, y: g.y, z: g.z } : undefined); HW.hatchT = now; } HW.hatch = o; }
    const P = window.__props, D = P && P.door;
    if (D && D.boltKnob) { const b = D.bolt > .5; if (HW.bolt !== null && b !== HW.bolt) playAct(b ? 'bolt_lock' : 'bolt_open', D.boltKnob(new (ctx.camera.position.constructor)())); HW.bolt = b; }
    if (P && P.dishes && P.dishes.state) {   // a plate put away from the rack onto the shelf: a soft clack each, staggered
      const r = P.dishes.state().rack; if (HW.rack !== null && r < HW.rack && P.point) { const sp = P.point('sink'); for (let i = 0; i < HW.rack - r; i++) playAct(i % 2 ? 'cup' : 'plate', sp, { delay: .35 + i * rnd(.45, .7), gain: .8 }); } HW.rack = r; }
    if (P && P.oven && P.oven.handle) {             // the oven door: a hand on the iron latch, then the hinge
      const k = P.oven.open; if (HW.oven != null) { if (HW.oven < .15 && k >= .15) playAct('oven_open', P.oven.handle()); else if (HW.oven > .08 && k <= .08) playAct('oven_close', P.oven.handle()); } HW.oven = k; }
    if (hero && hero.hold) {                          // a tool taken from its hook or shelf, and hung back
      for (const hd of ['Left', 'Right']) { const o = hero.hold[hd] || null, was = HW['h' + hd]; if (was !== undefined && o !== was) { const hp = hero.root.position; playAct('tool', { x: hp.x, y: hp.y + 1.1, z: hp.z }, o ? {} : { gain: .6, rate: .92 }); } HW['h' + hd] = o; } }
    const task = HW.force || hero && hero.task || null;
    if (task !== HW.task) { HW.task = task; HW.taskT = now; HW.next = {}; if (HW.loop) { HW.loop.stop(.8); HW.loop = null; } }
    const working = task && mv < .15 && now - HW.taskT > 1.5;
    if (task === 'dishes') {                          // the tap runs and the dishes splash while he washes
      if (working && !HW.loop && P && P.point) { const sp = P.point('sink'); HW.loop = { a: loopAct('tap', sp, { gain: .7 }), b: loopAct('wash', sp) }; HW.loop.stop = f => { HW.loop.a && HW.loop.a.stop(f); HW.loop.b && HW.loop.b.stop(f); }; }
      if (!working && HW.loop && mv > .3) { HW.loop.stop(.8); HW.loop = null; }
    }
    const F = working && TASKF[task]; if (!F) return;
    const hp = hero.root.position, at = { x: hp.x, y: hp.y + 1, z: hp.z };
    F.forEach((f, i) => {
      if (HW.next[i] == null) { HW.next[i] = now + rnd(.3, f[1][0]); return; } if (now < HW.next[i]) return; HW.next[i] = now + rnd(f[1][0], f[1][1]);
      if (f[0] === '@squeak') { const k = Math.max(.25, 1 - (now - HW.taskT) / 25); voice('creak_a', { pos: at, gain: .2 * k, rate: rnd(1.35, 1.6), dur: rnd(.3, .6), offset: rnd(0, 1), ref: 2.5, roll: 1, rev: .2, indoor: true, fadeIn: .02, fadeOut: .1 }); return; }   // the oiled hinge squeaks less and less
      if (ACT[f[0]] || ALIAS[f[0]]) playAct(f[0], at, { gain: f[2], rate: f[3] });
      else voice(f[0], { pos: at, gain: .3 * f[2], rate: f[3] * rnd(.95, 1.05), dur: rnd(.6, 1.2), offset: rnd(0, 1), ref: 3, roll: 1, rev: .2, indoor: true, fadeIn: .05, fadeOut: .25 });
    });
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
    curtain: { c: ['cloth_a', 'cloth_b'], v: .3, rings: 1 }, curtain_close: { c: ['cloth_a', 'cloth_b'], v: .3, rings: 1 }, curtain_open: { c: ['cloth_b', 'cloth_c'], v: .28, rings: 1 },
    shutter_close: { c: ['shutter'], v: .45 }, shutter_open: { c: ['window_open'], v: .4 }, board_up: { c: ['plank_place'], v: .45, nails: 1 },
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
    if (!A || muted || !loaded || /^breath/.test(name)) return null; // no breathing sounds (Pavel 2026-11-25)
    if (L[name]) { const I = ind[name] && ind[name][0]; if (I) call(name, I, 1, envNow); return null; }
    if (name === 'bolt') return null;
    if (!o.internal && TS.tool && toolAuto && ((TS.tool === 'hammer' && /^(hammer|nails)$/.test(name)) || (TS.tool === 'saw' && name === 'saw') || (TS.tool === 'spoon' && name === 'stir'))) return null;   // contact-synced instead                                  // houseWatch plays lock / unlock from the door's real bolt
    if (/^hatch_/.test(name)) { if (now - HW.hatchT < 1.5) return null; HW.hatchT = now; }
    const a = ACT[name] || ACT[ALIAS[name]];
    const clip = a ? pick(a.c) : RAW[name] ? name : null;
    if (!clip) { console.warn('audio: no sound', name); return null; }
    if (a && a.body) { if (A.currentTime < bodyUntil) return null; }
    const opts = actOpts(a || { v: .4 }, pos, Object.assign({ outdoor: a && a.out }, o));
    if (a && (a.body || a === ACT.cloth)) opts.prio = false;   // a breath is the first thing to give up its voice
    if (a && a.body) bodyUntil = A.currentTime + 1.6;
    if (a && a.rings) voice('syn_rings_' + Math.floor(Math.random() * 2), Object.assign({}, opts, { gain: .05, rate: rnd(.9, 1.1), delay: (opts.delay || 0) + .05, fadeIn: .003, fadeOut: .1 }));   // the rings run along the rod
    if (a && a.nails) for (let i = 0; i < 3; i++) playAct('nails', pos, { delay: .9 + i * rnd(.5, .8) });
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
      const dusk = h >= 18.3 && h < 20.6, day = gameDay;   // one dusk session at most per game day
      let start = !!tickMusic.force; tickMusic.force = false;
      if (dusk && mDuskDay !== day && Math.random() < .7) { start = true; mDuskDay = day; }
      else if (quietMoment(h) && Math.random() < dt / 90) start = true;                // in a quiet moment: about once in a minute and a half
      if (!start) return;
      if (window.__audioTrace) window.__audioTrace.push([+A.currentTime.toFixed(2), 'MUSIC', 0, 0, 0]);
      musicGraph(); mSession = now + rnd(60, 120); mNext = now + 1.5; mPhrase = null;
      holdGain(mBus.gain, t); mBus.gain.linearRampToValueAtTime(MUSIC_LVL, t + 6);
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
      const ext = { quiet: +(now - lastLife).toFixed(1), w: wState, toe, autoFeet, feet: dbgF, indoor: +inK.toFixed(2), cam: [+cp.x.toFixed(1), +cp.y.toFixed(1), +cp.z.toFixed(1)], decodedS: Math.round(decodedS), decoded: Object.keys(B).length }; const h = ctx.hour ? ctx.hour() : 12, env = { season: season(), rain: ctx.rain ? ctx.rain() : 0, wind, awake: true }; const layers = {}; for (const k in L) layers[k] = +(L[k].act(h, env) * (mult[k] ?? 0)).toFixed(2); return { ...ext, loaded, season: env.season, wind: +wind.toFixed(2), rain: +env.rain.toFixed(2), voices: [...voices].map(v => v.name), layers }; },
    node: () => master, log: () => LOG.slice(),
    play: playAct, thunder: (d = 800, s = .8) => thunder(d, s), weather: () => wState, sway: swaySound, critter, contact: e => contact(e), _task: t => { HW.force = t || null; },
  };
  window.__audio = api;
  return api;
}
