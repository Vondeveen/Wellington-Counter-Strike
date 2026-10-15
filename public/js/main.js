import * as THREE from 'three';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';
import { TEAMS, ROUND, PLAYER, WEAPONS, WEAPON_ORDER, SITES, BOTS } from '../shared/config.js';
import { buildMap } from './map.js';
import { stepBody, canStand } from './physics.js';
import { createPlayerModel, toonMat, makeStump } from './models.js';
import { createGore } from './gore.js';
import { hud, createRadar } from './hud.js';
import { tex } from './textures.js';
import * as sfx from './audio.js';

const $ = (id) => document.getElementById(id);
const INTERP_MS = 100;
const WEAPON_SPEED = { rifle: 0.95, sniper: 0.85, pistol: 1.0, knife: 1.08 };

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const settings = { name: '', sens: 1, vol: 0.5, shadows: true, invertY: false, outlines: true, gore: true };
try { Object.assign(settings, JSON.parse(localStorage.getItem('wcs-settings') || '{}')); } catch { /* storage unavailable */ }
function saveSettings() {
  try { localStorage.setItem('wcs-settings', JSON.stringify(settings)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = settings.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#cfe8ff', 170, 520);
const skyMat = new THREE.MeshBasicMaterial({ map: tex.sky(), side: THREE.BackSide, fog: false, depthWrite: false });
skyMat.userData.outlineParameters = { visible: false };
const sky = new THREE.Mesh(new THREE.SphereGeometry(560, 32, 16), skyMat);
scene.add(sky);

// Cartoon ink outlines
const outline = new OutlineEffect(renderer, { defaultThickness: 0.006, defaultColor: [0.05, 0.04, 0.06], defaultAlpha: 1 });
outline.autoClear = false;

// Wellington clouds, blown along by the northerly
const clouds = [];
{
  const cm = new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false });
  cm.userData.outlineParameters = { thickness: 0.002, color: [0.55, 0.7, 0.85] };
  for (let i = 0; i < 18; i++) {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(14 + Math.random() * 14, 10, 8), cm);
      s.position.set(j * 18 - 27 + Math.random() * 8, Math.random() * 6, Math.random() * 12);
      s.scale.y = 0.45;
      g.add(s);
    }
    g.position.set(Math.random() * 800 - 400, 150 + Math.random() * 60, Math.random() * 800 - 400);
    scene.add(g);
    clouds.push(g);
  }
}

const hemi = new THREE.HemisphereLight('#eef6ff', '#7a8a5a', 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
// Southern hemisphere: the sun sits in the north
sun.position.set(-50, 110, -80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -100, right: 100, top: 100, bottom: -100, near: 10, far: 320 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun);
scene.add(sun.target);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1500);
camera.rotation.order = 'YXZ';
scene.add(camera);

// Separate scene for the first-person weapon so it never clips into walls
const vmScene = new THREE.Scene();
const vmCamera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.01, 10);
vmScene.add(new THREE.HemisphereLight('#ffffff', '#666666', 2.2));
const vmSun = new THREE.DirectionalLight('#ffffff', 1.5);
vmSun.position.set(1, 2, 1);
vmScene.add(vmSun);

const map = buildMap(scene, { merge: !new URLSearchParams(location.search).has('nomerge') });
const drawRadar = createRadar(map);
const gore = createGore(scene, map.worldMeshes);

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = vmCamera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
});

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const me = {
  id: null, team: null, joined: false, alive: false, hp: 100,
  body: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false },
  yaw: 0, pitch: 0, eyeY: PLAYER.eye,
  weapon: 'rifle', prevWeapon: 'pistol', ammo: {}, reloadUntil: 0, drawUntil: 0, lastShot: 0,
  recoil: 0, scoped: false, action: null, actionSentAt: 0, kick: 0, stepTimer: 0,
};
const spec = { x: 62, y: 22, z: -70, yaw: 2.3, pitch: -0.22, follow: null };
const game = { phase: 'warmup', tl: 0, tlAt: 0, sc: { opp: 0, gov: 0 }, rd: 0, m: null };
const remotes = new Map();
let snapPlayers = [];
let myEntry = null;

const keys = {};
let locked = false;
let firing = false;
let firedThisPress = false;
let chatOpen = false;
let showScores = false;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------
let ws = null;
let rtt = 0;
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => {
    setStatus('Connected to server ✓', 'ok');
    document.querySelectorAll('#joinForm button').forEach((b) => { b.disabled = false; });
  };
  ws.onclose = () => {
    setStatus('Disconnected from server — retrying…', 'bad');
    document.querySelectorAll('#joinForm button').forEach((b) => { b.disabled = true; });
    if (me.joined) {
      me.joined = false;
      me.alive = false;
      for (const r of remotes.values()) removeRemote(r);
      document.exitPointerLock?.();
      showMenu(true);
    }
    setTimeout(connect, 2000);
  };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    onMessage(msg);
  };
}
function send(o) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
}
function setStatus(text, cls) {
  const s = $('connStatus');
  s.textContent = text;
  s.className = 'status ' + (cls || '');
}
setInterval(() => send({ t: 'ping', ts: performance.now(), rtt }), 2000);

