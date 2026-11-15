// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. EMBERLINE is a round-based tactical FPS: Vanguard (you + 3
// bots) attacks, the Ember Cell (4 bots) defends two sites. Win a round by
// eliminating the other team, detonating a planted charge, or — as defenders —
// defusing it or running the clock out. Money between rounds buys guns from a
// seven-weapon arsenal. Two arenas — Foundry Yard and Ember Works — picked on
// the start screen (?map=foundry|works) and played for the whole match.
// ?shot=start|play|end with &seed=N sets up a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, MAP_LIST } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS, GRENADE, BUY_ORDER } from './weapons.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createState, resetRound, award, pushFeed, PHASE, WIN_ROUNDS, ROUND_TIME, BUY_TIME, PLANT_TIME, START_MONEY, REWARD_WIN, REWARD_LOSS, REWARD_KILL, REWARD_PLANT } from './state.js';
import { sfx } from './audio.js';

const FIXED_STEP = 1 / 60;
const PLANT_SECONDS = 3;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
// The arena is chosen before anything is built: the world, the bots' routes
// and the player spawn all come from the same map table, so ?map=works builds
// a different game from ?map=foundry with no other code changing.
const mapId = params.get('map') === 'works' ? 'works' : 'foundry';
// In capture mode the player cannot die: the frame must show a live game.
const godMode = !!shot;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // adaptive tiers in perfSample() step down from here
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const state = createState();
const world = createWorld(scene, mapId);
const hud = createHud();
hud.setMap(world.name);
const player = createPlayer(world.colliders, world.playerSpawn);
const arsenal = createArsenal(camera, world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 80;
const direction = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const tempVec = new THREE.Vector3();

let health = 100;
let playerAlive = true;
let started = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let trauma = 0; // camera shake, 0..1
let prevFiring = false;
let buyOpen = false;
let plantBeepT = 0;
let lastStepX = 0;
let lastStepZ = 0;

const body = player.state;
const shootables = world.shootables.concat([]); // world meshes; bot meshes added per shot

// One combined target list, built once: the old per-shot concat() allocated a
// fresh array on every trigger pull and every bot shot.
let allTargets = null;

const bots = createBots(scene, world, {
  state,
  onBotKilled(bot, byPlayer) {
    const name = bot.team === 'vanguard' ? `Vanguard ${bot.name}` : `Ember ${bot.name}`;
    pushFeed(state, byPlayer ? `You ▸ ${name}` : `${name} is down`, bot.team);
    if (byPlayer) {
      state.kills += 1;
      award(state, REWARD_KILL);
      hud.setMoney(state.money);
      sfx.killSting();
    }
    if (state.defuser === bot) state.defuser = null;
  },
  onPlayerDamaged(amount, fromPos) {
    if (godMode) return;
    if (!playerAlive || state.phase === PHASE.END || state.phase === PHASE.MATCH) return;
    health -= amount;
    trauma = Math.min(1, trauma + 0.25);
    hud.damageFlash();
    hud.setHealth(health);
    sfx.hurt();
    if (health <= 0) {
      health = 0;
      playerAlive = false;
      state.deaths += 1;
      pushFeed(state, 'You are down', 'ember');
      hud.setHint('You are down — spectating your squad.');
      if (document.pointerLockElement) document.exitPointerLock();
    }
  },
});

allTargets = shootables.concat(bots.hitMeshes);

function siteOf(position) {
  for (const key of Object.keys(world.sites)) {
    const site = world.sites[key];
    const d = Math.hypot(position.x - site.center.x, position.z - site.center.z);
    if (d <= site.radius) return key;
  }
  return null;
}

function startRound() {
  resetRound(state);
  bots.reset(state.round);
  player.respawn(world.playerSpawn);
  arsenal.refill();
  health = 100;
  playerAlive = true;
  trauma = 0;
  buyOpen = true;
  hud.hideBanner();
  hud.hideObjective();
  hud.showBuy(state.money);
  refreshBuyMarks();
  hud.setHealth(health);
  hud.setMoney(state.money);
  hud.setScore(state.score.vanguard, state.score.ember);
  hud.setTimer(BUY_TIME);
  hud.setAlive(4, 4);
  hud.setHint('Freeze time — buy with B, then push a site.');
  hud.showIntro(`Round ${state.round}`, `${world.name} — plant at Site ${world.sites.A.name} or ${world.sites.B.name}.`);
  syncWeaponHud();
}

function endRound(winner, reason) {
  if (state.phase === PHASE.END || state.phase === PHASE.MATCH) return;
  state.phase = PHASE.END;
  state.phaseT = 4;
  state.roundWinner = winner;
  state.roundReason = reason;
  const won = winner === 'vanguard';
  state.score[winner] += 1;
  award(state, won ? REWARD_WIN : REWARD_LOSS);
  hud.setMoney(state.money);
  const reasonText = {
    elimination: won ? 'Ember Cell eliminated.' : 'Vanguard eliminated.',
    detonation: 'The charge detonated at Site ' + state.site + '.',
    defuse: 'The charge was defused.',
    time: 'Time ran out — the sites held.',
  }[reason] || '';
  hud.showBanner(won ? 'Round won' : 'Round lost', reasonText, won);
  if (won) sfx.roundWin();
  else sfx.roundLose();
  if (document.pointerLockElement) document.exitPointerLock();
  buyOpen = false;
  hud.hideBuy();
  hud.hideObjective();
}

function endMatch() {
  state.phase = PHASE.MATCH;
  state.matchWinner = state.score.vanguard >= WIN_ROUNDS ? 'vanguard' : 'ember';
  const won = state.matchWinner === 'vanguard';
  hud.showOverlay('match', { win: won, vanguard: state.score.vanguard, ember: state.score.ember });
  if (document.pointerLockElement) document.exitPointerLock();
}

function restartMatch() {
  state.score.vanguard = 0;
  state.score.ember = 0;
  state.round = 1;
  state.money = START_MONEY;
  state.kills = 0;
  state.deaths = 0;
  state.plants = 0;
  state.defuses = 0;
  state.feed.length = 0;
  state.matchWinner = null;
  arsenal.resetLoadout();
  hud.hideOverlay();
  hud.hideBanner();
  startRound();
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function shoot(spread) {
  if (!playerAlive) return false;
  if (!arsenal.takeRound()) {
    sfx.dryFire();
    return false;
  }
  const def = arsenal.def();
  // A shotgun fires one ray per pellet through the same spread cone, so the
  // pattern lands where the crosshair points and each pellet can headshot on
  // its own. Every other gun fires exactly one ray. One tracer follows the
  // centre ray; the pellets share it so the screen never fills with lines.
  const pellets = def.pellets || 1;
  let anyHit = false;
  let anyKill = false;
  for (let p = 0; p < pellets; p += 1) {
    camera.getWorldDirection(direction);
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    scene.updateMatrixWorld(true);
    raycaster.set(camera.position, direction);
    const hit = raycaster.intersectObjects(allTargets, false)[0];
    const endPoint = hit ? hit.point : tempVec.copy(camera.position).addScaledVector(direction, 60);
    if (p === 0) {
      arsenal.muzzleWorld(muzzlePos);
      arsenal.tracer(muzzlePos, endPoint);
    }
    if (hit) {
      anyHit = true;
      arsenal.impact(hit.point);
      if (hit.object.userData.bot) {
        const bot = hit.object.userData.bot;
        const head = hit.object.userData.part === 'head';
        const dmg = Math.round(def.damage * (head ? def.headMult : 1));
        const killed = bots.damage(bot, dmg, { isPlayer: true, position: body.position });
        if (killed) anyKill = true;
        hud.hitMarker(killed, shot ? 4000 : 90, head);
        hud.showDamage(dmg, head);
      }
    }
  }
  if (anyHit) sfx.hit(anyKill);
  if (anyKill) trauma = Math.min(1, trauma + 0.15);
  arsenal.pullTrigger();
  sfx.shot(def.kind);
  player.recoil(arsenal.recoil() + random() * 0.003, arsenal.recoilYaw());
  trauma = Math.min(1, trauma + 0.12);
  syncWeaponHud();
  return true;
}

function explodeDamage(center, amount, radius) {
  trauma = Math.min(1, trauma + 0.5);
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    const d = Math.hypot(bot.position.x - center.x, bot.position.z - center.z);
    if (d <= radius) {
      const dmg = Math.round(amount * (1 - (d / radius) * 0.6));
      bots.damage(bot, dmg, { isPlayer: true, position: body.position });
    }
  }
  if (playerAlive && !godMode) {
    const d = Math.hypot(body.position.x - center.x, body.position.z - center.z);
    if (d <= radius) {
      const dmg = Math.round(amount * (1 - (d / radius) * 0.6));
      health -= dmg;
      hud.damageFlash();
      hud.setHealth(health);
      if (health <= 0) {
        health = 0;
        playerAlive = false;
        state.deaths += 1;
        pushFeed(state, 'You are down', 'ember');
        hud.setHint('You are down — spectating your squad.');
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
  }
}

function syncWeaponHud() {
  const def = arsenal.def();
  const inst = arsenal.inst();
  if (def && inst) {
    hud.setAmmo(inst.mag, inst.reserve);
    hud.setWeapon(def.name);
  } else {
    hud.setAmmo(0, 0);
    hud.setWeapon(GRENADE.name);
  }
  hud.setGrenades(arsenal.grenades);
}

function buyItem(id) {
  if (state.phase !== PHASE.BUY) return;
  if (id === 'grenade') {
    if (arsenal.grenades >= GRENADE.max) { sfx.denied(); return; }
    if (state.money < GRENADE.price) { sfx.denied(); return; }
    if (!arsenal.buyGrenade()) { sfx.denied(); return; }
    state.money -= GRENADE.price;
  } else {
    const def = WEAPONS[id];
    if (!def || arsenal.owned[id]) { sfx.denied(); return; }
    if (state.money < def.price) { sfx.denied(); return; }
    if (!arsenal.buy(id)) { sfx.denied(); return; }
    state.money -= def.price;
  }
  hud.setMoney(state.money);
  hud.markBuy(id, state.money >= (WEAPONS[id] ? WEAPONS[id].price : GRENADE.price), !!arsenal.owned[id]);
  syncWeaponHud();
}

function refreshBuyMarks() {
  for (const id of BUY_ORDER) {
    hud.markBuy(id, state.money >= WEAPONS[id].price, !!arsenal.owned[id]);
  }
  hud.markBuy('grenade', state.money >= GRENADE.price, arsenal.grenades >= GRENADE.max);
}

function syncCamera() {
  // Death spectate: while down, the camera rides with the nearest living ally
  // instead of staring at the floor — the round keeps moving and the player
  // keeps watching it.
  if (!playerAlive && (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED)) {
    const ally = bots.bots.find((b) => b.team === 'vanguard' && b.alive);
    if (ally) {
      camera.position.set(ally.position.x, ally.position.y + 1.55, ally.position.z);
      camera.rotation.set(0, ally.yaw, 0, 'YXZ');
      return;
    }
  }
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  const shake = trauma * trauma * 0.02;
  camera.rotation.set(
    body.pitch + (random() * 2 - 1) * shake,
    body.yaw + (random() * 2 - 1) * shake,
    0,
    'YXZ',
  );
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    sfx.unlock();
    hud.hideOverlay();
  } else if (state.phase !== PHASE.MATCH && state.phase !== PHASE.END) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (state.phase === PHASE.MATCH) {
    restartMatch();
    input.requestLock();
    return;
  }
  // The round horn fires on the click itself: the gesture unlocks audio, so
  // the match opens with a sound instead of silence.
  if (state.phase === PHASE.BUY && state.round === 1) sfx.horn();
  input.requestLock();
});
hud.buildBuy(buyItem);
// The arena picker: a card click reloads the page on the other map, which
// rebuilds the world, the routes and the spawns from that map's table. A
// reload is deliberate — rebuilding a live world under the bots and the
// player would be a second, buggier code path for the same result.
hud.buildMapSelect(MAP_LIST, mapId, (id) => {
  if (id === mapId) return;
  const url = new URL(window.location.href);
  url.searchParams.set('map', id);
  window.location.href = url.toString();
});

function step(dt) {
  state.elapsed += dt;
  trauma = Math.max(0, trauma - dt * 1.6);

  if (state.phase === PHASE.BUY) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      state.phase = PHASE.LIVE;
      state.phaseT = ROUND_TIME;
      buyOpen = false;
      hud.hideBuy();
      hud.setHint('Plant the charge at Site A or B — or eliminate the Ember Cell.');
    }
  } else if (state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED) {
    state.phaseT -= dt;
    if (state.phase === PHASE.LIVE && state.phaseT <= 0) {
      endRound('ember', 'time');
    } else if (state.phase === PHASE.PLANTED && state.phaseT <= 0) {
      state.charge = 'detonated';
      sfx.explosion();
      trauma = 1;
      endRound('vanguard', 'detonation');
    }
  } else if (state.phase === PHASE.END) {
    state.phaseT -= dt;
    if (state.phaseT <= 0) {
      if (state.score.vanguard >= WIN_ROUNDS || state.score.ember >= WIN_ROUNDS) {
        endMatch();
      } else {
        state.round += 1;
        startRound();
      }
    }
  }

  // The player only moves and shoots while the round is live.
  const live = state.phase === PHASE.LIVE || state.phase === PHASE.PLANTED;
  if (live && playerAlive) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    player.step(dt, input.state.keys, input.state.ads);
    // Footsteps: one quiet tick every 2.4 m of travel, so movement has a
    // sound without a sound per frame. Tracked on the sim position, not the
    // render loop, so the cadence matches the stride.
    const stepDx = body.position.x - lastStepX;
    const stepDz = body.position.z - lastStepZ;
    if (Math.hypot(stepDx, stepDz) > 2.4) {
      lastStepX = body.position.x;
      lastStepZ = body.position.z;
      sfx.step();
    }
  } else {
    // Freeze time still lets the player look around; a paused game eats no input.
    const look = input.takeLook();
    if (state.phase === PHASE.BUY && playerAlive) player.look(look.x, look.y);
  }

  // Weapon and buy input: firing and planting only while live, buying while frozen.
  if ((live || state.phase === PHASE.BUY) && playerAlive) {
    const def = arsenal.def();
    if (live && def) {
      const wantFire = input.state.firing && (def.auto || !prevFiring);
      if (wantFire && arsenal.ready()) shoot(shot ? 0 : arsenal.spread(player.groundSpeed(), input.state.ads));
      else if (wantFire && arsenal.inst() && arsenal.inst().mag === 0) {
        // Empty mag on trigger pull: reload at once instead of dry-clicking.
        arsenal.reload();
        hud.setHint('Reloading…');
      }
      if (input.wasPressed('KeyR')) arsenal.reload();
    }
    prevFiring = input.state.firing;
    // While the buy menu is open, digits buy; otherwise they switch weapons.
    if (!buyOpen) {
      if (input.wasPressed('Digit1')) { arsenal.switchTo('primary'); syncWeaponHud(); }
      if (input.wasPressed('Digit2')) { arsenal.switchTo('pistol'); syncWeaponHud(); }
      if (input.wasPressed('Digit3')) { arsenal.switchTo('grenade'); syncWeaponHud(); }
    }
    if (live && input.wasPressed('KeyG')) {
      if (arsenal.grenades > 0) {
        camera.getWorldDirection(direction);
        arsenal.throwGrenade(
          tempVec.set(body.position.x, body.position.y + body.eye - 0.1, body.position.z),
          direction,
        );
        syncWeaponHud();
      } else sfx.denied();
    }
    if (input.wasPressed('KeyB') && state.phase === PHASE.BUY) {
      buyOpen = !buyOpen;
      if (buyOpen) { hud.showBuy(state.money); refreshBuyMarks(); }
      else hud.hideBuy();
    }
    if (buyOpen && state.phase === PHASE.BUY) {
      // Digits buy in menu order: 1-6 are the six buyable guns, 7 is the grenade.
      for (let i = 0; i < BUY_ORDER.length; i += 1) {
        if (input.wasPressed(`Digit${i + 1}`)) buyItem(BUY_ORDER[i]);
      }
      if (input.wasPressed('Digit7')) buyItem('grenade');
    }

    // Planting: hold E inside a site while carrying the charge.
    const site = siteOf(body.position);
    if (live && state.charge === 'carried' && site) {
      if (input.state.keys.has('KeyE')) {
        state.plantProgress += dt / PLANT_SECONDS;
        plantBeepT -= dt;
        if (plantBeepT <= 0) {
          plantBeepT = 0.5;
          sfx.plantBeep();
        }
        hud.showObjective(`Planting the charge at Site ${site}…`, state.plantProgress);
        if (state.plantProgress >= 1) {
          state.charge = 'planted';
          state.site = site;
          state.phase = PHASE.PLANTED;
          state.phaseT = PLANT_TIME;
          state.plants += 1;
          award(state, REWARD_PLANT);
          hud.setMoney(state.money);
          hud.hideObjective();
          hud.setHint(`Charge planted at Site ${site} — defend it.`);
          pushFeed(state, `Charge planted at Site ${site}`, 'vanguard');
          sfx.plantComplete();
          state.defuser = bots.nearestDefender(site);
        }
      } else {
        state.plantProgress = Math.max(0, state.plantProgress - dt / PLANT_SECONDS);
        hud.showObjective(`Hold E to plant at Site ${site}`, state.plantProgress);
      }
    } else {
      if (state.plantProgress > 0) state.plantProgress = 0;
      if (state.phase === PHASE.LIVE) {
        hud.setHint(state.charge === 'carried' ? 'Plant the charge at Site A or B — or eliminate the Ember Cell.' : '');
      }
      if (state.phase === PHASE.LIVE && !site) hud.hideObjective();
    }

    // ADS zoom.
    const targetFov = input.state.ads && arsenal.zoom() > 1 ? 74 / arsenal.zoom() : 74;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
  }

  // A planted charge ticks: the defuser channels, the timer runs. If the
  // defuser dies, the next nearest defender takes the job.
  if (state.phase === PHASE.PLANTED) {
    if (!state.defuser || !state.defuser.alive) state.defuser = bots.nearestDefender(state.site);
    const defuser = state.defuser;
    if (defuser && defuser.alive && defuser.defusing) {
      state.defuseProgress += dt / 5;
      hud.showObjective(`Ember is defusing the charge!`, state.defuseProgress);
      if (state.defuseProgress >= 1) {
        state.charge = 'defused';
        state.defuses += 1;
        hud.hideObjective();
        endRound('ember', 'defuse');
      }
    } else if (state.defuseProgress > 0) {
      state.defuseProgress = Math.max(0, state.defuseProgress - dt / 5);
      hud.showObjective('Charge planted — defend it.', state.defuseProgress);
    } else {
      hud.showObjective(`Charge planted at Site ${state.site} — ${Math.ceil(state.phaseT)}s to detonation`, 1 - state.phaseT / PLANT_TIME);
    }
  }

  arsenal.step(dt, player.groundSpeed(), input.state.ads);
  arsenal.stepGrenades(dt, explodeDamage);
  // Ambient world motion: the dust cloud bobs, the furnace light breathes.
  world.step(dt, state.elapsed);

  // Bots move and fight whenever a round is live or planted; frozen in buy time.
  if (live) {
    bots.step(dt, {
      playerAlive,
      playerPos: body.position,
      playerCrouching: body.crouching,
      playerSpeed: player.groundSpeed(),
      playerFiring: input.state.firing && playerAlive,
      time: state.elapsed,
    });
  }

  // Round end checks: elimination first, then the objective.
  if (live) {
    if (bots.aliveCount('ember') === 0) endRound('vanguard', 'elimination');
    else if (bots.aliveCount('vanguard') === 0 && !playerAlive) endRound('ember', 'elimination');
  }

  // HUD sync.
  hud.setTimer(state.phase === PHASE.BUY ? state.phaseT : state.phase === PHASE.END ? 0 : state.phaseT);
  hud.setScore(state.score.vanguard, state.score.ember);
  hud.setAlive(bots.aliveCount('vanguard') + (playerAlive ? 1 : 0), bots.aliveCount('ember'));
  hud.setFeed(state.feed);
  const spreadPx = 5 + arsenal.spread(player.groundSpeed(), input.state.ads) * 900;
  hud.setCrosshair(spreadPx);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  perfSample(dt * 1000);
  if (!frozen && state.phase !== PHASE.MATCH) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

