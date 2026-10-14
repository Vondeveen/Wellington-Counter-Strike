import { TEAMS, WEAPONS, WEAPON_ORDER, SITES, BOUNDS } from '../shared/config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const hud = {
  show(on) { $('hud').classList.toggle('hidden', !on); },

  setHealth(hp) {
    $('hp').textContent = Math.max(0, Math.round(hp));
    $('hpBox').classList.toggle('low', hp <= 25);
  },

  setAmmo(weapon, mag, reserve, reloading) {
    const w = WEAPONS[weapon];
    $('weaponName').textContent = w.name + (reloading ? ' — reloading…' : '');
    $('ammo').textContent = w.melee ? '∞' : mag;
    $('reserve').textContent = w.melee ? '' : `/ ${reserve}`;
    const slots = $('weaponSlots');
    if (!slots.childElementCount) {
      slots.innerHTML = WEAPON_ORDER.map((k) => `<span data-w="${k}">${WEAPONS[k].slot} ${WEAPONS[k].name.split(' ')[1] || WEAPONS[k].name}</span>`).join('');
    }
    for (const s of slots.children) s.classList.toggle('on', s.dataset.w === weapon);
  },

  setTeam(team) {
    const t = TEAMS[team];
    $('teamTag').innerHTML = t ? `<span style="color:${t.color}">${esc(t.name)}</span> · ${t.role === 'attack' ? 'Attacking' : 'Defending'}` : '';
  },

  setCarry(on) { $('carryTag').classList.toggle('hidden', !on); },

  setRound(phase, timeLeft, scores, round) {
    const labels = { warmup: 'WARMUP', freeze: 'FREEZE TIME', live: `ROUND ${round}`, planted: 'MOTION TABLED', end: 'ROUND OVER' };
    $('phase').textContent = labels[phase] || phase;
    const tEl = $('timer');
    if (phase === 'warmup') tEl.textContent = '--:--';
    else {
      const s = Math.ceil(timeLeft);
      tEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
    tEl.classList.toggle('urgent', phase === 'planted' || (phase === 'live' && timeLeft < 15));
    $('scoreOpp').textContent = scores.opp;
    $('scoreGov').textContent = scores.gov;
  },

  setAlive(oppAlive, oppTotal, govAlive, govTotal) {
    $('aliveRow').innerHTML = `<span class="opp">${oppAlive}/${oppTotal} alive</span><span class="gov">${govAlive}/${govTotal} alive</span>`;
  },

  banner(title, sub = '', color = '#fff', ms = 3000) {
    $('bannerTitle').textContent = title;
    $('bannerTitle').style.color = color;
    $('bannerSub').textContent = sub;
    const b = $('banner');
    b.classList.add('on');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.remove('on'), ms);
  },

  message(text, kind = 'info', ms = 3500) {
    const box = $('centerMsg');
    const d = document.createElement('div');
    d.className = kind;
    d.textContent = text;
    box.appendChild(d);
    while (box.childElementCount > 4) box.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; }, ms);
    setTimeout(() => d.remove(), ms + 700);
  },

  hint(text) { if ($('hint').textContent !== text) $('hint').textContent = text || ''; },

  progress(label, frac) {
    const p = $('progress');
    if (label == null) { p.classList.add('hidden'); return; }
    p.classList.remove('hidden');
    $('progressLabel').textContent = label;
    $('progressFill').style.width = `${Math.round(frac * 100)}%`;
  },

  killfeed(killerName, killerTeam, victimName, victimTeam, weapon, head, mine) {
    const feed = $('killfeed');
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' mine' : '');
    const wname = weapon === 'switch' ? 'switched team' : (WEAPONS[weapon]?.name || weapon);
    d.innerHTML = (killerName ? `<span class="${killerTeam}">${esc(killerName)}</span>` : '') +
      `<span class="w">[${esc(wname)}${head ? ' ⦿' : ''}]</span><span class="${victimTeam}">${esc(victimName)}</span>`;
    feed.appendChild(d);
    while (feed.childElementCount > 6) feed.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; }, 6000);
    setTimeout(() => d.remove(), 6600);
  },

  chat(name, team, text, system = false) {
    const log = $('chatLog');
    const d = document.createElement('div');
    d.innerHTML = system ? `<span class="sys">${esc(text)}</span>` : `<span class="${team}">${esc(name)}:</span> ${esc(text)}`;
    log.appendChild(d);
    while (log.childElementCount > 7) log.firstChild.remove();
    setTimeout(() => { d.style.opacity = '0'; }, 12000);
    setTimeout(() => d.remove(), 13000);
  },

  hitmarker(head) {
    const h = $('hitmarker');
    h.classList.toggle('head', !!head);
    h.classList.add('show');
    clearTimeout(this._ht);
    this._ht = setTimeout(() => h.classList.remove('show'), 80);
  },

  damage(angle) {
    const f = $('damageFlash');
    f.classList.add('on');
    setTimeout(() => f.classList.remove('on'), 60);
    const a = document.createElement('div');
    a.className = 'dmgArrow';
    a.style.transform = `rotate(${angle}rad)`;
    $('dmgIndicators').appendChild(a);
    setTimeout(() => { a.style.opacity = '0'; }, 400);
    setTimeout(() => a.remove(), 1500);
  },

  crosshairGap(px) { $('crosshair').style.setProperty('--gap', `${Math.round(px)}px`); },
  crosshairVisible(on) { $('crosshair').style.display = on ? '' : 'none'; },
  scope(on) { $('scope').classList.toggle('on', on); },

  spectate(text) {
    const s = $('spectate');
    s.classList.toggle('hidden', !text);
    if (text) s.textContent = text;
  },

  scoreboard(visible, players, myId) {
    const sb = $('scoreboard');
    sb.classList.toggle('hidden', !visible);
    if (!visible) return;
    const col = (team) => {
      const rows = players.filter((p) => p.tm === team).sort((a, b) => b.k - a.k || a.d - b.d);
      return `<div><h3 style="color:${TEAMS[team].color}">${esc(TEAMS[team].name)} (${rows.length})</h3>
        <table><tr><th>Name</th><th>K</th><th>D</th><th>Ping</th></tr>
        ${rows.map((p) => `<tr class="${p.a ? '' : 'dead'} ${p.id === myId ? 'me' : ''}"><td>${esc(p.n)}${p.a ? '' : ' ☠'}</td><td>${p.k}</td><td>${p.d}</td><td>${p.png}</td></tr>`).join('')}
        </table></div>`;
    };
    sb.innerHTML = col('opp') + col('gov');
  },
};

