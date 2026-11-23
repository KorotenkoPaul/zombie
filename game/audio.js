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
const PLACE = {
  ground: () => ({ r: rnd(5, 22), y: rnd(0, .6) }),
  pond: () => ({ r: rnd(16, 26), y: 0, a: 2.4 + rnd(-.35, .35) }),
  trees: () => ({ r: rnd(9, 28), y: rnd(3, 12) }),
  far: () => ({ r: rnd(28, 50), y: rnd(4, 14) }),
  veryfar: () => ({ r: rnd(70, 110), y: rnd(0, 10) }),
  house: () => ({ r: rnd(2.5, 7), y: rnd(3, 9) }),
};
const L = {
  // ---- night ----
  cricket: { clips: ['cricket_a', 'cricket_b', 'cricket_c'], n: 5, place: 'ground', vol: .22, pitch: .07, p: 1,
    act: (h, e) => nightW(h, 19.8, 5.2, 1.4) * SEASON_K(e.season, { summer: 1, spring: .55, autumn: .45, winter: 0 }) * (1 - .75 * e.rain),
    texture: [2.5, 6], gap: [.3, 2.5], rest: [.3, 2.5] },
  frog: { clips: ['frog_a', 'frog_b', 'frog_c', 'frog_d', 'toad_a'], n: 3, place: 'pond', vol: .34, pitch: .06, p: .9,
    act: (h, e) => nightW(h, 20.3, 4.6, 1.2) * SEASON_K(e.season, { summer: 1, spring: 1, autumn: .25, winter: 0 }) * (1 + .7 * e.rain),
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
  let A = null, master = null, rev = null, revIn = null, loaded = false, loading = null, started = false;
  let muted = false; try { muted = localStorage.getItem('th_mute') === '1'; } catch (e) {}
  let season0 = null;
  const B = {};            // decoded buffers
  const voices = new Set();
  const LOG = [];
  const MAXV = 14;
  let now = 0, lastH = null, kick = 0, wasAsleep = null, wind = .3, windT = 0, rainMem = 0;
  const ind = {};          // individuals per layer
  const mult = {};         // today's / tonight's personality per layer
  const center = { x: 0, z: 0 };

  function season() {
    if (season0) return season0;
    const s = typeof window.__season === 'function' ? window.__season() : window.__season;
    return s || (ctx.season && ctx.season()) || 'summer';
  }

  function buildGraph() {
    master = A.createGain(); master.gain.value = muted ? 0 : MASTER;
    const comp = A.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3; comp.attack.value = .01; comp.release.value = .3;
    master.connect(comp).connect(A.destination);
    // one shared forest reverb: a soft decaying impulse response (only heard through the calls, never on its own)
    const len = Math.floor(A.sampleRate * 2.6), ir = A.createBuffer(2, len, A.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); let lp = 0; for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) - lp) * (0.5 - .42 * t); d[i] = lp * Math.pow(1 - t, 2.4) * (i < 300 ? i / 300 : 1); } }
    rev = A.createConvolver(); rev.buffer = ir; revIn = A.createGain(); revIn.gain.value = .55; revIn.connect(rev).connect(master);
  }

  async function load() {
    const url = new URL((ctx.asset || '') + 'sounds-mp3.txt', document.baseURI).href;
    const pack = await fetch(url).then(r => r.json());
    await Promise.all(Object.keys(pack).map(async k => {
      try {
        const bin = atob(pack[k]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        B[k] = await new Promise((res, rej) => A.decodeAudioData(u8.buffer, res, rej));
      } catch (e) { console.warn('audio clip', k, e); }
    }));
    loaded = true; console.log('audio: ' + Object.keys(B).length + ' clips ready');
  }

  function start() {
    if (!A) { A = getAC(); if (!A) return; buildGraph(); }
    if (A.state === 'suspended') A.resume();
    if (!loading) loading = load().catch(e => console.warn('audio load', e));
    started = true;
  }

  // ---------- voices ----------
  const L3 = { x: 0, y: 0, z: 0 };
  function listener() { const c = ctx.camera; if (c) { L3.x = c.position.x; L3.y = c.position.y; L3.z = c.position.z; } return L3; }
  function syncListener() {
    if (!A || !ctx.camera) return; const c = ctx.camera, l = A.listener;
    const f = { x: 0, y: 0, z: -1 }, u = { x: 0, y: 1, z: 0 }, e = c.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10]; u.x = e[4]; u.y = e[5]; u.z = e[6];
    const t = A.currentTime + .05;
    if (l.positionX) { l.positionX.linearRampToValueAtTime(c.position.x, t); l.positionY.linearRampToValueAtTime(c.position.y, t); l.positionZ.linearRampToValueAtTime(c.position.z, t);
      l.forwardX.linearRampToValueAtTime(f.x, t); l.forwardY.linearRampToValueAtTime(f.y, t); l.forwardZ.linearRampToValueAtTime(f.z, t);
      l.upX.linearRampToValueAtTime(u.x, t); l.upY.linearRampToValueAtTime(u.y, t); l.upZ.linearRampToValueAtTime(u.z, t); }
    else { l.setPosition(c.position.x, c.position.y, c.position.z); l.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z); }
  }

  // play a buffer at a world position. o: {gain, rate, offset, dur, ref, rev, fadeIn, fadeOut, pos|null, pan}
  function voice(name, o) {
    const buf = B[name]; if (!buf || !A || (!o.bed && voices.size >= MAXV)) return null;
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
      const lp = A.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(1400, 16000 * Math.exp(-dist / (o.far ? 45 : 70))); lp.Q.value = .5;
      const p = A.createPanner(); p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = o.ref || 10; p.rolloffFactor = o.roll ?? .9; p.maxDistance = 400;
      if (p.positionX) { p.positionX.value = o.pos.x; p.positionY.value = o.pos.y; p.positionZ.value = o.pos.z; } else p.setPosition(o.pos.x, o.pos.y, o.pos.z);
      src.connect(lp).connect(g).connect(p).connect(master); out = p;
    } else {
      const sp = A.createStereoPanner ? A.createStereoPanner() : null;
      if (sp) { sp.pan.value = o.pan || 0; src.connect(g).connect(sp).connect(master); } else src.connect(g).connect(master);
    }
    const sendAmt = o.rev ?? clamp01(.12 + dist / 60);
    if (sendAmt > .01) { const s = A.createGain(); s.gain.value = sendAmt; g.connect(s).connect(revIn); }
    src.start(t, off, dur);
    const v = { src, g, end: t + realDur, name };
    LOG.push([+now.toFixed(1), name]); if (LOG.length > 60) LOG.shift();
    voices.add(v); src.onended = () => { voices.delete(v); try { out.disconnect(); g.disconnect(); } catch (e) {} };
    return v;
  }

  // ---------- individuals ----------
  function place(kind) {
    const P = PLACE[kind](); const a = P.a ?? rnd(0, Math.PI * 2);
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
  const NIGHT = ['cricket', 'frog', 'owl', 'wolf', 'fox', 'nightjar', 'twig'];
  const DAY = Object.keys(L).filter(k => !NIGHT.includes(k));

  function call(k, I, act, env) {
    const S = L[k], name = pick(S.clips), buf = B[name]; if (!buf) return;
    const rate = I.pitch * (1 + rnd(-.025, .025));
    const o = { pos: I.pos, rate, gain: S.vol * rnd(.6, 1.05) * (.55 + .45 * Math.min(1, act)), rev: S.rev, far: S.place === 'veryfar', ref: S.place === 'house' ? 4 : 10 };
    if (S.texture) { o.dur = rnd(S.texture[0], S.texture[1]); o.offset = rnd(0, Math.max(0, buf.duration - o.dur)); o.fadeIn = rnd(.4, 1.2); o.fadeOut = rnd(.6, 1.5); }
    else if (S.song && Math.random() < .3) { o.dur = buf.duration * rnd(.45, .8); o.fadeOut = .35; }   // a shorter phrase now and then
    // birds sing from a slightly different twig each time
    if (S.place === 'trees') o.pos = { x: I.pos.x + rnd(-1.5, 1.5), y: I.pos.y + rnd(-1, 1), z: I.pos.z + rnd(-1.5, 1.5) };
    voice(name, o);
  }

  // Each individual is either in a bout (calls spaced by `gap`) or resting. A resting creature starts a bout
  // as a Poisson process whose rate follows its activity right now, so a frog that was quiet at dusk joins
  // in as soon as the night comes, and nothing waits on a long timer drawn when it was still day.
  function tickLayers(h, env, dt) {
    const morning = clamp01(win(h, 4.5, 9.5, 1)) * kick;
    for (const k in L) {
      const S = L[k], list = ind[k]; if (!list) continue;
      let act = S.act(h, env) * (mult[k] ?? 0);
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
    else if (Math.abs(b.lvl - (b.applied ?? 0)) > .08) { b.applied = b.lvl; b.cur.g.gain.cancelScheduledValues(t); b.cur.g.gain.setTargetAtTime(mk(b.lvl).gain, t, .4); b.cur.g.gain.setTargetAtTime(0, Math.max(t + .5, b.cur.end - 2), .5); }
  }

  function windLevel(dt) {
    const W = window.__wind;
    if (W && typeof W.level === 'function') { try { return clamp01(W.level()); } catch (e) {} }
    windT += dt; return clamp01(.28 + .22 * Math.sin(windT * .11) * Math.sin(windT * .037 + 1) + .18 * Math.max(0, Math.sin(windT * .23 + Math.sin(windT * .07) * 3)) ** 3);
  }
  // wind.js events: a gust reaching the tree rustles the crown, big limbs creak in strong wind
  let windHooked = false, lastGust = -9, gustNext = 4;
  const gustClips = env => env.season === 'winter' ? ['windw_a', 'windw_b', 'rustle_c'] : ['rustle_a', 'rustle_b', 'rustle_c'];
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

  let dripNext = 0, creakNext = 6;
  const lastHero = { x: 0, y: 0, z: 0 };

  function update(dt) {
    if (!started || !A) return;
    syncListener();
    if (!loaded || muted || A.state !== 'running') return;
    // real seconds from the audio clock: the frame dt is clamped and slows down on weak devices
    const t = A.currentTime; dt = clamp01(t - (update.t ?? t)); update.t = t; now += dt;
    const h = ctx.hour ? ctx.hour() : 12;
    const rain = clamp01(ctx.rain ? ctx.rain() : 0);
    wind = windLevel(dt);
    const hero = ctx.hero, asleep = !!(hero && hero.inBed);
    const env = envNow = { season: season(), rain, wind, awake: !asleep };
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
    tickLayers(h, env, dt);
    gusts(env);
    // rain on leaves and roof
    // rain: leaves all around, and drumming on the roof when the camera (or hero) is near one
    const R = window.__rain, cp = ctx.camera ? ctx.camera.position : null;
    let roof = .35; if (R && typeof R.roofNear === 'function' && cp) { try { roof = clamp01(R.roofNear(cp)); } catch (e) {} }
    bed('rain', ['rain_a'], rain, l => ({ gain: .34 * l, pan: rnd(-.5, .5), offset: rnd(0, 3), rev: .1 }));
    bed('roof', ['rain_b'], rain * (.25 + .75 * roof), l => ({ gain: .42 * l, pan: rnd(-.3, .3), offset: rnd(0, 3), rev: .05 }));
    rainMem = rain > .3 ? 1 : Math.max(0, rainMem - dt / 60);
    if (rainMem > .05 && rain < .4 && now > dripNext) { const a = rnd(0, 6.28); voice('drip_a', { pos: { x: Math.cos(a) * rnd(2, 8), y: rnd(1, 6), z: Math.sin(a) * rnd(2, 8) }, gain: .25 * rainMem, rate: rnd(.85, 1.2), dur: rnd(1, 3), offset: rnd(0, 2), ref: 4 }); dripNext = now + rnd(2, 7); }
    // the oven fire, where the oven is
    const L2 = ctx.lights; const fireLvl = L2 && L2.level ? L2.level('oven') : 0;
    const op = L2 && L2.pos ? L2.pos('oven') : null;
    if (op) bed('fire', ['fire_a', 'fire_b'], fireLvl, l => ({ gain: .5 * l, pos: op, ref: 2.2, roll: 1.3, rev: .05, offset: rnd(0, 2) }));
    // old planks creak under the hero now and then
    if (hero && hero.root) {
      const p = hero.root.position, mv = Math.hypot(p.x - lastHero.x, p.z - lastHero.z) / Math.max(dt, 1e-3);
      lastHero.x = p.x; lastHero.y = p.y; lastHero.z = p.z;
      if (mv > .4 && p.y > 1.2 && now > creakNext) { voice('creak_a', { pos: { x: p.x, y: p.y, z: p.z }, gain: rnd(.12, .22), rate: rnd(.85, 1.15), dur: rnd(.5, 1.1), offset: rnd(0, 1), ref: 2.5, roll: 1.2, rev: .05 }); creakNext = now + rnd(4, 14); }
    }
  }

  function setMute(b) {
    muted = !!b; try { localStorage.setItem('th_mute', muted ? '1' : '0'); } catch (e) {}
    if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER, A.currentTime, .15);
    if (muted) for (const v of voices) try { v.src.stop(); } catch (e) {}
  }
  // phones: stop the audio clock in the background
  document.addEventListener('visibilitychange', () => { if (!A) return; if (document.hidden) A.suspend(); else if (started) A.resume(); });

  const api = {
    start, update, mute: setMute, muted: () => muted, started: () => started,
    setSeason: s => { season0 = s || null; populate(Object.keys(L), { season: season(), rain: 0, wind }); },
    state: () => { const h = ctx.hour ? ctx.hour() : 12, env = { season: season(), rain: ctx.rain ? ctx.rain() : 0, wind, awake: true }; const layers = {}; for (const k in L) layers[k] = +(L[k].act(h, env) * (mult[k] ?? 0)).toFixed(2); return { loaded, season: env.season, wind: +wind.toFixed(2), rain: +env.rain.toFixed(2), voices: [...voices].map(v => v.name), layers }; },
    node: () => master, log: () => LOG.slice(),
    play: k => { const I = ind[k] && ind[k][0]; if (I) call(k, I, 1, {}); else if (B[k]) voice(k, { gain: .5 }); },
  };
  window.__audio = api;
  return api;
}
