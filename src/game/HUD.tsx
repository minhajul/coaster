import { useEffect, useRef } from "react";
import { useGameStore, formatTime } from "./useGameStore";
import { audio } from "./Vehicle";

// =====================================================================
// HUD.tsx — DOM overlay (Tailwind). Onboarding, gameplay HUD, modals,
// touch controls, pause, and restart shortcut. Designed for kids 5–8.
// =====================================================================

interface HUDProps {
  inputRef: React.MutableRefObject<{
    forward: boolean;
    left: boolean;
    right: boolean;
    reverse: boolean;
  }>;
}

export function HUD({ inputRef }: HUDProps) {
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const timeRemaining = useGameStore((s) => s.timeRemaining);
  const stars = useGameStore((s) => s.stars);
  const totalStars = useGameStore((s) => s.totalStars);
  const progress = useGameStore((s) => s.progress);
  const startRace = useGameStore((s) => s.startRace);
  const restartRace = useGameStore((s) => s.restartRace);
  const setPaused = useGameStore((s) => s.setPaused);

  // ---- keyboard: P or Esc to pause, R to restart ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "p" || k === "escape") {
        if (status === "racing") setPaused(!paused);
      }
      if (k === "r") {
        restartRace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, status, restartRace, setPaused]);

  // ---- touch button helpers ----
  // We use pointer capture so the button stays "pressed" even if the
  // finger slides off the visible button, and we only release on
  // pointerup / pointercancel.
  const bindBtn = (key: keyof typeof inputRef.current) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current[key] = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      inputRef.current[key] = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    onPointerCancel: () => {
      inputRef.current[key] = false;
    },
    onLostPointerCapture: () => {
      inputRef.current[key] = false;
    },
  });

  // ---- colour state for timer ----
  const urgent = timeRemaining <= 10 && timeRemaining > 0;
  const warning = timeRemaining <= 30 && timeRemaining > 10;
  const timerColour = urgent
    ? "text-red-500 animate-pulse-slow"
    : warning
      ? "text-amber-400"
      : "text-white";
  const timerBg = urgent
    ? "bg-red-500/30 border-red-500"
    : warning
      ? "bg-amber-400/30 border-amber-400"
      : "bg-black/40 border-white/30";

  // ---- countdown beeps in the last 3 seconds ----
  // We use a ref to track the last integer-second we beeped for, so the
  // beep fires exactly once per tick (avoids the multi-fire problem
  // when the 50ms window re-triggers on the same second).
  const lastBeepedSecRef = useRef<number>(-1);
  const wholeSec = Math.ceil(timeRemaining);
  useEffect(() => {
    if (status !== "racing" || paused) return;
    if (
      wholeSec <= 3 &&
      wholeSec > 0 &&
      wholeSec !== lastBeepedSecRef.current
    ) {
      lastBeepedSecRef.current = wholeSec;
      audio.blip(wholeSec === 1 ? 440 : 660, 0.12, "square");
    }
    // Reset the ref so unpause/next race can re-beep normally.
    if (wholeSec > 3) {
      lastBeepedSecRef.current = -1;
    }
  }, [wholeSec, status, paused]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 select-none font-chunky"
      style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      {/* ===================== TOP BAR ===================== */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between gap-2 p-3">
        {/* Timer */}
        <div
          className={`pointer-events-auto rounded-2xl border-2 px-4 py-2 shadow-lg backdrop-blur ${timerBg}`}
        >
          <div className="text-[10px] uppercase tracking-widest text-white/70">
            Time
          </div>
          <div className={`text-3xl font-bold tabular-nums ${timerColour}`}>
            {formatTime(timeRemaining)}
          </div>
        </div>

        {/* Pause / Restart buttons */}
        {status === "racing" && (
          <div className="pointer-events-auto flex flex-col gap-1">
            <button
              onClick={() => setPaused(true)}
              className="rounded-full border-2 border-white/40 bg-black/40 px-4 py-2 text-2xl shadow-lg backdrop-blur hover:bg-black/60"
              title="Pause (P)"
            >
              ⏸
            </button>
          </div>
        )}

        {/* Star counter */}
        <div className="pointer-events-auto rounded-2xl border-2 border-white/30 bg-black/40 px-4 py-2 text-center shadow-lg backdrop-blur">
          <div className="text-[10px] uppercase tracking-widest text-white/70">
            Stars
          </div>
          <div className="flex items-center gap-2 text-2xl font-bold text-yellow-300">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="#ffd633">
              <polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" />
            </svg>
            <span className="tabular-nums">
              {stars}/{totalStars}
            </span>
          </div>
        </div>
      </div>

      {/* ===================== PROGRESS BAR (under top bar) ===================== */}
      <div className="absolute left-1/2 top-[88px] w-11/12 max-w-xl -translate-x-1/2 md:top-3 md:w-1/3">
        <div className="rounded-full border-2 border-white/30 bg-black/40 p-1 shadow backdrop-blur">
          <div
            className="h-2 rounded-full bg-gradient-to-r from-emerald-400 via-emerald-300 to-emerald-200"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <div className="mt-0.5 text-center text-[10px] uppercase tracking-widest text-white/80">
          Lap 1 of 1
        </div>
      </div>

      {/* ===================== TOUCH CONTROLS ===================== */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 px-4 pb-4 md:hidden"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {/* Reverse (small) */}
        <TouchButton
          label="▼"
          color="bg-orange-500 active:bg-orange-700"
          {...bindBtn("reverse")}
        />
        {/* Left + Right */}
        <div className="flex gap-2">
          <TouchButton
            label="◀"
            color="bg-blue-500 active:bg-blue-700"
            {...bindBtn("left")}
          />
          <TouchButton
            label="▶"
            color="bg-blue-500 active:bg-blue-700"
            {...bindBtn("right")}
          />
        </div>
        {/* Forward (big) */}
        <TouchButton
          label="▲"
          color="bg-emerald-500 active:bg-emerald-700"
          size="big"
          {...bindBtn("forward")}
        />
      </div>

      {/* ===================== KEYBOARD HINT (desktop only) ===================== */}
      <div className="absolute bottom-3 right-4 hidden rounded-xl border border-white/20 bg-black/40 px-3 py-1.5 text-xs text-white/80 backdrop-blur md:block">
        Controls: <b>WASD</b> / <b>Arrows</b> · <b>P</b> pause · <b>R</b> restart
      </div>

      {/* ===================== MODALS ===================== */}
      {status === "idle" && (
        <StartModal onStart={startRace} />
      )}
      {status === "won" && (
        <WinModal
          stars={stars}
          total={totalStars}
          onRestart={() => {
            restartRace();
            setPaused(false);
          }}
        />
      )}
      {status === "lost" && (
        <LoseModal
          stars={stars}
          total={totalStars}
          progress={progress}
          onRestart={() => {
            restartRace();
            setPaused(false);
          }}
        />
      )}
      {paused && status === "racing" && (
        <PauseModal
          onResume={() => setPaused(false)}
          onRestart={() => {
            restartRace();
            setPaused(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Touch button
// ---------------------------------------------------------------------
function TouchButton({
  label,
  color,
  size,
  ...handlers
}: {
  label: string;
  color: string;
  size?: "big";
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`pointer-events-auto flex items-center justify-center rounded-3xl border-4 border-white/70 text-4xl font-bold text-white shadow-2xl transition-transform active:scale-95 ${color} ${
        size === "big" ? "h-24 w-24" : "h-20 w-20"
      }`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------
function StartModal({ onStart }: { onStart: () => void }) {
  return (
    <ModalShell>
      <div className="mb-3 text-6xl">🎮</div>
      <h1 className="mb-1 text-4xl font-bold drop-shadow-md">ChunkCoaster</h1>
      <p className="mb-1 text-base opacity-95">A blocky race for tiny pilots!</p>
      <div className="mx-auto mb-4 max-w-xs rounded-2xl bg-white/10 p-3 text-left text-sm leading-snug">
        <div>
          🏁 <b>Goal:</b> drive around the track and cross the
          <b> finish line</b> before 2 minutes run out!
        </div>
        <div>
          ⭐ <b>Stars:</b> grab them for bonus points!
        </div>
        <div>
          🟡 <b>Yellow stripes</b> = speed boost
        </div>
        <div>
          🍄 <b>Mushrooms</b> = bounce!
        </div>
      </div>
      <div className="mb-4 flex justify-center gap-3 text-2xl">
        <Key>W</Key>
        <Key>A</Key>
        <Key>S</Key>
        <Key>D</Key>
        <span className="self-center text-xs opacity-70">or</span>
        <Key>←</Key>
        <Key>↑</Key>
        <Key>↓</Key>
        <Key>→</Key>
      </div>
      <button
        onClick={() => {
          audio.ensure();
          onStart();
        }}
        className="rounded-2xl bg-green-500 px-10 py-4 text-2xl font-bold shadow-lg transition-colors hover:bg-green-600"
      >
        START RACE
      </button>
    </ModalShell>
  );
}

function WinModal({
  stars,
  total,
  onRestart,
}: {
  stars: number;
  total: number;
  onRestart: () => void;
}) {
  const msg =
    stars === total && total > 0
      ? "PERFECT! All stars!"
      : stars > total / 2
        ? "Amazing run!"
        : stars > 0
          ? "Nice work!"
          : "You finished! Try to grab more ⭐ next time!";
  return (
    <ModalShell>
      <div className="mb-2 text-6xl">🏆</div>
      <h1 className="mb-2 text-4xl font-bold drop-shadow-md">YOU DID IT!</h1>
      <p className="mb-1 text-lg opacity-95">{msg}</p>
      <p className="mb-5 text-2xl">
        ⭐ {stars}/{total} stars
      </p>
      <button
        onClick={onRestart}
        className="rounded-2xl bg-yellow-400 px-10 py-4 text-2xl font-bold text-yellow-900 shadow-lg transition-colors hover:bg-yellow-500"
      >
        RACE AGAIN
      </button>
    </ModalShell>
  );
}

function LoseModal({
  stars,
  total,
  progress,
  onRestart,
}: {
  stars: number;
  total: number;
  progress: number;
  onRestart: () => void;
}) {
  const pct = Math.round(progress * 100);
  return (
    <ModalShell>
      <div className="mb-2 text-6xl">⏰</div>
      <h1 className="mb-2 text-4xl font-bold drop-shadow-md">Time&apos;s Up!</h1>
      <p className="mb-1 text-lg opacity-95">
        You made it <b>{pct}%</b> around the track
      </p>
      <p className="mb-5 text-xl opacity-90">
        and grabbed <b>⭐ {stars}</b>
        {total > 0 && ` of ${total}`} stars!
      </p>
      <button
        onClick={onRestart}
        className="rounded-2xl bg-pink-500 px-10 py-4 text-2xl font-bold shadow-lg transition-colors hover:bg-pink-600"
      >
        TRY AGAIN
      </button>
    </ModalShell>
  );
}

function PauseModal({
  onResume,
  onRestart,
}: {
  onResume: () => void;
  onRestart: () => void;
}) {
  return (
    <ModalShell>
      <div className="mb-3 text-6xl">⏸</div>
      <h1 className="mb-5 text-4xl font-bold drop-shadow-md">Paused</h1>
      <div className="flex flex-col gap-3">
        <button
          onClick={onResume}
          className="rounded-2xl bg-green-500 px-10 py-4 text-2xl font-bold shadow-lg transition-colors hover:bg-green-600"
        >
          ▶ RESUME
        </button>
        <button
          onClick={onRestart}
          className="rounded-2xl bg-pink-500 px-10 py-3 text-xl font-bold shadow-lg transition-colors hover:bg-pink-600"
        >
          ↻ RESTART
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur">
      <div className="w-full max-w-md rounded-3xl border-4 border-white/30 bg-gradient-to-br from-indigo-500 to-purple-600 p-6 text-center text-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-9 min-w-[2.25rem] items-center justify-center rounded-lg border-2 border-white/40 bg-black/30 px-2 font-mono text-base font-bold shadow">
      {children}
    </span>
  );
}

// Prevent default touch scrolling/zooming on the page.
export function useNoScrollOnCanvas() {
  useEffect(() => {
    const prevent = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest("button")) return;
      e.preventDefault();
    };
    const opts = { passive: false } as const;
    document.addEventListener("touchmove", prevent, opts);
    return () => document.removeEventListener("touchmove", prevent);
  }, []);
}