// Frame-time meter + adaptive pixel ratio (skill Q2: stable 60 fps in peak
// combat). A 240-sample ring buffer records every frame; median/p95/p99 and
// the count of frames over 16.67 ms are exposed on window.__emberPerf. When
// the EMA frame time stays above 17.5 ms the pixel ratio steps down
// (1.5 -> 1.25 -> 1.0) to buy GPU headroom; when it stays under 11 ms it
// steps back up. The sim is fixed-step, so this never changes game speed.
const PERF_SAMPLES = 240;
const perfRing = new Float32Array(PERF_SAMPLES);
let perfCursor = 0;
let perfCount = 0;
let perfEma = 16.67;
let pixelTier = 0; // 0 = 1.5x, 1 = 1.25x, 2 = 1.0x
const PIXEL_TIERS = [1.5, 1.25, 1];
let perfTierT = 0;

function perfSample(ms) {
  perfRing[perfCursor] = ms;
  perfCursor = (perfCursor + 1) % PERF_SAMPLES;
  if (perfCount < PERF_SAMPLES) perfCount += 1;
  perfEma += (ms - perfEma) * 0.05;
  perfTierT += ms / 1000;
  if (perfTierT < 1.5) return;
  perfTierT = 0;
  if (perfEma > 17.5 && pixelTier < PIXEL_TIERS.length - 1) {
    pixelTier += 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_TIERS[pixelTier]));
  } else if (perfEma < 11 && pixelTier > 0) {
    pixelTier -= 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PIXEL_TIERS[pixelTier]));
  }
}

