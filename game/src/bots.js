// The bots: three Vanguard allies and four Ember defenders, all driven by one
// state machine. They walk waypoint routes, hold their site, scan for enemies
// with a line-of-sight ray, fire aimed bursts, investigate gunfire they hear, and
// the nearest living defender walks in to defuse a planted charge. One shared
// raycaster and a handful of reused vectors: no allocation in the hot loop.
//
// Four bot classes make the squads read as a team, not seven copies: a Rusher
// flanks and pushes, a Marksman holds a lane and fires rarely but accurately, a
// Breacher closes to shotgun range, and a Heavy (Ember only) walks through fire
// with 160 HP. Each class has its own speed, health, reaction delay, aim error,
// damage and burst length — the numbers below are the whole difference, and
// they are what the player learns to read in a fight.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { sfx } from './audio.js';

const BOT_NAMES = {
  vanguard: ['Vex', 'Halo', 'Rook'],
  ember: ['Ash', 'Cinder', 'Flint', 'Soot'],
};
const BOT_CLASSES = {
  vanguard: ['rusher', 'marksman', 'breacher'],
  ember: ['marksman', 'rusher', 'breacher', 'heavy'],
};
const CLASSES = {
  // reaction: [min, max] seconds before the first shot of an engagement.
  // error: base aim error in radians at the muzzle. burst: [min, max] shots.
  // hold: [min, max] seconds holding a route end before patrolling back.
  rusher: { name: 'Rusher', hp: 80, speed: 4.6, reaction: [0.16, 0.3], error: 0.034, damage: 24, burst: [5, 7], range: 34, hold: [0.5, 1.5], flank: true },
  marksman: { name: 'Marksman', hp: 100, speed: 3.0, reaction: [0.35, 0.5], error: 0.014, damage: 30, burst: [2, 3], range: 60, hold: [3, 6], flank: false },
  breacher: { name: 'Breacher', hp: 120, speed: 3.8, reaction: [0.22, 0.36], error: 0.045, damage: 26, burst: [4, 6], range: 22, hold: [1, 2], flank: false },
  heavy: { name: 'Heavy', hp: 160, speed: 2.8, reaction: [0.26, 0.4], error: 0.02, damage: 34, burst: [4, 5], range: 42, hold: [1, 3], flank: false },
};
const RUSH_SPEED = 4.4;
const EYE_HEIGHT = 1.55;
const THINK_EVERY = 0.15;
const FOV_COS = 0.25; // cos(~75 deg): a bot sees a 150-degree cone
const DEFUSE_TIME = 5;

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _move = new THREE.Vector3();
const _end = new THREE.Vector3();

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

