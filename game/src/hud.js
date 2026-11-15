// The DOM HUD: health, ammo, money, timer, score, kill feed, buy menu, the plant
// and defuse bars, and the one overlay panel. It never touches the simulation;
// main.js pushes numbers in and reads the play callback out. Every setter is
// cached, so the DOM is only written when a value actually changes.
import { WEAPONS, GRENADE, BUY_ORDER } from './weapons.js';

const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Round-based tactical strike in the Foundry Yard. Plant the charge at Foundry or Depot — or eliminate the Ember Cell. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: '',
    copy: '',
    action: 'Continue',
  },
  match: {
    title: '',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveValue = $('alive-value');
  const feedEl = $('feed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const objective = $('objective');
  const objectiveLabel = $('objective-label');
  const objectiveFill = $('objective-fill');
  const buy = $('buy');
  const buyMoney = $('buy-money');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const dmgNum = $('dmgnum');
  const hint = $('hint');
  const hitTimerHolder = { id: 0 };
  const dmgTimerHolder = { id: 0 };
  let lastGap = -1;

  let last = {};

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuy(onBuy) {
    const list = $('buy-list');
    list.innerHTML = '';
    const items = [];
    for (const id of BUY_ORDER) {
      const w = WEAPONS[id];
      items.push({ key: String(items.length + 1), id, name: w.name, price: w.price, desc: `${w.damage} dmg · ${w.mag} rounds` });
    }
    items.push({ key: String(items.length + 1), id: 'grenade', name: GRENADE.name, price: GRENADE.price, desc: `${GRENADE.damage} dmg · blast radius ${GRENADE.radius} m` });
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.id = item.id;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => onBuy(item.id));
      list.appendChild(row);
    }
  }

  return {
    setHealth(value) {
      setText(healthNum, 'hp', String(Math.max(0, Math.ceil(value))));
      const pct = Math.max(0, Math.min(100, value));
      if (last.hpPct !== pct) {
        last.hpPct = pct;
        healthFill.style.width = `${pct}%`;
        healthFill.classList.toggle('low', pct <= 30);
      }
    },
    setAmmo(mag, reserve) {
      setText(ammoMag, 'mag', String(mag));
      setText(ammoReserve, 'res', `/ ${reserve}`);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      setText(weaponName, 'wpn', name);
    },
    setGrenades(count) {
      setText(grenadeCount, 'grn', `HE x${count}`);
    },
    setMoney(value) {
      setText(moneyValue, 'money', `$${value}`);
      setText(buyMoney, 'buyMoney', `$${value}`);
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText(timerValue, 'timer', text);
      $('timer').classList.toggle('urgent', s <= 10);
    },
    setScore(vanguard, ember) {
      setText(scoreValue, 'score', `${vanguard} — ${ember}`);
    },
    setAlive(vanguard, ember) {
      setText(aliveValue, 'alive', `V ${vanguard} · E ${ember}`);
    },
    setFeed(feed) {
      // Cheap change key (length + first line) so the 60 Hz call below does
      // not rebuild an HTML string and touch the DOM every simulation step.
      const key = `${feed.length}|${feed.length ? feed[0].text : ''}|${feed.length ? feed[0].team : ''}`;
      if (last.feedKey === key) return;
      last.feedKey = key;
      feedEl.innerHTML = feed.map((f) => `<div class="feed-line ${f.team}">${f.text}</div>`).join('');
    },
    showBanner(text, sub, good) {
      setText(bannerTitle, 'banner', text);
      setText(bannerSub, 'bannerSub', sub);
      banner.classList.toggle('good', !!good);
      banner.classList.toggle('bad', !good);
      banner.hidden = false;
    },
    hideBanner() {
      banner.hidden = true;
    },
    showObjective(label, progress) {
      setText(objectiveLabel, 'obj', label);
      objectiveFill.style.width = `${Math.round(progress * 100)}%`;
      objective.hidden = false;
    },
    hideObjective() {
      objective.hidden = true;
    },
    buildBuy,
    showBuy(money) {
      this.setMoney(money);
      buy.hidden = false;
    },
    hideBuy() {
      buy.hidden = true;
    },
    markBuy(id, affordable, owned) {
      const row = buy.querySelector(`[data-id="${id}"]`);
      if (!row) return;
      row.classList.toggle('cant', !affordable && !owned);
      row.classList.toggle('owned', !!owned);
    },
    setHint(text) {
      setText(hint, 'hint', text || '');
      hint.hidden = !text;
    },
    setCrosshair(gapPx) {
      // The sim calls this every step; only touch the DOM when the gap moved
      // by half a pixel or more.
      if (Math.abs(gapPx - lastGap) < 0.5) return;
      lastGap = gapPx;
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90, head = false) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      hitmarker.classList.toggle('head', head && !killed);
      clearTimeout(hitTimerHolder.id);
      hitTimerHolder.id = setTimeout(() => hitmarker.classList.remove('on', 'kill', 'head'), holdMs);
    },
    // Floating damage number beside the crosshair: the exact damage of the
    // last hit, so the player learns what each gun does per shot.
    showDamage(amount, head) {
      dmgNum.textContent = head ? `${amount} HEADSHOT` : String(amount);
      dmgNum.classList.toggle('head', !!head);
      dmgNum.classList.add('on');
      clearTimeout(dmgTimerHolder.id);
      dmgTimerHolder.id = setTimeout(() => dmgNum.classList.remove('on'), 650);
    },
    damageFlash() {
      damage.classList.add('on');
      setTimeout(() => damage.classList.remove('on'), 180);
    },
    showOverlay(mode, data) {
      const text = COPY[mode];
      if (mode === 'round') {
        title.textContent = data.win ? 'Round won' : 'Round lost';
        copy.textContent = `${data.reason} — Vanguard ${data.vanguard} · Ember ${data.ember}.`;
        play.textContent = text.action;
      } else if (mode === 'match') {
        title.textContent = data.win ? 'Match won' : 'Match lost';
        copy.textContent = `Final score Vanguard ${data.vanguard} · Ember ${data.ember}.`;
        play.textContent = text.action;
      } else {
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
