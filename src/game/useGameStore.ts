import { create } from "zustand";

// =====================================================================
// Game-wide state. We deliberately keep this tiny so React subscriptions
// stay snappy and re-renders are limited to the HUD layer.
// =====================================================================

export type GameState = "idle" | "countdown" | "racing" | "won" | "lost";
export type CameraMode = "chase" | "hood" | "far";

export const RACE_DURATION_SECONDS = 120;
/** Laps needed to win. One lap of the 393 m loop takes ~12-16 s. */
export const TOTAL_LAPS = 3;
/** Whole seconds for the 3-2-1-GO countdown shown after START. */
export const COUNTDOWN_TOTAL = 3;

const BEST_TIME_KEY = "chunkcoaster_best_time";

function loadBestTime(): number | null {
  try {
    const val = localStorage.getItem(BEST_TIME_KEY);
    return val ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

interface GameStore {
  status: GameState;
  /** Whether the player has paused the current race. */
  paused: boolean;
  /** Remaining time on the countdown clock (seconds). */
  timeRemaining: number;
  /** Whole seconds remaining in the 3-2-1-GO countdown (3,2,1,0=GO). */
  countdown: number;
  /** Total collectible stars gathered during the current race. */
  stars: number;
  /** Total stars available on the track for this race. */
  totalStars: number;
  /** Progress around the current lap, 0..1 (drives the HUD progress bar). */
  progress: number;
  /** Current lap, 1-based. */
  lap: number;
  /** Current speed in km/h for the speedometer. */
  speedKmh: number;
  /** Whether boost is currently active. */
  isBoosted: boolean;
  /** Audio mute toggle. */
  muted: boolean;
  /** Current camera mode. */
  cameraMode: CameraMode;
  /** Personal best time in seconds. */
  bestTime: number | null;
  /** Last race completion time in seconds. */
  lastTime: number | null;
  /** Bumped every time a race is started/restarted/reset so the kart can
   *  re-spawn even when the status itself doesn't change (R mid-race). */
  run: number;

  // ---------------- actions ----------------
  /** Begin the 3-2-1-GO countdown. Does NOT start the race yet. */
  startRace: () => void;
  resetRace: () => void;
  /** Reset + start immediately, atomically — used by restart shortcuts. */
  restartRace: () => void;
  setPaused: (p: boolean) => void;
  tickTimer: (deltaSeconds: number) => void;
  /** Decrement the start countdown. Flips to racing when it reaches 0. */
  tickCountdown: (deltaSeconds: number) => void;
  collectStar: () => void;
  /** Called when the kart crosses the line. Wins on the final lap. */
  completeLap: () => void;
  setTotalStars: (n: number) => void;
  setProgress: (p: number) => void;
  setSpeedKmh: (s: number) => void;
  setIsBoosted: (b: boolean) => void;
  toggleMute: () => void;
  cycleCameraMode: () => void;
  winRace: () => void;
  loseRace: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  status: "idle",
  paused: false,
  timeRemaining: RACE_DURATION_SECONDS,
  countdown: 0,
  stars: 0,
  totalStars: 0,
  progress: 0,
  lap: 1,
  speedKmh: 0,
  isBoosted: false,
  muted: false,
  cameraMode: "chase",
  bestTime: loadBestTime(),
  lastTime: null,
  run: 0,

  startRace: () =>
    set((s) => ({
      run: s.run + 1,
      status: "countdown",
      paused: false,
      timeRemaining: RACE_DURATION_SECONDS,
      countdown: COUNTDOWN_TOTAL + 0.001,
      stars: 0,
      progress: 0,
      lap: 1,
      speedKmh: 0,
      isBoosted: false,
      lastTime: null,
    })),

  resetRace: () =>
    set((s) => ({
      run: s.run + 1,
      status: "idle",
      paused: false,
      timeRemaining: RACE_DURATION_SECONDS,
      countdown: 0,
      stars: 0,
      progress: 0,
      lap: 1,
      speedKmh: 0,
      isBoosted: false,
    })),

  restartRace: () =>
    set((s) => ({
      run: s.run + 1,
      status: "racing",
      paused: false,
      timeRemaining: RACE_DURATION_SECONDS,
      countdown: 0,
      stars: 0,
      progress: 0,
      lap: 1,
      speedKmh: 0,
      isBoosted: false,
      lastTime: null,
    })),

  setPaused: (p) => set({ paused: p }),

  tickTimer: (deltaSeconds) =>
    set((s) => {
      if (s.status !== "racing" || s.paused) return s;
      const next = Math.max(0, s.timeRemaining - deltaSeconds);
      if (next <= 0) {
        return { timeRemaining: 0, status: "lost" };
      }
      return { timeRemaining: next };
    }),

  tickCountdown: (deltaSeconds) =>
    set((s) => {
      if (s.status !== "countdown") return s;
      const next = s.countdown - deltaSeconds;
      if (next <= 0) {
        return {
          status: "racing",
          countdown: 0,
          timeRemaining: RACE_DURATION_SECONDS,
        };
      }
      return { countdown: next };
    }),

  collectStar: () => set((s) => ({ stars: s.stars + 1 })),
  completeLap: () => {
    const s = get();
    if (s.status !== "racing") return;
    if (s.lap >= TOTAL_LAPS) s.winRace();
    else set({ lap: s.lap + 1, progress: 0 });
  },
  setTotalStars: (n) => set({ totalStars: n }),
  setProgress: (p) => set({ progress: Math.min(1, Math.max(0, p)) }),
  setSpeedKmh: (s) => set({ speedKmh: Math.round(s) }),
  setIsBoosted: (b) => set({ isBoosted: b }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  cycleCameraMode: () =>
    set((s) => {
      const modes: CameraMode[] = ["chase", "hood", "far"];
      const nextIdx = (modes.indexOf(s.cameraMode) + 1) % modes.length;
      return { cameraMode: modes[nextIdx] };
    }),

  winRace: () =>
    set((s) => {
      const elapsed = Math.round((RACE_DURATION_SECONDS - s.timeRemaining) * 10) / 10;
      let newBest = s.bestTime;
      if (newBest === null || elapsed < newBest) {
        newBest = elapsed;
        try {
          localStorage.setItem(BEST_TIME_KEY, String(elapsed));
        } catch {
          /* ignore */
        }
      }
      return { status: "won", lastTime: elapsed, bestTime: newBest };
    }),

  loseRace: () => set({ status: "lost" }),
}));

// ----- tiny formatting helper used by the HUD -----
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function formatTimePrecise(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(1);
  return `${m.toString().padStart(2, "0")}:${s.padStart(4, "0")}`;
}
