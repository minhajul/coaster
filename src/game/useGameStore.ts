import { create } from "zustand";

// =====================================================================
// Game-wide state. We deliberately keep this tiny so React subscriptions
// stay snappy and re-renders are limited to the HUD layer.
// =====================================================================

export type GameState = "idle" | "countdown" | "racing" | "won" | "lost";

export const RACE_DURATION_SECONDS = 120;
/** Whole seconds for the 3-2-1-GO countdown shown after START. */
export const COUNTDOWN_TOTAL = 3;

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
  /** Lap progress 0..1 (drives the HUD progress bar). */
  progress: number;

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
  setTotalStars: (n: number) => void;
  setProgress: (p: number) => void;
  winRace: () => void;
  loseRace: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  status: "idle",
  paused: false,
  timeRemaining: RACE_DURATION_SECONDS,
  countdown: 0,
  stars: 0,
  totalStars: 0,
  progress: 0,

  startRace: () =>
    set({
      status: "countdown",
      paused: false,
      timeRemaining: RACE_DURATION_SECONDS,
      // Start the countdown timer at the full duration so the first
      // tick produces a value of COUNTDOWN_TOTAL whole-seconds on
      // display (3.0 → ceil = 3).
      countdown: COUNTDOWN_TOTAL + 0.001,
      stars: 0,
      totalStars: 0,
      progress: 0,
    }),

  resetRace: () =>
    set({
      status: "idle",
      paused: false,
      timeRemaining: RACE_DURATION_SECONDS,
      countdown: 0,
      stars: 0,
      totalStars: 0,
      progress: 0,
    }),

  restartRace: () =>
    set({
      status: "racing",
      paused: false,
      timeRemaining: RACE_DURATION_SECONDS,
      countdown: 0,
      stars: 0,
      totalStars: 0,
      progress: 0,
    }),

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
        // Countdown finished — race begins NOW.
        return {
          status: "racing",
          countdown: 0,
          timeRemaining: RACE_DURATION_SECONDS,
        };
      }
      return { countdown: next };
    }),

  collectStar: () => set((s) => ({ stars: s.stars + 1 })),
  setTotalStars: (n) => set({ totalStars: n }),
  setProgress: (p) => set({ progress: Math.min(1, Math.max(0, p)) }),
  winRace: () => set({ status: "won" }),
  loseRace: () => set({ status: "lost" }),
}));

// ----- tiny formatting helper used by the HUD -----
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
