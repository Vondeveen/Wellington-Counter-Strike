// Navigation grid for bots, generated automatically from the map's colliders.
import { BOUNDS, PLAYER } from '../public/shared/config.js';
import { groundHeight, spaceFree } from '../public/js/physics.js';

const CELL = 1.5;
const R = 0.45;
const NX = Math.ceil((BOUNDS.maxX - BOUNDS.minX) / CELL);
const NZ = Math.ceil((BOUNDS.maxZ - BOUNDS.minZ) / CELL);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const height = new Float32Array(NX * NZ).fill(NaN);
const edges = new Uint8Array(NX * NZ);
const walkableList = [];

const cx = (i) => BOUNDS.minX + (i + 0.5) * CELL;
const cz = (j) => BOUNDS.minZ + (j + 0.5) * CELL;
export const cellOf = (x, z) => {
  const i = Math.floor((x - BOUNDS.minX) / CELL);
  const j = Math.floor((z - BOUNDS.minZ) / CELL);
  if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1;
  return j * NX + i;
};

export function buildNav(seeds) {
  const t0 = Date.now();
  const queue = [];
  for (const s of seeds) {
    const c = cellOf(s.x, s.z);
    if (c < 0 || !Number.isNaN(height[c])) continue;
    const i = c % NX, j = (c / NX) | 0;
    const h = groundHeight(cx(i), cz(j), s.y || 0);
    if (!spaceFree(cx(i), cz(j), h, R)) continue;
    height[c] = h;
    queue.push(c);
  }
  while (queue.length) {
    const c = queue.pop();
    const i = c % NX, j = (c / NX) | 0;
    const h = height[c];
    for (let d = 0; d < 8; d++) {
      const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const n = nj * NX + ni;
      const x = cx(ni), z = cz(nj);
      const nh = groundHeight(x, z, h);
      if (Math.abs(nh - h) > PLAYER.stepHeight + 0.12) continue;
      if (!Number.isNaN(height[n]) && Math.abs(height[n] - nh) > 0.05) continue;
      if (!spaceFree(x, z, nh, R)) continue;
      const mx = (cx(i) + x) / 2, mz = (cz(j) + z) / 2;
      if (!spaceFree(mx, mz, Math.max(h, nh), R)) continue;
      if (Number.isNaN(height[n])) {
        height[n] = nh;
        queue.push(n);
      }
    }
  }
  walkableList.length = 0;
  for (let c = 0; c < NX * NZ; c++) if (!Number.isNaN(height[c])) walkableList.push(c);
  linkAll();
  return { cells: walkableList.length, ms: Date.now() - t0 };
}

// Index of the opposite direction in DIRS
const OPP = [1, 0, 3, 2, 7, 6, 5, 4];

function linkAll() {
  edges.fill(0);
  for (const c of walkableList) {
    const i = c % NX, j = (c / NX) | 0;
    for (let d = 0; d < 8; d++) {
      const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
      if (ni < 0 || nj < 0 || ni >= NX || nj >= NZ) continue;
      const n = nj * NX + ni;
      if (Number.isNaN(height[n])) continue;
      if (linkOk(c, n, d)) {
        edges[c] |= 1 << d;
        edges[n] |= 1 << OPP[d];
      }
    }
  }
}

function linkOk(c, n, d) {
  const i = c % NX, j = (c / NX) | 0;
  const ni = n % NX, nj = (n / NX) | 0;
  const h = height[c], nh = height[n];
  if (Math.abs(nh - h) > PLAYER.stepHeight + 0.12) return false;
  const mx = (cx(i) + cx(ni)) / 2, mz = (cz(j) + cz(nj)) / 2;
  if (!spaceFree(mx, mz, Math.max(h, nh), R)) return false;
  if (d >= 4) {
    // Diagonals only when both orthogonal neighbours are open (no corner cutting)
    const a = j * NX + ni, b = nj * NX + i;
    if (Number.isNaN(height[a]) || Number.isNaN(height[b])) return false;
  }
  return true;
}

export function isWalkable(x, z) {
  const c = cellOf(x, z);
  return c >= 0 && !Number.isNaN(height[c]);
}

