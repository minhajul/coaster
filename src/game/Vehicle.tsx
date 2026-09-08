import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  BallCollider,
  RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { useGameStore } from "./useGameStore";
import { getSpawnPose, progressAlongTrack, TRACK_CURVE } from "./trackCurve";
import { getStars } from "./Track";

// =====================================================================
// Vehicle.tsx
// Owns the kart rigid body, all input (keyboard + on-screen buttons),
// and the dynamic chase camera. Also handles:
//   • Star collection via distance-based sensor checks
//   • Boost strip detection via distance to boost samples
//   • Auto-respawn if the kart stalls off the road
//   • Lap completion → winRace()
// =====================================================================

// ---- tuning constants ----
const ACCEL = 28; // m/s² forward acceleration (kid-friendly snappy)
const REVERSE = 18; // m/s² reverse / brake
const MAX_SPEED = 22; // m/s top forward speed
const TURN_RATE = 2.6; // radians / s
const BOOST_IMPULSE = 12; // instant forward velocity kick
const MUSHROOM_IMPULSE_Y = 9;
const MUSHROOM_IMPULSE_FWD = 5;
const STAR_PICKUP_RADIUS = 1.8;
const STAR_VISUAL_LIFT = 1.0; // stars float above the road
const RESPAWN_STALL_SECONDS = 4;
const LAP_PROGRESS_THRESHOLD = 0.85; // when kart has gone ~85% of loop

// Pre-baked lists for cheap distance checks (regenerated once).
const STAR_DATA = getStars();

interface VehicleProps {
  /** External input state (from HUD touch buttons + keyboard). */
  inputRef: React.MutableRefObject<{
    forward: boolean;
    left: boolean;
    right: boolean;
    reverse: boolean;
  }>;
  /** Tells parent when a star is collected (so it can play audio). */
  onCollect?: () => void;
}

