// Server-side bots: they see, hear, path-find, shoot, table and veto the Motion.
import { WEAPONS, SITES, PLAYER, BOTS, SPAWNS } from '../public/shared/config.js';
import { stepBody, raycastColliders } from '../public/js/physics.js';
import { findPath, randomPointNear, randomWalkable } from './nav.js';

const WEAPON_SPEED = { rifle: 0.95, sniper: 0.85, pistol: 1.0, knife: 1.08 };
const CHAT = {
  gov: ['Order! Order!', 'Point of order!', 'The Government stands firm.', 'Next question.', 'I refer the member to my previous answer.'],
  opp: ['Sweet as!', 'Chur bro', 'Yeah nah, too easy', 'Good as gold', 'Shot, bro!'],
};

export function makeBrain(diff) {
  const r = Math.random();
  const weapon = (diff === 'hard' && r < 0.2) || (diff === 'normal' && r < 0.08) ? 'sniper' : r < 0.88 ? 'rifle' : 'pistol';
  return {
    diff, weapon, mag: WEAPONS[weapon].mag, reloadUntil: 0,
    path: null, pathIdx: 0, goalKey: null, goal: null, repathAt: 0, arrivedAt: 0,
    target: null, reactAt: 0, lastKnown: null, nextLook: 0, nextShot: 0, burstLeft: 0,
    strafe: 1, strafeUntil: 0, stuckT: 0, lastPos: null, lastPosAt: 0, jump: false,
    lookYaw: null, heard: null, role: 'B', hurtBy: null, hurtAt: 0, roam: 0,
  };
}

export function resetBrain(p) {
  const b = p.bot;
  Object.assign(b, {
    mag: WEAPONS[b.weapon].mag, reloadUntil: 0, path: null, goalKey: null, goal: null, target: null,
    lastKnown: null, heard: null, hurtBy: null, stuckT: 0, burstLeft: 0, lookYaw: null,
  });
  p.weapon = b.weapon;
}

export function onRoundStart(players, game) {
  game.plan = Math.random() < 0.55 ? 'B' : 'A';
  const govBots = [...players.values()].filter((p) => p.isBot && p.team === 'gov');
  govBots.forEach((p, i) => { p.bot.role = i % 2 === 0 ? 'B' : 'A'; });
}

export function onNoise(players, src) {
  for (const p of players.values()) {
    if (!p.isBot || !p.alive || p.team === src.team || p.bot.target) continue;
    if (Math.hypot(p.x - src.x, p.z - src.z) < 55) p.bot.heard = { x: src.x, z: src.z, t: Date.now() / 1000 };
  }
}

export function onHurt(p, attacker) {
  if (!p.isBot || !attacker) return;
  p.bot.hurtBy = attacker.id;
  p.bot.hurtAt = Date.now() / 1000;
  p.bot.heard = { x: attacker.x, z: attacker.z, t: p.bot.hurtAt };
}

export function maybeChat(p, ctx) {
  if (p.isBot && Math.random() < 0.18) {
    const lines = CHAT[p.team];
    ctx.chat(p, lines[(Math.random() * lines.length) | 0]);
  }
}

const eyeY = (p) => p.y + (p.crouch ? PLAYER.crouchEye : PLAYER.eye);

function canSee(p, e) {
  const ox = p.x, oy = eyeY(p), oz = p.z;
  for (const h of [1.5, 1.0]) {
    const tx = e.x, ty = e.y + (e.crouch ? h * 0.66 : h), tz = e.z;
    const dx = tx - ox, dy = ty - oy, dz = tz - oz;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.01) return true;
    if (raycastColliders(ox, oy, oz, dx / dist, dy / dist, dz / dist, dist) === Infinity) return true;
  }
  return false;
}