function onMessage(msg) {
  switch (msg.t) {
    case 'welcome':
      me.id = msg.id;
      me.team = msg.team;
      me.joined = true;
      hud.setTeam(me.team);
      hud.show(true);
      showMenu(false);
      $('joinForm').classList.add('hidden');
      $('pauseForm').classList.remove('hidden');
      if (pendingBots) { send({ t: 'bots', ...pendingBots }); pendingBots = null; }
      break;
    case 'spawn':
      spawn(msg);
      break;
    case 'snap':
      onSnap(msg);
      break;
    case 'shot':
      onRemoteShot(msg);
      break;
    case 'hurt': {
      me.hp = msg.hp;
      hud.setHealth(me.hp);
      const dx = msg.x - me.body.x, dz = msg.z - me.body.z;
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
      hud.damage(Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz));
      sfx.playHurt();
      hud.screenBlood(msg.hp < 40 ? 3 : 1);
      me.pitch += 0.015; // aim punch
      break;
    }
    case 'hitConfirm':
      hud.hitmarker(msg.head);
      sfx.playHitmarker(msg.head);
      break;
    case 'kill': {
      const name = (id) => (id === me.id ? (myEntry?.n || 'You') : remotes.get(id)?.name || '?');
      const team = (id) => (id === me.id ? me.team : remotes.get(id)?.team || 'opp');
      hud.killfeed(msg.killer ? name(msg.killer) : null, msg.killer ? team(msg.killer) : null,
        name(msg.victim), team(msg.victim), msg.weapon, msg.head, msg.killer === me.id || msg.victim === me.id);
      if (msg.victim === me.id) {
        if (me.alive) die();
        if (msg.killer && msg.killer !== me.id) {
          hud.message(`Killed by ${name(msg.killer)}${msg.head ? ' (headshot)' : ''}`, 'warn', 4000);
          spec.follow = null;
        }
      }
      const r = remotes.get(msg.victim);
      const dir = Array.isArray(msg.d) ? { x: msg.d[0], y: msg.d[1], z: msg.d[2] } : { x: 0, y: 0, z: 0 };
      const power = msg.weapon === 'sniper' || msg.weapon === 'knife' ? 1.6 : 1;
      if (r) {
        r.alive = false;
        if (settings.gore && r.model.root.visible) gore.explode(r.model, dir, { head: msg.head, power });
        r.model.root.visible = false;
      } else if (msg.victim === me.id && settings.gore && Number.isFinite(msg.x)) {
        gore.explodeAt(me.team, msg.x, msg.y, msg.z, msg.yw || me.yaw, !!msg.c, dir, { head: msg.head, power });
      }
      if (msg.victim === me.id) hud.screenBlood(6);
      break;
    }
    case 'bleed': {
      const point = Array.isArray(msg.p) ? { x: msg.p[0], y: msg.p[1], z: msg.p[2] } : null;
      const dir = Array.isArray(msg.d) ? { x: msg.d[0], y: msg.d[1], z: msg.d[2] } : { x: 0, y: 0, z: 1 };
      if (point && msg.from !== me.id && settings.gore) gore.hit(point, dir, msg.head, msg.dmg);
      const r = remotes.get(msg.id);
      if (r && msg.hp > 0) loseLimbs(r, msg.hp, dir);
      if (msg.id === me.id && msg.hp > 0 && msg.hp < 45 && !me.lostArm && settings.gore) {
        me.lostArm = true;
        updateViewmodelVisibility();
        hud.message('Your arm came off!', 'warn', 2000);
      }
      break;
    }
    case 'round':
      gore.clear();
      hud.banner(`Round ${msg.round}`, me.team === 'opp' ? 'Table the Motion of No Confidence at A or B' : 'Defend the Debating Chamber (A) and the Beehive (B)', '#fff', 3500);
      break;
    case 'go':
      hud.banner('GO GO GO!', '', '#ffdd55', 1500);
      break;
    case 'planted':
      hud.banner('Motion tabled!', `Site ${msg.site} — ${ROUND.motionTime} seconds to veto`, '#ff5544', 3500);
      break;
    case 'roundEnd': {
      const t = TEAMS[msg.winner];
      hud.banner(`${t.name} win the round`, msg.reason, t.color, 5000);
      sfx.playJingle(msg.winner === me.team);
      break;
    }
    case 'event':
      if (msg.kind === 'big') hud.message(msg.text, 'big', 5000);
      else if (msg.kind === 'warn') hud.message(msg.text, 'warn');
      else hud.chat('', '', msg.text, true);
      break;
    case 'chat':
      hud.chat(msg.name, msg.team, msg.text);
      break;
    case 'left': {
      const r = remotes.get(msg.id);
      if (r) removeRemote(r);
      break;
    }
    case 'pong':
      rtt = performance.now() - msg.ts;
      break;
  }
}

// ---------------------------------------------------------------------------
// Remote players
// ---------------------------------------------------------------------------
function addRemote(p) {
  const model = createPlayerModel(p.id, p.tm, p.n);
  scene.add(model.root);
  const r = { id: p.id, name: p.n, team: p.tm, alive: !!p.a, weapon: p.w, model, buf: [], speed: 0, last: null, stepT: 0, crouch: false, pitch: 0, yaw: 0 };
  model.setWeapon(p.w);
  remotes.set(p.id, r);
  return r;
}
// Bits fall off as characters get hurt: hat/sunglasses first, then an arm
function loseLimbs(r, hp, dir) {
  if (!settings.gore || !r.model.root.visible) return;
  if (hp < 75 && !r.model.lost.acc) gore.knockOff(r.model, 'acc', dir);
  if (hp < 45 && !r.model.lost.armL) gore.knockOff(r.model, 'armL', dir);
}

function removeRemote(r) {
  scene.remove(r.model.root);
  remotes.delete(r.id);
  if (spec.follow === r.id) spec.follow = null;
}

