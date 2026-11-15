// The map: "Foundry Yard", an original 40 x 36 m dusk industrial yard. Two bomb
// sites (A Foundry, B Depot), a west lane, an east lane and a mid lane through a
// container block, with crates and walls that make corners and sightlines. Every
// box is a collider for movement and a surface a bullet stops on; the site floor
// strips and lamps are visual only. Plain geometry, no models or textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const SITES = {
  A: { name: 'Foundry', center: new THREE.Vector3(-13, 0, -11), radius: 3.4 },
  B: { name: 'Depot', center: new THREE.Vector3(13, 0, -11), radius: 3.4 },
};

// Named waypoints the bots walk. Every point sits in open floor, never inside a box.
export const WAYPOINTS = {
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

// Routes are lists of waypoint names, walked in order. Attackers push a site;
// defenders patrol their site and mid.
export const ROUTES = {
  attackA: ['atkSpawn', 'aLane1', 'aLane2', 'aSite'],
  attackB: ['atkSpawn', 'bLane1', 'bLane2', 'bSite'],
  attackMidA: ['atkSpawn', 'midBot', 'midWest', 'midTop', 'aSite'],
  attackMidB: ['atkSpawn', 'midBot', 'midEast', 'midTop', 'bSite'],
  defendA: ['defA', 'aHold', 'aSite', 'aHold'],
  defendB: ['defB', 'bHold', 'bSite', 'bHold'],
  defendMid: ['defSpawn', 'midHold', 'midTop', 'midHold'],
};

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.55 : 0.92,
      metalness: name === 'ink' ? 0.05 : 0.03,
    });
  }
  const glowA = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.accent), emissive: new THREE.Color(PALETTE.accent),
    emissiveIntensity: 0.9, roughness: 0.6,
  });
  const glowB = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.ally), emissive: new THREE.Color(PALETTE.ally),
    emissiveIntensity: 0.7, roughness: 0.6,
  });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
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

  // Floor and perimeter walls (40 x 36 m, 4.2 m high).
  box(40.4, 0.4, 36.4, 0, -0.2, 0, 'surface');
  box(0.4, 4.2, 36.4, -20.2, 2.1, 0, 'surface');
  box(0.4, 4.2, 36.4, 20.2, 2.1, 0, 'surface');
  box(40.4, 4.2, 0.4, 0, 2.1, -18.2, 'surface');
  box(40.4, 4.2, 0.4, 0, 2.1, 18.2, 'surface');

  // Mid container block: the sightline breaker. Bots route around it.
  box(6, 3, 2.4, 0, 1.5, 0, 'hairline');
  box(2.4, 2.2, 2.4, -6, 1.1, 0, 'hairline');
  box(2.4, 2.2, 2.4, 6, 1.1, 0, 'hairline');
  box(1.8, 1.4, 1.8, -3.5, 0.7, 5.5, 'hairline');
  box(1.8, 1.4, 1.8, 3.5, 0.7, 5.5, 'hairline');
  box(1.8, 1.4, 1.8, -3.5, 0.7, -5.5, 'hairline');
  box(1.8, 1.4, 1.8, 3.5, 0.7, -5.5, 'hairline');
  // Step crates beside the mid crates: 0.7 m high, jumpable, so the 1.4 m
  // crates become a second sightline level instead of a wall.
  box(1.2, 0.7, 1.2, -5.1, 0.35, 5.5, 'hairline');
  box(1.2, 0.7, 1.2, 5.1, 0.35, 5.5, 'hairline');
  box(1.2, 0.7, 1.2, -5.1, 0.35, -5.5, 'hairline');
  box(1.2, 0.7, 1.2, 5.1, 0.35, -5.5, 'hairline');

  // Site A (Foundry): crates and a tall chimney pillar.
  box(2.2, 1.2, 2.2, -15.5, 0.6, -13.5, 'hairline');
  box(1.2, 2.4, 1.2, -11, 1.2, -13.5, 'hairline');
  box(3, 1, 1.2, -13, 0.5, -8.5, 'hairline');
  box(1.4, 6, 1.4, -17.5, 3, -15.5, 'surface');
  // Site B (Depot): crates and a silo (cylinder visual, box collider).
  box(2.2, 1.2, 2.2, 15.5, 0.6, -13.5, 'hairline');
  box(1.2, 2.4, 1.2, 11, 1.2, -13.5, 'hairline');
  box(3, 1, 1.2, 13, 0.5, -8.5, 'hairline');
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 5, 18), materials.surface);
  silo.position.set(17.5, 2.5, -15.5);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3(new THREE.Vector3(15.9, 0, -17.1), new THREE.Vector3(19.1, 5, -13.9)));
  shootables.push(silo);

  // Lane cover: low walls on both long lanes, spawn cover both ends.
  box(0.8, 2.6, 3, -16, 1.3, 4, 'hairline');
  box(0.8, 2.6, 3, -16, 1.3, -4, 'hairline');
  box(0.8, 2.6, 3, 16, 1.3, 4, 'hairline');
  box(0.8, 2.6, 3, 16, 1.3, -4, 'hairline');
  box(2.4, 1, 1.2, -4, 0.5, 14, 'hairline');
  box(2.4, 1, 1.2, 4, 0.5, 14, 'hairline');
  box(2.4, 1, 1.2, -4, 0.5, -14, 'hairline');
  box(2.4, 1, 1.2, 4, 0.5, -14, 'hairline');
  box(4, 1.6, 0.8, -8, 0.8, -6, 'hairline');
  box(4, 1.6, 0.8, 8, 0.8, -6, 'hairline');

  // Site floor strips: glowing frames that say "plant here".
  marker(5.4, 0.05, 0.3, -13, 0.03, -14.2, glowA);
  marker(5.4, 0.05, 0.3, -13, 0.03, -7.8, glowA);
  marker(0.3, 0.05, 6.4, -15.7, 0.03, -11, glowA);
  marker(0.3, 0.05, 6.4, -10.3, 0.03, -11, glowA);
  marker(5.4, 0.05, 0.3, 13, 0.03, -14.2, glowB);
  marker(5.4, 0.05, 0.3, 13, 0.03, -7.8, glowB);
  marker(0.3, 0.05, 6.4, 10.3, 0.03, -11, glowB);
  marker(0.3, 0.05, 6.4, 15.7, 0.03, -11, glowB);

  // Hanging ember lamps over both sites.
  for (const [x, z, mat] of [[-13, -11, glowA], [13, -11, glowB]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8), mat);
    lamp.position.set(x, 3.9, z);
    group.add(lamp);
    const cord = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 0.04), materials.hairline);
    cord.position.set(x, 4.2, z);
    group.add(cord);
  }

  // Floating site letters: a glance from anywhere in the yard says which
  // site is which, so the plant objective reads without the HUD.
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
  siteLetter('A', -13, -11, PALETTE.accent);
  siteLetter('B', 13, -11, PALETTE.ally);

  // Light: a low dusk sun, a cool sky fill, and an ember glow over each site.
  const sky = new THREE.HemisphereLight(new THREE.Color('#a08a70'), new THREE.Color(PALETTE.canvas), 1.5);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 3.2);
  sun.position.set(14, 18, 10);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  // One shadow light, 1024^2 PCF: the whole shadow budget. 2048^2 cost the
  // same image at twice the GPU time in peak combat.
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#6a7a9a'), 0.8);
  fill.position.set(-10, 12, 12);
  scene.add(fill);
  const emberA = new THREE.PointLight(new THREE.Color(PALETTE.accent), 14, 14, 1.6);
  emberA.position.set(-13, 3.4, -11);
  scene.add(emberA);
  const emberB = new THREE.PointLight(new THREE.Color(PALETTE.ally), 10, 12, 1.6);
  emberB.position.set(13, 3.4, -11);
  scene.add(emberB);

  return { colliders, shootables, group };
}
