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
  hunger:    { drift: .05,  w: 2.6, label: 'Голод' },
  energy:    { drift: -.042, w: 3.0, label: 'Силы' },      // goes down while awake
  fun:       { drift: .055, w: .9, label: 'Скука' },
  tidy:      { drift: .025,  w: .8, label: 'Беспорядок' },
  comfort:   { drift: .05,  w: 1.3, label: 'Холод, неуют' },        // cold, damp, wants to be cosy (faster at night)
  curiosity: { drift: .045, w: .8, label: 'Любопытство' },
  safety:    { drift: .05,  w: 1.6, label: 'Тревога' },
  wear:      { drift: .02, w: 1.3, label: 'Износ дома' },  // the house wears out; faster in rain and wind; repairs fix it     // shelter mood: grows at dusk, at night and in the rain; bolt, listening, radio calm it
};

// what each activity gives per real second of doing it, where it happens, how long he tends to do it
const ACTS = {
  cook:   { room: 'kitchen',  node: 'stove',     gives: { hunger: -.045, comfort: -.01 },           dur: [22, 32], label: 'готовит' },
  tea:    { room: 'kitchen',  node: 'sink',      gives: { hunger: -.015, comfort: -.03, fun: -.008 }, dur: [16, 26], label: 'пьёт чай' },
  wash:   { room: 'kitchen',  node: 'sink',      gives: { tidy: -.06 },                             dur: [12, 20], label: 'моет посуду' },
  read:   { room: 'bedroom',  node: 'chair_app', gives: { fun: -.025, comfort: -.02 },              dur: [50, 85], label: 'читает' },
  craft:  { room: 'workshop', node: 'bench',     gives: { fun: -.04, tidy: .004 },                  dur: [35, 60], label: 'мастерит' },
  look:   { room: 'outside',  node: 'deck',      gives: { curiosity: -.06, fun: -.01, comfort: .006 }, dur: [30, 50], label: 'смотрит вдаль' },
  window: { room: null,       node: null,        gives: { curiosity: -.05 },                        dur: [7, 13],  label: 'смотрит в окно' },
  sleep:  { room: 'bedroom',  node: 'bed_app',   gives: {},                                         dur: [1e9, 1e9], label: 'спит' },
};
// the household economy (when hero.js offers the tasks): food only through the full cycle
// hunt -> meat into the fridge -> cook (takes meat out, burns a log) -> eat. Logs come from the forest to the woodpile.
// Jobs end by themselves (like a switch); the brain books the result when hero.js reports the task ended.
const JOBS = {
  hunt: { task: 'trip', opts: { kind: 'hunt' }, label: 'идёт на охоту', top: 'food', eff: { food: 1, fun: .2, curiosity: .3 } },
  wood: { task: 'trip', opts: { kind: 'wood' }, label: 'идёт за брёвнами', top: 'logs', eff: { logs: 1, fun: .1, curiosity: .15 } },
  eat:  { task: 'eat',  opts: {},               label: 'ест', top: 'hunger', eff: { hunger: .75, comfort: .15, fun: .12 } },
  // water (Pavel): a bucket from the pond feeds the sink tap; the dirty bucket under the sink gets emptied outside
  fetch: { task: 'fetchwater', opts: {}, label: 'идёт за водой к озеру', top: 'water', eff: { water: 1, curiosity: .15 } },
  dump:  { task: 'dumpwater',  opts: {}, label: 'выносит грязную воду', top: 'drain', eff: { drain: 1 } },
};
// small self-ending chores and habits (hero.js tasks; each is used only when HH.hasTask(task) says the body can do it).
// give = what one go does to the needs; when(h, ctx) = habit bonus for the hour / situation.
const EXTRA = {
  chop:      { room: 'kitchen',  give: { hunger: -.03, fun: -.1 }, label: 'режет на доске',      when: h => (h >= 11 && h < 13) || (h >= 17 && h < 19) ? .2 : -.3 },
  // OUTDOOR: splitting rounds with the axe at the chopping block by the oak (hero.js MAKE.splitwood)
  splitwood: { room: 'outside',  give: { fun: -.15, comfort: -.05 }, label: 'колет дрова',          when: (h, c) => (h >= 9 && h < 17 ? .2 : -1) + (c.logs <= 2 ? .3 : 0) },
  pot:       { room: 'kitchen',  give: { hunger: -.05, comfort: -.12 }, label: 'помешивает в котелке', when: h => (h >= 17 && h < 20 ? .25 : 0) },
  stoke:     { room: 'kitchen',  give: { comfort: -.3 }, label: 'подкладывает дрова в печь', when: (h, c) => (c.ovenLow ? .6 : -.5) + (isN(h) ? .2 : 0), needLogs: true },
  dishes:    { room: 'kitchen',  give: { tidy: -.4 }, label: 'моет посуду',               when: (h, c) => (c.dirty >= 2 ? .8 : c.dirty === 1 ? (c.justAte ? .3 : -.2) : c.dirty === 0 ? -1.5 : (c.justAte ? .7 : 0)) },
  saw:       { room: 'workshop', give: { fun: -.25 }, label: 'пилит доску',               when: h => (h >= 9 && h < 17 ? .2 : -.6) },
  hammer:    { room: 'workshop', give: { fun: -.2, tidy: .03 }, label: 'стучит молотком', dur: [18, 35], when: h => (h >= 9 && h < 18 ? .15 : -.8) },
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
  // house repairs (Pavel): each go takes the wear down; spread over every corner of the house
  fix_shingle: { room: 'outside',  give: { wear: -.3, fun: -.05 }, label: 'чинит черепицу',     when: h => (h >= 9 && h < 17 ? .3 : -1.5) },
  fix_board:   { room: null,       give: { wear: -.25 },           label: 'меняет доску в полу', when: h => (h >= 8 && h < 18 ? .25 : -.8) },
  fix_wall:    { room: null,       give: { wear: -.2, comfort: -.05 }, label: 'латает стену',   when: h => (h >= 8 && h < 18 ? .25 : -.8) },
  fix_rope:    { room: 'outside',  give: { wear: -.15, safety: -.05 }, label: 'перевязывает узлы на лестнице', when: h => (h >= 8 && h < 18 ? .05 : -1) },
  fix_hinge:   { room: null,       give: { wear: -.15, safety: -.08 }, label: 'смазывает петли', when: h => (h >= 16 && h < 21 ? .15 : 0) },
  fix_window:  { room: null,       give: { wear: -.2, comfort: -.05 }, label: 'чинит окно',     when: h => (h >= 9 && h < 18 ? .05 : -.6) },
  fix_railing: { room: 'outside',  give: { wear: -.2, safety: -.05 }, label: 'чинит перила',    when: h => (h >= 9 && h < 17 ? .05 : -1.2) },
  clear_roof:  { room: 'outside',  give: { wear: -.15, tidy: -.05 }, label: 'сметает листья с крыши', when: h => (h >= 9 && h < 17 ? .3 : -1.5) },
  fix_chimney: { room: 'outside',  give: { wear: -.25, comfort: -.05 }, label: 'чистит трубу',  when: (h, c) => (h >= 10 && h < 16 && !c.ovenLit ? .1 : -2) },
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
  const windy = () => { try { const w = window.__wind; const g = w && (w.strength ? w.strength() : w.gust ? w.gust() : 0); return Math.max(0, Math.min(1, +g || 0)); } catch (e) { return 0; } };
  const weather = () => { try { const W = window.__weather; return W && W.state ? W.state() : null; } catch (e) { return null; } };
  const raining = () => { const s = weather(); if (s) return !!s.rain && s.rain !== 'none'; try { const w = window.__wind; return !!(w && w.raining && w.raining()); } catch (e) { return false; } };
  const chilly = h => { const s = weather(); return s ? !!s.cold || s.feels < 6 : (h < 9 || h > 17); };
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
  const need = { hunger: .35, energy: .8, fun: .4, tidy: .25, comfort: .3, curiosity: .3, safety: .2, wear: .25 };
  let mood = .6;
  let lastH = hour();
  let cur = null;           // {name, t, dur, min, opts}
  const plan = [];          // queued steps: {task, opts, why}
  const recent = [];        // last activities
  let scores = [];          // for the panel
  let why = '';
  let lingerCool = 0, roomNow = null, roomT = 0;
  // a visit: when he arrives somewhere he means to do 2-4 things there before moving on (Pavel: never up and straight back down)
  const DECK = ['look', 'telescope', 'ledge', 'fix_railing', 'clear_roof', 'fix_shingle', 'fix_chimney'];
  const area = n => DECK.includes(n) ? 'deck' : (JOBS[n] || ['splitwood', 'firewood', 'fix_rope'].includes(n)) ? 'ground' : ((ACTS[n] || EXTRA[n] || {}).room || null);
  const visit = { area: null, left: 0, since: 0 }; let nowT = 0;   // nowT: real seconds the brain has run
  const MIN_VISIT = 40;   // HERO-RULES 3.7: a believable stay at a place, 40-90 s
  function visitBonus(n) {
    const a = area(n);
    const young = visit.area && nowT - visit.since < MIN_VISIT;   // he only just got here: stay
    if ((!visit.left && !young) || !visit.area) return null;            // no visit going on: the usual room logic
    if (a === visit.area) return young ? 1.6 : 1.1;                       // more to do here
    if (a === null) return .3;                              // small things that can be done anywhere
    return young ? -1.2 : -.5;                             // elsewhere: later
  }
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
  let jumped = false;
  function gameHours() { const h = hour(); let d = h - lastH; if (d < -12) d += 24; if (d < -.05 || d > 3) jumped = true; if (d < 0 || d > 3) d = 0; lastH = h; return d; }

  function drift(dt, dh, v) {
    const h = v.hour, asleep = v.task === 'sleep' && (v.inBed || v.step === 'sleep');
    for (const k in NEEDS) {
      let r = NEEDS[k].drift;
      if (asleep) r = k === 'energy' ? .16 : k === 'hunger' ? .02 : k === 'fun' || k === 'curiosity' ? -.015 : 0;
      if (k === 'comfort' && isNight(h)) r *= 1.8;
      if (k === 'wear') r = asleep ? .01 : .02 * (raining() ? 2.5 : 1) * (1 + windy());
      if (k === 'safety') r = asleep ? -.04 : (isNight(h) ? .06 : h >= 17 ? .035 : -.02) * (raining() ? 1.5 : 1);
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
    // weather sets the tone: a grey rain pulls the mood down a little, a clear sunny morning lifts it
    const W = weatherMood(h);
    mood = lerp(mood, clamp(1 - bad * 1.6 + W), 1 - Math.exp(-dt * .05));
    // when the rain stops: a couple of game hours in which the outside repairs call (the roof leaked, leaves everywhere)
    const r = raining(); if (wasRain && !r) afterRainH = h; wasRain = r;
  }
  let wasRain = false, afterRainH = -99;
  const afterRain = h => { let d = h - afterRainH; if (d < 0) d += 24; return afterRainH > -1 && d < 3 && !raining(); };
  function sunnyMorning(h) { const w = weather(); return h >= 6.3 && h < 10.5 && !raining() && (!w || w.state === 'clear' || w.state === 'calm'); }
  function weatherMood(h) { if (raining()) { const w = weather(); return w && w.state === 'storm' ? -.15 : -.07; } return sunnyMorning(h) ? .08 : 0; }
  // weather and time of day on top of the needs
  const DECK_OUT = ['look', 'telescope', 'ledge'], ROOF = ['fix_shingle', 'clear_roof', 'fix_railing', 'fix_chimney', 'fix_rope'], COSY = ['tea', 'read', 'diary', 'radio', 'listen', 'window', 'stoke'];
  function weatherBonus(n, h) {
    let s = 0;
    if (raining()) { if (COSY.includes(n)) s += .35; if (n === 'window' || n === 'listen') s += .15; }   // rain on the roof: indoors, warm, watching it
    else {
      if (sunnyMorning(h) && DECK_OUT.includes(n)) s += .6;          // a clear morning: out to the deck
      if (afterRain(h) && ROOF.includes(n)) s += .9;                 // the rain is over: see what it did
      if (afterRain(h) && n === 'dump') s += .3;
    }
    return s;
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
  // ---------- the value system (Pavel): importance of the need × how pressing it is × how much the action meets it ----------
  // Meters 0..1 (1 = pressing). Real needs live in `need` (energy is shown as tiredness = 1 - energy); the household meters
  // are read from the world: food in stock, water in the tap bucket, the drain bucket, logs.
  const VIRT = { food: { w: 2.2, label: 'Нет еды в запасе' }, water: { w: 1.8, label: 'Мало воды' }, drain: { w: 1.1, label: 'Полное ведро слива' }, logs: { w: 1.0, label: 'Мало дров' } };
  function meters() {
    const m = {}; for (const k in NEEDS) m[k] = k === 'energy' ? 1 - need.energy : need[k];
    if (ECON) { m.food = stock.meal ? 0 : stock.meat >= 2 ? 0 : stock.meat === 1 ? .35 : clamp(.55 + need.hunger * .45); m.logs = stock.logs === 0 ? .9 : stock.logs <= 2 ? .45 : 0; }
    if (WATER()) { m.water = clamp(1 - stock.clean); m.drain = stock.dirtyW; }
    return m;
  }
  const W = k => (NEEDS[k] || VIRT[k] || { w: 0 }).w;
  // how pressing a meter is: gentle while low, steep past 0.7, so a real need always beats a whim
  const urgency = v => v * v + 4 * Math.max(0, v - .7) ** 2;
  let M = {};
  const XS = 2;   // a chore lasts 15-60 s like an activity: one go counts double of its listed give
  // eff: how much one go lowers each meter (fractions of the whole scale). Value = sum of weight × urgency × the part he can use
  function value(eff) {
    let s = 0, top = '', topV = 0;
    for (const k in eff) { const e = eff[k]; if (!(e > 0) || M[k] == null) continue;
      const v = W(k) * urgency(M[k]) * Math.min(e, M[k] + .05) * 2;
      s += v; if (v > topV) { topV = v; top = k; } }
    return { s, top };
  }
  // ACTS pay per second while he does them: one go = that × a typical stay
  const effOf = name => { const A = ACTS[name]; if (A) { const d = (A.dur[0] + A.dur[1]) / 2, e = {}; for (const k in A.gives) e[k] = -A.gives[k] * d; return e; }
    const E = EXTRA[name]; if (E) { const e = {}; for (const k in E.give) e[k] = -E.give[k] * XS; return e; } return JOBS[name] ? JOBS[name].eff : {}; };
  function score(name, h) {
    const A = ACTS[name];
    let s, top;
    if (name === 'sleep') ({ s, top } = value({ energy: 1, comfort: .3 }));
    else if (name === 'cook' && ECON) ({ s, top } = value({ hunger: .55, comfort: .1, fun: .05 }));   // cooking is the way to the meal
    else ({ s, top } = value(effOf(name)));
    s += habit(name, h);
    if (A.room === 'outside' && raining()) s -= 2;   // nobody stands on the deck in the rain
    s += weatherBonus(name, h);
    if (locked) s += lockScore(name);               // lockdown: quiet, inside, his side of the hatch
    s -= travel(A.node) * (.15 + (1 - need.energy) * .25);
    // cabin fever: the longer he stays in one room, the more the other rooms call
    const vb = name === 'sleep' ? null : visitBonus(name);
    if (vb != null) s += vb;
    else if (A.room && A.room !== roomNow) s += Math.min(.7, roomT / 70);
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
    let { s, top } = value(JOBS[n].eff);
    if ((n === 'hunt' && h > 14.5) || (n === 'wood' && h > 15.5)) s -= emergency && n === 'hunt' ? .5 : 3;   // a trip takes hours: set off early enough to be home by dark
    if (n === 'hunt') { if (stock.meat >= 2 || stock.meal) s = -9; if (!day && !(emergency && !raining())) s -= 3; else if (!day && !dawnDusk) s -= .4; }
    if (n === 'wood') { if (stock.logs > 2) s = -9; if (!day) s -= 3; }
    // the pond walk is something to see (Pavel): by daylight he tops the bucket up early, at night only when it is really empty
    if (n === 'fetch') { const lightDay = h >= 8 && h < 17.5 && !raining(); if (!WATER() || stock.clean > .6) s = -99; else if (lightDay) s += .5 + (sunnyMorning(h) ? .3 : 0); }
    if (n === 'dump') { if (!WATER() || stock.dirtyW < .55) s = -99; }
    if ((n === 'fetch' || n === 'dump') && (h < 6.5 || h > 20.5)) s -= n === 'fetch' && stock.clean < .15 ? .6 : 1.6;
    if (n === 'eat') { if (!stock.meal || (need.hunger < .3 && recent[0] !== 'cook')) s = -9; else s += .3 + (recent[0] === 'cook' ? 1.5 : 0); }   // a pot of stew: two portions   // cooked: sits down to eat while it is hot
    if (raining() && JOBS[n].task === 'trip') s -= 1;
    if (locked && n !== 'eat') s -= 20;             // lockdown: no trips, no water runs
    const i = recent.indexOf(n); if (i === 0 && n !== 'eat') s -= .6;
    return { name: n, s: s + rnd(0, .25), top: top || JOBS[n].top };
  }
  // the small chores: each go fixes a little; habits of the hour; never the same thing twice in a row
  const day = { hadTea: false, bolted: false, justWoke: false, justAte: false };
  const canDo = n => { const E = EXTRA[n]; if (E.task) return true; return !!(HH.hasTask && HH.hasTask(n)); };
  function extraScore(n, h) {
    if (!canDo(n)) return null;
    const E = EXTRA[n];
    if (E.needLogs && ECON && !stock.logs) return null;
    if (E.room === 'outside' && raining()) return null;
    let { s, top } = value(effOf(n));
    s += E.when(h, { logs: ECON ? stock.logs : 5, ovenLow: lights && lights.level && lights.level('oven') < .3 && isN(h), justWoke: day.justWoke, justAte: day.justAte, bolted: day.bolted, hadTea: day.hadTea, dirty: dirty(), ovenLit: !!(lights && lights.level && lights.level('oven') > .2) });
    s += weatherBonus(n, h);
    // a house that is in good shape needs no repairs: he waits until wear has built up (a full-day watch: 6 repairs at wear ~0)
    if (/^fix_/.test(n) && need.wear < .15) s -= 2.5 * (1 - need.wear / .15);
    // autumn litter on the roofs and deck (wind.js): he sweeps when it is leafy, skips it when clean
    if (n === 'clear_roof') { try { const L = window.__wind && window.__wind.litter; if (L && L.level) s += 1.5 * (L.level() - .4); } catch (e) {} }
    if (locked) { const l = lockScore(n); if (l <= -20) return null; s += l; }
    const vb = visitBonus(n);
    if (vb != null) s += vb;
    else if (E.room && E.room === roomNow) s += Math.max(0, .35 - roomT / 120); else if (!E.room) s += .15;   // things at hand first
    if (E.room === 'outside' && roomNow !== 'outside' && h >= bedTime - 1.3 && h < 23.9) s -= 1;   // no setting off outdoors just before bed
    const i = recent.indexOf(n); if (i === 0) s -= 2; else if (i === 1) s -= .5; else if (i >= 2) s -= .2;
    return { name: n, s: s + rnd(0, .3), top: top || '' };
  }
  function decide(h) {
    if (day.justWoke && day.wokeAt != null && (h - day.wokeAt + 24) % 24 > 2) day.justWoke = false;   // the morning routine is over
    M = meters();
    scores = Object.keys(ACTS).map(n => score(n, h));
    for (const n in EXTRA) { const x = extraScore(n, h); if (x) scores.push(x); }
    // no water in the tap bucket (or the drain bucket is full): no washing, tea or cooking until he sees to it
    // the body has a real dishes task (tap, plates put away): the old 'wash' gesture is not used
    if (HH.hasTask && HH.hasTask('dishes')) for (const x of scores) if (x.name === 'wash') x.s -= 20;
    if (WATER()) for (const x of scores) if (WET[x.name] && (stock.clean < WET[x.name] || stock.dirtyW > .95)) x.s -= 9;
    if (!ECON && WATER()) for (const n of ['fetch', 'dump']) scores.push(jobScore(n, h));
    if (ECON) { for (const x of scores) if (x.name === 'cook') { if (!stock.meat || !stock.logs || stock.meal) x.s -= 9; } for (const n in JOBS) scores.push(jobScore(n, h)); }
    for (const x of scores) if (JOBS[x.name]) { const vb = visitBonus(x.name); if (vb != null) x.s += vb; }
    scores.sort((a, b) => b.s - a.s);
    if (h >= bedTime || h < 5 || need.energy < .06) return scores.find(x => x.name === 'sleep');   // past bedtime (or dead tired): bed, no lottery
    // weighted lottery among the three best (softmax with a mood-dependent temperature)
    const best = scores.slice(0, 3);
    const T = .18 + mood * .12;
    const w = best.map(x => Math.exp((x.s - best[0].s) / T));
    let r = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < best.length; i++) { r -= w[i]; if (r <= 0) return best[i]; }
    return best[0];
  }

  // ---------- plan an activity: lights first, a pause maybe, then the thing ----------
  const AREA_NODE = { kitchen: 'kmid', bedroom: 'bed_app', workshop: 'wmid', deck: 'deck', ground: 'g_foot', outside: 'deck' };
  // real seconds per game hour (measured from the clock, so it follows any change of the day length)
  let sph = 60, sphH = null, sphT = 0;
  function secPerHour() { return sph; }
  function measureClock(dt) { const h = hour(); if (sphH == null) { sphH = h; sphT = 0; return; } sphT += dt; let d = h - sphH; if (d < 0) d += 24; if (sphT > 4) { if (d > .05 && d < 3) sph = sph * .7 + (sphT / d) * .3; sphH = h; sphT = 0; } }
  // the jacket (Pavel): off and on its hook before bed; in the morning on only if it is cold or raining; off again once it warms up.
  // Body: task 'jacket' {on} at the peg, state HH.gear.coat (Character). Without them nothing is planned.
  const canJacket = () => !!(HH.hasTask && HH.hasTask('jacket') && HH.gear);
  const wearing = () => { try { return !!(HH.gear && HH.gear.coat); } catch (e) { return false; } };
  function roomsOnWay(node) {
    if (!node || !HH.route || !H.node) return [];
    let r; try { r = HH.route(H.node, node) || []; } catch (e) { return []; }
    const out = []; for (const st of r) { const x = ROOM_OF(st.node); if (x && !out.includes(x)) out.push(x); } return out;
  }
  function planFor(name, h, reason) {
    plan.length = 0;
    const from = ROOM_OF(H.node), A = ACTS[name] || EXTRA[name] || { room: name === 'eat' ? 'kitchen' : 'outside' };
    const to = A.room || from;
    // leaving a lit room: usually switch it off (sometimes he forgets, and the lamp burns on: lamps never go out by themselves)
    if (from !== to && ROOM_LAMP[from] && lampOn(ROOM_LAMP[from]) && Math.random() < .8)
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[from], on: false }, why: dark(h) ? 'уходит — гасит свет' : 'светло — уходя, гасит лампу' });
    // a lamp forgotten earlier in a room he walks through: he notices it on the way and puts it out (usually)
    for (const r of roomsOnWay(A.node || AREA_NODE[area(name)] || AREA_NODE[to])) if (r !== from && r !== to && ROOM_LAMP[r] && lampOn(ROOM_LAMP[r]) && Math.random() < .85)
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[r], on: false }, why: 'по пути: забытая лампа — гасит' });
    // the floor hatch is closed and the way goes through it: open it first (without a hatch task the ladder climb opens it by hand)
    { const H8 = house(); const up = r => r === 'bedroom';
      if (!locked && H8 && H8.hatch && H8.hatch.isOpen && !H8.hatch.isOpen() && name !== 'sleep' && up(from) !== up(to) && !(A.node && /^(deck|ledge|ll_)/.test(A.node))) {
        if (HH.hasTask && HH.hasTask('hatch')) plan.push({ task: 'hatch', opts: { open: true }, why: 'открывает люк' }); /* else the ladder opens it under his hand */ } }
    if (name === 'sleep' && canJacket() && wearing()) plan.push({ task: 'jacket', opts: { on: false }, why: 'перед сном вешает куртку на крючок' });
    // warm again (midday, dry): the jacket comes off when he passes by; cold or wet: on before going out (or in a cold morning)
    else if (canJacket() && name !== 'sleep' && !JOBS[name]) {
      const out = ['deck', 'ground'].includes(area(name)) || (ACTS[name] && ACTS[name].room === 'outside');
      if (wearing() && !chilly(h) && !raining() && Math.random() < .6) plan.push({ task: 'jacket', opts: { on: false }, why: 'потеплело — снимает куртку' });
      else if (!wearing() && (raining() || chilly(h)) && (out || day.justWoke) && Math.random() < .75) plan.push({ task: 'jacket', opts: { on: true }, why: raining() ? 'дождь — надевает куртку' : 'зябко — надевает куртку' });
    }
    // going to bed: make the house safe first (Pavel): usually he closes the floor hatch and bolts the door, sometimes he forgets
    if (name === 'sleep') {
      const H8 = house();
      // the door below first, then the hatch from above on the way to bed (never shut himself out of his own route)
      if (!day.bolted && HH.hasTask && HH.hasTask('bolt') && (locked || Math.random() < .75)) plan.push({ task: 'bolt', opts: { lock: true }, why: 'на ночь запирает дверь', extra: 'bolt' });
      if (H8 && H8.hatch && H8.hatch.isOpen && H8.hatch.isOpen() && HH.hasTask && HH.hasTask('hatch') && (locked || Math.random() < .7))
        plan.push({ task: 'hatch', opts: { open: false, side: 'top' }, why: 'на ночь закрывает люк' });
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
    if (EXTRA[name]) { const E = EXTRA[name]; plan.push({ task: E.task || name, opts: repairTarget(name), why: reason, extra: name }); }
    else if (JOBS[name]) plan.push({ task: JOBS[name].task, opts: { ...JOBS[name].opts, linger: name === 'fetch' ? rnd(4, 9) : 0, washFace: name === 'fetch' && !dark(h) && Math.random() < .5, away: secPerHour(h) * (name === 'hunt' ? rnd(.6, 1.1) : rnd(.4, .8)), lantern: dark(h), bow: name === 'hunt', jacket: raining() || (chilly(h) && Math.random() < .8) || Math.random() < .1, keepJacket: raining() || chilly(h) }, why: reason, job: name });
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
    job = st.job || null; extra = st.extra || null; lastOpts = st.opts;
    // using water: the tap bucket goes down, the drain bucket fills
    { const w = WET[st.extra || st.task], W = propsWater();
      if (w && WATER() && !W) { stock.clean = clamp(stock.clean - w); stock.dirtyW = clamp(stock.dirtyW + w * .9); showStock(); }
      // tea and cooking take water from the tap bucket too (the body's dishes task runs the tap itself)
      else if (W && (st.task === 'tea' || st.task === 'cook') && W.setClean) { W.setClean(W.clean - w); W.setDirty(W.dirty + w * .8); } }
    if (extra) { recent.unshift(extra); recent.length = 4; }
    // he stops reading: from now on the candle is his to blow out (or to forget)
    if (cur && cur.name === 'read' && st.task !== 'read' && hasCandle) lights.set('candle', candleOn());
    expected = st.task;
    { const n = st.extra || st.job || st.task;
      if (ACTS[n] || EXTRA[n] || JOBS[n]) { const a = area(n);
        if (n === 'sleep' || JOBS[n]) { visit.area = null; visit.left = 0; }
        else if (a && a === visit.area) visit.left = Math.max(0, visit.left - 1);
        else if (a) { visit.area = a; visit.since = nowT; visit.left = 1 + Math.floor(Math.random() * 3); } } }
    tr('start:' + (st.extra || st.job || st.task) + (st.task === 'switch' && st.opts ? ':' + st.opts.light + (st.opts.on ? '+' : '-') : '')); trace[trace.length - 1].room = roomOfTask(st.extra || st.job || st.task);
    if (st.task === 'tea') day.hadTea = true;
    // reading in the dark: the candle lights itself when he sits down (lights.js); only putting it out is his job
    if (st.task === 'read' && hasCandle && lights.auto) lights.auto('candle');
    const A = ACTS[st.task];
    cur = st.cmd ? { name: st.task, t: 0, opts: st.opts, dur: A ? A.dur[1] * .7 : 0, min: A ? A.dur[0] * .7 : 0, cmd: true }
      : { name: st.task, t: 0, opts: st.opts, dur: A ? rnd(A.dur[0], A.dur[1]) : 0, min: A ? Math.max(8, A.dur[0] * .8) : 0 };
    if (A) { recent.unshift(st.task); recent.length = 4; }
    setGait();
    HH.startTask(st.task, st.opts);
    return true;
  }

  function roomOfTask(n) { const A = ACTS[n] || EXTRA[n]; if (A) return A.room || ROOM_OF(H.node); if (JOBS[n]) return n === 'eat' ? 'kitchen' : 'outside'; return n === 'switch' || n === 'micro' ? '-' : ROOM_OF(H.node); }
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
  let locked = false, lockWhy = '';
  let lockAsk = (() => { try { return /[?&]lockdown\b/.test(location.search); } catch (e) { return false; } })();   // ?lockdown: debug
  // lockdown inside: quiet things, keep an ear on the windows; nothing loud, no lamps but one, nobody goes out
  const QUIET = { read: .5, diary: .5, listen: .9, window: .8, sharpen: .4, supplies: .5, fixlamp: .3, tea: .3, fix_window: .4, bolt: .2, stretch: .2, fix_hinge: .2 };
  const LOUD = ['saw', 'hammer', 'chop', 'splitwood', 'radio', 'sweep', 'fix_board', 'fix_wall', 'craft'];
  const hatchShut = () => { const H8 = house(); return !!(H8 && H8.hatch && H8.hatch.isOpen && !H8.hatch.isOpen()); };
  const sideOf = r => r === 'bedroom' ? 'up' : 'down';
  function lockScore(n) {
    if (!locked) return 0;
    const a = area(n);
    if (a === 'deck' || a === 'ground' || (ACTS[n] && ACTS[n].room === 'outside')) return -20;
    let s = (QUIET[n] || 0) - (LOUD.includes(n) ? 1.2 : 0);
    const r = ['bolt', 'fix_hinge'].includes(n) ? 'kitchen' : (ACTS[n] || EXTRA[n] || {}).room;   // the door is below the hatch
    if (r && hatchShut() && sideOf(r) !== sideOf(ROOM_OF(H.node))) s -= 6;   // the hatch is shut: he stays on his side of it
    return s;
  }
  // rarely, on a bad night (strange noises got to him), he locks himself in on his own; it lifts in the morning
  function lockSteps() {
    const H8 = house(), canHatch = HH.hasTask && HH.hasTask('hatch');
    // the door below first, the lamps below off, then up the ladder and the hatch shut from above (side 'top'): he sits it out upstairs
    const bolt = HH.hasTask && HH.hasTask('bolt') && !day.bolted;
    const lamps = Object.keys(ROOM_LAMP).filter(r => r !== 'bedroom' && lampOn(ROOM_LAMP[r]));
    let reopened = false;
    if ((bolt || lamps.length) && hatchShut() && sideOf(ROOM_OF(H.node)) === 'up' && canHatch) { plan.push({ task: 'hatch', opts: { open: true }, why: 'запирается: спускается к двери' }); reopened = true; }
    if (bolt) plan.push({ task: 'bolt', opts: { lock: true }, why: 'запирается: засов', extra: 'bolt' });
    for (const r of lamps) plan.push({ task: 'switch', opts: { light: ROOM_LAMP[r], on: false }, why: 'запирается: гасит свет внизу' });
    // shutters (only the body closes them, with its hands): the windows below before he goes up, the hatch shut from above,
    // then the window(s) upstairs; going down again for a shutter would open the hatch on the way (QA 2026-11-23)
    const canSh = HH.hasTask && HH.hasTask('shutters'), WIN = { bwin: 'bedroom', kwin: 'kitchen', wwin: 'workshop' };
    const below = Object.keys(WIN).filter(w => sideOf(WIN[w]) !== 'up'), above = Object.keys(WIN).filter(w => sideOf(WIN[w]) === 'up');
    if (canSh && below.length) plan.push({ task: 'shutters', opts: { close: true, windows: below }, why: 'запирается: ставни внизу' });
    if ((reopened || (H8 && H8.hatch && H8.hatch.isOpen && H8.hatch.isOpen())) && canHatch) plan.push({ task: 'hatch', opts: { open: false, side: 'top' }, why: 'запирается: люк' });
    if (canSh && above.length) plan.push({ task: 'shutters', opts: { close: true, windows: above }, why: 'запирается: ставни' });
    // no body task for it yet: they stay as they are (HERO-RULES 3.3, nothing moves unless a hand holds it)
  }
  function maybeLockdown(h) {
    if (locked || !isN(h) || h < 19 && h > 6) return;
    if (need.safety > .85 && Math.random() < .35) { lockWhy = 'страшно — запирается на ночь'; brain.lockdown(true); }
  }
  // real parts of the house (index.html window.__planks): a repair picks an actual old board / slate / beam,
  // the hero goes there (opts.target, opts.pos), and the parts he fixed look new, fading back to old over ~3 game days
  const PLANK_KIND = { fix_shingle: 'shingle', fix_board: 'floor', fix_wall: 'wall', fix_railing: 'beam' };
  const planks = () => { try { return window.__planks || null; } catch (e) { return null; } };
  const freshList = new Map();   // id -> fresh value we set
  function repairTarget(name) {
    const P = planks(), kind = PLANK_KIND[name];
    if (!P || !kind || !P.list) return {};
    let all = P.list(kind); if (!all.length) return {};
    // slates: only those he can reach from where he can stand (within ~1.5 m of a walkable spot, at most ~2.2 m up);
    // the far roofs need a roof-access point first. None in reach: the body's own default spot on the deck.
    if (kind === 'shingle') { all = reachable(all); if (!all.length) return {}; }
    // the oldest of a few random candidates, a little biased toward the room he is in
    let best = null, bs = 1e9; const hp = H.root ? H.root.position : null;
    for (let i = 0; i < 12; i++) { const c = all[Math.floor(Math.random() * all.length)]; const d = hp ? Math.hypot(c.pos[0] - hp.x, c.pos[1] - hp.y, c.pos[2] - hp.z) : 0; const sc = c.fresh * 3 + d * .08 + Math.random() * .3; if (sc < bs) { bs = sc; best = c; } }
    return best ? { target: best.id, pos: best.pos, kind } : {};
  }
  let reachCache = null, warmT = 0;
  function reachable(list) {
    if (reachCache && reachCache.n === list.length) return reachCache.r;
    const N = HH.N || {}, spots = [];
    for (const k in N) { const n = N[k]; if (n && n.p && n.seat == null) spots.push(n.p); }
    const r = list.filter(c => spots.some(p => Math.hypot(c.pos[0] - p.x, c.pos[2] - p.z) < 1.5 && c.pos[1] - p.y > -.3 && c.pos[1] - p.y < 2.2));
    reachCache = { n: list.length, r }; return r;
  }
  function markRepaired(opts) {
    const P = planks(); if (!P || !opts || opts.target == null) return;
    const ids = P.near ? P.near(opts.pos[0], opts.pos[1], opts.pos[2], .55, opts.kind) : [];
    for (const id of new Set([opts.target, ...ids])) { const f = id === opts.target ? 1 : .75; P.setFresh(id, f); freshList.set(id, f); }
  }
  function ageParts(dh) {
    if (!freshList.size || dh <= 0) return; const P = planks(); if (!P) return;
    for (const [id, f] of freshList) { const n = f - dh / 72; if (n <= 0) { P.setFresh(id, 0); freshList.delete(id); } else { freshList.set(id, n); if (Math.random() < .02) P.setFresh(id, n); } }
  }
  // a strange sound in the night: he startles, stops, turns toward it and listens; if it gets to him, he checks the bolt
  let uneaseOff = null, startleT = 0;
  function onUnease(e) {
    need.safety = clamp(need.safety + .06 + (e && e.anx ? e.anx * .04 : 0));
    if (!(H.task === 'sleep' || H.inBed)) { maybeLockdown(hour()); if (locked) return; }
    if (H.task === 'sleep' || H.inBed || startleT > 0) return;
    // in the middle of a job with several stages (eating, dishes, water, a trip, a repair): he only pricks up his ears and goes on,
    // a restarted job would send him back to its first stage (QA run 12: turning back at eat / dishes / fetchwater)
    if (cur && !ACTS[cur.name] && !['switch', 'micro'].includes(cur.name)) { tr('unease:ignored'); return; }
    tr('unease');
    startleT = 25;
    const p = e && e.pos ? { x: e.pos[0], y: e.pos[1], z: e.pos[2] } : null;
    const steps = [{ task: 'micro', opts: { clip: '336', dur: rnd(3, 5), look: p }, why: 'что это было? прислушивается' }];
    { const H8 = house(); if (need.safety > .45 && H8 && H8.hatch && H8.hatch.isOpen && H8.hatch.isOpen() && ROOM_OF(H.node) === 'bedroom' && HH.hasTask && HH.hasTask('hatch')) steps.push({ task: 'hatch', opts: { open: false, side: 'top' }, why: 'люк остался открытым — закрывает' }); }
    if (need.safety > .55 && !day.bolted && HH.hasTask && HH.hasTask('bolt')) steps.push({ task: 'bolt', opts: { lock: true }, why: 'на всякий случай проверяет засов', extra: 'bolt' });
    if (cur && cur.name !== 'sleep' && !['switch', 'micro', 'hatch', 'bolt'].includes(cur.name)) steps.push({ task: cur.name, opts: ACTS[cur.name] ? {} : (cur.opts || lastOpts || {}), why: 'возвращается к делу', extra: extra || undefined, job: job || undefined });
    plan.unshift(...steps.concat(plan.splice(0)));
    cur = null; pausing = 0; startNext();
  }
  // dirty dishes in the sink (props.js); -1 = unknown
  const dirty = () => { try { const D = window.__props && window.__props.dishes; return D && D.state ? D.state().dirty : -1; } catch (e) { return -1; } };
  const house = () => { try { return window.__house || null; } catch (e) { return null; } };
  let pausing = 0, expected, cmdNext = false, job = null, extra = null, lastOpts = null;
  function tick(dt, v) {
    dt = Math.min(dt, .25);   // a stalled frame (tab in the background, a hitch) never counts as a long stretch of work
    // one-off setup spread out of the decision frames: the slates in reach are worked out a few seconds after the start
    if (!reachCache && (warmT += dt) > 3) { try { const P = planks(); if (P && P.list) reachable(P.list('shingle')); } catch (e) {} }
    const dh = gameHours();
    measureClock(dt); nowT += dt;
    if (lockAsk) { lockAsk = false; brain.lockdown(true); }
    // the clock was set by hand (debug, tests): needs fit the new hour, as on a fresh start; what he is doing goes on
    if (jumped) { jumped = false; const h = hour(); const keep = { ...stock }, c = cur, e = expected, pl = plan.splice(0); brain.prime(h); Object.assign(stock, keep); cur = c; expected = e; plan.push(...pl); showStock(); tr('clockjump'); }
    ageParts(dh);
    // night noises (audio.js): subscribe once the sound system exists
    if (!uneaseOff) { try { const A = window.__audio; if (A && A.on) uneaseOff = A.on('unease', onUnease) || true; } catch (e) { uneaseOff = true; } }
    { const W = propsWater(); if (W) { stock.clean = W.clean; stock.dirtyW = W.dirty; } }
    drift(dt, dh, v);
    lingerCool -= dt;
    startleT -= dt;
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
      // a nap in the daytime (he was worn out): up again once rested, still well before bedtime
      const nap = h >= 9 && h < bedTime - 1.5 && need.energy > .6;
      if ((h >= wake && h < 12 && need.energy > .6) || (h >= wake + 1.2 && h < 12) || nap) {
        wake = rnd(5.6, 6.6); bedTime = rnd(20.8, 21.6);
        if (locked && h < 12) brain.lockdown(false);   // morning: the night is over (not after an evening nap)
        if (h < 12) { day.hadTea = false; day.bolted = false; day.justWoke = true; day.wokeAt = h; day.justAte = false; }   // a new day (not after a nap)
        tr('wake'); const d = decide(h); planFor(d.name, h, 'проснулся, хочет: ' + reasonOf(d));
        if (locked) { const rest = plan.splice(0); lockSteps(); plan.push(...rest); }
        startNext();
      }
      return;
    }

    // in daylight, a lamp left on in this room gets switched off
    const here = ROOM_OF(H.node);
    if (!dark(h) && ROOM_LAMP[here] && lampOn(ROOM_LAMP[here]) && v.task !== 'switch' && !plan.length && !cur) {   // only between activities (leaving a room he switches off himself, planFor)
      const keep = cur && ACTS[cur.name] ? cur.name : null;
      tr('dayLamp');
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[here], on: false }, why: 'светло — гасит лампу' });
      if (keep) plan.push({ task: keep, opts: {}, why });
      startNext(); return;
    }
    // it got dark while he is busy in an unlit room: get up and light it, then carry on
    if (dark(h) && ROOM_LAMP[here] && !lampOn(ROOM_LAMP[here]) && cur && ACTS[cur.name] && ACTS[cur.name].room === here && v.task !== 'sleep' && !plan.length && v.step !== 'go') {
      tr('darkLamp');
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[here], on: true }, why: 'стемнело — включает свет' });
      plan.push({ task: cur.name, opts: {}, why: 'продолжает' });
      startNext(); return;
    }

    // something else started a chore (the game, a test): let it run, it ends by itself
    if (v.task && !cur && !ACTS[v.task]) { cur = { name: v.task, t: 0, opts: {}, dur: 0, min: 0, cmd: true }; expected = v.task; tr('adopt:' + v.task); return; }
    if (!v.task || !cur) { choose(h, !v.task ? 'idle' : 'nocur:' + v.task); return; }
    // rain while he is outside: back under the roof
    if (raining() && cur && ACTS[cur.name] && ACTS[cur.name].room === 'outside' && !plan.length) { why = 'дождь — уходит под крышу'; choose(h, 'rain'); setGait(); return; }
    if (v.step === 'go') return;

    // commitment: stay until the need is met or he has had enough; leave early only for something urgent
    const A = ACTS[cur.name];
    // a chore (ends by itself): only bedtime or exhaustion cuts it short, and only once he has been at it a while
    // rain caught him at an outdoor chore: he finishes the stroke and goes under the roof
    if (!A && raining() && ['deck', 'ground'].includes(area(cur.name)) && EXTRA[cur.name] && cur.t > 3 && !plan.length) { why = 'дождь — уходит под крышу'; choose(h, 'rain'); return; }
    // watchdog: a chore the body never ends by itself (hammer is the open-ended craft clip) stops after its stay,
    // and any chore stuck past ~1.5 game hours at the spot is dropped (QA: 8 h of hammering, 2026-11-23)
    if (!A && EXTRA[cur.name] && !cur.cmd) { const E = EXTRA[cur.name]; if (cur.cap == null) cur.cap = E.dur ? rnd(E.dur[0], E.dur[1]) : 90;
      if (cur.t > cur.cap) { tr('watchdog:' + cur.name); if (E.give) for (const k in E.give) need[k] = clamp(need[k] + E.give[k] * (E.give[k] < 0 ? XS : 1)); choose(h, 'done'); return; } }
    if (!A) { if (cur.name !== 'sleep' && cur.t > 10 && (need.energy < .05 || (h >= bedTime + 1 && h < 23.9) || h < 4.5) && HH.hasTask && !['switch', 'micro', 'hatch', 'bolt', 'trip', 'eat', 'dishes', 'fetchwater', 'dumpwater', 'store', 'setbucket', 'firewood', 'jacket'].includes(cur.name) && !PLANK_KIND[cur.name]) { /* jobs with stages are finished first */ const d = decide(h); if (d.name === 'sleep') choose(h, 'urgent:sleep', d); } return; }
    const stay = cur.min + (cur.walk || 0) * .6;   // minimum dwell: base + 60% of the walk it took
    let done = cur.t > Math.max(cur.dur, stay);
    const main = Object.keys(A.gives).sort((a, b) => A.gives[a] - A.gives[b])[0];
    if (main && cur.t > stay && need[main] < .08) done = true;
    if (cur.cmd) { if (need.energy < .03 || (h >= bedTime + 1.5 && h < 23.9) || (h < 4 && h > 1)) done = true; else done = cur.t > cur.dur; }
    else if (cur.name !== 'sleep') {
      // early exits: only after the minimum dwell, unless it is really pressing
      // hysteresis: a pressing need only pulls him away once he has really started (a few seconds in), and only towards
      // something that serves it (food for hunger, bed for tiredness). Otherwise he stays; no stove <-> sink ping-pong.
      const EAT = ['cook', 'eat', 'tea', 'hunt', 'fetch', 'dump'];
      const hungry = !EAT.includes(cur.name) && need.hunger > (cur.t > stay ? .9 : .97);
      const sleepy = need.energy < (cur.t > stay ? .08 : .03) || (h >= bedTime + (cur.t > stay ? 0 : 1.2) && h < 23.9) || h < (cur.t > stay ? 5 : 4.5);
      if (!done && (hungry || sleepy) && cur.t > Math.min(4, stay) && cur.t > (cur.hold || 0)) {
        const d = decide(h);
        const serves = d.name !== cur.name && ((sleepy && d.name === 'sleep') || (hungry && EAT.includes(d.name)));
        if (serves) { choose(h, 'urgent:' + (sleepy ? 'sleep' : 'hunger'), d); return; }
        cur.hold = cur.t + 8;   // nothing better to do about it right now: carry on, look again in a while
      }
    }
    if (done) choose(h, 'done' + (cur.t > Math.max(cur.dur, stay) ? '' : ':early'));
  }
  const LABEL = k => k === 'energy' ? 'Усталость' : (NEEDS[k] || VIRT[k] || { label: k }).label;
  function reasonOf(d) { return d.top ? LABEL(d.top).toLowerCase() : 'привычка'; }
  function bookCook() { if (ECON && cur && cur.name === 'cook' && !cur.booked && cur.t > 6) { cur.booked = true; stock.meat = Math.max(0, stock.meat - 1); stock.logs = Math.max(0, stock.logs - 1); stock.meal = 2; showStock(); } }
  // decision trace (debug / QA): why each new choice was made
  const trace = [];
  function tr(kind) { trace.push({ h: +hour().toFixed(2), k: kind, cur: cur && cur.name, t: cur ? +cur.t.toFixed(1) : 0, task: H.task, plan: plan.map(p => p.task).join(',') }); if (trace.length > 1500) trace.shift(); }
  function choose(h, kind = 'choose', pre) {
    tr(kind);
    bookCook();
    const d = pre || decide(h);
    { const l = trace[trace.length - 1]; if (l) l.pick = d.name + ' < ' + scores.slice(0, 3).map(x => x.name + ':' + x.s.toFixed(2)).join(' '); }
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
.brainP{position:fixed;left:10px;bottom:106px;z-index:30;width:250px;padding:10px 12px;border-radius:14px;background:rgba(16,22,32,.78);color:#E9EEF5;font:12px/1.35 system-ui,sans-serif;backdrop-filter:blur(8px)}
.brainP b{font-weight:600}.brainP .r{display:flex;align-items:center;gap:6px;margin:2px 0}.brainP .r span{width:118px;opacity:.85;white-space:nowrap;overflow:hidden}
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
    const mm = meters();
    for (const k in mm) h += row(LABEL(k) + ` <i style="opacity:.55;font-style:normal">×${W(k)}</i>`, mm[k], col(mm[k]));
    h += row('Настроение', mood, mood > .6 ? '#7FC08A' : mood > .35 ? '#E3B55A' : '#E0705A');
    h += `<div class="s">Шаг: ${(HH.gait ? HH.gait.speed : 1).toFixed(2)} · варианты:<br>` + scores.slice(0, 4).map(s => `${(ACTS[s.name] || JOBS[s.name] || EXTRA[s.name]).label} <b>${s.s.toFixed(1)}</b>${s.top ? ' <i style="opacity:.6;font-style:normal">(' + LABEL(s.top).toLowerCase() + ')</i>' : ''}`).join('<br>') + '</div>';
    if (ECON) h += `<div class="s">Мясо: ${stock.meat} · брёвна: ${stock.logs}${stock.meal ? ' · обед готов' : ''}</div>`;
    if (WATER()) h += `<div class="s">Вода в ведре: ${Math.round(stock.clean * 100)}% · грязная: ${Math.round(stock.dirtyW * 100)}%</div>`;
    panel.innerHTML = h;
  }

  const brain = {
    need, stock, trace, get econ() { return ECON; }, get mood() { return mood; }, get why() { return why; }, plan, scores: () => scores,
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
      bedTime = h >= 21.5 ? Math.min(h, 21) : rnd(20.8, 21.6); wake = rnd(5.6, 6.6);
    },
    // a direct request (player / debug): it wins over needs; he only drops it when falling asleep on his feet or deep in the night
    // lockdown (for the zombie nights to come): hatch closed, door bolted, lamps low (only the room he is in), nobody goes out.
    // lockdown(false) lifts it; in the morning he reopens the hatch himself.
    lockdown(on = true) {
      locked = !!on; plan.length = 0; pausing = 0;
      if (!locked) { why = 'отбой тревоги'; tr('lockdown:off'); if (HH.hasTask && HH.hasTask('shutters')) plan.push({ task: 'shutters', opts: { close: false }, why: 'открывает ставни' }); return; }
      tr('lockdown:on');
      if (H.task === 'sleep' || H.inBed) { tr('lockdown:asleep'); return; }   // he is in bed: the steps come when he gets up
      lockSteps(); cur = null; why = lockWhy || 'запирается'; lockWhy = ''; startNext();
    },
    get locked() { return locked; },
    command(name, opts) {
      // asked again while already on the way to it (or doing it): keep going, do not restart the chain
      if (!opts && ((cur && cur.cmd && cur.name === ((JOBS[name] && JOBS[name].task) || name)) || plan.some(p => p.cmd && (p.task === name || p.extra === name || p.job === name)))) return;
      plan.length = 0; pausing = 0; cmdNext = false;
      // a known activity, job or chore: plan it like his own (lamps off when leaving, the lantern at night, hatch, job -> body task),
      // and the last step is the request itself, which the brain then does not overrule
      if (ACTS[name] || JOBS[name] || EXTRA[name]) {
        const h = hour(); const lab = (ACTS[name] || JOBS[name] || EXTRA[name]).label + ' (попросили)';
        planFor(name, h, lab);
        const last = plan[plan.length - 1]; if (last) { last.cmd = true; if (opts) last.opts = { ...last.opts, ...opts }; }
        cur = null; tr('command:' + name); why = lab; startNext(); return;
      }
      expected = name;
      if (!opts && EXTRA[name]) opts = repairTarget(name);
      extra = EXTRA[name] ? name : null; job = JOBS[name] ? name : null; lastOpts = opts || {};
      // a direct request is his task from now on: the brain does not overrule it (only falling asleep on his feet does)
      { const A = ACTS[name]; cur = { name, t: 0, opts: lastOpts, dur: A ? A.dur[1] * .7 : 0, min: A ? A.dur[0] * .7 : 0, cmd: true }; }
      tr('command:' + name); why = (ACTS[name] ? ACTS[name].label : name) + ' (попросили)'; HH.startTask(name, opts); },
    label: () => H.task === 'sleep' ? 'спит' : (cur && ACTS[cur.name] ? ACTS[cur.name].label : why),
    show(on = true) { shown = on; if (panel) panel.style.display = on ? 'block' : 'none'; },
  };
  ui();
  // a job ended: book what it brought (hero.js may pass a result; a missing result counts as success)
  if (HH.onTaskEnd) HH.onTaskEnd((name, res) => {
    // log every chore end with how long he was at it (QA: early ends are the body's, not a brain decision)
    if (name !== 'switch' && name !== 'micro') { tr('end:' + name); const l = trace[trace.length - 1]; l.res = res === undefined ? 'none' : JSON.stringify(res); l.step = HH.H && HH.H.task; }
    // a job done also does a little for the soul: a walk in the forest eases boredom and curiosity, a meal cheers him up
    if (job && JOBS[job] && res !== false && !(res && res.ok === false)) { const e = JOBS[job].eff; for (const k of ['fun', 'curiosity', 'comfort']) if (e[k] && !(job === 'eat' && k === 'comfort')) need[k] = clamp(need[k] - e[k]); }
    if (extra && EXTRA[extra] && res !== false) { const E = EXTRA[extra]; if (PLANK_KIND[extra]) markRepaired(lastOpts); for (const k in E.give) need[k] = clamp(need[k] + E.give[k] * (E.give[k] < 0 ? XS : 1));
      if (extra === 'bolt') day.bolted = true; if (extra === 'stretch') day.justWoke = false; if (extra === 'dishes') day.justAte = false;
      if (extra === 'stoke' && ECON) { stock.logs = Math.max(0, stock.logs - 1); showStock(); }
      if (extra === 'firewood' && ECON) { stock.logs += 2; showStock(); }
      extra = null; }
    if (!job || res === false || (res && res.ok === false)) { job = null; return; }
    if (job === 'hunt') { stock.meat += 2; plan.unshift({ task: 'store', opts: { item: 'meat' }, why: 'кладёт мясо в холодильник' }); }
    else if (job === 'wood') stock.logs += 3;
    else if (job === 'fetch') { /* the body's fetchwater already sets the bucket on the shelf above the sink */ stock.clean = 1; const W = propsWater(); W && W.setClean && W.setClean(1); }
    else if (job === 'dump') { stock.dirtyW = 0; const W = propsWater(); W && W.setDirty && W.setDirty(0); }
    else if (job === 'eat') { stock.meal = Math.max(0, stock.meal - 1); day.justAte = true; /* the body's eat leaves the plate dirty in the sink */ need.hunger = clamp(need.hunger - .75); need.comfort = clamp(need.comfort - .15); }
    job = null; showStock();
  });
  showStock();
  if (HH.setBrain) HH.setBrain(brain);
  return brain;
}
