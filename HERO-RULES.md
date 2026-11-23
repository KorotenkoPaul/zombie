# HERO RULES (iron rules for everything the hero does)

Owner: the Character thread (hero integrator). Every hero module (hero.js, motion.js, collide.js, grab.js, the pose guard,
ladders, brain.js) follows these rules. A change that breaks one of them does not go to master.

## The one rule

**Everything he does is one person moving in one world: one pose pipeline, one action executor, one set of
invariants, checked live and before every deploy.** No task gets its own special-case body code.

## 1. One pose pipeline, fixed order, every frame

`HH.update(dt)` runs these slots in this order and nothing else writes bones:

| # | slot | who | writes |
|---|------|-----|--------|
| 1 | `clip` | hero.js | mixer: base clip, one-offs, overlays, root motion |
| 2 | `motion` | motion.js | legs / hips (and upper body when no action clip) from motion matching |
| 3 | `support` | hero.js | root height: floor, seat, mattress (fit), squat |
| 4 | `look` | hero.js (pose) | feet on floor or rungs (legIK / legPlant / toeGuard), then head and neck look, human limits (±70° from the pelvis) |
| 5 | `contacts` | hero.js + ladders | hands on declared contacts (reachTo, act.post): last of the body passes, so nothing moves the chest after a hand is placed |
| 6 | `collide` | collide.js | skin pushed out of walls, furniture, the trunk |
| 7 | `grab` | grab.js | exact hand holds re-applied after collide |
| 7b | `pops` | motion.js | velocity limiter: a bone that breaks from its own motion is inertialized (no snaps); before the guard |
| 8 | `guard` | pose module | ANATOMICAL GUARD, last: joint limits, knee direction, velocity limits (no snaps), balance |

Modules register with `HH.stage(slot, fn)` and run in slot order (wrapping `HH.update` is the old way and is removed module by module).
A module may only write bones inside its own slot.

Facing axes of this rig are measured, never guessed from the root: pelvis and head face their local **-Z** (`HH.BFWD`).

## 2. Every action is data, run by one executor

```
{ name, stand: point|fn, approach: 'walk'|'step', anchor: 'stand'|'sit'|'lie'|'squat'|'kneel',
  seat?: spot, contacts: [{hand:'Right', at: point|fn, from:0.2, to:0.8}], tools: [...],
  clip, loop, dur:[min,max], beats: [{at, do}], exit: 'standup'|'putback'|... }
```

The executor: walk to the stand point → align (turn with inertia) → blend in → hold the anchor and every contact
(the object moves only while a hand holds it) → beats → blend out → put tools back → end with a result.
New actions get the approach, contacts, support, limits and tests for free. Fal clips are sources for `clip`;
the contacts and the guard fit them to our geometry.

### The executor as it is in hero.js today: `job(o)`

Every new or reworked action is written as `job({...})` (see `dishes`, `pot`, `chop` in hero.js). Fields that work now:

| field | meaning |
|---|---|
| `pt: point|fn` or `node:'name'` | where the work is; he walks the graph to the nearest node, then `approachTo` the stand point (`stand`, default .45 m away) |
| `slide:false` | with `node`: stop on the node itself and face its `face` |
| `anchor:'sit'`, `seat: spot|fn`, `seatNode` | walk to the seat node, `sitDown(seat)`, work seated; he stands up before he leaves or ends |
| `anchor:'squat'`, `squat: depth` | `H.squat` ramps in over 0.8 s and out over the last 0.9 s of the work (ground-follow keeps the feet planted) |
| `tools: [['ladle','Right'], ...]` | taken from their hooks by hand before the work and hung back by hand after (also when called away) |
| `clip`, `loop`, `speed`, `reps`, `idle` | the base clip during the work (Fal clips: `hy_*` in hero-moves.txt) |
| `dur:[min,max]` | how long the work lasts; ALWAYS finite (Brain relies on the task ending) |
| `contacts: [{hand, at: point|fn(a), from, to, blend, w}]` | the palm is put on that point (reachGrip, after look) between `from` and `to` seconds of the work |
| `beats: [{at, do(a)}]` | one-off events at `at` seconds of the work (a sound, an object changes, a prop is handed over) |
| `look: fn(a)`, `lookW` | where the eyes go during the work (default: the work point) |
| `start(a)`, `tick(a,dt)`, `end(a)`, `post(a,dt)`, `result(a)` | hooks; `post` runs in the contacts slot; `result` is what `onTaskEnd` receives (`{ok:false}` on failure) |
| `vary:false` | turn off the small pauses / scratches during long work |

