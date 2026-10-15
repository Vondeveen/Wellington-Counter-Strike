// Shared between the browser client and the Node server.
// World axes: +x = east (towards Lambton Quay), -z = north (towards Bowen St), +y = up. Units are metres.

export const TICK_RATE = 20;

export const TEAMS = {
  opp: { name: 'The Opposition', short: 'OPP', color: '#ff8a2a', role: 'attack' },
  gov: { name: 'The Government', short: 'GOV', color: '#2ad4d4', role: 'defend' },
};

export const ROUND = {
  freezeTime: 5,
  roundTime: 115,
  motionTime: 40, // seconds after the Motion of No Confidence is tabled
  plantTime: 3,
  defuseTime: 5,
  endTime: 6,
  roundsToWin: 7,
  warmupRespawn: 3,
  maxHp: 100,
};

export const PLAYER = {
  radius: 0.4,
  height: 1.8,
  crouchHeight: 1.2,
  eye: 1.62,
  crouchEye: 1.1,
  runSpeed: 6.2,
  walkSpeed: 3.0,
  crouchSpeed: 2.4,
  jumpVel: 7.2,
  gravity: 21,
  stepHeight: 0.55,
};

export const WEAPONS = {
  rifle: {
    slot: 1, name: 'Taranaki AR', auto: true, rpm: 600, damage: 30, headMult: 4,
    mag: 30, reserve: 90, reload: 2.4, range: 200,
    spread: 0.006, moveSpread: 0.05, airSpread: 0.12, recoil: 0.018, maxRecoil: 0.12,
  },
  sniper: {
    slot: 2, name: 'Remutaka Longshot', auto: false, rpm: 45, damage: 115, headMult: 2,
    mag: 5, reserve: 20, reload: 3.4, range: 400, scope: true,
    spread: 0.08, scopedSpread: 0.0004, moveSpread: 0.12, airSpread: 0.2, recoil: 0.07, maxRecoil: 0.1,
  },
  pistol: {
    slot: 3, name: 'Pōneke Pistol', auto: false, rpm: 400, damage: 24, headMult: 4,
    mag: 12, reserve: 48, reload: 1.8, range: 120,
    spread: 0.01, moveSpread: 0.03, airSpread: 0.08, recoil: 0.03, maxRecoil: 0.1,
  },
  knife: {
    slot: 4, name: 'Pounamu Knife', auto: true, rpm: 120, damage: 55, headMult: 1,
    mag: Infinity, reserve: Infinity, reload: 0, range: 2.4, melee: true,
    spread: 0, moveSpread: 0, airSpread: 0, recoil: 0, maxRecoil: 0,
  },
};
export const WEAPON_ORDER = ['rifle', 'sniper', 'pistol', 'knife'];

// Bomb sites. The attackers "table" a Motion of No Confidence; defenders "veto" it.
export const SITES = {
  A: { name: 'A — Debating Chamber', x: -46, z: -26, radius: 7.5 },
  B: { name: 'B — Beehive Lobby', x: 0, z: 0, radius: 13 },
};

// Lambton Quay runs north-east from the Cenotaph corner; the Old Government Buildings
// (now Victoria University's law school) sit on its far side.
export const LQ = { x0: 28, z0: 57, x1: 80, z1: 18 };
export const OGB = { x: 75.6, z: 66.3, rot: 0.6435, length: 80, depth: 30 };

const ux = 0.8, uz = -0.6; // along Lambton Quay
const nx = 0.6, nz = 0.8; // away from Parliament
export const SPAWNS = {
  // Attackers gather on the forecourt of the Old Government Buildings
  opp: [-24, -16, -8, 0, 8, 16].flatMap((t) => [21, 25].map((d) => ({
    x: +(OGB.x - nx * d + ux * t).toFixed(2),
    y: 0,
    z: +(OGB.z - nz * d + uz * t).toFixed(2),
    yaw: OGB.rot,
  }))),
  // Defenders start in the link between Parliament House and the Library
  gov: [-57, -52, -47, -42, -37, -32].flatMap((x) => [-50, -47].map((z) => ({ x, y: 0, z, yaw: Math.PI }))),
};

export const BOUNDS = { minX: -90, maxX: 115, minZ: -112, maxZ: 88 };

export const BOTS = {
  defaultFill: 3, // bots top each team up to this many players
  maxFill: 8,
  defaultDifficulty: 'normal',
  difficulty: {
    easy: { react: 0.85, turn: 3.5, error: 0.08, burst: 3, headChance: 0.08, sight: 60 },
    normal: { react: 0.55, turn: 6, error: 0.05, burst: 4, headChance: 0.18, sight: 85 },
    hard: { react: 0.25, turn: 12, error: 0.022, burst: 5, headChance: 0.45, sight: 110 },
  },
  names: ['Kererū', 'Tūī', 'Weka', 'Pūkeko', 'Kea', 'Takahē', 'Ruru', 'Kākāpō', 'Hoiho', 'Tuatara', 'Pīwakawaka', 'Kōtuku', 'Kiwi', 'Kākā', 'Toroa', 'Pāteke'],
};
