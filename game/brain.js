// The hero's brain: a needs-based ("utility") AI, the way The Sims does it. No neural net, no fixed script.
//
//  * Needs drift with game time: hunger, energy, boredom (fun), tidiness, comfort (warmth / cosiness),
//    curiosity (wants to look outside). 0 = fine, 1 = urgent (energy: 1 = rested).
//  * Mood follows how well the needs are met (slowly, like a real mood).
//  * Every activity advertises what it gives: cooking fixes hunger, the bed fixes energy, reading fixes boredom
//    and comfort... While the hero really does it (not while walking there), it pays out.
//  * When free, he scores every activity: urgency of the needs it serves (squared, so an urgent need wins),
//    habits of the hour (breakfast in the morning, reading in the evening), the walk it costs (ladders cost more),
//    "I just did that", mood, and a dash of chance. Then he picks with a weighted lottery among the best ones,
//    so the same situation does not always give the same choice.
//  * Commitment: he stays with an activity until its need is satisfied (or he got bored of it), and only
//    drops it early when something else became really urgent.
//  * Gait: walking speed and pauses come from mood, fatigue and urgency. Between activities he sometimes
//    lingers: stretches, looks around, catches his breath.
//  * Lights: the interior lamps are his. In the dark he switches on the lamp of the room he goes to,
//    usually switches it off when he leaves (about 1 time in 5 he forgets, and then it burns until he is back:
//    nothing goes out by itself), and switches the bedroom lamp off before he lies down. He blows the candle out after reading.
//    In daylight he switches off anything left on in the room he is in.
//
// Interface with hero.js (the body; Character owns it):
//   HH.setBrain(brain)  -> hero calls brain.tick(dt, view) every frame, view = {task, step, free, seated, inBed, node, hour}
//   HH.startTask(name, opts)  -> 'read','craft','cook','tea','wash','look','window','sleep',
//                                'switch' {light, on}, 'micro' {clip, dur, look}
//   HH.gait = {speed, turn}   -> walking speed / turning multiplier
//   HH.onTaskEnd(cb)          -> cb(name) when a self-ending task (switch, micro) finishes
// The brain also draws a small toggleable panel (🧠 button) that shows what he feels and why he chose.

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

// need: [drift per game hour awake, label]
const NEEDS = {
  hunger:    { drift: .12,  label: 'Голод' },
  energy:    { drift: -.042, label: 'Силы' },      // goes down while awake
  fun:       { drift: .22,  label: 'Скука' },
  tidy:      { drift: .07,  label: 'Порядок' },
  comfort:   { drift: .09,  label: 'Уют' },        // cold, damp, wants to be cosy (faster at night)
  curiosity: { drift: .16,  label: 'Любопытство' },
  safety:    { drift: .05,  label: 'Тревога' },     // shelter mood: grows at dusk, at night and in the rain; bolt, listening, radio calm it
};

