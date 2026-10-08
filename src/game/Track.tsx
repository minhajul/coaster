import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
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
import { mulberry32 } from "./mulberry32";

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
    // Bright Minecraft-style sandstone palette that pops against green
    // grass. Top of the road uses a warm tan with a brighter highlight,
    // sides & underside use a deeper brown so the road has clear volume.
    const colorTopMain = new THREE.Color("#e6c388");
    const colorTopEdge = new THREE.Color("#a47a3e");
    const colorSide = new THREE.Color("#7a5a2f");
    const colorBottom = new THREE.Color("#5a3f1c");

    // Edge lane width (fraction of half-width painted as a darker
    // border so the road reads as a defined ribbon, not a beige blob).
    const edgeLane = TRACK_HALF_WIDTH * 0.18;

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const center = TRACK_CURVE.getPointAt(t);
      const tangent = TRACK_CURVE.getTangentAt(t).normalize();
      // Right vector on horizontal plane — keeps rails upright.
      const right = new THREE.Vector3()
        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
        .normalize();

      const half = TRACK_HALF_WIDTH;

      // Vertex 0: top-outer edge (dark border)
      positions.push(
        center.x + right.x * half,
        center.y + ROAD_THICKNESS,
        center.z + right.z * half,
      );
      normals.push(0, 1, 0);
      colors.push(colorTopEdge.r, colorTopEdge.g, colorTopEdge.b);

      // Vertex 1: top-inner main road surface (sandy tan)
      positions.push(
        center.x + right.x * (half - edgeLane),
        center.y + ROAD_THICKNESS,
        center.z + right.z * (half - edgeLane),
      );
      normals.push(0, 1, 0);
      colors.push(colorTopMain.r, colorTopMain.g, colorTopMain.b);

      // Vertex 2: top-inner other side (sandy tan)
      positions.push(
        center.x - right.x * (half - edgeLane),
        center.y + ROAD_THICKNESS,
        center.z - right.z * (half - edgeLane),
      );
      normals.push(0, 1, 0);
      colors.push(colorTopMain.r, colorTopMain.g, colorTopMain.b);

      // Vertex 3: top-outer edge other side (dark border)
      positions.push(
        center.x - right.x * half,
        center.y + ROAD_THICKNESS,
        center.z - right.z * half,
      );
      normals.push(0, 1, 0);
      colors.push(colorTopEdge.r, colorTopEdge.g, colorTopEdge.b);

      // Vertex 4: bottom-outer edge (side wall — darker brown)
      positions.push(
        center.x - right.x * half,
        center.y - ROAD_THICKNESS,
        center.z - right.z * half,
      );
      normals.push(0, -1, 0);
      colors.push(colorSide.r, colorSide.g, colorSide.b);

      // Vertex 5: bottom-outer other side
      positions.push(
        center.x + right.x * half,
        center.y - ROAD_THICKNESS,
        center.z + right.z * half,
      );
      normals.push(0, -1, 0);
      colors.push(colorBottom.r, colorBottom.g, colorBottom.b);
    }

    const ringSize = 6;
    for (let i = 0; i < segments; i++) {
      const a = i * ringSize;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      const e2 = a + 4;
      const f = a + 5;
      // Top dark-border quad (outer band on each side)
      // Outer edge quad on side +r
      indices.push(a, a + ringSize, b + ringSize, a, b + ringSize, b);
      // Outer edge quad on side -r
      indices.push(d + ringSize, c + ringSize, c, d + ringSize, c, d);
      // Main road top quad (between the dark borders)
      indices.push(b, b + ringSize, c + ringSize, b, c + ringSize, c);
      // Side wall on +r (top edge down to bottom edge)
      indices.push(a, a + ringSize, f + ringSize, a, f + ringSize, f);
      // Side wall on -r
      indices.push(d + ringSize, d, e2, d + ringSize, e2, e2 + ringSize);
      // Bottom (dark)
      indices.push(f, f + ringSize, e2 + ringSize, f, e2 + ringSize, e2);
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
    // Pre-compute floor heights for every curve sample so we can flatten
    // the floor near the road (it must never poke above the road ribbon,
    // which sits at BASE_Y ≈ 4).
    const ROAD_FLOOR_CLEARANCE = 14; // metres
    const sampleMinDist = new Float32Array(pos.count);
    const sampleHeights = new Float32Array(CURVE_SAMPLES.length);
    for (let i = 0; i < CURVE_SAMPLES.length; i++) {
      sampleHeights[i] = CURVE_SAMPLES[i].y;
    }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      let best = Infinity;
      // Sample every 6th point — 100 lookups/vertex is fast.
      for (let j = 0; j < CURVE_SAMPLES.length; j += 6) {
        const p = CURVE_SAMPLES[j];
        const dx = p.x - x;
        const dz = p.z - z;
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
      sampleMinDist[i] = Math.sqrt(best);
    }

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const noise = valueNoise(x * 0.04, z * 0.04);
      // Hills with reduced amplitude (max ±1.5 m) so the road sits clearly
      // above them. Then flatten anything within ROAD_FLOOR_CLEARANCE of
      // the road so it can never poke up through the ribbon.
      const amplitude = Math.max(0, sampleMinDist[i] - ROAD_FLOOR_CLEARANCE) /
        ROAD_FLOOR_CLEARANCE;
      const a = Math.min(1, amplitude);
      const y = (noise - 0.5) * 3 * a;
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
        // Reject anything too close to the track centre line (20m horizontal clearance).
        let nearRoad = false;
        for (let i = 0; i < CURVE_SAMPLES.length; i += 4) {
          const dx = CURVE_SAMPLES[i].x - world.x;
          const dz = CURVE_SAMPLES[i].z - world.z;
          if (dx * dx + dz * dz < 20 * 20) {
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

// ---------------------------------------------------------------------
// Road mesh. Purely visual: the kart rides the spline in Vehicle.tsx.
// ---------------------------------------------------------------------
function Road() {
  const geometry = useRoadGeometry();
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors flatShading />
    </mesh>
  );
}

// ---------------------------------------------------------------------
// Side rails: chunky white cubes lining the road. Visual only; the
// lateral clamp in Vehicle.tsx keeps the kart between them.
// ---------------------------------------------------------------------
function SideRails() {
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
    </>
  );
}

// ---------------------------------------------------------------------
// Mushroom obstacles. Sitting OUTSIDE the rails on the grass, they
// bounce the kart up + forward on touch. Mushrooms are PURELY VISUAL —
// no rigid body — so the bounce is consistent (proximity-based hop
// from Vehicle, never physics contacts).
// ---------------------------------------------------------------------
export const MUSHROOM_POSITIONS: THREE.Vector3[] = (() => {
  const rng = mulberry32(42);
  const out: THREE.Vector3[] = [];
  // Skip the first SKIP_START samples so the kart's spawn zone is
  // obstacle-free — no mushroom hop on the first frame of driving.
  const SKIP_START = 80;
  for (let i = SKIP_START; i < CURVE_SAMPLES.length; i += 60) {
    if (rng() < 0.55) {
      const center = CURVE_SAMPLES[i];
      const tangent = TRACK_CURVE.getTangentAt(i / CURVE_SAMPLES.length)
        .normalize();
      const right = new THREE.Vector3()
        .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
        .normalize();
      // Push mushrooms to the OUTSIDE of the rails so they don't sit
      // in the driving line.
      const side = rng() < 0.5 ? -1 : 1;
      const sideOff = side * (TRACK_HALF_WIDTH + 0.8);
      const pos = center.clone().add(right.multiplyScalar(sideOff));
      out.push(pos);
    }
  }
  return out;
})();

function Mushrooms({ onCount }: { onCount: (n: number) => void }) {
  const consumedRef = useRef<Map<number, number>>(new Map());
  useEffect(() => {
    onCount(MUSHROOM_POSITIONS.length);
    const unsub = useGameStore.subscribe((s) => {
      if (s.status === "racing") consumedRef.current.clear();
    });
    return unsub;
  }, [onCount]);
  return (
    <>
      {MUSHROOM_POSITIONS.map((pos, i) => (
        <MushroomMesh
          key={`mush-${i}`}
          pos={pos}
          index={i}
          consumedRef={consumedRef}
        />
      ))}
    </>
  );
}

function MushroomMesh({
  pos,
  index,
  consumedRef,
}: {
  pos: THREE.Vector3;
  index: number;
  consumedRef: React.MutableRefObject<Map<number, number>>;
}) {
  const ref = useRef<THREE.Group>(null!);
  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 1.2;
    const consumed = consumedRef.current.has(index);
    const target = consumed ? 0 : 1;
    ref.current.scale.x += (target - ref.current.scale.x) * 0.15;
    ref.current.scale.y += (target - ref.current.scale.y) * 0.15;
    ref.current.scale.z += (target - ref.current.scale.z) * 0.15;
    ref.current.visible = ref.current.scale.x > 0.05;
  });
  return (
    <group ref={ref} position={[pos.x, pos.y + 0.7, pos.z]}>
      <mesh position={[0, -0.2, 0]} castShadow>
        <boxGeometry args={[0.4, 0.6, 0.4]} />
        <meshStandardMaterial color="#fff7d6" flatShading />
      </mesh>
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.9, 0.7, 0.9]} />
        <meshStandardMaterial
          color={index % 2 ? "#ff4d4d" : "#b66bff"}
          flatShading
        />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------------------
