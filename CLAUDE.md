# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ChunkCoaster: a single-page, voxel-style 3D kart racer in the browser. React 18 + TypeScript, React Three Fiber (Three.js), Zustand for state, Tailwind for the HUD, Vite for builds. No physics engine and no external assets: geometry, textures, and audio are all procedural.

## Commands

```bash
npm run dev        # Vite dev server on http://localhost:5173
npm run build      # tsc -b (typecheck, noEmit) && vite build
npm run preview    # preview the production build in the Workers runtime
npx tsc -b         # typecheck only
npm run deploy     # cf deploy: builds via Vite, uploads to Cloudflare Workers
cf deploy --dry-run  # build + validate without uploading
```

Toolchain: Vite 8 (Rolldown), TypeScript 7, `@vitejs/plugin-react` 6, `@cloudflare/vite-plugin` (beta). Deployment uses Cloudflare's `cf` CLI (open beta, installed globally, login via `cf auth login`), not Wrangler. The Worker is assets-only and defined in `cloudflare.config.ts`; the Vite plugin in `vite.config.ts` writes the build output `cf` expects to `.cloudflare/output/` (gitignored). A "failed to connect to the docker API" line during `cf deploy` is a harmless containers probe.

There is no test suite. `.oxlintrc.json` is checked in (rules-of-hooks = error, only-export-components = warn) but oxlint is not a devDependency; `npx oxlint` will prompt to download it.

In dev builds `src/main.tsx` exposes the Zustand store as `window.__game`, so the game can be driven and inspected from the console or from browser automation (`__game.getState()`, `__game.setState({...})`).

## Architecture

Entry is `src/main.tsx` → `src/game/App.tsx`. Everything lives in `src/game/`. The `src/game/components/` directory is empty and untracked; ignore it.

### Two layers, two communication channels

`App.tsx` composes a R3F `<Canvas>` (3D scene) and a DOM `<HUD>` rendered outside the canvas. They talk through two deliberately separate channels:

- **Zustand store (`useGameStore.ts`)** for low-frequency state: race status, timer, star count, camera mode, mute, best time (persisted to `localStorage`). Speed and progress are written to it but throttled/rounded. Keep this store small; React re-renders are limited to the HUD.
- **Mutable refs created in `App.tsx`** for per-frame data: `inputRef` (forward/left/right/reverse), `kartPosRef`, `kartQuatRef`, `kartYawRef`, `collectedStarsRef`. `Vehicle` writes them every frame; `Particles`, `MiniMap`, and `HUD` read them. Never route per-frame values through the store.

### Race state machine

`status`: `idle → countdown → racing → won | lost`, plus an orthogonal `paused` flag. `TimerDriver` (in `App.tsx`) ticks `tickCountdown`/`tickTimer` from `useFrame`. The store also has a `run` counter that `startRace`/`restartRace`/`resetRace` bump; `Vehicle` re-spawns the kart whenever it changes, which is what makes R mid-race work even though `status` stays `racing`. Lap detection lives in `Vehicle.tsx`: when progress wraps from >0.85 to <0.12 it calls the store's `completeLap`, which advances `lap` or, on lap `TOTAL_LAPS` (3), wins. One lap of the 393 m loop takes 12 to 16 s at race speed, which is why a race is several laps. After `won`/`lost` the kart coasts to a stop rather than freezing.

### Track geometry has one source of truth

`trackCurve.ts` builds a closed centripetal CatmullRom loop at module load and exports `TRACK_CURVE`, `CURVE_SAMPLES`, width/thickness constants, `progressAlongTrack()`, `SPAWN_T`, and `getSpawnPose()`. Both `Track.tsx` (road mesh, rails, item placement, start/finish line at t=0) and `Vehicle.tsx` (road height, tangent, lateral clamp) derive from it. Change track shape or dimensions only there. The kart spawns at `SPAWN_T` (just past the line) so the finish banner is behind the player at the start.

Item positions (`STAR_POSITIONS`, `BOOST_POSITIONS`, `MUSHROOM_POSITIONS`) are module-level constants in `Track.tsx`. Stars and mushrooms are placed with seeded `mulberry32` RNG so layouts are deterministic; boost strips are spaced evenly (every 100 samples) and re-arm after `BOOST_COOLDOWN_MS`, so they fire on every lap. Boost adds speed for `BOOST_DURATION` and then bleeds off over `BOOST_FADE_TIME` rather than braking back to top speed. `Vehicle.tsx` imports them and does pickup detection by distance checks each frame. Mushrooms sit just outside the rails, so they only trigger when the kart is scraping the edge.

### The kart is kinematic, on purpose

`Vehicle.tsx` keeps its own simulation state in a ref (`pos`, `yaw`, signed `speed`, `vy`, `airborne`, `boostTimer`) and writes the result to a plain `<group>` every frame:

1. Speed approaches a target (top speed, brake, reverse, or coast) with an exponential time constant.
2. Yaw integrates player steering; with no steering input it blends toward the road tangent plus a pull toward the centre line (`ASSIST_ALIGN`, `ASSIST_CENTER`).
3. Position advances along the facing, then the lateral offset from the curve is hard-clamped to `MAX_LATERAL`. Heading into the clamp scrapes off speed and kicks the nose back toward the road.
4. Height snaps to road surface + `REST_HEIGHT` unless airborne; hops (boost strips, mushrooms) add the road's upward rise so they feel the same on climbs.

The project used `@react-three/rapier` for the kart until the kinematic rewrite; the git history shows many commits fighting it (flipping, sinking, getting pinned to rails, losing speed to contact resolution, an inverted sign in the rail-bounce yaw nudge). Do not reintroduce a physics engine for the kart. The road and rail meshes in `Track.tsx` are purely visual.

The camera update runs in every game state, so the title and countdown already frame the kart, and it snaps into place on the first frame instead of flying in.

### Input

Driving keys (WASD/arrows/Space) mutate `inputRef` via `useKeyboardControls` in `Vehicle.tsx`. Meta keys (P/Esc pause, R restart, M mute, C camera, Enter/Space start) are handled in `HUD.tsx`. Touch buttons in `HUD.tsx` mutate the same `inputRef` using pointer capture.

### Audio

`audio.ts` exports a singleton `audio` (`SoundSystem`) that synthesizes everything with WebAudio. Call `audio.ensure()` from a user gesture before any sound; the HUD does this on start/touch. `updateEngine` is called every frame from `Vehicle`.

### Styling

Tailwind with a custom `font-chunky` (Fredoka, loaded in `src/index.css`) and `cart.{red,yellow,blue,green,purple}` colors from `tailwind.config.js`. The page is fixed full-viewport with scrolling and touch gestures disabled. The HUD top bar uses `sm:` breakpoints to fit a 390px phone. Input-specific UI switches on pointer type, not width: custom `touch:` (`pointer: coarse`) and `mouse:` variants in `tailwind.config.js` show the touch buttons on phones in any orientation and the speedometer, keyboard hints, and key labels only with a mouse. Modals are scrollable (`data-scrollable` opts them out of the global touch-move blocker) so the start card is reachable in phone landscape. Tailwind config changes need a dev-server restart.
