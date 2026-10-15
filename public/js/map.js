import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { tex } from './textures.js';
import { addCollider, colliders } from './physics.js';
import { SITES, OGB, LQ } from '../shared/config.js';

// The Parliament precinct, Wellington: a game-friendly but geographically faithful layout.
//   +x east   -z north.   The Beehive sits at the origin.
//
//                 Museum St / north gardens
//      ┌───────────┐
//      │ Library   │                 front lawn                 │ Molesworth St │ National
//      └───────────┘                                            │               │ Library
//        gov spawn (the link)                                    │               │
//      ┌───────────┐    Seddon                                   │
//      │Parliament │▌steps  ─ ─ main drive ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ gate
//      │ House [A] │                                           ╱ Bunny St
//      └───────────┘        ( Beehive [B] )                  ╱
//        south courtyard                                ╱ Lambton Quay
//   ───────────── Bowen St ─────────────  Cenotaph ╱    [ Old Government Buildings ]
//          [ Bowen House ]                     ╱           (VUW Law School, opp spawn)

export function buildMap(scene, options = {}) {
  const worldMeshes = []; // things bullets hit
  const staticMeshes = [];
  const animated = [];
  const labels = [];
  const noOutline = { visible: false };

  // ---- materials (cartoon toon shading) ----------------------------------------
  const ramp = tex.toonRamp();
  const toon = (opts) => new THREE.MeshToonMaterial({ gradientMap: ramp, ...opts });
  const M = {
    grass: toon({ map: tex.grass(), color: '#ffffff' }),
    asphalt: toon({ map: tex.asphalt(), color: '#9aa0aa' }),
    paving: toon({ map: tex.paving(), color: '#fff4e0' }),
    parliament: toon({ map: tex.parliament(), color: '#ffffff' }),
    stoneLight: toon({ color: '#e8e4d8' }),
    stoneDark: toon({ color: '#a39c8f' }),
    granite: toon({ color: '#7d7672' }),
    marble: toon({ map: tex.marbleFloor() }),
    carpet: toon({ map: tex.carpet(), color: '#9cffb0' }),
    wood: toon({ map: tex.wood(), color: '#ffd9b0' }),
    woodDark: toon({ color: '#5c3418' }),
    leather: toon({ color: '#2f9a55' }),
    library: toon({ map: tex.library(), color: '#fff0dd' }),
    slate: toon({ color: '#56606e' }),
    ogb: toon({ map: tex.ogb() }),
    ogbRoof: toon({ color: '#7f8a94' }),
    ogbTrim: toon({ color: '#f5ecd8' }),
    beehiveWhite: toon({ color: '#fbf7ee' }),
    beehiveLobby: toon({ map: tex.beehiveLobby(), color: '#d8f0ff' }),
    copper: toon({ color: '#b5653a' }),
    bronze: toon({ color: '#6b5232' }),
    concrete: toon({ color: '#bdb7aa' }),
    hedge: toon({ color: '#3f9a32' }),
    trunk: toon({ color: '#7a5233' }),
    canopy: toon({ color: '#3faa3a' }),
    canopy2: toon({ color: '#58c24a' }),
    pohutukawa: toon({ color: '#e8322f' }),
    iron: toon({ color: '#26282c' }),
    railing: toon({ map: tex.railing(), alphaTest: 0.5, side: THREE.DoubleSide }),
    white: toon({ color: '#ffffff' }),
    gold: toon({ color: '#ffd23f', emissive: '#4a3300' }),
    glassDark: toon({ color: '#33475b' }),
    tyre: toon({ color: '#1c1c1c' }),
    roadLine: toon({ color: '#ffffff' }),
    yellowLine: toon({ color: '#ffd23f' }),
    brick: toon({ color: '#b5583a' }),
  };
  M.railing.userData.outlineParameters = noOutline;

  // ---- helpers -------------------------------------------------------------------
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

  function addStatic(mesh, o) {
    mesh.castShadow = o.cast !== false;
    mesh.receiveShadow = true;
    mesh.userData.hit = o.hit !== false;
    scene.add(mesh);
    if (o.merge !== false) staticMeshes.push(mesh);
    if (mesh.userData.hit) worldMeshes.push(mesh);
    return mesh;
  }

  // x/z = centre, y = bottom
  function box(x, y, z, w, h, d, mat, o = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(geo, w, h, d, o.uv || 4);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    mesh.rotation.y = o.rot || 0;
    addStatic(mesh, o);
    if (o.collide !== false) addCollider(x, z, w, d, y, y + h, o.rot || 0);
    return mesh;
  }

  function cyl(x, y, z, rt, rb, h, mat, o = {}) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, o.seg || 16, 1, !!o.open);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    if (o.rotY) mesh.rotation.y = o.rotY;
    addStatic(mesh, o);
    if (o.collide) {
      const s = Math.max(rt, rb) * 1.6;
      addCollider(x, z, s, s, y, y + h);
    }
    return mesh;
  }

  function mesh(geo, mat, x, y, z, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    if (o.scale) m.scale.set(...o.scale);
    return addStatic(m, o);
  }

  // Flat ground rectangle in a frame (or world when rot = 0)
  function flat(x0, z0, x1, z1, mat, y = 0.01, s = 4, frame = W) {
    const w = x1 - x0;
    const d = z1 - z0;
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / s, uv.getY(i) * d / s);
    const m = new THREE.Mesh(geo, mat);
    const [cx, cz] = frame.P((x0 + x1) / 2, (z0 + z1) / 2);
    m.position.set(cx, y, cz);
    m.rotation.set(-Math.PI / 2, 0, frame.rot);
    m.receiveShadow = true;
    scene.add(m);
    staticMeshes.push(m);
    m.userData.hit = false;
    return m;
  }

  function disk(x, z, r, mat, y = 0.02) {
    const geo = new THREE.CircleGeometry(r, 48);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * r / 2, uv.getY(i) * r / 2);
    const m = new THREE.Mesh(geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    scene.add(m);
    staticMeshes.push(m);
    return m;
  }

  // A local coordinate frame (origin + rotation) so rotated buildings can be laid out simply
  function makeFrame(ox, oz, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const P = (lx, lz) => [ox + lx * c + lz * s, oz - lx * s + lz * c];
    const F = {
      P, rot,
      box(lx, y, lz, w, h, d, mat, o = {}) {
        const [x, z] = P(lx, lz);
        return box(x, y, z, w, h, d, mat, { ...o, rot: rot + (o.rot || 0) });
      },
      cyl(lx, y, lz, rt, rb, h, mat, o = {}) {
        const [x, z] = P(lx, lz);
        return cyl(x, y, z, rt, rb, h, mat, o);
      },
      // Wall along a local axis with door openings: axis 'x' runs a0..a1 in x at z = c
      wall(axis, cc, a0, a1, y0, y1, thick, mat, doors = [], o = {}) {
        let cur = a0;
        const segs = [];
        for (const [d0, d1, top] of [...doors].sort((p, q) => p[0] - q[0])) {
          if (d0 > cur) segs.push([cur, d0, y0, y1]);
          if (top !== undefined && top < y1) segs.push([d0, d1, top, y1]);
          cur = d1;
        }
        if (cur < a1) segs.push([cur, a1, y0, y1]);
        for (const [s0, s1, h0, h1] of segs) {
          const len = s1 - s0, mid = (s0 + s1) / 2;
          if (axis === 'x') F.box(mid, h0, cc, len, h1 - h0, thick, mat, o);
          else F.box(cc, h0, mid, thick, h1 - h0, len, mat, o);
        }
      },
      // Stairs with top at height h descending from edge (lx,lz) in direction (dx,dz)
      stairs(lx, lz, dx, dz, width, h, n, mat) {
        for (let i = 0; i < n; i++) {
          const top = h - (i * h) / n;
          const cx = lx + dx * (i + 0.5);
          const cz = lz + dz * (i + 0.5);
          F.box(cx, 0, cz, dx !== 0 ? 1 : width, top, dx !== 0 ? width : 1, mat, { uv: 2 });
        }
      },
    };
    return F;
  }
  const W = makeFrame(0, 0, 0);

  function gableRoof(F, lx, lz, length, width, baseY, height, mat, alongX = true) {
    // Triangular prism, apex up
    const r = width / 2 / 0.866;
    const geo = new THREE.CylinderGeometry(r, r, length, 3, 1);
    const m = new THREE.Mesh(geo, mat);
    const [x, z] = F.P(lx, lz);
    const k = height / (1.5 * r);
    m.position.set(x, baseY + 0.5 * r * k, z);
    // Lay the cylinder's axis along local z (apex up), then optionally turn it to run along local x
    const up = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion().setFromAxisAngle(up, F.rot);
    if (alongX) q.multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2));
    q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
    m.quaternion.copy(q);
    m.scale.set(1, 1, k);
    return addStatic(m, {});
  }

  function pyramid(x, y, z, r, h, mat, rot = 0) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 4), mat);
    m.position.set(x, y + h / 2, z);
    m.rotation.y = rot + Math.PI / 4;
    return addStatic(m, {});
  }

  function textPlane(texture, w, h, x, y, z, rotY = 0) {
    const mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    mat.userData.outlineParameters = noOutline;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(x, y, z);
    m.rotation.y = rotY;
    scene.add(m);
    return m;
  }

  function signBoard(lines, x, z, rotY, colours) {
    box(x, 0, z, 0.25, 1.0, 0.25, M.iron, { rot: rotY });
    textPlane(tex.sign(lines, ...(colours || [])), 3.2, 0.8, x, 1.5, z, rotY);
  }

  function tree(x, z, scale = 1, flowering = Math.random() < 0.35) {
    box(x, 0, z, 0.55 * scale, 3 * scale, 0.55 * scale, M.trunk, { uv: 1 });
    const blobs = [[0, 4, 0, 2.6], [1.4, 3.6, 0.6, 1.9], [-1.3, 3.7, -0.5, 2], [0.3, 3.5, -1.4, 1.8], [-0.4, 4.6, 1.1, 1.7]];
    for (const [bx, by, bz, r] of blobs) {
      mesh(new THREE.IcosahedronGeometry(r * scale, 1), Math.random() > 0.5 ? M.canopy : M.canopy2,
        x + bx * scale, by * scale, z + bz * scale, { hit: false });
    }
    if (flowering) {
      // Pōhutukawa in bloom
      for (let i = 0; i < 6; i++) {
        mesh(new THREE.IcosahedronGeometry(0.5 * scale, 0), M.pohutukawa,
          x + (Math.random() - 0.5) * 4 * scale, (3.6 + Math.random() * 2) * scale, z + (Math.random() - 0.5) * 4 * scale, { hit: false });
      }
    }
  }

  function cabbageTree(x, z) {
    box(x, 0, z, 0.3, 4.2, 0.3, M.trunk, { uv: 1 });
    mesh(new THREE.IcosahedronGeometry(1.1, 0), M.canopy2, x, 4.6, z, { hit: false, scale: [1, 0.8, 1] });
  }

  function car(x, z, rot, color) {
    const body = toon({ color });
    box(x, 0.25, z, 1.9, 0.75, 4.4, body, { rot, uv: 2 });
    mesh(new THREE.BoxGeometry(1.7, 0.6, 2.3), M.glassDark, x, 1.3, z, { ry: rot });
    const c = Math.cos(rot), s = Math.sin(rot);
    for (const [ox, oz] of [[-0.85, 1.4], [0.85, 1.4], [-0.85, -1.4], [0.85, -1.4]]) {
      mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12), M.tyre, x + ox * c + oz * s, 0.36, z - ox * s + oz * c,
        { rz: Math.PI / 2, ry: rot, hit: false, cast: false });
    }
  }

  function bus(x, z, rot) {
    box(x, 0.35, z, 2.6, 2.9, 12, toon({ color: '#f2eedc' }), { rot, uv: 3 });
    mesh(new THREE.BoxGeometry(2.64, 0.9, 11.6), M.glassDark, x, 2.1, z, { ry: rot, hit: false });
    mesh(new THREE.BoxGeometry(2.66, 0.25, 12.02), toon({ color: '#1fa34a' }), x, 0.9, z, { ry: rot, hit: false });
  }

  // Fence with railings between two points, with gaps given as [from, to] metres along it
  function fence(x0, z0, x1, z1, gaps = []) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = Math.atan2(-(z1 - z0), x1 - x0);
    const F = makeFrame(x0, z0, rot);
    let cur = 0;
    const segs = [];
    for (const [g0, g1] of gaps) { segs.push([cur, g0]); cur = g1; }
    segs.push([cur, len]);
    for (const [s0, s1] of segs) {
      if (s1 - s0 <= 0.1) continue;
      const mid = (s0 + s1) / 2;
      const l = s1 - s0;
      F.box(mid, 0, 0, l, 0.8, 0.5, M.stoneDark, { uv: 2 });
      const railGeo = new THREE.PlaneGeometry(l, 1.1);
      const uv = railGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * l / 0.6);
      const [rx, rz] = F.P(mid, 0);
      const rail = new THREE.Mesh(railGeo, M.railing);
      rail.position.set(rx, 1.35, rz);
      rail.rotation.y = rot;
      scene.add(rail);
      addCollider(rx, rz, l, 0.5, 0.8, 2.2, rot);
      for (const p of [s0, s1]) {
        const [px, pz] = F.P(p, 0);
        box(px, 0, pz, 0.9, 2.1, 0.9, M.stoneLight, { uv: 2, rot });
        mesh(new THREE.SphereGeometry(0.35, 12, 8), M.stoneLight, px, 2.35, pz, { hit: false });
      }
    }
  }

  function siteMarker(key, y) {
    const s = SITES[key];
    const ringMat = new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    ringMat.userData.outlineParameters = noOutline;
    const ring = new THREE.Mesh(new THREE.RingGeometry(s.radius - 0.2, s.radius, 64), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, y + 0.02, s.z);
    scene.add(ring);
    const lm = new THREE.MeshBasicMaterial({ map: tex.label(key, '#ffcc33', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false });
    lm.userData.outlineParameters = noOutline;
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), lm);
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.x + s.radius - 2.5, y + 0.03, s.z);
    scene.add(letter);
  }

  function statue(x, z) {
    box(x, 0, z, 2.6, 0.5, 2.6, M.granite, { uv: 2 });
    box(x, 0.5, z, 1.8, 2.6, 1.8, M.stoneLight, { uv: 2 });
    cyl(x, 3.1, z, 0.35, 0.5, 1.8, M.bronze, {});
    mesh(new THREE.SphereGeometry(0.3, 12, 8), M.bronze, x, 5.2, z);
  }

  // =================================================================================
  // Ground and streets
  // =================================================================================
  const LQF = makeFrame(LQ.x0, LQ.z0, Math.atan2(-(LQ.z1 - LQ.z0), LQ.x1 - LQ.x0));
  const OF = makeFrame(OGB.x, OGB.z, OGB.rot);

  flat(-400, -400, 400, 400, M.paving, 0, 6);
  flat(-90, -112, 72, 50, M.grass, 0.01, 6);
  // Paving between Lambton Quay and the Old Government Buildings
  flat(-70, -40, 70, 40, M.paving, 0.012, 6, OF);
  // Roads
  flat(-130, 52, 30, 62, M.asphalt, 0.015, 6); // Bowen St
  flat(74, -160, 86, 20, M.asphalt, 0.015, 6); // Molesworth St
  flat(-60, -7, 90, 7, M.asphalt, 0.016, 6, LQF); // Lambton Quay
  flat(80, 12, 160, 24, M.asphalt, 0.015, 6); // Bunny St
  for (let x = -126; x < 26; x += 6) flat(x, 56.85, x + 3, 57.15, M.roadLine, 0.02);
  for (let z = -156; z < 16; z += 6) flat(79.85, z, 80.15, z + 3, M.roadLine, 0.02);
  for (let t = -56; t < 88; t += 6) flat(t, -0.15, t + 3, 0.15, M.roadLine, 0.021, 4, LQF);
  // Paths and forecourts inside the grounds
  flat(-62, -56, -24, -42, M.paving, 0.02); // the link (gov spawn)
  flat(-22, -46, -6, -6, M.paving, 0.02); // forecourt in front of Parliament House
  flat(-6, -30, 72, -23, M.paving, 0.02); // main drive from Molesworth St
  flat(-6, -72, 72, -66, M.paving, 0.02); // library drive
  flat(18, -23, 23, 40, M.paving, 0.021); // path down to the Cenotaph
  flat(-62, -8, -16, 50, M.paving, 0.02); // south courtyard
  flat(-90, -112, -64, 50, M.paving, 0.02); // western service lane / car park
  disk(0, 0, 22, M.paving, 0.025); // Beehive plaza
  disk(22.8, 43.4, 9, M.paving, 0.026); // Cenotaph plaza

  // =================================================================================
  // Parliament House (site A: the Debating Chamber)
  // =================================================================================
  {
    const X0 = -62, X1 = -22, Z0 = -44, Z1 = -8, FL = 1.2, TOP = 16, T = 0.8, CEIL = 7.5;
    const door = 4 + FL;
    box((X0 + X1) / 2, 0, (Z0 + Z1) / 2, X1 - X0, FL, Z1 - Z0, M.stoneDark);
    flat(X0, Z0, X1, Z1, M.marble, FL + 0.01, 4);
    flat(-56, -36, -36, -16, M.carpet, FL + 0.02, 2);
    W.wall('z', X1, Z0, Z1, 0, TOP, T, M.parliament, [[-28, -24, door]], { uv: 8 }); // east (front)
    W.wall('z', X0, Z0, Z1, 0, TOP, T, M.parliament, [[-28, -24, door]], { uv: 8 }); // west
    W.wall('x', Z0, X0 - T / 2, X1 + T / 2, 0, TOP, T, M.parliament, [[-52, -48, door]], { uv: 8 }); // north
    W.wall('x', Z1, X0 - T / 2, X1 + T / 2, 0, TOP, T, M.parliament, [[-32, -28, door]], { uv: 8 }); // south
    box((X0 + X1) / 2, CEIL, (Z0 + Z1) / 2, X1 - X0, 0.5, Z1 - Z0, M.stoneLight, { cast: false });
    box((X0 + X1) / 2, TOP, (Z0 + Z1) / 2, X1 - X0 + 1.6, 0.6, Z1 - Z0 + 1.6, M.stoneLight, { collide: false });
    box((X0 + X1) / 2, TOP + 0.6, (Z0 + Z1) / 2, X1 - X0 - 6, 2.4, Z1 - Z0 - 6, M.stoneLight, { collide: false });
    W.stairs(X1 + T / 2, -26, 1, 0, 28, FL, 4, M.stoneLight);
    W.stairs(X0 - T / 2, -26, -1, 0, 7, FL, 4, M.stoneLight);
    W.stairs(-50, Z0 - T / 2, 0, -1, 7, FL, 4, M.stoneLight);
    W.stairs(-30, Z1 + T / 2, 0, 1, 7, FL, 4, M.stoneLight);
    // Grand portico on the east front
    for (const dz of [-12.5, -9.5, -6.5, -3.5, 3.5, 6.5, 9.5, 12.5]) {
      cyl(X1 + 1.1, FL, -26 + dz, 0.45, 0.5, 12.8, M.stoneLight, { collide: true, seg: 14 });
      box(X1 + 1.1, FL, -26 + dz, 1.2, 0.4, 1.2, M.stoneLight, { collide: false });
    }
    box(X1 + 1.1, 14, -26, 1.8, 1.6, 28, M.stoneLight, { collide: false });
    textPlane(tex.sign(['PARLIAMENT HOUSE', 'Whare Pāremata'], '#efece3', '#2a2a2a'), 10, 1.5, X1 + 2.05, 14.8, -26, Math.PI / 2);

    // Debating Chamber
    W.wall('z', -56, -36, -16, FL, CEIL, 0.5, M.wood, [], { uv: 3 });
    W.wall('z', -36, -36, -16, FL, CEIL, 0.5, M.wood, [[-28, -24, door]], { uv: 3 });
    W.wall('x', -36, -56.25, -35.75, FL, CEIL, 0.5, M.wood, [[-48, -44, door]], { uv: 3 });
    W.wall('x', -16, -56.25, -35.75, FL, CEIL, 0.5, M.wood, [[-48, -44, door]], { uv: 3 });
    for (const [x0, x1] of [[-54.5, -48.2], [-43.8, -37]]) {
      const w = x1 - x0, cx = (x0 + x1) / 2;
      box(cx, FL, -34.6, w, 1.3, 0.8, M.leather, { uv: 1 });
      box(cx, FL, -33.2, w, 1.0, 0.8, M.leather, { uv: 1 });
      box(cx, FL, -17.4, w, 1.3, 0.8, M.leather, { uv: 1 });
      box(cx, FL, -18.8, w, 1.0, 0.8, M.leather, { uv: 1 });
    }
    box(-46, FL, -26, 4, 1.0, 1.8, M.wood, { uv: 1 });
    mesh(new THREE.CylinderGeometry(0.07, 0.1, 1.4, 10), M.gold, -46, FL + 1.12, -25.7, { rz: Math.PI / 2 });
    mesh(new THREE.SphereGeometry(0.18, 12, 8), M.gold, -45.25, FL + 1.14, -25.7);
    box(-55.1, FL, -26, 1.2, 2.8, 2.0, M.woodDark, { uv: 1 });
    box(-54.2, FL, -26, 0.8, 0.6, 1.4, M.leather, { uv: 1 });
    textPlane(tex.sign(['DEBATING CHAMBER', 'Site A'], '#5c3418', '#ffe9a8'), 4, 1, -55.7, 5.4, -26, Math.PI / 2);

    // Lobby
    for (const [x, z] of [[-31, -33], [-31, -19], [-26, -33], [-26, -19]]) box(x, FL, z, 1.0, CEIL - FL, 1.0, M.stoneLight, { uv: 2 });
    box(-28.5, FL, -26, 1.0, 1.1, 2.6, M.wood, { uv: 1 });
    // Crates of Hansard in the corridors
    box(-59, FL, -41, 1.2, 1.2, 1.2, M.wood, { uv: 1 });
    box(-59, FL, -11, 1.2, 1.2, 1.2, M.wood, { uv: 1 });
    box(-41, FL, -42.4, 1.6, 1.0, 1.0, M.wood, { uv: 1 });
    box(-25, FL, -11, 1.2, 1.4, 1.2, M.wood, { uv: 1 });
    box(-44, FL, -10, 2.0, 1.1, 1.0, M.wood, { uv: 1 });

    const l1 = new THREE.PointLight('#ffe8c0', 45, 30, 1.5);
    l1.position.set(-46, 6.5, -26);
    scene.add(l1);
    const l2 = new THREE.PointLight('#fff4e0', 30, 26, 1.5);
    l2.position.set(-29, 6.5, -26);
    scene.add(l2);
    siteMarker('A', FL);
  }

  // =================================================================================
  // The Beehive (Executive Wing) — site B
  // =================================================================================
  {
    const CX = 0, CZ = 0, R = 16, H = 5;
    disk(CX, CZ, R, M.marble, 0.03);
    const doors = [0, 90, 180, 270].map((d) => (d * Math.PI) / 180);
    const segN = 40;
    for (let i = 0; i < segN; i++) {
      const a = ((i + 0.5) / segN) * Math.PI * 2;
      const isDoor = doors.some((d) => {
        let diff = Math.abs(a - d);
        diff = Math.min(diff, Math.PI * 2 - diff);
        return diff < Math.PI / 20 + 0.01;
      });
      const x = CX + Math.cos(a) * R;
      const z = CZ + Math.sin(a) * R;
      const rot = -a - Math.PI / 2;
      if (isDoor) {
        box(x, 4.2, z, 2.6, H - 4.2, 0.5, M.beehiveWhite, { rot, collide: false });
        continue;
      }
      box(x, 0, z, 2.6, H, 0.5, M.beehiveLobby, { rot, uv: 5 });
    }
    cyl(CX, 0, CZ, 4, 4, H, M.beehiveWhite, { seg: 8, rotY: Math.PI / 8 });
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      addCollider(CX + Math.cos(a) * 3.45, CZ + Math.sin(a) * 3.45, 3.1, 0.5, 0, H, -a - Math.PI / 2);
    }
    textPlane(tex.sign(['THE BEEHIVE', 'Executive Wing · Site B'], '#fbf7ee', '#3a2a1a'), 4, 1, CX, 3, CZ - 3.75, Math.PI);
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) * (Math.PI / 4);
      box(CX + Math.cos(a) * 9.5, 0, CZ + Math.sin(a) * 9.5, 0.9, H, 0.9, M.beehiveWhite, { rot: -a });
    }
    box(CX + 7, 0, CZ + 3, 1.0, 1.1, 3.2, M.wood, { uv: 1 });
    box(CX - 6.5, 0, CZ - 4, 3.2, 1.0, 1.0, M.leather, { uv: 1 });
    box(CX - 6, 0, CZ + 6, 1.2, 1.2, 1.2, M.wood, { uv: 1 });
    box(CX + 2, 0, CZ - 11, 2.6, 1.1, 1.0, M.wood, { uv: 1 });
    box(CX + 5, 0, CZ + 10, 2.2, 1.0, 1.0, M.leather, { uv: 1, rot: 0.6 });
    box(CX - 11, 0, CZ - 2, 1.0, 1.1, 2.4, M.wood, { uv: 1 });
    // Ceiling and the famous tiers
    cyl(CX, H, CZ, R + 0.4, R + 0.4, 0.6, M.beehiveWhite, { seg: 48 });
    let y = H + 0.6;
    for (let i = 0; i < 10; i++) {
      const r = 15.2 - i * 0.24;
      const bt = tex.beehive();
      let mat = M.beehiveWhite;
      if (bt) {
        const t = bt.clone();
        t.repeat.set(Math.round((2 * Math.PI * r) / 3), 1);
        t.needsUpdate = true;
        mat = toon({ map: t });
      }
      cyl(CX, y, CZ, r, r, 3.4, mat, { seg: 48, open: true });
      cyl(CX, y + 3.4, CZ, r + 1, r + 1, 0.35, M.beehiveWhite, { seg: 48 });
      y += 3.75;
    }
    cyl(CX, y, CZ, 12.4, 13.2, 1.2, M.beehiveWhite, { seg: 48 });
    mesh(new THREE.SphereGeometry(12.8, 48, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.copper, CX, y + 1.2, CZ, { scale: [1, 0.35, 1] });
    cyl(CX, y + 5, CZ, 0.08, 0.08, 7, M.white, { hit: false });
    const flagMat = toon({ map: tex.nzFlag(), side: THREE.DoubleSide });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6, 10, 4), flagMat);
    flag.position.set(CX + 1.65, y + 11, CZ);
    scene.add(flag);
    animated.push(makeFlagWave(flag, 3.2));
    const bl = new THREE.PointLight('#fff0dd', 35, 28, 1.5);
    bl.position.set(CX, 4.2, CZ + 7);
    scene.add(bl);
    siteMarker('B', 0);
  }

  // =================================================================================
  // Parliamentary Library (Victorian Gothic)
  // =================================================================================
  {
    const LB = makeFrame(-46, -72, 0);
    LB.box(0, 0, 0, 24, 12, 32, M.library, { uv: 8 });
    gableRoof(LB, 0, 0, 32.6, 24.6, 12, 7.5, M.slate, false);
    for (const z of [-15.5, 15.5]) {
      cyl(-34, 0, -72 + z, 2.2, 2.4, 15, M.library, { collide: true, seg: 12 });
      mesh(new THREE.ConeGeometry(2.7, 5.5, 12), M.slate, -34, 17.75, -72 + z);
    }
    box(-33, 0, -72, 4, 18, 5, M.library, { uv: 6 });
    pyramid(-33, 18, -72, 3.4, 6, M.slate);
    box(-30.6, 0, -72, 1.2, 0.5, 6, M.stoneLight, { uv: 2 });
    textPlane(tex.sign(['PARLIAMENTARY LIBRARY', 'Te Whare Pukapuka'], '#efe0c2', '#3b2b16'), 7, 1.2, -30.9, 9, -72, Math.PI / 2);
  }

  // =================================================================================
  // Old Government Buildings — Victoria University law school (opp spawn)
  // One of the largest wooden buildings in the world, painted to look like stone.
  // Local frame: +x along Lambton Quay (north-east), -z faces Parliament.
  // =================================================================================
  {
    const H = 12;
    // Wings either side of the central hall
    OF.box(-26, 0, 0, 28, H, 30, M.ogb, { uv: 8 });
    OF.box(26, 0, 0, 28, H, 30, M.ogb, { uv: 8 });
    // Central hall: enterable, a law library
    OF.wall('x', -14.6, -12, 12, 0, H, 0.8, M.ogb, [[-2.5, 2.5, 4.5]], { uv: 8 });
    OF.wall('x', 14.6, -12, 12, 0, H, 0.8, M.ogb, [], { uv: 8 });
    OF.box(0, 5.2, 0, 24, H - 5.2, 28.4, M.ogb, { uv: 8 });
    flat(-12, -14.2, 12, 14.2, M.wood, 0.03, 2, OF);
    for (const x of [-9, -3, 3, 9]) OF.box(x, 0, 13, 4.2, 2.6, 0.9, M.woodDark, { uv: 1 }); // bookshelves
    OF.box(-6, 0, 2, 5, 0.85, 1.6, M.wood, { uv: 1 });
    OF.box(6, 0, 2, 5, 0.85, 1.6, M.wood, { uv: 1 });
    OF.box(0, 0, -6, 2.2, 1.0, 1.2, M.wood, { uv: 1 });
    const [lx, lz] = OF.P(0, 0);
    const ll = new THREE.PointLight('#ffefd0', 30, 24, 1.5);
    ll.position.set(lx, 4.5, lz);
    scene.add(ll);
    // Projecting pavilions on the front
    for (const x of [-36, 36]) {
      OF.box(x, 0, -16, 8, H + 1, 3, M.ogb, { uv: 8 });
      const [px, pz] = OF.P(x, -1);
      pyramid(px, H + 1, pz, 7, 4, M.ogbRoof, OF.rot);
    }
    // Portico with columns
    OF.box(0, 0, -17.3, 13, 0.3, 4.6, M.ogbTrim, { uv: 2 });
    for (const x of [-5.5, -2.8, 2.8, 5.5]) OF.cyl(x, 0.3, -18.8, 0.3, 0.34, 4.7, M.ogbTrim, { collide: true, seg: 12 });
    OF.box(0, 5, -17.3, 13, 0.6, 4.6, M.ogbTrim, { collide: false });
    textPlane(tex.sign(['OLD GOVERNMENT BUILDINGS', 'Law School · Te Herenga Waka'], '#f5ecd8', '#3b2b16'),
      8, 1.3, ...(() => { const [x, z] = OF.P(0, -19.65); return [x, 6.2, z]; })(), OF.rot + Math.PI);
    // Roofs and chimneys
    gableRoof(OF, 0, 0, 80, 30.5, H, 5, M.ogbRoof, true);
    for (const x of [-30, -18, -6, 6, 18, 30]) OF.box(x, H, 7, 0.9, 5.5, 0.9, M.brick, { collide: false, uv: 2 });
    // Trim band between storeys
    OF.box(0, 5.8, -15.05, 80, 0.4, 0.3, M.ogbTrim, { collide: false });
    // Stout St buildings behind (backdrop)
    OF.box(0, 0, 45, 120, 22, 30, toon({ map: tex.office('#7d8a96') }), { uv: 8 });
  }

  // =================================================================================
  // Cenotaph, statues, flagpole
  // =================================================================================
  {
    const x = 22.8, z = 43.4;
    box(x, 0, z, 7, 0.35, 7, M.stoneLight, { uv: 2 });
    box(x, 0.35, z, 5.2, 0.35, 5.2, M.stoneLight, { uv: 2 });
    box(x, 0.7, z, 3.0, 2.2, 3.0, M.granite, { uv: 2 });
    box(x, 2.9, z, 2.2, 6.5, 2.2, M.stoneLight, { uv: 2 });
    box(x, 9.4, z, 1.6, 1.2, 1.6, M.granite, { uv: 2 });
    mesh(new THREE.BoxGeometry(0.7, 1.0, 2.0), M.bronze, x, 11.2, z);
    mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.2, 8), M.bronze, x, 12.2, z - 0.2);
  }
  statue(6, -36); // Richard Seddon, in front of Parliament House
  statue(-12, -66); // John Ballance, by the Library
  {
    cyl(-12, 0, -12, 0.1, 0.14, 14, M.white, { collide: true });
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5, 10, 4), toon({ map: tex.nzFlag(), side: THREE.DoubleSide }));
    flag.position.set(-10.45, 13, -12);
    scene.add(flag);
    animated.push(makeFlagWave(flag, 3));
  }

  // =================================================================================
  // Grounds: fences, trees, hedges, planters, vehicles
  // =================================================================================
  fence(-90, 50, 18, 50, [[40, 46], [84, 96]]); // Bowen St
  fence(72, -112, 72, 9, [[38, 44], [82, 88]]); // Molesworth St
  {
    // Along Lambton Quay, open at the Cenotaph corner
    const [ax, az] = LQF.P(0, -9);
    const [bx, bz] = LQF.P(62, -9);
    fence(ax, az, bx, bz, [[0, 12], [32, 38]]);
  }
  signBoard(['PARLIAMENT', 'Pāremata Aotearoa'], 70.6, -21.5, -Math.PI / 2);
  signBoard(['BOWEN ST'], -30, 48.6, 0, ['#1b6b3a', '#fff']);
  signBoard(['MOLESWORTH ST'], 70.6, -60, -Math.PI / 2, ['#1b6b3a', '#fff']);
  {
    const [x, z] = LQF.P(22, -8.2);
    signBoard(['LAMBTON QUAY'], x, z, LQF.rot, ['#1b6b3a', '#fff']);
  }

  for (const [x, z, s] of [
    [40, -46, 1], [56, -82, 1.1], [26, -84, 0.9], [60, -40, 1], [-4, -98, 1.1], [44, -104, 1],
    [64, -100, 0.9], [12, -52, 0.9], [36, -14, 1], [52, -10, 1.1], [-74, -96, 1], [-78, -30, 1],
    [-80, 20, 1.1], [-40, 34, 1], [-22, 40, 0.9], [-56, 40, 1], [-30, -104, 1.1], [8, -108, 0.9],
  ]) tree(x, z, s);
  for (const [x, z] of [[-14, -40], [-14, -52], [32, 28], [62, -60], [-66, -50], [14, 30]]) cabbageTree(x, z);

  const hedge = (x, z, w, d) => box(x, 0, z, w, 1.1, d, M.hedge, { uv: 2 });
  hedge(28, -34, 8, 1);
  hedge(28, -19, 8, 1);
  hedge(48, -56, 1, 10);
  hedge(20, -60, 10, 1);
  hedge(60, -76, 8, 1);
  hedge(34, -94, 12, 1);
  hedge(8, -84, 1, 8);
  hedge(-8, 24, 1, 10);
  hedge(-36, 20, 10, 1);
  hedge(-76, -70, 1, 12);
  hedge(-76, 0, 1, 12);
  hedge(-20, -104, 14, 1);
  for (const [x, z] of [[24, -10], [-22, 4], [10, 24], [-8, 34], [-50, 6], [-30, 30], [44, -30], [60, -18], [-10, -24]]) {
    box(x, 0, z, 2, 1.0, 2, M.concrete, { uv: 2 });
  }
  // Security booth at the Bowen St gate
  box(-1, 0, 46, 2.4, 2.6, 2.4, M.beehiveWhite, { uv: 2 });
  box(-1, 2.6, 46, 3, 0.25, 3, M.iron, { collide: false });

  car(10, -26.5, Math.PI / 2, '#0f0f0f'); // ministerial limos
  car(18, -26.5, Math.PI / 2, '#0f0f0f');
  car(-40, 12, 0, '#c0392b');
  car(-36, 12, 0, '#2c3e50');
  car(-26, 26, Math.PI / 2, '#f1c40f');
  car(-52, 28, 0, '#8e44ad');
  car(-84, -60, 0, '#16a085');
  car(-84, -40, 0, '#ecf0f1');
  car(-70, 10, 0, '#d35400');
  car(-84, 30, 0, '#2980b9');
  car(75.6, -90, 0, '#e74c3c');
  car(75.6, -50, 0, '#ecf0f1');
  car(75.6, -6, 0, '#27ae60');
  car(-60, 54.5, Math.PI / 2, '#34495e');
  car(-20, 54.5, Math.PI / 2, '#e67e22');
  bus(83.4, -36, 0);
  {
    const [x, z] = LQF.P(34, 3.6);
    bus(x, z, LQF.rot + Math.PI / 2);
    const [cx, cz] = LQF.P(14, -3.6);
    car(cx, cz, LQF.rot + Math.PI / 2, '#f5f5f5');
    const [dx, dz] = LQF.P(52, 3.6);
    car(dx, dz, LQF.rot + Math.PI / 2, '#3498db');
    // Buses blocking the ends of the streets
    const [ex, ez] = LQF.P(-14, 0);
    bus(ex, ez, LQF.rot + Math.PI / 2);
  }
  bus(108, 18, Math.PI / 2);
  // Bus shelter on Lambton Quay
  {
    const [x, z] = LQF.P(46, 8.4);
    box(x, 0, z, 5, 2.6, 0.2, M.glassDark, { rot: LQF.rot, uv: 2 });
    box(x, 2.6, z, 5.2, 0.15, 1.6, M.iron, { rot: LQF.rot, collide: false });
  }

  // =================================================================================
  // Surrounding city (out of bounds)
  // =================================================================================
  const city = [
    // [x0, z0, x1, z1, height, tint]
    [-44, 64, 0, 104, 88, '#516474'], // Bowen House (22 storeys)
    [-130, 64, -46, 104, 26, '#7a6f62'],
    [90, -112, 136, 8, 16, '#8b8a86'], // National Library
    [90, -170, 136, -116, 30, '#6e7a80'],
    [-140, -170, 70, -116, 22, '#7d7468'],
    [-140, -114, -92, 62, 24, '#6a7066'],
    [160, -30, 240, 50, 24, '#9b4a32'], // Wellington Railway Station
    [120, 26, 160, 60, 34, '#5d6a77'],
  ];
  for (const [x0, z0, x1, z1, h, tint] of city) {
    box((x0 + x1) / 2, 0, (z0 + z1) / 2, x1 - x0, h, z1 - z0, toon({ map: tex.office(tint) }), { uv: 8 });
  }
  textPlane(tex.sign(['BOWEN HOUSE'], '#516474', '#fff'), 8, 2, -22, 30, 63.9, Math.PI);
  textPlane(tex.sign(['NATIONAL LIBRARY', 'Te Puna Mātauranga'], '#8b8a86', '#fff'), 9, 2, 89.9, 10, -50, -Math.PI / 2);
  textPlane(tex.sign(['WELLINGTON STATION'], '#9b4a32', '#fff'), 12, 2.5, 159.9, 18, 10, -Math.PI / 2);
  // Invisible walls so nobody wanders down the side streets
  addCollider(-56, 76, 160, 20, 0, 50);

  // Distant hills (Te Ahumairangi)
  const hillMat = new THREE.MeshBasicMaterial({ color: '#6aa86a', side: THREE.BackSide, fog: false });
  hillMat.userData.outlineParameters = noOutline;
  const hills = new THREE.Mesh(new THREE.CylinderGeometry(460, 460, 70, 48, 1, true), hillMat);
  hills.position.y = 12;
  scene.add(hills);

  // =================================================================================
  // Merge static geometry by material (hundreds of draw calls down to a few dozen)
  // =================================================================================
  if (options.merge) {
    const groups = new Map();
    for (const m of staticMeshes) {
      const key = `${m.material.uuid}|${m.castShadow}|${m.userData.hit}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(m);
    }
    const hitSet = new Set(worldMeshes);
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => {
        m.updateMatrix();
        let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        g.applyMatrix4(m.matrix);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      if (!merged) continue;
      const mm = new THREE.Mesh(merged, list[0].material);
      mm.castShadow = list[0].castShadow;
      mm.receiveShadow = true;
      scene.add(mm);
      for (const m of list) {
        scene.remove(m);
        m.geometry.dispose();
        hitSet.delete(m);
      }
      if (list[0].userData.hit) hitSet.add(mm);
    }
    worldMeshes.length = 0;
    worldMeshes.push(...hitSet);
  }

  // ---- Radar data ----------------------------------------------------------------------
  const radar = colliders
    .filter((c) => c.maxY >= 1.2 && c.maxY - c.minY > 0.5 && c.maxY < 45)
    .map((c) => {
      const pts = [[-c.hx, -c.hz], [c.hx, -c.hz], [c.hx, c.hz], [-c.hx, c.hz]];
      return pts.map(([lx, lz]) => [c.cx + lx * c.cos + lz * c.sin, c.cz - lx * c.sin + lz * c.cos]);
    });
  labels.push(
    { text: 'BEEHIVE', x: 0, z: 0 },
    { text: 'PARLIAMENT', x: -42, z: -26 },
    { text: 'LIBRARY', x: -46, z: -72 },
    { text: 'LAW SCHOOL', x: OGB.x, z: OGB.z },
    { text: 'MOLESWORTH', x: 80, z: -60, vertical: true },
    { text: 'BOWEN ST', x: -40, z: 57 },
    { text: 'LAMBTON QUAY', x: 54, z: 33, angle: -LQF.rot },
    { text: 'CENOTAPH', x: 22.8, z: 43.4 },
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

function makeFlagWave(mesh, width) {
  const pos = mesh.geometry.attributes.position;
  const base = Float32Array.from(pos.array);
  return (t) => {
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3];
      const k = (x + width / 2) / width; // 0 at the pole, 1 at the fly
      pos.setZ(i, Math.sin(t * 6 + x * 2.5) * 0.3 * k);
    }
    pos.needsUpdate = true;
  };
}
