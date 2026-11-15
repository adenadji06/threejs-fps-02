// The arsenal: four guns and one grenade, with the numbers that make stopping to
// aim pay — spread grows with movement speed and with each shot, recoil kicks the
// view, and the sniper only earns its damage when aimed down sights. The caller
// (main.js) owns money and the ray; this module owns the view model, the magazine,
// the reload and the thrown grenade's flight.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { sfx } from './audio.js';

export const WEAPONS = {
  // bloom: extra spread added per consecutive shot (decays when not firing);
  // the crosshair opens as the burst runs long, so burst control is visible.
  kestrel: { name: 'Kestrel P9', kind: 'pistol', price: 0, damage: 26, headMult: 3.5, mag: 12, reserveMax: 48, fireGap: 0.16, auto: false, reloadTime: 1.4, spreadStill: 0.003, spreadMove: 0.02, recoil: 0.008, bloom: 0.004, zoom: 1, barrel: 0.22 },
  hornet: { name: 'Hornet SMG', kind: 'smg', price: 900, damage: 22, headMult: 3, mag: 24, reserveMax: 96, fireGap: 0.085, auto: true, reloadTime: 1.8, spreadStill: 0.006, spreadMove: 0.032, recoil: 0.006, bloom: 0.005, zoom: 1, barrel: 0.3 },
  longbow: { name: 'Longbow Rifle', kind: 'rifle', price: 2400, damage: 34, headMult: 3, mag: 30, reserveMax: 90, fireGap: 0.096, auto: true, reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.01, bloom: 0.004, zoom: 1, barrel: 0.42 },
  needle: { name: 'Needle DMR', kind: 'sniper', price: 3600, damage: 88, headMult: 2.2, mag: 5, reserveMax: 20, fireGap: 1.1, auto: false, reloadTime: 2.6, spreadStill: 0.0008, spreadMove: 0.05, recoil: 0.03, bloom: 0.012, zoom: 2.2, barrel: 0.55 },
  // Raptor-12: a pump shotgun. Eight pellets per trigger pull, devastating
  // inside 8 m, useless past 20 m — the close-corner gun. pellets: 8 is read
  // by main.js, which fires one ray per pellet through the same spread cone.
  raptor: { name: 'Raptor-12', kind: 'shotgun', price: 1500, damage: 13, pellets: 8, headMult: 2, mag: 6, reserveMax: 30, fireGap: 0.95, auto: false, reloadTime: 2.4, spreadStill: 0.012, spreadMove: 0.045, recoil: 0.028, bloom: 0.014, zoom: 1, barrel: 0.5 },
  // Viper Repeater: a lever-action marksman rifle. One hard hit per pull
  // (46 damage, 3.2x headshot), a fast follow-up, an 8-round tube — the
  // mid-range duellist between the Longbow's spray and the Needle's one-shot.
  viper: { name: 'Viper Repeater', kind: 'repeater', price: 1900, damage: 46, headMult: 3.2, mag: 8, reserveMax: 32, fireGap: 0.34, auto: false, reloadTime: 2.2, spreadStill: 0.0016, spreadMove: 0.04, recoil: 0.018, bloom: 0.008, zoom: 1.5, barrel: 0.5 },
  // Mauler LMG: 75 rounds of sustained fire, the wall of lead for holding a
  // lane. The price is the slow reload (3.4 s), the heavy recoil and the
  // movement penalty — it rewards a planted position, not a sprint.
  mauler: { name: 'Mauler LMG', kind: 'lmg', price: 3200, damage: 26, headMult: 2.5, mag: 75, reserveMax: 150, fireGap: 0.105, auto: true, reloadTime: 3.4, spreadStill: 0.008, spreadMove: 0.04, recoil: 0.011, bloom: 0.006, zoom: 1.15, barrel: 0.5 },
};
export const GRENADE = { name: 'Ember HE', price: 300, max: 2, damage: 95, radius: 6, fuse: 1.15 };
// Buy order is price order, so the menu reads as a ladder: cheap SMG, then the
// close-range and mid-range specialists, then the heavy guns.
export const BUY_ORDER = ['hornet', 'raptor', 'viper', 'longbow', 'mauler', 'needle'];

const GRAVITY = 14;