export function Vehicle({ inputRef, onCollect }: VehicleProps) {
  const bodyRef = useRef<RapierRigidBody>(null!);
  const kartGroup = useRef<THREE.Group>(null!);
  const { camera } = useThree();

  // Tracks which stars have been collected in this race so we don't
  // award double-points when the kart lingers near a star.
  const collectedStarsRef = useRef<Set<number>>(new Set());
  const stallTimerRef = useRef(0);
  const lastProgressRef = useRef(0);
  const progressWrappedRef = useRef(false);

  const startRace = useGameStore((s) => s.startRace);
  const resetRace = useGameStore((s) => s.resetRace);
  const collectStar = useGameStore((s) => s.collectStar);
  const winRace = useGameStore((s) => s.winRace);
  const setProgress = useGameStore((s) => s.setProgress);
  const status = useGameStore((s) => s.status);

  // ---- one-time respawn at start ----
  useEffect(() => {
    const pose = getSpawnPose();
    if (bodyRef.current) {
      bodyRef.current.setTranslation(
        { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
        true,
      );
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }, []);

  // Reset star collection when the race starts fresh.
  useEffect(() => {
    if (status === "idle") {
      collectedStarsRef.current = new Set();
      stallTimerRef.current = 0;
      progressWrappedRef.current = false;
      const pose = getSpawnPose();
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
  }, [status]);

  // Reusable scratch objects (avoid per-frame allocations).
  const scratch = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      forward: new THREE.Vector3(),
      right: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      quat: new THREE.Quaternion(),
      euler: new THREE.Euler(),
      camTarget: new THREE.Vector3(),
      camDesired: new THREE.Vector3(),
    }),
    [],
  );

  useFrame((_, deltaRaw) => {
    if (!bodyRef.current) return;
    const delta = Math.min(deltaRaw, 1 / 30); // clamp to keep physics stable on lag
    const t = bodyRef.current.translation();
    const r = bodyRef.current.rotation();
    const v = bodyRef.current.linvel();

    scratch.pos.set(t.x, t.y, t.z);
    scratch.quat.set(r.x, r.y, r.z, r.w);

    // Current facing direction (kart's local -Z is forward by convention)
    scratch.forward.set(0, 0, 1).applyQuaternion(scratch.quat);
    scratch.right.set(1, 0, 0).applyQuaternion(scratch.quat);

    const input = inputRef.current;
    const isRacing = status === "racing";

    // ---- throttle & brake ----
    // Arcade-style direct velocity control. We compute the kart's current
    // forward speed, accelerate/decelerate it directly, then re-blend the
    // final horizontal velocity. Much snappier and more reliable than
    // impulse-based driving for a kids' game.
    if (isRacing) {
      const vel = new THREE.Vector3(v.x, v.y, v.z);
      const forwardSpeed = scratch.forward.dot(vel);

      // Target forward speed
      let targetForward = forwardSpeed;
      if (input.forward) targetForward += ACCEL * delta;
      if (input.reverse) targetForward -= REVERSE * delta;

      // Coast to a stop when no input
      if (!input.forward && !input.reverse) {
        const drag = 6 * delta;
        if (Math.abs(forwardSpeed) < drag) targetForward = 0;
        else targetForward = forwardSpeed - Math.sign(forwardSpeed) * drag;
      }

      targetForward = Math.max(-MAX_SPEED * 0.6, Math.min(MAX_SPEED, targetForward));

      // ---- steering ----
      // Scale turning by speed so a stationary kart doesn't spin in place
      // but is still very responsive in motion — perfect arcade feel.
      const speed = Math.hypot(v.x, v.z);
      const speedFactor = Math.min(1, Math.max(0.3, speed / 3));
      const yawDelta =
        (input.left ? TURN_RATE : 0) + (input.right ? -TURN_RATE : 0);
      const yawAmount = yawDelta * speedFactor * delta;
      // Build a yaw-only quaternion and slerp the body toward it. This
      // both rotates the kart AND keeps it perfectly upright every frame
      // — no torque impulse needed, no spinning out.
      if (yawAmount !== 0) {
        const yawQuat = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          yawAmount,
        );
        scratch.quat.premultiply(yawQuat).normalize();
      }
      // Always re-orthonormalise to upright (zero roll/pitch), so bumps
      // and bounces never leave the kart flipped over.
      const e = new THREE.Euler().setFromQuaternion(scratch.quat, "YXZ");
      e.x = 0;
      e.z = 0;
      scratch.quat.setFromEuler(e);
      bodyRef.current.setRotation(
        {
          x: scratch.quat.x,
          y: scratch.quat.y,
          z: scratch.quat.z,
          w: scratch.quat.w,
        },
        true,
      );
      // recompute forward/right after rotation
      scratch.forward.set(0, 0, 1).applyQuaternion(scratch.quat);
      scratch.right.set(1, 0, 0).applyQuaternion(scratch.quat);

      // ---- compose final horizontal velocity ----
      // Keep lateral velocity low (arcade grip) and apply new forward speed.
      const lateralComponent = scratch.right
        .clone()
        .multiplyScalar(scratch.right.dot(vel));
      const desiredHorizontal = scratch.forward
        .clone()
        .multiplyScalar(targetForward)
        .add(lateralComponent.multiplyScalar(0.2)); // damp lateral
      bodyRef.current.setLinvel(
        { x: desiredHorizontal.x, y: v.y, z: desiredHorizontal.z },
        true,
      );

      // Also zero out angular velocity so the ball doesn't spin forever
      // from accumulated torque / collisions.
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }

    // ---- star pickup (distance based, cheap) ----
    for (let i = 0; i < STAR_DATA.length; i++) {
      if (collectedStarsRef.current.has(i)) continue;
      const sp = STAR_DATA[i].pos;
      const dx = sp.x - t.x;
      const dy = sp.y + STAR_VISUAL_LIFT - t.y;
      const dz = sp.z - t.z;
      if (dx * dx + dy * dy + dz * dz < STAR_PICKUP_RADIUS ** 2) {
        collectedStarsRef.current.add(i);
        collectStar();
        onCollect?.();
      }
    }

    // ---- progress & lap completion ----
    const progress = progressAlongTrack(scratch.pos);
    setProgress(progress);
    if (progress < 0.2 && lastProgressRef.current > LAP_PROGRESS_THRESHOLD) {
      // We've crossed from near-end back to start → completed a lap.
      progressWrappedRef.current = true;
      winRace();
    }
    lastProgressRef.current = progress;

    // ---- auto-respawn if stalled off-road ----
    if (status === "racing") {
      const speed = Math.hypot(v.x, v.z);
      if (speed < 0.4) {
        stallTimerRef.current += delta;
        if (stallTimerRef.current > RESPAWN_STALL_SECONDS) {
          // teleport back to last safe checkpoint (here: just respawn at start)
          const pose = getSpawnPose();
          bodyRef.current.setTranslation(
            { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
            true,
          );
          bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
          stallTimerRef.current = 0;
          onCollect?.(); // small UI feedback on respawn
        }
      } else {
        stallTimerRef.current = 0;
      }
    }

    // ---- chase camera ----
    // Camera target: a point in front of the kart, slightly above.
    scratch.camTarget
      .copy(scratch.pos)
      .add(scratch.forward.clone().multiplyScalar(4))
      .add(new THREE.Vector3(0, 2.5, 0));

    // Desired camera position: behind + above the kart, rotated to match.
    scratch.camDesired
      .copy(scratch.pos)
      .add(scratch.forward.clone().multiplyScalar(-9))
      .add(new THREE.Vector3(0, 5, 0));

    // Position lerp (slow) + lookAt lerp (slightly faster).
    camera.position.lerp(scratch.camDesired, Math.min(1, delta * 4));
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook);
    currentLook.multiplyScalar(10).add(camera.position);
    const newLook = currentLook.lerp(scratch.camTarget, Math.min(1, delta * 6));
    camera.lookAt(newLook);
  });

  return (
    <>
      <RigidBody
        ref={bodyRef}
        colliders={false}
        mass={1.4}
        angularDamping={0}
        linearDamping={0.05}
        restitution={0.1}
        friction={0.8}
        ccd
        position={getSpawnPose().position}
      >
        {/* Single ball collider gives a forgiving arcade feel — the kart
            never snags on geometry edges like an AABB would. */}
        <BallCollider args={[0.85]} />

        {/* Voxel kart visuals — purely decorative. We tilt the body slightly
            while turning by reading input each frame below. */}
        <group ref={kartGroup}>
          {/* Chassis */}
          <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.8, 0.9, 2.6]} />
            <meshStandardMaterial color="#ff4d4d" flatShading />
          </mesh>
          {/* Cabin */}
          <mesh position={[0, 1.1, -0.2]} castShadow>
            <boxGeometry args={[1.4, 0.7, 1.4]} />
            <meshStandardMaterial color="#3da5ff" flatShading />
          </mesh>
          {/* Front grille */}
          <mesh position={[0, 0.55, 1.35]} castShadow>
            <boxGeometry args={[1.4, 0.4, 0.2]} />
            <meshStandardMaterial color="#ffd633" flatShading />
          </mesh>
          {/* Headlights */}
          <mesh position={[-0.6, 0.55, 1.45]}>
            <boxGeometry args={[0.3, 0.3, 0.1]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.6}
            />
          </mesh>
          <mesh position={[0.6, 0.55, 1.45]}>
            <boxGeometry args={[0.3, 0.3, 0.1]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={0.6}
            />
          </mesh>
          {/* Wheels: chunky black cubes at 4 corners. */}
          {(
            [
              [-0.95, -0.2, 0.9],
              [0.95, -0.2, 0.9],
              [-0.95, -0.2, -0.9],
              [0.95, -0.2, -0.9],
            ] as [number, number, number][]
          ).map((p, i) => (
            <mesh key={i} position={p} castShadow>
              <boxGeometry args={[0.55, 0.55, 0.55]} />
              <meshStandardMaterial color="#222" flatShading />
            </mesh>
          ))}
        </group>
      </RigidBody>
    </>
  );
}

