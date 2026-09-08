import * as THREE from "three";

// =====================================================================
// Shared track geometry constants. Both Track.tsx and Vehicle.tsx use
// this so they stay in perfect sync (no floating point drift between
// the visual mesh and the racing line / checkpoints).
// =====================================================================

export const TRACK_HALF_WIDTH = 6; // road ribbon half-width in world units
export const ROAD_THICKNESS = 0.6;
export const RAIL_HEIGHT = 0.6;
export const RAIL_THICKNESS = 0.5;
export const TRACK_SAMPLES = 600; // number of points sampled along the curve

// Build the master closed loop once at module load. We use 14 control
// points so the path has nice rolling hills and sweeping curves without
// ever feeling like an octagon.
function buildControlPoints(): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const count = 14;
  const radius = 60; // overall track footprint radius

  // Pre-compute per-point hills. Mixing sines on different frequencies
  // gives a natural-looking rolling landscape instead of uniform bumps.
  // The road is lifted well above the floor (BASE_Y = 4) so it is
  // always clearly visible from any camera angle.
  const BASE_Y = 4.0;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const angle = t * Math.PI * 2;
    const wobbleX = Math.sin(t * Math.PI * 4) * 14;
    const wobbleZ = Math.cos(t * Math.PI * 3) * 12;
    const x = Math.cos(angle) * (radius + wobbleX);
    const z = Math.sin(angle) * (radius + wobbleZ);
    // Hills: gentle primary wave + tiny secondary ripple.
    const y =
      BASE_Y +
      Math.sin(t * Math.PI * 6) * 3.2 + Math.cos(t * Math.PI * 11) * 1.2;
    pts.push(new THREE.Vector3(x, y, z));
  }
  return pts;
}

export const CONTROL_POINTS = buildControlPoints();

export const TRACK_CURVE = new THREE.CatmullRomCurve3(
  CONTROL_POINTS,
  /* closed */ true,
  /* curveType */ "centripetal",
  /* tension */ 0.5,
);

// Pre-cache a dense sample of the curve so the road mesh and the
// vehicle's checkpoint logic share one source of truth.
export const CURVE_SAMPLES: THREE.Vector3[] = TRACK_CURVE.getSpacedPoints(
  TRACK_SAMPLES,
);

// A normalised parameter 0..1 for "how far around the lap" the kart is.
// We approximate it by projecting onto the closest sampled point.
export function progressAlongTrack(pos: THREE.Vector3): number {
  let bestT = 0;
  let bestDist = Infinity;
  // Coarse-to-fine search: scan every 4th sample first, then refine.
  for (let i = 0; i <= CURVE_SAMPLES.length; i += 4) {
    const p = CURVE_SAMPLES[i % CURVE_SAMPLES.length];
    const d = p.distanceToSquared(pos);
    if (d < bestDist) {
      bestDist = d;
      bestT = i / TRACK_SAMPLES;
    }
  }
  // Refine with neighbours.
  const startIdx = Math.max(0, Math.floor(bestT * TRACK_SAMPLES) - 4);
  const endIdx = Math.min(
    CURVE_SAMPLES.length - 1,
    Math.ceil(bestT * TRACK_SAMPLES) + 4,
  );
  for (let i = startIdx; i <= endIdx; i++) {
    const p = CURVE_SAMPLES[i];
    const d = p.distanceToSquared(pos);
    if (d < bestDist) {
      bestDist = d;
      bestT = i / TRACK_SAMPLES;
    }
  }
  return Math.min(1, Math.max(0, bestT));
}

// Spawn / respawn pose for the kart. Faces the direction of travel.
export function getSpawnPose(): {
  position: [number, number, number];
  rotation: [number, number, number];
} {
  const p0 = TRACK_CURVE.getPointAt(0);
  const p1 = TRACK_CURVE.getPointAt(0.005);
  const forward = new THREE.Vector3().subVectors(p1, p0).normalize();
  const yaw = Math.atan2(forward.x, forward.z); // R3F uses Y-up rotation
  return {
    position: [p0.x, p0.y + 1.8, p0.z],
    rotation: [0, yaw, 0],
  };
}
