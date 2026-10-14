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
  A: { name: 'A — Debating Chamber', x: -21, z: 2, radius: 6.5 },
  B: { name: 'B — Beehive Lobby', x: 28, z: -24, radius: 13 },
};

export const SPAWNS = {
  // Attackers gather on Lambton Quay, south of the main gates
  opp: [
    [58, 32], [61, 32], [64, 32], [58, 36], [61, 36], [64, 36],
    [58, 40], [61, 40], [64, 40], [58, 44], [61, 44], [64, 44],
  ].map(([x, z]) => ({ x, y: 0, z, yaw: Math.PI / 2 })),
  // Defenders start behind Parliament House, between it and Bowen St
  gov: [
    [-28, -32], [-24, -32], [-20, -32], [-16, -32], [-12, -32], [-8, -32],
    [-28, -36], [-24, -36], [-20, -36], [-16, -36], [-12, -36], [-8, -36],
  ].map(([x, z]) => ({ x, y: 0, z, yaw: Math.PI })),
};

export const BOUNDS = { minX: -66, maxX: 68, minZ: -56, maxZ: 58 };
