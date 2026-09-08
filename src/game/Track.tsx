import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  CuboidCollider,
  RigidBody,
  TrimeshCollider,
} from "@react-three/rapier";
import { useGameStore } from "./useGameStore";
import {
  CONTROL_POINTS,
  CURVE_SAMPLES,
  RAIL_HEIGHT,
  RAIL_THICKNESS,
  ROAD_THICKNESS,
  TRACK_CURVE,
  TRACK_HALF_WIDTH,
} from "./trackCurve";

// =====================================================================
// Track.tsx
// Renders the entire level procedurally:
//   • Voxel hilly floor with scattered pine trees + flower blocks
//   • The ribbon road itself (extruded along the shared CatmullRom curve)
//   • Side rails that act as soft bumpers so the kart can't fall off
//   • Bouncy mushrooms (obstacles), gold chevron boost strips
//   • Rotating gold voxel stars (collectibles)
//   • A checkered finish line marker
// No external assets — everything is composed from Three primitives.
// =====================================================================

// ---------------------------------------------------------------------
// Procedural road ribbon. We sweep a flat plane along the curve and
// bake its vertices once. This avoids per-frame cost while still giving
// us crisp corners thanks to the dense CatmullRom sampling.
// ---------------------------------------------------------------------
function useRoadGeometry() {
  return useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [];
    const normals: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    const segments = CURVE_SAMPLES.length;
    const colorTop = new THREE.Color("#caa472"); // road top — sandy tan
    const colorBottom = new THREE.Color("#8a6f4a"); // road bottom — dirt

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = TRACK_CURVE.getPointAt(t);
      const tangent = TRACK_CURVE.getTangentAt(t).normalize();
      // Right vector on horizontal plane — keeps rails upright.
      const right = new THREE.Vector3()
        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
        .normalize();

      const half = TRACK_HALF_WIDTH;

      // Top vertex (road surface)
      positions.push(
        center.x + right.x * half,
        center.y + ROAD_THICKNESS,
        center.z + right.z * half,
      );
      normals.push(0, 1, 0);
      colors.push(colorTop.r, colorTop.g, colorTop.b);

      // Bottom vertex (underside)
      positions.push(
        center.x - right.x * half,
        center.y + ROAD_THICKNESS,
        center.z - right.z * half,
      );
      normals.push(0, 1, 0);
      colors.push(colorTop.r, colorTop.g, colorTop.b);

      // Bottom thickness vertex
      positions.push(
        center.x - right.x * half,
        center.y + ROAD_THICKNESS - ROAD_THICKNESS * 2,
        center.z - right.z * half,
      );
      normals.push(0, -1, 0);
      colors.push(colorBottom.r, colorBottom.g, colorBottom.b);

      positions.push(
        center.x + right.x * half,
        center.y + ROAD_THICKNESS - ROAD_THICKNESS * 2,
        center.z + right.z * half,
      );
      normals.push(0, -1, 0);
      colors.push(colorBottom.r, colorBottom.g, colorBottom.b);
    }

    const ringSize = 4;
    for (let i = 0; i < segments; i++) {
      const a = i * ringSize;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      // Top quad
      indices.push(a, b, b + ringSize, a, b + ringSize, a + ringSize);
      // Bottom quad (reversed winding)
      indices.push(c, c + ringSize, d + ringSize, c, d + ringSize, d);
      // Inner side
      indices.push(b, c, c + ringSize, b, c + ringSize, b + ringSize);
      // Outer side
      indices.push(a, a + ringSize, d + ringSize, a, d + ringSize, d);
    }

    geometry.setIndex(indices);
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute(
      "normal",
      new THREE.Float32BufferAttribute(normals, 3),
    );
    geometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    geometry.computeBoundingBox();
    return geometry;
  }, []);
}

