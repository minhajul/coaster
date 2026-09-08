import { useEffect, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { Track } from "./Track";
import { Vehicle, audio, useKeyboardControls } from "./Vehicle";
import { HUD, useNoScrollOnCanvas } from "./HUD";
import { useGameStore } from "./useGameStore";

// =====================================================================
// App.tsx — top-level wiring: Canvas + physics provider + lighting +
// a tiny TimerDriver that ticks the Zustand clock each frame.
// =====================================================================

export function App() {
  useNoScrollOnCanvas();

  // Shared mutable input state — keyboard writes here, HUD buttons write
  // here, and Vehicle reads here. Refs avoid re-renders on key changes.
  const inputRef = useRef({
    forward: false,
    left: false,
    right: false,
    reverse: false,
  });
  useKeyboardControls(inputRef);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-sky-300">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 20, 60], fov: 60, near: 0.1, far: 600 }}
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: SRGBColorSpace,
        }}
      >
        {/* Sky-blue background + soft fog for distance falloff */}
        <color attach="background" args={["#aee2ff"]} />
        <fog attach="fog" args={["#bde7ff", 110, 380]} />

        {/* Friendly lighting: bright key + soft fill so voxel faces read
            clearly without harsh contrast (kid-friendly vibe). */}
        <ambientLight intensity={0.7} color="#fff8e7" />
        <directionalLight
          position={[40, 80, 30]}
          intensity={1.4}
          color="#fff5d6"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-80}
          shadow-camera-right={80}
          shadow-camera-top={80}
          shadow-camera-bottom={-80}
          shadow-camera-near={1}
          shadow-camera-far={200}
        />
        <hemisphereLight
          args={["#bde7ff", "#6c4a2a", 0.4]}
        />

        <Physics gravity={[0, -14, 0]} colliders={false} timeStep={1 / 60}>
          <Track />
          <Vehicle
            inputRef={inputRef}
            onCollect={() => audio.blip(880, 0.08, "square")}
          />
          <TimerDriver />
        </Physics>
      </Canvas>

      <HUD inputRef={inputRef} />
    </div>
  );
}

// ---------------------------------------------------------------------
// TimerDriver — runs inside the Canvas so it can use useFrame. Each
// frame, ticks the countdown if the race is in progress. We also play
// audio cues on state transitions.
// ---------------------------------------------------------------------
function TimerDriver() {
  const status = useGameStore((s) => s.status);
  const tickTimer = useGameStore((s) => s.tickTimer);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status !== prevStatus.current) {
      if (status === "won") audio.blip(523, 0.4, "triangle");
      if (status === "lost") audio.blip(220, 0.5, "sawtooth");
      prevStatus.current = status;
    }
  }, [status]);

  useFrame((_, delta) => {
    tickTimer(delta);
  });
  return null;
}
