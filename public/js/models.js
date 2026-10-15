import * as THREE from 'three';
import { tex } from './textures.js';

// Chunky, big-headed party-game characters built from detachable parts (for gore).
const mats = {};
export function toonMat(color, extra = {}) {
  const key = color + JSON.stringify(extra);
  return mats[key] || (mats[key] = new THREE.MeshToonMaterial({ color, gradientMap: tex.toonRamp(), ...extra }));
}
export const MEAT = () => toonMat('#c8102e');
export const BONE = () => toonMat('#f4ecd6');

const LOOK = {
  // Government: dark suits, red ties, security sunglasses
  gov: { body: '#22324a', legs: '#1a2436', skin: '#f2c49b', accent: '#e8e8e8', shoes: '#111111' },
  // Opposition: hi-vis orange hoodies, beanies
  opp: { body: '#ff8a1e', legs: '#34465e', skin: '#c98e62', accent: '#ffe94a', shoes: '#3a2416' },
};

const geo = {
  head: new THREE.SphereGeometry(0.3, 20, 14),
  torso: new THREE.CapsuleGeometry(0.31, 0.32, 6, 14),
  limb: new THREE.CapsuleGeometry(0.1, 0.32, 4, 8),
  hand: new THREE.SphereGeometry(0.11, 10, 8),
  foot: new THREE.SphereGeometry(0.13, 10, 8),
  eye: new THREE.SphereGeometry(0.085, 12, 8),
  pupil: new THREE.SphereGeometry(0.045, 8, 6),
  stump: new THREE.SphereGeometry(0.11, 10, 8),
  bone: new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6),
};

