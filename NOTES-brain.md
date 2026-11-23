# Brain thread notes (2026-11-23)

File: `game/brain.js` (decisions only). Body/animation/navigation stay in hero.js (Character thread).
Pavel asked for a hero that chooses for himself (not a script, no trained neural net): a Sims-style utility AI.

- Needs (0 fine .. 1 urgent; energy 1 = rested): hunger, energy, fun (boredom), tidy, comfort (stronger at night), curiosity.
  Drift per GAME hour (day ~3 real minutes); activities pay out per REAL second, only while really doing it (not walking there).
- Mood slowly follows how well the needs are met; it changes gait speed, the lottery temperature, and favours tea/reading when low.
- Score = sum(need^2 * gain) + time-of-day habits (breakfast/lunch/dinner, evening reading, craft by day) - walk cost (ladders)
  - recent repeats + noise; then a softmax lottery among the top 3. Past bedtime (rnd 21.6-22.8) he goes to bed, no lottery.
- Commitment: stays until the main need is met or the rolled duration ends; leaves early only for urgent needs / bedtime.
- Micro pauses between activities: stretch (morning / tired), look around (336), catch breath (11), inspect.
- Lamps kitchen/bedroom/workshop are switched only by the hero (brain takes them to manual on attach): on when entering a dark room
  (or when it gets dark while busy there), usually off when leaving at night, always bedroom off before lying down, off in daylight.
  Oven, candle, landing, deck and door stay on lights.js auto.
- Interface hero.js must offer (Character adds it): HH.setBrain(b) -> b.tick(dt,{task,step,free,seated,inBed,node,hour});
  HH.startTask(name,opts); HH.gait={speed,turn}; HH.onTaskEnd(cb); tasks 'switch' {light,on} and 'micro' {clip,dur}.
  index.html attaches the brain only if HH.setBrain exists.
- Debug: 🧠 button bottom-left shows needs, mood, current reason and the top options; `window.__brain`.
- Offline test: a mock hero in node (see thread) runs 3 days: meals at habit hours, lamp off before sleep, sleep 21.5-0.5, wake 6.3-7.6.

## Update 2026-11-23 evening (v89+)
- Player commands: `__th.task(n)` -> `BRAIN.command(n)`: the request wins over needs (min = shortest duration, max = longest);
  he drops it only if energy < .03 or deep in the night.
- Random start: index.html sets a random hour, `BRAIN.prime(hour)` gives needs/stocks that fit, then runs HH.update off-screen
  for 900–2400 steps (≤ 2.5 s) so the first frame catches him mid-action. `?start=fixed` keeps the old start.
- Lamps (Pavel): lit only where he is; leaving at night he switches off ~80%, forgets ~20% (stays on until he is back, nothing
  goes out by itself); bedroom lamp always off before sleep; candle lights itself when he reads (lights.auto), he blows it out by hand
  when he stops reading in the bedroom; otherwise it burns until he comes back.
- Gait .88–1.12 (Character maps it to a mood factor on a fixed 1.05 m/s); 1.12 in the rain. Rain: no deck, back under the roof.
- Economy (active only when HH.hasTask('trip') && HH.hasTask('eat')): stock {meat, logs, meal}. Food only through the full cycle:
  'trip' {kind:'hunt', bow:true, jacket, lantern} -> +2 meat -> 'store' {item:'meat'} -> 'cook' {fromFridge:true} (uses 1 meat + 1 log,
  leaves a meal) -> 'eat'. 'trip' {kind:'wood'} -> +3 logs. Trips by day; at night only when starving (with the lantern).
  Results are booked in onTaskEnd(name, res); res === false / {ok:false} = failed trip. Props hooks: __props.fridge.setStock(n),
  __props.woodpile.setCount(n).

## QA run 5 fixes (2026-11-23)
- Kitchen ping-pong cause: the hero was exhausted (energy ~0, e.g. after a clock jump), so the "pressing" rule dropped every chore on arrival, while decide() never picked the bed in daytime. Now:
  - hysteresis: a pressing need (hunger / tiredness / bedtime) pulls him away only after a few seconds of real work, and only if decide() offers something that serves it (food tasks for hunger, the bed for tiredness). Otherwise he keeps going and looks again 8 s later (`cur.hold`);
  - dead tired (energy < .06) means bed at any hour; a daytime nap ends once energy > .6;
  - a clock jump (debug `__th.setHour`, QA) re-fits the needs to the new hour (stock kept); `prime()` no longer sets bedTime to the start hour before 5:36.
- Chores (Character's self-ending jobs) give way to bedtime/exhaustion after 10 s. No setting off outdoors within 1.3 h of bedtime.
- Longer stays: read 32-52 s, craft 22-38, look 22-36, cook 16-24, tea 12-18, wash 10-16 (real seconds).
- `__brain.trace`: ring buffer of decisions {h, k (reason: done, done:early, urgent:*, dayLamp, darkLamp, wake, clockjump, idle, rain), cur, t, task, plan}.
- Forced tasks (`__th.task` -> `brain.command`, or a chore started by anything else) become `cur` with cmd:true at once: the brain no longer overrules them; any non-brain chore is adopted and runs until it ends itself.
- Daylight lamp-off only between activities (no switch trip in the middle of cooking); night sounds resume any chore with its opts.
- Jacket for trips: `__weather.state()` (rain !== 'none', cold / feels < 6 °C), fallback `__wind.raining()`.
- QA natural day (seed 1, 25 h) after the fixes: turn-back 1 (the opening switch), short stays: fix_shingle 7.6 s (the body ends it; no brain decision in the trace), wash 8.6 s.