// Ray against a player's hit volumes: head sphere + body box. Returns { t, head } or null.
function rayVsPlayer(o, d, e) {
  const crouch = e.crouch;
  const hy = e.y + (crouch ? 1.05 : 1.55);
  let best = null;
  // head sphere r=0.3
  {
    const lx = o.x - e.x, ly = o.y - hy, lz = o.z - e.z;
    const b = lx * d.x + ly * d.y + lz * d.z;
    const c = lx * lx + ly * ly + lz * lz - 0.09;
    const disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      if (t > 0) best = { t, head: true };
    }
  }
  // body box
  {
    const min = [e.x - 0.36, e.y, e.z - 0.36];
    const max = [e.x + 0.36, e.y + (crouch ? 0.85 : 1.32), e.z + 0.36];
    const oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
    let tmin = 0, tmax = Infinity, ok = true;
    for (let k = 0; k < 3 && ok; k++) {
      if (Math.abs(dd[k]) < 1e-9) { if (oo[k] < min[k] || oo[k] > max[k]) ok = false; continue; }
      let t1 = (min[k] - oo[k]) / dd[k], t2 = (max[k] - oo[k]) / dd[k];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) ok = false;
    }
    if (ok && (!best || tmin < best.t)) best = { t: tmin, head: false };
  }
  return best;
}

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function perceive(p, ctx, D, t) {
  const b = p.bot;
  const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
  let best = null, bestD = Infinity;
  for (const e of ctx.players.values()) {
    if (!e.joined || !e.alive || e.team === p.team) continue;
    const dx = e.x - p.x, dz = e.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > D.sight) continue;
    const facing = (dx * fx + dz * fz) / (dist || 1);
    const recentlyHurt = b.hurtBy === e.id && t - b.hurtAt < 3;
    if (facing < 0.3 && dist > 5 && !recentlyHurt) continue;
    if (!canSee(p, e)) continue;
    if (dist < bestD) { best = e; bestD = dist; }
  }
  if (best) {
    if (b.target !== best.id) {
      b.target = best.id;
      b.reactAt = t + D.react * (0.8 + Math.random() * 0.5);
      b.burstLeft = D.burst;
    }
    b.lastKnown = { x: best.x, y: best.y, z: best.z, t };
  } else {
    b.target = null;
  }
}

function chooseGoal(p, ctx, t) {
  const b = p.bot;
  const g = ctx.game;
  const m = g.motion;
  const near = (pt, r) => Math.hypot(p.x - pt.x, p.z - pt.z) < r;
  const keep = (key, makePoint) => (b.goalKey === key && b.goal ? b.goal : makePoint());

  if (g.phase === 'warmup') {
    if (!b.goal || near(b.goal, 2) || t - b.arrivedAt > 25) {
      b.roam++;
      b.arrivedAt = t;
    }
    return { key: 'roam' + b.roam, point: keep('roam' + b.roam, () => randomWalkable()) };
  }

  if (p.team === 'opp') {
    const site = SITES[g.plan || 'B'];
    if (m && !m.planted && m.carrier === p.id) {
      const pt = keep('plant' + g.plan, () => randomPointNear(site.x, site.z, site.radius * 0.5));
      return { key: 'plant' + g.plan, point: pt, action: ctx.siteAt(p) === g.plan ? 'plant' : null };
    }
    if (m && !m.planted && !m.carrier) {
      // Closest living attacker bot goes for the dropped Motion
      let nearest = null, nd = Infinity;
      for (const q of ctx.players.values()) {
        if (!q.isBot || !q.alive || q.team !== 'opp') continue;
        const d = Math.hypot(q.x - m.x, q.z - m.z);
        if (d < nd) { nd = d; nearest = q; }
      }
      if (nearest === p) return { key: 'pickup', point: { x: m.x, y: m.y, z: m.z } };
    }
    if (m && m.planted) {
      return { key: 'guard', point: keep('guard', () => randomPointNear(m.x, m.z, 9)), hold: true };
    }
    if (b.lastKnown && t - b.lastKnown.t < 5) return { key: 'hunt', point: b.lastKnown };
    return { key: 'push' + g.plan, point: keep('push' + g.plan, () => randomPointNear(site.x, site.z, site.radius)), hold: true };
  }

  // Government
  if (m && m.planted) {
    const pt = { x: m.x, y: m.y, z: m.z };
    return { key: 'defuse', point: pt, action: Math.hypot(p.x - m.x, p.z - m.z) < 1.3 ? 'defuse' : null };
  }
  if (b.lastKnown && t - b.lastKnown.t < 4 && Math.hypot(p.x - b.lastKnown.x, p.z - b.lastKnown.z) < 30) {
    return { key: 'hunt', point: b.lastKnown };
  }
  const site = SITES[b.role];
  const key = 'hold' + b.role + Math.floor(t / 20);
  return { key, point: keep(key, () => randomPointNear(site.x, site.z, site.radius * 0.85)), hold: true };
}

