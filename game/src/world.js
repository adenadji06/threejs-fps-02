// The maps: two original arenas in one module, built from data tables so a new
// arena is a new table, not a new code path. "Foundry Yard" is the compact
// 40 x 36 m yard the game shipped with; "Ember Works" is a wider 44 x 32 m
// furnace hall with a glowing furnace at its heart, taller cover and longer
// lanes. Both share the palette, the buy economy and the bot route vocabulary
// (attackA / attackB / attackMidA / defendA / defendB / defendMid), so the bots,
// the plant logic and the screenshots all work on either map unchanged.
// Plain geometry, no models — the richness comes from procedural canvas
// textures (textures.js), instanced barrels, banners and dust, not from assets.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createTextures } from './textures.js';

// A box row: [width, height, depth, x, y, z, material]. Every box is a collider
// for movement and a surface a bullet stops on.
const FOUNDRY_BOXES = [
  // Floor and perimeter walls (40 x 36 m, 4.2 m high).
  [40.4, 0.4, 36.4, 0, -0.2, 0, 'floor'],
  [0.4, 4.2, 36.4, -20.2, 2.1, 0, 'wall'],
  [0.4, 4.2, 36.4, 20.2, 2.1, 0, 'wall'],
  [40.4, 4.2, 0.4, 0, 2.1, -18.2, 'wall'],
  [40.4, 4.2, 0.4, 0, 2.1, 18.2, 'wall'],
  // Mid container block: the sightline breaker. Bots route around it.
  [6, 3, 2.4, 0, 1.5, 0, 'crate'],
  [2.4, 2.2, 2.4, -6, 1.1, 0, 'crate'],
  [2.4, 2.2, 2.4, 6, 1.1, 0, 'crate'],
  [1.8, 1.4, 1.8, -3.5, 0.7, 5.5, 'crate'],
  [1.8, 1.4, 1.8, 3.5, 0.7, 5.5, 'crate'],
  [1.8, 1.4, 1.8, -3.5, 0.7, -5.5, 'crate'],
  [1.8, 1.4, 1.8, 3.5, 0.7, -5.5, 'crate'],
  // Step crates beside the mid crates: 0.7 m high, jumpable, so the 1.4 m
  // crates become a second sightline level instead of a wall.
  [1.2, 0.7, 1.2, -5.1, 0.35, 5.5, 'crate'],
  [1.2, 0.7, 1.2, 5.1, 0.35, 5.5, 'crate'],
  [1.2, 0.7, 1.2, -5.1, 0.35, -5.5, 'crate'],
  [1.2, 0.7, 1.2, 5.1, 0.35, -5.5, 'crate'],
  // Site A (Foundry): crates and a tall chimney pillar.
  [2.2, 1.2, 2.2, -15.5, 0.6, -13.5, 'crate'],
  [1.2, 2.4, 1.2, -11, 1.2, -13.5, 'crate'],
  [3, 1, 1.2, -13, 0.5, -8.5, 'crate'],
  [1.4, 6, 1.4, -17.5, 3, -15.5, 'wall'],
  // Site B (Depot): crates; the silo is a cylinder added below.
  [2.2, 1.2, 2.2, 15.5, 0.6, -13.5, 'crate'],
  [1.2, 2.4, 1.2, 11, 1.2, -13.5, 'crate'],
  [3, 1, 1.2, 13, 0.5, -8.5, 'crate'],
  // Lane cover: low walls on both long lanes, spawn cover both ends.
  [0.8, 2.6, 3, -16, 1.3, 4, 'crate'],
  [0.8, 2.6, 3, -16, 1.3, -4, 'crate'],
  [0.8, 2.6, 3, 16, 1.3, 4, 'crate'],
  [0.8, 2.6, 3, 16, 1.3, -4, 'crate'],
  [2.4, 1, 1.2, -4, 0.5, 14, 'crate'],
  [2.4, 1, 1.2, 4, 0.5, 14, 'crate'],
  [2.4, 1, 1.2, -4, 0.5, -14, 'crate'],
  [2.4, 1, 1.2, 4, 0.5, -14, 'crate'],
  [4, 1.6, 0.8, -8, 0.8, -6, 'crate'],
  [4, 1.6, 0.8, 8, 0.8, -6, 'crate'],
];

