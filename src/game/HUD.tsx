import { useEffect, useRef } from "react";
import { useGameStore, formatTime, RACE_DURATION_SECONDS } from "./useGameStore";

// =====================================================================
// HUD.tsx — pure DOM overlay (Tailwind). Three responsibilities:
//   1. Display timer / progress / stars.
//   2. Provide on-screen touch controls that mirror keyboard input.
//   3. Show win / lose / start modals.
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
  const timeRemaining = useGameStore((s) => s.timeRemaining);
  const stars = useGameStore((s) => s.stars);
  const totalStars = useGameStore((s) => s.totalStars);
  const progress = useGameStore((s) => s.progress);
  const startRace = useGameStore((s) => s.startRace);
  const resetRace = useGameStore((s) => s.resetRace);

  // ---- touch button helpers (press = true, release = false) ----
  const bindBtn = (key: keyof typeof inputRef.current) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      inputRef.current[key] = true;
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      inputRef.current[key] = false;
    },
    onPointerLeave: (e: React.PointerEvent) => {
      e.preventDefault();
      inputRef.current[key] = false;
    },
    onPointerCancel: () => {
      inputRef.current[key] = false;
    },
  });

  // Timer colour state
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

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none font-chunky">
      {/* ===================== TOP BAR ===================== */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between p-4">
        {/* Timer */}
        <div
          className={`pointer-events-auto rounded-2xl border-2 px-5 py-3 shadow-lg backdrop-blur ${timerBg}`}
        >
          <div className="text-xs uppercase tracking-widest text-white/70">
            Time
          </div>
          <div className={`text-4xl font-bold tabular-nums ${timerColour}`}>
            {formatTime(timeRemaining)}
          </div>
        </div>

        {/* Star counter */}
        <div className="pointer-events-auto rounded-2xl border-2 border-white/30 bg-black/40 px-4 py-3 text-center shadow-lg backdrop-blur">
          <div className="text-xs uppercase tracking-widest text-white/70">
            Stars
          </div>
          <div className="flex items-center gap-2 text-3xl font-bold text-yellow-300">
            <span className="text-4xl">⭐</span>
            <span className="tabular-nums">
              {stars}/{totalStars}
            </span>
          </div>
        </div>
      </div>

      {/* ===================== PROGRESS BAR ===================== */}
      <div className="absolute left-1/2 top-4 w-2/3 max-w-xl -translate-x-1/2">
        <div className="rounded-full border-2 border-white/40 bg-black/50 p-1.5 shadow-lg backdrop-blur">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-green-400 via-yellow-300 to-red-500 transition-all duration-300"
            style={{ width: `${Math.min(100, progress * 100)}%` }}
          />
        </div>
        <div className="mt-1 text-center text-xs uppercase tracking-widest text-white/80">
          🏁 Finish Line
        </div>
      </div>

      {/* ===================== TOUCH CONTROLS ===================== */}
      <div className="absolute bottom-6 left-0 right-0 flex items-end justify-between px-6 md:hidden">
        {/* Left + Right */}
        <div className="flex gap-4">
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
        {/* Forward */}
        <TouchButton
          label="▲"
          color="bg-green-500 active:bg-green-700"
          size="big"
          {...bindBtn("forward")}
        />
      </div>

      {/* Desktop hint: subtle key hints at bottom-right */}
      <div className="absolute bottom-4 right-4 hidden rounded-xl border border-white/20 bg-black/40 px-4 py-2 text-xs text-white/80 backdrop-blur md:block">
        Controls: <b>WASD</b> / <b>Arrow Keys</b>
      </div>

      {/* ===================== MODALS ===================== */}
      {status === "idle" && (
        <Modal
          title="ChunkCoaster"
          subtitle="A blocky voxel race for tiny pilots!"
          emoji="🎮"
          primaryLabel="START RACE"
          primaryAction={startRace}
          accent="bg-green-500 hover:bg-green-600"
        />
      )}
      {status === "won" && (
        <Modal
          title="YOU DID IT!"
          subtitle={`You finished with ${stars} ⭐ stars!`}
          emoji="🏆"
          primaryLabel="RACE AGAIN"
          primaryAction={() => {
            resetRace();
            // Restart on next tick.
            setTimeout(startRace, 50);
          }}
          accent="bg-yellow-400 hover:bg-yellow-500 text-yellow-900"
        />
      )}
      {status === "lost" && (
        <Modal
          title="Time's Up!"
          subtitle="Give it another try!"
          emoji="🚀"
          primaryLabel="TRY AGAIN"
          primaryAction={() => {
            resetRace();
            setTimeout(startRace, 50);
          }}
          accent="bg-pink-500 hover:bg-pink-600"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Small touch button with big hit area. Hidden on desktop via the parent.
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
      className={`pointer-events-auto flex items-center justify-center rounded-full border-4 border-white/70 text-5xl font-bold text-white shadow-2xl transition-colors ${color} ${
        size === "big" ? "h-28 w-28" : "h-20 w-20"
      }`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------
// Modal dialog (start / win / lose)
// ---------------------------------------------------------------------
function Modal({
  title,
  subtitle,
  emoji,
  primaryLabel,
  primaryAction,
  accent,
}: {
  title: string;
  subtitle: string;
  emoji: string;
  primaryLabel: string;
  primaryAction: () => void;
  accent: string;
}) {
  // Unlock the audio context on first user gesture (browser policy).
  const handleClick = () => {
    try {
      new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)();
    } catch {
      /* ignore */
    }
    primaryAction();
  };
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur">
      <div className="m-4 max-w-md rounded-3xl border-4 border-white/30 bg-gradient-to-br from-indigo-500 to-purple-600 p-8 text-center text-white shadow-2xl">
        <div className="mb-4 text-7xl animate-wiggle">{emoji}</div>
        <h1 className="mb-2 text-4xl font-bold drop-shadow-md">{title}</h1>
        <p className="mb-6 text-lg opacity-90">{subtitle}</p>
        <button
          onClick={handleClick}
          className={`rounded-2xl px-8 py-4 text-2xl font-bold shadow-lg transition-colors ${accent}`}
        >
          {primaryLabel}
        </button>
        <div className="mt-4 text-xs uppercase tracking-widest opacity-70">
          {formatTime(RACE_DURATION_SECONDS)} to finish the lap
        </div>
      </div>
    </div>
  );
}

// Prevent default touch scrolling on the canvas / overlay while playing.
export function useNoScrollOnCanvas() {
  useEffect(() => {
    const prevent = (e: TouchEvent) => {
      if ((e.target as HTMLElement)?.closest("button")) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, []);
}
