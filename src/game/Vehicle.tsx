import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  RapierRigidBody,
  RigidBody,
  RoundCuboidCollider,
} from "@react-three/rapier";
import { useGameStore } from "./useGameStore";
import {
  getSpawnPose,
  progressAlongTrack,
  ROAD_THICKNESS,
  TRACK_CURVE,
  TRACK_HALF_WIDTH,
} from "./trackCurve";
import {
  BOOST_POSITIONS,
  MUSHROOM_POSITIONS,
  STAR_POSITIONS,
} from "./Track";
import { audio } from "./audio";

export { audio } from "./audio";

// =====================================================================
// Vehicle.tsx
// Owns the kart rigid body, arcade handling, responsive 3D slope
// climbing, dynamic camera (chase / hood / far), animated spinning
// wheels, driver character, particle & sound sync, and item pickups.
// =====================================================================

// ---- handling tuning constants ----
const ACCEL_TIME = 0.45;
const REVERSE_TIME = 0.35;
const MAX_SPEED = 24; // m/s forward top speed (~86 km/h)
const MAX_REVERSE = 12; // m/s reverse top speed
const TURN_RATE = 2.0; // radians / s
const MUSHROOM_HOP_Y = 7.5; // m/s upward hop
const MUSHROOM_RADIUS_SQ = 2.2 * 2.2;
const STAR_PICKUP_RADIUS = 2.6;
const STAR_VISUAL_LIFT = 1.0;
const BOOST_ACCEPT_RADIUS_SQ = 18; // 4.2m radius

interface VehicleProps {
  inputRef: React.MutableRefObject<{
    forward: boolean;
    left: boolean;
    right: boolean;
    reverse: boolean;
  }>;
  onCollect?: (combo: number) => void;
  kartPosRef?: React.MutableRefObject<THREE.Vector3>;
  kartQuatRef?: React.MutableRefObject<THREE.Quaternion>;
  kartYawRef?: React.MutableRefObject<number>;
  collectedStarsRef?: React.MutableRefObject<Set<number>>;
}

