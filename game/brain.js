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
//    usually switches it off when he leaves, and always switches the bedroom lamp off before he lies down.
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
  energy:    { drift: -.055, label: 'Силы' },      // goes down while awake
  fun:       { drift: .22,  label: 'Скука' },
  tidy:      { drift: .07,  label: 'Порядок' },
  comfort:   { drift: .09,  label: 'Уют' },        // cold, damp, wants to be cosy (faster at night)
  curiosity: { drift: .16,  label: 'Любопытство' },
};

// what each activity gives per real second of doing it, where it happens, how long he tends to do it
const ACTS = {
  cook:   { room: 'kitchen',  node: 'stove',     gives: { hunger: -.045, comfort: -.01 },           dur: [14, 26], label: 'готовит' },
  tea:    { room: 'kitchen',  node: 'sink',      gives: { hunger: -.015, comfort: -.03, fun: -.008 }, dur: [10, 18], label: 'пьёт чай' },
  wash:   { room: 'kitchen',  node: 'sink',      gives: { tidy: -.06 },                             dur: [8, 15],  label: 'моет посуду' },
  read:   { room: 'bedroom',  node: 'chair_app', gives: { fun: -.025, comfort: -.02 },              dur: [30, 70], label: 'читает' },
  craft:  { room: 'workshop', node: 'bench',     gives: { fun: -.04, tidy: .004 },                  dur: [16, 32], label: 'мастерит' },
  look:   { room: 'outside',  node: 'deck',      gives: { curiosity: -.06, fun: -.01, comfort: .006 }, dur: [10, 20], label: 'смотрит вдаль' },
  window: { room: null,       node: null,        gives: { curiosity: -.05 },                        dur: [7, 13],  label: 'смотрит в окно' },
  sleep:  { room: 'bedroom',  node: 'bed_app',   gives: {},                                         dur: [1e9, 1e9], label: 'спит' },
};
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
  const H = HH.hero || HH.H;
  const has = c => !!(HH.actions && HH.actions[c]);
  const need = { hunger: .35, energy: .8, fun: .4, tidy: .25, comfort: .3, curiosity: .3 };
  let mood = .6;
  let lastH = hour();
  let cur = null;           // {name, t, dur, min, opts}
  const plan = [];          // queued steps: {task, opts, why}
  const recent = [];        // last activities
  let scores = [];          // for the panel
  let why = '';
  let lingerCool = 0;
  let wake = rnd(6.3, 7.6); // he does not wake at the same minute every day
  let bedTime = rnd(21.6, 22.8);

  // ---------- lights: take the interior lamps over (the hero switches them from now on) ----------
  const LAMPS = lights ? Object.values(ROOM_LAMP).filter(n => lights.get && lights.get(n)) : [];
  for (const n of LAMPS) { const g = lights.get(n); lights.set(n, g.on); }
  const lampOn = n => !!(lights && lights.get(n) && lights.get(n).on);
  const dark = h => (h >= 19.2 || h < 6.6);

  // ---------- clock ----------
  function gameHours() { const h = hour(); let d = h - lastH; if (d < -12) d += 24; if (d < 0 || d > 3) d = 0; lastH = h; return d; }

  function drift(dt, dh, v) {
    const h = v.hour, asleep = v.inBed && v.task === 'sleep';
    for (const k in NEEDS) {
      let r = NEEDS[k].drift;
      if (asleep) r = k === 'energy' ? .11 : k === 'hunger' ? .03 : k === 'fun' || k === 'curiosity' ? -.05 : 0;
      if (k === 'comfort' && isNight(h)) r *= 1.8;
      if (k === 'energy' && !asleep && H.state === 'walk') r *= 1.4;
      need[k] = clamp(need[k] + r * dh);
    }
    // the activity pays out only while he is really doing it (not on the way)
    if (cur && v.step && v.step !== 'go' && ACTS[cur.name]) {
      const g = ACTS[cur.name].gives;
      for (const k in g) need[k] = clamp(need[k] + g[k] * dt);
    }
    // mood: slowly follows the average comfort of all needs
    const bad = (need.hunger ** 2 + (1 - need.energy) ** 2 + need.fun ** 2 + need.tidy ** 2 * .5 + need.comfort ** 2 + need.curiosity ** 2 * .5) / 5;
    mood = lerp(mood, clamp(1 - bad * 1.6), 1 - Math.exp(-dt * .05));
  }

  // ---------- scoring ----------
  function travel(nodeName) {
    if (!nodeName || !HH.route) return 0;
    const r = HH.route(H.node, nodeName);
    let c = 0; for (const s of r) c += s.t === 'ladder' ? .9 : .25;
    return c;
  }
  function habit(name, h) {
    const breakfast = h >= 6.5 && h < 9, lunch = h >= 12 && h < 14, dinner = h >= 17.5 && h < 19.5;
    switch (name) {
      case 'cook': return (breakfast || lunch || dinner) ? .45 : 0;
      case 'tea': return (h >= 7 && h < 10) || (h >= 15.5 && h < 17.5) ? .35 : 0;
      case 'wash': return (h >= 9 && h < 10.5) || (h >= 19 && h < 20.5) ? .2 : 0;
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
    s -= travel(A.node) * (.25 + (1 - need.energy) * .35);
    const i = recent.indexOf(name);
    if (i === 0) s -= .9; else if (i === 1) s -= .35; else if (i === 2) s -= .15;
    if (mood < .35 && (name === 'read' || name === 'tea')) s += .25;   // low mood: comfort first
    if (mood > .7 && (name === 'craft' || name === 'look')) s += .15;
    s += rnd(0, .3);
    return { name, s, top };
  }
  function decide(h) {
    scores = Object.keys(ACTS).map(n => score(n, h)).sort((a, b) => b.s - a.s);
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
    const from = ROOM_OF(H.node), A = ACTS[name];
    const to = A.room || from;
    // leaving a lit room in the dark: usually switch it off (sometimes he forgets)
    if (from !== to && ROOM_LAMP[from] && lampOn(ROOM_LAMP[from]) && dark(h) && Math.random() < .75)
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[from], on: false }, why: 'уходит — гасит свет' });
    // going to bed: the bedroom lamp off first, always
    if (name === 'sleep' && lampOn('bedroom'))
      plan.push({ task: 'switch', opts: { light: 'bedroom', on: false }, why: 'перед сном гасит свет' });
    // a dark room: light it first
    else if (name !== 'sleep' && ROOM_LAMP[to] && dark(h) && !lampOn(ROOM_LAMP[to]))
      plan.push({ task: 'switch', opts: { light: ROOM_LAMP[to], on: true }, why: 'темно — включает свет' });
    plan.push({ task: name, opts: {}, why: reason });
  }

  function startNext() {
    const st = plan.shift();
    if (!st) return false;
    why = st.why || why;
    const A = ACTS[st.task];
    cur = { name: st.task, t: 0, opts: st.opts, dur: A ? rnd(A.dur[0], A.dur[1]) : 0, min: A ? A.dur[0] * .6 : 0 };
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
    let s = .92 + (mood - .5) * .22 - tired * .22 + (urgent > .8 ? .1 : 0) + rnd(-.05, .05);
    if (dark(hour()) && !isNight(hour())) s -= .03;
    if (HH.gait) { HH.gait.speed = clamp(s, .7, 1.12); HH.gait.turn = clamp(.85 + mood * .3, .8, 1.15); }
  }

  // ---------- the per-frame tick (called by hero.js) ----------
  let pausing = 0;
  function tick(dt, v) {
    const dh = gameHours();
    drift(dt, dh, v);
    lingerCool -= dt;
    if (!v.free) return;
    const h = v.hour;
    if (cur) cur.t += dt;

    // a step that ends by itself (switch, micro) has ended: next step of the plan
    if (!v.task) {
      if (pausing > 0) { pausing -= dt; return; }
      if (startNext()) return;
      cur = null;
    }

    // sleeping: get up when rested and it is morning (or very rested)
    if (v.task === 'sleep') {
      if ((h >= wake && h < 12 && need.energy > .8) || (!isNight(h) && h > 9)) {
        wake = rnd(6.3, 7.6); bedTime = rnd(21.6, 22.8);
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
    if (v.step === 'go') return;

    // commitment: stay until the need is met or he has had enough; leave early only for something urgent
    const A = ACTS[cur.name];
    if (!A) return;
    let done = cur.t > cur.dur;
    const main = Object.keys(A.gives).sort((a, b) => A.gives[a] - A.gives[b])[0];
    if (main && cur.t > cur.min && need[main] < .08) done = true;
    if (cur.name !== 'sleep' && (cur.t > cur.min * .5 || h >= bedTime + .5 || h < 5)) {
      const urgent = (need.hunger > .9 && cur.name !== 'cook') || (need.energy < .08) || (h >= bedTime && h < 23.9) || (h < 5);
      if (urgent) done = true;
    }
    if (done) choose(h);
  }
  function reasonOf(d) { return d.top ? NEEDS[d.top].label.toLowerCase() : 'привычка'; }
  function choose(h) {
    const d = decide(h);
    planFor(d.name, h, ACTS[d.name].label + ' (' + reasonOf(d) + ')');
    if (cur && ACTS[cur.name] && cur.name !== 'sleep') micro(h);
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
    h += `<div class="s">Шаг: ${(HH.gait ? HH.gait.speed : 1).toFixed(2)} · варианты:<br>` + scores.slice(0, 4).map(s => `${ACTS[s.name].label} ${s.s.toFixed(2)}`).join('<br>') + '</div>';
    panel.innerHTML = h;
  }

  const brain = {
    need, get mood() { return mood; }, get why() { return why; }, plan, scores: () => scores,
    tick(dt, v) { tick(dt, v); draw(dt); },
    label: () => H.task === 'sleep' ? 'спит' : (cur && ACTS[cur.name] ? ACTS[cur.name].label : why),
    show(on = true) { shown = on; if (panel) panel.style.display = on ? 'block' : 'none'; },
  };
  ui();
  if (HH.onTaskEnd) HH.onTaskEnd(() => { /* tick() picks up the next step when task is null */ });
  if (HH.setBrain) HH.setBrain(brain);
  return brain;
}
