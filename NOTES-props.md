# NOTES — props thread (furniture and objects)

## Done (this commit)
- New `game/props.js`: every piece of furniture is modelled in code instead of the blobby trellis/Rodin GLBs.
  Bevelled boards (RoundedBoxGeometry) with painted wood-grain canvas textures + bump, lathe-turned metal/ceramic,
  extruded tools, patchwork quilt draped over mattresses, rugs with fringe, warm PMREM env map only on prop materials
  (metal/glaze shine; scene lighting untouched). Static parts are merged per material (`bake`) to keep draw calls low.
- Objects: bunk bed (posts, rails, slats, mattresses, pillows, quilts, folded sheet, ladder), slippers, basket with cloth,
  reading table + chair, open book, mug, candle, book stacks, wall shelf with books, plank door with hinges/knob, light switch;
  kitchen stove (4 burners, knobs, oven cavity, glowing fire, hinged oven door), kettle, hood with chimney, sink cabinet
  (panel doors, farmhouse basin, gooseneck faucet, bread board, jars), retro fridge, wall shelf with jars, picture, lantern;
  workshop workbench (3-plank top, vise, lower shelf, plans, tin of screwdrivers, nails, plane), tool wall (6 wrenches, hammer,
  saw, 3 screwdrivers, pliers, long wrench), 3-level shelves (books, jars, cans), stool, barrel, metal pail, dome lamp;
  deck brass telescope on tripod; barrels/buckets on landings.
- Every object is snapped to the real floor-board top by a downward raycast (boards are 7 cm thick; old props sank 3.5 cm).
- index.html changes (small): old prop GLBs no longer loaded (TOTAL progress 23 -> 9); furniture block replaced by
  `buildProps(...)`; kitchen hanging lantern moved from over the stove to over the sink (-2.3, KT+1.78, 1.75) like the photo;
  standing lantern cage now uses the props lantern housing; `P3.update(dt,{reading,cooking,heat})` called in frameBody.
- Checked in headless Chromium: page loads, no page errors; close-up shots of kitchen, bedroom, workshop, deck, oven open, tools.

## API for the Character thread — `window.__props` (= `P3` in index.html)
- `chairO`, `bunk` — same variables as before (Groups with `userData.box`), so the existing raycast seat/mattress fit still works.
- `surfaces.chairSeat`, `surfaces.stoolSeat`, `surfaces.benchTop`, `surfaces.bed[0|1] = {top,x0,x1,z0,z1,headDir:'+x'}`
  (lower and upper mattress tops in world coordinates; pillows at +x). Use `bed[0]` x0..x1 to centre the sleeper (fixes "lies on the edge").
- `oven.setOpen(0..1)`, `oven.open`, `oven.handle()` (world pos of the handle), `oven.setHeat(0..1)`; the door is a separate hinged group (`oven.door`).
- `book.turn(1|-1)`, `book.setOpen(0..1)`, `book.corner()` (world pos where the hand lifts the page), `book.obj`; pages auto-turn every 5–9 s while `reading`.
- `tools`: kettle, book, wrenchBig, wrench1..5, wrenchLong, hammer, saw, screwdriver1..3, pliers, benchHammer, benchWrench.
  Each has `userData.grip` (local grip point, handle along local +y) and `userData.home`.
- `grab(name, bone, {offset, rot})` re-parents a tool to a hand bone (compensates bone scale); `release(name)` puts it back home.

## Round 2 (Fal AI thread)
- Fal AI textures (nano-banana-pro/edit from the reference photo): `game/quilt.jpg` (4x4 patchwork), `rug-blue.jpg`, `rug-orange.jpg`, `rug-green.jpg`; sources in `assets/textures-src/fal-*.png`. Loaded by `upgrade()` over the canvas fallback, so they must be in the artifact `files`.
- Quilts are puffy (each patch bulges, stitched seams), UVs follow the unfolded cloth so the hanging sides are no longer smeared stripes.
- Oven: logs, ember bed, 6 flickering flames (`oven.flicker(t)`, called from `update`), baking tray with buns; glass is see-through.
- Hood is steel grey. Telescope: dark tripod, eyepiece, finder scope. Wrenches chunkier.
- Workshop: dome lamp moved to the right corner (3.75, WS+1.44, 2.45) so the tool wall is visible (its lantern light in index.html moved too); new L-side bench `sidebench` under the right shelves (pencil cup, jars, toolbox, oil can, rag, crate of offcuts).
- Room offsets: buildProps reads optional `L.dxL` (kitchen+bedroom) and `L.dxR` (workshop) and shifts props, OBST, tool homes and surfaces. Default 0.
- `__th.nav()` reports 3 crossings (kmid-kl_b:stove, bl_t-bmid:basket, bmid-bread_app:table); same on master before this round, hero nav owner should check.

## Light sources for lights.js (`__props.lights`, `__props.materials`)
- `__props.lights.{oven,kitchenLamp,workshopLamp,candle}` = `{ pos (world Vector3), obj, mats: [...] }`; oven also has `setHeat(0..1)` (drives fire, glass and flames; `update()` also calls it every frame from `cooking`/`heat`, so lights.js should take over that call if it owns the oven state).
- `__props.materials`: `fire` (ember bed, emissive), `ovenGlass` (emissive), `flame` (additive flame cones, opacity), `lampGlass` (lantern panes, shared by all lantern housings), `domeInner` (workshop dome lining, emissive 0 = off), `candleFlame` (opacity 0 = unlit).
- The bulbs and PointLights of the hanging/standing lanterns (bedroom, kitchen, landing, deck) are made by `lantern()` in index.html, not here.

## Known issues / next steps
- Oven: fire is a flat plane; rack rods look slanted; add a baking tray and flame flicker.
- Tool wall: hammer/saw partly hidden behind the workshop dome lamp in the default view; consider moving the lamp forward.
- Telescope tripod legs: check splay from the default camera; brass tube could use a finder scope.
- Photo extras not yet done: L-shaped side bench in the workshop, pen cup on the floor, tool hooks on the left wall,
  second kitchen window cabinet, range hood should be steel grey (now light).
- Old `*-glb.txt` prop files and `assets/models/*.glb` (except tree/hero/zombie) are now unused — the optimisation thread can delete them.
- Artifact NOT yet republished from this commit (thread was checkpointed); publish `game/index.html` + `game/props.js` + all game/*.txt/jpg/png
  to https://claude.ai/artifact/Ro32b6Sg7VRcXuuKDEq85d (see HANDOFF.md §3). props.js must be in `files`.
- Local testing: jsdelivr is blocked in this cloud env; route cdn.jsdelivr.net to `npm i three@0.160.0 @dimforge/rapier3d-compat@0.12.0` via Playwright `page.route`.
