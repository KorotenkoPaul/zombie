# ANIM-QA — frame-by-frame check of the hero

Written only by the Animation QA thread. The test is `tests/anim/` (see its README). Each run plays the whole day at a fixed
1/60 s step with seed 1, so the frame numbers below can be replayed exactly:
`node tests/anim/run.js --out DIR` (exit 1 on any P1/P2), then `node tests/anim/shots.js --in DIR` for pictures.
Storyboards and GIFs: `/mnt/project-files/anim-qa/<git sha>/`.

Priorities: **P1**: visible at normal play (through objects ≥ 2–4 cm, broken legs, snaps, robot tempo); **P2**: noticeable when watching;
**P3**: measurable only.

## Run log

| run | master | frames | result |
|---|---|---|---|
| 1 | d5e8ad1 | 24,660 | seated jitter fixed; legs folded next to the head after the kitchen ladder; head in the upper bunk |
| 2 | 46310d0 (v81) | 25,620 | legs at head **fixed**, head in upper bunk **fixed**, walking through the bunk end **fixed**; slow motion measured |
| 3 | c7cd2d0 (v91) | 16,980 | tempo mostly fixed (walk 1.0 m/s, sit/stand 1.5 s); robot braking/starting and ladder speed jumps open; ladder clipping open |

## Open issues (run 3, master c7cd2d0)

| # | P | what | frames (60 fps) | measured | normal / limit |
|---|---|---|---|---|---|
| 1 | P1 | Creeps to a stop: long braking before the target, worst before ladders | f7498, f15402, f14795, f3767, f13809, f11958 | 1.05–2.18 s from cruise to stop | ≤ 0.9 s (a person: ~0.6 s) |
| 2 | P2 | Slow start of the walk | f3578, f14497, f5614 | 1.05–1.6 s to reach pace | ≤ 0.9 s |
| 3 | P1 | Ladder exit at the top: almost stops, then jumps to walking | f4344, f8108, f15227, f16005 | 0.04 → 0.20 m/s (5x) | smooth, < 2.5x |
| 4 | P2 | Ladder entry: speeds up onto the rungs | f1122, f5991, f11361 | 0.25 → 0.72 m/s (2.8x) | < 2.5x |
| 5 | P1 | hy_standup played slowed down in one place | first f5233 | 0.52x, 5.8 s in total | ≥ 0.8x |
| 6 | P1 | Lie-down (hy_sleep_bed): root snaps | f10685, f8502 | 28 and 13.6 cm/frame² | < 1.2 |
| 7 | P1 | Lie-down / get-up: hands, feet, shins into the bunk frame (y 8.85) | f8468–8569, f10619–10716 | 6.6 cm | 1.5 cm (3 cm soft) |
| 8 | P1 | Kitchen ladder: head into the rungs/boards (x -4.15) on every climb | f1124–1382, f4139–4300, f15800–15961 | 2.3–3.0 cm, up to 1.5 s | 1 cm |
| 9 | P1 | Workshop ladder: torso and head into a beam at (-1.2, 5.88, 3.95) | f13541, f13604, f15004, f15017 | torso 6.5, head 5.3, head 4.3 cm | 1 cm |
| 10 | P1 | Deck ladder top: arms and head into a 95x20x20 beam at (1.67, 10.88, 3.0) | f520–551 | arms 9.9, head 6.3 cm | 1 cm |
| 11 | P1 | Deck: feet, shins and a hand in the beams while walking at the telescope | f223–245 | hand 9.8, feet 8.3 cm | 1 cm |
| 12 | P1 | Left hand into the stove at the kitchen ladder foot | f3947, f7710, f15608 | 4.2 cm | 1.5 cm |
| 13 | P1 | Feet into a workshop floor beam at (2.35, 4.5, 3.15) | f13838, f14597 | 6.5 cm | 1 cm |
| 14 | P2 | First steps 58° off the line to the goal | f11876 | 58° | 45° |

## Fixed (verified by the test)

- Seated / reading jitter: no joint oscillates at 5 Hz or more while still (since d5e8ad1).
- Legs folded up next to the head after the kitchen ladder: run 1 had feet 66 cm above the hips and 23 cm from the head for 1.13 s. Zero joint-limit flags since v81.
- Head through the upper bunk when sitting down or getting up (6.6 cm for 3.9 s in run 1): gone since v81.
- Walking through the bunk end post (4.2 cm): gone since v81.
- Slow motion: walk p90 went from 0.51 to 1.02 m/s, and sit/stand from 2.95 to 1.5 s (v85).

## How the numbers are measured

- Penetration: ~3,000 skinned vertices each frame vs. every solid in the world (boxes/cylinders exactly, other furniture voxelised at
  ~1.2 cm, trunk by the game's bark sections). Value = depth of the deepest vertex of that body part.
- Jumps: second difference of a joint path (cm per frame²); a smooth motion stays below ~1 cm/frame².
- Robot tempo: root speed smoothed over 0.1 s; cruise = 75th percentile of that walk; braking = time from the last frame at
  80% of cruise to the stop; start = time to first reach 80% of cruise.
