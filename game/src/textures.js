// Procedural textures: every surface in EMBERLINE is drawn on a canvas at load,
// so the game ships no image files and makes no network request. Textures are
// built once and cached — a second map reuses the same set. The look stays inside
// the six-colour palette; the textures add wear, panel seams and hazard marks so
// flat-shaded boxes read as a foundry instead of a grey room.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

let cache = null;

function canvasTexture(size, draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function speckle(ctx, size, count, alpha, light) {
  for (let i = 0; i < count; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 0.5 + Math.random() * 2.2;
    ctx.fillStyle = light ? `rgba(236,229,216,${alpha * Math.random()})` : `rgba(10,8,6,${alpha * Math.random()})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function concreteDraw(ctx, size) {
  ctx.fillStyle = PALETTE.surface;
  ctx.fillRect(0, 0, size, size);
  // Large worn patches, darker where boots and crates have ground the floor.
  for (let i = 0; i < 9; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = 18 + Math.random() * 42;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(12,10,8,0.28)');
    grad.addColorStop(1, 'rgba(12,10,8,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Expansion-joint grid: one line every quarter of the tile.
  ctx.strokeStyle = 'rgba(12,10,8,0.55)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i += 1) {
    const p = (i * size) / 4;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  speckle(ctx, size, 900, 0.35, false);
  speckle(ctx, size, 160, 0.22, true);
}

function hazardDraw(ctx, size) {
  // Diagonal warning stripes: ember orange on near-black, for the edges of
  // the site frames and the furnace approach.
  ctx.fillStyle = '#17120e';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = PALETTE.accent;
  const stripe = size / 8;
  for (let i = -2; i < 10; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * stripe, size);
    ctx.lineTo(i * stripe + stripe, size);
    ctx.lineTo(i * stripe + stripe + size, 0);
    ctx.lineTo(i * stripe + size, 0);
    ctx.closePath();
    ctx.fill();
  }
  speckle(ctx, size, 260, 0.3, false);
}

function wallDraw(ctx, size) {
  ctx.fillStyle = PALETTE.surface;
  ctx.fillRect(0, 0, size, size);
  // Riveted steel panels: two columns, one horizontal seam, a rivet dot in
  // every corner of every panel.
  ctx.strokeStyle = 'rgba(12,10,8,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.beginPath(); ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2); ctx.stroke();
  ctx.fillStyle = 'rgba(236,229,216,0.35)';
  for (const [x, y] of [[14, 14], [size - 14, 14], [14, size - 14], [size - 14, size - 14],
    [size / 2 - 10, 14], [size / 2 + 10, 14], [size / 2 - 10, size - 14], [size / 2 + 10, size - 14],
    [14, size / 2 - 10], [14, size / 2 + 10], [size - 14, size / 2 - 10], [size - 14, size / 2 + 10]]) {
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Heat tint near the bottom edge, as if the wall has stood beside a furnace.
  const grad = ctx.createLinearGradient(0, size * 0.7, 0, size);
  grad.addColorStop(0, 'rgba(255,122,26,0)');
  grad.addColorStop(1, 'rgba(255,122,26,0.16)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, size * 0.7, size, size * 0.3);
  speckle(ctx, size, 500, 0.3, false);
}

function crateDraw(ctx, size) {
  ctx.fillStyle = PALETTE.hairline;
  ctx.fillRect(0, 0, size, size);
  // Plank seams and a diagonal brace, so a crate reads as built, not poured.
  ctx.strokeStyle = 'rgba(12,10,8,0.55)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 4; i += 1) {
    const p = (i * size) / 4;
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(size, size); ctx.stroke();
  ctx.strokeStyle = 'rgba(236,229,216,0.28)';
  ctx.lineWidth = 2;
  ctx.strokeRect(6, 6, size - 12, size - 12);
  speckle(ctx, size, 420, 0.32, false);
}

function bannerDraw(letter, color) {
  return (ctx, size) => {
    ctx.fillStyle = '#1b1611';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, size, 10);
    ctx.fillRect(0, size - 10, size, 10);
    ctx.font = `bold ${Math.floor(size * 0.52)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size / 2, size / 2 + size * 0.02);
    ctx.font = `bold ${Math.floor(size * 0.09)}px system-ui, sans-serif`;
    ctx.fillStyle = PALETTE.ink;
    ctx.fillText('EMBERLINE', size / 2, size * 0.86);
  };
}

function glowDraw(ctx, size) {
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,180,90,0.55)');
  grad.addColorStop(1, 'rgba(255,122,26,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
}

export function createTextures() {
  if (cache) return cache;
  cache = {
    concrete: canvasTexture(256, concreteDraw, 10, 9),
    hazard: canvasTexture(128, hazardDraw),
    wall: canvasTexture(256, wallDraw, 6, 2),
    crate: canvasTexture(128, crateDraw),
    bannerA: canvasTexture(128, bannerDraw('A', PALETTE.accent)),
    bannerB: canvasTexture(128, bannerDraw('B', PALETTE.ally)),
    glow: canvasTexture(64, glowDraw),
  };
  return cache;
}
