import * as THREE from 'three';

// Procedural canvas textures so the game has no external asset dependencies.

const HAS_DOM = typeof document !== 'undefined';

function canvas(w, h, draw) {
  if (!HAS_DOM) return null; // the server builds the map for collisions only
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noise(g, w, h, amount, alpha = 0.08) {
  for (let i = 0; i < amount; i++) {
    const v = Math.random() > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}

const cache = {};
const memo = (key, fn) => cache[key] || (cache[key] = fn());

export const tex = {
  grass: () => memo('grass', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#62b842';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 2500; i++) {
      const s = Math.random();
      g.fillStyle = `rgba(${80 + s * 60},${170 + s * 50},${50 + s * 30},0.45)`;
      g.fillRect(Math.random() * w, Math.random() * h, 1.5, 3);
    }
    // Faint mowing stripes
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, 0, w / 2, h);
  })),

  asphalt: () => memo('asphalt', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#3a3c40';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 6000, 0.15);
  })),

  paving: () => memo('paving', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#a9a49a';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 3000, 0.1);
    g.strokeStyle = 'rgba(60,55,50,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke();
      g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke();
    }
  })),

  // Parliament House: grey Takaka marble with rows of tall windows
  parliament: () => memo('parliament', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#c9c8c2';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 4000, 0.06);
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 1);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = 40 + col * 128;
        const y = 30 + row * 128;
        g.fillStyle = '#b4b2ab';
        g.fillRect(x - 6, y - 6, 60, 92);
        g.fillStyle = '#2d3640';
        g.fillRect(x, y, 48, 80);
        g.fillStyle = '#b4b2ab';
        g.fillRect(x + 22, y, 4, 80);
        g.fillRect(x, y + 38, 48, 4);
        g.fillStyle = 'rgba(160,200,230,0.25)';
        g.fillRect(x + 2, y + 2, 18, 34);
      }
    }
  })),

  // The Beehive: white concrete fins over dark bronze glazing
  beehive: () => memo('beehive', () => canvas(256, 128, (g, w, h) => {
    g.fillStyle = '#2b2a28';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(140,170,190,0.25)';
    g.fillRect(0, 10, w, h * 0.6);
    for (let x = 0; x < w; x += 16) {
      g.fillStyle = '#e8e4da';
      g.fillRect(x, 0, 5, h);
      g.fillStyle = '#c9c4b8';
      g.fillRect(x + 5, 0, 2, h);
    }
    g.fillStyle = '#efebe2';
    g.fillRect(0, h - 22, w, 22);
    g.fillStyle = '#cfcabe';
    g.fillRect(0, h - 4, w, 4);
  })),

  beehiveLobby: () => memo('beehiveLobby', () => canvas(256, 128, (g, w, h) => {
    g.fillStyle = '#4a5560';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(190,220,240,0.35)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d8d4ca';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 4, h);
    g.fillRect(0, h - 10, w, 10);
    g.fillRect(0, 0, w, 6);
  })),

  // Parliamentary Library: Victorian Gothic, cream with pointed arched windows
  library: () => memo('library', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#d9c9a8';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 4000, 0.07);
    g.fillStyle = '#b89f78';
    g.fillRect(0, 120, w, 8);
    g.fillRect(0, 248, w, 8);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const x = 22 + col * 82;
        const y = 24 + row * 128;
        g.fillStyle = '#2c3138';
        g.beginPath();
        g.moveTo(x, y + 90);
        g.lineTo(x, y + 26);
        g.quadraticCurveTo(x, y, x + 20, y - 4);
        g.quadraticCurveTo(x + 40, y, x + 40, y + 26);
        g.lineTo(x + 40, y + 90);
        g.closePath();
        g.fill();
        g.strokeStyle = '#a88d64';
        g.lineWidth = 4;
        g.stroke();
        g.fillStyle = '#a88d64';
        g.fillRect(x + 18, y, 4, 90);
      }
    }
  })),

  office: (tint = '#5d7484') => memo('office' + tint, () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) {
      for (let x = 0; x < w; x += 32) {
        const lit = Math.random() < 0.2;
        g.fillStyle = lit ? 'rgba(255,240,190,0.55)' : `rgba(20,30,40,${0.3 + Math.random() * 0.3})`;
        g.fillRect(x + 3, y + 4, 26, 22);
      }
    }
    g.fillStyle = 'rgba(255,255,255,0.15)';
    for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 3);
  })),

  carpet: () => memo('carpet', () => canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#2f5b3a';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 2000, 0.12);
  })),

  marbleFloor: () => memo('marbleFloor', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#d8d5cc';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 2000, 0.05);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        if ((x + y) % 2) {
          g.fillStyle = '#a7a39a';
          g.fillRect(x * 64, y * 64, 64, 64);
        }
      }
    }
  })),

  wood: () => memo('wood', () => canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#6b4226';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(30,15,5,${Math.random() * 0.25})`;
      g.fillRect(0, Math.random() * h, w, 1 + Math.random() * 2);
    }
  })),

  stone: () => memo('stone', () => canvas(128, 128, (g, w, h) => {
    g.fillStyle = '#8e8a82';
    g.fillRect(0, 0, w, h);
    noise(g, w, h, 2500, 0.15);
    g.strokeStyle = 'rgba(40,40,40,0.3)';
    for (let y = 0; y < h; y += 32) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      const off = (y / 32) % 2 ? 32 : 0;
      for (let x = off; x < w; x += 64) {
        g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 32); g.stroke();
      }
    }
  })),

  // Wrought-iron railings: transparent between the bars
  railing: () => memo('railing', () => {
    const t = canvas(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#1d1f22';
      g.fillRect(0, 0, w, 6);
      g.fillRect(0, h - 8, w, 4);
      for (let x = 4; x < w; x += 16) {
        g.fillRect(x, 0, 4, h);
        g.beginPath();
        g.moveTo(x - 3, 8); g.lineTo(x + 2, -2); g.lineTo(x + 7, 8);
        g.fill();
      }
    });
    return t;
  }),

  // Old Government Buildings: timber painted to look like stone, tall sash windows
  ogb: () => memo('ogb', () => canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#e9dcc0';
    g.fillRect(0, 0, w, h);
    // faux-stone rustication lines (it's all wood!)
    g.strokeStyle = 'rgba(120,100,70,0.25)';
    for (let y = 0; y < h; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    g.fillStyle = '#cdbb98';
    g.fillRect(0, 118, w, 10);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = 34 + col * 128;
        const y = 22 + row * 128;
        g.fillStyle = '#b9a47c';
        g.fillRect(x - 8, y - 14, 76, 12); // pediment cap
        g.fillRect(x - 6, y - 4, 64, 92);
        g.fillStyle = '#28323c';
        g.fillRect(x, y, 52, 80);
        g.fillStyle = '#efe6d2';
        g.fillRect(x + 24, y, 4, 80);
        g.fillRect(x, y + 38, 52, 4);
        g.fillStyle = 'rgba(170,210,240,0.35)';
        g.fillRect(x + 3, y + 3, 18, 32);
      }
    }
  })),

  // Toon shading ramp
  toonRamp: () => memo('toonRamp', () => {
    const data = new Uint8Array([90, 90, 90, 255, 175, 175, 175, 255, 255, 255, 255, 255]);
    const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.NearestFilter;
    t.needsUpdate = true;
    return t;
  }),

  // Cartoon blood splat (white so it can be tinted)
  splat: (variant = 0) => memo('splat' + variant, () => {
    const t = canvas(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = '#fff';
      const blob = (x, y, r) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
      blob(64, 64, 30 + Math.random() * 6);
      const n = 7 + variant * 2;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 30 + Math.random() * 26;
        const r = 4 + Math.random() * 9;
        blob(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r);
        // connecting streak
        g.beginPath();
        g.moveTo(64 + Math.cos(a - 0.15) * 20, 64 + Math.sin(a - 0.15) * 20);
        g.lineTo(64 + Math.cos(a) * d, 64 + Math.sin(a) * d);
        g.lineTo(64 + Math.cos(a + 0.15) * 20, 64 + Math.sin(a + 0.15) * 20);
        g.fill();
      }
      for (let i = 0; i < 10; i++) blob(Math.random() * w, Math.random() * h, 1.5 + Math.random() * 3);
    });
    if (t) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }),

  sky: () => memo('sky', () => {
    const t = canvas(16, 256, (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#2f8cf0');
      grad.addColorStop(0.42, '#7cc4ff');
      grad.addColorStop(0.5, '#d9f0ff');
      grad.addColorStop(1, '#a8d0a0');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
    });
    if (t) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  }),

  label: (text, color = '#fff', bg = 'rgba(0,0,0,0.45)') => canvas(256, 64, (g, w, h) => {
    g.font = 'bold 30px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const tw = Math.min(w - 8, g.measureText(text).width + 24);
    g.fillStyle = bg;
    g.fillRect((w - tw) / 2, 8, tw, h - 16);
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 1, w - 20);
  }),

  sign: (lines, bg = '#1d3b5c', fg = '#fff') => canvas(512, 128, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = fg;
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 44px system-ui, sans-serif';
    if (lines.length === 1) g.fillText(lines[0], w / 2, h / 2, w - 30);
    else {
      g.fillText(lines[0], w / 2, h * 0.36, w - 30);
      g.font = '30px system-ui, sans-serif';
      g.fillText(lines[1], w / 2, h * 0.72, w - 30);
    }
  }),

  nzFlag: () => memo('nzFlag', () => canvas(256, 128, (g, w, h) => {
    g.fillStyle = '#012169';
    g.fillRect(0, 0, w, h);
    // Union Jack canton
    const cw = w / 2, ch = h / 2;
    g.save();
    g.beginPath(); g.rect(0, 0, cw, ch); g.clip();
    g.strokeStyle = '#fff'; g.lineWidth = 14;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(cw, ch); g.moveTo(cw, 0); g.lineTo(0, ch); g.stroke();
    g.strokeStyle = '#C8102E'; g.lineWidth = 5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(cw, ch); g.moveTo(cw, 0); g.lineTo(0, ch); g.stroke();
    g.fillStyle = '#fff';
    g.fillRect(cw / 2 - 11, 0, 22, ch); g.fillRect(0, ch / 2 - 11, cw, 22);
    g.fillStyle = '#C8102E';
    g.fillRect(cw / 2 - 6, 0, 12, ch); g.fillRect(0, ch / 2 - 6, cw, 12);
    g.restore();
    // Southern Cross
    const star = (x, y, r) => {
      const draw = (rad, col) => {
        g.fillStyle = col;
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i % 2 ? rad * 0.4 : rad;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.fill();
      };
      draw(r + 2.5, '#fff');
      draw(r, '#C8102E');
    };
    star(190, 30, 8); star(172, 62, 7); star(208, 58, 6); star(190, 104, 8);
  })),
};
