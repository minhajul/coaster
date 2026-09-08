import { create } from "zustand";

// =====================================================================
// Game-wide state. We deliberately keep this tiny so React subscriptions
// stay snappy and re-renders are limited to the HUD layer.
// =====================================================================

export type GameState = "idle" | "racing" | "won" | "lost";

export const RACE_DURATION_SECONDS = 120;

interface GameStore {
  status: GameState;
  /** Remaining time on the countdown clock (seconds). */
  timeRemaining: number;
  /** Total collectible stars gathered during the current race. */
  stars: number;
  /** Total stars available on the track for this race. */
  totalStars: number;
  /** Lap progress 0..1 (drives the HUD progress bar). */
  progress: number;

  // ---------------- actions ----------------
  startRace: () => void;
  resetRace: () => void;
  tickTimer: (deltaSeconds: number) => void;
  collectStar: () => void;
  setTotalStars: (n: number) => void;
  setProgress: (p: number) => void;
  winRace: () => void;
  loseRace: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  status: "idle",
  timeRemaining: RACE_DURATION_SECONDS,
  stars: 0,
  totalStars: 0,
  progress: 0,

  startRace: () =>
    set({
      status: "racing",
      timeRemaining: RACE_DURATION_SECONDS,
      stars: 0,
      progress: 0,
    }),

  resetRace: () =>
    set({
      status: "idle",
      timeRemaining: RACE_DURATION_SECONDS,
      stars: 0,
      progress: 0,
    }),

  tickTimer: (deltaSeconds) =>
    set((s) => {
      if (s.status !== "racing") return s;
      const next = Math.max(0, s.timeRemaining - deltaSeconds);
      if (next <= 0) {
        return { timeRemaining: 0, status: "lost" };
      }
      return { timeRemaining: next };
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