export function heightAt(x, z) {
  const c = cellOf(x, z);
  return c >= 0 ? height[c] : NaN;
}

// Nearest walkable cell to a point (searching outward)
function nearestCell(x, z) {
  const c0 = cellOf(x, z);
  if (c0 >= 0 && !Number.isNaN(height[c0]) && edges[c0]) return c0;
  const i0 = Math.floor((x - BOUNDS.minX) / CELL), j0 = Math.floor((z - BOUNDS.minZ) / CELL);
  for (let r = 1; r < 8; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di, j = j0 + dj;
        if (i < 0 || j < 0 || i >= NX || j >= NZ) continue;
        const c = j * NX + i;
        if (!Number.isNaN(height[c]) && edges[c]) return c;
      }
    }
  }
  return -1;
}

export function randomPointNear(x, z, radius) {
  for (let k = 0; k < 30; k++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    const c = cellOf(px, pz);
    if (c >= 0 && !Number.isNaN(height[c]) && edges[c]) return { x: cx(c % NX), y: height[c], z: cz((c / NX) | 0) };
  }
  const c = nearestCell(x, z);
  return c >= 0 ? { x: cx(c % NX), y: height[c], z: cz((c / NX) | 0) } : { x, y: 0, z };
}

export function randomWalkable() {
  const c = walkableList[(Math.random() * walkableList.length) | 0];
  return { x: cx(c % NX), y: height[c], z: cz((c / NX) | 0) };
}

// ---- A* -----------------------------------------------------------------------------
const gScore = new Float32Array(NX * NZ);
const came = new Int32Array(NX * NZ);
const visitStamp = new Uint32Array(NX * NZ);
const closedStamp = new Uint32Array(NX * NZ);
let stamp = 0;

class Heap {
  constructor() { this.a = []; }
  push(c, f) {
    const a = this.a;
    a.push([f, c]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() { return this.a.length; }
}

export function findPath(from, to) {
  const s = nearestCell(from.x, from.z);
  const g = nearestCell(to.x, to.z);
  if (s < 0 || g < 0) return null;
  stamp++;
  const gi = g % NX, gj = (g / NX) | 0;
  const hfn = (c) => {
    const dx = Math.abs((c % NX) - gi), dz = Math.abs(((c / NX) | 0) - gj);
    return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * CELL;
  };
  const open = new Heap();
  gScore[s] = 0;
  visitStamp[s] = stamp;
  came[s] = -1;
  open.push(s, hfn(s));
  let found = false;
  let iter = 0;
  while (open.size && iter++ < 60000) {
    const c = open.pop();
    if (c === g) { found = true; break; }
    if (closedStamp[c] === stamp) continue;
    closedStamp[c] = stamp;
    const i = c % NX, j = (c / NX) | 0;
    const e = edges[c];
    for (let d = 0; d < 8; d++) {
      if (!(e & (1 << d))) continue;
      const n = (j + DIRS[d][1]) * NX + (i + DIRS[d][0]);
      if (closedStamp[n] === stamp) continue;
      const ng = gScore[c] + (d < 4 ? CELL : CELL * 1.414);
      if (visitStamp[n] !== stamp || ng < gScore[n]) {
        visitStamp[n] = stamp;
        gScore[n] = ng;
        came[n] = c;
        open.push(n, ng + hfn(n));
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = g; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map((c) => ({ x: cx(c % NX), y: height[c], z: cz((c / NX) | 0) }));
  return smooth(pts);
}

// Straight-line walkability between two points (for path smoothing)
function lineClear(a, b) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.ceil(dist / 0.5);
  let prevH = a.y;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
    const h = heightAt(x, z);
    if (Number.isNaN(h) || Math.abs(h - prevH) > PLAYER.stepHeight + 0.12) return false;
    if (!spaceFree(x, z, h, 0.42)) return false;
    prevH = h;
  }
  return true;
}

function smooth(pts) {
  if (pts.length < 3) return pts;
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 24);
    while (j > i + 1 && !lineClear(pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}