// what each activity gives per real second of doing it, where it happens, how long he tends to do it
const ACTS = {
  cook:   { room: 'kitchen',  node: 'stove',     gives: { hunger: -.045, comfort: -.01 },           dur: [12, 20], label: 'готовит' },
  tea:    { room: 'kitchen',  node: 'sink',      gives: { hunger: -.015, comfort: -.03, fun: -.008 }, dur: [10, 18], label: 'пьёт чай' },
  wash:   { room: 'kitchen',  node: 'sink',      gives: { tidy: -.06 },                             dur: [8, 15],  label: 'моет посуду' },
  read:   { room: 'bedroom',  node: 'chair_app', gives: { fun: -.025, comfort: -.02 },              dur: [22, 40], label: 'читает' },
  craft:  { room: 'workshop', node: 'bench',     gives: { fun: -.04, tidy: .004 },                  dur: [14, 26], label: 'мастерит' },
  look:   { room: 'outside',  node: 'deck',      gives: { curiosity: -.06, fun: -.01, comfort: .006 }, dur: [16, 30], label: 'смотрит вдаль' },
  window: { room: null,       node: null,        gives: { curiosity: -.05 },                        dur: [7, 13],  label: 'смотрит в окно' },
  sleep:  { room: 'bedroom',  node: 'bed_app',   gives: {},                                         dur: [1e9, 1e9], label: 'спит' },
};
// the household economy (when hero.js offers the tasks): food only through the full cycle
// hunt -> meat into the fridge -> cook (takes meat out, burns a log) -> eat. Logs come from the forest to the woodpile.
// Jobs end by themselves (like a switch); the brain books the result when hero.js reports the task ended.
const JOBS = {
  hunt: { task: 'trip', opts: { kind: 'hunt' }, label: 'идёт на охоту', top: 'hunger' },
  wood: { task: 'trip', opts: { kind: 'wood' }, label: 'идёт за брёвнами', top: 'comfort' },
  eat:  { task: 'eat',  opts: {},               label: 'ест', top: 'hunger' },
  // water (Pavel): a bucket from the pond feeds the sink tap; the dirty bucket under the sink gets emptied outside
  fetch: { task: 'fetchwater', opts: {}, label: 'идёт за водой к озеру', top: 'tidy' },
  dump:  { task: 'dumpwater',  opts: {}, label: 'выносит грязную воду', top: 'tidy' },
};
// small self-ending chores and habits (hero.js tasks; each is used only when HH.hasTask(task) says the body can do it).
// give = what one go does to the needs; when(h, ctx) = habit bonus for the hour / situation.
const EXTRA = {
  chop:      { room: 'outside',  give: { fun: -.15, comfort: -.05 }, label: 'колет дрова',          when: (h, c) => (h >= 9 && h < 17 ? .2 : -1) + (c.logs <= 2 ? .3 : 0) },
  pot:       { room: 'kitchen',  give: { hunger: -.05, comfort: -.12 }, label: 'помешивает в котелке', when: h => (h >= 17 && h < 20 ? .25 : 0) },
  stoke:     { room: 'kitchen',  give: { comfort: -.3 }, label: 'подкладывает дрова в печь', when: (h, c) => (c.ovenLow ? .6 : -.5) + (isN(h) ? .2 : 0), needLogs: true },
  dishes:    { room: 'kitchen',  give: { tidy: -.4 }, label: 'моет посуду',               when: (h, c) => (c.dirty >= 2 ? .8 : c.dirty === 1 ? (c.justAte ? .3 : -.2) : c.dirty === 0 ? -1.5 : (c.justAte ? .7 : 0)) },
  saw:       { room: 'workshop', give: { fun: -.25 }, label: 'пилит доску',               when: h => (h >= 9 && h < 17 ? .2 : -.6) },
  hammer:    { room: 'workshop', give: { fun: -.2, tidy: .03 }, label: 'стучит молотком', when: h => (h >= 9 && h < 18 ? .15 : -.8) },
  sharpen:   { room: 'workshop', give: { fun: -.12, safety: -.12 }, label: 'точит нож',   when: h => (h >= 16 && h < 20 ? .2 : 0) },
  fixlamp:   { room: 'workshop', give: { fun: -.12, comfort: -.05 }, label: 'чинит фонарь', when: h => (h >= 15 && h < 19 ? .15 : 0) },
  stretch:   { room: null,       give: { comfort: -.1 }, label: 'потягивается',           when: (h, c) => (c.justWoke ? 1.2 : -.3) },
  diary:     { room: 'bedroom',  give: { fun: -.15, safety: -.1, comfort: -.08 }, label: 'пишет в дневник', when: (h, c) => (h >= 20 && h < 23 ? .5 : -.4) },
  sweep:     { room: null,       give: { tidy: -.35 }, label: 'подметает',                when: h => (h >= 8 && h < 12 ? .15 : 0) },
  water:     { room: null,       give: { tidy: -.1, comfort: -.06 }, label: 'поливает цветок', when: h => (h >= 7 && h < 10 ? .3 : -.2) },
  listen:    { room: null,       give: { safety: -.25, curiosity: -.2 }, label: 'прислушивается у окна', when: h => (h >= 18.5 || h < 5 ? .3 : -.3) },
  bolt:      { room: null,       give: { safety: -.5 }, label: 'проверяет засов',         when: (h, c) => (h >= 19 && h < 23 && !c.bolted ? .8 : -.6) },
  supplies:  { room: 'kitchen',  give: { safety: -.15, tidy: -.1 }, label: 'перебирает припасы', when: h => (h >= 10 && h < 16 ? .1 : 0) },
  radio:     { room: null,       give: { safety: -.3, fun: -.2, curiosity: -.15 }, label: 'слушает радио', when: h => (h >= 19 && h < 22.5 ? .45 : -.2) },
  telescope: { room: 'outside',  give: { curiosity: -.45, safety: -.1 }, label: 'смотрит в подзорную трубу', when: h => ((h >= 6 && h < 8) || (h >= 17.5 && h < 20) ? .35 : 0) },
  ledge:     { room: 'outside',  give: { comfort: -.15, curiosity: -.2, fun: -.1 }, label: 'сидит на краю площадки', when: h => (h >= 16 && h < 19.5 ? .3 : -.2) },
  firewood:  { room: 'outside',  give: { comfort: -.05 }, label: 'носит дрова снизу',     when: (h, c) => (c.logs <= 1 ? .5 : -.4) + (h >= 8 && h < 18 ? 0 : -1) },
};
const isN = h => !(h >= 6 && h < 20);
// graph node -> room (for lights and "where am I")
const ROOM_OF = n => {
  if (!n) return 'outside';
  if (/^(k|stove|sink)/.test(n) && !/^kh_b/.test(n)) return 'kitchen';
  if (/^(b|chair|bed)/.test(n) && n !== 'bench') return 'bedroom';
  if (/^(w|bench)/.test(n) && n !== 'wstep') return 'workshop';
  return 'outside';
};
const ROOM_LAMP = { kitchen: 'kitchen', bedroom: 'bedroom', workshop: 'workshop' };
const MICRO = {
  stretch: { clip: 'hy_stretch', label: 'потягивается' },
  around:  { clip: '336',        label: 'оглядывается' },
  breathe: { clip: '11',         label: 'переводит дух' },
  inspect: { clip: 'hy_inspect', label: 'что-то разглядывает' },
};