function onSnap(msg) {
  const now = performance.now();
  const g = msg.g;
  const prevPhase = game.phase;
  game.phase = g.ph;
  game.tl = g.tl;
  game.tlAt = now;
  game.sc = g.sc;
  game.rd = g.rd;
  game.m = g.m;
  if (g.bf !== undefined && document.activeElement !== botFill) botFill.value = g.bf;
  if (g.bd && document.activeElement !== botDiff) botDiff.value = g.bd;
  if (prevPhase !== game.phase && game.phase === 'warmup') hud.banner('Warmup', 'Waiting for players on both teams', '#fff', 2500);
  snapPlayers = msg.players;
  const seen = new Set();
  for (const p of msg.players) {
    seen.add(p.id);
    if (p.id === me.id) {
      myEntry = p;
      if (me.team !== p.tm) { me.team = p.tm; hud.setTeam(me.team); }
      if (me.alive && !p.a) die();
      if (me.alive) { me.hp = p.hp; hud.setHealth(p.hp); }
      continue;
    }
    let r = remotes.get(p.id);
    if (r && r.team !== p.tm) { removeRemote(r); r = null; }
    if (!r) r = addRemote(p);
    if (!r.alive && p.a) {
      // Respawned: put them back together and don't interpolate across the map
      r.buf.length = 0;
      r.model.restore();
      r.model.root.visible = true;
    }
    r.alive = !!p.a;
    r.hp = p.hp;
    r.bot = !!p.bot;
    r.name = p.n;
    if (r.weapon !== p.w) { r.weapon = p.w; r.model.setWeapon(p.w); }
    r.buf.push({ t: now, x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt, c: p.c });
    if (r.buf.length > 30) r.buf.shift();
  }
  for (const r of [...remotes.values()]) if (!seen.has(r.id)) removeRemote(r);
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function updateRemotes(dt) {
  const renderT = performance.now() - INTERP_MS;
  for (const r of remotes.values()) {
    const b = r.buf;
    if (!b.length) { r.model.root.visible = false; continue; }
    let s;
    if (renderT <= b[0].t) s = b[0];
    else if (renderT >= b[b.length - 1].t) s = b[b.length - 1];
    else {
      let i = 0;
      while (i < b.length - 2 && b[i + 1].t < renderT) i++;
      const a = b[i], c = b[i + 1];
      const k = (renderT - a.t) / Math.max(1, c.t - a.t);
      s = {
        x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k,
        yw: lerpAngle(a.yw, c.yw, k), pt: a.pt + (c.pt - a.pt) * k, c: c.c,
      };
    }
    const root = r.model.root;
    if (r.last && dt > 0) {
      const v = Math.hypot(s.x - r.last.x, s.z - r.last.z) / dt;
      r.speed += (Math.min(v, 10) - r.speed) * Math.min(1, dt * 10);
    }
    r.last = { x: s.x, y: s.y, z: s.z };
    r.yaw = s.yw;
    r.pitch = s.pt;
    r.crouch = !!s.c;
    root.position.set(s.x, s.y, s.z);
    root.rotation.y = s.yw;
    root.visible = r.alive && (spec.follow !== r.id || me.alive);
    r.model.animate(dt, r.speed, s.pt, r.crouch);
    // Stumps drip
    if (r.alive && r.model.lost.armL && settings.gore && Math.random() < dt * 6) {
      const sp = r.model.parts.armL.getWorldPosition(tmpV2);
      gore.drip(sp);
    }
    r.model.tag.visible = r.alive && r.team === me.team;
    root.updateMatrixWorld(true);

    // Footsteps: running players are audible, walking (shift) players are silent
    if (r.alive && r.speed > 4.2) {
      r.stepT -= dt;
      if (r.stepT <= 0) {
        r.stepT = 0.36;
        sfx.playStep({ x: s.x, y: s.y, z: s.z });
      }
    }
  }
}

const tmpV2 = new THREE.Vector3();
function enemyHitParts() {
  const parts = [];
  for (const r of remotes.values()) {
    if (r.alive && r.team !== me.team && r.model.root.visible) parts.push(...r.model.hitParts);
  }
  return parts;
}

// ---------------------------------------------------------------------------
// The Motion of No Confidence (bomb) object
// ---------------------------------------------------------------------------
const motionObj = new THREE.Group();
{
  const folder = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.36), toonMat('#d01c2c'));
  folder.position.y = 0.05;
  const paper = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.3), toonMat('#fffaf0'));
  paper.position.y = 0.1;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.75, 32),
    new THREE.MeshBasicMaterial({ color: '#ffcc33', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.material.userData.outlineParameters = { visible: false };
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2222' }));
  lamp.position.set(0.15, 0.16, 0);
  motionObj.add(folder, paper, ring, lamp);
  motionObj.userData = { ring, lamp };
  motionObj.visible = false;
  scene.add(motionObj);
}
let nextBeep = 0;

function updateMotion(dt, nowS) {
  const m = game.m;
  if (!m || (m.c && !m.p)) {
    motionObj.visible = false;
  } else {
    motionObj.visible = true;
    motionObj.position.set(m.x, m.y + 0.01, m.z);
    motionObj.rotation.y += dt * (m.p ? 0 : 1.5);
    motionObj.userData.ring.scale.setScalar(1 + Math.sin(nowS * 4) * 0.1);
  }
  const planted = m && m.p && game.phase === 'planted';
  const blink = planted && Math.floor(nowS * 4) % 2 === 0;
  motionObj.userData.lamp.visible = !!blink;
  if (planted) {
    const tl = Math.max(0, game.tl - (performance.now() - game.tlAt) / 1000);
    if (nowS >= nextBeep) {
      sfx.playBeep({ x: m.x, y: m.y + 0.3, z: m.z });
      nextBeep = nowS + Math.max(0.1, Math.min(1, tl / ROUND.motionTime));
    }
  }
  hud.setCarry(!!(m && m.c === me.id && !m.p));
}

// ---------------------------------------------------------------------------
// Effects: tracers, impacts, viewmodel
// ---------------------------------------------------------------------------
const tracers = [];
function addTracer(a, b, color = '#ffe9a0') {
  const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  scene.add(line);
  tracers.push({ obj: line, life: 0.08, max: 0.08 });
}

const decalGeo = new THREE.PlaneGeometry(0.12, 0.12);
const decalMat = new THREE.MeshBasicMaterial({ color: '#1a1a1a', transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
decalMat.userData.outlineParameters = { visible: false };
const decals = [];
let decalIdx = 0;
for (let i = 0; i < 80; i++) {
  const d = new THREE.Mesh(decalGeo, decalMat);
  d.visible = false;
  scene.add(d);
  decals.push(d);
}
const puffMats = {
  dust: new THREE.SpriteMaterial({ color: '#cfc6b5', transparent: true, opacity: 0.8, depthWrite: false }),
  blood: new THREE.SpriteMaterial({ color: '#b01010', transparent: true, opacity: 0.9, depthWrite: false }),
};
const puffs = [];
function addPuff(p, kind) {
  const s = new THREE.Sprite(puffMats[kind].clone());
  s.position.copy(p);
  s.scale.setScalar(0.15);
  scene.add(s);
  puffs.push({ obj: s, life: 0.35, max: 0.35 });
}
function addImpact(hit) {
  const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  const d = decals[decalIdx++ % decals.length];
  d.position.copy(hit.point).addScaledVector(n, 0.01);
  d.lookAt(hit.point.clone().add(n));
  d.visible = true;
  addPuff(hit.point.clone().addScaledVector(n, 0.05), 'dust');
}

function updateEffects(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.obj.material.opacity = Math.max(0, t.life / t.max) * 0.85;
    if (t.life <= 0) {
      scene.remove(t.obj);
      t.obj.geometry.dispose();
      t.obj.material.dispose();
      tracers.splice(i, 1);
    }
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i];
    p.life -= dt;
    const k = 1 - p.life / p.max;
    p.obj.scale.setScalar(0.15 + k * 0.5);
    p.obj.material.opacity = (1 - k) * 0.8;
    if (p.life <= 0) {
      scene.remove(p.obj);
      p.obj.material.dispose();
      puffs.splice(i, 1);
    }
  }
}

// First-person weapon models
const vmRoot = new THREE.Group();
vmScene.add(vmCamera);
vmCamera.add(vmRoot);
const vmModels = {};
const muzzleFlash = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
);
muzzleFlash.material.userData.outlineParameters = { visible: false };
muzzleFlash.visible = false;
let flashTime = 0;
function buildViewmodels() {
  const m = (c, opts = {}) => toonMat(c, opts);
  const bx = (w, h, d, mat, x, y, z) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    return mesh;
  };
  const sleeve = (team) => m(team === 'gov' ? '#22324a' : '#ff8a1e');
  const skin = m('#e8b48a');
  const arms = (g, team, front = -0.32) => {
    g.add(bx(0.09, 0.09, 0.4, sleeve(team), 0.05, -0.1, 0.2));
    g.add(bx(0.07, 0.07, 0.08, skin, 0.0, -0.06, 0.02));
    const left = new THREE.Group();
    left.add(bx(0.09, 0.09, 0.4, sleeve(team), -0.16, -0.12, front + 0.2));
    left.add(bx(0.07, 0.07, 0.08, skin, -0.08, -0.06, front));
    const stump = makeStump();
    stump.scale.setScalar(0.5);
    stump.rotation.x = Math.PI / 2;
    stump.position.set(-0.16, -0.12, front + 0.42);
    stump.visible = false;
    g.add(left, stump);
    g.userData.leftArm = left;
    g.userData.stump = stump;
  };
  for (const team of ['opp', 'gov']) {
    const rifle = new THREE.Group();
    rifle.add(bx(0.07, 0.09, 0.55, m('#2a2a2a'), 0, 0, -0.2));
    rifle.add(bx(0.03, 0.03, 0.3, m('#111'), 0, 0.015, -0.62));
    rifle.add(bx(0.08, 0.075, 0.24, m('#6b4226'), 0, -0.005, -0.38));
    const mag = bx(0.05, 0.16, 0.08, m('#383838'), 0, -0.11, -0.2);
    mag.rotation.x = 0.25;
    rifle.add(mag);
    rifle.add(bx(0.06, 0.11, 0.22, m('#6b4226'), 0, -0.03, 0.15));
    arms(rifle, team, -0.36);
    rifle.userData.muzzle = new THREE.Vector3(0, 0.015, -0.8);

    const sniper = new THREE.Group();
    sniper.add(bx(0.07, 0.09, 0.7, m('#2f3b2a'), 0, 0, -0.25));
    sniper.add(bx(0.035, 0.035, 0.5, m('#111'), 0, 0.01, -0.82));
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.32, 12), m('#111'));
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.25);
    sniper.add(scope);
    sniper.add(bx(0.06, 0.12, 0.24, m('#2f3b2a'), 0, -0.04, 0.18));
    arms(sniper, team, -0.4);
    sniper.userData.muzzle = new THREE.Vector3(0, 0.01, -1.08);

    const pistol = new THREE.Group();
    pistol.add(bx(0.05, 0.06, 0.22, m('#222'), 0, 0, -0.16));
    const grip = bx(0.045, 0.13, 0.06, m('#333'), 0, -0.08, -0.08);
    grip.rotation.x = -0.25;
    pistol.add(grip);
    arms(pistol, team, -0.1);
    pistol.userData.muzzle = new THREE.Vector3(0, 0.01, -0.28);

    const knife = new THREE.Group();
    const blade = bx(0.015, 0.05, 0.28, m('#3c9a6a', { emissive: '#0d3320' }), 0, 0.02, -0.25);
    knife.add(blade);
    knife.add(bx(0.03, 0.045, 0.12, m('#2a1a0a'), 0, 0.01, -0.06));
    arms(knife, team, -0.03);
    knife.userData.muzzle = new THREE.Vector3(0, 0, -0.4);

    vmModels[team] = { rifle, sniper, pistol, knife };
    for (const g of Object.values(vmModels[team])) {
      g.visible = false;
      vmRoot.add(g);
    }
  }
  vmRoot.add(muzzleFlash);
}
buildViewmodels();

