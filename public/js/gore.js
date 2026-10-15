import * as THREE from 'three';
import { tex } from './textures.js';
import { groundHeight } from './physics.js';
import { createPlayerModel, toonMat } from './models.js';

// Cartoon gore: blood droplets, splats on floors and walls, flying body parts, pools.
export function createGore(scene, worldMeshes) {
  const noOutline = { visible: false };
  const up = new THREE.Vector3(0, 1, 0);

  // ---- droplets (one instanced mesh) ------------------------------------------------
  const MAXD = 900;
  const dropMat = new THREE.MeshToonMaterial({ color: '#d4101e', gradientMap: tex.toonRamp() });
  dropMat.userData.outlineParameters = noOutline;
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 5), dropMat, MAXD);
  drops.frustumCulled = false;
  drops.count = 0;
  scene.add(drops);
  const D = Array.from({ length: MAXD }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s: 0, life: 0 }));
  let dropNext = 0;
  const mtx = new THREE.Matrix4();
  const q0 = new THREE.Quaternion();
  const sv = new THREE.Vector3();
  const pv = new THREE.Vector3();

  function spray(p, dir, count, speed = 5, spread = 0.6, size = 0.06) {
    for (let i = 0; i < count; i++) {
      const d = D[dropNext];
      dropNext = (dropNext + 1) % MAXD;
      const sp = speed * (0.4 + Math.random() * 0.8);
      d.x = p.x; d.y = p.y; d.z = p.z;
      d.vx = (dir.x + (Math.random() - 0.5) * spread * 2) * sp;
      d.vy = (dir.y + Math.random() * spread * 1.5) * sp + 1.5;
      d.vz = (dir.z + (Math.random() - 0.5) * spread * 2) * sp;
      d.s = size * (0.6 + Math.random() * 0.9);
      d.life = 3;
    }
  }

  // ---- splats ------------------------------------------------------------------------
  const MAXS = 260;
  const splatMats = [0, 1, 2, 3].map((v) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex.splat(v), color: '#b80d1c', transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    mat.userData.outlineParameters = noOutline;
    return mat;
  });
  const splatGeo = new THREE.PlaneGeometry(1, 1);
  const splats = [];
  let splatNext = 0;
  const pools = [];

  function addSplat(point, normal, size, grow = 0) {
    let s = splats[splatNext];
    if (!s) {
      s = new THREE.Mesh(splatGeo, splatMats[splatNext % 4]);
      s.renderOrder = 1;
      scene.add(s);
      splats[splatNext] = s;
    }
    splatNext = (splatNext + 1) % MAXS;
    s.visible = true;
    s.position.copy(point).addScaledVector(normal, 0.015 + Math.random() * 0.01);
    s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    s.rotateZ(Math.random() * Math.PI * 2);
    if (grow) {
      s.scale.setScalar(0.05);
      pools.push({ mesh: s, target: size, k: 0 });
    } else s.scale.setScalar(size);
    return s;
  }

  const ray = new THREE.Raycaster();
  function wallSplat(point, dir, maxDist = 5, size = 0.9) {
    ray.set(point, dir);
    ray.far = maxDist;
    const hit = ray.intersectObjects(worldMeshes, false)[0];
    if (!hit || !hit.face) return;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    addSplat(hit.point, n, size * (0.7 + Math.random() * 0.6));
  }

  // ---- gibs ---------------------------------------------------------------------------
  const gibs = [];
  const MAXG = 160;

  function addGib(obj, vel, radius, bleed = 1.5, pool = false) {
    scene.add(obj);
    obj.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    gibs.push({
      obj, vel, radius, bleed, pool, rested: false,
      spin: new THREE.Vector3((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14),
    });
    while (gibs.length > MAXG) {
      const g = gibs.shift();
      scene.remove(g.obj);
    }
  }

  // Blow a character model apart. dir: direction of the killing shot.
  function explode(model, dir, opts = {}) {
    const power = opts.power || 1;
    const centre = model.root.position.clone();
    centre.y += 1.0;
    const d = new THREE.Vector3(dir.x || 0, 0, dir.z || 0);
    if (d.lengthSq() < 1e-4) d.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    d.normalize();
    const order = ['acc', 'head', 'armL', 'armR', 'legL', 'legR', 'gun', 'torso'];
    for (const name of order) {
      const piece = model.detach(name);
      if (!piece) continue;
      const out = piece.position.clone().sub(centre).setY(0);
      if (out.lengthSq() < 1e-4) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize();
      let v;
      if (name === 'head' && opts.head) {
        // Headshot: the head pops clean off
        v = d.clone().multiplyScalar(4 * power).add(new THREE.Vector3(0, 7 + Math.random() * 2, 0));
      } else if (name === 'torso') {
        v = d.clone().multiplyScalar(2 * power).add(new THREE.Vector3(0, 2.5, 0));
      } else {
        v = d.clone().multiplyScalar((2 + Math.random() * 3) * power)
          .addScaledVector(out, 2.5 + Math.random() * 2.5)
          .add(new THREE.Vector3(0, 3 + Math.random() * 4, 0));
      }
      const r = name === 'torso' ? 0.35 : name === 'head' ? 0.3 : 0.14;
      addGib(piece, v, r, name === 'acc' || name === 'gun' ? 0 : 2, name === 'torso');
    }
    model.root.visible = false;
    // Big burst of blood
    spray(centre, d, 70, 6 * power, 0.9, 0.07);
    if (opts.head) spray(centre.clone().setY(centre.y + 0.6), up, 40, 7, 0.4, 0.06);
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const p = centre.clone().add(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(Math.random() * 1.5));
      p.y = groundHeight(p.x, p.z, centre.y) + 0.01;
      addSplat(p, up, 0.8 + Math.random() * 1.2);
    }
    wallSplat(centre, d, 6, 1.6);
  }

  // Kill a player whose model we don't have on screen (e.g. the local player): build one and blow it up
  function explodeAt(team, x, y, z, yaw, crouch, dir, opts) {
    const model = createPlayerModel(-1, team, '');
    model.tag.visible = false;
    model.root.position.set(x, y, z);
    model.root.rotation.y = yaw;
    model.animate(0, 0, 0, crouch);
    scene.add(model.root);
    explode(model, dir, opts);
    scene.remove(model.root);
  }

  // A limb (or hat) flies off a still-living character
  function knockOff(model, name, dir) {
    const piece = model.detach(name);
    if (!piece) return;
    const d = new THREE.Vector3(dir.x, 0, dir.z).normalize();
    const v = d.multiplyScalar(3).add(new THREE.Vector3((Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2));
    addGib(piece, v, name === 'acc' ? 0.2 : 0.14, name === 'acc' ? 0 : 1.5);
    const p = piece.position.clone();
    if (name !== 'acc') spray(p, d, 25, 4, 0.7, 0.06);
  }

  // Bullet hit on a body
  function hit(point, dir, head, dmg = 25) {
    const p = point instanceof THREE.Vector3 ? point : new THREE.Vector3(point.x, point.y, point.z);
    const d = dir instanceof THREE.Vector3 ? dir.clone().normalize() : new THREE.Vector3(dir.x, dir.y, dir.z).normalize();
    spray(p, d, Math.round(8 + dmg / 3 + (head ? 14 : 0)), 4 + dmg / 25, 0.6, head ? 0.07 : 0.055);
    if (Math.random() < 0.8) wallSplat(p, d, 5, 0.6 + dmg / 80);
  }

  function clear() {
    for (const g of gibs) scene.remove(g.obj);
    gibs.length = 0;
    for (const s of splats) if (s) s.visible = false;
    pools.length = 0;
    for (const d of D) d.life = 0;
  }

  // Blood dripping from a stump while alive
  function drip(pos) {
    spray(pos, up, 1, 0.5, 0.3, 0.04);
  }

  function update(dt) {
    // droplets
    let n = 0;
    for (const d of D) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 18 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.vy < 0) {
        const g = groundHeight(d.x, d.z, d.y);
        if (d.y <= g + 0.02) {
          if (Math.random() < 0.35) addSplat(pv.set(d.x, g + 0.005, d.z), up, d.s * 6 + Math.random() * 0.25);
          d.life = 0;
          continue;
        }
      }
      sv.setScalar(d.s);
      mtx.compose(pv.set(d.x, d.y, d.z), q0, sv);
      drops.setMatrixAt(n++, mtx);
    }
    drops.count = n;
    drops.instanceMatrix.needsUpdate = true;

    // gibs
    for (const g of gibs) {
      if (g.rested) continue;
      const o = g.obj;
      g.vel.y -= 20 * dt;
      o.position.addScaledVector(g.vel, dt);
      o.rotation.x += g.spin.x * dt;
      o.rotation.y += g.spin.y * dt;
      o.rotation.z += g.spin.z * dt;
      const ground = groundHeight(o.position.x, o.position.z, o.position.y);
      if (o.position.y - g.radius * 0.5 < ground) {
        o.position.y = ground + g.radius * 0.5;
        if (g.vel.y < -2 && g.bleed > 0) addSplat(pv.set(o.position.x, ground + 0.005, o.position.z), up, 0.4 + Math.random() * 0.5);
        g.vel.y = Math.abs(g.vel.y) * 0.3;
        g.vel.x *= 0.6;
        g.vel.z *= 0.6;
        g.spin.multiplyScalar(0.55);
        if (g.vel.lengthSq() < 0.6) {
          g.rested = true;
          if (g.pool) addSplat(pv.set(o.position.x, ground + 0.006, o.position.z), up, 1.6 + Math.random() * 0.6, true);
        }
      }
      if (g.bleed > 0) {
        g.bleed -= dt;
        if (Math.random() < 0.5) spray(o.position, up, 1, 1, 0.5, 0.05);
      }
    }
    // growing pools
    for (let i = pools.length - 1; i >= 0; i--) {
      const p = pools[i];
      p.k = Math.min(1, p.k + dt / 4);
      p.mesh.scale.setScalar(Math.max(0.05, p.target * Math.sqrt(p.k)));
      if (p.k >= 1) pools.splice(i, 1);
    }
  }

  const stats = () => ({ gibs: gibs.length, drops: drops.count, splats: splats.filter((x) => x && x.visible).length });
  return { spray, hit, explode, explodeAt, knockOff, clear, drip, update, toonMat, stats };
}
