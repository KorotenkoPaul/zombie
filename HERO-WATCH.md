# HERO-WATCH — visual review of the hero

Written only by the hero-watch thread ("Постоянно следить за движениями героя"). Tooling: `tests/watch/` (README there).
Frames are replayable: `node tests/watch/watch.js --out DIR --tasks <task> --seed 1` (warm-up 1200 frames at 09:00, then the
task is asked through the brain). Pictures: `/mnt/project-files/hero-watch/<round>-<sha>/`.
Judges: gpt-5.5 and o3 on numbered contact sheets, then every finding is checked by eye (Claude) on close-ups from 4 sides
before it goes in here. Model claims that did not survive the eye check are not listed.

Severity: **P1** visible at normal play; **P2** noticeable when watching; **P3** minor.

## Open

| # | P | task | what | frames | evidence | owner |
|---|---|---|---|---|---|---|
| W1 | P1 | pot | Stirring stirs the air: the ladle hangs from the fist in front of the oven door, its bowl below the stove top, not in the pot. Right hand at 0.94 m above the floor at the stove front edge | f2430, f2700 (hy_stir) | pot_ladle_outside_pot_f2430_f2700.jpg | Character / hand contact (grip target = pot centre, ladle bowl inside the pot) |
| W2 | P2 | pot | During the whole stir loop the left hand is held up by his face/ear instead of resting on the pot handle or the stove edge | f1860–f2110, f2390 | pot_stir_left_hand_at_head_f1860-2390.jpg | Character (hy_stir clip / left-hand IK) |
| W3 | P3 | pot | Mid-stir pause (hy_idle) turns him away from the stove with the ladle dangling from the fist for 2.5 s | f2160–f2310 | same sheet | Brain / Character |

## Fixed and re-verified

(none yet)

## Run log

| round | master | what was filmed |
|---|---|---|
| 1 | f3a6f8c | pot (body + hands), hammer, ... (in progress) |
