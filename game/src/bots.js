// The bots: three Vanguard allies and four Ember defenders, all driven by one
// state machine. They walk waypoint routes, hold their site, scan for enemies
// with a line-of-sight ray, fire aimed bursts, investigate gunfire they hear, and
// the nearest living defender walks in to defuse a planted charge. One shared
// raycaster and a handful of reused vectors: no allocation in the hot loop.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS as WP, ROUTES as RT } from './world.js';
import { sfx } from './audio.js';

const BOT_NAMES = {
  vanguard: ['Vex', 'Halo', 'Rook'],
  ember: ['Ash', 'Cinder', 'Flint', 'Soot'],
};
const BOT_HEALTH = 100;
const WALK_SPEED = 3.4;
const RUSH_SPEED = 4.4;
const EYE_HEIGHT = 1.55;
const THINK_EVERY = 0.15;
const FIRE_RANGE = 42;
const FOV_COS = 0.25; // cos(~75 deg): a bot sees a 150-degree cone
const DEFUSE_TIME = 5;

const _eye = new THREE.Vector3();
const _to = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _move = new THREE.Vector3();

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
    group.add(torso, head, legL, legR, gun, flash);
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
      group,
      torso,
      head,
      flash,
      position: group.position,
      yaw: team === 'vanguard' ? Math.PI : 0,
      health: BOT_HEALTH,
      alive: true,
      routeName,
      routeIndex: 0,
      holdT: 0,
      target: null, // { kind: 'player' | 'bot', ref, pos }
      aimTime: 0,
      thinkT: random() * THINK_EVERY,
      fireT: 0,
      burstLeft: 0,
      burstPause: 0,
      strafeDir: 1,
      strafeT: 0,
      investigate: null, // Vector3 or null
      lookT: 0,
      defusing: false,
      fall: 0,
      walkPhase: random() * 6,
      speed: WALK_SPEED,
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
    const vSpawn = [[-2, 15.5], [0, 16.5], [2, 15.5]];
    const eSpawn = [[-2, -15.5], [0, -16.5], [2, -15.5], [0, -14]];
    let vi = 0;
    let ei = 0;
    for (const bot of bots) {
      const spawn = bot.team === 'vanguard' ? vSpawn[vi++] : eSpawn[ei++];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.yaw = bot.team === 'vanguard' ? Math.PI : 0;
      bot.health = BOT_HEALTH;
      bot.alive = true;
      bot.target = null;
      bot.aimTime = 0;
      bot.fireT = 0;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.investigate = null;
      bot.defusing = false;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.y = 0;
      bot.group.visible = true;
    }
    assignRoutes(round);
  }

  function routePoint(bot) {
    const route = RT[bot.routeName];
    const name = route[Math.min(bot.routeIndex, route.length - 1)];
    const p = WP[name];
    return p;
  }

  function advanceRoute(bot) {
    const route = RT[bot.routeName];
    if (bot.routeIndex < route.length - 1) bot.routeIndex += 1;
    else {
      // At the end of the route: hold the position, then patrol back one step.
      bot.holdT = 2 + random() * 2;
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
    if (dist > FIRE_RANGE) return 0;
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
  }

  function targetPoint(bot, out) {
    if (bot.target.kind === 'player') {
      out.set(hooks.playerPos.x, hooks.playerPos.y + 1.3, hooks.playerPos.z);
    } else {
      out.set(bot.target.ref.position.x, bot.target.ref.position.y + 1.3, bot.target.ref.position.z);
    }
    return out;
  }

  function shootAt(bot, dt) {
    if (!bot.target) return;
    bot.aimTime += dt;
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      bot.burstPause = 0;
    }
    bot.fireT -= dt;
    if (bot.fireT > 0) return;
    bot.fireT = bot.team === 'ember' ? 0.14 : 0.13;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) bot.burstPause = 0.7 + random() * 0.7;

    const dist = bot.target.dist;
    // Aim error shrinks the longer the bot has held the target, grows with range.
    const error = Math.max(0.008, 0.028 + dist * 0.0009 - bot.aimTime * 0.012);
    _eye.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    targetPoint(bot, _aim);
    _aim.x += (random() * 2 - 1) * error * dist;
    _aim.y += (random() * 2 - 1) * error * dist * 0.6;
    _aim.z += (random() * 2 - 1) * error * dist;
    _dir.copy(_aim).sub(_eye).normalize();
    raycaster.set(_eye, _dir);
    raycaster.far = 70;
    // The shooter's own meshes are in hitMeshes: leave them out, or every shot
    // would hit the bot's own head at the ray's origin.
    const targets = world.shootables.concat(hitMeshes.filter((m) => m.userData.bot !== bot));
    const hit = raycaster.intersectObjects(targets, false)[0];
    // Tracer from the bot's gun to the hit point (or 40 m out).
    const end = hit ? hit.point : _eye.clone().addScaledVector(_dir, 40);
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
      const dmg = Math.round(26 * (head ? 3 : 1) * Math.max(0.5, 1 - dist / 90));
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
          const dmg = Math.round(26 * Math.max(0.5, 1 - dist / 90));
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
      // Hear the player's gunfire: investigate the noise.
      if (ctx.playerFiring && ctx.playerAlive && !bot.target) {
        const d = Math.hypot(ctx.playerPos.x - bot.position.x, ctx.playerPos.z - bot.position.z);
        if (d < 28 && !bot.investigate) {
          bot.investigate = new THREE.Vector3(ctx.playerPos.x, 0, ctx.playerPos.z);
        }
      }
    }

    // Defuse duty: the nearest living defender walks to a planted charge.
    const state = hooks.state;
    if (state.phase === 'planted' && bot.team === 'ember' && state.defuser === bot) {
      const site = state.site === 'A' ? WP.aSite : WP.bSite;
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
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeT = 0.8 + random() * 0.8;
        bot.strafeDir = random() < 0.5 ? -1 : 1;
      }
      const side = bot.strafeDir;
      const tx = bot.position.x + Math.cos(bot.yaw) * side * 1.2;
      const tz = bot.position.z - Math.sin(bot.yaw) * side * 1.2;
      moveToward(bot, tx, tz, dt, 1.6);
      shootAt(bot, dt);
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
  }

  // Build the squads once; reset() re-arms them every round.
  spawnBot('vanguard', 0, 'attackA', [-2, 15.5]);
  spawnBot('vanguard', 1, 'attackB', [0, 16.5]);
  spawnBot('vanguard', 2, 'attackMidA', [2, 15.5]);
  spawnBot('ember', 0, 'defendA', [-2, -15.5]);
  spawnBot('ember', 1, 'defendB', [0, -16.5]);
  spawnBot('ember', 2, 'defendMid', [2, -15.5]);
  spawnBot('ember', 3, 'defendA', [0, -14]);

  return {
    bots,
    hitMeshes,
    reset,
    damage,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    nearestDefender(siteName) {
      const site = siteName === 'A' ? WP.aSite : WP.bSite;
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
