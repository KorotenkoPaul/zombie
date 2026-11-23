# NOTES-planks — boards of floors, walls, landings (owner: Planks thread, since 2026-11-23)

Code: index.html, block "wood: every board is its own body" (`plankShader`, `bevelBoxGeo`, `lay()`), and the board calls in `floorBoards`, `wallBack`, `wallSide`.

## How a board is made
- Geometry: `bevelBoxGeo()` is a 24-vertex / 44-triangle rounded-edge box. `position` is the unit-box corner, `aBev` is the inset direction; the vertex shader insets by min(7 mm, 0.28 × the smallest board side) in metres, so the bevel stays the same size on any board. Face normals are interpolated across the bevel strips, so the edges shade round. `objectNormal *= instance scale` keeps the normals right under non-uniform instance scale.
- Still one InstancedMesh for light boards (`boards`) and one for dark (`beams`): same draw calls as before. Raycasts use the unit box, so the top height seen by the hero is unchanged.
- Placement `lay()`: most boards are flush (±1.5 mm), 22% stand proud 3–8 mm, 8% sit 2–5 mm low, 35% are rolled up to ±0.03 rad (one edge up), thickness 62–76 mm. The top stays at y+0.035 on average. Widths 222–245 mm on a 250 mm pitch give uneven gaps of 5–28 mm. Walls: 288–303 mm boards on a 310 mm pitch, ±5 mm in or out, twisted up to ±0.03 rad.
- Wood: Fal nano-banana-pro photo scans, made seamless by `pipeline/planks/pack.py`: `game/wood-floor.jpg` (2048×1024, ≈2.4 × 1 m of wood, loaded as `woodT`), `wood-wall.jpg` (2048×1024), `wood-dark.jpg` (1024×512, beams, frames, roof slabs, ridges). Each board takes its own random patch (seed `aRow`), with its own tone, an occasional grey weathered board, and water stains.
- Relief: a blurred tap (bias 2.5) of the scan, differenced in texture space (3 taps, no 2×2 derivative blocks), plus analytic cupping across the width, undulation along the length, and nail domes. Applied with `pnArb` in normal_fragment_maps. Uniforms: `uBump` (0.0005 light, 0.0002 dark), `uTintA/B`, `uNails`.
- Faces: the broad face gets grain, nails (two per joist crossing, 1 m pitch on floors, 0.62 m on walls), and lighter worn edges. Long sides are 0.42× darker (gap depth). Ends show end-grain rings.
- floor-atlas.jpg (cartoon atlas) was deleted.

## Cost
- 772 boards × 44 = 34k triangles (was 9k). Draw calls unchanged. Textures: about 4 MB of JPG to download, and about 23 MB of GPU memory with mipmaps (the Perf thread may convert them to KTX2; keep sRGB and repeat).

## Test
`tests/planks/shots2.js outdir [hour] [dpr]`: orbit-rig close-ups (kitchen floor, kitchen and bedroom walls, landing, deck, overview) with all lights on. `count.js` prints board counts and triangles. Don't use `__th.cam()` for close-ups: the near-fade dithers everything between the camera and the focus point.

## Roofs (owned by Planks since 2026-11-23, round 2)
- Shingles `SHING`: the same `bevelBoxGeo` with an 18 mm rounded edge, and its own shader (`SHING_GLSL`). Each slate has its own patch of the Fal scan `game/slate.jpg` (1024) and its own tone (bluer, greener or rust-stained), flaky relief from the scan, a crack groove on 16% of them, and rare dark lichen specks. Moss comes from world-space patches (`game/moss.jpg`, 512), denser on the back half (z<2.3), raised a few mm in the normal. 3.5% of slates are missing above the bottom row, so the dark slab shows. Treedress still scatters moss cushions on SHING by reading its matrices.
- [PERF] SHING sits on layer 5: the main camera and the sun shadow camera see it, but lamp (point/spot) shadow cameras don't, since the roof slab already stops lamp light.
- [PERF] `meshesToBeams(g)`: roof slabs, ridges, gable trims and window frames (5 windows × 6 boxes) are now `beams` instances instead of ~40 separate meshes, so they add no draw calls. Use `beamInst(matrix)` for any new static dark-wood box.

## Age and wear (round 3), shader only, no new draw calls
- Per-instance `aWx` (vec2: weather exposure of the local +z / -z face) is set once after ROOMS. Floors inside a room get 0, landings and the deck 1. A wall's outer face (the one facing away from its room) gets 1. Beams, posts and frames get 0.8. Exposed faces turn silver-grey in patches along the grain, get rougher, and their grain erodes deeper. Upright exterior boards get dark rain streaks running down from their top end (under eaves and sills) and splash at the foot.
- Floor wear map `WEAR` (DataTexture R8, 7 level tiles × 128×96, covering x −6..6, z −1..7). It is seeded from the hero's walk graph `HH.E` (paths) and `HH.N` (work spots), then stamped every second where he stands. Worn boards are paler and smoother, with less relief. The texture is re-uploaded at most every 5 s.
- Dirt: floors inside ROOMS darken towards the side and back walls and the corners (uniforms `uRoomA/B`).
- Repair hook `window.__planks`: `list(kind?)`, `near(x,y,z,r,kind?)`, `setFresh(id,f)` (1 = just repaired: pale clean wood, or a clean slate with no moss, lichen or cracks; 0 = old, the default), `fresh(id)`, `wear(x,y,z,amt)`. Kinds: floor, wall, beam, shingle (about 377/159/326/343). Brain owns fading `fresh` back over time.

