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

## Known / next
- Remaining P1 jumps on walks are mostly hero.js root moves (pushOut / floor raycast steps, e.g. a 14 cm root jump at the
  kitchen landing) and the ladder exit (pull-up pose -> walk); the root is not motion.js's.
- hero.js turns on the spot before walking off (align factor); people start walking while turning. Proposal for Character:
  let H.v grow while |da| < ~100°.
- Ladder approach (`mount` phase) still lerps exponentially in hero.js; motion matching animates the steps.
