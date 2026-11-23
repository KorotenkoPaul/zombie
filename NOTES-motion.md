# Motion matching (owner: the motion-matching thread), 2026-11-23

## What it is
`game/motion.js` drives the hero's legs and hips (and the whole body when no action clip plays) whenever he walks, starts,
stops or turns. hero.js keeps its navigation (path, speed, heading): that is the "simulation". Every 0.1 s motion.js
predicts where the body should be in 1/3, 2/3 and 1 s along the real path (with a human stopping distance, 1.6 m/s²) and
picks the database frame whose feet, hip velocity and future trajectory match best. Jumps between frames are hidden with
inertialization (decaying offsets, half-life 0.1 s; 0.2 s when the body is handed between motion matching and hero.js
clips), never a cross-fade. Feet that are planted in the data are locked to the floor with leg IK.

Layering: while he walks, any action clip that hero.js is playing (`H.cur` not walk/idle) keeps the upper body; legs and
hips come from motion matching. With motion attached, walkStep does not replace a running one-off clip (`H.once`) with
the walk, so "stands up stretching and walks off still stretching" works by itself.

## Data (commercial use OK)
CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu, free for any use): subject 69 (walk, walk-and-turn, turn in
place, sharp/smooth 90° turns), subject 16 (walk 0.7-1.35 m/s, veer, 90° turns, starts from standing, stops). 9,652
frames at 30 fps, mirrored at load (19,304). Not used: Mixamo (needs an Adobe login), LaFAN1 (non-commercial).
- `pipeline/mm/cmu2hero.mjs hero.glb 69.asf outDir *.amc`: ASF/AMC -> hero Mixamo skeleton (same scheme as pipeline/motion/retarget.mjs).
- `pipeline/mm/pack.mjs hero.glb outDir game/motion-db.txt clip...`: Int16 quaternions + hips (2.3 MB).
  The clip list used is in the commit message of the first motion commit and in `motion-db.txt` (`clips`).

## Hooks (fenced `MOTION HOOK` in hero.js, agreed with Character via the coordinator)
- `setMotion(m)` in the hero API (index.html attaches it after loading motion-db.txt; `window.__motion`).
- `post()`: `motion.pre()` first (remembers the pose on screen), `motion.post(dt)` after the floor/fit step, before hero IK.
  Order of post-passes: motion -> hero IK / props / look-at -> collide.js.
- walkStep: arrival speed `v = sqrt(2·1.6·d)` (a human stop) instead of the slow creep; a running one-off clip is not replaced by the walk.
- `window.__noMotion = true` switches it off (before/after comparisons). `motion.bench(n)` times the search.

## Measured (tests/mm/scenario.js, same seeded errand route: cook, wash, craft, deck, window, read; 111 s)
| | before | after |
|---|---|---|
| frames frozen while a path is walked | 302 | 93 (hero.js turns on the spot before it moves) |
| peak hips acceleration while walking | 18.8 m/s² | 6.0 m/s² |
| planted-ankle speed (avg) | 0.154 m/s | 0.098 m/s |
| P1 per-frame jumps (QA analyzer) | 81 | 36 |
| search cost (headless desktop) | | 0.17 ms per search, 10 searches/s, 88% of the DB pruned |
Storyboards: /mnt/project-files/motion/*.jpg (tests/mm/strobe.js --strip).

## After merging master (2026-11-23 ~19:40 UTC, new ground nav + planks), same scenario
frozen-while-walking 316 -> 68 frames, P1/P2 jumps while walking 92 -> 65, in work poses 27 -> 10, planted ankle 0.087 -> 0.079 m/s.
Turning in place only uses motion matching for turns over ~50° (small pivots at a bench stay hero.js clips); in layered
mode the action's spine is re-based on the matched pelvis so the chest does not swing with each step.

## Round 2 (2026-11-23 ~20:30 UTC): more data
+7 Hunyuan Motion clips (fal, our own): quick stops (3 seeds), stand-turn-around-and-walk (3), start walking (1); generated
from pipeline/mm/prompts-loco.json, retargeted with pipeline/motion/retarget.mjs, smoothed (sigma 1.5 frames) in pack.mjs,
turn-back clips trimmed of their idle start. DB: 10,488 frames (x2 mirrored). Rejected: start-while-turning (barely moves),
walk-stop-turn (barely walks), quickstop2 (jogging 2 m/s). Ladder grab / step-off clips were not generated: fal balance ran out.
Same scenario, old DB -> new DB: frames frozen while walking 49 -> 5, peak hips acceleration 18.3 -> 10.4 m/s²,
planted ankle 0.091 -> 0.077 m/s, P1+P2 jumps 126 -> 119.
The QA "robot" checks measure the navigation root (hero.js); motion matching does not move it, so they stay hero.js work:
ladder exit (pull-up ends standing, then a walk from rest) and the turn-on-the-spot before walking off. tests/mm/scenario.js
now also reports the same robot checks on the hips track (`robotVisible`).

## Known / next
- Remaining P1 jumps on walks are mostly hero.js root moves (pushOut / floor raycast steps, e.g. a 14 cm root jump at the
  kitchen landing) and the ladder exit (pull-up pose -> walk); the root is not motion.js's.
- hero.js turns on the spot before walking off (align factor); people start walking while turning. Proposal for Character:
  let H.v grow while |da| < ~100°.
- hero.js bug seen in the full QA day: a task change during a ladder descent left H.lad set (58 s 'on the ladder' while
  reading, then a root teleport). Reported to Character.
- Ladder approach (`mount` phase) still lerps exponentially in hero.js; motion matching animates the steps.

## Round 3 (2026-11-23, master f58e5ff: Character's walk-while-turning + ladder-top momentum)
tests/mm scenario: frozen while walking 0, peak hips acceleration 7.5 m/s², planted ankle 0.061 m/s.
Full tests/anim day, per 1000 frames (r2 before -> r2 after -> r3): robot 1.09 -> 1.91 -> 0.39, P1 jumps 12.0 -> 12.4 -> 6.4,
P1 penetration 6.7 -> 6.7 -> 3.6. Left: ladder exit speeds up (1), ladder entry slows (2), slow walk starts after work (5),
creep to the hatch (1). Ladder exit/entry need the step-off / grab clips (prompts-loco.json) once fal is topped up.
