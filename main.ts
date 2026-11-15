// EMBERLINE — a threejs-fps-02 entry (Node 22, standard library only). The game is
// this directory's game/ folder: plain static files the browser loads as ES modules,
// three.js 0.187.0 from an import map, no build step and no network request. This
// program hands it in: it copies game/ and screenshots/ from beside this file to
// /output and writes /output/dossier.json, the summary the judge reads, with the
// vendored make.fun library. The game itself: two arenas (Foundry Yard, Ember
// Works), seven weapons, four bot classes, procedural canvas textures and a
// synthesised ambient soundscape — all of it in game/src, all of it read by the
// judge from the dossier text this program writes.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all: game/ counts beside /output's own 1000-entry cap, its screenshots/ and dossier.json).
// Measured 2026-11-15 on the content-growth build: dossier 506,496 bytes, text 137,486 of the 163,840 cap —
// every source file is read whole, nothing is cut.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
// One-line build receipt on stdout: dossier bytes, so a rebuild that silently
// truncates source past the 160 KiB text cap is visible immediately (the
// gate's dossier_matches row names what was cut).
console.log(`dossier written: ${join(out, 'dossier.json')} (${statSync(join(out, 'dossier.json')).size} bytes)`);
