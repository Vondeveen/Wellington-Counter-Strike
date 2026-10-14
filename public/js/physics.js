import { PLAYER, BOUNDS } from '../shared/config.js';

// Colliders are boxes that may be rotated around the Y axis (oriented bounding boxes).
// { cx, cz, hx, hz, minY, maxY, cos, sin, br }
export const colliders = [];

export function addCollider(cx, cz, w, d, minY, maxY, rot = 0) {
  const c = {
    cx, cz, hx: w / 2, hz: d / 2, minY, maxY,
    cos: Math.cos(rot), sin: Math.sin(rot),
  };
  c.br = Math.hypot(c.hx, c.hz);
  colliders.push(c);
  return c;
}

// world -> box local
function toLocal(c, x, z) {
  const dx = x - c.cx;
  const dz = z - c.cz;
  return [dx * c.cos - dz * c.sin, dx * c.sin + dz * c.cos];
}
// box local -> world delta
function toWorldDelta(c, lx, lz) {
  return [lx * c.cos + lz * c.sin, -lx * c.sin + lz * c.cos];
}

function near(c, x, z, r) {
  return Math.abs(x - c.cx) <= c.br + r && Math.abs(z - c.cz) <= c.br + r;
}

// Push a circle at (x,z) out of a collider. Returns [nx, nz] or null when not overlapping.
function pushOut(c, x, z, r) {
  const [lx, lz] = toLocal(c, x, z);
  if (Math.abs(lx) >= c.hx + r || Math.abs(lz) >= c.hz + r) return null;
  const qx = Math.max(-c.hx, Math.min(c.hx, lx));
  const qz = Math.max(-c.hz, Math.min(c.hz, lz));
  let dx = lx - qx;
  let dz = lz - qz;
  const d = Math.hypot(dx, dz);
  let px, pz;
  if (d > 1e-6) {
    if (d >= r) return null;
    const k = (r - d) / d;
    px = dx * k;
    pz = dz * k;
  } else {
    // Centre is inside the box: leave by the shallowest side
    const ox = c.hx + r - Math.abs(lx);
    const oz = c.hz + r - Math.abs(lz);
    if (ox < oz) { px = Math.sign(lx || 1) * ox; pz = 0; } else { px = 0; pz = Math.sign(lz || 1) * oz; }
  }
  const [wx, wz] = toWorldDelta(c, px, pz);
  return [x + wx, z + wz];
}

function insideFootprint(c, x, z, margin) {
  const [lx, lz] = toLocal(c, x, z);
  return Math.abs(lx) <= c.hx + margin && Math.abs(lz) <= c.hz + margin;
}

export function groundHeight(x, z, feetY, r = PLAYER.radius) {
  let g = 0;
  const limit = feetY + PLAYER.stepHeight;
  for (const c of colliders) {
    if (c.maxY > limit || c.maxY <= g) continue;
    if (!near(c, x, z, r)) continue;
    if (insideFootprint(c, x, z, r * 0.5)) g = c.maxY;
  }
  return g;
}

function blockedAbove(x, z, fromY, toY, r) {
  for (const c of colliders) {
    if (c.minY < fromY - 0.01 || c.minY >= toY) continue;
    if (!near(c, x, z, r)) continue;
    if (pushOut(c, x, z, r * 0.9)) return c.minY;
  }
  return null;
}

export function canStand(body) {
  return blockedAbove(body.x, body.z, body.y + PLAYER.crouchHeight, body.y + PLAYER.height, PLAYER.radius) === null;
}

function resolveHorizontal(body, height) {
  const r = PLAYER.radius;
  const feet = body.y;
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (const c of colliders) {
      if (c.maxY <= feet + PLAYER.stepHeight || c.minY >= feet + height) continue;
      if (!near(c, body.x, body.z, r)) continue;
      const p = pushOut(c, body.x, body.z, r);
      if (p) {
        body.x = p[0];
        body.z = p[1];
        any = true;
      }
    }
    if (!any) break;
  }
  body.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, body.x));
  body.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, body.z));
}

/**
 * Advance a player body. body: { x, y, z, vx, vy, vz, onGround, crouch }
 * wish: { x, z } desired horizontal velocity (m/s), jump: boolean
 */
export function stepBody(body, wish, jump, dt) {
  const height = body.crouch ? PLAYER.crouchHeight : PLAYER.height;

  // Horizontal acceleration: snappy on the ground, limited in the air
  const accel = body.onGround ? 14 : 2.5;
  const t = Math.min(1, accel * dt);
  body.vx += (wish.x - body.vx) * t;
  body.vz += (wish.z - body.vz) * t;

  if (jump && body.onGround) {
    body.vy = PLAYER.jumpVel;
    body.onGround = false;
  }

  // Sub-step to avoid tunnelling through thin walls
  const steps = Math.max(1, Math.ceil((Math.hypot(body.vx, body.vz) * dt) / 0.2));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    body.x += body.vx * sdt;
    body.z += body.vz * sdt;
    resolveHorizontal(body, height);
  }

  // Vertical
  const wasGround = body.onGround;
  const oldY = body.y;
  body.vy -= PLAYER.gravity * dt;
  body.y += body.vy * dt;

  if (body.vy > 0) {
    const ceil = blockedAbove(body.x, body.z, oldY + height, body.y + height, PLAYER.radius);
    if (ceil !== null) {
      body.y = ceil - height;
      body.vy = 0;
    }
  }

  const g = groundHeight(body.x, body.z, Math.max(oldY, body.y));
  if (body.y <= g) {
    body.y = g;
    body.vy = 0;
    body.onGround = true;
  } else if (wasGround && body.vy <= 0 && oldY - g <= PLAYER.stepHeight + 0.05) {
    // Stick to the ground when walking down stairs
    body.y = g;
    body.vy = 0;
    body.onGround = true;
  } else {
    body.onGround = false;
  }
}