function updateViewmodelVisibility() {
  for (const team of ['opp', 'gov']) {
    for (const [k, g] of Object.entries(vmModels[team])) {
      g.visible = me.alive && team === me.team && k === me.weapon && !me.scoped;
      if (g.userData.leftArm) {
        g.userData.leftArm.visible = !me.lostArm;
        g.userData.stump.visible = !!me.lostArm;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Local player
// ---------------------------------------------------------------------------
function resetAmmo() {
  for (const k of WEAPON_ORDER) me.ammo[k] = { mag: WEAPONS[k].mag, reserve: WEAPONS[k].reserve };
}

function spawn(msg) {
  Object.assign(me.body, { x: msg.x, y: msg.y, z: msg.z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: false });
  me.yaw = msg.yaw;
  me.pitch = 0;
  me.alive = true;
  me.hp = ROUND.maxHp;
  me.weapon = 'rifle';
  me.prevWeapon = 'pistol';
  me.reloadUntil = 0;
  me.drawUntil = 0;
  me.recoil = 0;
  me.action = null;
  me.lostArm = false;
  spec.follow = null;
  resetAmmo();
  setScope(false);
  hud.setHealth(me.hp);
  hud.spectate(null);
  updateViewmodelVisibility();
}

function die() {
  me.alive = false;
  me.hp = 0;
  hud.setHealth(0);
  setScope(false);
  if (me.action) { send({ t: 'action', kind: me.action, active: false }); me.action = null; }
  spec.x = me.body.x;
  spec.y = me.body.y + 3;
  spec.z = me.body.z;
  spec.yaw = me.yaw;
  spec.pitch = -0.5;
  updateViewmodelVisibility();
}

function selectWeapon(k) {
  if (!me.alive || k === me.weapon || !WEAPONS[k]) return;
  me.prevWeapon = me.weapon;
  me.weapon = k;
  me.reloadUntil = 0;
  me.drawUntil = performance.now() / 1000 + 0.35;
  setScope(false);
  updateViewmodelVisibility();
}

function reload() {
  const w = WEAPONS[me.weapon];
  const a = me.ammo[me.weapon];
  if (!me.alive || w.melee || me.reloadUntil || a.mag >= w.mag || a.reserve <= 0) return;
  me.reloadUntil = performance.now() / 1000 + w.reload;
  setScope(false);
  sfx.playReload();
}

function setScope(on) {
  me.scoped = on;
  hud.scope(on);
  camera.fov = on ? 20 : 75;
  camera.updateProjectionMatrix();
  updateViewmodelVisibility();
}

const raycaster = new THREE.Raycaster();
const tmpV = new THREE.Vector3();
function fire(nowS) {
  const w = WEAPONS[me.weapon];
  const a = me.ammo[me.weapon];
  if (!w.auto && firedThisPress) return;
  if (nowS - me.lastShot < 60 / w.rpm) return;
  if (!w.melee && a.mag <= 0) {
    if (!firedThisPress) sfx.playClick();
    firedThisPress = true;
    reload();
    return;
  }
  firedThisPress = true;
  me.lastShot = nowS;
  if (!w.melee) a.mag--;

  const b = me.body;
  const speed = Math.hypot(b.vx, b.vz);
  let spread = w.scope && me.scoped ? w.scopedSpread : w.spread;
  spread += w.moveSpread * Math.min(1, speed / PLAYER.runSpeed);
  if (!b.onGround) spread += w.airSpread;
  if (b.crouch) spread *= 0.7;
  spread += me.recoil * 0.5;

  camera.updateMatrixWorld();
  const origin = camera.getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const r = spread * Math.sqrt(Math.random());
  const ang = Math.random() * Math.PI * 2;
  const dir = fwd.clone().addScaledVector(right, Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r).normalize();

  raycaster.set(origin, dir);
  raycaster.far = w.range;
  const hits = raycaster.intersectObjects([...map.worldMeshes, ...enemyHitParts()], false);
  const hit = hits[0];
  const end = hit ? hit.point.clone() : origin.clone().addScaledVector(dir, w.range);
  const muzzle = origin.clone().addScaledVector(fwd, 0.6).addScaledVector(right, 0.14).addScaledVector(up, -0.12);
  const round3 = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  send({ t: 'shoot', w: me.weapon, o: round3(muzzle), h: round3(end) });

  if (hit) {
    const ud = hit.object.userData;
    if (ud.playerId) {
      const head = ud.part === 'head';
      send({ t: 'hit', target: ud.playerId, w: me.weapon, head, p: [hit.point.x, hit.point.y, hit.point.z].map((v) => +v.toFixed(2)) });
      if (settings.gore) gore.hit(hit.point, dir, head, w.damage * (head ? w.headMult : 1));
    } else if (!w.melee) addImpact(hit);
  }
  if (!w.melee) addTracer(muzzle, end);
  sfx.playShot(me.weapon);

  // Recoil and view punch
  me.recoil = Math.min(w.maxRecoil, me.recoil + w.recoil);
  me.pitch += w.recoil * 0.35 * (0.6 + Math.random() * 0.4);
  me.yaw += (Math.random() - 0.5) * w.recoil * 0.25;
  me.kick = 1;
  if (!w.melee) {
    flashTime = 0.05;
    const mz = vmModels[me.team][me.weapon].userData.muzzle;
    muzzleFlash.position.copy(mz);
    muzzleFlash.rotation.z = Math.random() * Math.PI;
  }
  if (w.scope && me.scoped) setScope(false);
  if (!w.melee && a.mag === 0) setTimeout(reload, 250);
}

function onRemoteShot(msg) {
  const r = remotes.get(msg.id);
  const o = Array.isArray(msg.o) ? new THREE.Vector3(...msg.o) : null;
  const h = Array.isArray(msg.h) ? new THREE.Vector3(...msg.h) : null;
  const pos = r ? r.model.root.position : o;
  if (pos) sfx.playShot(msg.w, { x: pos.x, y: pos.y + 1.5, z: pos.z });
  if (o && h && msg.w !== 'knife' && [...msg.o, ...msg.h].every(Number.isFinite)) {
    addTracer(o, h, '#fff2c0');
    addPuff(h, 'dust');
  }
}

function nearMotion() {
  const m = game.m;
  if (!m) return false;
  return Math.hypot(me.body.x - m.x, me.body.z - m.z) < 2.0 && Math.abs(me.body.y - m.y) < 2;
}
function siteHere() {
  for (const [k, s] of Object.entries(SITES)) {
    if (Math.hypot(me.body.x - s.x, me.body.z - s.z) <= s.radius) return k;
  }
  return null;
}

function startAction() {
  if (!me.alive || me.action) return;
  const m = game.m;
  if (me.team === 'opp' && m && m.c === me.id && !m.p && game.phase === 'live') {
    me.action = 'plant';
  } else if (me.team === 'gov' && m && m.p && game.phase === 'planted' && nearMotion()) {
    me.action = 'defuse';
  } else return;
  me.actionSentAt = performance.now();
  send({ t: 'action', kind: me.action, active: true });
}
function stopAction() {
  if (!me.action) return;
  send({ t: 'action', kind: me.action, active: false });
  me.action = null;
}

function updateLocal(dt, nowS) {
  const b = me.body;
  const frozen = game.phase === 'freeze' || chatOpen || !locked || !!me.action;
  let fx = 0, sx = 0;
  if (!frozen) {
    if (keys.KeyW) fx += 1;
    if (keys.KeyS) fx -= 1;
    if (keys.KeyD) sx += 1;
    if (keys.KeyA) sx -= 1;
  }
  const wantCrouch = !chatOpen && (keys.ControlLeft || keys.KeyC || keys.ControlRight);
  if (wantCrouch) b.crouch = true;
  else if (b.crouch && canStand(b)) b.crouch = false;

  let speed = b.crouch ? PLAYER.crouchSpeed : keys.ShiftLeft || keys.ShiftRight ? PLAYER.walkSpeed : PLAYER.runSpeed;
  speed *= WEAPON_SPEED[me.weapon] || 1;
  if (me.scoped) speed *= 0.55;
  const len = Math.hypot(fx, sx) || 1;
  const sin = Math.sin(me.yaw), cos = Math.cos(me.yaw);
  const wish = {
    x: ((-sin * fx + cos * sx) / len) * speed,
    z: ((-cos * fx - sin * sx) / len) * speed,
  };
  const jump = !frozen && keys.Space;
  // Fixed sub-steps for consistent physics
  let remaining = Math.min(dt, 0.1);
  while (remaining > 1e-4) {
    const step = Math.min(remaining, 1 / 120);
    stepBody(b, wish, jump, step);
    remaining -= step;
  }

  const targetEye = b.crouch ? PLAYER.crouchEye : PLAYER.eye;
  me.eyeY += (targetEye - me.eyeY) * Math.min(1, dt * 14);
  const hspeed = Math.hypot(b.vx, b.vz);
  const bob = b.onGround ? Math.sin(nowS * 11) * 0.03 * Math.min(1, hspeed / PLAYER.runSpeed) : 0;

  // Footsteps (only when running)
  if (b.onGround && hspeed > 4.2) {
    me.stepTimer -= dt;
    if (me.stepTimer <= 0) {
      me.stepTimer = 0.36;
      sfx.playStep({ x: b.x, y: b.y, z: b.z });
    }
  }

  // Reload completion
  if (me.reloadUntil && nowS >= me.reloadUntil) {
    const w = WEAPONS[me.weapon];
    const a = me.ammo[me.weapon];
    const take = Math.min(w.mag - a.mag, a.reserve);
    a.mag += take;
    a.reserve -= take;
    me.reloadUntil = 0;
  }
  // Point the camera before firing so shots use this frame's aim
  me.pitch = Math.max(-1.55, Math.min(1.55, me.pitch));
  camera.position.set(b.x, b.y + me.eyeY + bob, b.z);
  camera.rotation.set(me.pitch, me.yaw, 0);
  if (firing && locked && !chatOpen && game.phase !== 'freeze' && nowS >= me.drawUntil && !me.reloadUntil && !me.action) fire(nowS);
  me.recoil = Math.max(0, me.recoil - dt * (firing ? 0.08 : 0.35));

  me.pitch = Math.max(-1.55, Math.min(1.55, me.pitch));
  camera.position.set(b.x, b.y + me.eyeY + bob, b.z);
  camera.rotation.set(me.pitch, me.yaw, 0);

  // Objective hints and progress
  const m = game.m;
  if (me.action && myEntry && myEntry.ac === me.action) {
    hud.progress(me.action === 'plant' ? 'Tabling the Motion of No Confidence…' : 'Vetoing the Motion…', myEntry.pr);
  } else if (me.action && performance.now() - me.actionSentAt > 500 && !(myEntry && myEntry.ac)) {
    me.action = null; // server rejected or cancelled
    hud.progress(null);
  } else if (!me.action) hud.progress(null);

  let hint = '';
  if (m && m.c === me.id && !m.p && game.phase === 'live') hint = siteHere() ? 'Hold E to table the Motion here' : 'Carry the Motion to site A (Debating Chamber) or B (Beehive)';
  else if (me.team === 'gov' && m && m.p && nearMotion()) hint = 'Hold E to veto the Motion';
  else if (me.team === 'opp' && m && !m.c && !m.p && game.phase === 'live') hint = 'The Motion is on the ground — walk over it to pick it up';
  hud.hint(game.phase === 'freeze' ? 'Freeze time — get ready' : hint);

  hud.setAmmo(me.weapon, me.ammo[me.weapon].mag, me.ammo[me.weapon].reserve, !!me.reloadUntil);
  const gap = 4 + (spreadNow() * 400);
  hud.crosshairGap(gap);
  hud.crosshairVisible(!me.scoped && me.weapon !== 'sniper');

  // Viewmodel animation
  me.kick = Math.max(0, me.kick - dt * 10);
  const drawK = Math.max(0, me.drawUntil - nowS) / 0.35;
  const reloadK = me.reloadUntil ? Math.sin(Math.min(1, 1 - (me.reloadUntil - nowS) / WEAPONS[me.weapon].reload) * Math.PI) : 0;
  const swing = me.weapon === 'knife' ? me.kick : 0;
  vmRoot.position.set(0.2 + Math.sin(nowS * 5.5) * 0.012 * Math.min(1, hspeed / 6), -0.2 + bob * 0.5 - drawK * 0.25 - reloadK * 0.12, -0.32 + me.kick * 0.05);
  vmRoot.rotation.set(me.kick * 0.08 - reloadK * 0.6 - swing * 0.6, swing * 0.8, reloadK * 0.3);
  flashTime -= dt;
  muzzleFlash.visible = flashTime > 0 && me.alive && !me.scoped;

  // Network update
  sendState(nowS);
}

function spreadNow() {
  const w = WEAPONS[me.weapon];
  const b = me.body;
  let s = w.spread + w.moveSpread * Math.min(1, Math.hypot(b.vx, b.vz) / PLAYER.runSpeed) + me.recoil * 0.5;
  if (!b.onGround) s += w.airSpread;
  if (b.crouch) s *= 0.7;
  return s;
}

let lastStateSent = 0;
function sendState(nowS) {
  if (nowS - lastStateSent < 1 / 30) return;
  lastStateSent = nowS;
  const b = me.body;
  send({
    t: 'state', x: +b.x.toFixed(3), y: +b.y.toFixed(3), z: +b.z.toFixed(3),
    yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), c: b.crouch ? 1 : 0, w: me.weapon,
  });
}

// ---------------------------------------------------------------------------
// Spectator
// ---------------------------------------------------------------------------
function cycleFollow(dirn = 1) {
  const pool = [...remotes.values()].filter((r) => r.alive && (r.team === me.team || !teamAlive(me.team)));
  if (!pool.length) { spec.follow = null; return; }
  const idx = pool.findIndex((r) => r.id === spec.follow);
  spec.follow = pool[(idx + dirn + pool.length) % pool.length].id;
}
function teamAlive(team) {
  return [...remotes.values()].some((r) => r.alive && r.team === team);
}

function updateSpectator(dt) {
  let r = spec.follow ? remotes.get(spec.follow) : null;
  if (r && !r.alive) { cycleFollow(); r = spec.follow ? remotes.get(spec.follow) : null; }
  if (r) {
    const p = r.model.root.position;
    camera.position.set(p.x, p.y + (r.crouch ? PLAYER.crouchEye : PLAYER.eye), p.z);
    camera.rotation.set(r.pitch, r.yaw, 0);
    hud.spectate(`Spectating ${r.name} · Click: next player · Right-click: free camera`);
    return;
  }
  const sp = keys.ShiftLeft ? 30 : 14;
  const sin = Math.sin(spec.yaw), cos = Math.cos(spec.yaw);
  let fx = 0, sx = 0, uy = 0;
  if (!chatOpen) {
    if (keys.KeyW) fx += 1;
    if (keys.KeyS) fx -= 1;
    if (keys.KeyD) sx += 1;
    if (keys.KeyA) sx -= 1;
    if (keys.Space) uy += 1;
    if (keys.ControlLeft || keys.KeyC) uy -= 1;
  }
  if (!me.joined) spec.yaw += dt * 0.04;
  spec.x += (-sin * fx + cos * sx) * sp * dt;
  spec.z += (-cos * fx - sin * sx) * sp * dt;
  spec.y = Math.max(0.5, Math.min(80, spec.y + (uy + fx * Math.sin(spec.pitch)) * sp * dt));
  camera.position.set(spec.x, spec.y, spec.z);
  camera.rotation.set(spec.pitch, spec.yaw, 0);
  const waiting = me.joined && game.phase !== 'warmup' ? ' · You will spawn next round' : (game.phase === 'warmup' ? ' · Respawning…' : '');
  hud.spectate(me.joined ? `Free camera${waiting} · Click: follow a player` : '');
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
document.addEventListener('keydown', (e) => {
  if (chatOpen) return;
  if (e.code === 'Tab') { e.preventDefault(); showScores = true; }
  if (!me.joined) return;
  keys[e.code] = true;
  if (!locked) return;
  if (['Space', 'ControlLeft', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault();
  switch (e.code) {
    case 'Digit1': selectWeapon('rifle'); break;
    case 'Digit2': selectWeapon('sniper'); break;
    case 'Digit3': selectWeapon('pistol'); break;
    case 'Digit4': selectWeapon('knife'); break;
    case 'KeyQ': selectWeapon(me.prevWeapon); break;
    case 'KeyR': reload(); break;
    case 'KeyE': if (!e.repeat) startAction(); break;
    case 'KeyT':
    case 'Enter':
      e.preventDefault();
      openChat();
      break;
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'Tab') showScores = false;
  if (e.code === 'KeyE') stopAction();
});
window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  firing = false;
  stopAction();
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const fovK = camera.fov / 75;
  const k = 0.0022 * settings.sens * fovK;
  const dy = e.movementY * (settings.invertY ? -1 : 1);
  if (me.alive) {
    me.yaw -= e.movementX * k;
    me.pitch -= dy * k;
  } else {
    spec.yaw -= e.movementX * k;
    spec.pitch = Math.max(-1.5, Math.min(1.5, spec.pitch - dy * k));
  }
});
document.addEventListener('mousedown', (e) => {
  if (!locked) return;
  sfx.initAudio();
  if (!me.alive) {
    if (e.button === 0) cycleFollow(1);
    if (e.button === 2) spec.follow = null;
    return;
  }
  if (e.button === 0) { firing = true; firedThisPress = false; }
  if (e.button === 2 && WEAPONS[me.weapon].scope && !me.reloadUntil) setScope(!me.scoped);
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) firing = false;
});
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('wheel', (e) => {
  if (!locked || !me.alive) return;
  const i = WEAPON_ORDER.indexOf(me.weapon);
  const n = WEAPON_ORDER.length;
  selectWeapon(WEAPON_ORDER[(i + (e.deltaY > 0 ? 1 : -1) + n) % n]);
}, { passive: true });

canvas.addEventListener('click', () => {
  if (me.joined && !locked && !chatOpen) requestLock();
});
function requestLock() {
  sfx.initAudio();
  try {
    const p = canvas.requestPointerLock();
    if (p && p.catch) p.catch(() => { /* user must click again (browser cooldown) */ });
  } catch { /* ignore */ }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) showMenu(false);
  else {
    firing = false;
    stopAction();
    if (me.joined && !chatOpen) showMenu(true);
  }
});

// Chat
const chatInput = $('chatInput');
function openChat() {
  chatOpen = true;
  for (const k in keys) keys[k] = false;
  firing = false;
  chatInput.classList.remove('hidden');
  document.exitPointerLock?.();
  setTimeout(() => chatInput.focus(), 0);
}
function closeChat() {
  chatOpen = false;
  chatInput.value = '';
  chatInput.classList.add('hidden');
  chatInput.blur();
  requestLock();
}
chatInput.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    const text = chatInput.value.trim();
    if (text) send({ t: 'chat', text });
    closeChat();
  } else if (e.key === 'Escape') closeChat();
});

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
const nameInput = $('nameInput');
nameInput.value = settings.name || '';
function showMenu(on) {
  $('menu').classList.toggle('hidden', !on);
}
document.querySelectorAll('#joinForm button[data-team]').forEach((btn) => {
  btn.disabled = true;
  btn.addEventListener('click', () => {
    settings.name = nameInput.value.trim().slice(0, 16);
    saveSettings();
    send({ t: 'join', name: settings.name, team: btn.dataset.team });
    hud.show(true);
    requestLock();
  });
});
document.querySelectorAll('#pauseForm button[data-switch]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.switch !== me.team) send({ t: 'team', team: btn.dataset.switch });
    requestLock();
  });
});
$('resumeBtn').addEventListener('click', requestLock);

