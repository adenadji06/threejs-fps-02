// Headless Chrome test driver for EMBERLINE (dev tooling only — not part of
// the dossier; main.ts copies only game/ + screenshots/).
// - Retakes the 4 dossier screenshots from shots.json (waits for
//   window.__shotReady, collects console errors + failed requests).
// - Runs a live soak (no ?shot) with synthetic WASD input, reads
//   window.__emberDebug/__emberPerf, and reports frame-time stats.
// Usage: node test-shots.mjs [--port 8091] [--soak-secs 20] [--shots-only]
// Requires: a Chrome binary (Playwright cache or /opt/meta-chromium/chrome)
// and `node serve.ts --port <port>` running in another shell.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const portIdx = args.indexOf('--port');
const PORT = portIdx === -1 ? 8091 : Number(args[portIdx + 1]);
const soakIdx = args.indexOf('--soak-secs');
const SOAK_SECS = soakIdx === -1 ? 20 : Number(args[soakIdx + 1]);
const SHOTS_ONLY = args.includes('--shots-only');
const winIdx = args.indexOf('--win');
const WIN_SIZE = winIdx === -1 ? '1280,800' : args[winIdx + 1];
const CHROME =
  process.env.CHROME ??
  '/home/hatch/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome';
const DEBUG_PORT = 9333;

const shots = JSON.parse(readFileSync(new URL('./shots.json', import.meta.url), 'utf8'));

function launchChrome() {
  return spawn(
    CHROME,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--enable-unsafe-swiftshader',
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--window-size=${WIN_SIZE}`,
      '--hide-scrollbars',
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
}

async function getTarget() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {
      // Chrome still starting.
    }
    await sleep(500);
  }
  throw new Error('Chrome DevTools did not come up');
}

let msgId = 0;
const pending = new Map();
function cdp(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const r = await cdp(ws, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (r.exceptionDetails) throw new Error(`evaluate failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description ?? ''}`);
  return r.result?.value;
}

async function waitFor(ws, expression, timeoutMs, label) {
  const start = Date.now();
  for (;;) {
    try {
      if (await evaluate(ws, expression)) return true;
    } catch {
      // Page still loading.
    }
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(250);
  }
}

async function main() {
  const chrome = launchChrome();
  const errors = [];
  try {
    const target = await getTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id).resolve(msg.result ?? {});
        pending.delete(msg.id);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        errors.push(`EXCEPTION: ${msg.params.exceptionDetails.text} ${msg.params.exceptionDetails.exception?.description ?? ''}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(`CONSOLE ERROR: ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
      } else if (msg.method === 'Network.loadingFailed') {
        errors.push(`NETWORK FAILED: ${msg.params.errorText}`);
      }
    };
    await cdp(ws, 'Page.enable');
    await cdp(ws, 'Runtime.enable');
    await cdp(ws, 'Network.enable');

    // --- Shots ------------------------------------------------------------
    for (const shot of shots) {
      errors.length = 0;
      await cdp(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html${shot.query}` });
      await waitFor(ws, 'window.__shotReady === true', 30000, `__shotReady (${shot.name})`);
      const shotResult = await cdp(ws, 'Page.captureScreenshot', { format: 'jpeg', quality: 88 });
      writeFileSync(new URL(`./screenshots/${shot.name}`, import.meta.url), Buffer.from(shotResult.data, 'base64'));
      const debug = await evaluate(ws, 'window.__emberDebug()');
      console.log(`SHOT ${shot.name}: phase=${debug.phase} health=${debug.health} alive=${debug.alive} weapon=${debug.weapon} money=$${debug.money} errors=${errors.length}`);
      for (const e of errors) console.log(`  !! ${e}`);
      // Play shot: the damage number + hitmarker must have fired.
      if (shot.name === '2-play.jpg') {
        const dmg = await evaluate(ws, `document.getElementById('dmgnum').textContent`);
        const gap = await evaluate(ws, `getComputedStyle(document.getElementById('crosshair')).getPropertyValue('--gap')`);
        console.log(`  play-shot dmgnum=${JSON.stringify(dmg)} crosshair-gap=${gap}`);
      }
    }

    if (!SHOTS_ONLY) {
      // --- Live soak ------------------------------------------------------
      errors.length = 0;
      await cdp(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
      await waitFor(ws, `typeof window.__emberDebug === 'function'`, 30000, '__emberDebug');
      await sleep(1000);
      // Click Play (requests pointer lock) then hold W to walk forward.
      const rect = await evaluate(ws, `(() => { const r = document.getElementById('play').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      await cdp(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x, y: rect.y, button: 'left', clickCount: 1 });
      await sleep(500);
      const locked = await evaluate(ws, `document.pointerLockElement ? 'locked' : 'unlocked'`);
      const phase0 = await evaluate(ws, 'window.__emberDebug().phase');
      console.log(`  after Play click: pointer=${locked} phase=${phase0}`);
      await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      await sleep(SOAK_SECS * 1000);
      await cdp(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', code: 'KeyW', key: 'w', windowsVirtualKeyCode: 87 });
      const debug = await evaluate(ws, 'window.__emberDebug()');
      const perf = await evaluate(ws, 'window.__emberPerf()');
      console.log(`SOAK ${SOAK_SECS}s: phase=${debug.phase} round=${debug.round} pos=${debug.pos} health=${debug.health} alive=${debug.alive} kills=${debug.kills} errors=${errors.length}`);
      console.log(`PERF (headless SwiftShader software GL — NOT judge GPU): ${JSON.stringify(perf)}`);
      for (const e of errors) console.log(`  !! ${e}`);
    }
    ws.close();
  } finally {
    chrome.kill('SIGKILL');
  }
}

main().catch((err) => {
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
});
