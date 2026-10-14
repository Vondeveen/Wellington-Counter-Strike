# Wellington Counter-Strike: Beehive Siege 🐝

A multiplayer, browser-based, Counter-Strike-style shooter set in and around Parliament
in Wellington, New Zealand. It covers the Beehive (Executive Wing), Parliament House, the
Parliamentary Library, the Cenotaph, Lambton Quay, Bowen St and Molesworth St.

There's nothing to install for players. Everyone opens a web page, and one person runs a
small Node.js server.

## The game

Two teams play rounds, Counter-Strike defuse style:

| | **The Opposition** (attack) | **The Government** (defend) |
|---|---|---|
| Spawn | Lambton Quay, by the main gates | North forecourt, behind Parliament House |
| Goal | Table the **Motion of No Confidence** at site **A** or **B**, or eliminate the Government | **Veto** the Motion, eliminate the Opposition, or run out the clock |

- **Site A: the Debating Chamber**, inside Parliament House (green benches, the Speaker's chair, the Mace)
- **Site B: the Beehive lobby**, the ground floor of the Executive Wing

One Opposition player carries the Motion each round. If they die, it drops, and any
teammate can pick it up by walking over it. Tabling it takes 3 s. After that, the
Government has 40 s to veto it, which takes 5 s. The first team to win 7 rounds takes
the match, and a new match then starts automatically. Until both teams have at least one
player, the game stays in warmup with instant respawns.

### Weapons
| Key | Weapon | Notes |
|---|---|---|
| 1 | Taranaki AR | Automatic rifle. A headshot kills in one hit |
| 2 | Remutaka Longshot | Bolt-action sniper. Right-click to scope. One-shot body kill |
| 3 | Pōneke Pistol | Semi-auto sidearm |
| 4 | Pounamu Knife | Melee. You move faster with it out |

Accuracy drops while you're moving or jumping, and it improves when you crouch. Running
footsteps can be heard, but walking (Shift) is silent.

### Controls
`WASD` move · `Mouse` look/fire · `Right-click` scope · `Space` jump · `Shift` walk ·
`Ctrl`/`C` crouch · `R` reload · `1-4`/wheel/`Q` weapons · hold `E` to table or veto ·
`Tab` scoreboard · `T`/`Enter` chat · `Esc` menu (resume or switch team)

When you're dead, click to spectate teammates or right-click for a free camera.

## Running it

You need **Node.js 18+**.

```bash
npm install
npm start
```

The server prints addresses like this:

```
  Local:   http://localhost:3000
  Network: http://192.168.1.23:3000   <- share this with friends on your network
```

Open the address in a desktop browser (Chrome, Edge or Firefox), enter a callsign and pick
a team. You need a mouse and keyboard.

To use a different port, run `PORT=8080 npm start`.

### Playing with friends

**On the same Wi-Fi/LAN:** give them the `Network:` address. If they can't connect, allow
Node through your firewall.

**Over the internet:** pick one of these.

1. **Quick tunnel (easiest).** Run a tunnel such as
   [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
   next to the server:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   Then share the `https://….trycloudflare.com` link it prints. WebSockets work through it
   automatically.
2. **Port forwarding.** Forward TCP port 3000 on your router to your computer and share
   `http://<your-public-ip>:3000`.
3. **Deploy it** to a host that supports WebSockets, such as Render, Railway or Fly.io. The
   start command is `npm start`, and the server reads the `PORT` environment variable. A
   `Dockerfile` is included.

## Project layout

```
server.js              Authoritative game server: rounds, objective, damage, static files
public/index.html      Page shell, menu and HUD markup
public/style.css       HUD and menu styles
public/shared/config.js  Shared tuning: teams, weapons, sites, spawns, round timers
public/js/main.js      Client: networking, movement, shooting, spectating, render loop
public/js/map.js       The Parliament precinct, built from code (geometry and colliders)
public/js/physics.js   Player collision against rotated boxes, steps, gravity
public/js/models.js    Player character models
public/js/hud.js       HUD, scoreboard, kill feed and radar
public/js/textures.js  Procedural canvas textures (no image files)
public/js/audio.js     Synthesised WebAudio sound effects (no sound files)
```

Everything, including textures and sounds, is generated in code, so there are no asset
files. Three.js is served from `node_modules`, so the game also works on a LAN with no
internet connection.

### Tweaking

Most of the balance lives in `public/shared/config.js`: weapon damage and fire rate, round
length, rounds to win, spawn points and site positions. Restart the server after you
change it.

### Notes on the netcode

Movement is client-side and is sent to the server about 30 times a second. Other players
are interpolated about 100 ms behind. Hits are detected by the shooter's client and then
sanity-checked by the server (fire rate, range, team, whether the target is alive). This
works well for playing with friends, but it isn't hardened against cheaters, so don't run
a public tournament on it.

The map is a fun, game-friendly approximation of the real precinct, not a survey-accurate
model.