const sens = $('sens');
sens.value = settings.sens;
$('sensVal').textContent = Number(settings.sens).toFixed(2);
sens.addEventListener('input', () => {
  settings.sens = Number(sens.value);
  $('sensVal').textContent = settings.sens.toFixed(2);
  saveSettings();
});
const vol = $('vol');
vol.value = settings.vol;
vol.addEventListener('input', () => {
  settings.vol = Number(vol.value);
  sfx.setVolume(settings.vol);
  saveSettings();
});
const shadows = $('shadows');
shadows.checked = settings.shadows;
shadows.addEventListener('change', () => {
  settings.shadows = shadows.checked;
  renderer.shadowMap.enabled = settings.shadows;
  scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  saveSettings();
});
const outlinesBox = $('outlines');
outlinesBox.checked = settings.outlines;
outlinesBox.addEventListener('change', () => { settings.outlines = outlinesBox.checked; saveSettings(); });
const goreBox = $('goreToggle');
goreBox.checked = settings.gore;
goreBox.addEventListener('change', () => {
  settings.gore = goreBox.checked;
  if (!settings.gore) gore.clear();
  saveSettings();
});

// Bot controls (server-wide)
const botFill = $('botFill');
for (let i = 0; i <= BOTS.maxFill; i++) {
  const o = document.createElement('option');
  o.value = i;
  o.textContent = i === 0 ? 'No bots' : `${i} per team`;
  botFill.appendChild(o);
}
botFill.value = BOTS.defaultFill;
const botDiff = $('botDiff');
botDiff.value = BOTS.defaultDifficulty;
let pendingBots = null;
function sendBots() {
  pendingBots = { fill: Number(botFill.value), difficulty: botDiff.value };
  if (me.joined) { send({ t: 'bots', ...pendingBots }); pendingBots = null; }
}
botFill.addEventListener('change', sendBots);
botDiff.addEventListener('change', sendBots);

