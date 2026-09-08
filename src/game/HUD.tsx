import { useEffect, useRef } from "react";
import { useGameStore, formatTime, formatTimePrecise } from "./useGameStore";
import { audio } from "./audio";
import { MiniMap } from "./MiniMap";

// =====================================================================
// HUD.tsx — Complete arcade DOM overlay:
//   • Top bar: Race timer, personal best, star counter, camera & mute toggles
//   • Real-time Radar Mini-map showing track loop, kart, and stars
//   • Digital Speedometer with RPM arc & NITRO boost indicator
//   • Speed lines vignette on boost
//   • Mobile touch buttons & desktop keyboard shortcuts (WASD/Arrows/Space/C/M/R/P)
//   • Polished Start, Win, Lose, and Pause modals with star rankings
// =====================================================================

interface HUDProps {
  inputRef: React.MutableRefObject<{
    forward: boolean;
    left: boolean;
    right: boolean;
    reverse: boolean;
  }>;
  kartPosRef: React.MutableRefObject<{ x: number; y: number; z: number }>;
  kartYawRef: React.MutableRefObject<number>;
  collectedStarsRef: React.MutableRefObject<Set<number>>;
}

export function HUD({
  inputRef,
  kartPosRef,
  kartYawRef,
  collectedStarsRef,
}: HUDProps) {
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const timeRemaining = useGameStore((s) => s.timeRemaining);
  const countdown = useGameStore((s) => s.countdown);
  const stars = useGameStore((s) => s.stars);
  const totalStars = useGameStore((s) => s.totalStars);
  const progress = useGameStore((s) => s.progress);
  const speedKmh = useGameStore((s) => s.speedKmh);
  const isBoosted = useGameStore((s) => s.isBoosted);
  const muted = useGameStore((s) => s.muted);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const bestTime = useGameStore((s) => s.bestTime);
  const lastTime = useGameStore((s) => s.lastTime);

  const startRace = useGameStore((s) => s.startRace);
  const restartRace = useGameStore((s) => s.restartRace);
  const setPaused = useGameStore((s) => s.setPaused);
  const toggleMute = useGameStore((s) => s.toggleMute);
  const cycleCameraMode = useGameStore((s) => s.cycleCameraMode);

  // ---- Keyboard shortcuts ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "p" || k === "escape") {
        if (status === "racing") setPaused(!paused);
      }
      if (k === "r") {
        restartRace();
      }
      if (k === "m") {
        toggleMute();
      }
      if (k === "c") {
        cycleCameraMode();
      }
      if (status === "idle" && (k === "enter" || k === " " || k === "w" || k === "arrowup")) {
        audio.ensure();
        startRace();
      }
      if ((status === "won" || status === "lost") && (k === "enter" || k === " ")) {
        audio.ensure();
        restartRace();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused, status, restartRace, setPaused, toggleMute, cycleCameraMode, startRace]);

  // Touch button handler with pointer capture
  const bindBtn = (key: keyof typeof inputRef.current) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      audio.ensure();
      inputRef.current[key] = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
    },
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      inputRef.current[key] = false;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    },
    onPointerCancel: () => {
      inputRef.current[key] = false;
    },
    onLostPointerCapture: () => {
      inputRef.current[key] = false;
    },
  });

  // Timer urgency colors
  const urgent = timeRemaining <= 10 && timeRemaining > 0;
  const warning = timeRemaining <= 30 && timeRemaining > 10;
  const timerColour = urgent
    ? "text-red-500 animate-pulse"
    : warning
      ? "text-amber-400"
      : "text-white";
  const timerBg = urgent
    ? "bg-red-500/30 border-red-500"
    : warning
      ? "bg-amber-400/30 border-amber-400"
      : "bg-black/50 border-white/30";

  // Countdown audio beeps
  const lastCountdownTickRef = useRef<number>(-1);
  useEffect(() => {
    if (status !== "countdown") return;
    const tick = Math.ceil(countdown);
    if (tick > 0 && tick !== lastCountdownTickRef.current) {
      lastCountdownTickRef.current = tick;
      audio.blip(tick === 1 ? 880 : 660, 0.18, "square");
    }
  }, [countdown, status]);

  useEffect(() => {
    if (status === "racing") {
      audio.blip(1200, 0.3, "triangle");
    }
  }, [status]);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 select-none font-sans"
      style={{ paddingBottom: "max(0px, env(safe-area-inset-bottom))" }}
    >
      {/* ===================== BOOST SCREEN VIGNETTE ===================== */}
      {isBoosted && (
        <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-transparent via-cyan-500/10 to-cyan-500/30 animate-pulse" />
      )}

      {/* ===================== TOP BAR ===================== */}
      <div className="absolute left-0 right-0 top-0 flex items-start justify-between gap-2 p-3">
        {/* Left: Timer & Personal Best */}
        <div className="flex flex-col gap-1.5">
          <div
            className={`pointer-events-auto rounded-2xl border-2 px-4 py-2 shadow-lg backdrop-blur transition-colors ${timerBg}`}
          >
            <div className="text-[10px] font-extrabold uppercase tracking-widest text-white/70">
              Time
            </div>
            <div className={`text-3xl font-black tabular-nums tracking-wider ${timerColour}`}>
              {formatTime(timeRemaining)}
            </div>
          </div>

          {bestTime !== null && (
            <div className="pointer-events-auto rounded-xl border border-yellow-400/40 bg-black/40 px-3 py-1 text-xs font-bold text-yellow-300 shadow backdrop-blur">
              🏆 Best: {formatTimePrecise(bestTime)}
            </div>
          )}
        </div>

        {/* Center: Lap Progress */}
        <div className="hidden flex-col items-center sm:flex sm:w-1/3">
          <div className="w-full rounded-full border-2 border-white/30 bg-black/50 p-1 shadow-lg backdrop-blur">
            <div
              className="h-2.5 rounded-full bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 transition-all duration-150"
              style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
            />
          </div>
          <div className="mt-1 text-[11px] font-black uppercase tracking-widest text-white/90 drop-shadow">
            Lap Progress · {Math.round(progress * 100)}%
          </div>
        </div>

        {/* Right: Stars, Controls & Radar */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {/* Camera View Switcher */}
            <button
              onClick={cycleCameraMode}
              className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/30 bg-black/50 px-3 py-1.5 text-xs font-bold text-white shadow hover:bg-black/70 backdrop-blur"
              title="Change Camera View (C)"
            >
              <span>🎥</span>
              <span className="uppercase text-[10px] tracking-wider">
                {cameraMode}
              </span>
            </button>

            {/* Mute Button */}
            <button
              onClick={toggleMute}
              className="pointer-events-auto rounded-xl border border-white/30 bg-black/50 p-1.5 text-lg shadow hover:bg-black/70 backdrop-blur"
              title="Toggle Audio (M)"
            >
              {muted ? "🔇" : "🔊"}
            </button>

            {/* Pause Button */}
            {status === "racing" && (
              <button
                onClick={() => setPaused(true)}
                className="pointer-events-auto rounded-xl border border-white/30 bg-black/50 p-1.5 text-lg shadow hover:bg-black/70 backdrop-blur"
                title="Pause (P)"
              >
                ⏸
              </button>
            )}

            {/* Stars Counter */}
            <div className="pointer-events-auto rounded-2xl border-2 border-white/30 bg-black/50 px-4 py-2 text-center shadow-lg backdrop-blur">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-white/70">
                Stars
              </div>
              <div className="flex items-center gap-1.5 text-2xl font-black text-yellow-300">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#ffd633">
                  <polygon points="12,2 15,9 22,9 17,14 19,21 12,17 5,21 7,14 2,9 9,9" />
                </svg>
                <span className="tabular-nums">
                  {stars}/{totalStars}
                </span>
              </div>
            </div>
          </div>

          {/* Radar Mini-Map */}
          <div className="pointer-events-auto mt-1">
            <MiniMap
              kartPosRef={kartPosRef}
              kartYawRef={kartYawRef}
              collectedStarsRef={collectedStarsRef}
            />
          </div>
        </div>
      </div>

      {/* ===================== BOTTOM LEFT: SPEEDOMETER ===================== */}
      <div className="pointer-events-auto absolute bottom-4 left-4 hidden md:block">
        <Speedometer speedKmh={speedKmh} isBoosted={isBoosted} />
      </div>

      {/* ===================== TOUCH CONTROLS (Mobile) ===================== */}
      <div
        className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 px-4 pb-4 md:hidden"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
      >
        {/* Reverse / Brake */}
        <TouchButton
          label="▼"
          sublabel="BRAKE"
          color="bg-rose-500 active:bg-rose-700"
          {...bindBtn("reverse")}
        />

        {/* Steering (Left / Right) */}
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

        {/* Forward Gas */}
        <TouchButton
          label="▲"
          sublabel="DRIVE"
          color="bg-emerald-500 active:bg-emerald-700"
          size="big"
          {...bindBtn("forward")}
        />
      </div>

      {/* ===================== DESKTOP HINT ===================== */}
      <div className="absolute bottom-3 right-4 hidden rounded-xl border border-white/20 bg-black/50 px-3.5 py-2 text-xs font-semibold text-white/90 shadow-lg backdrop-blur md:block">
        <b>WASD</b> Drive · <b>Space</b> Brake · <b>C</b> Camera · <b>M</b> Audio · <b>R</b> Restart · <b>P</b> Pause
      </div>

      {/* ===================== 3-2-1-GO POP ===================== */}
      {status === "countdown" && <CountdownOverlay countdown={countdown} />}

      {/* ===================== MODALS ===================== */}
      {status === "idle" && (
        <StartModal onStart={startRace} bestTime={bestTime} />
      )}
      {status === "won" && (
        <WinModal
          stars={stars}
          total={totalStars}
          lastTime={lastTime}
          bestTime={bestTime}
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
// Digital Speedometer with Gauge Arc & Boost Glow
// ---------------------------------------------------------------------
function Speedometer({ speedKmh, isBoosted }: { speedKmh: number; isBoosted: boolean }) {
  const norm = Math.min(1, speedKmh / 100);
  const color = isBoosted
    ? "from-cyan-400 to-indigo-400 text-cyan-300"
    : speedKmh > 65
      ? "from-orange-400 to-red-500 text-amber-300"
      : "from-emerald-400 to-cyan-400 text-emerald-300";

  return (
    <div className="relative flex flex-col items-center rounded-3xl border-2 border-white/30 bg-black/60 p-3 shadow-2xl backdrop-blur">
      <div className="flex items-baseline gap-1">
        <span className={`text-4xl font-black tabular-nums tracking-tight ${color}`}>
          {speedKmh}
        </span>
        <span className="text-xs font-bold text-white/70">KM/H</span>
      </div>

      {/* Radial gauge bar */}
      <div className="mt-1 h-2 w-24 overflow-hidden rounded-full bg-white/20">
        <div
          className={`h-full bg-gradient-to-r ${color} transition-all duration-100`}
          style={{ width: `${norm * 100}%` }}
        />
      </div>

      {isBoosted && (
        <div className="mt-1 animate-bounce text-[10px] font-black uppercase tracking-widest text-cyan-300">
          ⚡ NITRO BOOST ⚡
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// 3-2-1-GO Overlay
// ---------------------------------------------------------------------
function CountdownOverlay({ countdown }: { countdown: number }) {
  const tick = Math.max(1, Math.ceil(countdown));
  const fractional = 1 - (countdown - Math.floor(countdown));
  const scale = 1 + fractional * 0.5;
  const opacity = Math.max(0, 1 - fractional * 0.85);

  const label = tick > 0 ? String(tick) : "GO!";
  const colour =
    tick > 0
      ? "from-yellow-300 to-orange-500 text-white"
      : "from-emerald-400 to-cyan-500 text-white";

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div
        className={`flex h-44 w-44 items-center justify-center rounded-full bg-gradient-to-br ${colour} shadow-2xl ring-8 ring-white/80`}
        style={{ transform: `scale(${scale})`, opacity }}
      >
        <span className="text-8xl font-black drop-shadow-lg">{label}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Touch Button
// ---------------------------------------------------------------------
function TouchButton({
  label,
  sublabel,
  color,
  size,
  ...handlers
}: {
  label: string;
  sublabel?: string;
  color: string;
  size?: "big";
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`pointer-events-auto flex flex-col items-center justify-center rounded-3xl border-4 border-white/80 font-black text-white shadow-2xl transition-transform active:scale-90 ${color} ${
        size === "big" ? "h-24 w-24 text-4xl" : "h-20 w-20 text-3xl"
      }`}
      style={{ touchAction: "none" }}
      {...handlers}
    >
      <span>{label}</span>
      {sublabel && <span className="text-[9px] tracking-widest opacity-80">{sublabel}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------
function StartModal({
  onStart,
  bestTime,
}: {
  onStart: () => void;
  bestTime: number | null;
}) {
  return (
    <ModalShell>
      <div className="mb-2 text-6xl animate-bounce">🏎️</div>
      <h1 className="mb-1 text-4xl font-black tracking-tight text-white drop-shadow-md">
        ChunkCoaster
      </h1>
      <p className="mb-3 text-sm font-medium text-white/90">
        Arcade Voxel Racing on a High-Speed Rollercoaster Track!
      </p>

      <div className="mx-auto mb-4 max-w-xs space-y-1.5 rounded-2xl bg-white/10 p-3.5 text-left text-xs leading-relaxed text-white/95">
        <div>🏁 <b>Goal:</b> Drive 1 complete lap and cross the checkered line!</div>
        <div>⭐ <b>Stars:</b> Collect stars scattered along the road!</div>
        <div>⚡ <b>Yellow Stripes:</b> Hit them for instant Nitro Boost!</div>
        <div>🍄 <b>Mushrooms:</b> Bounce high into the air!</div>
      </div>

      {bestTime !== null && (
        <div className="mb-4 rounded-xl bg-yellow-400/20 px-3 py-1.5 text-xs font-bold text-yellow-300">
          🏆 Current Record: {formatTimePrecise(bestTime)}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-center justify-center gap-2 text-xs text-white/80">
        <Key>W</Key>
        <Key>A</Key>
        <Key>S</Key>
        <Key>D</Key>
        <span className="opacity-70">or</span>
        <Key>↑</Key>
        <Key>←</Key>
        <Key>↓</Key>
        <Key>→</Key>
        <span className="opacity-70">·</span>
        <Key>Space</Key>
      </div>

      <button
        onClick={() => {
          audio.ensure();
          onStart();
        }}
        className="w-full rounded-2xl bg-emerald-500 py-4 text-2xl font-black text-white shadow-xl transition-all hover:bg-emerald-600 hover:scale-105 active:scale-95"
      >
        START RACE (Space)
      </button>
    </ModalShell>
  );
}

function WinModal({
  stars,
  total,
  lastTime,
  bestTime,
  onRestart,
}: {
  stars: number;
  total: number;
  lastTime: number | null;
  bestTime: number | null;
  onRestart: () => void;
}) {
  const isNewRecord = lastTime !== null && bestTime !== null && lastTime <= bestTime;

  return (
    <ModalShell>
      <div className="mb-2 text-6xl animate-pulse">🏆</div>
      <h1 className="mb-1 text-4xl font-black text-white drop-shadow-md">
        {isNewRecord ? "NEW RECORD!" : "VICTORY!"}
      </h1>
      <p className="mb-4 text-sm text-white/90">You crossed the finish line in style!</p>

      <div className="mx-auto mb-5 max-w-xs space-y-2 rounded-2xl bg-white/15 p-4 text-center">
        {lastTime !== null && (
          <div className="text-2xl font-black text-emerald-300">
            ⏱️ {formatTimePrecise(lastTime)}
          </div>
        )}
        <div className="text-lg font-bold text-yellow-300">
          ⭐ {stars} of {total} Stars Collected
        </div>
        {bestTime !== null && (
          <div className="text-xs text-white/70">
            Personal Best: {formatTimePrecise(bestTime)}
          </div>
        )}
      </div>

      <button
        onClick={onRestart}
        className="w-full rounded-2xl bg-yellow-400 py-4 text-2xl font-black text-yellow-950 shadow-xl transition-all hover:bg-yellow-500 hover:scale-105 active:scale-95"
      >
        RACE AGAIN (Space)
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
      <h1 className="mb-1 text-4xl font-black text-white drop-shadow-md">
        Time&apos;s Up!
      </h1>
      <p className="mb-4 text-sm text-white/90">
        You completed <b>{pct}%</b> of the lap and grabbed <b>⭐ {stars}</b> stars.
      </p>

      <button
        onClick={onRestart}
        className="w-full rounded-2xl bg-pink-500 py-4 text-2xl font-black text-white shadow-xl transition-all hover:bg-pink-600 hover:scale-105 active:scale-95"
      >
        TRY AGAIN (Space)
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
      <div className="mb-2 text-6xl">⏸</div>
      <h1 className="mb-4 text-4xl font-black text-white drop-shadow-md">Paused</h1>
      <div className="flex flex-col gap-3">
        <button
          onClick={onResume}
          className="rounded-2xl bg-emerald-500 py-3.5 text-xl font-bold text-white shadow-lg transition-all hover:bg-emerald-600"
        >
          ▶ RESUME (P)
        </button>
        <button
          onClick={onRestart}
          className="rounded-2xl bg-pink-500 py-3 text-lg font-bold text-white shadow-lg transition-all hover:bg-pink-600"
        >
          ↻ RESTART (R)
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md">
      <div className="w-full max-w-sm rounded-3xl border-4 border-white/40 bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-6 text-center text-white shadow-2xl">
        {children}
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg border border-white/40 bg-black/40 px-2 font-mono text-xs font-bold text-white shadow">
      {children}
    </span>
  );
}

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