export function updateBot(p, ctx, dt) {
  if (!p.alive) return;
  const b = p.bot;
  const D = BOTS.difficulty[b.diff] || BOTS.difficulty.normal;
  const t = ctx.now();
  const g = ctx.game;
  const W = WEAPONS[b.weapon];

  if (t >= b.nextLook) {
    b.nextLook = t + 0.15;
    perceive(p, ctx, D, t);
  }
  const target = b.target ? ctx.players.get(b.target) : null;
  if (b.target && (!target || !target.alive)) b.target = null;

  // ---------------- movement goal ----------------
  const frozen = g.phase === 'freeze';
  const goal = chooseGoal(p, ctx, t);
  if (goal.key !== b.goalKey) {
    b.goalKey = goal.key;
    b.goal = goal.point;
    b.path = null;
  } else if (goal.key === 'pickup' || goal.key === 'defuse' || goal.key === 'hunt') {
    b.goal = goal.point;
  }
  if (!b.path || t >= b.repathAt) {
    b.path = findPath(p, b.goal);
    b.pathIdx = 1;
    b.repathAt = t + (goal.key === 'hunt' || goal.key === 'pickup' ? 1.5 : 6);
  }

  let wishX = 0, wishZ = 0, moving = false;
  const path = b.path;
  if (path && b.pathIdx < path.length) {
    let wp = path[b.pathIdx];
    while (b.pathIdx < path.length - 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.9) wp = path[++b.pathIdx];
    const dx = wp.x - p.x, dz = wp.z - p.z;
    const d = Math.hypot(dx, dz);
    if (b.pathIdx >= path.length - 1 && d < 0.8) {
      b.pathIdx = path.length;
      b.arrivedAt = t;
    } else if (d > 0.01) {
      wishX = dx / d; wishZ = dz / d; moving = true;
    }
  }

  // Wants to plant/defuse: stand still and do it
  if (goal.action && !p.action && !target) ctx.startAction(p, goal.action);
  if (goal.action === 'defuse' && !p.action && target && g.motionTimeLeft < 7) ctx.startAction(p, 'defuse');
  if (p.action) { wishX = wishZ = 0; moving = false; }

  // Combat movement: strafe between bursts, stand still while shooting
  let speed = PLAYER.runSpeed * (WEAPON_SPEED[b.weapon] || 1);
  if (target && !p.action) {
    const dx = target.x - p.x, dz = target.z - p.z;
    const d = Math.hypot(dx, dz) || 1;
    if (t >= b.strafeUntil) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeUntil = t + 0.5 + Math.random() * 0.8; }
    const shooting = t >= b.reactAt && b.burstLeft > 0 && t < b.nextShot + 0.15;
    if (b.diff === 'easy' || shooting || b.weapon === 'sniper') { wishX = wishZ = 0; moving = false; }
    else {
      wishX = (-dz / d) * b.strafe; wishZ = (dx / d) * b.strafe; moving = true;
      speed = PLAYER.walkSpeed;
    }
  } else if (goal.hold && b.pathIdx >= (path ? path.length : 0)) {
    moving = false; wishX = wishZ = 0;
  }
  if (frozen) { wishX = wishZ = 0; moving = false; }

  // Stuck detection
  if (moving) {
    if (!b.lastPos || t - b.lastPosAt > 0.6) {
      const moved = b.lastPos ? Math.hypot(p.x - b.lastPos.x, p.z - b.lastPos.z) : 1;
      b.stuckT = moved < 0.25 ? b.stuckT + (t - b.lastPosAt) : 0;
      b.lastPos = { x: p.x, z: p.z };
      b.lastPosAt = t;
      if (b.stuckT > 0.8) b.jump = true;
      if (b.stuckT > 2.2) {
        b.stuckT = 0;
        b.path = null;
        if (path) b.pathIdx = Math.min(path.length, b.pathIdx + 1);
        b.goal = goal.key.startsWith('roam') ? randomWalkable() : b.goal;
      }
    }
  } else {
    b.stuckT = 0;
  }

  // ---------------- physics ----------------
  const wish = { x: wishX * speed, z: wishZ * speed };
  const sub = 3;
  for (let i = 0; i < sub; i++) {
    stepBody(p, wish, b.jump && i === 0, dt / sub);
  }
  b.jump = false;

  // ---------------- aiming ----------------
  let wantYaw = p.yaw, wantPitch = 0;
  if (target) {
    const aimHead = Math.random() < D.headChance;
    const ty = target.y + (target.crouch ? (aimHead ? 1.05 : 0.65) : (aimHead ? 1.55 : 1.1));
    const dx = target.x - p.x, dz = target.z - p.z, dy = ty - eyeY(p);
    wantYaw = Math.atan2(-dx, -dz);
    wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
  } else if (b.heard && t - b.heard.t < 2.5) {
    wantYaw = Math.atan2(-(b.heard.x - p.x), -(b.heard.z - p.z));
  } else if (moving) {
    wantYaw = Math.atan2(-wishX, -wishZ);
  } else {
    // Holding: watch towards where the enemy comes from, sweeping a little
    if (b.lookYaw === null || Math.random() < 0.01) {
      const spawns = SPAWNS[p.team === 'gov' ? 'opp' : 'gov'];
      const s = spawns[(Math.random() * spawns.length) | 0];
      b.lookYaw = Math.atan2(-(s.x - p.x), -(s.z - p.z)) + (Math.random() - 0.5) * 1.6;
    }
    wantYaw = b.lookYaw + Math.sin(t * 0.7) * 0.3;
  }
  const maxTurn = D.turn * dt;
  const dy = angleDiff(p.yaw, wantYaw);
  p.yaw += Math.max(-maxTurn, Math.min(maxTurn, dy));
  const dp = wantPitch - p.pitch;
  p.pitch += Math.max(-maxTurn, Math.min(maxTurn, dp));

  // ---------------- shooting ----------------
  if (b.reloadUntil && t >= b.reloadUntil) {
    b.reloadUntil = 0;
    b.mag = W.mag;
  }
  const canShoot = target && !p.action && !frozen && t >= b.reactAt && !b.reloadUntil && g.phase !== 'freeze';
  const aimErr = Math.abs(angleDiff(p.yaw, wantYaw)) + Math.abs(wantPitch - p.pitch);
  if (canShoot && aimErr < 0.12 && t >= b.nextShot) {
    if (b.mag <= 0) {
      b.reloadUntil = t + W.reload;
    } else {
      fireShot(p, ctx, D, W, moving);
      b.mag--;
      b.burstLeft--;
      b.nextShot = t + 60 / W.rpm;
      if (b.burstLeft <= 0) {
        b.burstLeft = D.burst + ((Math.random() * 2) | 0);
        b.nextShot += 0.2 + Math.random() * 0.35;
      }
    }
  } else if (!target && b.mag < W.mag * 0.4 && !b.reloadUntil) {
    b.reloadUntil = t + W.reload;
  }
}