## Interior (round 4)
- Under each roof slab: honey sheathing boards (instances in `boards`, wall texture, nails) running down the slope, with rafters every 0.85 m (instances in `beams`). Kind 'roof' in `__planks`, and the exposure loop skips them. No new draw calls.
- Undersides of floor boards (the ceiling of the room below) are rough-sawn and dull (×0.68/0.6/0.55, roughness 0.95). Nails now show on the top face only.
- The door (props.js plankDoor) and the furniture wood (props M.wood/M.woodDark, canvas grain) belong to Props. The coordinator was told they could switch to game/wood-*.jpg.

## Landings and struts (round 6)
- Round landings (`floorBoards` with `radial:`) now match the photo: thick parallel planks running front-to-back, each cut to the circle so the chunky ends trace the curve. The sunburst and the rim board over the ends are gone. A dark curved band sits under the edge, with joists across underneath every 0.8 m.
- `brace()` sinks its trunk end 14 cm into the bark, so it reads as a real joint. Beams, braces and posts longer than 0.6 m get a coach bolt (head, washer, rust halo) in the shader at each end.
- Struts that passed through walkable boards were moved: the centre-landing brace now starts at y 3.0, and the two kitchen knee braces start above the centre landing. `tests/planks/braces.js` checks that no diagonal beam crosses a floor (it should print []).

## Round 7: trunk door (index.html, after the LG brace)
- DOORP={x,ang,y0,y1,w,depth} is shared with buildTree (door:DOORP).
- surf()/at() raycast TREE.bark radially so the frame sits in the bark; piece() makes oriented instances.
- Jambs, a 7-piece arch, and the keystone are `beams` instances (kind 'door'); the threshold and 5 cave floor planks are `boards` instances (kind 'door'). No new draw calls.
- The lantern bracket belongs to Lights. Test: tests/planks/door.js.

## Round 8: work tops + room walls/floors (Critic N1/N2)
- props.js workTops(M.woodLight): a world-space layer on the upward faces of the counter, workbench and side bench tops (WTOPS, set by setTop() after shiftRooms). It adds knife cuts, saw kerfs, dents, scorch rings, oil/tea stains, water-darkened wood by the sink, paint spots, pencil ticks, and a hand-worn front edge. Fine marks bend the normal and fade to a mean darkening at distance. It chains onto varyWood, and the proxMat clone chains onto it.
- Walls: wallBack/wallSide(..., out) put each plank at its own depth (pushed inward ≤1 cm), sometimes split in two at a random height (cutRun), with a batten over every joint on the outside. Battens carry seed +200/+300 (bat), and the shader darkens their inner face, seen through the slot.
- Floors: runs are split into 0.8–1.9 m boards with staggered butt joints. Lift is capped at 3.5 mm and roll at ±.02 so rugs don't get poked through.

## Round 9: slates + ladder rungs
- Slates: a soft shadow band on each slate's top just under the butt of the slate above (vDn = downslope sign per instance), so the overlap reads as depth.
- Wooden ladder rungs: board opt rung → seed +400 (wall flag excludes ≥400). The middle of the top and the front edge are worn pale and smooth, and the ends are grimy.
- Rope-ladder rungs: rungWear(rungMat) samples the dark wood scan along the stick and adds bark scraps near the ends, a polished middle and grime by the lashings. Rungs are 9-sided with varied radius and taper. Same draw calls.

## Round 10: perf (phone profile)
- tests/planks/perf_planks.js (iPhone 13 emulation) reports screen coverage of boards/beams/slates and the render time of those meshes alone, with the real shader vs a plain MeshStandardMaterial (SwiftShader CPU time as a proxy for fragment work).
- Before: the real shader cost 4.5–6× plain. Boards+beams cover 25–50% of a typical frame and slates 80–90% of a roof close-up.
- LOD: plank() and slate() compute metres per pixel from dFdx/dFdy of the local position. Far boards (> ~5 mm/px) skip the 3 bump taps, the pTop cupping differences and the nail heads. Far slates (> ~7 mm/px) skip the bump taps, crack relief, lichen and moss relief. Everything fades in with distance (no pop). Measured: default view −43%, overview −28%, kitchen −11%, roof −12%.
- textureGrad inside the branch was slower (SwiftShader), so it stays texture2D with bias.
- Shadows on phones: only the sun/moon map (every 3rd frame); boards+beams cast 42k tris there, slates don't cast. Splitting interior floors out would add a draw call per pass for a few k tris, so it's not done.