// Ember Works: 44 x 32 m. The furnace dominates the north half, so mid is a
// wide open kill-zone and the safe routes are the long west/east lanes.
const WORKS_BOXES = [
  [44.4, 0.4, 32.4, 0, -0.2, 0, 'floor'],
  [0.4, 4.2, 32.4, -22.2, 2.1, 0, 'wall'],
  [0.4, 4.2, 32.4, 22.2, 2.1, 0, 'wall'],
  [44.4, 4.2, 0.4, 0, 2.1, -16.2, 'wall'],
  [44.4, 4.2, 0.4, 0, 2.1, 16.2, 'wall'],
  // Furnace housing: two tall blocks flanking the furnace mouth at (0, -10).
  [2.4, 3.4, 2.4, -4.5, 1.7, -10, 'crate'],
  [2.4, 3.4, 2.4, 4.5, 1.7, -10, 'crate'],
  // Mid pillars and crates: the only hard cover in the open hall.
  [2.4, 2.2, 2.4, -6, 1.1, 2, 'crate'],
  [2.4, 2.2, 2.4, 6, 1.1, 2, 'crate'],
  [1.8, 1.4, 1.8, -3.5, 0.7, 6, 'crate'],
  [1.8, 1.4, 1.8, 3.5, 0.7, 6, 'crate'],
  [1.2, 0.7, 1.2, -5.1, 0.35, 6, 'crate'],
  [1.2, 0.7, 1.2, 5.1, 0.35, 6, 'crate'],
  [1.8, 1.4, 1.8, -3.5, 0.7, -4, 'crate'],
  [1.8, 1.4, 1.8, 3.5, 0.7, -4, 'crate'],
  // Site A (Furnace): crates and a tall chimney pillar.
  [2.2, 1.2, 2.2, -17.5, 0.6, -11.5, 'crate'],
  [1.2, 2.4, 1.2, -12, 1.2, -12, 'crate'],
  [3, 1, 1.2, -15, 0.5, -6.5, 'crate'],
  [1.4, 6, 1.4, -19.5, 3, -13.5, 'wall'],
  // Site B (Works): crates; the silo is a cylinder added below.
  [2.2, 1.2, 2.2, 17.5, 0.6, -11.5, 'crate'],
  [1.2, 2.4, 1.2, 12, 1.2, -12, 'crate'],
  [3, 1, 1.2, 15, 0.5, -6.5, 'crate'],
  // Lane cover: low walls on both long lanes, spawn cover both ends.
  [0.8, 2.6, 3, -19, 1.3, 3, 'crate'],
  [0.8, 2.6, 3, -19, 1.3, -3, 'crate'],
  [0.8, 2.6, 3, 19, 1.3, 3, 'crate'],
  [0.8, 2.6, 3, 19, 1.3, -3, 'crate'],
  [2.4, 1, 1.2, -4, 0.5, 12, 'crate'],
  [2.4, 1, 1.2, 4, 0.5, 12, 'crate'],
  [2.4, 1, 1.2, -4, 0.5, -12, 'crate'],
  [2.4, 1, 1.2, 4, 0.5, -12, 'crate'],
  [4, 1.6, 0.8, -8, 0.8, -5, 'crate'],
  [4, 1.6, 0.8, 8, 0.8, -5, 'crate'],
];

// Named waypoints the bots walk. Every point sits in open floor, never inside a box.
const FOUNDRY_WAYPOINTS = {
  atkSpawn: [0, 15],
  defSpawn: [0, -15],
  midBot: [0, 6.5],
  midWest: [-5, 0],
  midEast: [5, 0],
  midTop: [0, -4.5],
  midHold: [0, -7.5],
  aLane1: [-13, 8],
  aLane2: [-13, 0],
  aSite: [-13, -11],
  aHold: [-9.5, -8.5],
  bLane1: [13, 8],
  bLane2: [13, 0],
  bSite: [13, -11],
  bHold: [9.5, -8.5],
  defA: [-10, -14.5],
  defB: [10, -14.5],
  westCut: [-6.5, 3.5],
  eastCut: [6.5, 3.5],
};

const WORKS_WAYPOINTS = {
  atkSpawn: [0, 13],
  defSpawn: [0, -13],
  midBot: [0, 5],
  midWest: [-5, 0],
  midEast: [5, 0],
  midTop: [0, -4],
  midHold: [0, -7],
  aLane1: [-15, 6],
  aLane2: [-15, 0],
  aSite: [-15, -9],
  aHold: [-11, -7],
  bLane1: [15, 6],
  bLane2: [15, 0],
  bSite: [15, -9],
  bHold: [11, -7],
  defA: [-11, -12.5],
  defB: [11, -12.5],
  westCut: [-7, 3],
  eastCut: [7, 3],
};