function m(g, mat, x, y, z, playerId, part) {
  const mesh = new THREE.Mesh(g, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  if (playerId != null) mesh.userData = { playerId, part };
  return mesh;
}

// A red stump (with a bit of bone) at a joint, shown where a part has come off
export function makeStump(boneDir = 1) {
  const g = new THREE.Group();
  const s = new THREE.Mesh(geo.stump, MEAT());
  s.scale.set(1, 0.6, 1);
  g.add(s);
  const b = new THREE.Mesh(geo.bone, BONE());
  b.position.y = 0.07 * boneDir;
  g.add(b);
  return g;
}

export function createPlayerModel(id, team, name) {
  const L = LOOK[team] || LOOK.opp;
  const root = new THREE.Group();
  const hitParts = [];
  const parts = {};

  // Legs (pivot at the hip)
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(0.15 * side, 0.6, 0);
    const thigh = m(geo.limb, toonMat(L.legs), 0, -0.27, 0, id, 'body');
    thigh.scale.set(1.25, 1, 1.25);
    const foot = m(geo.foot, toonMat(L.shoes), 0, -0.55, -0.06, id, 'body');
    foot.scale.set(1, 0.6, 1.4);
    leg.add(thigh, foot);
    hitParts.push(thigh, foot);
    root.add(leg);
    parts[side < 0 ? 'legL' : 'legR'] = leg;
  }

  const upper = new THREE.Group();
  root.add(upper);

  // Torso (pivot at the hips)
  const torso = new THREE.Group();
  torso.position.set(0, 0.6, 0);
  const belly = m(geo.torso, toonMat(L.body), 0, 0.38, 0, id, 'body');
  torso.add(belly);
  hitParts.push(belly);
  if (team === 'gov') {
    const shirt = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.06), toonMat('#ffffff'));
    shirt.position.set(0, 0.62, -0.29);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.28, 0.07), toonMat('#d01c1c'));
    tie.position.set(0, 0.56, -0.32);
    torso.add(shirt, tie);
  } else {
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 6, 20), toonMat(L.accent));
    stripe.rotation.x = Math.PI / 2;
    stripe.position.y = 0.42;
    const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), toonMat('#e3741a'));
    hood.position.set(0, 0.68, 0.16);
    hood.rotation.x = -0.6;
    torso.add(stripe, hood);
  }
  upper.add(torso);
  parts.torso = torso;

  // Head (pivot at the neck)
  const head = new THREE.Group();
  head.position.set(0, 1.28, 0);
  const skull = m(geo.head, toonMat(L.skin), 0, 0.27, 0, id, 'head');
  head.add(skull);
  hitParts.push(skull);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geo.eye, toonMat('#ffffff'));
    eye.position.set(0.11 * side, 0.32, -0.24);
    const pupil = new THREE.Mesh(geo.pupil, toonMat('#111111'));
    pupil.position.set(0.11 * side, 0.32, -0.31);
    head.add(eye, pupil);
    // Angry eyebrows
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), toonMat('#2a1a10'));
    brow.position.set(0.11 * side, 0.43, -0.27);
    brow.rotation.z = -0.35 * side;
    head.add(brow);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), toonMat('#5a1a1a'));
  mouth.position.set(0, 0.17, -0.28);
  head.add(mouth);
  // Accessory that gets knocked off first
  const acc = new THREE.Group();
  if (team === 'gov') {
    const shades = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.06), toonMat('#0b0b0b'));
    shades.position.set(0, 0.32, -0.3);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), toonMat('#3b2a1e'));
    hair.position.set(0, 0.29, 0.02);
    acc.add(shades, hair);
  } else {
    const beanie = new THREE.Mesh(new THREE.SphereGeometry(0.315, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2.3), toonMat('#1f6f3a'));
    beanie.position.set(0, 0.3, 0);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), toonMat('#f5f5f5'));
    pom.position.set(0, 0.62, 0);
    acc.add(beanie, pom);
  }
  head.add(acc);
  upper.add(head);
  parts.head = head;
  parts.acc = acc;

  // Arms + gun on a shoulder pivot so they follow pitch
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 1.12, 0);
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(0.36 * side, 0, 0);
    const limb = m(geo.limb, toonMat(L.body), 0, 0, -0.2, id, 'body');
    limb.rotation.x = Math.PI / 2;
    limb.rotation.y = 0;
    const hand = m(geo.hand, toonMat(L.skin), -0.12 * side, -0.02, -0.42, id, 'body');
    arm.rotation.y = 0.3 * side;
    arm.add(limb, hand);
    hitParts.push(limb, hand);
    armPivot.add(arm);
    parts[side < 0 ? 'armL' : 'armR'] = arm;
  }
  const gun = new THREE.Group();
  gun.position.set(0.02, 0.0, -0.5);
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.7), toonMat('#2b2b2b'));
  const gunStock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.2), toonMat('#8a5a2b'));
  gunStock.position.set(0, -0.03, 0.38);
  gun.add(gunBody, gunStock);
  armPivot.add(gun);
  upper.add(armPivot);
  parts.gun = gun;

  // Name tag (shown for teammates)
  const tagMat = new THREE.SpriteMaterial({ map: tex.label(name, team === 'gov' ? '#7ff' : '#fc8'), depthTest: false, transparent: true });
  const tag = new THREE.Sprite(tagMat);
  tag.scale.set(1.6, 0.4, 1);
  tag.position.set(0, 2.35, 0);
  tag.renderOrder = 10;
  root.add(tag);

  const stumps = [];
  const model = {
    root, upper, armPivot, parts, gun, gunBody, tag, hitParts, team,
    walkPhase: 0,
    lost: {},
    setWeapon(w) {
      const len = { rifle: 0.7, sniper: 1.05, pistol: 0.28, knife: 0.32 }[w] || 0.7;
      gunBody.scale.z = len / 0.7;
      gunBody.position.z = -(len - 0.7) / 2;
      gunBody.material = toonMat(w === 'knife' ? '#3ccf7a' : '#2b2b2b');
      gunStock.visible = w === 'rifle' || w === 'sniper';
    },
    // Remove a part (for gore). Returns a world-space copy of it to throw around, or null.
    detach(name) {
      const part = parts[name];
      if (!part || this.lost[name]) return null;
      this.lost[name] = true;
      root.updateMatrixWorld(true);
      const copy = part.clone(true);
      part.matrixWorld.decompose(copy.position, copy.quaternion, copy.scale);
      copy.traverse((o) => { o.userData = {}; });
      part.visible = false;
      for (const mesh of part.children) {
        const i = hitParts.indexOf(mesh);
        if (i >= 0) hitParts.splice(i, 1);
      }
      // Leave a bloody stump on the body (not for accessories, guns, or the torso itself)
      if (['head', 'armL', 'armR', 'legL', 'legR'].includes(name)) {
        const st = makeStump(name.startsWith('leg') ? -1 : 1);
        st.position.copy(part.position);
        part.parent.add(st);
        stumps.push(st);
        // ...and on the flying piece
        const st2 = makeStump(name === 'head' ? -1 : 1);
        copy.add(st2);
      }
      return copy;
    },
    restore() {
      for (const k of Object.keys(parts)) parts[k].visible = true;
      for (const s of stumps) s.parent && s.parent.remove(s);
      stumps.length = 0;
      this.lost = {};
      hitParts.length = 0;
      root.traverse((o) => { if (o.isMesh && o.userData && o.userData.playerId != null) hitParts.push(o); });
    },
    animate(dt, speed, pitch, crouch) {
      this.walkPhase += dt * speed * 2.4;
      const swing = Math.min(1, speed / 4) * Math.sin(this.walkPhase) * 0.7;
      parts.legL.rotation.x = swing;
      parts.legR.rotation.x = -swing;
      const bob = Math.abs(Math.sin(this.walkPhase)) * 0.05 * Math.min(1, speed / 4);
      upper.position.y = (crouch ? -0.42 : 0) + bob;
      const ls = crouch ? 0.45 : 1;
      parts.legL.scale.y = parts.legR.scale.y = ls;
      parts.legL.position.y = parts.legR.position.y = crouch ? 0.27 : 0.6;
      armPivot.rotation.x = pitch * 0.9;
      parts.head.rotation.x = pitch * 0.5;
      // little waddle
      upper.rotation.z = Math.sin(this.walkPhase) * 0.06 * Math.min(1, speed / 4);
    },
  };
  return model;
}
