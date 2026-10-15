# Wellington Counter-Strike: Beehive Siege 🐝

A multiplayer, browser-based, Counter-Strike-style shooter set in and around Parliament
in Wellington, New Zealand. It has cartoon graphics, plenty of cartoon gore, and bots.

The map follows the real layout of the precinct:
- **The Beehive** at the southern end, by the Cenotaph and Bowen St.
- **Parliament House** north-west of it, facing east over the front lawn, with the
  **Parliamentary Library** to its north.
- **Molesworth St** along the eastern edge of the grounds.
- **Lambton Quay** running past the Cenotaph corner.
- **The Old Government Buildings** across Lambton Quay. This is the huge wooden building
  that now houses Victoria University's law school, and it's where the Opposition spawns.
- **Bowen House** across Bowen St.

There's nothing to install for players. Everyone opens a web page, and one person runs a
small Node.js server.

## The game

Two teams play rounds, Counter-Strike defuse style:

| | **The Opposition** (attack) | **The Government** (defend) |
|---|---|---|
| Spawn | Forecourt of the Old Government Buildings (Law School) | The link between Parliament House and the Library |
| Goal | Table the **Motion of No Confidence** at site **A** or **B**, or eliminate the Government | **Veto** the Motion, eliminate the Opposition, or run out the clock |

- **Site A: the Debating Chamber**, inside Parliament House (green benches, the Speaker's chair, the Mace)
- **Site B: the Beehive lobby**, the ground floor of the Executive Wing

One Opposition player carries the Motion each round. If they die, it drops, and any
teammate can pick it up by walking over it. Tabling it takes 3 s. After that, the
Government has 40 s to veto it, which takes 5 s. The first team to win 7 rounds takes
the match, and a new match then starts automatically. Until both teams have at least one
player, the game stays in warmup with instant respawns.

### Bots
Bots top up each team to the size you choose in the menu: 0 to 8 per team, on Easy,
Normal or Hard. Anyone on the server can change these settings.
- Bots walk the map using a navigation grid that's generated from the map itself.
- They take cover, react to gunfire and come looking for whoever shot them.
- They carry and table the Motion, pick it up when it's dropped, and veto it.

If you're playing alone, just join a team and the bots fill in the rest. Bots only play
while at least one human is connected.

### Gore
Shots spray cartoon blood across the floors and walls. As players lose health, their
hats and sunglasses fly off, then an arm comes off, leaving a dripping stump. Your own
arm can come off too. A kill bursts the body into flying parts, and a headshot sends the
head flying. Blood pools spread where bodies land.

You can turn the gore off under **Settings** in the menu.

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

If the game runs slowly, press `Esc`, open **Settings**, and turn off **Cartoon outlines**, then **Shadows**.

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
server.js              Game server: rounds, objective, damage, bots, static files
public/index.html      Page shell, menu and HUD markup
public/style.css       HUD and menu styles
public/shared/config.js  Shared tuning: teams, weapons, sites, spawns, round timers
public/js/main.js      Client: networking, movement, shooting, spectating, render loop
public/js/map.js       The Parliament precinct, built from code. The server builds it too, for the bots
public/js/physics.js   Player collision against rotated boxes, steps, gravity
public/js/models.js    Cartoon player characters, built from detachable parts
public/js/gore.js      Blood, splats, gibs and pools
server/bots.js         Bot AI: seeing, hearing, aiming, objectives
server/nav.js          Navigation grid and A* pathfinding, generated from the map
public/js/hud.js       HUD, scoreboard, kill feed and radar
public/js/textures.js  Procedural canvas textures (no image files)
public/js/audio.js     Synthesised WebAudio sound effects (no sound files)
```

Everything, including textures and sounds, is generated in code, so there are no asset
files. Three.js is served from `node_modules`, so the game also works on a LAN with no
internet connection.

### Tweaking

Most of the balance lives in `public/shared/config.js`: weapon damage and fire rate, round
length, rounds to win, spawn points, site positions and bot difficulty. Restart the server after you
change it.

### Notes on the netcode

Movement is client-side and is sent to the server about 30 times a second. Other players
are interpolated about 100 ms behind. Hits are detected by the shooter's client and then
sanity-checked by the server (fire rate, range, team, whether the target is alive). This
works well for playing with friends, but it isn't hardened against cheaters, so don't run
a public tournament on it.

The map is a fun, game-friendly approximation of the real precinct, not a survey-accurate
model.