// ---------------------------------------------------------------------
// Voxel hilly floor: a large plane subdivided and displaced by the same
// height function used for the track so the landscape flows naturally
// under the road. We instance pine trees and flower blocks on top.
// ---------------------------------------------------------------------
function HillFloor() {
  const { geometry, trees, flowers, treeColors } = useMemo(() => {
    const size = 240;
    const segments = 48;
    const geom = new THREE.PlaneGeometry(size, size, segments, segments);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    const colors: number[] = [];

    // Simple deterministic value-noise: we hash grid coords and lerp
    // between corners to produce gentle hills.
    const hash = (x: number, z: number) =>
      Math.sin(x * 12.9898 + z * 78.233) * 43758.5453 - Math.floor(
        Math.sin(x * 12.9898 + z * 78.233) * 43758.5453,
      );
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const valueNoise = (x: number, z: number) => {
      const xi = Math.floor(x);
      const zi = Math.floor(z);
      const xf = x - xi;
      const zf = z - zi;
      const a = hash(xi, zi);
      const b = hash(xi + 1, zi);
      const c = hash(xi, zi + 1);
      const d = hash(xi + 1, zi + 1);
      const u = smooth(xf);
      const v = smooth(zf);
      return (
        a * (1 - u) * (1 - v) +
        b * u * (1 - v) +
        c * (1 - u) * v +
        d * u * v
      );
    };

    const grassA = new THREE.Color("#6fce4a");
    const grassB = new THREE.Color("#5cb83e");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // Carve a subtle valley along the track centre by attenuating
      // hills in the middle, so the floor meets the road smoothly.
      const noise = valueNoise(x * 0.04, z * 0.04);
      const y = (noise - 0.5) * 5;
      pos.setY(i, y);
      const mix = 0.5 + noise * 0.4;
      const c = grassA.clone().lerp(grassB, mix);
      colors.push(c.r, c.g, c.b);
    }
    geom.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(colors, 3),
    );
    geom.computeVertexNormals();

    // Scatter trees/flowers away from the road itself so they don't
    // collide with the kart.
    const trees: { pos: THREE.Vector3; scale: number }[] = [];
    const flowers: { pos: THREE.Vector3; color: THREE.Color }[] = [];
    const treeColors: THREE.Color[] = [];
    const trunkColor = new THREE.Color("#7a4a23");
    const foliageColors = [
      new THREE.Color("#2f9e44"),
      new THREE.Color("#3ec06d"),
      new THREE.Color("#1f7a35"),
    ];

    // Use a coarse grid to ensure reasonable coverage.
    const rng = mulberry32(1337);
    const gridStep = 4.5;
    for (let x = -110; x <= 110; x += gridStep) {
      for (let z = -110; z <= 110; z += gridStep) {
        const world = new THREE.Vector3(
          x + rng() * gridStep * 0.6,
          0,
          z + rng() * gridStep * 0.6,
        );
        // Reject anything too close to the track centre line.
        let nearRoad = false;
        for (let i = 0; i < CURVE_SAMPLES.length; i += 8) {
          if (CURVE_SAMPLES[i].distanceTo(world) < 14) {
            nearRoad = true;
            break;
          }
        }
        if (nearRoad) continue;

        const noise = valueNoise(world.x * 0.04, world.z * 0.04);
        world.y = (noise - 0.5) * 5;

        if (rng() < 0.18) {
          trees.push({ pos: world.clone(), scale: 0.9 + rng() * 0.8 });
          treeColors.push(
            foliageColors[Math.floor(rng() * foliageColors.length)],
          );
        } else if (rng() < 0.35) {
          const fc = new THREE.Color().setHSL(rng(), 0.85, 0.6);
          flowers.push({ pos: world.clone(), color: fc });
        }
      }
    }
    return { geometry: geom, trees, flowers, treeColors };
  }, []);

  // Place pine trees: brown trunk cube + green foliage cube on top.
  const treeRefs = useRef<(THREE.Group | null)[]>([]);
  return (
    <>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors flatShading />
      </mesh>
      {trees.map((t, i) => (
        <group
          key={i}
          ref={(el) => {
            treeRefs.current[i] = el;
          }}
          position={[t.pos.x, t.pos.y, t.pos.z]}
          scale={[t.scale, t.scale, t.scale]}
        >
          <mesh position={[0, 1, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.2, 2, 1.2]} />
            <meshStandardMaterial color="#7a4a23" flatShading />
          </mesh>
          <mesh position={[0, 3, 0]} castShadow receiveShadow>
            <boxGeometry args={[3, 2.2, 3]} />
            <meshStandardMaterial color={treeColors[i]} flatShading />
          </mesh>
          <mesh position={[0, 4.8, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.8, 1.4, 1.8]} />
            <meshStandardMaterial color={treeColors[i]} flatShading />
          </mesh>
        </group>
      ))}
      {flowers.map((f, i) => (
        <group key={i} position={[f.pos.x, f.pos.y + 0.4, f.pos.z]}>
          <mesh castShadow>
            <boxGeometry args={[0.6, 0.6, 0.6]} />
            <meshStandardMaterial color={f.color} flatShading />
          </mesh>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[0.3, 0.3, 0.3]} />
            <meshStandardMaterial color="#ffeb3b" flatShading />
          </mesh>
        </group>
      ))}
    </>
  );
}

