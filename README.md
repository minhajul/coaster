# ChunkCoaster 🏎️🎢

A fast-paced, voxel-style 3D roller-coaster kart racer built for the browser with **React Three Fiber**, **Rapier Physics**, and **Three.js**.

Drive a high-speed voxel kart through a scenic roller-coaster track of rolling hills, sweeping banked turns, boost strips, bouncy mushrooms, and collectible stars — complete with real-time procedural WebAudio sound and particle effects!

---

## 🎮 Features

- **🏎️ Smooth 3D Roller-Coaster Physics**
  - Continuous Rapier `TrimeshCollider` road ribbon and 3D volumetric guardrail barriers — zero edge-catching, no floor cracks.
  - 3D slope-climbing vector projection so the kart climbs and descends steep inclines naturally.
  - Bobsled-style guardrail banking and subtle curve-following assist for fluid, high-speed arcade racing.
  - Lakitu-style recovery: if you ever leave the track, you safely respawn on the nearest track segment with your lap timer running.

- **🔊 100% Procedural WebAudio Synthesizer**
  - Zero external sound files — all audio is generated in real time using the browser WebAudio API!
  - **Dynamic Engine Hum:** Dual-oscillator engine that revs pitch and volume with speed and throttle.
  - **Nitro Whoosh:** Filtered pink-noise rush with exponential frequency decay.
  - **Star Chimes:** Ascending 5-note pentatonic scale with each collected star.
  - **Mushroom Boing:** Dual sine-wave frequency sweep for bouncy trampoline hops.
  - **Drift Screech:** Bandpass-filtered tire screech on sharp cornering.
  - **Fanfares:** 4-note victory fanfare and defeat buzzer.

- **✨ Dynamic Particle Systems**
  - High-performance instanced particles for:
    - Dual exhaust smoke puffs trailing from the exhaust pipes.
    - Nitro flame bursts (cyan & yellow) when crossing boost strips.
    - 3D speed streaks rushing past the camera at speeds above 45 km/h.

- **🎥 3 Dynamic Camera Modes**
  - **Chase Cam (Default):** Smooth third-person chase camera with steering lookahead and speed FOV rush.
  - **Hood Cockpit Cam:** First-person bumper/cockpit view at 75°+ FOV.
  - **Far Aerial Cam:** High-angle spectator follow view.
  - Toggle anytime using the **C** key or the HUD button.

- **🗺️ Real-Time Radar Mini-Map**
  - 2D canvas radar displays the entire track loop.
  - Live player marker with directional heading yaw.
  - Dynamic star markers that disappear as they are collected.

- **📊 Arcade HUD & Performance Tracking**
  - Digital KM/H speedometer with radial acceleration arc and glowing Nitro badge.
  - Race timer with urgency pulse animations.
  - Star collection counter (`★ 0/14`).
  - Personal Best time saved automatically to `localStorage`.
  - Pause menu (**P** / **Esc**), audio mute toggle (**M**), and Victory / Defeat modals with 1–3 star ratings.

- **🌲 Scenic Procedural Environment**
  - Drifting fluffy voxel clouds across the skybox.
  - Rotating windmills with animated spinning sails.
  - Floating hot air balloons in the valley.
  - Pine forest and flower fields with camera-safe clearances.

- **📱 Full Mobile & Desktop Support**
  - Responsive layout with touch controls (Drive, Brake, Steer Left/Right, Camera, Mute, Pause).
  - Full keyboard shortcuts for desktop players.

---

## 🕹️ Controls

### Desktop Keyboard
| Key | Action |
| :--- | :--- |
| **`W`** or **`↑`** | Accelerate / Drive Forward |
| **`S`** or **`↓`** or **`Space`** | Brake / Reverse |
| **`A`** or **`←`** | Steer Left |
| **`D`** or **`→`** | Steer Right |
| **`C`** | Cycle Camera Mode (*Chase → Hood → Far*) |
| **`M`** | Toggle Audio Mute |
| **`P`** or **`Esc`** | Pause / Resume Race |
| **`R`** | Restart Race |
| **`Enter`** or **`Space`** | Start Race from Title / Restart on Finish |

### Mobile / Touch
- **DRIVE (Green Button):** Accelerate forward.
- **BRAKE (Red Button):** Brake and reverse.
- **◄ / ► (Blue Buttons):** Steer left and right.
- **Top Bar Buttons:** Toggle camera mode, mute audio, and pause.

---

## 🛠️ Tech Stack

- **Framework:** [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **3D Graphics:** [Three.js](https://threejs.org/) + [@react-three/fiber](https://r3f.docs.pmnd.rs/) + [@react-three/drei](https://github.com/pmndrs/drei)
- **Physics Engine:** [@react-three/rapier](https://github.com/pmndrs/react-three-rapier) (Rapier WASM physics)
- **State Management:** [Zustand](https://zustand.docs.pmnd.rs/)
- **Styling:** [Tailwind CSS](https://tailwindcss.com/)
- **Audio:** WebAudio API (Procedural Synthesizer)
- **Build Tool:** [Vite](https://vitejs.dev/)

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (version 18.0 or higher recommended)
- `npm` or `pnpm` or `yarn`

### Installation

1. Clone the repository or navigate to the project folder:
   ```bash
   cd coaster
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open your browser and visit:
   ```
   http://localhost:5173/
   ```

### Production Build

To build the production-ready bundle:
```bash
npm run build
```

To preview the production build locally:
```bash
npm run preview
```

---

## 📁 Project Structure

```text
coaster/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── main.tsx                # React application entry point
    ├── index.css               # Tailwind directives and base styles
    └── game/
        ├── App.tsx             # Main canvas, lights, physics world, and HUD composition
        ├── Track.tsx           # Track mesh ribbon, 3D trimesh rail colliders, boost pads, stars
        ├── Vehicle.tsx         # Kart physics body, slope logic, wheels, driver, and camera controls
        ├── audio.ts            # Procedural WebAudio sound synthesizer
        ├── Particles.tsx       # Exhaust smoke, nitro flame bursts, and 3D speed streaks
        ├── MiniMap.tsx         # Real-time 2D radar mini-map
        ├── HUD.tsx             # Speedometer, timer, personal best, touch buttons, modals
        ├── Environment.tsx     # Clouds, windmills, hot air balloons
        ├── trackCurve.ts       # 3D CatmullRom spline curve, checkpoints, and curve sampling
        ├── useGameStore.ts     # Zustand store for race timer, status, scores, and camera
        └── mulberry32.ts       # Fast deterministic pseudo-random number generator
```

---

## 📜 License

This project is open-source and available under the [MIT License](LICENSE).
