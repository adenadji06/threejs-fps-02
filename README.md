[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/adenadji06/threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/adenadji06/threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

# EMBERLINE — tactical strike

A round-based tactical first-person shooter in the style Counter-Strike made
famous, built on three.js 0.187.0, running entirely from static files with no
build step and no network request. An entry for the make.fun
[threejs-fps-02](https://make.fun/bounty/threejs-fps-02) bounty.

## The game

You are Vanguard, attacking with three bot teammates against four Ember Cell
defenders, on one of two arenas. Win a round by eliminating the other team, by
planting the charge at a site and defending it until it detonates — or lose it
if the defenders defuse it or run the clock out. First team to 5 rounds takes
the match.

- **Gunplay where stopping to aim pays**: seven guns (Kestrel P9 pistol,
  Hornet SMG, Raptor-12 pump shotgun with 8 pellets a pull, Viper Repeater
  lever-action, Longbow rifle, Mauler LMG with a 75-round drum, Needle DMR
  with aim-down-sights zoom), headshot damage, recoil and spread that punish
  firing on the move, acceleration, crouching, jumping and full map collision.
  Recoil follows a learnable per-burst pattern and recovers after a short
  pause; spread blooms as a burst runs long and the crosshair opens with it;
  every hit shows impact sparks, a hit marker (gold for headshots) and the
  exact damage dealt.
- **Tactics**: a bomb plant/defuse objective, money earned each round and spent
  in a buy menu during freeze time, an Ember HE grenade with blast damage, and
  bots that walk waypoint routes, hold their site, react to gunfire, and send
  their nearest defender in to defuse a planted charge. Bots take a human
  reaction delay before their first shot of an engagement, miss more against a
  moving target, and sidestep out when wedged on a corner. Going down spectates
  the nearest living squadmate instead of ending the round for you.
- **Four bot classes**: a Rusher flanks and pushes (80 HP, fast, snaps to
  fire), a Marksman holds a lane (rare, accurate shots at 60 m), a Breacher
  closes to 10 m before strafing, and a Heavy (Ember only, 160 HP, 12%
  larger silhouette) walks through fire. A bot hurt below 35 HP falls back
  toward its spawn. Class stripes on the chest tell you which is which.
- **Two maps**: Foundry Yard (compact 40 × 36 m yard — three lanes, a mid
  container block, a chimney at Foundry and a silo at Depot) and Ember Works
  (wide 44 × 32 m furnace hall — long lanes, an open mid, a glowing furnace).
  Pick one on the start screen; the match plays on it. Both share the buy
  economy, the route vocabulary and the plant/defuse objective.
- **Presentation**: procedural canvas textures (worn concrete, riveted wall
  panels, crated planks, hazard stripes, site banners), instanced barrel
  props, drifting ember dust, a glowing furnace and site lamps — plus
  procedural WebAudio gunfire, beeps and explosions (no audio files) over a
  low furnace drone with random ember crackle, footsteps, a round horn and a
  kill sting. A full HUD (health, ammo, money, timer, score, alive counts,
  arena name, kill feed, plant/defuse bars), hit markers and a damage
  vignette.
- **Performance**: fixed 60 Hz simulation apart from rendering, pooled
  tracers/sparks/grenades with no allocation in the combat hot loop, one
  1024² shadow light, tiered bot thinking, and an adaptive pixel ratio that
  steps down when the frame-time EMA stays above 17.5 ms (frame stats on
  `window.__emberPerf`).

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (click the game to lock the pointer) |
| Click | Fire · Right mouse: aim down sights |
| R | Reload |
| 1 / 2 / 3 | Primary / pistol / grenade |
| G | Throw Ember HE grenade |
| E (hold) | Plant the charge inside a site |
| B | Buy menu (freeze time) · 1–7 buy |
| Ctrl / C | Crouch · Space: jump |

## Play it

```sh
node serve.ts
# open http://localhost:8080
```

Node.js 22 or later, and a desktop browser with WebGL 2. No install step,
no network: `game/` is plain files and `game/index.html` opens straight from
any static server.

## Screenshots

Deterministic captures, driven by `?shot=`. The capture script lives beside
this repo in `../threejs-fps-02-tools/shots.mjs` (it needs Playwright, a dev
dependency only — the game itself needs none):

```sh
node ../threejs-fps-02-tools/shots.mjs   # renders 1-start, 2-play, 3-end into screenshots/
```

## Hand in

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `game/` and `screenshots/` to the output directory and
writes `dossier.json` with the kit's `vendor/makefun-threejs.ts`.

## Layout

- `game/index.html` — the page, HUD and import map
- `game/src/` — one module per job: `world` (two map tables + props + lights),
  `textures` (procedural canvas textures), `player` (movement + collision),
  `weapons` (arsenal + grenades), `bots` (AI + four classes), `state` (the
  single state store), `hud` (DOM), `input`, `audio` (procedural sound +
  ambient drone), `palette`, `main` (fixed-step loop + round flow)
- `game/vendor/three/` — three.js 0.187.0, byte for byte from npm
- `vendor/makefun-threejs.ts` — the kit's dossier library, unchanged
- `screenshots/` — real renders of this game's own code

## License

MIT. See [LICENSE](LICENSE).
