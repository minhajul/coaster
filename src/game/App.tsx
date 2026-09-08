import { useEffect, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import { Track } from "./Track";
import { Vehicle, useKeyboardControls } from "./Vehicle";
import { Particles } from "./Particles";
import { Environment } from "./Environment";
import { HUD, useNoScrollOnCanvas } from "./HUD";
import { useGameStore } from "./useGameStore";
import { audio } from "./audio";

// =====================================================================
// App.tsx — Top-level scene composition:
//   • Canvas with post-processing & tone mapping
//   • Lighting & procedural sky
//   • Rapier physics world with Track & Vehicle
//   • 3D Particles (exhaust, nitro flames, speed streaks)
//   • Environment (clouds, windmills, hot air balloons)
//   • DOM HUD with Speedometer, Radar Mini-map, Modals
// =====================================================================

export function App() {
  useNoScrollOnCanvas();

  const inputRef = useRef({
    forward: false,
    left: false,
    right: false,
    reverse: false,
  });
  useKeyboardControls(inputRef);

  // Shared kart transform refs for particles, mini-map, and camera
  const kartPosRef = useRef(new THREE.Vector3(60, 6.7, 0));
  const kartQuatRef = useRef(new THREE.Quaternion());
  const kartYawRef = useRef(0);
  const collectedStarsRef = useRef<Set<number>>(new Set());

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-sky-300">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [0, 20, 60], fov: 60, near: 0.1, far: 800 }}
        gl={{
          antialias: true,
          toneMapping: ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
          outputColorSpace: SRGBColorSpace,
        }}
      >
        <color attach="background" args={["#aee2ff"]} />
        <fog attach="fog" args={["#bde7ff", 130, 420]} />

        {/* Dynamic bright sunlight */}
        <ambientLight intensity={0.7} color="#fff8e7" />
        <directionalLight
          position={[50, 90, 40]}
          intensity={1.4}
          color="#fff5d6"
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
          shadow-camera-near={1}
          shadow-camera-far={250}
        />
        <hemisphereLight args={["#bde7ff", "#6c4a2a", 0.4]} />

        <Physics gravity={[0, -14, 0]} colliders={false} timeStep={1 / 60}>
          <Track />
          <Environment />
          <Vehicle
            inputRef={inputRef}
            kartPosRef={kartPosRef}
            kartQuatRef={kartQuatRef}
            kartYawRef={kartYawRef}
            collectedStarsRef={collectedStarsRef}
          />
          <Particles kartPosRef={kartPosRef} kartQuatRef={kartQuatRef} />
          <TimerDriver />
        </Physics>
      </Canvas>

      <HUD
        inputRef={inputRef}
        kartPosRef={kartPosRef}
        kartYawRef={kartYawRef}
        collectedStarsRef={collectedStarsRef}
      />
    </div>
  );
}

// ---------------------------------------------------------------------
// TimerDriver — ticks countdown & race clock + plays audio transitions
// ---------------------------------------------------------------------
function TimerDriver() {
  const status = useGameStore((s) => s.status);
  const tickTimer = useGameStore((s) => s.tickTimer);
  const tickCountdown = useGameStore((s) => s.tickCountdown);
  const prevStatus = useRef(status);

  useEffect(() => {
    if (status !== prevStatus.current) {
      if (status === "won") audio.winFanfare();
      if (status === "lost") audio.loseSound();
      prevStatus.current = status;
    }
  }, [status]);

  useFrame((_, delta) => {
    if (status === "countdown") {
      tickCountdown(delta);
    } else if (status === "racing") {
      tickTimer(delta);
    }
  });
  return null;
}
