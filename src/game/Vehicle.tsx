import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
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
// Owns the kart, its arcade handling, the dynamic camera (chase / hood /
// far), animated wheels, driver character, particle & sound sync, and
// item pickups.
//
// The kart is driven KINEMATICALLY: every frame we integrate yaw, speed
// and height ourselves and write the transform to a plain group. Rapier
// never touches the kart. Earlier versions used a dynamic rigid body
// and spent many commits fighting it (flipping, sinking, getting pinned
// to the guard rails, losing speed to contact resolution). With the
// track being a known spline the kart has everything it needs: the road
// height, the tangent, and the lateral offset from the centre line.
// =====================================================================

// ---- handling tuning constants ----
const MAX_SPEED = 24; // m/s forward top speed (~86 km/h)
const MAX_REVERSE = 8; // m/s reverse top speed
const BOOST_MULT = 1.4; // top speed multiplier while boosted
const ACCEL_TIME = 0.5; // s, exponential approach to top speed
const BOOST_ACCEL_TIME = 0.2;
const BRAKE_TIME = 0.3; // s, when braking / reversing
const COAST_TIME = 1.8; // s, free-rolling decay with no input
const TURN_RATE = 2.1; // rad/s at full steering lock
const ASSIST_ALIGN = 3.2; // 1/s, how fast the kart lines up with the road
const ASSIST_CENTER = 0.4; // rad, extra steer toward the centre line at the edge
const MAX_LATERAL = TRACK_HALF_WIDTH - 1.15; // keeps the wheels inside the rails
const WALL_SCRAPE = 1.5; // speed loss factor per unit of "into-wall" heading
const REST_HEIGHT = 0.48; // kart origin above the road surface (wheels touch)
const GRAVITY = 24; // m/s², hop gravity (arcade, heavier than real)
const MUSHROOM_HOP_VY = 9.5; // m/s upward hop
const BOOST_HOP_VY = 3.2;
const BOOST_DURATION = 1.6;
const BOOST_COOLDOWN_MS = 3000; // a strip re-arms after this, so it works every lap
const BOOST_FADE_TIME = 1.6; // s, easing back down to normal top speed
const MUSHROOM_RADIUS_SQ = 2.4 * 2.4;
const MUSHROOM_COOLDOWN_MS = 1200;
const STAR_PICKUP_RADIUS = 2.6;
const STAR_VISUAL_LIFT = 1.0;
const BOOST_ACCEPT_RADIUS_SQ = 18; // ~4.2 m radius

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