export function createArsenal(camera, colliders) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b2b30'), roughness: 0.45, metalness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#101010'), roughness: 0.4, metalness: 0.5 });

  const model = new THREE.Group();
  model.position.set(0.27, -0.24, -0.55);
  model.scale.setScalar(0.85);
  model.rotation.y = -0.05;
  camera.add(model);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.27, -0.22, -1.05);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.27, -0.2, -0.75);
  camera.add(flashLight);

  // One reusable tracer pool: 8 lines, no allocation in the hot loop.
  const tracers = [];
  for (let i = 0; i < 8; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }));
    line.visible = false;
    line.frustumCulled = false;
    camera.parent.add(line);
    tracers.push({ line, life: 0 });
  }
  let tracerCursor = 0;
  const muzzle = new THREE.Vector3();
  const tracerFrom = new THREE.Vector3();
  const tracerTo = new THREE.Vector3();

  const owned = {
    kestrel: { mag: WEAPONS.kestrel.mag, reserve: WEAPONS.kestrel.reserveMax },
  };
  let primaryId = null; // bought primary, or null while the pistol is the only gun
  let slot = 'pistol'; // 'primary' | 'pistol' | 'grenade'
  let grenades = 1; // every attacker spawns with one Ember HE
  const state = { cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, switching: 0, bloom: 0, burst: 0, shotGapT: 99, bobPhase: 0 };
  // Learnable recoil: a fixed left/right pattern per consecutive shot, so the
  // player can pull against it instead of fighting pure randomness. The pitch
  // kick stays in the player's recoil pool (player.js recovers it after a pause).
  const RECOIL_PATTERN = [-0.004, 0.005, -0.003, 0.006, -0.005, 0.004, -0.002, 0.003];
  const BLOOM_MAX = 0.03;

  // One reusable impact-spark pool: 12 tetrahedra, no allocation per shot.
  // Sparks fly from the hit point and shrink away; the pool recycles the oldest.
  const sparkGeo = new THREE.TetrahedronGeometry(0.035);
  const sparkMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });
  const sparks = [];
  for (let i = 0; i < 12; i += 1) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.visible = false;
    camera.parent.add(mesh);
    sparks.push({ mesh, vel: new THREE.Vector3(), life: 0 });
  }
  let sparkCursor = 0;
  const sparkDir = new THREE.Vector3();

  const grenadeMeshes = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.4, metalness: 0.4, emissive: new THREE.Color(PALETTE.accent), emissiveIntensity: 0.5 });
  const liveGrenades = []; // { mesh, vel, fuse }
  const probe = new THREE.Box3();

  function buildModel(def) {
    while (model.children.length) {
      const child = model.children.pop();
      child.geometry.dispose();
    }
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34 + def.barrel * 0.3), body);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.2 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.28);
    model.add(receiver, barrel, stock);
    if (def.kind === 'sniper') {
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.16, 10), dark);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.09, -0.05);
      model.add(scope);
    }
    if (def.kind === 'smg') {
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark);
      mag.position.set(0, -0.12, 0.02);
      model.add(mag);
    }
    if (def.kind === 'shotgun') {
      // Wide twin barrels and a pump grip under them: the silhouette says
      // "close-range" before the first shot.
      const barrel2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, def.barrel), grip);
      barrel2.position.set(0.045, 0.025, -0.2 - def.barrel / 2);
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.14), dark);
      pump.position.set(0, -0.03, -0.28);
      model.add(barrel2, pump);
    }
    if (def.kind === 'lmg') {
      // A drum box under the receiver and a carry handle on top: the gun
      // looks like it holds 75 rounds because it does.
      const drum = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.12), dark);
      drum.position.set(0, -0.11, 0.02);
      const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.24), grip);
      handle.position.set(0, 0.075, -0.02);
      model.add(drum, handle);
    }
    if (def.kind === 'repeater') {
      // A lever loop under the receiver and a long slim barrel: the classic
      // marksman silhouette, distinct from the Needle's scope.
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.02), dark);
      lever.position.set(0, -0.1, 0.1);
      const loop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), dark);
      loop.position.set(0, -0.14, 0.1);
      model.add(lever, loop);
    }
  }

  function currentDef() {
    if (slot === 'grenade') return null;
    return WEAPONS[slot === 'primary' && primaryId ? primaryId : 'kestrel'];
  }

  function currentState() {
    if (slot === 'grenade') return null;
    return owned[slot === 'primary' && primaryId ? primaryId : 'kestrel'];
  }

  function switchTo(next) {
    if (next === 'primary' && !primaryId) next = 'pistol';
    if (next === 'grenade' && grenades <= 0) return false;
    if (next === slot) return false;
    slot = next;
    state.reloadLeft = 0;
    state.cooldown = Math.max(state.cooldown, 0.18);
    state.switching = 0.25;
    const def = currentDef();
    if (def) buildModel(def);
    model.visible = true;
    return true;
  }

  function step(dt, speed = 0, ads = false) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.switching = Math.max(0, state.switching - dt);
    state.shotGapT += dt;
    // Bloom decays once the trigger is released; a burst longer than ~0.35 s
    // without a pause keeps growing, so tap-fire stays accurate.
    if (state.shotGapT > 0.12) state.bloom = Math.max(0, state.bloom - dt * 0.045);
    if (state.shotGapT > 0.35) state.burst = 0;
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    // Walk bob + ADS centering: the view model bobs with the stride on the move
    // and slides to the centre of the screen while aiming down sights.
    state.bobPhase += dt * Math.min(10, 2 + speed * 1.6);
    const bobAmp = Math.min(1, speed / 5.2) * 0.011 * (ads ? 0.25 : 1);
    const adsK = ads ? Math.min(1, (state.adsK ?? 0) + dt * 9) : Math.max(0, (state.adsK ?? 0) - dt * 9);
    state.adsK = adsK;
    model.position.z = -0.55 + state.kick + adsK * 0.08;
    model.position.y = -0.24 - state.switching * 0.12 + Math.sin(state.bobPhase * 2) * bobAmp + adsK * 0.055;
    model.position.x = 0.27 * (1 - adsK) + Math.cos(state.bobPhase) * bobAmp * 0.6;
    model.rotation.x = state.kick * 2.2;
    if (slot === 'grenade') model.visible = false;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    const def = currentDef();
    const inst = currentState();
    if (def && inst && state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - inst.mag;
        const take = Math.min(need, inst.reserve);
        inst.mag += take;
        inst.reserve -= take;
      }
    }
    for (const tracer of tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / 0.07);
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    for (const s of sparks) {
      if (s.life <= 0) continue;
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      const k = Math.max(0.001, s.life / 0.25);
      s.mesh.scale.setScalar(k);
      if (s.life <= 0) s.mesh.visible = false;
    }
  }

  function throwGrenade(origin, direction) {
    if (grenades <= 0) return false;
    grenades -= 1;
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(origin);
    camera.parent.add(mesh);
    grenadeMeshes.push(mesh);
    liveGrenades.push({
      mesh,
      vel: new THREE.Vector3(direction.x * 13, direction.y * 13 + 4.5, direction.z * 13),
      fuse: GRENADE.fuse,
    });
    sfx.grenade();
    if (grenades === 0 && slot === 'grenade') switchTo(primaryId ? 'primary' : 'pistol');
    return true;
  }

  const _explodeCenter = new THREE.Vector3();
  function explode(index, onDamage) {
    const g = liveGrenades[index];
    _explodeCenter.copy(g.mesh.position);
    camera.parent.remove(g.mesh);
    liveGrenades.splice(index, 1);
    sfx.explosion();
    const flashMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 12, 8),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 }),
    );
    flashMesh.position.copy(_explodeCenter);
    camera.parent.add(flashMesh);
    grenadeMeshes.push(flashMesh);
    setTimeout(() => {
      camera.parent.remove(flashMesh);
      flashMesh.geometry.dispose();
      flashMesh.material.dispose();
    }, 180);
    onDamage(_explodeCenter, GRENADE.damage, GRENADE.radius);
  }

  function stepGrenades(dt, onDamage) {
    for (let i = liveGrenades.length - 1; i >= 0; i -= 1) {
      const g = liveGrenades[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      const p = g.mesh.position;
      const nx = p.x + g.vel.x * dt;
      const ny = p.y + g.vel.y * dt;
      const nz = p.z + g.vel.z * dt;
      probe.min.set(nx - 0.09, ny - 0.09, nz - 0.09);
      probe.max.set(nx + 0.09, ny + 0.09, nz + 0.09);
      let hit = false;
      for (const c of colliders) {
        if (probe.intersectsBox(c)) { hit = true; break; }
      }
      if (hit) {
        // Simple bounce: damp the velocity and keep the grenade where it was.
        g.vel.multiplyScalar(-0.35);
        g.vel.y = Math.abs(g.vel.y) * 0.4 + 1;
      } else {
        p.set(nx, ny, nz);
        if (p.y < 0.09) {
          p.y = 0.09;
          g.vel.y = Math.abs(g.vel.y) * 0.4;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
      }
      if (g.fuse <= 0) explode(i, onDamage);
    }
  }

  buildModel(WEAPONS.kestrel);

  return {
    state,
    owned,
    get slot() { return slot; },
    get grenades() { return grenades; },
    get primaryId() { return primaryId; },
    def: currentDef,
    inst: currentState,
    ready() {
      const def = currentDef();
      const inst = currentState();
      return !!def && !!inst && inst.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switching === 0;
    },
    pullTrigger() {
      const def = currentDef();
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.shotGapT = 0;
      state.burst += 1;
      state.bloom = Math.min(BLOOM_MAX, state.bloom + def.bloom);
    },
    takeRound() {
      const inst = currentState();
      if (!inst || inst.mag <= 0) return false;
      inst.mag -= 1;
      return true;
    },
    reload() {
      const def = currentDef();
      const inst = currentState();
      if (!def || !inst || state.reloadLeft > 0 || inst.mag === def.mag || inst.reserve === 0) return;
      state.reloadLeft = def.reloadTime;
      sfx.reload();
    },
    spread(speed, ads) {
      const def = currentDef();
      if (!def) return 0;
      const base = def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove + state.bloom;
      return ads ? base * 0.45 : base;
    },
    recoil() {
      const def = currentDef();
      return def ? def.recoil : 0.008;
    },
    // Deterministic yaw kick for this shot in the burst: the pattern repeats
    // every 8 shots, so the player learns to pull against it.
    recoilYaw() {
      const def = currentDef();
      if (!def) return 0;
      return RECOIL_PATTERN[state.burst % RECOIL_PATTERN.length] * (def.recoil / 0.01);
    },
    // Burst of impact sparks at a hit point: 4 pooled tetrahedra, no allocation.
    impact(point) {
      for (let n = 0; n < 4; n += 1) {
        const s = sparks[sparkCursor];
        sparkCursor = (sparkCursor + 1) % sparks.length;
        s.mesh.position.copy(point);
        sparkDir.set(Math.random() * 2 - 1, Math.random() * 1.2, Math.random() * 2 - 1).normalize();
        s.vel.copy(sparkDir).multiplyScalar(2.5 + Math.random() * 2.5);
        s.life = 0.25;
        s.mesh.scale.setScalar(1);
        s.mesh.visible = true;
      }
    },
    zoom() {
      const def = currentDef();
      return def ? def.zoom : 1;
    },
    switchTo,
    buy(id) {
      if (!WEAPONS[id] || id === 'kestrel') return false;
      if (owned[id]) return false;
      owned[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserveMax };
      primaryId = id;
      switchTo('primary');
      sfx.buy();
      return true;
    },
    buyGrenade() {
      if (grenades >= GRENADE.max) return false;
      grenades += 1;
      sfx.buy();
      return true;
    },
    refill() {
      for (const id of Object.keys(owned)) {
        owned[id].mag = WEAPONS[id].mag;
        owned[id].reserve = WEAPONS[id].reserveMax;
      }
      grenades = 1;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.bloom = 0;
      state.burst = 0;
      state.shotGapT = 99;
      slot = primaryId ? 'primary' : 'pistol';
      const def = currentDef();
      if (def) buildModel(def);
      model.visible = true;
    },
    resetLoadout() {
      for (const id of Object.keys(owned)) delete owned[id];
      owned.kestrel = { mag: WEAPONS.kestrel.mag, reserve: WEAPONS.kestrel.reserveMax };
      primaryId = null;
      grenades = 1;
      this.refill();
    },
    throwGrenade,
    step,
    stepGrenades,
    tracer(from, to) {
      const t = tracers[tracerCursor];
      tracerCursor = (tracerCursor + 1) % tracers.length;
      const pos = t.line.geometry.attributes.position;
      tracerFrom.copy(from);
      tracerTo.copy(to);
      // Tracers live in world space; the line is a child of the scene root.
      pos.setXYZ(0, tracerFrom.x, tracerFrom.y, tracerFrom.z);
      pos.setXYZ(1, tracerTo.x, tracerTo.y, tracerTo.z);
      pos.needsUpdate = true;
      t.line.visible = true;
      t.life = 0.07;
    },
    muzzleWorld(out) {
      camera.getWorldPosition(muzzle);
      camera.getWorldDirection(out);
      muzzle.addScaledVector(out, 0.9);
      out.copy(muzzle);
      return out;
    },
  };
}
