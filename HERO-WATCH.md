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
| W1 | P1 | pot (f3a6f8c, re-checking on 708e4b2) | Stirring stirs the air: the ladle hangs from the fist in front of the oven door, its bowl below the stove top, not in the pot. Right hand at 0.94 m above the floor at the stove front edge | f2430, f2700 (hy_stir) | pot_ladle_outside_pot_f2430_f2700.jpg | Character / hand contact (grip target = pot centre, ladle bowl inside the pot) |
| W2 | P2 | pot | During the whole stir loop the left hand is held up by his face/ear instead of resting on the pot handle or the stove edge | f1860–f2110, f2390 | pot_stir_left_hand_at_head_f1860-2390.jpg | Character (hy_stir clip / left-hand IK) |
| W4 | P1 | ladder down (kitchen → workshop, clips 435/437) | Hands never grip the ladder: flat open palms hover in the air beside the rails, arms flap up above the head while he steps down | f4260–f4370 (hammer errand) | ladder_down_hands_not_gripping_f4260-4370.jpg | Character (ladder hand IK on rails/rungs) |
| W5 | P1 | hammer (f3a6f8c, re-checking on 708e4b2) | Crooked grip: the fist sits right under the hammer head, the head points up at his chin/chest, the striking face never reaches the nail; he taps at chest height above the bench | f5090, f5190, f5390 (hy_hammer) | hammer_grip_f5090_5190_5390.jpg, hammer_body_f5040-5590.jpg | Character / hand contact (grip near the handle end, head down onto the nail) |
| W6 | P1 | bolt (master 708e4b2) | Bolting is mimed in the air: he stands side-on with his back half to the door, open palm raised 30+ cm from the bolt, head turned away; the bolt never gets a hand | f4790–f4920 (hy_bolt) | r2-708e4b2/bolt_mimed_in_air_legs_in_chair_f4790-5040.jpg | Character / hand contact |
| W7 | P1 | bolt (708e4b2) | Legs stand inside the chair placed in front of the door: thighs and knees through the chair back and seat | f4790–f4920, f4970, f5010–f5040 | same | collide.js (+ Props: a chair should not block the door) |
| W8 | P2 | hatch (708e4b2) | Run-to-run difference: in the filmed run the lid falls shut by itself from upright while both hands hang at his sides (f2100–f2130); in the replay his hand holds the ring at f2100–f2110. Also stands 2 s with the right foot over the open hole edge (f1970–f2090) | f1970–f2130 | r2-708e4b2/hatch_*.jpg | Character (hatch) |
| W3 | P3 | pot | Mid-stir pause (hy_idle) turns him away from the stove with the ladle dangling from the fist for 2.5 s | f2160–f2310 | same sheet | Brain / Character |

## Fixed and re-verified

(none yet)

## Run log

| round | master | what was filmed |
|---|---|---|
| 1 | f3a6f8c | pot (body + hands), hammer, ... (in progress) |