const invertY = $('invertY');
invertY.checked = settings.invertY;
invertY.addEventListener('change', () => { settings.invertY = invertY.checked; saveSettings(); });

{
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  $('shareInfo').textContent = local
    ? 'Friends on your network: give them the "Network" address printed in the server console. Over the internet, see the README for hosting options.'
    : `Friends can join at: ${location.origin}`;
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastFrame = performance.now();
function frame() {
  requestAnimationFrame(frame);
  const nowMs = performance.now();
  const dt = Math.min(0.1, (nowMs - lastFrame) / 1000);
  lastFrame = nowMs;
  const nowS = nowMs / 1000;

  updateRemotes(dt);
  if (me.alive) {
    updateLocal(dt, nowS);
    hud.spectate(null);
  } else {
    updateSpectator(dt);
    hud.progress(null);
    hud.hint('');
    hud.crosshairVisible(false);
  }
  updateMotion(dt, nowS);
  updateEffects(dt);
  gore.update(dt);
  map.update(nowS);
  for (const c of clouds) {
    c.position.x += dt * 4;
    if (c.position.x > 420) c.position.x = -420;
  }
  sfx.setListener(camera.position.x, camera.position.y, camera.position.z, camera.rotation.y);

  // HUD
  const tl = Math.max(0, game.tl - (nowMs - game.tlAt) / 1000);
  hud.setRound(game.phase, tl, game.sc, game.rd);
  const count = (team, alive) => snapPlayers.filter((p) => p.tm === team && (!alive || p.a)).length;
  hud.setAlive(count('opp', true), count('opp'), count('gov', true), count('gov'));
  hud.scoreboard(showScores && me.joined, snapPlayers, me.id);
  const mates = [...remotes.values()].filter((r) => r.alive && r.team === me.team).map((r) => ({ x: r.model.root.position.x, z: r.model.root.position.z, team: r.team }));
  const m = game.m;
  const showMotion = m && (m.p || !m.c || me.team === 'opp') ? { x: m.x, z: m.z, planted: m.p } : null;
  const self = me.alive ? { x: me.body.x, z: me.body.z, yaw: me.yaw } : { x: camera.position.x, z: camera.position.z, yaw: camera.rotation.y };
  drawRadar(self, mates, showMotion);

  // Render
  vmCamera.fov = 65;
  vmCamera.updateProjectionMatrix();
  renderer.clear();
  outline.enabled = settings.outlines;
  outline.render(scene, camera);
  renderer.clearDepth();
  outline.render(vmScene, vmCamera);
}

// Test hook: open the game with ?debug to expose internals in the console
if (new URLSearchParams(location.search).has('debug')) {
  window.__wcs = { me, spec, game, remotes, camera, keys, send, onMessage, gore, setLocked: (v) => { locked = v; }, fire: () => { firing = true; firedThisPress = false; } };
}

hud.setHealth(100);
resetAmmo();
hud.setAmmo('rifle', 30, 90, false);
connect();
frame();