// Routes are lists of waypoint names, walked in order. Attackers push a site;
// defenders patrol their site and mid. The same vocabulary serves both maps.
const ROUTES = {
  attackA: ['atkSpawn', 'aLane1', 'aLane2', 'aSite'],
  attackB: ['atkSpawn', 'bLane1', 'bLane2', 'bSite'],
  attackMidA: ['atkSpawn', 'midBot', 'midWest', 'midTop', 'aSite'],
  attackMidB: ['atkSpawn', 'midBot', 'midEast', 'midTop', 'bSite'],
  defendA: ['defA', 'aHold', 'aSite', 'aHold'],
  defendB: ['defB', 'bHold', 'bSite', 'bHold'],
  defendMid: ['defSpawn', 'midHold', 'midTop', 'midHold'],
};

// Barrel props: [x, z] pairs in open floor. One InstancedMesh per map, so 18
// barrels cost one draw call.
const FOUNDRY_BARRELS = [
  [-18.5, 8], [-18.5, -8], [18.5, 8], [18.5, -8], [-8, 16], [8, 16],
  [-8, -16], [8, -16], [-2, 12], [2, 12], [-19, 0], [19, 0],
  [-13, 12], [13, 12], [-9, -12], [9, -12], [-17, 12], [17, 12],
];
const WORKS_BARRELS = [
  [-20.5, 6], [-20.5, -6], [20.5, 6], [20.5, -6], [-8, 14], [8, 14],
  [-8, -14], [8, -14], [-2, 10], [2, 10], [-21, 0], [21, 0],
  [-15, 10], [15, 10], [-11, -12], [11, -12], [-18, 10], [18, 10],
];

export const MAPS = {
  foundry: {
    id: 'foundry',
    name: 'Foundry Yard',
    tagline: 'Compact yard — three lanes, mid container, close fights.',
    boxes: FOUNDRY_BOXES,
    waypoints: FOUNDRY_WAYPOINTS,
    routes: ROUTES,
    barrels: FOUNDRY_BARRELS,
    sites: {
      A: { name: 'Foundry', center: new THREE.Vector3(-13, 0, -11), radius: 3.4 },
      B: { name: 'Depot', center: new THREE.Vector3(13, 0, -11), radius: 3.4 },
    },
    spawns: {
      vanguard: [[-2, 15.5], [0, 16.5], [2, 15.5]],
      ember: [[-2, -15.5], [0, -16.5], [2, -15.5], [0, -14]],
    },
    playerSpawn: [0, 15.5],
    silo: [17.5, -15.5],
    furnace: null,
    fog: [26, 70],
    sky: PALETTE.canvas,
    sun: { color: '#ffb066', intensity: 3.2, pos: [14, 18, 10] },
    fill: { color: '#6a7a9a', intensity: 0.8, pos: [-10, 12, 12] },
    size: [40, 36],
  },
  works: {
    id: 'works',
    name: 'Ember Works',
    tagline: 'Wide furnace hall — long lanes, open mid, furnace glow.',
    boxes: WORKS_BOXES,
    waypoints: WORKS_WAYPOINTS,
    routes: ROUTES,
    barrels: WORKS_BARRELS,
    sites: {
      A: { name: 'Furnace', center: new THREE.Vector3(-15, 0, -9), radius: 3.4 },
      B: { name: 'Works', center: new THREE.Vector3(15, 0, -9), radius: 3.4 },
    },
    spawns: {
      vanguard: [[-2, 13.5], [0, 14.5], [2, 13.5]],
      ember: [[-2, -13.5], [0, -14.5], [2, -13.5], [0, -12]],
    },
    playerSpawn: [0, 13.5],
    silo: [19.5, -13.5],
    furnace: [0, -10],
    fog: [24, 64],
    sky: '#1b1e24',
    sun: { color: '#ff9a5c', intensity: 2.8, pos: [-12, 18, 8] },
    fill: { color: '#5a6a8a', intensity: 0.9, pos: [10, 12, 12] },
    size: [44, 32],
  },
};

export const MAP_LIST = [MAPS.foundry, MAPS.works];