export function Vehicle({
  inputRef,
  onCollect,
  kartPosRef,
  kartQuatRef,
  kartYawRef,
  collectedStarsRef,
}: VehicleProps) {
  const bodyRef = useRef<RapierRigidBody>(null!);
  const kartGroup = useRef<THREE.Group>(null!);
  const driverHeadRef = useRef<THREE.Group>(null!);
  const frontLeftWheelRef = useRef<THREE.Group>(null!);
  const frontRightWheelRef = useRef<THREE.Group>(null!);
  const backLeftWheelRef = useRef<THREE.Mesh>(null!);
  const backRightWheelRef = useRef<THREE.Mesh>(null!);

  const { camera } = useThree();
  const perspCamera = camera as THREE.PerspectiveCamera;

  const internalCollectedStarsRef = useRef<Set<number>>(new Set());
  const activeCollectedStars = collectedStarsRef || internalCollectedStarsRef;

  const stallTimerRef = useRef(0);
  const lastProgressRef = useRef(0);
  const consumedBoostsRef = useRef<Set<number>>(new Set());
  const consumedMushroomAtRef = useRef<Map<number, number>>(new Map());
  const boostTimerRef = useRef(0);
  const hopTimerRef = useRef(0);
  const hopVyRef = useRef(0);
  const reachedPreFinishRef = useRef(false);
  const yawRef = useRef(0);
  const progressTickRef = useRef(0);
  const wheelAngleRef = useRef(0);

  const startRace = useGameStore((s) => s.startRace);
  const collectStar = useGameStore((s) => s.collectStar);
  const winRace = useGameStore((s) => s.winRace);
  const setProgress = useGameStore((s) => s.setProgress);
  const setSpeedKmh = useGameStore((s) => s.setSpeedKmh);
  const setIsBoosted = useGameStore((s) => s.setIsBoosted);
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const cameraMode = useGameStore((s) => s.cameraMode);

  // ---- Spawn setup on mount ----
  useEffect(() => {
    const pose = getSpawnPose();
    yawRef.current = pose.rotation[1];
    if (kartYawRef) kartYawRef.current = pose.rotation[1];
    if (bodyRef.current) {
      bodyRef.current.setTranslation(
        { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
        true,
      );
      bodyRef.current.setRotation(
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(...pose.rotation),
        ),
        true,
      );
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, [kartYawRef]);

  // ---- Reset race state ----
  useEffect(() => {
    if (status === "racing") {
      activeCollectedStars.current.clear();
      consumedBoostsRef.current = new Set();
      consumedMushroomAtRef.current = new Map();
      boostTimerRef.current = 0;
      hopTimerRef.current = 0;
      hopVyRef.current = 0;
      stallTimerRef.current = 0;
      lastProgressRef.current = 0;
      reachedPreFinishRef.current = false;
      const pose = getSpawnPose();
      yawRef.current = pose.rotation[1];
      if (kartYawRef) kartYawRef.current = pose.rotation[1];
      if (bodyRef.current) {
        bodyRef.current.setTranslation(
          { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
          true,
        );
        bodyRef.current.setRotation(
          new THREE.Quaternion().setFromEuler(
            new THREE.Euler(...pose.rotation),
          ),
          true,
        );
        bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      }
    }
  }, [status, activeCollectedStars, kartYawRef]);

  // Scratch objects for per-frame math
  const scratch = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      quat: new THREE.Quaternion(),
      camTarget: new THREE.Vector3(),
      camDesired: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, deltaRaw) => {
    if (!bodyRef.current) return;
    const delta = Math.min(deltaRaw, 1 / 30);
    const isRacing = status === "racing" && !paused;

    if (!isRacing) {
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      audio.updateEngine(0, false, false, false);
      return;
    }

    const t = bodyRef.current.translation();
    const r = bodyRef.current.rotation();
    const v = bodyRef.current.linvel();

    scratch.pos.set(t.x, t.y, t.z);
    scratch.quat.set(r.x, r.y, r.z, r.w);

    if (kartPosRef) kartPosRef.current.copy(scratch.pos);
    if (kartQuatRef) kartQuatRef.current.copy(scratch.quat);
    if (kartYawRef) kartYawRef.current = yawRef.current;

    scratch.forward.set(0, 0, 1).applyQuaternion(scratch.quat);
    scratch.right.set(1, 0, 0).applyQuaternion(scratch.quat);

    const input = inputRef.current;

    // ---- Boost timer ----
    if (boostTimerRef.current > 0) {
      boostTimerRef.current -= delta;
    }
    const isBoosted = boostTimerRef.current > 0;
    setIsBoosted(isBoosted);

    // ---- Hop timer & vertical physics ----
    if (hopTimerRef.current > 0) {
      hopTimerRef.current -= delta;
      hopVyRef.current -= 24 * delta;
    }

    // ---- Throttle, speed & slope integration ----
    const progress = progressAlongTrack(scratch.pos);
    const trackTan = TRACK_CURVE.getTangentAt(progress).normalize();
    const trackPt = TRACK_CURVE.getPointAt(progress);
    const roadSurfaceY = trackPt.y + ROAD_THICKNESS;

    const horizVel = new THREE.Vector3(v.x, 0, v.z);
    const forwardSpeed = scratch.forward.dot(horizVel);

    const topSpeed = isBoosted ? MAX_SPEED * 1.55 : MAX_SPEED;
    let targetForward = 0;
    if (input.forward) targetForward = topSpeed;
    if (input.reverse) targetForward = -MAX_REVERSE;

    const tau = targetForward >= 0 ? (isBoosted ? 0.22 : ACCEL_TIME) : REVERSE_TIME;
    const alpha = 1 - Math.exp(-delta / tau);
    const newForwardSpeed = forwardSpeed + (targetForward - forwardSpeed) * alpha;
    const clampedForward = Math.max(
      -MAX_REVERSE,
      Math.min(topSpeed, newForwardSpeed),
    );

    // Steering with speed sensitivity & curve-following assist
    const speedHoriz = Math.hypot(v.x, v.z);
    const speedFactor = Math.min(1, Math.max(0.35, speedHoriz / 3));
    const steerDir = (input.left ? -TURN_RATE : 0) + (input.right ? TURN_RATE : 0);

    if (input.left || input.right) {
      // Manual player steering has total priority
      yawRef.current += steerDir * speedFactor * delta;
    } else if (clampedForward > 1.5) {
      // Gentle curve-following assist when driving forward without active steering
      const trackYaw = Math.atan2(trackTan.x, trackTan.z);
      let diffYaw = trackYaw - yawRef.current;
      while (diffYaw > Math.PI) diffYaw -= Math.PI * 2;
      while (diffYaw < -Math.PI) diffYaw += Math.PI * 2;
      yawRef.current += diffYaw * Math.min(1, delta * 2.8);
    }

    scratch.quat.setFromAxisAngle(scratch.up, yawRef.current);
    bodyRef.current.setRotation(scratch.quat, true);
    scratch.forward.set(0, 0, 1).applyQuaternion(scratch.quat);
    scratch.right.set(1, 0, 0).applyQuaternion(scratch.quat);

    // 3D Slope following along facing vector
    const horizLen = Math.hypot(trackTan.x, trackTan.z);
    const trackSlope = horizLen > 0.001 ? trackTan.y / horizLen : 0;
    const forwardTrackDot =
      (scratch.forward.x * trackTan.x + scratch.forward.z * trackTan.z) /
      (horizLen || 1);
    const slopeAlongFacing = trackSlope * forwardTrackDot;
    const slopeVy = clampedForward * slopeAlongFacing;

    const distAboveRoad = t.y - roadSurfaceY;
    const isGrounded = distAboveRoad <= 0.6 && distAboveRoad >= -0.8;

    let vy = v.y;
    if (hopTimerRef.current > 0) {
      vy = hopVyRef.current;
    } else if (isGrounded) {
      vy = slopeVy - 1.2;
    } else if (t.y < roadSurfaceY - 0.2) {
      vy = Math.max(v.y, 4.0);
    }

    // Composed velocity with grip & slight drift
    const newForwardVel = scratch.forward
      .clone()
      .multiplyScalar(clampedForward);
    const lateralVel = scratch.right
      .clone()
      .multiplyScalar(scratch.right.dot(horizVel) * 0.06);
    const desiredHorizontal = newForwardVel.add(lateralVel);

    // ---- Lateral containment within track borders ----
    const trackRight = new THREE.Vector3()
      .crossVectors(trackTan, new THREE.Vector3(0, 1, 0))
      .normalize();
    const toKart = new THREE.Vector3(
      scratch.pos.x - trackPt.x,
      0,
      scratch.pos.z - trackPt.z,
    );
    const lateralDist = toKart.dot(trackRight);
    const maxLateral = TRACK_HALF_WIDTH - 0.7; // ~5.3m boundary

    if (lateralDist > maxLateral) {
      const excess = lateralDist - maxLateral;
      const outward = desiredHorizontal.dot(trackRight);
      if (outward > 0) {
        desiredHorizontal.sub(trackRight.clone().multiplyScalar(outward));
      }
      const bounce = Math.min(3.5, excess * 4);
      desiredHorizontal.sub(trackRight.clone().multiplyScalar(bounce));
      yawRef.current -= 1.4 * delta;
    } else if (lateralDist < -maxLateral) {
      const excess = -maxLateral - lateralDist;
      const outward = desiredHorizontal.dot(trackRight);
      if (outward < 0) {
        desiredHorizontal.sub(trackRight.clone().multiplyScalar(outward));
      }
      const bounce = Math.min(3.5, excess * 4);
      desiredHorizontal.add(trackRight.clone().multiplyScalar(bounce));
      yawRef.current += 1.4 * delta;
    }

    const currentHorizSpeed = desiredHorizontal.length();
    if (currentHorizSpeed > topSpeed) {
      desiredHorizontal.multiplyScalar(topSpeed / currentHorizSpeed);
    }

    bodyRef.current.setLinvel(
      { x: desiredHorizontal.x, y: vy, z: desiredHorizontal.z },
      true,
    );

    const speedNowKmh = Math.round(speedHoriz * 3.6);
    setSpeedKmh(speedNowKmh);

    // ---- Engine & Skid Audio Sync ----
    const isDrifting = Math.abs(steerDir) > 0.1 && speedNowKmh > 35;
    audio.updateEngine(speedNowKmh, input.forward, isBoosted, isRacing);
    audio.driftScreech(isDrifting);

    // ---- Star Pickups ----
    for (let i = 0; i < STAR_POSITIONS.length; i++) {
      if (activeCollectedStars.current.has(i)) continue;
      const sp = STAR_POSITIONS[i];
      const dx = sp.x - t.x;
      const dy = sp.y + STAR_VISUAL_LIFT - t.y;
      const dz = sp.z - t.z;
      if (dx * dx + dy * dy + dz * dz < STAR_PICKUP_RADIUS ** 2) {
        activeCollectedStars.current.add(i);
        collectStar();
        const curStars = activeCollectedStars.current.size;
        audio.starChime(curStars - 1);
        onCollect?.(curStars);
      }
    }

    // ---- Boost Strip Detection ----
    for (let i = 0; i < BOOST_POSITIONS.length; i++) {
      if (consumedBoostsRef.current.has(i)) continue;
      const bp = BOOST_POSITIONS[i];
      const bdx = bp.x - t.x;
      const bdz = bp.z - t.z;
      if (bdx * bdx + bdz * bdz < BOOST_ACCEPT_RADIUS_SQ) {
        consumedBoostsRef.current.add(i);
        boostTimerRef.current = 1.8;
        hopTimerRef.current = 0.3;
        hopVyRef.current = 4.2;
        audio.boost();
      }
    }

    // ---- Mushroom Bouncy Hop ----
    for (let i = 0; i < MUSHROOM_POSITIONS.length; i++) {
      const mp = MUSHROOM_POSITIONS[i];
      const mdx = mp.x - t.x;
      const mdz = mp.z - t.z;
      if (mdx * mdx + mdz * mdz < MUSHROOM_RADIUS_SQ) {
        const now = performance.now();
        const last = consumedMushroomAtRef.current.get(i) ?? 0;
        if (now - last > 1200) {
          consumedMushroomAtRef.current.set(i, now);
          hopTimerRef.current = 0.65;
          hopVyRef.current = MUSHROOM_HOP_Y;
          audio.mushroom();
        }
      }
    }

    // ---- Lap progress & finish line ----
    progressTickRef.current += delta;
    if (progressTickRef.current >= 0.08) {
      progressTickRef.current = 0;
      setProgress(progress);
    }
    if (progress > 0.85) {
      reachedPreFinishRef.current = true;
    }
    if (
      reachedPreFinishRef.current &&
      progress < 0.12 &&
      lastProgressRef.current > 0.85
    ) {
      reachedPreFinishRef.current = false;
      winRace();
      audio.winFanfare();
    }
    lastProgressRef.current = progress;

    // ---- Auto-respawn safety ----
    const distFromTrack = scratch.pos.distanceTo(trackPt);
    const isFallen = t.y < -1.0 || distFromTrack > TRACK_HALF_WIDTH + 8;
    if (isFallen) {
      stallTimerRef.current += delta;
      if (stallTimerRef.current > 0.8) {
        const trackYaw = Math.atan2(trackTan.x, trackTan.z);
        bodyRef.current.setTranslation(
          { x: trackPt.x, y: roadSurfaceY + 0.6, z: trackPt.z },
          true,
        );
        bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
        bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
        stallTimerRef.current = 0;
        boostTimerRef.current = 0;
        hopTimerRef.current = 0;
        hopVyRef.current = 0;
        yawRef.current = trackYaw;
        audio.blip(180, 0.2, "sine");
      }
    } else {
      stallTimerRef.current = 0;
    }

    // ---- Animated Spinning Wheels & Front Steering ----
    wheelAngleRef.current += clampedForward * delta * 2.8;
    const frontSteer = input.left ? -0.32 : input.right ? 0.32 : 0;

    if (frontLeftWheelRef.current) {
      frontLeftWheelRef.current.rotation.y = frontSteer;
      const mesh = frontLeftWheelRef.current.children[0] as THREE.Mesh;
      if (mesh) mesh.rotation.x = wheelAngleRef.current;
    }
    if (frontRightWheelRef.current) {
      frontRightWheelRef.current.rotation.y = frontSteer;
      const mesh = frontRightWheelRef.current.children[0] as THREE.Mesh;
      if (mesh) mesh.rotation.x = wheelAngleRef.current;
    }
    if (backLeftWheelRef.current) backLeftWheelRef.current.rotation.x = wheelAngleRef.current;
    if (backRightWheelRef.current) backRightWheelRef.current.rotation.x = wheelAngleRef.current;

    // ---- Driver Head Turn ----
    if (driverHeadRef.current) {
      const headTarget = input.left ? -0.25 : input.right ? 0.25 : 0;
      driverHeadRef.current.rotation.y += (headTarget - driverHeadRef.current.rotation.y) * 0.15;
    }

    // ---- Kart Body Tilt (Pitch for hills, Roll for turns) ----
    if (kartGroup.current) {
      const targetPitch = -Math.atan(slopeAlongFacing);
      const targetRoll =
        (input.right ? 0.18 : input.left ? -0.18 : 0) *
        Math.min(1, speedHoriz / 4);

      kartGroup.current.rotation.x +=
        (targetPitch - kartGroup.current.rotation.x) * Math.min(1, delta * 8);
      kartGroup.current.rotation.z +=
        (targetRoll - kartGroup.current.rotation.z) * Math.min(1, delta * 8);
    }

    // ---- Multi-mode Dynamic Camera ----
    const steeringLookAhead = (input.left ? -2.2 : 0) + (input.right ? 2.2 : 0);

    if (cameraMode === "hood") {
      // First-person cockpit bumper view
      scratch.camTarget
        .copy(scratch.pos)
        .add(scratch.forward.clone().multiplyScalar(15))
        .add(new THREE.Vector3(0, 1.1, 0));
      scratch.camDesired
        .copy(scratch.pos)
        .add(scratch.forward.clone().multiplyScalar(0.6))
        .add(new THREE.Vector3(0, 1.25, 0));
    } else if (cameraMode === "far") {
      // High aerial spectator chase view
      scratch.camTarget
        .copy(scratch.pos)
        .add(scratch.forward.clone().multiplyScalar(4))
        .add(new THREE.Vector3(0, 1.5, 0));
      scratch.camDesired
        .copy(scratch.pos)
        .add(scratch.forward.clone().multiplyScalar(-11))
        .add(new THREE.Vector3(0, 6.5, 0));
    } else {
      // Default dynamic chase view
      scratch.camTarget
        .copy(scratch.pos)
        .add(scratch.forward.clone().multiplyScalar(5))
        .add(scratch.right.clone().multiplyScalar(steeringLookAhead))
        .add(new THREE.Vector3(0, 2.0, 0));
      scratch.camDesired
        .copy(scratch.pos)
        .add(scratch.forward.clone().multiplyScalar(-6.5))
        .add(new THREE.Vector3(0, 3.8, 0));
    }

    const camAlpha = 1 - Math.exp(-delta / 0.1);
    camera.position.lerp(scratch.camDesired, camAlpha);

    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook);
    currentLook.multiplyScalar(10).add(camera.position);
    const lookAlpha = 1 - Math.exp(-delta / 0.08);
    const newLook = currentLook.lerp(scratch.camTarget, lookAlpha);
    camera.lookAt(newLook);

    // Speed FOV rush
    const fovTarget =
      (cameraMode === "hood" ? 75 : 60) +
      (isBoosted ? 14 : 0) +
      Math.min(10, speedHoriz * 0.45);
    if (Math.abs(perspCamera.fov - fovTarget) > 0.1) {
      perspCamera.fov += (fovTarget - perspCamera.fov) * Math.min(1, delta * 4);
      perspCamera.updateProjectionMatrix();
    }
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        colliders={false}
        mass={1.4}
        angularDamping={0}
        linearDamping={0.05}
        restitution={0.05}
        friction={0.05}
        ccd
        lockRotations
        position={getSpawnPose().position}
      >
        <RoundCuboidCollider
          args={[0.85, 0.45, 1.15, 0.15]}
          position={[0, 0.05, 0]}
          friction={0.05}
          restitution={0.05}
        />

        <group ref={kartGroup}>
          {/* Chassis (Red Speedster) */}
          <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.8, 0.9, 2.6]} />
            <meshStandardMaterial color="#ff3b30" flatShading />
          </mesh>

          {/* White racing stripe along hood */}
          <mesh position={[0, 0.86, 0.4]} castShadow>
            <boxGeometry args={[0.4, 0.02, 1.8]} />
            <meshStandardMaterial color="#ffffff" flatShading />
          </mesh>

          {/* Cabin & Windshield */}
          <mesh position={[0, 1.1, -0.2]} castShadow>
            <boxGeometry args={[1.4, 0.7, 1.4]} />
            <meshStandardMaterial color="#007aff" flatShading />
          </mesh>
          <mesh position={[0, 1.15, 0.52]} rotation={[-0.2, 0, 0]}>
            <boxGeometry args={[1.2, 0.45, 0.05]} />
            <meshStandardMaterial
              color="#d4f1f9"
              transparent
              opacity={0.8}
              roughness={0.1}
            />
          </mesh>

          {/* Cute Pilot Driver Head */}
          <group ref={driverHeadRef} position={[0, 1.5, -0.2]}>
            {/* Yellow Helmet */}
            <mesh castShadow>
              <boxGeometry args={[0.55, 0.55, 0.55]} />
              <meshStandardMaterial color="#ffd60a" flatShading />
            </mesh>
            {/* Dark Visor */}
            <mesh position={[0, 0.05, 0.29]}>
              <boxGeometry args={[0.45, 0.22, 0.05]} />
              <meshStandardMaterial color="#1c1c1e" roughness={0.1} />
            </mesh>
          </group>

          {/* Front Grille */}
          <mesh position={[0, 0.55, 1.35]} castShadow>
            <boxGeometry args={[1.4, 0.4, 0.2]} />
            <meshStandardMaterial color="#ffd60a" flatShading />
          </mesh>

          {/* Headlights (Glowing) */}
          <mesh position={[-0.6, 0.55, 1.45]}>
            <boxGeometry args={[0.3, 0.3, 0.1]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.8}
            />
          </mesh>
          <mesh position={[0.6, 0.55, 1.45]}>
            <boxGeometry args={[0.3, 0.3, 0.1]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.8}
            />
          </mesh>

          {/* Rear Spoiler Wing */}
          <mesh position={[0, 1.25, -1.25]} castShadow>
            <boxGeometry args={[1.9, 0.12, 0.5]} />
            <meshStandardMaterial color="#ff3b30" flatShading />
          </mesh>
          <mesh position={[-0.7, 0.95, -1.25]} castShadow>
            <boxGeometry args={[0.1, 0.5, 0.2]} />
            <meshStandardMaterial color="#222222" flatShading />
          </mesh>
          <mesh position={[0.7, 0.95, -1.25]} castShadow>
            <boxGeometry args={[0.1, 0.5, 0.2]} />
            <meshStandardMaterial color="#222222" flatShading />
          </mesh>

          {/* Dual Chrome Exhaust Pipes */}
          <mesh position={[-0.55, 0.25, -1.35]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.35, 8]} />
            <meshStandardMaterial color="#8e8e93" metalness={0.8} />
          </mesh>
          <mesh position={[0.55, 0.25, -1.35]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.12, 0.35, 8]} />
            <meshStandardMaterial color="#8e8e93" metalness={0.8} />
          </mesh>

          {/* Taillights */}
          <mesh position={[-0.7, 0.65, -1.32]}>
            <boxGeometry args={[0.3, 0.2, 0.05]} />
            <meshStandardMaterial
              color="#ff453a"
              emissive="#ff453a"
              emissiveIntensity={0.8}
            />
          </mesh>
          <mesh position={[0.7, 0.65, -1.32]}>
            <boxGeometry args={[0.3, 0.2, 0.05]} />
            <meshStandardMaterial
              color="#ff453a"
              emissive="#ff453a"
              emissiveIntensity={0.8}
            />
          </mesh>

          {/* Animated Wheels: Front Left (Steering + Spinning) */}
          <group ref={frontLeftWheelRef} position={[-0.95, -0.2, 0.9]}>
            <mesh castShadow>
              <boxGeometry args={[0.55, 0.55, 0.55]} />
              <meshStandardMaterial color="#1c1c1e" flatShading />
            </mesh>
          </group>

          {/* Front Right */}
          <group ref={frontRightWheelRef} position={[0.95, -0.2, 0.9]}>
            <mesh castShadow>
              <boxGeometry args={[0.55, 0.55, 0.55]} />
              <meshStandardMaterial color="#1c1c1e" flatShading />
            </mesh>
          </group>

          {/* Rear Left (Spinning) */}
          <mesh
            ref={backLeftWheelRef}
            position={[-0.95, -0.2, -0.9]}
            castShadow
          >
            <boxGeometry args={[0.55, 0.55, 0.55]} />
            <meshStandardMaterial color="#1c1c1e" flatShading />
          </mesh>

          {/* Rear Right (Spinning) */}
          <mesh
            ref={backRightWheelRef}
            position={[0.95, -0.2, -0.9]}
            castShadow
          >
            <boxGeometry args={[0.55, 0.55, 0.55]} />
            <meshStandardMaterial color="#1c1c1e" flatShading />
          </mesh>
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------
// KeyboardControls
// ---------------------------------------------------------------------
export function useKeyboardControls(inputRef: React.MutableRefObject<{
  forward: boolean;
  left: boolean;
  right: boolean;
  reverse: boolean;
}>) {
  useEffect(() => {
    const map = (e: KeyboardEvent, down: boolean) => {
      const k = e.key.toLowerCase();
      if (
        k === "arrowup" ||
        k === "arrowdown" ||
        k === "arrowleft" ||
        k === "arrowright" ||
        k === " "
      ) {
        e.preventDefault();
      }
      if (k === "w" || k === "arrowup") inputRef.current.forward = down;
      if (k === "s" || k === "arrowdown") inputRef.current.reverse = down;
      if (k === "a" || k === "arrowleft") inputRef.current.left = down;
      if (k === "d" || k === "arrowright") inputRef.current.right = down;
      if (k === " " && down) {
        // Space acts as brake / reverse
        inputRef.current.reverse = true;
      } else if (k === " " && !down) {
        inputRef.current.reverse = false;
      }
    };
    const down = (e: KeyboardEvent) => map(e, true);
    const up = (e: KeyboardEvent) => map(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };
  }, [inputRef]);
}
