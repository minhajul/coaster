import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { useGameStore } from "./useGameStore";

// =====================================================================
// Particles.tsx — High-performance instanced particle systems:
//   • Exhaust smoke puffs & nitro boost flames behind the kart
//   • 3D speed streaks around the camera when moving at top speed
// =====================================================================

interface ParticlesProps {
  kartPosRef: React.MutableRefObject<THREE.Vector3>;
  kartQuatRef: React.MutableRefObject<THREE.Quaternion>;
}

export function Particles({ kartPosRef, kartQuatRef }: ParticlesProps) {
  const isBoosted = useGameStore((s) => s.isBoosted);
  const speedKmh = useGameStore((s) => s.speedKmh);
  const status = useGameStore((s) => s.status);

  // -------------------------------------------------------------------
  // Exhaust Puffs & Nitro Flames (Instanced Mesh)
  // -------------------------------------------------------------------
  const MAX_EXHAUST = 60;
  const exhaustMeshRef = useRef<THREE.InstancedMesh>(null!);
  const exhaustData = useMemo(() => {
    return Array.from({ length: MAX_EXHAUST }, () => ({
      pos: new THREE.Vector3(0, -100, 0),
      vel: new THREE.Vector3(),
      life: 0,
      maxLife: 0.4,
      scale: 0.1,
      color: new THREE.Color(),
    }));
  }, []);

  // -------------------------------------------------------------------
  // Speed Streaks (Instanced Mesh)
  // -------------------------------------------------------------------
  const MAX_STREAKS = 40;
  const streaksMeshRef = useRef<THREE.InstancedMesh>(null!);
  const streaksData = useMemo(() => {
    return Array.from({ length: MAX_STREAKS }, () => ({
      offset: new THREE.Vector3(
        (Math.random() - 0.5) * 16,
        (Math.random() - 0.5) * 8,
        (Math.random() - 0.5) * 20,
      ),
      speed: 30 + Math.random() * 20,
    }));
  }, []);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  const spawnTimerRef = useRef(0);
  const flameColor1 = useMemo(() => new THREE.Color("#ffaa00"), []);
  const flameColor2 = useMemo(() => new THREE.Color("#00e5ff"), []);
  const smokeColor = useMemo(() => new THREE.Color("#dddddd"), []);

  useFrame((_, delta) => {
    if (!exhaustMeshRef.current) return;
    const isRacing = status === "racing";

    // 1. Spawn exhaust particles
    spawnTimerRef.current += delta;
    const spawnRate = isBoosted ? 0.015 : speedKmh > 10 ? 0.04 : 0.12;
    if (isRacing && spawnTimerRef.current >= spawnRate) {
      spawnTimerRef.current = 0;
      // Find dead particle
      const p = exhaustData.find((pt) => pt.life <= 0);
      if (p) {
        // Dual exhaust pipe positions relative to kart
        const pipeX = Math.random() > 0.5 ? -0.55 : 0.55;
        const localOffset = new THREE.Vector3(pipeX, 0.2, -1.35).applyQuaternion(
          kartQuatRef.current,
        );
        p.pos.copy(kartPosRef.current).add(localOffset);

        // Backward velocity
        const backDir = new THREE.Vector3(0, 0, -1)
          .applyQuaternion(kartQuatRef.current)
          .multiplyScalar(isBoosted ? -14 : -4);
        backDir.x += (Math.random() - 0.5) * 1.5;
        backDir.y += Math.random() * 1.5 + 0.5;
        backDir.z += (Math.random() - 0.5) * 1.5;
        p.vel.copy(backDir);

        p.life = 1.0;
        p.maxLife = isBoosted ? 0.35 : 0.55;
        p.scale = isBoosted ? 0.28 : 0.18;
        if (isBoosted) {
          p.color.copy(Math.random() > 0.4 ? flameColor2 : flameColor1);
        } else {
          p.color.copy(smokeColor);
        }
      }
    }

    // 2. Update exhaust particles
    exhaustData.forEach((p, i) => {
      if (p.life > 0) {
        p.life -= delta / p.maxLife;
        p.pos.addScaledVector(p.vel, delta);
        p.vel.multiplyScalar(0.92); // air drag

        const curScale = p.scale * (1 + (1 - p.life) * 1.5) * Math.max(0, p.life);
        dummy.position.copy(p.pos);
        dummy.scale.set(curScale, curScale, curScale);
        dummy.rotation.set(p.life * 4, p.life * 3, 0);
        dummy.updateMatrix();

        exhaustMeshRef.current.setMatrixAt(i, dummy.matrix);
        exhaustMeshRef.current.setColorAt(i, p.color);
      } else {
        dummy.position.set(0, -999, 0);
        dummy.scale.set(0.001, 0.001, 0.001);
        dummy.updateMatrix();
        exhaustMeshRef.current.setMatrixAt(i, dummy.matrix);
      }
    });
    exhaustMeshRef.current.instanceMatrix.needsUpdate = true;
    if (exhaustMeshRef.current.instanceColor) {
      exhaustMeshRef.current.instanceColor.needsUpdate = true;
    }

    // 3. Update speed streaks
    if (streaksMeshRef.current) {
      const showStreaks = isRacing && (speedKmh > 55 || isBoosted);
      streaksMeshRef.current.visible = showStreaks;

      if (showStreaks) {
        streaksData.forEach((s, i) => {
          s.offset.z -= s.speed * (isBoosted ? 1.8 : 1.0) * delta;
          if (s.offset.z < -10) s.offset.z = 12;

          const worldPos = s.offset
            .clone()
            .applyQuaternion(kartQuatRef.current)
            .add(kartPosRef.current);
          dummy.position.copy(worldPos);
          dummy.rotation.setFromQuaternion(kartQuatRef.current);
          dummy.scale.set(0.06, 0.06, isBoosted ? 2.5 : 1.2);
          dummy.updateMatrix();
          streaksMeshRef.current.setMatrixAt(i, dummy.matrix);
        });
        streaksMeshRef.current.instanceMatrix.needsUpdate = true;
      }
    }
  });

  return (
    <>
      {/* Exhaust particles */}
      <instancedMesh
        ref={exhaustMeshRef}
        args={[undefined, undefined, MAX_EXHAUST]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial transparent opacity={0.85} toneMapped={false} />
      </instancedMesh>

      {/* Speed streaks */}
      <instancedMesh
        ref={streaksMeshRef}
        args={[undefined, undefined, MAX_STREAKS]}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.65}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </>
  );
}
