import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import {
  CuboidCollider,
  RapierRigidBody,
  RigidBody,
} from "@react-three/rapier";
import { useGameStore } from "./useGameStore";
import { getSpawnPose, progressAlongTrack, TRACK_CURVE } from "./trackCurve";
import {
  BOOST_POSITIONS,
  MUSHROOM_POSITIONS,
  STAR_POSITIONS,
} from "./Track";

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
const TURN_RATE = 1.7; // radians / s — gentle steering for kids
const MUSHROOM_HOP_Y = 6; // m/s upward hop from a mushroom bump
const MUSHROOM_RADIUS_SQ = 1.5 * 1.5; // activation distance from mushroom
const STAR_PICKUP_RADIUS = 2.4;
const STAR_VISUAL_LIFT = 1.0; // stars float above the road
const RESPAWN_STALL_SECONDS = 2.5;
// Finish line lives at the back-half of the lap (opposite the spawn).
// We win when the kart crosses FINISH_T going forward after having
// visited the pre-finish zone (> FINISH_T) earlier in this lap.
// MUST stay in sync with FinishLine in Track.tsx.
const FINISH_T = 0.5;
const PRE_FINISH_T = 0.95; // "kart must have passed this far"

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
  const perspCamera = camera as THREE.PerspectiveCamera;

  // Tracks which stars have been collected in this race so we don't
  // award double-points when the kart lingers near a star.
  const collectedStarsRef = useRef<Set<number>>(new Set());
  const stallTimerRef = useRef(0);
  const lastProgressRef = useRef(0);
  const consumedBoostsRef = useRef<Set<number>>(new Set());
  const consumedMushroomAtRef = useRef<Map<number, number>>(new Map());
  // Whether the kart has reached the pre-finish zone this lap. Set
  // once progress > PRE_FINISH_T, cleared on lap win / new race.
  const reachedPreFinishRef = useRef(false);
  // Throttle HUD progress updates to ~10 Hz so the bar doesn't stutter.
  const progressTickRef = useRef(0);

  const startRace = useGameStore((s) => s.startRace);
  const collectStar = useGameStore((s) => s.collectStar);
  const winRace = useGameStore((s) => s.winRace);
  const setProgress = useGameStore((s) => s.setProgress);
  const status = useGameStore((s) => s.status);
  const paused = useGameStore((s) => s.paused);

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
    // Respawn whenever we transition INTO racing — covers both the
    // initial idle → racing start and the won/lost → racing restart.
    if (status === "racing") {
      collectedStarsRef.current = new Set();
      consumedBoostsRef.current = new Set();
      consumedMushroomAtRef.current = new Map();
      stallTimerRef.current = 0;
      lastProgressRef.current = 0;
      reachedPreFinishRef.current = false;
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
    // Freeze scene updates when not actively racing — modals (start, win,
    // lose), the 3-2-1 countdown, and pause should all keep the kart
    // still so they feel stable.
    if (status !== "racing" || paused) {
      bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
      bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
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
    // forward speed (in XZ plane only — vertical is left to physics),
    // accelerate/decelerate it, then re-apply ONLY along the forward axis.
    // We never zero out the perpendicular component or fully reset the
    // velocity, so downhill momentum and lateral micro-bumps are preserved
    // and the kart can never get "wedged" into a stuck state.
    if (isRacing) {
      // Project velocity onto forward, but only the horizontal component
      // so going up/down hills doesn't bleed the speed reading.
      const horizVel = new THREE.Vector3(v.x, 0, v.z);
      const forwardSpeed = scratch.forward.dot(horizVel);

      // Target forward speed
      let targetForward = forwardSpeed;
      if (input.forward) targetForward += ACCEL * delta;
      if (input.reverse) targetForward -= REVERSE * delta;

      // Mild coast when no input (gentle — never stalls the kart)
      if (!input.forward && !input.reverse) {
        const drag = 2.5 * delta;
        if (Math.abs(forwardSpeed) <= drag) targetForward = 0;
        else targetForward = forwardSpeed - Math.sign(forwardSpeed) * drag;
      }

      targetForward = Math.max(
        -MAX_SPEED * 0.6,
        Math.min(MAX_SPEED, targetForward),
      );

      // ---- steering via angular velocity ----
      // We apply yaw torque via setAngvel.y (NOT setRotation) so that
      // Rapier physics can still process collisions and bounce the kart
      // naturally. We only damp out unintended roll/pitch.
      const speed = Math.hypot(v.x, v.z);
      const speedFactor = Math.min(1, Math.max(0.4, speed / 3));
      const yawAngularVel =
        ((input.left ? TURN_RATE : 0) + (input.right ? -TURN_RATE : 0)) *
        speedFactor;
      // Apply yaw velocity; zero out roll/pitch so the kart stays
      // upright without clobbering Rapier's collision response.
      bodyRef.current.setAngvel(
        { x: 0, y: yawAngularVel, z: 0 },
        true,
      );
      // Read back the resulting yaw so velocity composition uses the
      // kart's CURRENT facing direction (post-Rapier step).
      const updatedR = bodyRef.current.rotation();
      scratch.quat.set(updatedR.x, updatedR.y, updatedR.z, updatedR.w);
      scratch.forward.set(0, 0, 1).applyQuaternion(scratch.quat);
      scratch.right.set(1, 0, 0).applyQuaternion(scratch.quat);

      // Light upright correction — only kicks in if the kart is
      // significantly tilted (e.g. landed upside-down). We use a small
      // torque, not a hard setRotation, so collisions still work.
      const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(scratch.quat);
      const tilt = new THREE.Vector3().crossVectors(localUp, scratch.up);
      if (tilt.lengthSq() > 0.01) {
        bodyRef.current.applyTorqueImpulse(
          { x: tilt.x * 4 * delta, y: 0, z: tilt.z * 4 * delta },
          true,
        );
      }

      // ---- compose final horizontal velocity ----
      // We blend the existing horizontal velocity toward the desired
      // forward velocity along the kart's facing axis. Some lateral is
      // preserved (grip), but most is bled off so the kart can't
      // permanently slide sideways into a stuck state.
      const newForwardVel = scratch.forward
        .clone()
        .multiplyScalar(targetForward);
      // Preserve a small fraction of lateral velocity (kid-friendly drift
      // feel) but never all of it — that would cause permanent slides.
      const lateralVel = scratch.right
        .clone()
        .multiplyScalar(scratch.right.dot(horizVel) * 0.05);
      const desiredHorizontal = newForwardVel.add(lateralVel);
      bodyRef.current.setLinvel(
        { x: desiredHorizontal.x, y: v.y, z: desiredHorizontal.z },
        true,
      );

      // We deliberately do NOT zero out angvel here — Rapier integrates
      // angular velocity across substeps, so setting yaw once per frame
      // (line 195) is enough. Zeroing it would clobber the turn we just
      // applied. Roll/pitch are already corrected by the upright torque
      // impulse above.
    }

    // ---- star pickup (distance based, cheap) ----
    for (let i = 0; i < STAR_POSITIONS.length; i++) {
      if (collectedStarsRef.current.has(i)) continue;
      const sp = STAR_POSITIONS[i];
      const dx = sp.x - t.x;
      const dy = sp.y + STAR_VISUAL_LIFT - t.y;
      const dz = sp.z - t.z;
      if (dx * dx + dy * dy + dz * dz < STAR_PICKUP_RADIUS ** 2) {
        collectedStarsRef.current.add(i);
        collectStar();
        onCollect?.();
      }
    }

    // ---- boost strip pickup (one-shot per strip) ----
    for (let i = 0; i < BOOST_POSITIONS.length; i++) {
      if (consumedBoostsRef.current.has(i)) continue;
      const bp = BOOST_POSITIONS[i];
      const bdx = bp.x - t.x;
      const bdz = bp.z - t.z;
      if (bdx * bdx + bdz * bdz < BOOST_ACCEPT_RADIUS_SQ) {
        consumedBoostsRef.current.add(i);
        // Apply a forward velocity kick + a satisfying upward hop.
        bodyRef.current.setLinvel(
          {
            x: scratch.forward.x * BOOST_FORWARD_BONUS,
            y: BOOST_UP_BONUS,
            z: scratch.forward.z * BOOST_FORWARD_BONUS,
          },
          true,
        );
        audio.blip(660, 0.2, "triangle");
      }
    }

    // ---- mushroom bouncy hop (one-shot per mushroom, short cooldown) ----
    for (let i = 0; i < MUSHROOM_POSITIONS.length; i++) {
      const mp = MUSHROOM_POSITIONS[i];
      const mdx = mp.x - t.x;
      const mdz = mp.z - t.z;
      if (mdx * mdx + mdz * mdz < MUSHROOM_RADIUS_SQ) {
        const now = performance.now();
        const last = consumedMushroomAtRef.current.get(i) ?? 0;
        if (now - last > 1500) {
          consumedMushroomAtRef.current.set(i, now);
          bodyRef.current.setLinvel(
            {
              x: scratch.forward.x * 5,
              y: MUSHROOM_HOP_Y,
              z: scratch.forward.z * 5,
            },
            true,
          );
          audio.blip(440, 0.15, "sine");
        }
      }
    }

    // ---- progress & lap completion ----
    const progress = progressAlongTrack(scratch.pos);
    // Throttle progress updates to ~10 Hz so the HUD bar doesn't
    // stutter fighting CSS transitions at 60 fps.
    progressTickRef.current += delta;
    if (progressTickRef.current >= 0.1) {
      progressTickRef.current = 0;
      setProgress(progress);
    }
    if (
      progress > PRE_FINISH_T &&
      lastProgressRef.current <= PRE_FINISH_T
    ) {
      // Kart just entered the pre-finish zone → it has gone ~95% of
      // the lap. From here, crossing back through FINISH_T wins.
      reachedPreFinishRef.current = true;
    }
    if (
      reachedPreFinishRef.current &&
      progress < FINISH_T &&
      lastProgressRef.current >= FINISH_T
    ) {
      // Kart just crossed the FINISH line going forward after
      // completing the pre-finish stretch. That's a full lap.
      reachedPreFinishRef.current = false;
      winRace();
    }
    lastProgressRef.current = progress;

    // ---- auto-respawn if stalled off-road ----
    // We use horizontal speed AND a "stuck for too long" check. The kart
    // respawns either when it stops moving for a while, or when it leaves
    // the road bounds entirely (e.g. somehow clipped through).
    if (status === "racing") {
      const speed = Math.hypot(v.x, v.z);
      // Off-track check: if kart is way below the road, respawn immediately.
      const isBelowTrack = t.y < 0;
      if (speed < 0.6 || isBelowTrack) {
        stallTimerRef.current += delta;
        if (stallTimerRef.current > RESPAWN_STALL_SECONDS || isBelowTrack) {
          // teleport back to last safe checkpoint (here: just respawn at start)
          const pose = getSpawnPose();
          bodyRef.current.setTranslation(
            { x: pose.position[0], y: pose.position[1], z: pose.position[2] },
            true,
          );
          bodyRef.current.setLinvel({ x: 0, y: 0, z: 0 }, true);
          bodyRef.current.setAngvel({ x: 0, y: 0, z: 0 }, true);
          stallTimerRef.current = 0;
          // Resets the lap-progress tracker so a respawn can't trip a
          // stale "I crossed FINISH" detection on the very next frame.
          reachedPreFinishRef.current = false;
          lastProgressRef.current = 0;
          // Distinct downward blip so the player hears "you got reset"
          // (not the star-collect sound).
          audio.blip(180, 0.18, "sine");
        }
      } else {
        stallTimerRef.current = 0;
      }
    }

    // ---- chase camera ----
    // Closer + faster than before so kids can see the road ahead. We
    // also add a tiny look-ahead bias based on steering so the camera
    // anticipates where the kart is going.
    const steeringLookAhead =
      (input.left ? -2 : 0) + (input.right ? 2 : 0);
    scratch.camTarget
      .copy(scratch.pos)
      .add(scratch.forward.clone().multiplyScalar(5))
      .add(scratch.right.clone().multiplyScalar(steeringLookAhead))
      .add(new THREE.Vector3(0, 2.0, 0));

    // Desired camera position: behind + above the kart, rotated to match.
    scratch.camDesired
      .copy(scratch.pos)
      .add(scratch.forward.clone().multiplyScalar(-6.5))
      .add(new THREE.Vector3(0, 3.8, 0));

    // Position lerp (faster) + lookAt lerp (faster still) for snappy follow.
    camera.position.lerp(scratch.camDesired, Math.min(1, delta * 8));
    const currentLook = new THREE.Vector3();
    camera.getWorldDirection(currentLook);
    currentLook.multiplyScalar(10).add(camera.position);
    const newLook = currentLook.lerp(scratch.camTarget, Math.min(1, delta * 10));
    camera.lookAt(newLook);

    // Speed used by camera FOV punch and body tilt below.
    const speedNow = Math.hypot(v.x, v.z);

    // ---- body tilt for visual feedback ----
    if (kartGroup.current) {
      const tiltTarget =
        (input.right ? -0.18 : input.left ? 0.18 : 0) *
        Math.min(1, speedNow / 4);
      kartGroup.current.rotation.z +=
        (tiltTarget - kartGroup.current.rotation.z) * Math.min(1, delta * 6);
    }

    // ---- FOV punch at high speed ----
    const fovTarget = 60 + Math.min(12, speedNow * 0.5);
    if (Math.abs(perspCamera.fov - fovTarget) > 0.1) {
      perspCamera.fov += (fovTarget - perspCamera.fov) * Math.min(1, delta * 3);
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
        restitution={0.1}
        friction={0.8}
        ccd
        position={getSpawnPose().position}
      >
        {/* Cuboid collider matching the chassis box so the kart sits on
            the road surface (not floating above it). Half-extents are
            chassis/2 (1.0 wide, 0.55 tall, 1.35 long). Offset down by
            -0.05 so the wheels visibly poke out below the body. */}
        <CuboidCollider args={[1.0, 0.55, 1.35]} position={[0, -0.05, 0]} />

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

// ---------------------------------------------------------------------
// Boost strip detection — uses the imported BOOST_POSITIONS array
// (same array that the visuals are rendered from). Per-frame distance
// check, one-shot per strip, with a small upward + forward kick.
// ---------------------------------------------------------------------
const BOOST_ACCEPT_RADIUS_SQ = 16; // 4 m
const BOOST_FORWARD_BONUS = 14; // m/s added to target forward speed
const BOOST_UP_BONUS = 6; // m/s upward kick for satisfying hop
