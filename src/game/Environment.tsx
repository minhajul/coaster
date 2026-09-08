import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

// =====================================================================
// Environment.tsx — Voxel clouds, rotating windmills, and hot air
// balloons to bring life and charm to the ChunkCoaster world.
// =====================================================================

export function Environment() {
  return (
    <group>
      <Clouds />
      <Windmills />
      <HotAirBalloons />
    </group>
  );
}

// ---------------------------------------------------------------------
// Fluffy voxel clouds floating gently across the sky
// ---------------------------------------------------------------------
function Clouds() {
  const cloudsRef = useRef<THREE.Group>(null!);

  const cloudClusters = useMemo(() => {
    return [
      { pos: [0, 45, -50], scale: 1.4 },
      { pos: [-90, 52, 20], scale: 1.8 },
      { pos: [80, 48, 60], scale: 1.2 },
      { pos: [-60, 55, -90], scale: 1.6 },
      { pos: [70, 50, -80], scale: 1.5 },
      { pos: [110, 42, -20], scale: 1.3 },
    ] as { pos: [number, number, number]; scale: number }[];
  }, []);

  useFrame((_, delta) => {
    if (!cloudsRef.current) return;
    cloudsRef.current.children.forEach((c) => {
      c.position.x += delta * 1.5;
      if (c.position.x > 180) c.position.x = -180;
    });
  });

  return (
    <group ref={cloudsRef}>
      {cloudClusters.map((c, i) => (
        <group key={i} position={c.pos} scale={c.scale}>
          {/* Compound voxel cloud */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[12, 3, 7]} />
            <meshStandardMaterial color="#ffffff" flatShading roughness={1} />
          </mesh>
          <mesh position={[2, 2, 0]}>
            <boxGeometry args={[7, 3.5, 5]} />
            <meshStandardMaterial color="#ffffff" flatShading roughness={1} />
          </mesh>
          <mesh position={[-3, 1, 1]}>
            <boxGeometry args={[6, 2.5, 5]} />
            <meshStandardMaterial color="#ffffff" flatShading roughness={1} />
          </mesh>
          <mesh position={[4, -0.5, -1]}>
            <boxGeometry args={[5, 2, 4]} />
            <meshStandardMaterial color="#ffffff" flatShading roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------
// Voxel Windmills with rotating sails
// ---------------------------------------------------------------------
function Windmills() {
  const sail1Ref = useRef<THREE.Group>(null!);
  const sail2Ref = useRef<THREE.Group>(null!);

  useFrame((_, delta) => {
    if (sail1Ref.current) sail1Ref.current.rotation.z += delta * 1.2;
    if (sail2Ref.current) sail2Ref.current.rotation.z += delta * 1.0;
  });

  return (
    <>
      {/* Windmill 1 */}
      <group position={[-95, 3, -60]}>
        {/* Stone base */}
        <mesh position={[0, 5, 0]} castShadow>
          <boxGeometry args={[5, 10, 5]} />
          <meshStandardMaterial color="#dfd8c8" flatShading />
        </mesh>
        {/* Red roof */}
        <mesh position={[0, 11.5, 0]} castShadow>
          <coneGeometry args={[3.8, 3.5, 4]} />
          <meshStandardMaterial color="#d32f2f" flatShading />
        </mesh>
        {/* Sail hub */}
        <group ref={sail1Ref} position={[0, 9.5, 2.8]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[1, 1, 0.6]} />
            <meshStandardMaterial color="#5d4037" />
          </mesh>
          {/* 4 blades */}
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rot, idx) => (
            <group key={idx} rotation={[0, 0, rot]}>
              <mesh position={[0, 4.5, 0]} castShadow>
                <boxGeometry args={[1.2, 7, 0.2]} />
                <meshStandardMaterial color="#f5f5f5" flatShading />
              </mesh>
            </group>
          ))}
        </group>
      </group>

      {/* Windmill 2 */}
      <group position={[90, 4, -95]}>
        <mesh position={[0, 5, 0]} castShadow>
          <boxGeometry args={[5, 10, 5]} />
          <meshStandardMaterial color="#d7ccc8" flatShading />
        </mesh>
        <mesh position={[0, 11.5, 0]} castShadow>
          <coneGeometry args={[3.8, 3.5, 4]} />
          <meshStandardMaterial color="#1976d2" flatShading />
        </mesh>
        <group ref={sail2Ref} position={[0, 9.5, 2.8]}>
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[1, 1, 0.6]} />
            <meshStandardMaterial color="#5d4037" />
          </mesh>
          {[0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2].map((rot, idx) => (
            <group key={idx} rotation={[0, 0, rot]}>
              <mesh position={[0, 4.5, 0]} castShadow>
                <boxGeometry args={[1.2, 7, 0.2]} />
                <meshStandardMaterial color="#f5f5f5" flatShading />
              </mesh>
            </group>
          ))}
        </group>
      </group>
    </>
  );
}

// ---------------------------------------------------------------------
// Colorful Hot Air Balloons bobbing in the distance
// ---------------------------------------------------------------------
function HotAirBalloons() {
  const balloon1Ref = useRef<THREE.Group>(null!);
  const balloon2Ref = useRef<THREE.Group>(null!);

  useFrame(() => {
    const t = performance.now() * 0.001;
    if (balloon1Ref.current) {
      balloon1Ref.current.position.y = 35 + Math.sin(t * 0.8) * 1.8;
      balloon1Ref.current.rotation.y = Math.sin(t * 0.3) * 0.2;
    }
    if (balloon2Ref.current) {
      balloon2Ref.current.position.y = 42 + Math.cos(t * 0.7) * 2.2;
      balloon2Ref.current.rotation.y = Math.cos(t * 0.4) * 0.2;
    }
  });

  return (
    <>
      {/* Balloon 1: Striped red & yellow */}
      <group ref={balloon1Ref} position={[-80, 35, 80]}>
        <mesh position={[0, 6, 0]} castShadow>
          <boxGeometry args={[5, 7, 5]} />
          <meshStandardMaterial color="#ff5722" flatShading />
        </mesh>
        <mesh position={[0, 6, 0]}>
          <boxGeometry args={[5.2, 4, 5.2]} />
          <meshStandardMaterial color="#ffeb3b" flatShading />
        </mesh>
        {/* Basket */}
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[1.8, 1.4, 1.8]} />
          <meshStandardMaterial color="#795548" flatShading />
        </mesh>
      </group>

      {/* Balloon 2: Cyan & Purple */}
      <group ref={balloon2Ref} position={[75, 42, 105]}>
        <mesh position={[0, 6, 0]} castShadow>
          <boxGeometry args={[4.5, 6.5, 4.5]} />
          <meshStandardMaterial color="#00bcd4" flatShading />
        </mesh>
        <mesh position={[0, 6, 0]}>
          <boxGeometry args={[4.7, 3.5, 4.7]} />
          <meshStandardMaterial color="#ab47bc" flatShading />
        </mesh>
        <mesh position={[0, 0, 0]} castShadow>
          <boxGeometry args={[1.6, 1.2, 1.6]} />
          <meshStandardMaterial color="#795548" flatShading />
        </mesh>
      </group>
    </>
  );
}
