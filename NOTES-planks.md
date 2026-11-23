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