export function createWorld(scene, mapId = 'foundry') {
  const def = MAPS[mapId] || MAPS.foundry;
  const tex = createTextures();
  const group = new THREE.Group();
  scene.add(group);

  const materials = {
    floor: new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: 0.95, metalness: 0.02 }),
    wall: new THREE.MeshStandardMaterial({ map: tex.wall, roughness: 0.9, metalness: 0.04 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.85, metalness: 0.05 }),
    surface: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.surface), roughness: 0.92, metalness: 0.03 }),
    hairline: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.92, metalness: 0.03 }),
  };
  const glowA = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.9, roughness: 0.6,
  });
  const glowB = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ally), emissive: new THREE.Color(PALETTE.ally),
    emissiveIntensity: 0.7, roughness: 0.6,
  });
  const hazardMat = new THREE.MeshStandardMaterial({ map: tex.hazard, roughness: 0.8, metalness: 0.05 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material] || materials.crate);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Visual-only marker: no collider, no bullet stop.
  function marker(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  for (const [w, h, d, x, y, z, mat] of def.boxes) box(w, h, d, x, y, z, mat);

  // Silo at Site B: a cylinder visual with a box collider, same as before.
  const [siloX, siloZ] = def.silo;
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5, 18), materials.wall);
  silo.position.set(siloX, 2.5, siloZ);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3(new THREE.Vector3(siloX - 1.6, 0, siloZ - 1.6), new THREE.Vector3(siloX + 1.6, 5, siloZ + 1.6)));
  shootables.push(silo);

  // The Works furnace: a squat cylinder with a glowing mouth and its own
  // point light, so the north half of the hall reads warm from spawn.
  let furnaceGlow = null;
  if (def.furnace) {
    const [fx, fz] = def.furnace;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 6, 20), materials.wall);
    body.position.set(fx, 3, fz);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    colliders.push(new THREE.Box3(new THREE.Vector3(fx - 2.6, 0, fz - 2.6), new THREE.Vector3(fx + 2.6, 6, fz + 2.6)));
    shootables.push(body);
    const mouth = new THREE.Mesh(
      new THREE.CircleGeometry(1.5, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) }),
    );
    mouth.position.set(fx, 1.1, fz + 2.62);
    group.add(mouth);
    furnaceGlow = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 20, 1.5);
    furnaceGlow.position.set(fx, 2.2, fz + 3.4);
    scene.add(furnaceGlow);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.55, depthWrite: false }));
    halo.position.set(fx, 1.6, fz + 3);
    halo.scale.setScalar(7);
    group.add(halo);
  }

  // Hazard stripes on the floor where each lane meets a site: the approach
  // reads as dangerous before a shot is fired.
  for (const key of Object.keys(def.sites)) {
    const site = def.sites[key];
    const mat = key === 'A' ? glowA : glowB;
    const cx = site.center.x;
    const cz = site.center.z;
    marker(5.4, 0.05, 0.3, cx, 0.03, cz - 3.2, mat);
    marker(5.4, 0.05, 0.3, cx, 0.03, cz + 3.2, mat);
    marker(0.3, 0.05, 6.4, cx - 2.7, 0.03, cz, mat);
    marker(0.3, 0.05, 6.4, cx + 2.7, 0.03, cz, mat);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.05, 0.5), hazardMat);
    stripe.position.set(cx, 0.03, cz + 4.4);
    stripe.receiveShadow = true;
    group.add(stripe);
  }

  // Hanging ember lamps over both sites.
  for (const [x, z, mat] of [[def.sites.A.center.x, def.sites.A.center.z, glowA], [def.sites.B.center.x, def.sites.B.center.z, glowB]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), mat);
    lamp.position.set(x, 3.9, z);
    group.add(lamp);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: new THREE.Color(mat.color), transparent: true, opacity: 0.4, depthWrite: false }));
    halo.position.set(x, 3.9, z);
    halo.scale.setScalar(2.2);
    group.add(halo);
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), materials.hairline);
    cord.position.set(x, 4.2, z);
    group.add(cord);
  }

  // Site banners on the north wall behind each site, and floating site
  // letters: a glance from anywhere in the arena says which site is which,
  // so the plant objective reads without the HUD.
  function siteLetter(letter, x, z, color) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'bold 96px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 68);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
    sprite.position.set(x, 4.8, z);
    sprite.scale.setScalar(2.4);
    group.add(sprite);
    return sprite;
  }
  siteLetter('A', def.sites.A.center.x, def.sites.A.center.z, PALETTE.accent);
  siteLetter('B', def.sites.B.center.x, def.sites.B.center.z, PALETTE.ally);
  const northZ = -def.size[1] / 2 + 0.25;
  for (const [letter, x, texture] of [['A', def.sites.A.center.x, tex.bannerA], ['B', def.sites.B.center.x, tex.bannerB]]) {
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.3, 2.6),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9, side: THREE.DoubleSide }),
    );
    banner.position.set(x, 2.1, northZ);
    group.add(banner);
  }

  // Barrels: one InstancedMesh for the whole map, one draw call. They are
  // props, not cover: no colliders, so a barrel never blocks a bot route.
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12);
  const barrelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#3a2c22'), roughness: 0.7, metalness: 0.35 });
  const barrels = new THREE.InstancedMesh(barrelGeo, barrelMat, def.barrels.length);
  const dummy = new THREE.Object3D();
  def.barrels.forEach(([x, z], i) => {
    dummy.position.set(x, 0.5, z);
    dummy.rotation.y = (i * 0.7) % Math.PI;
    dummy.updateMatrix();
    barrels.setMatrixAt(i, dummy.matrix);
  });
  barrels.castShadow = true;
  barrels.receiveShadow = true;
  group.add(barrels);

  // Pipes along the walls, above head height: visual only, they sell the
  // foundry without adding colliders the bots must route around.
  const pipeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#241d17'), roughness: 0.6, metalness: 0.5 });
  const [mapW, mapD] = def.size;
  for (const x of [-mapW / 2 + 0.35, mapW / 2 - 0.35]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, mapD - 2, 8), pipeMat);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(x, 3.7, 0);
    group.add(pipe);
  }
  const pipeN = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, mapW - 2, 8), pipeMat);
  pipeN.rotation.z = Math.PI / 2;
  pipeN.position.set(0, 3.7, -mapD / 2 + 0.35);
  group.add(pipeN);

  // Drifting ember dust: one Points cloud, ~140 motes, no per-frame
  // allocation — the whole cloud bobs slowly in step().
  const dustCount = 140;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i += 1) {
    dustPos[i * 3] = (Math.random() * 2 - 1) * (mapW / 2 - 1);
    dustPos[i * 3 + 1] = 0.4 + Math.random() * 4.2;
    dustPos[i * 3 + 2] = (Math.random() * 2 - 1) * (mapD / 2 - 1);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    map: tex.glow, color: new THREE.Color('#ffb066'), size: 0.09,
    transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  group.add(dust);

  // Light: a low dusk sun, a cool sky fill, and an ember glow over each site.
  scene.fog = new THREE.Fog(new THREE.Color(def.sky), def.fog[0], def.fog[1]);
  scene.background = new THREE.Color(def.sky);
  const sky = new THREE.HemisphereLight(new THREE.Color('#a08a70'), new THREE.Color(def.sky), 1.5);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color(def.sun.color), def.sun.intensity);
  sun.position.set(...def.sun.pos);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  // One shadow light, 1024^2 PCF: the whole shadow budget. 2048^2 cost the
  // same image at twice the GPU time in peak combat.
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(def.fill.color), def.fill.intensity);
  fill.position.set(...def.fill.pos);
  scene.add(fill);
  const emberA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 14, 1.6);
  emberA.position.set(def.sites.A.center.x, 3.4, def.sites.A.center.z);
  scene.add(emberA);
  const emberB = new THREE.PointLight(new THREE.Color(PALETTE.ally), 10, 12, 1.6);
  emberB.position.set(def.sites.B.center.x, 3.4, def.sites.B.center.z);
  scene.add(emberB);

  return {
    mapId: def.id,
    name: def.name,
    tagline: def.tagline,
    sites: def.sites,
    waypoints: def.waypoints,
    routes: def.routes,
    spawns: def.spawns,
    playerSpawn: def.playerSpawn,
    colliders,
    shootables,
    group,
    // Slow ambient motion only: the dust cloud bobs, the furnace light
    // breathes. Nothing here allocates or touches the simulation.
    step(dt, elapsed) {
      dust.position.y = Math.sin(elapsed * 0.13) * 0.35;
      if (furnaceGlow) furnaceGlow.intensity = 28 + Math.sin(elapsed * 1.7) * 4;
    },
  };
}