// Gold chevron boost strips. They give a forward impulse on contact.
// ---------------------------------------------------------------------
// Boost strip positions — exported so Vehicle can use the SAME array
// for distance-based activation. Single source of truth = boost always
// fires when crossing a visible strip.
// ---------------------------------------------------------------------
export const BOOST_POSITIONS: THREE.Vector3[] = (() => {
  const rng = mulberry32(7);
  const out: THREE.Vector3[] = [];
  const stride = 50;
  // Skip the first SKIP_START samples so the kart's spawn zone (around
  // sample 0) is obstacle-free. The kart needs ~1 second of clean road
  // to get up to speed before hitting its first boost/star.
  const SKIP_START = 80;
  for (let i = SKIP_START; i < CURVE_SAMPLES.length; i += stride) {
    if (rng() < 0.55) {
      out.push(TRACK_CURVE.getPointAt(i / CURVE_SAMPLES.length).clone());
    }
  }
  return out;
})();

function BoostStrips() {
  return (
    <>
      {BOOST_POSITIONS.map((pos, i) => {
        const tangent = TRACK_CURVE.getTangentAt(
          // Reverse-engineer t from the array index. This is a known
          // approximation but visually it matches the strip orientation.
          // The position is exact because we cloned from the curve.
          ((i + 1) * 50) / CURVE_SAMPLES.length,
        ).normalize();
        const right = new THREE.Vector3()
          .crossVectors(tangent, new THREE.Vector3(0, 1, 0))
          .normalize();
        const yaw = Math.atan2(right.x, right.z) - Math.PI / 2;
        return (
          <group
            key={`boost-${i}`}
            position={[pos.x, pos.y + 0.05, pos.z]}
            rotation={[0, yaw, 0]}
          >
            <>
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
            </>
          </group>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------
// Collectible stars: floating rotating voxels. Positions are pre-baked
// at module load so Vehicle and Track read from the SAME list and a
// star pickup always corresponds to a visible star.
// ---------------------------------------------------------------------
export const STAR_POSITIONS: THREE.Vector3[] = (() => {
  const rng = mulberry32(99);
  const out: THREE.Vector3[] = [];
  const stride = 22;
  // Skip the first SKIP_START samples so the kart's spawn zone is
  // obstacle-free — no star auto-pickup, no immediate boost ramp.
  const SKIP_START = 80;
  for (let i = SKIP_START; i < CURVE_SAMPLES.length; i += stride) {
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
      out.push(pos);
    }
  }
  return out;
})();

function Stars({ onCount }: { onCount: (n: number) => void }) {
  const groupRef = useRef<THREE.Group>(null!);
  const positions = STAR_POSITIONS;

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
          {/* Halo disc beneath the star to make it visible against the road */}
          <mesh position={[0, -0.6, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.6, 1.1, 16]} />
            <meshBasicMaterial
              color="#ffd633"
              transparent
              opacity={0.55}
              depthWrite={false}
            />
          </mesh>
          {/* Star body (cross of two cubes = 4-point voxel star) — bigger */}
          <mesh castShadow>
            <boxGeometry args={[1.0, 1.0, 0.4]} />
            <meshStandardMaterial
              color="#ffd633"
              emissive="#ffaa00"
              emissiveIntensity={0.7}
              flatShading
            />
          </mesh>
          <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
            <boxGeometry args={[1.0, 1.0, 0.4]} />
            <meshStandardMaterial
              color="#ffd633"
              emissive="#ffaa00"
              emissiveIntensity={0.7}
              flatShading
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------------
// Checkered start/finish line at t=0. The kart spawns a few metres
// past it (see getSpawnPose) so the banner is behind the player at the
// start and each lap ends exactly where the lap check fires (the wrap
// from progress ~1 back to ~0 in Vehicle.tsx).
// ---------------------------------------------------------------------
function FinishLine() {
  const FINISH_T = 0;
  const start = TRACK_CURVE.getPointAt(FINISH_T);
  const tangent = TRACK_CURVE.getTangentAt(FINISH_T).normalize();
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
  // Texture canvas extended with "FINISH" text so the sign has content.
  const texFull = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ff4d4d";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#ffffff";
    g.font = "bold 48px sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("🏁  FINISH  🏁", c.width / 2, c.height / 2);
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.NearestFilter;
    t.magFilter = THREE.NearestFilter;
    return t;
  }, []);

  // Big on-road START arrow at t=0.04 so kids see which way to drive.
  const arrow = TRACK_CURVE.getPointAt(0.04);
  const arrowTan = TRACK_CURVE.getTangentAt(0.04).normalize();
  const arrowYaw = Math.atan2(arrowTan.x, arrowTan.z);

  return (
    <>
      {/* Finish line itself — lifted higher to avoid z-fighting */}
      <group
        position={[start.x, start.y + ROAD_THICKNESS + 0.1, start.z]}
        rotation={[0, yaw, 0]}
      >
        <mesh>
          <planeGeometry args={[TRACK_HALF_WIDTH * 2, 2.2]} />
          <meshBasicMaterial map={tex} polygonOffset polygonOffsetFactor={-1} />
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
        {/* "FINISH" sign */}
        <mesh position={[0, 4, 0]} castShadow>
          <planeGeometry args={[6, 1.4]} />
          <meshBasicMaterial map={texFull} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      </group>

      {/* Huge on-road arrow pointing the direction of travel */}
      <group
        position={[arrow.x, arrow.y + ROAD_THICKNESS + 0.05, arrow.z]}
        rotation={[0, arrowYaw, 0]}
      >
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[2.8, 4, 3]} />
          <meshStandardMaterial
            color="#5cd66b"
            emissive="#3aa050"
            emissiveIntensity={0.5}
            flatShading
            polygonOffset
            polygonOffsetFactor={-2}
          />
        </mesh>
      </group>
    </>
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
      <Road />
      <SideRails />
      <Mushrooms onCount={() => {}} />
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
