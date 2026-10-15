import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as THREE from 'three';
import { TICK_RATE, TEAMS, ROUND, WEAPONS, SITES, SPAWNS, BOTS } from './public/shared/config.js';
import { buildMap } from './public/js/map.js';
import { buildNav } from './server/nav.js';
import { makeBrain, resetBrain, updateBot, onRoundStart, onNoise, onHurt, maybeChat } from './server/bots.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

// ---------------------------------------------------------------------------
// Static file server
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const STATIC_ROOTS = [
  ['/vendor/three/', path.join(__dirname, 'node_modules/three/')],
  ['/', path.join(__dirname, 'public/')],
];

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  for (const [prefix, root] of STATIC_ROOTS) {
    if (!url.startsWith(prefix)) continue;
    let rel = url.slice(prefix.length);
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(root, rel));
    if (!file.startsWith(root)) break;
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404);
  res.end('Not found');
});

// ---------------------------------------------------------------------------
// World: the server builds the same map as the clients so bots can navigate it
// ---------------------------------------------------------------------------
buildMap(new THREE.Scene());
const navInfo = buildNav([...SPAWNS.opp, ...SPAWNS.gov]);
console.log(`  Map loaded, bot navigation grid: ${navInfo.cells} cells (${navInfo.ms} ms)`);

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });
const players = new Map(); // id -> player (humans and bots)
let nextId = 1;

const game = {
  phase: 'warmup', // warmup | freeze | live | planted | end
  phaseEnds: 0,
  round: 0,
  scores: { opp: 0, gov: 0 },
  motion: null, // { carrier, x, y, z, planted, site }
  pendingStart: 0,
  plan: 'B',
  motionTimeLeft: 0,
  botFill: BOTS.defaultFill,
  botDifficulty: BOTS.defaultDifficulty,
};

const now = () => Date.now() / 1000;
const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function send(p, msg) {
  if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
}
function broadcast(msg, except) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p !== except && p.joined && p.ws && p.ws.readyState === 1) p.ws.send(data);
  }
}
function announce(text, kind = 'info') {
  broadcast({ t: 'event', text, kind });
}

const humans = () => [...players.values()].filter((p) => p.joined && !p.isBot);
function teamCounts() {
  const c = { opp: 0, gov: 0 };
  for (const p of players.values()) if (p.joined) c[p.team]++;
  return c;
}
function alive(team) {
  return [...players.values()].filter((p) => p.joined && p.team === team && p.alive);
}