function gauss() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
}

function fireShot(p, ctx, D, W, moving) {
  const o = { x: p.x, y: eyeY(p), z: p.z };
  let spread = W.spread + D.error;
  if (W.scope) spread = W.scopedSpread + D.error * 0.5;
  if (moving) spread += W.moveSpread * 0.5;
  const yaw = p.yaw + gauss() * spread;
  const pitch = p.pitch + gauss() * spread;
  const d = { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) };
  const wall = raycastColliders(o.x, o.y, o.z, d.x, d.y, d.z, W.range);
  let hit = null, victim = null;
  for (const e of ctx.players.values()) {
    if (!e.joined || !e.alive || e === p || e.team === p.team) continue;
    const r = rayVsPlayer(o, d, e);
    if (r && r.t < wall && r.t < W.range && (!hit || r.t < hit.t)) { hit = r; victim = e; }
  }
  const dist = hit ? hit.t : Math.min(wall, W.range);
  const h = { x: o.x + d.x * dist, y: o.y + d.y * dist, z: o.z + d.z * dist };
  const m = { x: o.x + d.x * 0.6 + Math.cos(p.yaw) * 0.15, y: o.y - 0.15, z: o.z + d.z * 0.6 - Math.sin(p.yaw) * 0.15 };
  const r2 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  ctx.broadcast({ t: 'shot', id: p.id, w: b_weapon(p), o: r2(m), h: r2(h) });
  ctx.noise(p);
  if (victim) ctx.applyDamage(p, victim, b_weapon(p), hit.head, h, d);
}

const b_weapon = (p) => p.bot.weapon;