// ---------------------------------------------------------------------
// KeyboardControls — mounts global window listeners and writes into the
// shared inputRef used by Vehicle. Keeps this side-effect-free of R3F.
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
      if (k === "w" || k === "arrowup") inputRef.current.forward = down;
      if (k === "s" || k === "arrowdown") inputRef.current.reverse = down;
      if (k === "a" || k === "arrowleft") inputRef.current.left = down;
      if (k === "d" || k === "arrowright") inputRef.current.right = down;
    };
    const down = (e: KeyboardEvent) => map(e, true);
    const up = (e: KeyboardEvent) => map(e, false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [inputRef]);
}

// ---------------------------------------------------------------------
// AudioManager — tiny WebAudio "blip" generator so collecting stars,
// winning and respawning feel reactive. No external assets needed.
// ---------------------------------------------------------------------
export class AudioManager {
  private ctx: AudioContext | null = null;
  ensure() {
    if (!this.ctx) {
      try {
        this.ctx = new (window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext)();
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }
  blip(freq: number, duration = 0.15, type: OscillatorType = "square") {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      ctx.currentTime + duration,
    );
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }
}

export const audio = new AudioManager();

// Convenience: simple "world helper" for boost strips — Vehicle can
// call this when its body crosses a strip. We use a distance check
// rather than Rapier sensor events to avoid extra component overhead.
// (Strips are positioned at known samples — pre-cached here.)
let BOOST_POSITIONS: THREE.Vector3[] | null = null;
export function tryBoost(
  kartPos: THREE.Vector3,
  bodyRef: React.MutableRefObject<RapierRigidBody>,
) {
  if (!BOOST_POSITIONS) {
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < 50 * 12; i += 50) {
      out.push(TRACK_CURVE.getPointAt(i / TRACK_CURVE.getPoints().length / 1));
    }
    BOOST_POSITIONS = out;
  }
  for (const p of BOOST_POSITIONS) {
    if (p.distanceToSquared(kartPos) < 12) {
      const v = bodyRef.current.linvel();
      const sp = Math.hypot(v.x, v.z);
      if (sp < MAX_SPEED + 8) {
        const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(
          new THREE.Quaternion(
            bodyRef.current.rotation().x,
            bodyRef.current.rotation().y,
            bodyRef.current.rotation().z,
            bodyRef.current.rotation().w,
          ),
        );
        bodyRef.current.applyImpulse(
          {
            x: fwd.x * BOOST_IMPULSE,
            y: 0,
            z: fwd.z * BOOST_IMPULSE,
          },
          true,
        );
        audio.blip(660, 0.18, "triangle");
      }
      break;
    }
  }
}