function cleanName(name) {
  const n = String(name || '').replace(/[^\p{L}\p{N} _\-.'!?]/gu, '').trim().slice(0, 16);
  return n || `MP ${Math.floor(Math.random() * 900 + 100)}`;
}

function newPlayer(fields) {
  return {
    id: nextId++, ws: null, name: '', team: 'opp', joined: false, alive: false, isBot: false,
    hp: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, yaw: 0, pitch: 0, crouch: false,
    weapon: 'rifle', kills: 0, deaths: 0, action: null, respawnAt: 0, ...fields,
  };
}

function pickSpawn(team) {
  const list = SPAWNS[team];
  const taken = [...players.values()].filter((p) => p.alive && p.team === team);
  const free = list.filter((s) => taken.every((p) => Math.hypot(p.x - s.x, p.z - s.z) > 1.2));
  const pool = free.length ? free : list;
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnPlayer(p) {
  const s = pickSpawn(p.team);
  p.alive = true;
  p.hp = ROUND.maxHp;
  p.x = s.x; p.y = s.y; p.z = s.z;
  p.vx = p.vy = p.vz = 0;
  p.onGround = true;
  p.crouch = false;
  p.yaw = s.yaw; p.pitch = 0;
  p.action = null;
  p.respawnAt = 0;
  p.pendingShots = 0;
  if (p.isBot) resetBrain(p);
  send(p, { t: 'spawn', x: s.x, y: s.y, z: s.z, yaw: s.yaw });
}

function setPhase(phase, duration) {
  game.phase = phase;
  game.phaseEnds = duration ? now() + duration : 0;
}

function startMatch() {
  game.scores = { opp: 0, gov: 0 };
  game.round = 0;
  for (const p of players.values()) { p.kills = 0; p.deaths = 0; }
  announce('Match starting — first to ' + ROUND.roundsToWin + ' rounds wins!', 'big');
  startRound();
}

function startRound() {
  game.round++;
  game.motion = null;
  setPhase('freeze', ROUND.freezeTime);
  for (const p of players.values()) {
    if (!p.joined) continue;
    spawnPlayer(p);
  }
  onRoundStart(players, game);
  const attackers = alive('opp');
  if (attackers.length) {
    // Prefer giving the Motion to a human attacker
    const humansOpp = attackers.filter((p) => !p.isBot);
    const pool = humansOpp.length ? humansOpp : attackers;
    const carrier = pool[Math.floor(Math.random() * pool.length)];
    game.motion = { carrier: carrier.id, x: carrier.x, y: 0, z: carrier.z, planted: false };
    send(carrier, { t: 'event', text: 'You carry the Motion of No Confidence. Table it at site A or B!', kind: 'big' });
  }
  broadcast({ t: 'round', round: game.round });
}

function endRound(winner, reason) {
  if (game.phase === 'end' || game.phase === 'warmup') return;
  game.scores[winner]++;
  for (const p of players.values()) p.action = null;
  setPhase('end', ROUND.endTime);
  broadcast({ t: 'roundEnd', winner, reason, scores: game.scores });
  if (game.scores[winner] >= ROUND.roundsToWin) {
    announce(`${TEAMS[winner].name} win the match! A new match begins shortly.`, 'big');
    game.matchOver = true;
  }
}

function enterWarmup() {
  setPhase('warmup');
  game.motion = null;
  game.scores = { opp: 0, gov: 0 };
  game.round = 0;
  game.pendingStart = 0;
  for (const p of players.values()) {
    p.action = null;
    if (p.joined && !p.alive) p.respawnAt = now() + 1;
  }
  announce('Warmup — waiting for players on both teams', 'info');
}

function dropMotion(p) {
  const m = game.motion;
  if (m && !m.planted && m.carrier === p.id) {
    m.carrier = null;
    m.x = p.x; m.y = p.y; m.z = p.z;
    for (const q of players.values()) {
      if (q.joined && q.team === 'opp') send(q, { t: 'event', text: 'The Motion has been dropped!', kind: 'warn' });
    }
  }
}

function killPlayer(victim, killer, weapon, head, dir) {
  victim.alive = false;
  victim.hp = 0;
  victim.deaths = (victim.deaths || 0) + 1;
  victim.action = null;
  if (killer && killer !== victim) killer.kills = (killer.kills || 0) + 1;
  dropMotion(victim);
  if (game.phase === 'warmup') victim.respawnAt = now() + ROUND.warmupRespawn;
  const d = dir || { x: 0, y: 0, z: 0 };
  broadcast({
    t: 'kill', killer: killer ? killer.id : null, victim: victim.id, weapon, head: !!head,
    x: +victim.x.toFixed(2), y: +victim.y.toFixed(2), z: +victim.z.toFixed(2),
    d: [+d.x.toFixed(2), +d.y.toFixed(2), +d.z.toFixed(2)], c: victim.crouch ? 1 : 0, yw: +victim.yaw.toFixed(2),
  });
  if (killer && killer !== victim) maybeChat(killer, ctx);
}

// Shared by human hits and bot hits
function applyDamage(attacker, target, weapon, head, point, dir) {
  if (!target.alive || target.team === attacker.team) return;
  const w = WEAPONS[weapon];
  const dmg = Math.round(w.damage * (head ? w.headMult : 1));
  target.hp = Math.max(0, target.hp - dmg);
  send(target, { t: 'hurt', from: attacker.id, x: attacker.x, z: attacker.z, hp: target.hp });
  send(attacker, { t: 'hitConfirm', head: !!head, kill: target.hp <= 0 });
  const r2 = (v) => +v.toFixed(2);
  broadcast({
    t: 'bleed', id: target.id, from: attacker.id, head: !!head, hp: target.hp, dmg, w: weapon,
    p: [r2(point.x), r2(point.y), r2(point.z)], d: [r2(dir.x), r2(dir.y), r2(dir.z)],
  });
  onHurt(target, attacker);
  if (target.hp <= 0) {
    killPlayer(target, attacker, weapon, head, dir);
    checkElimination();
  }
}

function startAction(p, kind) {
  if (!p.alive || p.action) return false;
  const m = game.motion;
  if (kind === 'plant' && game.phase === 'live' && p.team === 'opp' && m && m.carrier === p.id) {
    const site = siteAt(p);
    if (!site) {
      send(p, { t: 'event', text: 'You must be inside site A or B to table the Motion', kind: 'warn' });
      return false;
    }
    p.action = { kind: 'plant', site, start: now(), duration: ROUND.plantTime, x: p.x, z: p.z };
    return true;
  }
  if (kind === 'defuse' && game.phase === 'planted' && p.team === 'gov' && m) {
    if (dist2D(p, m) > 2.2 || Math.abs(p.y - m.y) > 2) return false;
    p.action = { kind: 'defuse', start: now(), duration: ROUND.defuseTime, x: p.x, z: p.z };
    return true;
  }
  return false;
}

function checkElimination() {
  if (game.phase !== 'live' && game.phase !== 'planted') return;
  const opp = alive('opp').length;
  const gov = alive('gov').length;
  if (gov === 0) endRound('opp', 'The Government benches are empty!');
  else if (opp === 0 && game.phase === 'live') endRound('gov', 'The Opposition has been eliminated.');
}

function chat(p, text) {
  broadcast({ t: 'chat', id: p.id, name: p.name, team: p.team, text });
}

const ctx = {
  players, game, now, broadcast, applyDamage, startAction, chat,
  siteAt: (p) => siteAt(p),
  noise: (p) => onNoise(players, p),
};

// ---------------------------------------------------------------------------
// Bots: each team is topped up to `botFill` players while any human is playing
// ---------------------------------------------------------------------------
const usedNames = new Set();
function addBot(team) {
  const free = BOTS.names.filter((n) => !usedNames.has(n));
  const base = free.length ? free[(Math.random() * free.length) | 0] : `Bot${nextId}`;
  usedNames.add(base);
  const p = newPlayer({ name: `Bot ${base}`, team, joined: true, isBot: true, botBase: base });
  p.bot = makeBrain(game.botDifficulty);
  p.weapon = p.bot.weapon;
  players.set(p.id, p);
  if (game.phase === 'warmup') spawnPlayer(p);
  return p;
}
function removeBot(p) {
  dropMotion(p);
  players.delete(p.id);
  usedNames.delete(p.botBase);
  broadcast({ t: 'left', id: p.id });
}
function manageBots() {
  const anyHumans = humans().length > 0;
  for (const team of ['opp', 'gov']) {
    const teamHumans = humans().filter((p) => p.team === team).length;
    const bots = [...players.values()].filter((p) => p.isBot && p.team === team);
    const want = anyHumans ? Math.max(0, game.botFill - teamHumans) : 0;
    if (bots.length < want) addBot(team);
    else if (bots.length > want) {
      const victim = bots.find((b) => !b.alive) || bots[bots.length - 1];
      removeBot(victim);
      checkElimination();
    }
  }
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
let lastTick = now();
let lastBotManage = 0;
function tick() {
  const t = now();
  const dt = Math.min(0.1, t - lastTick);
  lastTick = t;
  if (t - lastBotManage > 0.5) { lastBotManage = t; manageBots(); }

  const counts = teamCounts();
  const canPlay = counts.opp > 0 && counts.gov > 0 && humans().length > 0;

  if (game.phase !== 'warmup' && !canPlay) enterWarmup();

  switch (game.phase) {
    case 'warmup':
      for (const p of players.values()) {
        if (p.joined && !p.alive && p.respawnAt && t >= p.respawnAt) spawnPlayer(p);
      }
      if (canPlay) {
        if (!game.pendingStart) {
          game.pendingStart = t + 4;
          announce('Both teams present — match starting in 4 seconds', 'info');
        } else if (t >= game.pendingStart) {
          game.pendingStart = 0;
          startMatch();
        }
      } else game.pendingStart = 0;
      break;
    case 'freeze':
      if (t >= game.phaseEnds) {
        setPhase('live', ROUND.roundTime);
        broadcast({ t: 'go' });
      }
      break;
    case 'live':
    case 'planted':
      updateMotion(t);
      checkElimination();
      if (game.phase === 'live' && t >= game.phaseEnds) endRound('gov', 'Time ran out — the Government survives.');
      if (game.phase === 'planted' && t >= game.phaseEnds) endRound('opp', 'The Motion passed! The Government has fallen.');
      break;
    case 'end':
      if (t >= game.phaseEnds) {
        if (game.matchOver) {
          game.matchOver = false;
          startMatch();
        } else startRound();
      }
      break;
  }
  game.motionTimeLeft = game.phase === 'planted' ? game.phaseEnds - t : 0;

  for (const p of players.values()) {
    if (!p.isBot || !p.alive) continue;
    try { updateBot(p, ctx, dt); } catch (err) { console.error('bot error', err); }
  }

  // Snapshot
  const list = [];
  for (const p of players.values()) {
    if (!p.joined) continue;
    let prog = 0;
    if (p.action) prog = Math.min(1, (t - p.action.start) / p.action.duration);
    list.push({
      id: p.id, n: p.name, tm: p.team, bot: p.isBot ? 1 : 0,
      x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3),
      yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(3),
      c: p.crouch ? 1 : 0, w: p.weapon, a: p.alive ? 1 : 0, hp: p.hp,
      k: p.kills || 0, d: p.deaths || 0, png: p.isBot ? 0 : p.ping || 0,
      ac: p.action ? p.action.kind : null, pr: +prog.toFixed(2),
    });
  }
  const m = game.motion;
  broadcast({
    t: 'snap',
    players: list,
    g: {
      ph: game.phase,
      tl: game.phaseEnds ? Math.max(0, game.phaseEnds - t) : 0,
      sc: game.scores,
      rd: game.round,
      m: m ? { c: m.carrier, x: m.x, y: m.y, z: m.z, p: m.planted, s: m.site || null } : null,
      bf: game.botFill,
      bd: game.botDifficulty,
    },
  });
}

function updateMotion(t) {
  const m = game.motion;
  if (!m) return;

  if (!m.planted) {
    if (m.carrier) {
      const c = players.get(m.carrier);
      if (!c || !c.alive) {
        m.carrier = null;
      } else {
        m.x = c.x; m.y = c.y; m.z = c.z;
      }
    } else {
      for (const p of alive('opp')) {
        if (dist2D(p, m) < 1.8 && Math.abs(p.y - m.y) < 2.5) {
          m.carrier = p.id;
          send(p, { t: 'event', text: 'You picked up the Motion of No Confidence', kind: 'info' });
          break;
        }
      }
    }
  }

  for (const p of players.values()) {
    const a = p.action;
    if (!a) continue;
    const moved = Math.hypot(p.x - a.x, p.z - a.z) > 0.8;
    if (!p.alive || moved) { p.action = null; continue; }
    if (t - a.start < a.duration) continue;
    p.action = null;
    if (a.kind === 'plant' && game.phase === 'live' && m && m.carrier === p.id) {
      m.planted = true;
      m.carrier = null;
      m.site = a.site;
      m.x = p.x; m.y = p.y; m.z = p.z;
      setPhase('planted', ROUND.motionTime);
      broadcast({ t: 'planted', site: a.site });
      announce(`${p.name} tabled the Motion of No Confidence at ${SITES[a.site].name}!`, 'big');
    } else if (a.kind === 'defuse' && game.phase === 'planted') {
      endRound('gov', `${p.name} vetoed the Motion! The Government survives.`);
    }
  }
}

function siteAt(p) {
  for (const [key, s] of Object.entries(SITES)) {
    if (Math.hypot(p.x - s.x, p.z - s.z) <= s.radius) return key;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
const vec3 = (a) => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite) ? { x: a[0], y: a[1], z: a[2] } : null;

function handle(p, msg) {
  switch (msg.t) {
    case 'join': {
      if (p.joined) return;
      p.name = cleanName(msg.name);
      const counts = { opp: 0, gov: 0 };
      for (const q of humans()) counts[q.team]++;
      let team = msg.team;
      if (team !== 'opp' && team !== 'gov') team = counts.opp <= counts.gov ? 'opp' : 'gov';
      p.team = team;
      p.joined = true;
      send(p, { t: 'welcome', id: p.id, team });
      announce(`${p.name} joined ${TEAMS[team].name}`);
      manageBots();
      if (game.phase === 'warmup') spawnPlayer(p);
      else send(p, { t: 'event', text: 'Round in progress — you will spawn next round', kind: 'info' });
      break;
    }
    case 'team': {
      if (!p.joined || (msg.team !== 'opp' && msg.team !== 'gov') || msg.team === p.team) return;
      if (p.alive) killPlayer(p, null, 'switch', false);
      p.team = msg.team;
      announce(`${p.name} switched to ${TEAMS[p.team].name}`);
      if (game.phase === 'warmup') p.respawnAt = now() + 1;
      send(p, { t: 'welcome', id: p.id, team: p.team });
      manageBots();
      break;
    }
    case 'bots': {
      if (!p.joined) return;
      const fill = Math.max(0, Math.min(BOTS.maxFill, Math.round(Number(msg.fill))));
      const diff = BOTS.difficulty[msg.difficulty] ? msg.difficulty : game.botDifficulty;
      if (Number.isFinite(fill) && fill !== game.botFill) {
        game.botFill = fill;
        announce(`${p.name} set bots to fill teams up to ${fill} player${fill === 1 ? '' : 's'}`);
      }
      if (diff !== game.botDifficulty) {
        game.botDifficulty = diff;
        for (const q of players.values()) if (q.isBot) q.bot.diff = diff;
        announce(`${p.name} set bot difficulty to ${diff}`);
      }
      break;
    }
    case 'state': {
      if (!p.joined || !p.alive) return;
      const vals = [msg.x, msg.y, msg.z, msg.yaw, msg.pitch];
      if (!vals.every(Number.isFinite)) return;
      p.x = msg.x; p.y = msg.y; p.z = msg.z;
      p.yaw = msg.yaw; p.pitch = msg.pitch;
      p.crouch = !!msg.c;
      if (WEAPONS[msg.w]) p.weapon = msg.w;
      break;
    }
    case 'shoot': {
      if (!p.joined || !p.alive || !WEAPONS[msg.w]) return;
      if (game.phase === 'freeze') return;
      const w = WEAPONS[msg.w];
      const t = now();
      const minGap = (60 / w.rpm) * 0.7;
      if (p.lastShot && t - p.lastShot < minGap) return;
      p.lastShot = t;
      p.pendingShots = Math.min(3, (p.pendingShots || 0) + 1);
      broadcast({ t: 'shot', id: p.id, w: msg.w, o: msg.o, h: msg.h }, p);
      if (msg.w !== 'knife') onNoise(players, p);
      break;
    }
    case 'hit': {
      if (!p.joined || !p.alive || !WEAPONS[msg.w] || !(p.pendingShots > 0)) return;
      const target = players.get(msg.target);
      if (!target || !target.alive || target.team === p.team) return;
      const w = WEAPONS[msg.w];
      const d = Math.hypot(target.x - p.x, target.y - p.y, target.z - p.z);
      if (d > w.range + 3) return;
      p.pendingShots--;
      let point = vec3(msg.p);
      if (!point || Math.hypot(point.x - target.x, point.z - target.z) > 3) point = { x: target.x, y: target.y + 1.2, z: target.z };
      const dx = point.x - p.x, dy = point.y - (p.y + 1.6), dz = point.z - p.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      applyDamage(p, target, msg.w, !!msg.head, point, { x: dx / len, y: dy / len, z: dz / len });
      break;
    }
    case 'action': {
      if (!p.joined || !p.alive) return;
      if (!msg.active) { p.action = null; return; }
      startAction(p, msg.kind);
      break;
    }
    case 'chat': {
      if (!p.joined) return;
      const text = String(msg.text || '').slice(0, 140).trim();
      if (text) chat(p, text);
      break;
    }
    case 'ping': {
      send(p, { t: 'pong', ts: msg.ts });
      if (Number.isFinite(msg.rtt)) p.ping = Math.round(msg.rtt);
      break;
    }
  }
}

wss.on('connection', (ws) => {
  const p = newPlayer({ ws });
  players.set(p.id, p);
  ws.on('message', (data) => {
    if (data.length > 4096) return;
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    if (msg && typeof msg.t === 'string') {
      try { handle(p, msg); } catch (err) { console.error('message error', err); }
    }
  });
  ws.on('close', () => {
    dropMotion(p);
    players.delete(p.id);
    if (p.joined) {
      broadcast({ t: 'left', id: p.id });
      announce(`${p.name} left the game`);
      checkElimination();
    }
  });
});

setInterval(tick, 1000 / TICK_RATE);

server.listen(PORT, () => {
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\n  Wellington Counter-Strike server running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  Network: http://${a}:${PORT}   <- share this with friends on your network`);
  console.log('');
});
