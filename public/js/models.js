import * as THREE from 'three';
import { tex } from './textures.js';

const mats = {};
function mat(color) {
  return mats[color] || (mats[color] = new THREE.MeshLambertMaterial({ color }));
}

const LOOK = {
  // Government: dark suits with teal earpiece-security vibe
  gov: { torso: '#1f2a38', legs: '#161c26', accent: '#2ad4d4', hat: '#141414', skin: '#d9a77c' },
  // Opposition: hi-vis orange hoodies
  opp: { torso: '#ff8a2a', legs: '#2f3a4a', accent: '#ffe14a', hat: '#3a2a1a', skin: '#b98260' },
};

function part(w, h, d, color, x, y, z, playerId, kind) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.userData = { playerId, part: kind };
  return m;
}

export function createPlayerModel(id, team, name) {
  const L = LOOK[team] || LOOK.opp;
  const root = new THREE.Group();
  const hitParts = [];

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.13, 0.85, 0);
  legR.position.set(0.13, 0.85, 0);
  const ll = part(0.22, 0.85, 0.26, L.legs, 0, -0.425, 0, id, 'body');
  const lr = part(0.22, 0.85, 0.26, L.legs, 0, -0.425, 0, id, 'body');
  legL.add(ll);
  legR.add(lr);
  root.add(legL, legR);

  const upper = new THREE.Group();
  root.add(upper);
  const torso = part(0.56, 0.66, 0.32, L.torso, 0, 1.18, 0, id, 'body');
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.07, 0.34), mat(L.accent));
  stripe.position.set(0, 1.3, 0);
  upper.add(torso, stripe);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, 1.52, 0);
  const head = part(0.3, 0.3, 0.3, L.skin, 0, 0.15, 0, id, 'head');
  const hat = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.1, 0.33), mat(L.hat));
  hat.position.set(0, 0.32, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.04), mat('#111'));
  visor.position.set(0, 0.18, -0.16);
  headPivot.add(head, hat, visor);
  upper.add(headPivot);

  // Arms + gun pivot at the shoulders so they follow pitch
  const armPivot = new THREE.Group();
  armPivot.position.set(0, 1.42, 0);
  const armL = part(0.14, 0.14, 0.5, L.torso, -0.2, -0.05, -0.25, id, 'body');
  const armR = part(0.14, 0.14, 0.5, L.torso, 0.2, -0.05, -0.25, id, 'body');
  const gun = new THREE.Group();
  gun.position.set(0.05, -0.02, -0.55);
  const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.7), mat('#222'));
  gun.add(gunBody);
  armPivot.add(armL, armR, gun);
  upper.add(armPivot);

  hitParts.push(ll, lr, torso, head, armL, armR);

  // Name tag (shown for teammates)
  const tagTex = tex.label(name, team === 'gov' ? '#7ff' : '#fc8');
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagTex, depthTest: false, transparent: true }));
  tag.scale.set(1.6, 0.4, 1);
  tag.position.set(0, 2.25, 0);
  tag.renderOrder = 10;
  root.add(tag);

  return {
    root, upper, headPivot, armPivot, legL, legR, gun, gunBody, tag, hitParts,
    walkPhase: 0,
    deadAnim: 0,
    setWeapon(w) {
      const len = { rifle: 0.7, sniper: 1.0, pistol: 0.25, knife: 0.3 }[w] || 0.7;
      gunBody.scale.z = len / 0.7;
      gunBody.material = mat(w === 'knife' ? '#3c8a5a' : '#222');
      gunBody.position.z = -(len - 0.7) / 2;
    },
    animate(dt, speed, pitch, crouch, alive) {
      if (!alive) {
        this.deadAnim = Math.min(1, this.deadAnim + dt * 4);
        root.rotation.x = -this.deadAnim * Math.PI / 2;
        root.position.y += 0.15 * this.deadAnim;
        tag.visible = false;
        return;
      }
      this.deadAnim = 0;
      root.rotation.x = 0;
      this.walkPhase += dt * speed * 2.2;
      const swing = Math.min(1, speed / 4) * Math.sin(this.walkPhase) * 0.6;
      legL.rotation.x = swing;
      legR.rotation.x = -swing;
      const crouchDrop = crouch ? 0.5 : 0;
      upper.position.y = -crouchDrop;
      legL.scale.y = legR.scale.y = crouch ? 0.45 : 1;
      legL.position.y = legR.position.y = crouch ? 0.38 : 0.85;
      armPivot.rotation.x = pitch * 0.9;
      headPivot.rotation.x = pitch * 0.6;
    },
  };
}