function perfStats() {
  const n = perfCount;
  if (n === 0) return { samples: 0 };
  const sorted = Array.from(perfRing.slice(0, n)).sort((a, b) => a - b);
  let over = 0;
  let over33 = 0;
  for (let i = 0; i < n; i += 1) {
    if (sorted[i] > 16.67) over += 1;
    if (sorted[i] > 33.33) over33 += 1;
  }
  const at = (q) => Math.round(sorted[Math.min(n - 1, Math.floor(q * n))] * 100) / 100;
  return {
    samples: n,
    medianMs: at(0.5),
    p95Ms: at(0.95),
    p99Ms: at(0.99),
    emaMs: Math.round(perfEma * 100) / 100,
    over16ms: over,
    over33ms: over33,
    pixelRatio: renderer.getPixelRatio(),
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  };
}
window.__emberPerf = perfStats;

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  buyOpen = false;
  state.phase = PHASE.LIVE;
  state.phaseT = ROUND_TIME;
  body.pitch = 0;
  if (name === 'start') {
    // Spawn vista: the yard, the mid container and both lanes ahead, allies in view.
    player.respawn(world.playerSpawn);
    bots.reset(1);
    bots.bots[0].position.set(-4, 0, 9);
    bots.bots[0].yaw = 0;
    bots.bots[0].group.rotation.y = 0;
    bots.bots[1].position.set(4, 0, 9);
    bots.bots[1].yaw = 0;
    bots.bots[1].group.rotation.y = 0;
    body.yaw = 0;
    state.phase = PHASE.BUY;
    state.phaseT = BUY_TIME;
    settle(20);
    hud.setHint('Freeze time — buy with B, then push a site.');
  } else if (name === 'play') {
    // A firefight down the west lane: aim at an Ember bot and put rounds on it.
    player.respawn([-13, 4]);
    bots.reset(1);
    const target = bots.bots[3];
    target.position.set(-13, 0, -6);
    target.holdT = 999;
    target.thinkT = 999; // hold still for the capture: no scanning, no strafing
    target.yaw = Math.PI;
    target.group.rotation.y = Math.PI;
    bots.bots[4].position.set(13, 0, -2);
    bots.bots[4].holdT = 999;
    bots.bots[4].thinkT = 999;
    body.yaw = 0;
    settle(20);
    aimAt(new THREE.Vector3(target.position.x, target.position.y + 1.3, target.position.z));
    for (let round = 0; round < 3; round += 1) {
      shoot(0);
      settle(6);
    }
    settle(10);
    // Re-aim after the recoil settles, so the crosshair sits on the target.
    aimAt(new THREE.Vector3(target.position.x, target.position.y + 1.3, target.position.z));
  } else if (name === 'plant') {
    // The charge is planted at Site A: the player defends, the nearest Ember
    // bot walks in to defuse, the objective bar counts the defuse.
    player.respawn([-13, -7.5]);
    bots.reset(1);
    state.charge = 'planted';
    state.site = 'A';
    state.phase = PHASE.PLANTED;
    state.phaseT = PLANT_TIME;
    state.defuser = bots.nearestDefender('A');
    body.yaw = 0.3;
    settle(60);
    // The sim step only refreshes the hint while LIVE, so the freeze-time hint
    // from startRound would otherwise survive into this capture.
    hud.setHint('Charge planted at Site A — defend it.');
  } else {
    // Round won at Site A, the charge planted, the banner up.
    player.respawn([-13, -7]);
    bots.reset(1);
    state.charge = 'planted';
    state.site = 'A';
    state.score.vanguard = 1;
    state.money = 1400;
    body.yaw = 0.4;
    settle(20);
    hud.showBanner('Round won', 'The charge detonated at Site A.', true);
    hud.setTimer(0);
  }
  hud.setHealth(health);
  hud.setMoney(state.money);
  hud.setScore(state.score.vanguard, state.score.ember);
  hud.setAlive(bots.aliveCount('vanguard') + 1, bots.aliveCount('ember'));
  syncWeaponHud();
  syncCamera();
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startRound();
syncCamera();
// Test hook: lets the local screenshot/play-test script read the sim state.
window.__emberDebug = () => ({
  phase: state.phase,
  round: state.round,
  map: world.mapId,
  weapons: Object.keys(WEAPONS).length,
  money: state.money,
  health,
  playerAlive,
  score: { ...state.score },
  alive: [bots.aliveCount('vanguard') + (playerAlive ? 1 : 0), bots.aliveCount('ember')],
  charge: state.charge,
  site: state.site,
  plantProgress: Math.round(state.plantProgress * 100) / 100,
  pos: [Math.round(body.position.x * 10) / 10, Math.round(body.position.z * 10) / 10],
  yaw: Math.round(body.yaw * 100) / 100,
  keys: [...input.state.keys],
  grenades: arsenal.grenades,
  weapon: arsenal.def() ? arsenal.def().name : 'grenade',
  kills: state.kills,
  feed: state.feed.map((f) => f.text),
  perf: perfStats(),
});
if (shot) runShot(shot);
else requestAnimationFrame(frame);
