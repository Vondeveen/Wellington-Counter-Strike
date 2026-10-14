import * as THREE from 'three';
import { tex } from './textures.js';
import { addCollider, colliders } from './physics.js';
import { SITES } from '../shared/config.js';

// Parliament grounds, Wellington — an approximate, game-friendly layout.
//   +x east (Lambton Quay)   -z north (Bowen St)   -x west (Molesworth St)
//
//   Bowen House            Bowen St                       Cenotaph
//   ─────────────────────────────────────────────────────────┐
//     gov spawn            ( Beehive )  ← site B              │ Lambton
//   ┌──────────────┐                                         │ Quay
//   │ Parliament   │ ▌steps   front lawn   Seddon            │
//   │  House  [A]  │                                 main gate│ opp spawn
//   └──────────────┘                                         │
//   [ Parliamentary Library ]                                 │

const SHADOWS = { cast: true, receive: true };

export function buildMap(scene) {
  const worldMeshes = []; // things bullets hit
  const animated = [];
  const labels = [];

  // ---- materials -----------------------------------------------------------
  const lambert = (opts) => new THREE.MeshLambertMaterial(opts);
  const M = {
    grass: lambert({ map: tex.grass() }),
    asphalt: lambert({ map: tex.asphalt() }),
    paving: lambert({ map: tex.paving() }),
    parliament: lambert({ map: tex.parliament() }),
    stoneLight: lambert({ color: '#cfcdc6' }),
    stoneDark: lambert({ color: '#8f8c86' }),
    granite: lambert({ color: '#6d6a68' }),
    marble: lambert({ map: tex.marbleFloor() }),
    carpet: lambert({ map: tex.carpet() }),
    wood: lambert({ map: tex.wood() }),
    woodDark: lambert({ color: '#3d2615' }),
    leather: lambert({ color: '#2f6b45' }),
    library: lambert({ map: tex.library() }),
    slate: lambert({ color: '#4a5058' }),
    beehiveWhite: lambert({ color: '#ece8de' }),
    beehiveLobby: lambert({ map: tex.beehiveLobby() }),
    copper: lambert({ color: '#7b5034' }),
    bronze: lambert({ color: '#4b3a26' }),
    concrete: lambert({ color: '#a29e95' }),
    hedge: lambert({ color: '#2d5a26' }),
    trunk: lambert({ color: '#5a4030' }),
    canopy: lambert({ color: '#2f5f2b' }),
    canopy2: lambert({ color: '#3a6d30' }),
    iron: lambert({ color: '#1d1f22' }),
    railing: lambert({ map: tex.railing(), alphaTest: 0.5, side: THREE.DoubleSide }),
    white: lambert({ color: '#f2f2f2' }),
    gold: lambert({ color: '#d8b04a', emissive: '#3a2a00' }),
    glassDark: lambert({ color: '#2a3540' }),
    tyre: lambert({ color: '#151515' }),
    roadLine: lambert({ color: '#e8e8e0' }),
    yellowLine: lambert({ color: '#e0c030' }),
  };

  // ---- helpers ---------------------------------------------------------------
  function scaleBoxUV(geo, w, h, d, s) {
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const idx = f * 4 + i;
        uv.setXY(idx, uv.getX(idx) * dims[f][0] / s, uv.getY(idx) * dims[f][1] / s);
      }
    }
    uv.needsUpdate = true;
  }

  // x/z = centre, y = bottom
  function box(x, y, z, w, h, d, mat, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, o.uv || 4);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = o.rot || 0;
    mesh.castShadow = o.cast !== false && SHADOWS.cast;
    mesh.receiveShadow = SHADOWS.receive;
    scene.add(mesh);
    if (o.collide !== false) addCollider(x, z, w, d, y, y + h, o.rot || 0);
    if (o.hit !== false) worldMeshes.push(mesh);
    return mesh;
  }

  function cyl(x, y, z, rt, rb, h, mat, o = {}) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, o.seg || 16, 1, !!o.open);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = o.cast !== false;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (o.collide) {
      const s = Math.max(rt, rb) * 1.6;
      addCollider(x, z, s, s, y, y + h);
    }
    if (o.hit !== false) worldMeshes.push(mesh);
    return mesh;
  }

  function flat(x0, z0, x1, z1, mat, y = 0.01, s = 4) {
    const w = x1 - x0;
    const d = z1 - z0;
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / s, uv.getY(i) * d / s);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  function disk(x, z, r, mat, y = 0.02) {
    const geo = new THREE.CircleGeometry(r, 48);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r / 2, uv.getY(i) * r / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  }

  // Wall along an axis with door openings. axis 'x': runs from a0..a1 in x at fixed z=c.
  function wall(axis, c, a0, a1, y0, y1, thick, mat, doors = [], o = {}) {
    const segs = [];
    let cur = a0;
    const sorted = [...doors].sort((p, q) => p[0] - q[0]);
    for (const [d0, d1, top] of sorted) {
      if (d0 > cur) segs.push([cur, d0, y0, y1]);
      if (top !== undefined && top < y1) segs.push([d0, d1, top, y1]);
      cur = d1;
    }
    if (cur < a1) segs.push([cur, a1, y0, y1]);
    for (const [s0, s1, h0, h1] of segs) {
      const len = s1 - s0;
      const mid = (s0 + s1) / 2;
      if (axis === 'x') box(mid, h0, c, len, h1 - h0, thick, mat, o);
      else box(c, h0, mid, thick, h1 - h0, len, mat, o);
    }
  }

  // Stairs: top at height `h`, descending in direction (dx,dz) from edge point (x,z)
  function stairs(x, z, dirX, dirZ, width, h, n, mat) {
    const run = 1;
    for (let i = 0; i < n; i++) {
      const top = h - (i * h) / n;
      const cx = x + dirX * (i + 0.5) * run;
      const cz = z + dirZ * (i + 0.5) * run;
      const w = dirX !== 0 ? run : width;
      const d = dirX !== 0 ? width : run;
      box(cx, 0, cz, w, top, d, mat, { uv: 2 });
    }
  }

  function textPlane(texture, w, h, x, y, z, rotY = 0, opts = {}) {
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: !!opts.transparent, side: THREE.DoubleSide, depthWrite: !opts.transparent });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    if (opts.floor) mesh.rotation.set(-Math.PI / 2, 0, opts.rotZ || 0);
    scene.add(mesh);
    return mesh;
  }

  function signBoard(lines, x, z, rotY, colours) {
    box(x, 0, z, 0.25, 1.0, 0.25, M.iron, { rot: rotY });
    const t = tex.sign(lines, ...(colours || []));
    const p = textPlane(t, 3.2, 0.8, x, 1.5, z, rotY);
    const back = p.clone();
    back.rotation.y = rotY + Math.PI;
    scene.add(back);
  }

  function tree(x, z, scale = 1) {
    box(x, 0, z, 0.5 * scale, 3 * scale, 0.5 * scale, M.trunk, { uv: 1 });
    const blobs = [[0, 4, 0, 2.6], [1.4, 3.6, 0.6, 1.9], [-1.3, 3.7, -0.5, 2], [0.3, 3.5, -1.4, 1.8], [-0.4, 4.6, 1.1, 1.7]];
    for (const [bx, by, bz, r] of blobs) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * scale, 1), Math.random() > 0.5 ? M.canopy : M.canopy2);
      m.position.set(x + bx * scale, by * scale, z + bz * scale);
      m.castShadow = true;
      scene.add(m);
    }
  }

  function cabbageTree(x, z) {
    box(x, 0, z, 0.3, 4.2, 0.3, M.trunk, { uv: 1 });
    const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), M.canopy2);
    leaves.position.set(x, 4.6, z);
    leaves.scale.set(1, 0.8, 1);
    leaves.castShadow = true;
    scene.add(leaves);
  }

  function car(x, z, rot, color) {
    const body = lambert({ color });
    box(x, 0.25, z, 1.9, 0.75, 4.4, body, { rot, uv: 2 });
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.3), M.glassDark);
    cab.position.set(x, 1.3, z);
    cab.rotation.y = rot;
    cab.castShadow = true;
    scene.add(cab);
    worldMeshes.push(cab);
    for (const [ox, oz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.25, 12), M.tyre);
      wheel.rotation.z = Math.PI / 2;
      const c = Math.cos(rot), s = Math.sin(rot);
      wheel.position.set(x + ox * c + oz * s, 0.34, z - ox * s + oz * c);
      wheel.rotation.y = rot;
      scene.add(wheel);
    }
  }

  function bus(x, z, rot) {
    const m = lambert({ color: '#e6e1cf' });
    box(x, 0.35, z, 2.6, 2.9, 12, m, { rot, uv: 3 });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.64, 0.9, 11.6), M.glassDark);
    stripe.position.set(x, 2.1, z);
    stripe.rotation.y = rot;
    scene.add(stripe);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.25, 12.02), lambert({ color: '#c8a400' }));
    band.position.set(x, 0.9, z);
    band.rotation.y = rot;
    scene.add(band);
  }

  function fenceLine(axis, c, a0, a1, gaps) {
    const segs = [];
    let cur = a0;
    for (const [g0, g1] of gaps) {
      segs.push([cur, g0]);
      cur = g1;
    }
    segs.push([cur, a1]);
    for (const [s0, s1] of segs) {
      if (s1 - s0 <= 0) continue;
      const mid = (s0 + s1) / 2;
      const len = s1 - s0;
      const [x, z, w, d] = axis === 'x' ? [mid, c, len, 0.5] : [c, mid, 0.5, len];
      box(x, 0, z, w, 0.8, d, M.stoneDark, { uv: 2 });
      // See-through iron railings; the collider is tall enough that the fence can't be hopped
      const railGeo = new THREE.PlaneGeometry(len, 1.1);
      const uv = railGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * len / 0.6);
      const rail = new THREE.Mesh(railGeo, M.railing);
      rail.position.set(x, 1.35, z);
      if (axis === 'z') rail.rotation.y = Math.PI / 2;
      scene.add(rail);
      addCollider(x, z, w, d, 0.8, 2.2);
      for (const p of [s0, s1]) {
        const [px, pz] = axis === 'x' ? [p, c] : [c, p];
        box(px, 0, pz, 0.9, 2.1, 0.9, M.stoneLight, { uv: 2 });
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 8), M.stoneLight);
        cap.position.set(px, 2.35, pz);
        scene.add(cap);
      }
    }
  }

  function siteMarker(key) {
    const s = SITES[key];
    const t = tex.label(key, '#ffffff', 'rgba(0,0,0,0)');
    const y = key === 'A' ? 1.23 : 0.04;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.radius - 0.15, s.radius, 64),
      new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, y + 0.01, s.z);
    scene.add(ring);
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(4, 1),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, depthWrite: false }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.x + (key === 'A' ? 3.5 : 6.5), y + 0.02, s.z);
    scene.add(letter);
  }

  // ---- ground, roads ----------------------------------------------------------
  flat(-300, -300, 300, 300, M.paving, 0, 6);
  flat(-54, -44, 52, 48, M.grass, 0.01, 6);
  // Roads
  flat(54, -120, 68, 120, M.asphalt, 0.012, 6); // Lambton Quay
  flat(-120, -56, 44, -46, M.asphalt, 0.012, 6); // Bowen St
  flat(-66, -120, -56, 120, M.asphalt, 0.013, 6); // Molesworth St
  flat(-120, 50, 120, 58, M.asphalt, 0.014, 6); // Museum St
  for (let z = -116; z < 120; z += 6) flat(60.85, z, 61.15, z + 3, M.roadLine, 0.02);
  for (let x = -116; x < 44; x += 6) flat(x, -51.15, x + 3, -50.85, M.roadLine, 0.02);
  for (let z = -116; z < 120; z += 6) flat(-61.15, z, -60.85, z + 3, M.roadLine, 0.02);
  flat(54.4, -40, 54.6, 48, M.yellowLine, 0.02);
  // Paths and forecourts inside the grounds
  flat(-36, -44, 12, -10, M.paving, 0.02); // north forecourt (gov spawn)
  flat(6, -12, 20, 16, M.paving, 0.02); // front steps forecourt
  flat(20, 8, 52, 12, M.paving, 0.02); // main drive from the gates
  flat(-54, -44, -36, 48, M.paving, 0.02); // west car park
  flat(-40, 14, -10, 20, M.paving, 0.02); // courtyard
  flat(-12, 14, 6, 48, M.paving, 0.021);
  flat(12, 36, 52, 40, M.paving, 0.021);
  disk(28, -24, 20, M.paving, 0.025); // Beehive plaza
  flat(44, -56, 54, -44, M.paving, 0.016); // Cenotaph plaza

  // ---- Parliament House -------------------------------------------------------
  {
    const X0 = -36, X1 = 6, Z0 = -10, Z1 = 14, FL = 1.2, TOP = 15, T = 0.8;
    // Floor slab
    box((X0 + X1) / 2, 0, (Z0 + Z1) / 2, X1 - X0, FL, Z1 - Z0, M.stoneDark, { hit: true });
    flat(-12, Z0, X1, Z1, M.marble, FL + 0.01, 4);
    flat(X0, Z0, -12, Z1, M.marble, FL + 0.01, 4);
    flat(-30, -6, -12, 10, M.carpet, FL + 0.02, 2);
    const door = 4 + FL;
    wall('z', X1, Z0, Z1, 0, TOP, T, M.parliament, [[0, 4, door]], { uv: 8 }); // east (front)
    wall('z', X0, Z0, Z1, 0, TOP, T, M.parliament, [[0, 4, door]], { uv: 8 }); // west
    wall('x', Z0, X0 - T / 2, X1 + T / 2, 0, TOP, T, M.parliament, [[-4, 0, door]], { uv: 8 }); // north
    wall('x', Z1, X0 - T / 2, X1 + T / 2, 0, TOP, T, M.parliament, [[-33, -29, door]], { uv: 8 }); // south
    // Ceiling and roof
    box((X0 + X1) / 2, 7, (Z0 + Z1) / 2, X1 - X0, 0.5, Z1 - Z0, M.stoneLight, { cast: false });
    box((X0 + X1) / 2, TOP, (Z0 + Z1) / 2, X1 - X0 + 1.6, 0.6, Z1 - Z0 + 1.6, M.stoneLight, { collide: false });
    box((X0 + X1) / 2, TOP + 0.6, (Z0 + Z1) / 2, X1 - X0 - 6, 2.4, Z1 - Z0 - 6, M.stoneLight, { collide: false });
    // Steps & portico
    stairs(X1 + T / 2, 2, 1, 0, 22, FL, 4, M.stoneLight);
    stairs(X0 - T / 2, 2, -1, 0, 8, FL, 4, M.stoneLight);
    stairs(-2, Z0 - T / 2, 0, -1, 7, FL, 4, M.stoneLight);
    stairs(-31, Z1 + T / 2, 0, 1, 7, FL, 4, M.stoneLight);
    for (const z of [-7.5, -4.5, -1.5, 5.5, 8.5, 11.5]) {
      cyl(X1 + 1.1, FL, z, 0.42, 0.48, 11.8, M.stoneLight, { collide: true, seg: 14 });
      box(X1 + 1.1, FL, z, 1.2, 0.4, 1.2, M.stoneLight, { collide: false });
    }
    box(X1 + 1.1, 13, 2, 1.6, 1.6, 21, M.stoneLight, { collide: false });
    textPlane(tex.sign(['PARLIAMENT HOUSE', 'Whare Pāremata'], '#d8d6cf', '#2a2a2a'), 9, 1.4, X1 + 1.95, 13.8, 2, Math.PI / 2);

    // Interior: Debating Chamber (site A)
    const CH = 7;
    wall('z', -30, -6, 10, FL, CH, 0.5, M.wood, [], { uv: 3 });
    wall('z', -12, -6, 10, FL, CH, 0.5, M.wood, [[0, 4, door]], { uv: 3 });
    wall('x', -6, -30.25, -11.75, FL, CH, 0.5, M.wood, [[-24, -20, door]], { uv: 3 });
    wall('x', 10, -30.25, -11.75, FL, CH, 0.5, M.wood, [[-24, -20, door]], { uv: 3 });
    // Benches (government north, opposition south), split by aisles under the doors
    for (const [x0, x1] of [[-28.5, -24.2], [-19.8, -13]]) {
      const w = x1 - x0, cx = (x0 + x1) / 2;
      box(cx, FL, -5.2, w, 1.3, 0.8, M.leather, { uv: 1 });
      box(cx, FL, -3.8, w, 1.0, 0.8, M.leather, { uv: 1 });
      box(cx, FL, 9.2, w, 1.3, 0.8, M.leather, { uv: 1 });
      box(cx, FL, 7.8, w, 1.0, 0.8, M.leather, { uv: 1 });
    }
    // Table of the House with the Mace, Speaker's chair
    box(-21, FL, 2, 4, 1.0, 1.8, M.wood, { uv: 1 });
    const mace = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 1.4, 10), M.gold);
    mace.rotation.z = Math.PI / 2;
    mace.position.set(-21, FL + 1.1, 2.3);
    scene.add(mace);
    const maceHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), M.gold);
    maceHead.position.set(-20.25, FL + 1.12, 2.3);
    scene.add(maceHead);
    box(-29.1, FL, 2, 1.2, 2.8, 2.0, M.woodDark, { uv: 1 });
    box(-28.2, FL, 2, 0.8, 0.6, 1.4, M.leather, { uv: 1 });
    textPlane(tex.sign(['DEBATING CHAMBER', 'Site A'], '#3d2615', '#e8d9a8'), 4, 1, -29.7, 5.2, 2, Math.PI / 2);

    // Lobby
    for (const [x, z] of [[-7, -3], [-7, 7], [0, -3], [0, 7]]) {
      box(x, FL, z, 1.0, CH - FL, 1.0, M.stoneLight, { uv: 2 });
    }
    box(-3.5, FL, 2, 1.0, 1.1, 2.6, M.wood, { uv: 1 });
    // Corridors get a few crates of Hansard
    box(-33, FL, -7.5, 1.2, 1.2, 1.2, M.wood, { uv: 1 });
    box(-33, FL, 11.5, 1.2, 1.2, 1.2, M.wood, { uv: 1 });
    box(-18, FL, -8.4, 1.6, 1.0, 1.0, M.wood, { uv: 1 });
    box(-8, FL, 12, 1.2, 1.4, 1.2, M.wood, { uv: 1 });

    const light1 = new THREE.PointLight('#ffe8c0', 40, 30, 1.5);
    light1.position.set(-21, 6, 2);
    scene.add(light1);
    const light2 = new THREE.PointLight('#fff4e0', 30, 26, 1.5);
    light2.position.set(-3, 6, 2);
    scene.add(light2);
    siteMarker('A');
  }

  // ---- The Beehive (Executive Wing) -------------------------------------------
  {
    const CX = 28, CZ = -24, R = 15, H = 5;
    disk(CX, CZ, R, M.marble, 0.03);
    const doors = [0, -90, 150].map((d) => (d * Math.PI) / 180);
    const segN = 36;
    for (let i = 0; i < segN; i++) {
      const a = ((i + 0.5) / segN) * Math.PI * 2;
      const isDoor = doors.some((d) => {
        let diff = Math.abs(a - ((d + Math.PI * 2) % (Math.PI * 2)));
        diff = Math.min(diff, Math.PI * 2 - diff);
        return diff < Math.PI / 18 + 0.01;
      });
      const x = CX + Math.cos(a) * R;
      const z = CZ + Math.sin(a) * R;
      const rot = -a - Math.PI / 2;
      if (isDoor) {
        box(x, 4.2, z, 2.75, H - 4.2, 0.5, M.beehiveWhite, { rot, collide: false });
        continue;
      }
      box(x, 0, z, 2.75, H, 0.5, M.beehiveLobby, { rot, uv: 5 });
    }
    // Lift core (octagon)
    const core = cyl(CX, 0, CZ, 4, 4, H, M.beehiveWhite, { seg: 8 });
    core.rotation.y = Math.PI / 8; // flat faces towards the compass points
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      addCollider(CX + Math.cos(a) * 3.45, CZ + Math.sin(a) * 3.45, 3.1, 0.5, 0, H, -a - Math.PI / 2);
    }
    textPlane(tex.sign(['THE BEEHIVE', 'Executive Wing · Site B'], '#ece8de', '#3a2a1a'), 4, 1, CX + 3.75, 3, CZ, Math.PI / 2);
    // Columns ring
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) * (Math.PI / 4);
      box(CX + Math.cos(a) * 9.5, 0, CZ + Math.sin(a) * 9.5, 0.9, H, 0.9, M.beehiveWhite, { rot: -a });
    }
    // Furniture: Cabinet-style desks and sofas for cover
    box(CX + 7, 0, CZ + 3, 1.0, 1.1, 3.2, M.wood, { uv: 1 });
    box(CX - 6.5, 0, CZ - 4, 3.2, 1.0, 1.0, M.leather, { uv: 1 });
    box(CX - 6, 0, CZ + 5.5, 1.2, 1.2, 1.2, M.wood, { uv: 1 });
    box(CX + 2, 0, CZ - 10.5, 2.6, 1.1, 1.0, M.wood, { uv: 1 });
    box(CX + 5, 0, CZ + 10, 2.2, 1.0, 1.0, M.leather, { uv: 1, rot: 0.6 });
    // Ceiling & upper storeys
    cyl(CX, H, CZ, R + 0.4, R + 0.4, 0.6, M.beehiveWhite, { seg: 48 });
    let y = H + 0.6;
    for (let i = 0; i < 10; i++) {
      const r = 14.2 - i * 0.22;
      const t = tex.beehive().clone();
      t.repeat.set(Math.round((2 * Math.PI * r) / 3), 1);
      t.needsUpdate = true;
      cyl(CX, y, CZ, r, r, 3.4, lambert({ map: t }), { seg: 48, open: true });
      cyl(CX, y + 3.4, CZ, r + 0.9, r + 0.9, 0.3, M.beehiveWhite, { seg: 48 });
      y += 3.7;
    }
    cyl(CX, y, CZ, 11.5, 12.4, 1.2, M.beehiveWhite, { seg: 48 });
    const roof = new THREE.Mesh(new THREE.SphereGeometry(12, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.copper);
    roof.scale.set(1, 0.35, 1);
    roof.position.set(CX, y + 1.2, CZ);
    roof.castShadow = true;
    scene.add(roof);
    worldMeshes.push(roof);
    cyl(CX, y + 4.8, CZ, 0.08, 0.08, 7, M.white, { hit: false });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6, 10, 4), lambert({ map: tex.nzFlag(), side: THREE.DoubleSide }));
    flag.position.set(CX + 1.65, y + 10.8, CZ);
    scene.add(flag);
    animated.push(makeFlagWave(flag));
    const bl = new THREE.PointLight('#fff0dd', 30, 28, 1.5);
    bl.position.set(CX, 4, CZ + 7);
    scene.add(bl);
    siteMarker('B');
  }

  // ---- Parliamentary Library ----------------------------------------------------
  {
    box(-27, 0, 27, 26, 11, 14, M.library, { uv: 8 });
    // Triangular prism along x: apex up, 6.3m tall gable
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(8.4, 8.4, 26.6, 3, 1), M.slate);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = -Math.PI / 2;
    roof.scale.set(1, 1, 0.5);
    roof.position.set(-27, 13.1, 27);
    roof.castShadow = true;
    scene.add(roof);
    worldMeshes.push(roof);
    for (const x of [-40, -14]) {
      cyl(x, 0, 20.5, 2.2, 2.4, 15, M.library, { collide: true, seg: 12 });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.6, 5, 12), M.slate);
      cone.position.set(x, 17.5, 20.5);
      cone.castShadow = true;
      scene.add(cone);
    }
    textPlane(tex.sign(['PARLIAMENTARY LIBRARY', 'Te Whare Pukapuka'], '#d9c9a8', '#3b2b16'), 8, 1.4, -27, 9.5, 19.95, Math.PI);
    // Arcade entrance porch
    box(-27, 0, 19.2, 6, 0.5, 1.6, M.stoneLight, { uv: 2 });
  }

  // ---- Grounds fencing ------------------------------------------------------------
  fenceLine('z', 52, -44, 48, [[-30, -24], [6, 14], [36, 42]]);
  fenceLine('x', -44, -54, 52, [[-46, -40], [-10, -4], [24, 32]]);
  fenceLine('z', -54, -44, 48, [[-8, 0], [24, 30]]);
  fenceLine('x', 48, -54, 52, [[-30, -24], [10, 16], [38, 44]]);
  signBoard(['PARLIAMENT BUILDINGS', 'Pāremata Aotearoa'], 49, 4.5, Math.PI / 2);
  signBoard(['BOWEN ST'], 20, -45.4, 0, ['#1b6b3a', '#fff']);
  signBoard(['LAMBTON QUAY'], 53.2, 18, Math.PI / 2, ['#1b6b3a', '#fff']);
  signBoard(['MOLESWORTH ST'], -55.4, 6, -Math.PI / 2, ['#1b6b3a', '#fff']);

  // ---- Wellington Cenotaph ----------------------------------------------------------
  {
    const x = 49, z = -50;
    box(x, 0, z, 7, 0.35, 7, M.stoneLight, { uv: 2 });
    box(x, 0.35, z, 5.2, 0.35, 5.2, M.stoneLight, { uv: 2 });
    box(x, 0.7, z, 3.0, 2.2, 3.0, M.granite, { uv: 2 });
    box(x, 2.9, z, 2.2, 6.5, 2.2, M.stoneLight, { uv: 2 });
    box(x, 9.4, z, 1.6, 1.2, 1.6, M.granite, { uv: 2 });
    const horse = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.0, 2.0), M.bronze);
    horse.position.set(x, 11.2, z);
    scene.add(horse);
    const rider = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 8), M.bronze);
    rider.position.set(x, 12.2, z - 0.2);
    scene.add(rider);
  }

  // ---- Statues on the lawn -----------------------------------------------------------
  function statue(x, z) {
    box(x, 0, z, 2.6, 0.5, 2.6, M.granite, { uv: 2 });
    box(x, 0.5, z, 1.8, 2.6, 1.8, M.stoneLight, { uv: 2 });
    cyl(x, 3.1, z, 0.35, 0.5, 1.8, M.bronze, {});
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), M.bronze);
    head.position.set(x, 5.15, z);
    head.castShadow = true;
    scene.add(head);
  }
  statue(34, 2); // Richard Seddon
  statue(30, 30); // John Ballance

  // ---- Flagpole on the forecourt --------------------------------------------------------
  {
    cyl(15, 0, -6, 0.1, 0.14, 14, M.white, { collide: true });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5, 10, 4), lambert({ map: tex.nzFlag(), side: THREE.DoubleSide }));
    flag.position.set(16.55, 13, -6);
    scene.add(flag);
    animated.push(makeFlagWave(flag));
  }

  // ---- Trees, hedges, planters ------------------------------------------------------------
  for (const [x, z, s] of [
    [46, -6, 1], [42, 24, 1.1], [22, 24, 0.9], [16, 42, 1], [46, 42, 1],
    [-48, -34, 1], [-48, 10, 1.1], [-48, 38, 0.9], [-4, 40, 1.2], [8, 28, 1], [-28, 43, 1],
    [44, -40, 0.9], [-36, -40, 0.8],
  ]) tree(x, z, s);
  for (const [x, z] of [[14, 2], [48, -34], [-50, -12], [20, -2], [-8, 24]]) cabbageTree(x, z);

  const hedge = (x, z, w, d) => box(x, 0, z, w, 1.1, d, M.hedge, { uv: 2 });
  hedge(26, 14.5, 8, 1);
  hedge(26, 5.5, 8, 1);
  hedge(40, -14, 1, 8);
  hedge(14, 32, 8, 1);
  hedge(36, 45, 10, 1);
  hedge(-46, -20, 1, 10);
  hedge(-46, 22, 1, 8);
  hedge(-2, 32, 1, 10);
  hedge(-20, 44, 12, 1);
  for (const [x, z] of [[12, -34], [10, -16], [47, -19], [20, -42], [36, -42], [-20, -22], [0, -22]]) {
    box(x, 0, z, 2, 1.0, 2, M.concrete, { uv: 2 });
  }

  // ---- Vehicles ----------------------------------------------------------------------------
  car(-30, -48.5, Math.PI / 2, '#8c1c1c');
  car(-14, -48.5, Math.PI / 2, '#d0d0d0');
  car(8, -48.5, Math.PI / 2, '#20304a');
  car(36, -48.5, Math.PI / 2, '#555');
  car(56.3, -30, 0, '#f0f0f0');
  car(56.3, -14, 0, '#2b4d2b');
  car(56.3, 24, 0, '#9a6a1a');
  car(56.3, 52, 0, '#444');
  car(-58.3, -20, 0, '#335');
  car(-58.3, 14, 0, '#a33');
  car(-58.3, 40, 0, '#ddd');
  car(-46, -30, 0, '#111');
  car(-42, -30, 0, '#111');
  car(-50, 30, 0, '#6b6b6b');
  car(-42, 34, 0.2, '#203050');
  car(16, -40, 0.5, '#0d0d0d'); // ministerial limo
  car(41, -5, -0.4, '#0d0d0d');
  bus(64.5, -6, 0);
  bus(-22, 54, Math.PI / 2);
  // Bus shelter on Lambton Quay
  box(53.6, 0, -2, 1.4, 0.1, 5, M.concrete, { collide: false });
  box(54.2, 0, -2, 0.2, 2.6, 4.5, M.glassDark, { uv: 2 });
  box(53.6, 2.6, -2, 1.6, 0.15, 5, M.iron, { collide: false });

  // ---- Surrounding city (out of bounds) -------------------------------------------------------
  const city = [
    // [x0, z0, x1, z1, height, tint]
    [-32, -100, 16, -58, 72, '#516474'], // Bowen House
    [18, -100, 58, -58, 30, '#7a6f62'],
    [-90, -100, -34, -58, 22, '#6e7a80'],
    [60, -110, 110, -58, 46, '#5d6a77'],
    [70, -58, 110, -20, 40, '#4c5d6b'],
    [70, -18, 110, 20, 26, '#8a7e6e'],
    [70, 22, 110, 70, 52, '#55687a'],
    [-110, -58, -68, 0, 18, '#8b8a86'],
    [-110, 2, -68, 70, 24, '#6a7066'],
    [-90, 60, -20, 100, 20, '#7d7468'],
    [-18, 60, 30, 100, 36, '#5a6c7c'],
    [32, 60, 110, 100, 28, '#6f6a62'],
  ];
  for (const [x0, z0, x1, z1, h, tint] of city) {
    box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, h, z1 - z0, lambert({ map: tex.office(tint) }), { uv: 8, cast: true });
  }
  textPlane(tex.sign(['BOWEN HOUSE'], '#516474', '#fff'), 8, 2, -8, 30, -57.9, 0);

  // Distant hills (Tinakori / Te Ahumairangi)
  const hills = new THREE.Mesh(
    new THREE.CylinderGeometry(420, 420, 60, 48, 1, true),
    new THREE.MeshBasicMaterial({ color: '#5d7a5a', side: THREE.BackSide, fog: false }),
  );
  hills.position.y = 8;
  scene.add(hills);

  // ---- Radar data -----------------------------------------------------------------------------
  const radar = colliders
    .filter((c) => c.maxY >= 1.2 && c.maxY - c.minY > 0.5)
    .map((c) => {
      const pts = [[-c.hx, -c.hz], [c.hx, -c.hz], [c.hx, c.hz], [-c.hx, c.hz]];
      return pts.map(([lx, lz]) => [c.cx + lx * c.cos + lz * c.sin, c.cz - lx * c.sin + lz * c.cos]);
    });
  labels.push(
    { text: 'BEEHIVE', x: 28, z: -24 },
    { text: 'PARLIAMENT', x: -15, z: 2 },
    { text: 'LIBRARY', x: -27, z: 27 },
    { text: 'LAMBTON QUAY', x: 61, z: 0, vertical: true },
    { text: 'BOWEN ST', x: 0, z: -51 },
    { text: 'MOLESWORTH', x: -61, z: 0, vertical: true },
  );

  return {
    worldMeshes,
    radar,
    labels,
    update(t) {
      for (const a of animated) a(t);
    },
  };
}

function makeFlagWave(mesh) {
  const pos = mesh.geometry.attributes.position;
  const base = Float32Array.from(pos.array);
  return (t) => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const k = (x + 1.6) / 3.2; // 0 at the pole, 1 at the fly
      pos.setZ(i, Math.sin(t * 6 + x * 2.5) * 0.25 * k);
    }
    pos.needsUpdate = true;
  };
}
