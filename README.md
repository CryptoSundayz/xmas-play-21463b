# Santa's Block Delivery — an Optimum mump2p Christmas game

A static Three.js (r170, vendored) 3D browser game. Santa delivers glowing blue blocks to validator houses in a snowy village.
Gossip mode delivers one house at a time (275 ms). The **mump2p** power-up (Optimum, 135.6 ms, about 3x) splits the gift into shards that reach every validator in range. **Boosted!**

## Run
```
cd xmas_game && python3 -m http.server 8080
# open http://localhost:8080
```
It is a static site with no build step and can be hosted on any static host (GitHub Pages, Netlify, S3…).
URL params:
- `?difficulty=easy|normal|hard`
- `?quality=low|medium|high|auto`
- `?level=1..3`
- `?autostart=1`

Controls:
- WASD or arrow keys to move, Shift to sprint, P/Esc to pause.
- On mobile: joystick and sprint button.

## Config (`src/config.js`)
- `branding.targetStakedEth` / `targetLabel`: the win target and its label. Nothing is hardcoded to 3M. `ethPerBlock` is derived so that a clear without combos hits exactly the target.
- `difficulty` and `difficultyPresets`: easy, normal and hard.
- `levels[]`: validator count, timer, storm, ice and slow nodes for each level.
- `quality` and `qualityPresets`: shadows, bloom, pixel ratio, snow count and lights.
- `boosted`:
  - text: callout text and subtext, house label, combo text (`Boosted x{n}`, `score x{mult}`), results labels
  - combo tuning: `comboWindow` (s), `comboMultStep`, `comboMaxMult`
  - `trail` on/off
- `powerup.speedFactor` (3x) and the latency numbers (`optimumMs`, `gossipMs`).

## Swapping in GLB models (Tripo3D or other)
1. Export GLBs to `assets/models/` using the file names in `assets/manifest.js`.
2. Run `node tools/scan-models.mjs`. This rewrites `assets/models/models.json`.
3. Reload the game.

Missing GLBs fall back to the procedural models automatically. Santa and the reindeer play clips through `AnimationMixer` using the clip names in the manifest (idle, walk, run, carry*). The gift attaches to `holdBone`.

Models needed:
- **Characters:**
  - santa.glb: rigged biped with Idle, Walking, Running and optional Carry_* clips
  - reindeer.glb: rigged quadruped with Idle and Walk
- **Buildings** (front/door faces +Z):
  - building_log_cabin
  - building_stone_cottage
  - building_bakery (with a BAKERY sign)
  - building_church (with a clock tower)
  - building_townhouse
  - building_validator_house (glass, with the Optimum logo)
  - building_toy_workshop
  - building_inn
  - building_gingerbread
  - building_windmill
- **Props:**
  - prop_pine
  - prop_street_lamp
  - prop_christmas_tree
  - prop_snowman
  - prop_sleigh
  - prop_bench
  - prop_gift_pile
  - prop_gift_box

## Assets & payload
All 20 models are Tripo3D generations (refs in `tripo/refs/`, untouched downloads in `tripo/raw/`, spend log in `tripo/ledger.json`).
- Pipeline: `tools/optimize2.sh` (gltf-transform + toktx). It normalises each model to 1 unit tall, grounds it, centres it and faces it +Z. It applies meshopt geometry compression and KTX2 textures (ETC1S for colour/ORM, UASTC+zstd for normals; Santa's colour is UASTC). Buildings get LOD1.
- Payload: `assets/models` is about 42 MB, down from 113 MB (v1 is kept in `tripo/models_v1_backup/`). Santa is 12 MB, the reindeer 4 MB, each building 1.6–2.4 MB and each prop 0.4–2.2 MB.
- Clips: Santa has `idle` / `walk` / `run` (Mixamo rig). The reindeer has `preset:quadruped:walk`, which also serves as run at a higher timeScale.
- Viewer / contact sheet: `python3 tools/render_views.py out.jpg assets/models/*.glb --yaws 30` (needs the server on :8090).

## Effects (quality `high`, `auto` falls back on weak/mobile GPUs)
- **Lighting and post:**
  - Night IBL and ACES tone mapping
  - 4K PCF soft shadows
  - GTAO, bloom and fog
  - Lamp light cones and pooled lights (12 real lights reassigned to the nearest lamps)
  - Emissive windows
  - Subtle DOF, film grain, vignette and a cinematic grade
- **Snow and weather:** layered snow (3 layers), footprints, chimney smoke, ice sparkle, snowstorms.
- **Boost:**
  - mump2p shard trails
  - BOOSTED burst (particles, shockwave ring and pillar, flash, camera kick)
  - Billboarded neon Optimum pickup logo
  - Fireworks logo in the ending
- **Instancing:** forest, lamps.
- **Fallback:** `auto` picks a mobile or low-GPU preset at boot. While fps stays under 30, the governor then switches off, in order: DOF, GTAO, light shafts and smoke, render scale 1.0, shadows, bloom, render scale 0.75.

## QA
- Run `python3 qa/run_qa.py final`. It needs Playwright and Chrome, plus a server on `127.0.0.1:18431` (`python3 -m http.server 18431`).
- It writes `qa/final/01_title … 09_pickup_logo.jpg` and `mobile_390x844*.jpg` (390x844, dpr 2, `?quality=auto`), then prints console errors and warnings.
- Options: `QA_ONLY=desktop|mobile` limits the run to one platform, and `QA_QUALITY=` sets the quality.
- `qa/final/models_contact.jpg` and `refs_contact.jpg` are the model and reference contact sheets.
- `python3 qa/run_qa.py` (no argument) runs the older smoke set.
- Debug API: `window.__xmas` exposes:
  - gameplay: deliverSome, givePowerup, teleportNearTarget, skipToEnding, setStorm
  - camera and simulation: `cam(pos, look, fov)`, `advance(sec)`
  - inspection: santaPos, fps, fx, info
  - `?qa=1` uses deterministic fixed time steps.

Textures: ambientCG, CC0.