Keep task names, opts and results stable: Brain calls `HH.startTask(name, opts)`, `HH.hasTask(name)`, `HH.onTaskEnd(fn)`.
A field the executor still lacks (kneel, lie, a two-handed carry...) is added to `job()` by the integrator (Character), not
coded inside one task: ask in the Character thread.

## 3. Invariants (live checks in the game and in tests/anim)

1. Feet on a support (floor, rung, step) or moving through a step; never in the air while standing, never through a board.
2. Sitting or lying: pelvis and torso supported, within 3 cm of the seat or mattress.
3. Hands at their declared contact within 5 cm, or relaxed. **Nothing moves unless a hand holds it** (lids, doors, buckets, tools).
4. No skin inside walls, furniture, the trunk or another body part.
5. Joints inside the human range: knees never bend forward, head ±70° from the pelvis, no folded wrists or ankles.
6. No snaps: per-frame jumps of bones, root and yaw under the QA limits; speed changes ramp (no 0 → walk in one frame).
7. No go-and-leave: every visit has a believable stay (Pavel: 40–90 s at a place, several activities).

## 4. Deploy gate

QA runs every action × both heroes (default and detailed) against section 3 before a push to master.
A P1 failure blocks the push. Results go to `ANIM-QA.md`.

## 5. Who owns what

- hero.js core, walking, the action executor, tasks, gear, the pond: Character.
- Motion matching (gait, pivots, walk naturalness): Motion matching.
- Joint limits, idle/sit/sleep poses, guard slot: Pose.
- Hand contacts on objects (grab.js): Grab.
- Ladder climbing (rungs, hands, feet): Ladders.
- Skin vs world (collide.js): Collision.
- What he decides to do: Brain. Frame checks and the gate: Animation QA.
- Integrator (merges, arbitrates overlaps, extends `job()`, runs the gate before hero pushes): Character.

Action families (each thread owns these tasks in hero.js end to end, on top of the shared executor and slots):

| family | tasks | thread |
|---|---|---|
| sleep and bed | sleep, lie down, get up, turn over, undress/jacket before bed | Сделать сон и кровать идеальными |
| kitchen | cook, pot, stoke, tea, fridge (store) | Сделать готовку на кухне естественной |
| eating and dishes | eat, wash, dishes | Сделать еду и мытьё посуды естественными |
| workshop | craft, saw, hammer, sharpen, fixlamp, chop | Сделать работу в мастерской естественной |
| repairs | fix_* , clear_roof, repair | Сделать ремонт дома естественным |
| walk | gait, starts/stops, turns (with Motion matching) | Сделать походку героя живой |
| leisure | read, diary, radio, telescope, ledge, look, window, listen, stretch, water, sweep | Сделать отдых героя естественным |
| outdoor | trip (hunt, wood), fetchwater, dumpwater, firewood, the pond | Сделать вылазки наружу естественными |
| watchers | visual review of real frames | Второй взгляд на движения героя; Постоянно следить за движениями героя |
| clips | new Fal sources for any family | Подобрать анимации героя в Fal AI |

Shared code (`job()`, `approachTo`, `sitDown`/`standUp`, `lookAt`, `reachTo`, slots) is changed only by the integrator or
with the integrator told first. Two families touching the same object (the sink, the stool) agree in the Character thread.
