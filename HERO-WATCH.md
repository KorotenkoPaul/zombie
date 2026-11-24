# HERO-WATCH — visual review of the hero

Written only by the hero-watch thread ("Постоянно следить за движениями героя"). Tooling: `tests/watch/` (README there).
Frames are replayable: `node tests/watch/watch.js --out DIR --tasks <task> --seed 1` (warm-up 1200 frames at 09:00, then the
task is asked through the brain). Pictures: `/mnt/project-files/hero-watch/<round>-<sha>/`.
Judges: gpt-5.5 and o3 on numbered contact sheets, then every finding is checked by eye (Claude) on close-ups from 4 sides
before it goes in here. Model claims that did not survive the eye check are not listed.

Severity: **P1** visible at normal play; **P2** noticeable when watching; **P3** minor.

## Note (2026-11-24 00:30 UTC)

Master 7ca7a48 rolled the hero code back to 9aa01f4 (21:33). W1–W13 were filmed on f3a6f8c/708e4b2/e778f58 (after 21:33) and are kept for the owners re-landing those features via `hero-dev`; round 4 re-films everything on the rollback.
Baseline comparison (same seed): 0b6dc51 and 9aa01f4 upright with real stir and hammer over the board; ce71310 already had the hy_idle-at-stove / head-back break. 9aa01f4 threw `collide RangeError: Map maximum size exceeded` (collide.js:128) at init.

## Open on the rollback baseline (085e32c / 7ca7a48)

| # | P | task | what | frames | evidence | owner |
|---|---|---|---|---|---|---|
| B1 | P1 | telescope | Mimes a spyglass with both hands at his eye while the real telescope (tube on the tripod) stands 1 m to his side, untouched; he faces away from it; ends with arms spread out sideways (f3264) | f2148–f3264 | r4-085e32c/telescope_mimed_1m_away_f2148-3264.jpg | rest/deck family via hero-dev |
| B2 | P1 | pot | Upright and at the stove (good), but after f2028 the stirring hand is open and empty, hovering beside the pot at rim height; the ladle is not in the hand or the pot. At the start the ladle dangles at his thigh | f1560–f3288 | r4-085e32c/pot_open_hand_no_ladle_f1560-3288.jpg | cooking family via hero-dev |

## Open on post-21:33 builds (features being re-landed)

| # | P | task | what | frames | evidence | owner |
|---|---|---|---|---|---|---|
| W1 | P1 | pot (f3a6f8c; CONFIRMED and worse on 708e4b2: stands beside the stove leaning back ~25°, stirs the air to his side, pot behind his shoulder, f1440–f3790, r2-708e4b2/pot_stirs_air_beside_stove_leaning_f1440-3790.jpg) | Stirring stirs the air: the ladle hangs from the fist in front of the oven door, its bowl below the stove top, not in the pot. Right hand at 0.94 m above the floor at the stove front edge | f2430, f2700 (hy_stir) | pot_ladle_outside_pot_f2430_f2700.jpg | Character / hand contact (grip target = pot centre, ladle bowl inside the pot) |
| W2 | P2 | pot | During the whole stir loop the left hand is held up by his face/ear instead of resting on the pot handle or the stove edge | f1860–f2110, f2390 | pot_stir_left_hand_at_head_f1860-2390.jpg | Character (hy_stir clip / left-hand IK) |
| W4 | P1 | ladder down (kitchen → workshop, clips 435/437) | Hands never grip the ladder: flat open palms hover in the air beside the rails, arms flap up above the head while he steps down | f4260–f4370 (hammer errand) | ladder_down_hands_not_gripping_f4260-4370.jpg | Character (ladder hand IK on rails/rungs) |
| W5 | P1 | hammer (f3a6f8c; on 708e4b2 the grip moved to the handle end, but the whole body leans sideways ~30° and the hammer swings in the air beside his head and hip, away from the board; left hand flat on the bench far from the strike, f5170–f7370, r2-708e4b2/hammer_strikes_air_body_leaning_f5170-7370.jpg) | Crooked grip: the fist sits right under the hammer head, the head points up at his chin/chest, the striking face never reaches the nail; he taps at chest height above the bench | f5090, f5190, f5390 (hy_hammer) | hammer_grip_f5090_5190_5390.jpg, hammer_body_f5040-5590.jpg | Character / hand contact (grip near the handle end, head down onto the nail) |
| W6 | P1 | bolt (master 708e4b2) | Bolting is mimed in the air: he stands side-on with his back half to the door, open palm raised 30+ cm from the bolt, head turned away; the bolt never gets a hand | f4790–f4920 (hy_bolt) | r2-708e4b2/bolt_mimed_in_air_legs_in_chair_f4790-5040.jpg | Character / hand contact |
| W7 | P1 | bolt (708e4b2) | Legs stand inside the chair placed in front of the door: thighs and knees through the chair back and seat | f4790–f4920, f4970, f5010–f5040 | same | collide.js (+ Props: a chair should not block the door) |
| W8 | P2 | hatch (708e4b2) | Run-to-run difference: in the filmed run the lid falls shut by itself from upright while both hands hang at his sides (f2100–f2130); in the replay his hand holds the ring at f2100–f2110. Also stands 2 s with the right foot over the open hole edge (f1970–f2090) | f1970–f2130 | r2-708e4b2/hatch_*.jpg | Character (hatch) |
| W9 | P1 | telescope (708e4b2; CONFIRMED on e778f58: back to the telescope, hands miming in front of his face, f2620–f3330, r3-e778f58/telescope_still_mimed_back_to_telescope_f2620-3330.jpg) | Looks through an invisible telescope: both hands held up at his eye miming a spyglass while the real telescope stands on its tripod about 1 m to his side, untouched, for the whole 30 s | f5940–f7740 (hy_telescope) | r2-708e4b2/telescope_mimed_1m_from_telescope_f5890-7740.jpg | Character / hand contact (stand at the eyepiece, hands on the tube) |
| W10 | P1 | all work poses (708e4b2) | Systemic lean: in hy_stir and hy_hammer the whole body tilts 25–30° off vertical (looks like falling), likely the new reach / grab IK pulling the pelvis or spine | pot f1440–f3790, hammer f5170–f7370 | pictures of W1 and W5 | Character / grab thread |
| W11 | P1 | pot (e778f58) | The stir never plays: at the stove he stays in hy_idle for 17+ s with his back to the stove, head thrown back to the ceiling, bow-legged squats, one arm reaching backwards to the pot | f2550–f3590 | r3-e778f58/pot_no_stir_back_to_stove_and_ladder_top_pause_f1390-3090.jpg | Character / grab thread |
| W12 | P1 | ladders going down (e778f58) | Stops ~1 s at the ladder top in hy_idle before climbing down (Pavel: no slowing or pauses before ladders), one leg twisted behind in that stand | f1400–f1460 (deck rope ladder), f2110–f2170 (kitchen ladder) | same | Character / Motion matching |
| W13 | P2 | ledge (e778f58) | Asked through __brain.command('ledge') on the deck: the brain switches to 'look' within 10 frames, so the ledge sit never plays; then 1 s of the walk clip with the root standing still (walking on the spot) | f3600–f3670 | log only | Brain |
| W3 | P3 | pot | Mid-stir pause (hy_idle) turns him away from the stove with the ladle dangling from the fist for 2.5 s | f2160–f2310 | same sheet | Brain / Character |

## Fixed and re-verified

(none yet)

## Run log

| round | master | what was filmed |
|---|---|---|
| 1 | f3a6f8c | pot (body + hands), hammer, ... (in progress) |