export function createBrain({ HH, lights, hour, isNight }) {
  const raining = () => { try { const w = window.__wind; return !!(w && w.raining && w.raining()); } catch (e) { return false; } };
  const H = HH.hero || HH.H;
  const has = c => !!(HH.actions && HH.actions[c]);
  // stocks: meat in the fridge (portions), logs in the woodpile, a cooked meal waiting
  const stock = { meat: 2, logs: 4, meal: 0, clean: .8, dirtyW: .2 };   // clean: tap bucket 0..1, dirtyW: bucket under the sink 0..1
  // props.js owns the real levels (the tap drains the bucket while it runs): read them when they exist
  const propsWater = () => { try { const W = window.__props && window.__props.water; return W && typeof W.clean === 'number' ? W : null; } catch (e) { return null; } };
  const WATER = () => !!(HH.hasTask && HH.hasTask('fetchwater'));
  const WET = { cook: .1, tea: .1, wash: .25, dishes: .25 };   // water each use takes from the tap (and sends down the drain)
  const ECON = !!(HH.hasTask && HH.hasTask('trip') && HH.hasTask('eat'));
  const showStock = () => { try { const P = window.__props; P && P.fridge && P.fridge.setStock && P.fridge.setStock(stock.meat); P && P.woodpile && P.woodpile.setCount && P.woodpile.setCount(stock.logs); } catch (e) {} };
  const need = { hunger: .35, energy: .8, fun: .4, tidy: .25, comfort: .3, curiosity: .3, safety: .2 };
  let mood = .6;
  let lastH = hour();
  let cur = null;           // {name, t, dur, min, opts}
  const plan = [];          // queued steps: {task, opts, why}
  const recent = [];        // last activities
  let scores = [];          // for the panel
  let why = '';
  let lingerCool = 0, roomNow = null, roomT = 0;
  let wake = rnd(5.6, 6.6); // he does not wake at the same minute every day
  let bedTime = rnd(20.8, 21.6);

  // ---------- lights: take the interior lamps over (the hero switches them from now on) ----------
  const LAMPS = lights ? Object.values(ROOM_LAMP).filter(n => lights.get && lights.get(n)) : [];
  for (const n of LAMPS) { const g = lights.get(n); lights.set(n, g.on); }
  const hasCandle = !!(lights && lights.get && lights.get('candle'));
  const candleOn = () => hasCandle && lights.get('candle').on;
  const lampOn = n => !!(lights && lights.get(n) && lights.get(n).on);
  const dark = h => (h >= 19.2 || h < 6.6);

  // ---------- clock ----------
  function gameHours() { const h = hour(); let d = h - lastH; if (d < -12) d += 24; if (d < 0 || d > 3) d = 0; lastH = h; return d; }

  function drift(dt, dh, v) {
    const h = v.hour, asleep = v.task === 'sleep' && (v.inBed || v.step === 'sleep');
    for (const k in NEEDS) {
      let r = NEEDS[k].drift;
      if (asleep) r = k === 'energy' ? .16 : k === 'hunger' ? .03 : k === 'fun' || k === 'curiosity' ? -.05 : 0;
      if (k === 'comfort' && isNight(h)) r *= 1.8;
      if (k === 'safety') r = asleep ? -.04 : (isNight(h) ? .12 : h >= 17 ? .08 : .015) * (raining() ? 1.5 : 1);
      if (k === 'energy' && !asleep && H.state === 'walk') r *= 1.4;
      need[k] = clamp(need[k] + r * dh);
    }
    // the activity pays out only while he is really doing it (not on the way)
    if (cur && v.step && v.step !== 'go' && ACTS[cur.name]) {
      const g = ACTS[cur.name].gives;
      for (const k in g) { if (ECON && cur.name === 'cook' && k === 'hunger') continue; need[k] = clamp(need[k] + g[k] * dt); }
    }
    // mood: slowly follows the average comfort of all needs
    const bad = (need.hunger ** 2 + (1 - need.energy) ** 2 + need.fun ** 2 + need.tidy ** 2 * .5 + need.comfort ** 2 + need.curiosity ** 2 * .5 + need.safety ** 2 * .6) / 5.6;
    mood = lerp(mood, clamp(1 - bad * 1.6), 1 - Math.exp(-dt * .05));
  }

  // ---------- scoring ----------
  function travel(nodeName) {
    if (!nodeName || !HH.route) return 0;
    const r = HH.route(H.node, nodeName);
    let c = 0; for (const s of r) c += s.t === 'ladder' ? .5 : .12;
    return c;
  }
  function habit(name, h) {
    const breakfast = h >= 6.5 && h < 9, lunch = h >= 12 && h < 14, dinner = h >= 17.5 && h < 19.5;
    switch (name) {
      case 'cook': return (breakfast || lunch || dinner) ? .45 : 0;
      case 'tea': return h >= 6 && h < 9.5 && !day.hadTea ? .9 : (h >= 7 && h < 10) || (h >= 15.5 && h < 17.5) ? .35 : 0;   // the morning cup is a habit
      case 'wash': { const d = dirty(); if (d === 0) return -1.5; if (d >= 2) return .7; return (h >= 9 && h < 10.5) || (h >= 19 && h < 20.5) ? .2 : 0; }   // real dirty dishes in the sink (props.js)
      case 'read': return h >= 19 ? .55 : h >= 13.5 && h < 15 ? .2 : 0;
      case 'craft': return h >= 9 && h < 17 ? .35 : -.2;
      case 'look': return (h >= 6 && h < 8) || (h >= 18 && h < 20) ? .4 : isNight(h) ? -.3 : 0;
      case 'window': return isNight(h) ? .1 : 0;
      case 'sleep': return h >= bedTime || h < 5 ? 2.5 : h >= 21 ? .4 : -2;
    }
    return 0;
  }
  function score(name, h) {
    const A = ACTS[name];
    let s = 0, top = '', topV = 0;
    if (name === 'sleep') { s = (1 - need.energy) ** 2 * 2.2; top = 'energy'; topV = s; }
    else for (const k in A.gives) {
      const g = -A.gives[k];
      if (g <= 0) continue;
      const v = need[k] ** 2 * g * 30;     // urgent needs dominate
      s += v; if (v > topV) { topV = v; top = k; }
    }
    s += habit(name, h);
    if (name === 'cook' && need.hunger > .75) s += 1;   // really hungry: food first
    if (A.room === 'outside' && raining()) s -= 2;   // nobody stands on the deck in the rain
    if (locked && A.room === 'outside') s -= 9;      // lockdown: nobody goes out
    s -= travel(A.node) * (.15 + (1 - need.energy) * .25);
    // cabin fever: the longer he stays in one room, the more the other rooms call
    if (A.room && A.room !== roomNow) s += Math.min(.7, roomT / 70);
    else if (A.room && A.room === roomNow) s += Math.max(0, .4 - roomT / 120);   // first chain what is at hand in this room
    const i = recent.indexOf(name);
    if (i === 0) s -= .9; else if (i === 1) s -= .35; else if (i === 2) s -= .15;
    if (mood < .35 && (name === 'read' || name === 'tea')) s += .25;   // low mood: comfort first
    if (mood > .7 && (name === 'craft' || name === 'look')) s += .15;
    s += rnd(0, .3);
    return { name, s, top };
  }
  function jobScore(n, h) {
    const day = h >= 7 && h < 17.5, dawnDusk = h >= 6.3 && h < 19;
    const emergency = need.hunger > .85 && !stock.meat && !stock.meal;
    let s = -9;
    if (n === 'hunt') { if (stock.meat === 0 && !stock.meal) s = .9 + need.hunger * 1.2; else if (stock.meat === 1) s = .3; if (!day && !(emergency && !raining())) s -= 3; else if (!day && !dawnDusk) s -= .4; }
    if (n === 'wood') { if (stock.logs === 0) s = 1.3; else if (stock.logs <= 2) s = .45; if (!day) s -= 3; }
    if (n === 'fetch') s = !WATER() ? -99 : stock.clean < .2 ? 2.6 : stock.clean < .4 ? .6 : -9;
    if (n === 'dump') s = !WATER() ? -99 : stock.dirtyW >= .8 ? 2.4 : stock.dirtyW >= .6 ? .4 : -9;
    if ((n === 'fetch' || n === 'dump') && (h < 6.5 || h > 20.5)) s -= 1.2;
    if (n === 'eat') s = stock.meal ? .4 + need.hunger ** 2 * 3 + (recent[0] === 'cook' ? 2 : 0) : -9;   // cooked: sits down to eat while it is hot
    if (raining() && JOBS[n].task === 'trip') s -= 1;
    if (locked && JOBS[n].task === 'trip') s -= 20;
    const i = recent.indexOf(n); if (i === 0 && n !== 'eat') s -= .6;
    return { name: n, s: s + rnd(0, .25), top: JOBS[n].top };
  }
  // the small chores: each go fixes a little; habits of the hour; never the same thing twice in a row
  const day = { hadTea: false, bolted: false, justWoke: false, justAte: false };
  const canDo = n => { const E = EXTRA[n]; if (E.task) return true; return !!(HH.hasTask && HH.hasTask(n)); };
  function extraScore(n, h) {
    if (!canDo(n)) return null;
    const E = EXTRA[n];
    if (E.needLogs && ECON && !stock.logs) return null;
    if (E.room === 'outside' && raining()) return null;
    let s = 0, top = '', topV = 0;
    for (const k in E.give) { const g = -E.give[k]; if (g <= 0) continue; const v = need[k] ** 2 * g * 4; s += v; if (v > topV) { topV = v; top = k; } }
    s += E.when(h, { logs: ECON ? stock.logs : 5, ovenLow: lights && lights.level && lights.level('oven') < .3 && isN(h), justWoke: day.justWoke, justAte: day.justAte, bolted: day.bolted, hadTea: day.hadTea, dirty: dirty() });
    const i = recent.indexOf(n); if (i === 0) s -= 2; else if (i === 1) s -= .5; else if (i >= 2) s -= .2;
    return { name: n, s: s + rnd(0, .3), top: top || '' };
  }
  function decide(h) {
    scores = Object.keys(ACTS).map(n => score(n, h));
    for (const n in EXTRA) { const x = extraScore(n, h); if (x) scores.push(x); }
    // no water in the tap bucket (or the drain bucket is full): no washing, tea or cooking until he sees to it
    if (WATER()) for (const x of scores) if (WET[x.name] && (stock.clean < WET[x.name] || stock.dirtyW > .95)) x.s -= 9;
    if (!ECON && WATER()) for (const n of ['fetch', 'dump']) scores.push(jobScore(n, h));
    if (ECON) { for (const x of scores) if (x.name === 'cook') { if (!stock.meat || !stock.logs || stock.meal) x.s -= 9; } for (const n in JOBS) scores.push(jobScore(n, h)); }
    scores.sort((a, b) => b.s - a.s);
    if (h >= bedTime || h < 5) return scores.find(x => x.name === 'sleep');   // past bedtime: bed, no lottery
    // weighted lottery among the three best (softmax with a mood-dependent temperature)
    const best = scores.slice(0, 3);
    const T = .18 + mood * .12;
    const w = best.map(x => Math.exp((x.s - best[0].s) / T));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < best.length; i++) { r -= w[i]; if (r <= 0) return best[i]; }
    return best[0];
  }

  // ---------- plan an activity: lights first, a pause maybe, then the thing ----------
  function planFor(name, h, reason) {
    plan.length = 0;
    const from = ROOM_OF(H.node), A = ACTS[name] || EXTRA[name] || { room: name === 'eat' ? 'kitchen' : 'outside' };
    const to = A.room || from;
    // leaving a lit room in the dark: usually switch it off (sometimes he forgets)
    if (from !== to && ROOM_LAMP[from] && lampOn(ROOM_LAMP[from]) && dark(h) && Math.random() < .8)
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[from], on: false }, why: 'уходит — гасит свет' });
    // the floor hatch is closed and the way goes through it: open it first (without a hatch task, it just opens, so he is never trapped)
    { const H8 = house(); const up = r => r === 'bedroom';
      if (!locked && H8 && H8.hatch && H8.hatch.isOpen && !H8.hatch.isOpen() && name !== 'sleep' && up(from) !== up(to) && !(A.node && /^(deck|ledge|ll_)/.test(A.node))) {
        if (HH.hasTask && HH.hasTask('hatch')) plan.push({ task: 'hatch', opts: { open: true }, why: 'открывает люк' }); else H8.hatch.open(); } }
    // going to bed: make the house safe first (Pavel): usually he closes the floor hatch and bolts the door, sometimes he forgets
    if (name === 'sleep') {
      const H8 = house();
      if (H8 && H8.hatch && H8.hatch.isOpen && H8.hatch.isOpen() && HH.hasTask && HH.hasTask('hatch') && (locked || Math.random() < .7))
        plan.push({ task: 'hatch', opts: { open: false }, why: 'на ночь закрывает люк' });
      if (!day.bolted && HH.hasTask && HH.hasTask('bolt') && (locked || Math.random() < .75)) plan.push({ task: 'bolt', opts: { lock: true }, why: 'на ночь запирает дверь', extra: 'bolt' });
    }
    // going to bed: the bedroom lamp off first, always
    if (name === 'sleep' && lampOn('bedroom'))
      plan.push({ task: 'switch', opts: { light: 'bedroom', on: false }, why: 'перед сном гасит свет' });
    // a dark room: light it first
    else if (name !== 'sleep' && ROOM_LAMP[to] && dark(h) && !lampOn(ROOM_LAMP[to]))
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[to], on: true }, why: 'темно — включает свет' });
    // the candle on the reading table: he blows it out when he stops reading, and lights it to read in the dark
    if (name !== 'read' && from === 'bedroom' && candleOn()) plan.unshift({ task: 'switch', opts: { light: 'candle', on: false }, why: 'задувает свечу' });
    // trips: the bow from the workshop for the hunt; the jacket from the hook when it rains or is chilly (sometimes he skips it)
    if (EXTRA[name]) { const E = EXTRA[name]; plan.push({ task: E.task || name, opts: {}, why: reason, extra: name }); }
    else if (JOBS[name]) plan.push({ task: JOBS[name].task, opts: { ...JOBS[name].opts, lantern: dark(h), bow: name === 'hunt', jacket: raining() || ((h < 9 || h > 17) && Math.random() < .7) || Math.random() < .2 }, why: reason, job: name });
    else plan.push({ task: name, opts: ECON && name === 'cook' ? { fromFridge: true } : {}, why: reason });
  }

  function startNext() {
    let st = plan.shift();
    // a lamp step planned in the dark, but it is light by now: skip it
    while (st && st.task === 'switch' && st.opts.on && st.opts.light !== 'candle' && !dark(hour())) st = plan.shift();
    if (!st) return false;
    why = st.why || why;
    // he leaves the stove after really cooking: a portion of meat and a log are used, a meal waits
    if (st.task !== 'cook' && !(st.task === 'switch' && plan.some(p => p.task === 'cook'))) bookCook();
    job = st.job || null; extra = st.extra || null;
    // using water: the tap bucket goes down, the drain bucket fills
    { const w = WET[st.extra || st.task]; if (w && WATER() && !propsWater()) { stock.clean = clamp(stock.clean - w); stock.dirtyW = clamp(stock.dirtyW + w * .9); showStock(); } }
    if (extra) { recent.unshift(extra); recent.length = 4; }
    // he stops reading: from now on the candle is his to blow out (or to forget)
    if (cur && cur.name === 'read' && st.task !== 'read' && hasCandle) lights.set('candle', candleOn());
    expected = st.task;
    if (st.task === 'tea') day.hadTea = true;
    // reading in the dark: the candle lights itself when he sits down (lights.js); only putting it out is his job
    if (st.task === 'read' && hasCandle && lights.auto) lights.auto('candle');
    const A = ACTS[st.task];
    cur = { name: st.task, t: 0, opts: st.opts, dur: A ? rnd(A.dur[0], A.dur[1]) : 0, min: A ? Math.max(8, A.dur[0] * .8) : 0 };
    if (A) { recent.unshift(st.task); recent.length = 4; }
    setGait();
    HH.startTask(st.task, st.opts);
    return true;
  }

  function micro(h) {
    if (lingerCool > 0) return false;
    const tired = 1 - need.energy;
    const p = .25 + tired * .3 + (mood < .4 ? .15 : 0);
    if (Math.random() > p) { lingerCool = 20; return false; }
    const opts = [];
    if (has('hy_stretch') && (h < 10 || tired > .5)) opts.push('stretch', 'stretch');
    if (has('336')) opts.push('around', 'around');
    if (has('11')) opts.push('breathe');
    if (has('hy_inspect') && mood > .5) opts.push('inspect');
    if (!opts.length) return false;
    const m = MICRO[pick(opts)];
    plan.unshift({ task: 'micro', opts: { clip: m.clip, dur: rnd(2.5, 5) }, why: m.label });
    lingerCool = rnd(25, 50);
    return true;
  }

  // ---------- gait: speed from mood, fatigue and urgency ----------
  function setGait() {
    const tired = 1 - need.energy;
    const urgent = Math.max(need.hunger, need.comfort);
    let s = 1.0 + (mood - .5) * .16 - tired * .1 + (urgent > .8 ? .06 : 0) + rnd(-.03, .03);
    if (raining()) s = 1.12;                       // caught in the rain: hurry
    if (HH.gait) { HH.gait.speed = clamp(s, .88, 1.12); HH.gait.turn = clamp(.85 + mood * .3, .8, 1.15); }
  }

  // ---------- the per-frame tick (called by hero.js) ----------
  let locked = false;
  // dirty dishes in the sink (props.js); -1 = unknown
  const dirty = () => { try { const D = window.__props && window.__props.dishes; return D && D.state ? D.state().dirty : -1; } catch (e) { return -1; } };
  const house = () => { try { return window.__house || null; } catch (e) { return null; } };
  let pausing = 0, expected, cmdNext = false, job = null, extra = null;
  function tick(dt, v) {
    const dh = gameHours();
    { const W = propsWater(); if (W) { stock.clean = W.clean; stock.dirtyW = W.dirty; } }
    drift(dt, dh, v);
    lingerCool -= dt;
    { const r = ROOM_OF(H.node); if (r !== roomNow) { roomNow = r; roomT = 0; } else if (!(v.inBed)) roomT += dt; }
    if (!v.free) return;
    const h = v.hour;
    // the body has not caught up with the last request yet (or the game took over: guard, repair): wait
    if (v.task && expected && v.task !== expected) return;
    // time at the activity counts only once he is there; the walk there makes him stay longer (no climbing up just to climb down)
    if (cur) { if (v.step && v.step !== 'go') cur.t += dt; else cur.walk = (cur.walk || 0) + dt; }
    // a task the brain did not start: the game started him reading, or the player asked for something.
    // Adopt it and respect it: a direct request wins over needs (he only drops it if he is falling asleep on his feet)
    if (v.task && !cur && ACTS[v.task]) {
      const A = ACTS[v.task], first = !cmdNext;
      cur = { name: v.task, t: 0, dur: first ? rnd(A.dur[0], A.dur[1]) * .6 : A.dur[1] * .7, min: first ? 0 : A.dur[0] * .7, opts: {}, cmd: !first }; cmdNext = false;
      plan.length = 0; recent.unshift(v.task); recent.length = 4; expected = v.task; why = first ? A.label : A.label + ' (попросили)';
    }

    // a step that ends by itself (switch, micro) has ended: next step of the plan
    if (!v.task) {
      if (pausing > 0) { pausing -= dt; return; }
      if (startNext()) return;
      cur = null;
    }

    // sleeping: get up when rested and it is morning (or very rested)
    if (v.task === 'sleep') {
      if ((h >= wake && h < 12 && need.energy > .6) || (h >= wake + 1.2 && h < 12)) {
        wake = rnd(5.6, 6.6); bedTime = rnd(20.8, 21.6);
        day.hadTea = false; day.bolted = false; day.justWoke = true; day.justAte = false;
        const d = decide(h); planFor(d.name, h, 'проснулся, хочет: ' + reasonOf(d)); startNext();
      }
      return;
    }

    // in daylight, a lamp left on in this room gets switched off
    const here = ROOM_OF(H.node);
    if (!dark(h) && ROOM_LAMP[here] && lampOn(ROOM_LAMP[here]) && v.task !== 'switch' && !plan.length && (!cur || cur.t > 3)) {
      const keep = cur && ACTS[cur.name] ? cur.name : null;
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[here], on: false }, why: 'светло — гасит лампу' });
      if (keep) plan.push({ task: keep, opts: {}, why });
      startNext(); return;
    }
    // it got dark while he is busy in an unlit room: get up and light it, then carry on
    if (dark(h) && ROOM_LAMP[here] && !lampOn(ROOM_LAMP[here]) && cur && ACTS[cur.name] && ACTS[cur.name].room === here && v.task !== 'sleep' && !plan.length && v.step !== 'go') {
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[here], on: true }, why: 'стемнело — включает свет' });
      plan.push({ task: cur.name, opts: {}, why: 'продолжает' });
      startNext(); return;
    }

    if (!v.task || !cur) { choose(h); return; }
    // rain while he is outside: back under the roof
    if (raining() && cur && ACTS[cur.name] && ACTS[cur.name].room === 'outside' && !plan.length) { why = 'дождь — уходит под крышу'; choose(h); setGait(); return; }
    if (v.step === 'go') return;

    // commitment: stay until the need is met or he has had enough; leave early only for something urgent
    const A = ACTS[cur.name];
    if (!A) return;
    const stay = cur.min + (cur.walk || 0) * .6;   // minimum dwell: base + 60% of the walk it took
    let done = cur.t > Math.max(cur.dur, stay);
    const main = Object.keys(A.gives).sort((a, b) => A.gives[a] - A.gives[b])[0];
    if (main && cur.t > stay && need[main] < .08) done = true;
    if (cur.cmd) { if (need.energy < .03 || (h >= bedTime + 1.5 && h < 23.9) || (h < 4 && h > 1)) done = true; else done = cur.t > cur.dur; }
    else if (cur.name !== 'sleep') {
      // early exits: only after the minimum dwell, unless it is really pressing
      const pressing = (need.hunger > .97 && cur.name !== 'cook') || need.energy < .03 || (h >= bedTime + .6 && h < 23.9) || (h < 4.5);
      const urgent = pressing || (cur.t > stay && ((need.hunger > .9 && cur.name !== 'cook') || need.energy < .08 || (h >= bedTime && h < 23.9) || h < 5));
      if (urgent) done = true;
    }
    if (done) choose(h);
  }
  function reasonOf(d) { return d.top ? NEEDS[d.top].label.toLowerCase() : 'привычка'; }
  function bookCook() { if (ECON && cur && cur.name === 'cook' && !cur.booked && cur.t > 6) { cur.booked = true; stock.meat = Math.max(0, stock.meat - 1); stock.logs = Math.max(0, stock.logs - 1); stock.meal = 1; showStock(); } }
  function choose(h) {
    bookCook();
    const d = decide(h);
    planFor(d.name, h, (ACTS[d.name] || JOBS[d.name] || EXTRA[d.name]).label + ' (' + reasonOf(d) + ')');
    if (cur && ACTS[cur.name] && cur.name !== 'sleep' && d.name !== 'sleep') micro(h);
    // a short thoughtful pause before setting off (longer when tired)
    pausing = Math.random() < .3 ? rnd(.4, 1.2) * (1 + (1 - need.energy)) : 0;
    startNext();
  }

  // ---------- debug panel ----------
  let panel = null, shown = false;
  try { shown = localStorage.getItem('brainPanel') === '1'; } catch (e) {}
  function ui() {
    if (typeof document === 'undefined' || panel) return;
    const css = document.createElement('style');
    css.textContent = `.brainB{position:fixed;left:10px;bottom:62px;z-index:30;width:38px;height:38px;border-radius:19px;border:0;background:rgba(20,28,40,.55);color:#fff;font-size:18px;backdrop-filter:blur(6px)}
.brainP{position:fixed;left:10px;bottom:106px;z-index:30;width:220px;padding:10px 12px;border-radius:14px;background:rgba(16,22,32,.78);color:#E9EEF5;font:12px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px)}
.brainP b{font-weight:600}.brainP .r{display:flex;align-items:center;gap:6px;margin:2px 0}.brainP .r span{width:84px;opacity:.85}
.brainP .bar{flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden}.brainP .bar i{display:block;height:100%;border-radius:3px}
.brainP .s{opacity:.8;margin-top:6px}.brainP .now{margin:4px 0 6px;color:#FFD9A0}`;
    document.head.appendChild(css);
    const b = document.createElement('button'); b.className = 'brainB'; b.textContent = '🧠'; b.setAttribute('aria-label', 'Мысли героя');
    panel = document.createElement('div'); panel.className = 'brainP'; panel.style.display = shown ? 'block' : 'none';
    b.onclick = () => { shown = !shown; panel.style.display = shown ? 'block' : 'none'; try { localStorage.setItem('brainPanel', shown ? '1' : '0'); } catch (e) {} };
    document.body.append(b, panel);
  }
  let uiT = 0;
  function draw(dt) {
    if (!panel || !shown) return;
    uiT -= dt; if (uiT > 0) return; uiT = .25;
    const row = (lab, v, col) => `<div class="r"><span>${lab}</span><div class="bar"><i style="width:${Math.round(v * 100)}%;background:${col}"></i></div></div>`;
    const col = v => v > .75 ? '#E0705A' : v > .45 ? '#E3B55A' : '#7FC08A';
    let h = `<b>Мысли героя</b><div class="now">${H.task === 'sleep' ? 'спит' : why || '…'}</div>`;
    for (const k in NEEDS) { const v = k === 'energy' ? 1 - need[k] : need[k]; h += row(k === 'energy' ? 'Усталость' : NEEDS[k].label, v, col(v)); }
    h += row('Настроение', mood, mood > .6 ? '#7FC08A' : mood > .35 ? '#E3B55A' : '#E0705A');
    h += `<div class="s">Шаг: ${(HH.gait ? HH.gait.speed : 1).toFixed(2)} · варианты:<br>` + scores.slice(0, 4).map(s => `${(ACTS[s.name] || JOBS[s.name] || EXTRA[s.name]).label} ${s.s.toFixed(2)}`).join('<br>') + '</div>';
    if (ECON) h += `<div class="s">Мясо: ${stock.meat} · брёвна: ${stock.logs}${stock.meal ? ' · обед готов' : ''}</div>`;
    if (WATER()) h += `<div class="s">Вода в ведре: ${Math.round(stock.clean * 100)}% · грязная: ${Math.round(stock.dirtyW * 100)}%</div>`;
    panel.innerHTML = h;
  }

  const brain = {
    need, stock, get econ() { return ECON; }, get mood() { return mood; }, get why() { return why; }, plan, scores: () => scores,
    tick(dt, v) { tick(dt, v); draw(dt); },
    // the game starts at any hour: needs that fit the hour (as if the day had been lived), and the next bed/wake times
    prime(h) {
      const awake = h >= 6 ? h - 6.5 : h + 17.5;            // hours since he got up
      need.energy = clamp(1 - awake * .045 - rnd(0, .1));
      const sinceMeal = h >= 19 ? h - 19 : h >= 13 ? h - 13 : h >= 7.5 ? h - 7.5 : h + 5;
      need.hunger = clamp(.1 + sinceMeal * .12 + rnd(-.05, .05));
      need.fun = rnd(.2, .6); need.tidy = rnd(.1, .5); need.comfort = clamp((isNight(h) ? .45 : .2) + rnd(-.1, .1)); need.curiosity = rnd(.2, .6);
      stock.clean = rnd(.2, 1); stock.dirtyW = rnd(0, .7);
      stock.meat = Math.floor(rnd(0, 3)); stock.logs = Math.floor(rnd(1, 6)); stock.meal = 0; showStock();
      mood = rnd(.5, .75); lastH = h; cur = null; plan.length = 0; expected = undefined;
      if (h >= 21.5 || h < 5.6) bedTime = Math.min(h, 21), wake = rnd(5.6, 6.6);
    },
    // a direct request (player / debug): it wins over needs; he only drops it when falling asleep on his feet or deep in the night
    // lockdown (for the zombie nights to come): hatch closed, door bolted, lamps low (only the room he is in), nobody goes out.
    // lockdown(false) lifts it; in the morning he reopens the hatch himself.
    lockdown(on = true) {
      locked = !!on; plan.length = 0; pausing = 0;
      if (!locked) { why = 'отбой тревоги'; return; }
      const H8 = house(), here = ROOM_OF(H.node);
      if (H8 && H8.hatch && H8.hatch.isOpen && H8.hatch.isOpen() && HH.hasTask && HH.hasTask('hatch')) plan.push({ task: 'hatch', opts: { open: false }, why: 'запирается: люк' });
      if (HH.hasTask && HH.hasTask('bolt')) plan.push({ task: 'bolt', opts: { lock: true }, why: 'запирается: засов', extra: 'bolt' });
      for (const r in ROOM_LAMP) if (r !== here && lampOn(ROOM_LAMP[r])) plan.push({ task: 'switch', opts: { light: ROOM_LAMP[r], on: false }, why: 'запирается: гасит свет' });
      cur = null; why = 'запирается'; startNext();
    },
    get locked() { return locked; },
    command(name, opts) { plan.length = 0; pausing = 0; cur = null; cmdNext = !!ACTS[name]; expected = name; why = (ACTS[name] ? ACTS[name].label : name) + ' (попросили)'; HH.startTask(name, opts); },
    label: () => H.task === 'sleep' ? 'спит' : (cur && ACTS[cur.name] ? ACTS[cur.name].label : why),
    show(on = true) { shown = on; if (panel) panel.style.display = on ? 'block' : 'none'; },
  };
  ui();
  // a job ended: book what it brought (hero.js may pass a result; a missing result counts as success)
  if (HH.onTaskEnd) HH.onTaskEnd((name, res) => {
    if (extra && EXTRA[extra] && res !== false) { const E = EXTRA[extra]; for (const k in E.give) need[k] = clamp(need[k] + E.give[k]);
      if (extra === 'bolt') day.bolted = true; if (extra === 'stretch') day.justWoke = false; if (extra === 'dishes') day.justAte = false;
      if (extra === 'stoke' && ECON) { stock.logs = Math.max(0, stock.logs - 1); showStock(); }
      if (extra === 'firewood' && ECON) { stock.logs += 2; showStock(); }
      extra = null; }
    if (!job || res === false || (res && res.ok === false)) { job = null; return; }
    if (job === 'hunt') { stock.meat += 2; plan.unshift({ task: 'store', opts: { item: 'meat' }, why: 'кладёт мясо в холодильник' }); }
    else if (job === 'wood') stock.logs += 3;
    else if (job === 'fetch') { plan.unshift({ task: 'setbucket', opts: {}, why: 'ставит ведро под кран' }); stock.clean = 1; const W = propsWater(); W && W.setClean && W.setClean(1); }
    else if (job === 'dump') { stock.dirtyW = 0; const W = propsWater(); W && W.setDirty && W.setDirty(0); }
    else if (job === 'eat') { stock.meal = 0; day.justAte = true; try { const D = window.__props && window.__props.dishes; if (D && D.setDirty) D.setDirty(Math.min(4, D.state().dirty + 1)); } catch (e) {} need.hunger = clamp(need.hunger - .75); need.comfort = clamp(need.comfort - .15); }
    job = null; showStock();
  });
  showStock();
  if (HH.setBrain) HH.setBrain(brain);
  return brain;
}
