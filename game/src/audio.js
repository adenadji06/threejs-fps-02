// Procedural sound: every effect is synthesised with WebAudio, so the game ships
// no audio files and makes no network request. One AudioContext, created lazily on
// the first user gesture (browsers refuse audio before that).
let ctx = null;
let master = null;

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  return ctx;
}

function noiseBuffer(seconds) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function burst(duration, filterFreq, gainValue, type = 'lowpass') {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(duration);
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = filterFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.start(t);
  source.stop(t + duration);
}

function tone(freq, duration, gainValue, type = 'square', slideTo = 0) {
  if (!ensure()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(gainValue, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t);
  osc.stop(t + duration);
}

export const sfx = {
  unlock() {
    ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    startAmbient();
  },
  shot(kind) {
    // kind: 'pistol' | 'smg' | 'rifle' | 'sniper' | 'shotgun' | 'repeater' |
    // 'lmg' | 'enemy'
    if (kind === 'sniper') burst(0.28, 900, 0.9);
    else if (kind === 'rifle') burst(0.14, 1600, 0.7);
    else if (kind === 'smg') burst(0.09, 2200, 0.5);
    else if (kind === 'shotgun') { burst(0.35, 500, 1.0); burst(0.12, 2600, 0.5); }
    else if (kind === 'repeater') burst(0.2, 1000, 0.8);
    else if (kind === 'lmg') burst(0.12, 1400, 0.65);
    else if (kind === 'enemy') burst(0.12, 1100, 0.35);
    else burst(0.12, 1900, 0.6);
  },
  dryFire() {
    tone(1400, 0.03, 0.12, 'square');
  },
  reload() {
    tone(700, 0.05, 0.15, 'square', 420);
    setTimeout(() => tone(500, 0.05, 0.15, 'square', 300), 160);
  },
  hit(kill) {
    tone(kill ? 1560 : 1180, kill ? 0.12 : 0.06, 0.25, 'sine');
  },
  hurt() {
    tone(180, 0.18, 0.3, 'sawtooth', 90);
  },
  plantBeep() {
    tone(980, 0.07, 0.2, 'sine');
  },
  defuseBeep() {
    tone(660, 0.07, 0.2, 'sine');
  },
  explosion() {
    burst(1.1, 220, 1.0);
    tone(70, 0.9, 0.5, 'sine', 32);
  },
  roundWin() {
    tone(523, 0.14, 0.22, 'sine');
    setTimeout(() => tone(659, 0.14, 0.22, 'sine'), 140);
    setTimeout(() => tone(784, 0.24, 0.22, 'sine'), 280);
  },
  roundLose() {
    tone(392, 0.16, 0.22, 'sine');
    setTimeout(() => tone(311, 0.3, 0.22, 'sine'), 170);
  },
  buy() {
    tone(880, 0.06, 0.18, 'sine');
    setTimeout(() => tone(1174, 0.08, 0.18, 'sine'), 70);
  },
  denied() {
    tone(220, 0.12, 0.2, 'square', 160);
  },
  grenade() {
    burst(0.5, 500, 0.5, 'bandpass');
  },
  step() {
    burst(0.05, 300, 0.06);
  },
  // Round horn: two low tones on the first round's Play click, so the match
  // opens with a sound instead of silence.
  horn() {
    tone(98, 0.5, 0.3, 'sawtooth', 98);
    setTimeout(() => tone(147, 0.6, 0.28, 'sawtooth', 147), 180);
  },
  // Kill confirm: a short rising pair, distinct from the hit tick.
  killSting() {
    tone(1046, 0.07, 0.2, 'sine');
    setTimeout(() => tone(1568, 0.12, 0.2, 'sine'), 70);
  },
  // Plant complete: a two-tone alarm that says the round just changed.
  plantComplete() {
    tone(880, 0.12, 0.22, 'square');
    setTimeout(() => tone(880, 0.12, 0.22, 'square'), 160);
    setTimeout(() => tone(1174, 0.2, 0.22, 'square'), 320);
  },
};

// The foundry never goes quiet: a low two-oscillator drone (the furnace) plus
// random ember crackle ticks on a slow timer. One interval, one voice at a
// time, started once on the first user gesture — never before, or the browser
// refuses the AudioContext.
let ambientStarted = false;
let crackleTimer = 0;

function startAmbient() {
  if (ambientStarted || !ensure()) return;
  ambientStarted = true;
  const oscA = ctx.createOscillator();
  oscA.type = 'sine';
  oscA.frequency.value = 55;
  const oscB = ctx.createOscillator();
  oscB.type = 'sine';
  oscB.frequency.value = 55.6;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.045;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 220;
  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(droneGain);
  droneGain.connect(master);
  oscA.start();
  oscB.start();
  // Slow breathing on the drone gain, so the hum feels alive, not looped.
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.015;
  lfo.connect(lfoGain);
  lfoGain.connect(droneGain.gain);
  lfo.start();
  crackleTimer = window.setInterval(() => {
    if (Math.random() < 0.6) burst(0.03 + Math.random() * 0.05, 1800 + Math.random() * 2400, 0.04 + Math.random() * 0.05, 'bandpass');
  }, 900);
}