/** Wrap an angle difference into [-PI, PI]. */
function wrapAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function Vehicle({
  inputRef,
  onCollect,
  kartPosRef,
  kartQuatRef,
  kartYawRef,
  collectedStarsRef,
}: VehicleProps) {
  const rootRef = useRef<THREE.Group>(null!);
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

  // ---- simulation state (plain refs, never React state) ----
  const sim = useRef({
    pos: new THREE.Vector3(),
    yaw: 0,
    speed: 0, // signed, m/s along the kart's facing
    vy: 0,
    airborne: false,
    boostTimer: 0,
    scraping: false,
  });
  const boostHitAtRef = useRef<Map<number, number>>(new Map());
  const consumedMushroomAtRef = useRef<Map<number, number>>(new Map());
  const lastProgressRef = useRef(0);
  const reachedPreFinishRef = useRef(false);
  const progressTickRef = useRef(0);
  const wheelAngleRef = useRef(0);
  const cameraPrimedRef = useRef(false);

  const collectStar = useGameStore((s) => s.collectStar);
  const completeLap = useGameStore((s) => s.completeLap);
  const setProgress = useGameStore((s) => s.setProgress);
  const setSpeedKmh = useGameStore((s) => s.setSpeedKmh);
  const setIsBoosted = useGameStore((s) => s.setIsBoosted);
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const run = useGameStore((s) => s.run);

  // ---- Put the kart on the start line whenever a race is (re)started ----
  useEffect(() => {
    const pose = getSpawnPose();
    const s = sim.current;
    s.pos.set(pose.position[0], pose.position[1] + REST_HEIGHT, pose.position[2]);
    s.yaw = pose.rotation[1];
    s.speed = 0;
    s.vy = 0;
    s.airborne = false;
    s.boostTimer = 0;
    s.scraping = false;
    activeCollectedStars.current.clear();
    boostHitAtRef.current = new Map();
    consumedMushroomAtRef.current = new Map();
    lastProgressRef.current = 0;
    reachedPreFinishRef.current = false;
    if (kartYawRef) kartYawRef.current = s.yaw;
    if (kartPosRef) kartPosRef.current.copy(s.pos);
    if (rootRef.current) {
      rootRef.current.position.copy(s.pos);
      rootRef.current.rotation.set(0, s.yaw, 0);
    }
  }, [run, activeCollectedStars, kartYawRef, kartPosRef]);

  // Scratch objects for per-frame math
  const scratch = useMemo(
    () => ({
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      trackRight: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      quat: new THREE.Quaternion(),
      camTarget: new THREE.Vector3(),
      camDesired: new THREE.Vector3(),
      camLook: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, deltaRaw) => {
    if (!rootRef.current) return;
    // Clamp so a hitch (tab switch, GC pause) can't teleport the kart.
    const delta = Math.min(deltaRaw, 1 / 20);
    const s = sim.current;
    const isRacing = status === "racing" && !paused;
    // After the finish (or time-out) the kart keeps rolling to a stop
    // instead of freezing mid-air.
    const isCoasting = (status === "won" || status === "lost") && !paused;
    const input = inputRef.current;

    // ---- Where are we on the track? ----
    const progress = progressAlongTrack(s.pos);
    const trackTan = TRACK_CURVE.getTangentAt(progress).normalize();
    const trackPt = TRACK_CURVE.getPointAt(progress);
    const roadSurfaceY = trackPt.y + ROAD_THICKNESS;
    const horizLen = Math.hypot(trackTan.x, trackTan.z) || 1;
    const trackYaw = Math.atan2(trackTan.x, trackTan.z);
    // Kart-space "right" of the road direction (matches the kart's own
    // right vector when it faces along the tangent).
    scratch.trackRight.set(trackTan.z / horizLen, 0, -trackTan.x / horizLen);
    scratch.tmp.set(s.pos.x - trackPt.x, 0, s.pos.z - trackPt.z);
    let lateral = scratch.tmp.dot(scratch.trackRight);

    const isBoosted = s.boostTimer > 0;
    const topSpeed = isBoosted ? MAX_SPEED * BOOST_MULT : MAX_SPEED;

    // Road slope along the kart's facing: used for pitch, hood-cam look
    // and to make hops feel the same on a climb as on the flat.
    scratch.forward.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    const trackSlope = trackTan.y / horizLen;
    const forwardTrackDot =
      (scratch.forward.x * trackTan.x + scratch.forward.z * trackTan.z) / horizLen;
    const slopeAlongFacing = trackSlope * forwardTrackDot;
    // Vertical speed of the road surface under a kart moving at s.speed.
    const roadRise = Math.max(0, slopeAlongFacing * s.speed);

    if (isRacing || isCoasting) {
      if (s.boostTimer > 0) s.boostTimer -= delta;

      // ---- Throttle / brake / coast ----
      let target = 0;
      let tau = COAST_TIME;
      if (isRacing && input.forward && !input.reverse) {
        target = topSpeed;
        // Accelerate briskly, but when a boost has just expired let the
        // extra speed bleed off slowly instead of braking to top speed.
        tau = isBoosted
          ? BOOST_ACCEL_TIME
          : s.speed > topSpeed
            ? BOOST_FADE_TIME
            : ACCEL_TIME;
      } else if (isRacing && input.reverse) {
        // Brake hard to a stop first, then back up. Aiming slightly
        // below zero guarantees the exponential approach actually
        // crosses the threshold instead of creeping toward it forever.
        target = s.speed > 1 ? -1 : -MAX_REVERSE;
        tau = BRAKE_TIME;
      } else if (isCoasting) {
        tau = 0.9;
      }
      s.speed += (target - s.speed) * (1 - Math.exp(-delta / tau));
      if (Math.abs(s.speed) < 0.02 && target === 0) s.speed = 0;

      // ---- Steering ----
      const steerDir =
        (isRacing && input.left ? -1 : 0) + (isRacing && input.right ? 1 : 0);
      const speedFactor = Math.min(1, Math.max(0.35, Math.abs(s.speed) / 3));
      if (steerDir !== 0) {
        // Player steering always wins. Reversing flips the steer
        // direction like a real car.
        const dir = s.speed < -0.5 ? -steerDir : steerDir;
        s.yaw += dir * TURN_RATE * speedFactor * delta;
      } else if (s.speed > 1.5) {
        // Hands-off assist: line up with the road and drift back toward
        // the centre. Strong enough that a 5-year-old can hold "go" and
        // make it round, weak enough that steering still matters.
        const centre = Math.max(-1, Math.min(1, lateral / MAX_LATERAL));
        const desiredYaw = trackYaw - centre * ASSIST_CENTER;
        s.yaw += wrapAngle(desiredYaw - s.yaw) * Math.min(1, ASSIST_ALIGN * delta);
      }
      s.yaw = wrapAngle(s.yaw);

      // ---- Move along the facing ----
      scratch.forward.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
      s.pos.x += scratch.forward.x * s.speed * delta;
      s.pos.z += scratch.forward.z * s.speed * delta;

      // ---- Guard rails: hard lateral clamp + scrape ----
      scratch.tmp.set(s.pos.x - trackPt.x, 0, s.pos.z - trackPt.z);
      lateral = scratch.tmp.dot(scratch.trackRight);
      const side = Math.sign(lateral);
      const over = Math.abs(lateral) - MAX_LATERAL;
      if (over > 0) {
        s.pos.x -= scratch.trackRight.x * side * over;
        s.pos.z -= scratch.trackRight.z * side * over;
        lateral = side * MAX_LATERAL;
        // How hard are we heading into the wall? 0 = parallel, 1 = head on.
        const into = Math.max(0, side * scratch.forward.dot(scratch.trackRight) * Math.sign(s.speed || 1));
        s.speed *= Math.exp(-delta * WALL_SCRAPE * into);
        // Nudge the nose back toward the road.
        const kick = (0.6 + 2.5 * into) * delta * (s.speed < 0 ? -1 : 1);
        s.yaw = wrapAngle(s.yaw - side * kick);
        s.scraping = into > 0.08 && Math.abs(s.speed) > 2;
      } else {
        s.scraping = false;
      }

      // ---- Height: ride the road, or fly during a hop ----
      const groundY = roadSurfaceY + REST_HEIGHT;
      if (s.airborne) {
        s.vy -= GRAVITY * delta;
        s.pos.y += s.vy * delta;
        if (s.pos.y <= groundY) {
          s.pos.y = groundY;
          s.vy = 0;
          s.airborne = false;
          audio.blip(140, 0.08, "triangle");
        }
      } else {
        // Snap to the road with a touch of smoothing so crests feel soft.
        s.pos.y += (groundY - s.pos.y) * Math.min(1, delta * 18);
      }
    }

    // ---- Publish transform ----
    scratch.forward.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    scratch.right.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    scratch.quat.setFromAxisAngle(scratch.up, s.yaw);
    rootRef.current.position.copy(s.pos);
    rootRef.current.rotation.set(0, s.yaw, 0);
    if (kartPosRef) kartPosRef.current.copy(s.pos);
    if (kartQuatRef) kartQuatRef.current.copy(scratch.quat);
    if (kartYawRef) kartYawRef.current = s.yaw;

    const speedKmh = Math.round(Math.abs(s.speed) * 3.6);
    setSpeedKmh(speedKmh);
    setIsBoosted(isBoosted);

    // ---- Engine & skid audio ----
    const steering = isRacing && (input.left || input.right);
    audio.updateEngine(speedKmh, isRacing && input.forward, isBoosted, isRacing || isCoasting);
    audio.driftScreech((steering && speedKmh > 35) || s.scraping);

    if (isRacing) {
      // ---- Star pickups ----
      for (let i = 0; i < STAR_POSITIONS.length; i++) {
        if (activeCollectedStars.current.has(i)) continue;
        const sp = STAR_POSITIONS[i];
        const dx = sp.x - s.pos.x;
        const dy = sp.y + STAR_VISUAL_LIFT - (s.pos.y + 0.6);
        const dz = sp.z - s.pos.z;
        if (dx * dx + dy * dy + dz * dz < STAR_PICKUP_RADIUS ** 2) {
          activeCollectedStars.current.add(i);
          collectStar();
          const curStars = activeCollectedStars.current.size;
          audio.starChime(curStars - 1);
          onCollect?.(curStars);
        }
      }

      // ---- Boost strips ----
      for (let i = 0; i < BOOST_POSITIONS.length; i++) {
        const bp = BOOST_POSITIONS[i];
        const bdx = bp.x - s.pos.x;
        const bdz = bp.z - s.pos.z;
        if (bdx * bdx + bdz * bdz < BOOST_ACCEPT_RADIUS_SQ && !s.airborne) {
          const now = performance.now();
          if (now - (boostHitAtRef.current.get(i) ?? 0) < BOOST_COOLDOWN_MS) continue;
          boostHitAtRef.current.set(i, now);
          s.boostTimer = BOOST_DURATION;
          s.speed = Math.max(s.speed, MAX_SPEED * 0.9);
          s.airborne = true;
          s.vy = BOOST_HOP_VY + roadRise;
          audio.boost();
        }
      }

      // ---- Mushroom bouncy hop ----
      for (let i = 0; i < MUSHROOM_POSITIONS.length; i++) {
        const mp = MUSHROOM_POSITIONS[i];
        const mdx = mp.x - s.pos.x;
        const mdz = mp.z - s.pos.z;
        if (mdx * mdx + mdz * mdz < MUSHROOM_RADIUS_SQ) {
          const now = performance.now();
          const last = consumedMushroomAtRef.current.get(i) ?? 0;
          if (now - last > MUSHROOM_COOLDOWN_MS) {
            consumedMushroomAtRef.current.set(i, now);
            s.airborne = true;
            s.vy = MUSHROOM_HOP_VY + roadRise;
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
      if (progress > 0.85) reachedPreFinishRef.current = true;
      if (
        reachedPreFinishRef.current &&
        progress < 0.12 &&
        lastProgressRef.current > 0.85
      ) {
        reachedPreFinishRef.current = false;
        completeLap();
      }
      lastProgressRef.current = progress;
    }


    // ---- Animated spinning wheels & front steering ----
    wheelAngleRef.current += s.speed * delta * 2.8;
    const frontSteer = isRacing ? (input.left ? -0.32 : input.right ? 0.32 : 0) : 0;
    const spinWheel = (g: THREE.Group | null, steer: number) => {
      if (!g) return;
      g.rotation.y += (steer - g.rotation.y) * Math.min(1, delta * 14);
      const mesh = g.children[0] as THREE.Mesh | undefined;
      if (mesh) mesh.rotation.x = wheelAngleRef.current;
    };
    spinWheel(frontLeftWheelRef.current, frontSteer);
    spinWheel(frontRightWheelRef.current, frontSteer);
    if (backLeftWheelRef.current) backLeftWheelRef.current.rotation.x = wheelAngleRef.current;
    if (backRightWheelRef.current) backRightWheelRef.current.rotation.x = wheelAngleRef.current;

    // ---- Driver head turn ----
    if (driverHeadRef.current) {
      const headTarget = frontSteer * 0.8;
      driverHeadRef.current.rotation.y +=
        (headTarget - driverHeadRef.current.rotation.y) * Math.min(1, delta * 10);
    }

    // ---- Kart body tilt (pitch for hills, roll for turns, nose-up in air) ----
    if (kartGroup.current) {
      const airPitch = s.airborne ? -Math.max(-0.35, Math.min(0.35, s.vy * 0.04)) : 0;
      const targetPitch = -Math.atan(slopeAlongFacing) + airPitch;
      const targetRoll = (frontSteer / 0.32) * 0.16 * Math.min(1, Math.abs(s.speed) / 4);
      kartGroup.current.rotation.x +=
        (targetPitch - kartGroup.current.rotation.x) * Math.min(1, delta * 8);
      kartGroup.current.rotation.z +=
        (targetRoll - kartGroup.current.rotation.z) * Math.min(1, delta * 8);
    }

    // ---- Multi-mode dynamic camera (runs in every game state) ----
    const steeringLookAhead = isRacing
      ? (input.left ? -2.2 : 0) + (input.right ? 2.2 : 0)
      : 0;

    if (cameraMode === "hood") {
      // Bumper cam: sits just ahead of the nose so no kart geometry
      // blocks the road. Looks along the slope so hills stay in view.
      scratch.camTarget
        .copy(s.pos)
        .addScaledVector(scratch.forward, 16)
        .add(scratch.tmp.set(0, 0.9 + slopeAlongFacing * 16, 0));
      scratch.camDesired
        .copy(s.pos)
        .addScaledVector(scratch.forward, 1.75)
        .add(scratch.tmp.set(0, 1.0, 0));
    } else if (cameraMode === "far") {
      scratch.camTarget
        .copy(s.pos)
        .addScaledVector(scratch.forward, 4)
        .add(scratch.tmp.set(0, 1.5, 0));
      scratch.camDesired
        .copy(s.pos)
        .addScaledVector(scratch.forward, -11)
        .add(scratch.tmp.set(0, 6.5, 0));
    } else {
      scratch.camTarget
        .copy(s.pos)
        .addScaledVector(scratch.forward, 5)
        .addScaledVector(scratch.right, steeringLookAhead)
        .add(scratch.tmp.set(0, 2.0, 0));
      scratch.camDesired
        .copy(s.pos)
        .addScaledVector(scratch.forward, -6.5)
        .add(scratch.tmp.set(0, 3.8, 0));
    }

    if (!cameraPrimedRef.current) {
      // First frame: jump straight into place instead of flying in from
      // the default camera position.
      cameraPrimedRef.current = true;
      camera.position.copy(scratch.camDesired);
      camera.lookAt(scratch.camTarget);
      scratch.camLook.copy(scratch.camTarget);
    }

    const camAlpha = 1 - Math.exp(-delta / (cameraMode === "hood" ? 0.04 : 0.1));
    camera.position.lerp(scratch.camDesired, camAlpha);
    const lookAlpha = 1 - Math.exp(-delta / 0.08);
    scratch.camLook.lerp(scratch.camTarget, lookAlpha);
    camera.lookAt(scratch.camLook);

    // Speed FOV rush
    const fovTarget =
      (cameraMode === "hood" ? 75 : 60) +
      (isBoosted ? 14 : 0) +
      Math.min(10, Math.abs(s.speed) * 0.45);
    if (Math.abs(perspCamera.fov - fovTarget) > 0.1) {
      perspCamera.fov += (fovTarget - perspCamera.fov) * Math.min(1, delta * 4);
      perspCamera.updateProjectionMatrix();
    }
  });

  return (
    <>
      <group ref={rootRef} position={getSpawnPose().position}>
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
      </group>
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
