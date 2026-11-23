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
