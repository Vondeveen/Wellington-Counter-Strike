// All sound effects are synthesised with WebAudio.
let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) {
  if (master) master.gain.value = v;
}

export function setListener(x, y, z, yaw) {
  if (!ctx) return;
  const l = ctx.listener;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (l.positionX) {
    l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
    l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  } else {
    l.setPosition(x, y, z);
    l.setOrientation(fx, 0, fz, 0, 1, 0);
  }
}

function out(pos) {
  if (!pos) return master;
  const p = ctx.createPanner();
  p.panningModel = 'equalpower';
  p.distanceModel = 'inverse';
  p.refDistance = 4;
  p.rolloffFactor = 1.1;
  p.maxDistance = 300;
  if (p.positionX) {
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
  } else p.setPosition(pos.x, pos.y, pos.z);
  p.connect(master);
  return p;
}

function noiseBurst(dest, { dur, freq, q = 1, gain = 1, type = 'lowpass', attack = 0.002 }) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.25), t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
}

function tone(dest, { freq, end, dur, type = 'sine', gain = 0.3, delay = 0 }) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (end) o.frequency.exponentialRampToValueAtTime(end, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const GUN = {
  rifle: { dur: 0.16, freq: 3800, gain: 0.9, thump: 110 },
  sniper: { dur: 0.45, freq: 2600, gain: 1.2, thump: 70 },
  pistol: { dur: 0.12, freq: 5000, gain: 0.7, thump: 160 },
  knife: { dur: 0.12, freq: 1800, gain: 0.25, type: 'bandpass' },
};

export function playShot(weapon, pos) {
  if (!ctx) return;
  const g = GUN[weapon] || GUN.rifle;
  const dest = out(pos);
  noiseBurst(dest, { dur: g.dur, freq: g.freq, gain: g.gain, type: g.type || 'lowpass' });
  if (g.thump) tone(dest, { freq: g.thump, end: 40, dur: g.dur * 1.2, type: 'sine', gain: g.gain * 0.6 });
}

export function playHitmarker(head) {
  if (!ctx) return;
  tone(master, { freq: head ? 1800 : 1200, dur: 0.06, type: 'square', gain: 0.12 });
}

export function playHurt() {
  if (!ctx) return;
  noiseBurst(master, { dur: 0.15, freq: 600, gain: 0.5 });
}

export function playReload() {
  if (!ctx) return;
  noiseBurst(master, { dur: 0.05, freq: 2500, gain: 0.25, type: 'bandpass', q: 4 });
  setTimeout(() => ctx && noiseBurst(master, { dur: 0.06, freq: 1800, gain: 0.3, type: 'bandpass', q: 4 }), 350);
}

export function playStep(pos) {
  if (!ctx) return;
  noiseBurst(out(pos), { dur: 0.07, freq: 700, gain: 0.12 });
}

export function playBeep(pos) {
  if (!ctx) return;
  tone(out(pos), { freq: 1650, dur: 0.12, type: 'square', gain: 0.25 });
}

export function playClick() {
  if (!ctx) return;
  tone(master, { freq: 900, dur: 0.03, type: 'square', gain: 0.08 });
}

export function playJingle(win) {
  if (!ctx) return;
  const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
  notes.forEach((f, i) => tone(master, { freq: f, dur: 0.25, type: 'triangle', gain: 0.25, delay: i * 0.14 }));
}