export function createBots(scene, world, hooks) {
  // hooks: { onBotKilled(bot, byPlayer), onPlayerDamaged(amount, fromPos),
  //          onDefused(), onBotShot(bot), state }
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const random = mulberry32(1337);

  const allyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ally), roughness: 0.65, metalness: 0.1 });
  const enemyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.65, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#1c1a18'), roughness: 0.8 });
  const torsoGeo = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeo = new THREE.SphereGeometry(0.16, 12, 10);
  const legGeo = new THREE.BoxGeometry(0.18, 0.62, 0.2);
  const gunGeo = new THREE.BoxGeometry(0.07, 0.09, 0.55);

  const bots = [];
  const hitMeshes = [];

  // Tracer pool for bot shots, same pattern as the player's.
  const tracers = [];
  for (let i = 0; i < 6; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;

  function spawnBot(team, index, routeName, spawn) {
    const clsName = BOT_CLASSES[team][index];
    const cls = CLASSES[clsName];
    const group = new THREE.Group();
    const mat = team === 'vanguard' ? allyMat : enemyMat;
    const torso = new THREE.Mesh(torsoGeo, mat);
    torso.position.y = 1.0;
    const head = new THREE.Mesh(headGeo, darkMat);
    head.position.y = 1.55;
    const legL = new THREE.Mesh(legGeo, darkMat);
    legL.position.set(-0.13, 0.31, 0);
    const legR = new THREE.Mesh(legGeo, darkMat);
    legR.position.set(0.13, 0.31, 0);
    const gun = new THREE.Mesh(gunGeo, darkMat);
    gun.position.set(0.2, 1.25, -0.3);
    const flash = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
    );
    flash.position.set(0.2, 1.25, -0.62);
    // Class stripe: a small lit bar on the chest, so the player's eye learns
    // the class at a glance — amber for the pushers, white for the holders.
    const stripeColor = clsName === 'marksman' || clsName === 'heavy' ? PALETTE.ink : PALETTE.accent;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.08, 0.02),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(stripeColor) }),
    );
    stripe.position.set(0, 1.25, 0.16);
    group.add(torso, head, legL, legR, gun, flash, stripe);
    // The Heavy reads bigger before it reads tougher: a 12% larger silhouette.
    if (clsName === 'heavy') group.scale.setScalar(1.12);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    group.position.set(spawn[0], 0, spawn[1]);
    scene.add(group);

    const bot = {
      team,
      name: BOT_NAMES[team][index],
      clsName,
      cls,
      group,
      torso,
      head,
      flash,
      position: group.position,
      yaw: team === 'vanguard' ? Math.PI : 0,
      health: cls.hp,
      alive: true,
      routeName,
      routeIndex: 0,
      holdT: 0,
      target: null, // { kind: 'player' | 'bot', ref, pos }
      aimTime: 0,
      engageT: 0, // time held on the CURRENT target
      // Reaction delay before the first shot of an engagement: a fair, readable
      // fight. Veterans react faster; nobody opens fire the instant a target
      // pops into the cone. The class sets the range: a Rusher snaps, a
      // Marksman takes its time and then rarely misses.
      reactionDelay: cls.reaction[0] + random() * (cls.reaction[1] - cls.reaction[0]),
      thinkT: random() * THINK_EVERY,
      fireT: 0,
      burstLeft: 0,
      burstPause: 0,
      strafeDir: 1,
      strafeT: 0,
      investigate: null, // pooled invVec below, or null when idle
      invVec: new THREE.Vector3(), // preallocated investigate target: no allocation per noise event
      lookT: 0,
      defusing: false,
      fall: 0,
      walkPhase: random() * 6,
      speed: cls.speed,
      // Retreat: seconds left falling back toward spawn after taking a bad
      // hit at low health. A bot that never retreats is a bot that feeds.
      retreatT: 0,
      flankSide: 1,
      // Unstuck recovery: last position + time spent barely moving.
      lastX: spawn[0],
      lastZ: spawn[1],
      stuckT: 0,
    };
    torso.userData.bot = bot;
    torso.userData.part = 'torso';
    head.userData.bot = bot;
    head.userData.part = 'head';
    hitMeshes.push(torso, head);
    bots.push(bot);
    return bot;
  }

  function assignRoutes(round) {
    const atk = ['attackA', 'attackB', 'attackMidA'];
    const def = ['defendA', 'defendB', 'defendMid', round % 2 ? 'defendA' : 'defendB'];
    const vanguard = bots.filter((b) => b.team === 'vanguard');
    const ember = bots.filter((b) => b.team === 'ember');
    vanguard.forEach((bot, i) => {
      bot.routeName = atk[(i + round) % atk.length];
      bot.routeIndex = 0;
    });
    ember.forEach((bot, i) => {
      bot.routeName = def[(i + round) % def.length];
      bot.routeIndex = 0;
    });
  }

  function reset(round) {
    // Spawns come from the active map, so the same reset works on both arenas.
    const vSpawn = world.spawns.vanguard;
    const eSpawn = world.spawns.ember;
    let vi = 0;
    let ei = 0;
    for (const bot of bots) {
      const spawn = bot.team === 'vanguard' ? vSpawn[vi++] : eSpawn[ei++];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.yaw = bot.team === 'vanguard' ? Math.PI : 0;
      bot.health = bot.cls.hp;
      bot.alive = true;
      bot.target = null;
      bot.aimTime = 0;
      bot.fireT = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.investigate = null;
      bot.defusing = false;
      bot.fall = 0;
      bot.engageT = 0;
      bot.stuckT = 0;
      bot.retreatT = 0;
      bot.holdT = 0;
      bot.lastX = spawn[0];
      bot.lastZ = spawn[1];
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.y = 0;
      bot.group.visible = true;
    }
    assignRoutes(round);
  }

  function routePoint(bot) {
    const route = world.routes[bot.routeName];
    const name = route[Math.min(bot.routeIndex, route.length - 1)];
    const p = world.waypoints[name];
    return p;
  }

  function advanceRoute(bot) {
    const route = world.routes[bot.routeName];
    if (bot.routeIndex < route.length - 1) bot.routeIndex += 1;
    else {
      // At the end of the route: hold the position, then patrol back one step.
      // The hold length is the class's: a Marksman watches a lane for up to
      // 6 s, a Rusher barely stops before it flanks.
      bot.holdT = bot.cls.hold[0] + random() * (bot.cls.hold[1] - bot.cls.hold[0]);
      bot.routeIndex = Math.max(0, route.length - 2);
    }
  }

  function moveToward(bot, tx, tz, dt, speed) {
    _move.set(tx - bot.position.x, 0, tz - bot.position.z);
    const dist = Math.hypot(_move.x, _move.z);
    if (dist < 0.05) return true;
    _move.multiplyScalar(Math.min(1, speed * dt / dist));
    const nx = bot.position.x + _move.x;
    const nz = bot.position.z + _move.z;
    // Axis-separated AABB test, same shape as the player's.
    let blocked = false;
    for (const c of world.colliders) {
      if (nx + 0.34 > c.min.x && nx - 0.34 < c.max.x && 0.05 < c.max.y && 1.7 > c.min.y && nz + 0.34 > c.min.z && nz - 0.34 < c.max.z) { blocked = true; break; }
    }
    if (!blocked) {
      bot.position.x = nx;
      bot.position.z = nz;
    } else {
      // Try x-only, then z-only, so a bot slides along a wall instead of sticking.
      let okX = true;
      let okZ = true;
      for (const c of world.colliders) {
        if (nx + 0.34 > c.min.x && nx - 0.34 < c.max.x && 0.05 < c.max.y && 1.7 > c.min.y && bot.position.z + 0.34 > c.min.z && bot.position.z - 0.34 < c.max.z) okX = false;
        if (bot.position.x + 0.34 > c.min.x && bot.position.x - 0.34 < c.max.x && 0.05 < c.max.y && 1.7 > c.min.y && nz + 0.34 > c.min.z && nz - 0.34 < c.max.z) okZ = false;
      }
      if (okX) bot.position.x = nx;
      if (okZ) bot.position.z = nz;
      if (!okX && !okZ) return true; // stuck: treat as arrived so the route advances
    }
    return dist < 0.4;
  }

  function canSee(bot, tx, ty, tz) {
    _eye.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    _to.set(tx - _eye.x, ty - _eye.y, tz - _eye.z);
    const dist = _to.length();
    // Perception range is the class's: a Marksman spots across the yard, a
    // Breacher only notices what is close enough to rush.
    if (dist > bot.cls.range) return 0;
    _dir.copy(_to).normalize();
    // Facing check: the target must be inside the bot's forward cone.
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    if ((_dir.x * fx + _dir.z * fz) < FOV_COS && dist > 3) return 0;
    raycaster.set(_eye, _dir);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(world.shootables, false)[0];
    if (hit) return 0;
    return dist;
  }

  function scan(bot, ctx) {
    const hadTarget = !!bot.target;
    bot.target = null;
    let best = Infinity;
    // Only Ember bots hunt the player: an ally must never target its own team.
    if (ctx.playerAlive && bot.team === 'ember') {
      const d = canSee(bot, ctx.playerPos.x, ctx.playerPos.y + 1.3, ctx.playerPos.z);
      if (d > 0 && d < best) {
        best = d;
        bot.target = { kind: 'player', dist: d };
      }
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const d = canSee(bot, other.position.x, other.position.y + 1.3, other.position.z);
      if (d > 0 && d < best) {
        best = d;
        bot.target = { kind: 'bot', ref: other, dist: d };
      }
    }
    // A fresh engagement restarts the reaction clock and the burst: the bot
    // must hold the target for reactionDelay before its first shot.
    if (bot.target && !hadTarget) {
      bot.engageT = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.fireT = 0;
    }
  }

  function targetPoint(bot, out) {
    if (bot.target.kind === 'player') {
      out.set(hooks.playerPos.x, hooks.playerPos.y + 1.3, hooks.playerPos.z);
    } else {
      out.set(bot.target.ref.position.x, bot.target.ref.position.y + 1.3, bot.target.ref.position.z);
    }
    return out;
  }

  function shootAt(bot, dt, ctx) {
    if (!bot.target) return;
    bot.aimTime += dt;
    bot.engageT += dt;
    // Reaction delay: no shots until the bot has held the target long enough
    // to "see" it. This is the fairness window the player uses to peek.
    if (bot.engageT < bot.reactionDelay) return;
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = bot.cls.burst[0] + Math.floor(random() * (bot.cls.burst[1] - bot.cls.burst[0] + 1));
      bot.burstPause = 0;
    }
    bot.fireT -= dt;
    if (bot.fireT > 0) return;
    bot.fireT = bot.team === 'ember' ? 0.14 : 0.13;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.burstPause = 0.7 + random() * 0.7;

    const dist = bot.target.dist;
    // Aim error shrinks the longer the bot has held the target, grows with
    // range — and grows when the target is moving, so a strafing player is
    // harder to hit than a standing one. The base error is the class's: a
    // Marksman is a laser at range, a Breacher sprays up close.
    const targetSpeed = bot.target.kind === 'player' ? (ctx.playerSpeed || 0) : 0;
    const error = Math.max(0.008, bot.cls.error + dist * 0.0009 + targetSpeed * 0.0016 - bot.aimTime * 0.012);
    _eye.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    targetPoint(bot, _aim);
    _aim.x += (random() * 2 - 1) * error * dist;
    _aim.y += (random() * 2 - 1) * error * dist * 0.6;
    _aim.z += (random() * 2 - 1) * error * dist;
    _dir.copy(_aim).sub(_eye).normalize();
    raycaster.set(_eye, _dir);
    raycaster.far = 70;
    // The shooter's own meshes are in hitMeshes: leave them out, or every shot
    // would hit the bot's own head at the ray's origin. otherHitMeshes is built
    // once per bot at spawn — the old per-shot filter() allocated every bullet.
    const targets = world.shootables.concat(bot.otherHitMeshes);
    const hit = raycaster.intersectObjects(targets, false)[0];
    // Tracer from the bot's gun to the hit point (or 40 m out).
    const end = hit ? hit.point : _end.copy(_eye).addScaledVector(_dir, 40);
    const t = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % tracers.length;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, _eye.x, _eye.y, _eye.z);
    pos.setXYZ(1, end.x, end.y, end.z);
    pos.needsUpdate = true;
    t.line.visible = true;
    t.line.material.opacity = 0.8;
    t.life = 0.06;
    bot.flash.material.opacity = 0.9;
    setTimeout(() => { bot.flash.material.opacity = 0; }, 50);
    sfx.shot('enemy');

    if (hit && hit.object.userData.bot) {
      const victim = hit.object.userData.bot;
      const head = hit.object.userData.part === 'head';
      const dmg = Math.round(bot.cls.damage * (head ? 3 : 1) * Math.max(0.5, 1 - dist / 90));
      damage(victim, dmg, bot);
    }
    // The player's own ray is separate; a bot shooting the player is a hit on the
    // player's capsule, tested by distance to the ray instead of a mesh.
    if (bot.target.kind === 'player') {
      const p = hooks.playerPos;
      const px = p.x - _eye.x;
      const py = p.y + 1.3 - _eye.y;
      const pz = p.z - _eye.z;
      const along = px * _dir.x + py * _dir.y + pz * _dir.z;
      if (along > 0 && along < 70) {
        const cx = _eye.x + _dir.x * along;
        const cy = _eye.y + _dir.y * along;
        const cz = _eye.z + _dir.z * along;
        const miss = Math.hypot(p.x - cx, (p.y + 1.1) - cy, p.z - cz);
        const hitR = hooks.playerCrouching ? 0.42 : 0.55;
        if (miss < hitR && (!hit || hit.distance > along)) {
          const dmg = Math.round(bot.cls.damage * Math.max(0.5, 1 - dist / 90));
          hooks.onPlayerDamaged(dmg, bot.position);
        }
      }
    }
  }

  function damage(bot, amount, attacker) {
    if (!bot.alive) return false;
    bot.health -= amount;
    bot.investigate = null;
    if (attacker) {
      // Being shot at makes a bot turn toward the shooter.
      const dx = attacker.position ? attacker.position.x - bot.position.x : 0;
      const dz = attacker.position ? attacker.position.z - bot.position.z : 0;
      if (dx || dz) bot.yaw = Math.atan2(-dx, -dz);
    }
    if (bot.health > 0) return false;
    bot.alive = false;
    bot.target = null;
    bot.defusing = false;
    bot.fall = 0.0001;
    hooks.onBotKilled(bot, attacker && attacker.isPlayer);
    return true;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      if (bot.fall > 0 && bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    bot.thinkT -= dt;
    if (bot.thinkT <= 0) {
      bot.thinkT = THINK_EVERY;
      scan(bot, ctx);
      if (bot.target) bot.aimTime = Math.min(bot.aimTime, 0.4);
      else bot.aimTime = 0;
      // Hurt bad and still in a fight: fall back toward spawn for a couple
      // of seconds instead of standing in the open and feeding the enemy.
      if (bot.health < 35 && bot.target && bot.retreatT <= 0 && random() < 0.3) {
        bot.retreatT = 2.2;
        const spawn = world.spawns[bot.team][0];
        bot.investigate = bot.invVec.set(spawn[0], 0, spawn[1]);
      }
      // Hear the player's gunfire: investigate the noise.
      if (ctx.playerFiring && ctx.playerAlive && !bot.target) {
        const d = Math.hypot(ctx.playerPos.x - bot.position.x, ctx.playerPos.z - bot.position.z);
        if (d < 28 && !bot.investigate) {
          bot.investigate = bot.invVec.set(ctx.playerPos.x, 0, ctx.playerPos.z);
        }
      }
    }

    // Retreating: run for the spawn, no shooting, no route — just distance.
    if (bot.retreatT > 0) {
      bot.retreatT -= dt;
      if (bot.investigate) {
        moveToward(bot, bot.investigate.x, bot.investigate.z, dt, RUSH_SPEED);
        bot.yaw = Math.atan2(-(bot.investigate.x - bot.position.x), -(bot.investigate.z - bot.position.z));
      }
      bot.group.rotation.y = bot.yaw;
      return;
    }

    // Defuse duty: the nearest living defender walks to a planted charge.
    const state = hooks.state;
    if (state.phase === 'planted' && bot.team === 'ember' && state.defuser === bot) {
      const site = state.site === 'A' ? world.waypoints.aSite : world.waypoints.bSite;
      const d = Math.hypot(site[0] - bot.position.x, site[1] - bot.position.z);
      if (d > 1.4) {
        moveToward(bot, site[0], site[1], dt, RUSH_SPEED);
        bot.yaw = Math.atan2(-(site[0] - bot.position.x), -(site[1] - bot.position.z));
      } else {
        bot.defusing = true;
        bot.yaw += dt * 0.8;
      }
      bot.group.rotation.y = bot.yaw;
      return;
    }

    if (bot.target) {
      // Combat: face the target, strafe, fire in bursts.
      targetPoint(bot, _aim);
      bot.yaw = Math.atan2(-(_aim.x - bot.position.x), -(_aim.z - bot.position.z));
      // A Breacher does not strafe at range: it closes the distance until
      // the fight is inside its 10 m envelope, then it strafes like the rest.
      if (bot.clsName === 'breacher' && bot.target.dist > 10) {
        moveToward(bot, _aim.x, _aim.z, dt, RUSH_SPEED);
      } else {
        bot.strafeT -= dt;
        if (bot.strafeT <= 0) {
          bot.strafeT = 0.8 + random() * 0.8;
          bot.strafeDir = random() < 0.5 ? -1 : 1;
        }
        const side = bot.strafeDir;
        const tx = bot.position.x + Math.cos(bot.yaw) * side * 1.2;
        const tz = bot.position.z - Math.sin(bot.yaw) * side * 1.2;
        moveToward(bot, tx, tz, dt, 1.6);
      }
      shootAt(bot, dt, ctx);
    } else if (bot.investigate) {
      const arrived = moveToward(bot, bot.investigate.x, bot.investigate.z, dt, RUSH_SPEED);
      bot.yaw = Math.atan2(-(bot.investigate.x - bot.position.x), -(bot.investigate.z - bot.position.z));
      if (arrived) {
        bot.lookT += dt;
        bot.yaw += dt * 1.2;
        if (bot.lookT > 2) {
          bot.lookT = 0;
          bot.investigate = null;
        }
      }
    } else if (bot.holdT > 0) {
      bot.holdT -= dt;
      bot.yaw += dt * 0.35;
      if (bot.holdT <= 0 && bot.cls.flank) {
        // A Rusher never waits twice in the same place: after holding, it
        // cuts across to the opposite lane and comes at the site from a new
        // angle, so the defence cannot just pre-aim one lane.
        bot.flankSide = -bot.flankSide;
        const cut = bot.flankSide > 0 ? world.waypoints.westCut : world.waypoints.eastCut;
        bot.investigate = bot.invVec.set(cut[0], 0, cut[1]);
      }
    } else {
      const point = routePoint(bot);
      const arrived = moveToward(bot, point[0], point[1], dt, bot.speed);
      bot.yaw = Math.atan2(-(point[0] - bot.position.x), -(point[1] - bot.position.z));
      if (arrived) advanceRoute(bot);
    }
    bot.group.rotation.y = bot.yaw;
    // Walk bob.
    bot.walkPhase += dt * 9;
    bot.group.position.y = Math.abs(Math.sin(bot.walkPhase)) * 0.03;
    // Unstuck recovery: if the bot tried to move but barely did for 1.2 s, it
    // is wedged on a corner — sidestep 2 m perpendicular and try again.
    const moved = Math.hypot(bot.position.x - bot.lastX, bot.position.z - bot.lastZ);
    if (moved < 0.05 && !bot.target && bot.holdT <= 0) {
      bot.stuckT += dt;
      if (bot.stuckT > 1.2) {
        bot.stuckT = 0;
        const side = random() < 0.5 ? -1 : 1;
        bot.investigate = bot.invVec.set(
          bot.position.x + Math.cos(bot.yaw) * side * 2,
          0,
          bot.position.z - Math.sin(bot.yaw) * side * 2,
        );
      }
    } else {
      bot.stuckT = 0;
    }
    bot.lastX = bot.position.x;
    bot.lastZ = bot.position.z;
  }

  // Build the squads once; reset() re-arms them every round.
  spawnBot('vanguard', 0, 'attackA', [-2, 15.5]);
  spawnBot('vanguard', 1, 'attackB', [0, 16.5]);
  spawnBot('vanguard', 2, 'attackMidA', [2, 15.5]);
  spawnBot('ember', 0, 'defendA', [-2, -15.5]);
  spawnBot('ember', 1, 'defendB', [0, -16.5]);
  spawnBot('ember', 2, 'defendMid', [2, -15.5]);
  spawnBot('ember', 3, 'defendA', [0, -14]);
  // Per-bot target list without the bot's own meshes, built once here instead
  // of filtering hitMeshes on every shot (see shootAt).
  for (const bot of bots) {
    bot.otherHitMeshes = hitMeshes.filter((m) => m.userData.bot !== bot);
  }

  return {
    bots,
    hitMeshes,
    reset,
    damage,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    nearestDefender(siteName) {
      const site = siteName === 'A' ? world.waypoints.aSite : world.waypoints.bSite;
      let best = null;
      let bestD = Infinity;
      for (const bot of bots) {
        if (bot.team !== 'ember' || !bot.alive) continue;
        const d = Math.hypot(site[0] - bot.position.x, site[1] - bot.position.z);
        if (d < bestD) {
          bestD = d;
          best = bot;
        }
      }
      return best;
    },
    step(dt, ctx) {
      hooks.playerPos = ctx.playerPos;
      hooks.playerCrouching = ctx.playerCrouching;
      for (const bot of bots) stepBot(bot, dt, ctx);
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.06) * 0.8;
        if (t.life <= 0) t.line.visible = false;
      }
    },
  };
}