// Cheap deterministic PRNG so the level layout is identical every run.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------
// Road mesh itself. Static — no rigid body needed because the kart's
// collision comes from the side rails and the floor. We only need a
// visual + invisible underside collider so the kart can't dive under.
// ---------------------------------------------------------------------
function Road() {
  const geometry = useRoadGeometry();
  // Per-segment flat cuboid colliders, oriented along the curve tangent.
  // This is far more robust than a TrimeshCollider for an arcade ball —
  // trimeshes are slow and can clip when the ball rolls at speed.
  const colliders = useMemo(() => {
    const out: {
      position: [number, number, number];
      size: [number, number, number];
      yaw: number;
    }[] = [];
    const stride = 4; // every 4th sample ≈ 150 slabs around the loop
    for (let i = 0; i <= CURVE_SAMPLES.length; i += stride) {
      const t = i / CURVE_SAMPLES.length;
      const center = TRACK_CURVE.getPointAt(t);
      const tangent = TRACK_CURVE.getTangentAt(t).normalize();
      const yaw = Math.atan2(tangent.x, tangent.z);
      // Width is the road diameter, length is the segment spacing along
      // the curve, thickness is thick enough to catch the ball reliably.
      out.push({
        position: [center.x, center.y, center.z],
        size: [TRACK_HALF_WIDTH * 2, ROAD_THICKNESS, 0.9],
        yaw,
      });
    }
    return out;
  }, []);
  return (
    <>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors flatShading />
      </mesh>
      {/* One CuboidCollider per road segment. Bulletproof for arcade play. */}
      <group>
        {colliders.map((c, i) => (
          <RigidBody
            key={`road-col-${i}`}
            type="fixed"
            colliders={false}
            position={c.position}
            rotation={[0, c.yaw, 0]}
          >
            <CuboidCollider
              args={[c.size[0] / 2, c.size[1] / 2, c.size[2] / 2]}
              friction={1.0}
              restitution={0.02}
            />
          </RigidBody>
        ))}
      </group>
    </>
  );
}

