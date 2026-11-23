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
- fix_shingle targets only slates within 1.5 m (horizontal) of a walkable node and 0–2.2 m above it (HH.N); none in reach → the body's default deck spot. Every chore end is logged in __brain.trace as end:<name> with t (seconds at it) and res. Checked: fix_shingle 35–37 s, real slates.
- `brain.command(name)` for ACTS/JOBS/EXTRA goes through planFor (job → body task e.g. fetch→fetchwater, hunt→trip with lantern at night; leaving-room lamp off 80%, candle, hatch), the last step is marked cmd. Raw body tasks (hatch, switch, …) still go straight to HH.startTask.
- Water re-checked after the pond move (6033f5e): fetch → fetchwater goes sink shelf → kitchen ladder → g_pond (0.01 m from pond.stand) → fills → back, sets the bucket itself (clean .1→1, ~110 s at h10); the brain no longer adds a separate setbucket step. dump → dumpwater: drain bucket → pours at the gate → back (dirty .9→0).
- Visits (2026-11-23): arriving in an area (deck / ground / kitchen / bedroom / workshop) he plans 2-4 things there (+1.1 same area, +.3 anywhere-chores, -.5 elsewhere) instead of the roomT cabin-fever logic; jobs/sleep end a visit. Trace logs start:<name> with room. Measured over 3x72 h (seed 1-3): only 5-10 activities per game day: the 180 s day is too short for 20-60 s activities plus ladder walks (deck activities never got a turn). Asked Pavel about a longer day.
- Lockdown (2026-11-23): `__brain.lockdown(true|false)`, `?lockdown` URL, or by himself on a bad night (safety > .85 after a night noise, 35%). Steps: (open the hatch if he is upstairs and must go down) → bolt → lamps below off → hatch shut from above (`opts.side:'top'`, needs Character) → shutters (`HH.hasTask('shutters')` if the body has it, else `__house.shutters.close()` / `__lights.curtains(true)` if those exist). In bed when it starts: the steps run when he gets up. Inside: no outdoor/deck/ground options and no jobs except eat; quiet things favoured (listen at the windows .9, window .8, read/diary .5 …), loud ones -1.2 (saw, hammer, radio, sweep, craft …); with the hatch shut he stays on his side of it (bolt/fix_hinge count as below). Lifts at the morning wake (not after an evening nap); shutters open again.
- Forgetting (2026-11-23): leaving a lit room he switches off 80% (day or night; forgotten lamps burn on, never go out alone). A lamp left on in a room on his way (HH.route rooms) is noticed and put out 85% (he detours to its switch). Hatch closed 70% / bolt 75% before sleep; a night noise while upstairs with the hatch open: he closes it (safety > .45). Checked: kitchen lamp left on, bedroom → workshop: he switched it off on the way, then crafted.
- Dishes/water (2026-11-23): the body's eat leaves the plate dirty (brain no longer adds a second one); with the body's 'dishes' task (tap on, plates put away) the old 'wash' act is not chosen; tea and cook take .1 from the tap bucket into the drain bucket (props.water). Trip opts.away = 1-2.5 game hours in real seconds (clock measured: secPerHour). Day flags reset only on a morning wake, not after a nap. 48 h check (seeds 1, 2): cook -> eat -> dishes 2-3 -> washed and put away (0-1) the same evening; tap .7 -> .48, drain .15 -> .33 (no dump needed in 48 h at one meal a day).
- Day length 8 min (Pavel 2026-11-23: 5 min day, 3 min night; index.html hps 14/300 / 10/180). 48 h on the new clock: 10-12 activities a day, deck visits chain telescope/look/shingle, 2 meals a day, dishes washed the same day, tap bucket .7 -> .06 then fetched (h14), drain .15 -> .68. Brain cost (4x CPU throttle): mean 0.09 ms per tick, one-off 12 ms spike when the reachable slates are first computed (now warmed 3 s after start); dt capped at .25 s.
- Weather (2026-11-23): rain → COSY +.35 (tea, read, diary, radio, listen, window, stoke), outdoor EXTRA unavailable, an outdoor chore in progress is dropped after 3 s; mood -.07 (storm -.15). After rain stops: 3 game h with outdoor repairs +.9 (shingle, roof leaves, railing, chimney, rope), dump +.3. Sunny morning 6.3-10.5 (clear/calm): deck +.6 (look, telescope, ledge), mood +.08. Trace switch entries show light and +/-. 48 h check, rain forced 8-11.5 on day 2: tea, fix_hinge, tea, fix_board inside; 12.1 fix_shingle, 14.8 look; dusk kitchen lamp lit on entering (19.9, 20.8).
- Pond in daylight (2026-11-23): fetch 8-17.5 (no rain) when the bucket < .6 (.9), < .4 (2.1 + 5·(.4-clean)), any time < .15 (3.2); at night -1.6 unless empty. opts.linger 4-9 s and opts.washFace (50%, daylight) for the body at the pond. clear_roof + 1.5·(__wind.litter.level() - .4). Lockdown shutters: __house.shutters.close()/open() (Tree API, all rooms staggered). Trace: choose entries carry pick (chosen < top 3 with scores).
- Jacket (2026-11-23, waits for Character: task 'jacket' {on} at the workshop peg + getter HH.gear {coat,bow,lantern}): before sleep, if wearing → jacket off first (then bolt, hatch); morning wake or going outside when cold/raining → on (75%); warm and dry → off when he next plans something (60%). Trip opts.keepJacket = cold or raining (the body's gearOff at the end of the trip can leave it on).