// ---------------------------------------------------------------------------
// Radar
// ---------------------------------------------------------------------------
export function createRadar(map) {
  const cv = $('radar');
  const g = cv.getContext('2d');
  const W = cv.width;
  const pad = 6;
  const spanX = BOUNDS.maxX - BOUNDS.minX;
  const spanZ = BOUNDS.maxZ - BOUNDS.minZ;
  const scale = (W - pad * 2) / Math.max(spanX, spanZ);
  const ox = pad + ((W - pad * 2) - spanX * scale) / 2;
  const oz = pad + ((W - pad * 2) - spanZ * scale) / 2;
  const P = (x, z) => [ox + (x - BOUNDS.minX) * scale, oz + (z - BOUNDS.minZ) * scale];

  const bg = document.createElement('canvas');
  bg.width = bg.height = W;
  const b = bg.getContext('2d');
  b.fillStyle = 'rgba(70,110,60,0.35)';
  const [gx0, gz0] = P(-54, -44);
  const [gx1, gz1] = P(52, 48);
  b.fillRect(gx0, gz0, gx1 - gx0, gz1 - gz0);
  b.fillStyle = 'rgba(200,200,200,0.55)';
  for (const poly of map.radar) {
    b.beginPath();
    poly.forEach(([x, z], i) => { const [px, pz] = P(x, z); i ? b.lineTo(px, pz) : b.moveTo(px, pz); });
    b.closePath();
    b.fill();
  }
  b.strokeStyle = 'rgba(255,204,51,0.8)';
  b.fillStyle = 'rgba(255,204,51,0.9)';
  b.font = 'bold 13px system-ui';
  b.textAlign = 'center';
  b.textBaseline = 'middle';
  for (const [k, s] of Object.entries(SITES)) {
    const [px, pz] = P(s.x, s.z);
    b.beginPath();
    b.arc(px, pz, s.radius * scale, 0, Math.PI * 2);
    b.stroke();
    b.fillText(k, px, pz);
  }
  b.fillStyle = 'rgba(255,255,255,0.55)';
  b.font = '8px system-ui';
  for (const l of map.labels) {
    const [px, pz] = P(l.x, l.z);
    b.save();
    b.translate(px, pz);
    if (l.vertical) b.rotate(-Math.PI / 2);
    b.fillText(l.text, 0, l.vertical ? 0 : 11);
    b.restore();
  }

  return function draw(me, others, motion) {
    g.clearRect(0, 0, W, W);
    g.drawImage(bg, 0, 0);
    for (const o of others) {
      const [px, pz] = P(o.x, o.z);
      g.fillStyle = TEAMS[o.team].color;
      g.beginPath();
      g.arc(px, pz, 3, 0, Math.PI * 2);
      g.fill();
    }
    if (motion) {
      const [px, pz] = P(motion.x, motion.z);
      g.fillStyle = motion.planted ? (Math.floor(performance.now() / 300) % 2 ? '#f33' : '#fc3') : '#ff8a2a';
      g.fillRect(px - 3, pz - 3, 6, 6);
    }
    if (me) {
      const [px, pz] = P(me.x, me.z);
      g.save();
      g.translate(px, pz);
      g.rotate(-me.yaw);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(0, -6);
      g.lineTo(4, 4);
      g.lineTo(0, 2);
      g.lineTo(-4, 4);
      g.closePath();
      g.fill();
      g.restore();
    }
  };
}