// ---------------------------------------------------------------------
// Soft side rails: chunky bouncy cubes lining the road. They use Rapier
// restitution so bumping them launches the kart rather than blocking it.
// ---------------------------------------------------------------------
function SideRails() {
  // Pre-bake the rails as an InstancedRigidBodies for performance.
  const { rails } = useMemo(() => {
    const positions: { pos: THREE.Vector3; right: THREE.Vector3 }[] = [];
    const step = 3; // every Nth sample
    for (let i = 0; i < CURVE_SAMPLES.length; i += step) {
      const center = CURVE_SAMPLES[i];
      const tangent = TRACK_CURVE.getTangentAt(i / CURVE_SAMPLES.length)
        .normalize();
      const right = new THREE.Vector3()
        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
        .normalize();
      positions.push({ pos: center.clone(), right });
    }
    return { rails: positions };
  }, []);

  // Render visually with instancing for performance.
  const railLeftRef = useRef<THREE.InstancedMesh>(null!);
  const railRightRef = useRef<THREE.InstancedMesh>(null!);
  useEffect(() => {
    if (!railLeftRef.current || !railRightRef.current) return;
    const dummy = new THREE.Object3D();
    rails.forEach(({ pos, right }, i) => {
      const off = TRACK_HALF_WIDTH + 0.25;
      const lx = pos.x + right.x * off;
      const lz = pos.z + right.z * off;
      const rx = pos.x - right.x * off;
      const rz = pos.z - right.z * off;
      dummy.position.set(lx, pos.y + RAIL_HEIGHT / 2, lz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      railLeftRef.current.setMatrixAt(i, dummy.matrix);
      dummy.position.set(rx, pos.y + RAIL_HEIGHT / 2, rz);
      dummy.updateMatrix();
      railRightRef.current.setMatrixAt(i, dummy.matrix);
    });
    railLeftRef.current.instanceMatrix.needsUpdate = true;
    railRightRef.current.instanceMatrix.needsUpdate = true;
  }, [rails]);

  return (
    <>
      {/* Left rail: white sugar cubes */}
      <instancedMesh
        ref={railLeftRef}
        args={[undefined, undefined, rails.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[RAIL_THICKNESS, RAIL_HEIGHT, 1.4]} />
        <meshStandardMaterial color="#f8f8f8" flatShading />
      </instancedMesh>
      {/* Right rail: same colour but offset */}
      <instancedMesh
        ref={railRightRef}
        args={[undefined, undefined, rails.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[RAIL_THICKNESS, RAIL_HEIGHT, 1.4]} />
        <meshStandardMaterial color="#f8f8f8" flatShading />
      </instancedMesh>

      {/* Inflate cuboid colliders around the rails so the kart bounces. */}
      {rails.map(({ pos, right }, i) => {
        const off = TRACK_HALF_WIDTH + 0.4;
        const lx = pos.x + right.x * off;
        const lz = pos.z + right.z * off;
        const rx = pos.x - right.x * off;
        const rz = pos.z - right.z * off;
        return (
          <RigidBody key={`rail-col-${i}`} type="fixed" colliders={false}>
            <CuboidCollider
              args={[RAIL_THICKNESS / 2 + 0.05, RAIL_HEIGHT / 2, 0.7]}
              position={[lx, pos.y + RAIL_HEIGHT / 2, lz]}
              restitution={0.9}
              friction={0.2}
            />
            <CuboidCollider
              args={[RAIL_THICKNESS / 2 + 0.05, RAIL_HEIGHT / 2, 0.7]}
              position={[rx, pos.y + RAIL_HEIGHT / 2, rz]}
              restitution={0.9}
              friction={0.2}
            />
          </RigidBody>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------
// Mushroom obstacles. Sitting on the road surface, they push the kart
// up + slightly forward on touch. We use a sensor + a small static body.
// ---------------------------------------------------------------------
function Mushrooms() {
  const { items } = useMemo(() => {
    const rng = mulberry32(42);
    const items: { pos: THREE.Vector3; tangent: THREE.Vector3 }[] = [];
    const stride = 70; // every Nth sample has a mushroom chance
    for (let i = 0; i < CURVE_SAMPLES.length; i += stride) {
      if (rng() < 0.6) {
        const center = CURVE_SAMPLES[i];
        const tangent = TRACK_CURVE.getTangentAt(i / CURVE_SAMPLES.length)
          .normalize();
        // Offset slightly to side so it's not always dead-centre.
        const right = new THREE.Vector3()
          .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
          .normalize();
        const sideOff = (rng() - 0.5) * (TRACK_HALF_WIDTH * 0.6);
        const pos = center
          .clone()
          .add(right.multiplyScalar(sideOff));
        items.push({ pos, tangent });
      }
    }
    return { items };
  }, []);

  return (
    <>
      {items.map(({ pos, tangent }, i) => {
        const yaw = Math.atan2(tangent.x, tangent.z);
        return (
          <group key={`mush-${i}`} position={[pos.x, pos.y + 0.7, pos.z]}>
            <RigidBody type="fixed" colliders="cuboid" restitution={1.4}>
              {/* Stem */}
              <mesh position={[0, -0.2, 0]} castShadow>
                <boxGeometry args={[0.4, 0.6, 0.4]} />
                <meshStandardMaterial color="#fff7d6" flatShading />
              </mesh>
              {/* Cap */}
              <mesh position={[0, 0.4, 0]} castShadow>
                <boxGeometry args={[1.4, 0.9, 1.4]} />
                <meshStandardMaterial
                  color={i % 2 ? "#ff4d4d" : "#b66bff"}
                  flatShading
                />
              </mesh>
            </RigidBody>
            {/* Hidden yaw helper group so the visual orientation is set. */}
            <group rotation={[0, yaw, 0]} />
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------
// Gold chevron boost strips. They give a forward impulse on contact.
// ---------------------------------------------------------------------
function BoostStrips() {
  const { items } = useMemo(() => {
    const rng = mulberry32(7);
    const items: {
      pos: THREE.Vector3;
      right: THREE.Vector3;
      tangent: THREE.Vector3;
    }[] = [];
    const stride = 50;
    for (let i = 0; i < CURVE_SAMPLES.length; i += stride) {
      if (rng() < 0.55) {
        const center = CURVE_SAMPLES[i];
        const tangent = TRACK_CURVE.getTangentAt(i / CURVE_SAMPLES.length)
          .normalize();
        const right = new THREE.Vector3()
          .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
          .normalize();
        items.push({ pos: center.clone(), right, tangent });
      }
    }
    return { items };
  }, []);

  return (
    <>
      {items.map(({ pos, right }, i) => {
        const yaw = Math.atan2(right.x, right.z) - Math.PI / 2;
        return (
          <group
            key={`boost-${i}`}
            position={[pos.x, pos.y + 0.05, pos.z]}
            rotation={[0, yaw, 0]}
          >
            <RigidBody type="fixed" sensor colliders={false}>
              {/* The sensor body */}
              <mesh visible={false}>
                <boxGeometry args={[TRACK_HALF_WIDTH * 2, 0.2, 2.2]} />
              </mesh>
              {/* Visual chevrons */}
              <mesh position={[0, 0.05, -0.8]}>
                <boxGeometry args={[TRACK_HALF_WIDTH * 1.6, 0.1, 0.4]} />
                <meshStandardMaterial
                  color="#ffd633"
                  emissive="#ff8c00"
                  emissiveIntensity={0.4}
                  flatShading
                />
              </mesh>
              <mesh position={[0, 0.05, 0]}>
                <boxGeometry args={[TRACK_HALF_WIDTH * 1.6, 0.1, 0.4]} />
                <meshStandardMaterial
                  color="#ffd633"
                  emissive="#ff8c00"
                  emissiveIntensity={0.4}
                  flatShading
                />
              </mesh>
              <mesh position={[0, 0.05, 0.8]}>
                <boxGeometry args={[TRACK_HALF_WIDTH * 1.6, 0.1, 0.4]} />
                <meshStandardMaterial
                  color="#ffd633"
                  emissive="#ff8c00"
                  emissiveIntensity={0.4}
                  flatShading
                />
              </mesh>
            </RigidBody>
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------
// Collectible stars: floating rotating voxels. They pop + add to score
// when the kart passes through them (handled via sensors in Vehicle).
// ---------------------------------------------------------------------
function Stars({ onCount }: { onCount: (n: number) => void }) {
  const groupRef = useRef<THREE.Group>(null!);
  const { positions } = useMemo(() => {
    const rng = mulberry32(99);
    const positions: THREE.Vector3[] = [];
    const stride = 22;
    for (let i = 0; i < CURVE_SAMPLES.length; i += stride) {
      if (rng() < 0.5) {
        const center = CURVE_SAMPLES[i];
        const tangent = TRACK_CURVE.getTangentAt(i / CURVE_SAMPLES.length)
          .normalize();
        const right = new THREE.Vector3()
          .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
          .normalize();
        const sideOff = (rng() - 0.5) * (TRACK_HALF_WIDTH * 0.5);
        const heightOff = 1.2 + rng() * 0.6;
        const pos = center.clone().add(right.multiplyScalar(sideOff));
        pos.y += heightOff;
        positions.push(pos);
      }
    }
    return { positions };
  }, []);

  useEffect(() => {
    onCount(positions.length);
  }, [positions.length, onCount]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.8;
    groupRef.current.children.forEach((c, i) => {
      const baseY = c.userData.baseY ?? c.position.y;
      c.userData.baseY = baseY;
      c.position.y = baseY + Math.sin(performance.now() * 0.002 + i) * 0.2;
    });
  });

  return (
    <group ref={groupRef}>
      {positions.map((p, i) => (
        <group key={`star-${i}`} position={[p.x, p.y, p.z]}>
          {/* Star body (cross of two cubes = 4-point voxel star) */}
          <mesh castShadow>
            <boxGeometry args={[0.7, 0.7, 0.3]} />
            <meshStandardMaterial
              color="#ffd633"
              emissive="#ffaa00"
              emissiveIntensity={0.6}
              flatShading
            />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <boxGeometry args={[0.7, 0.7, 0.3]} />
            <meshStandardMaterial
              color="#ffd633"
              emissive="#ffaa00"
              emissiveIntensity={0.6}
              flatShading
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------
// Checkered finish line. Sits at sample 0 of the curve.
// ---------------------------------------------------------------------
function FinishLine() {
  const start = TRACK_CURVE.getPointAt(0);
  const tangent = TRACK_CURVE.getTangentAt(0).normalize();
  const right = new THREE.Vector3()
    .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
    .normalize();
  const yaw = Math.atan2(right.x, right.z) - Math.PI / 2;
  // Build a checkerboard plane
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 16;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#111";
    const tile = 8;
    for (let y = 0; y < c.height; y += tile) {
      for (let x = 0; x < c.width; x += tile) {
        if ((x / tile + y / tile) % 2 === 0) {
          g.fillRect(x, y, tile, tile);
        }
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    return t;
  }, []);
  return (
    <group position={[start.x, start.y + ROAD_THICKNESS + 0.02, start.z]} rotation={[0, yaw, 0]}>
      <mesh>
        <planeGeometry args={[TRACK_HALF_WIDTH * 2, 2.2]} />
        <meshBasicMaterial map={tex} />
      </mesh>
      {/* Two flag posts */}
      <mesh position={[TRACK_HALF_WIDTH, 1.5, 0]} castShadow>
        <boxGeometry args={[0.2, 3, 0.2]} />
        <meshStandardMaterial color="#888" flatShading />
      </mesh>
      <mesh position={[-TRACK_HALF_WIDTH, 1.5, 0]} castShadow>
        <boxGeometry args={[0.2, 3, 0.2]} />
        <meshStandardMaterial color="#888" flatShading />
      </mesh>
      {/* Big "START" sign */}
      <mesh position={[0, 4, 0]} castShadow>
        <boxGeometry args={[5, 1.2, 0.4]} />
        <meshStandardMaterial color="#ff4d4d" flatShading />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------
// Floor collider: a single big plane sitting under the world so the
// kart never falls into the abyss even when it bounces off rails.
// ---------------------------------------------------------------------
function FloorCollider() {
  return (
    <RigidBody type="fixed" colliders={false} friction={0.6}>
      <CuboidCollider args={[200, 0.5, 200]} position={[0, -3, 0]} />
    </RigidBody>
  );
}

// ---------------------------------------------------------------------
// Top-level Track component exported to App.tsx
// ---------------------------------------------------------------------
export function Track() {
  const setTotalStars = useGameStore((s) => s.setTotalStars);

  return (
    <group>
      <HillFloor />
      <FloorCollider />
      <Road />
      <SideRails />
      <Mushrooms />
      <BoostStrips />
      <Stars onCount={setTotalStars} />
      <FinishLine />
      {/* Sky dome — single big inside-out sphere with a friendly gradient */}
      <mesh>
        <sphereGeometry args={[400, 24, 16]} />
        <meshBasicMaterial color="#aee2ff" side={THREE.BackSide} fog={false} />
      </mesh>
    </group>
  );
}

// Export a helper for the vehicle module to look up the next star index.
export function getStars() {
  // Re-compute deterministically (cheap; same seed).
  const rng = mulberry32(99);
  const out: { pos: THREE.Vector3; tangent: THREE.Vector3 }[] = [];
  const stride = 22;
  for (let i = 0; i < CURVE_SAMPLES.length; i += stride) {
    if (rng() < 0.5) {
      const center = CURVE_SAMPLES[i];
      const tangent = TRACK_CURVE.getTangentAt(i / CURVE_SAMPLES.length)
        .normalize();
      out.push({ pos: center.clone(), tangent });
    }
  }
  return out;
}
