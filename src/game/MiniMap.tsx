import { useEffect, useRef } from "react";
import { CURVE_SAMPLES, TRACK_CURVE } from "./trackCurve";
import { STAR_POSITIONS } from "./Track";

interface MiniMapProps {
  kartPosRef: React.MutableRefObject<{ x: number; y: number; z: number }>;
  kartYawRef: React.MutableRefObject<number>;
  collectedStarsRef: React.MutableRefObject<Set<number>>;
}

export function MiniMap({
  kartPosRef,
  kartYawRef,
  collectedStarsRef,
}: MiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null!);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;

    // Track bounds for auto-centering
    const size = 150;
    const center = size / 2;
    const scale = 0.85; // fit ~160m track inside 150px canvas

    const render = () => {
      ctx.clearRect(0, 0, size, size);

      // 1. Draw track loop ribbon
      ctx.beginPath();
      for (let i = 0; i <= CURVE_SAMPLES.length; i++) {
        const p = CURVE_SAMPLES[i % CURVE_SAMPLES.length];
        const x = center + (p.x / 170) * (size * scale);
        const y = center + (p.z / 170) * (size * scale);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();

      ctx.strokeStyle = "#e6c388";
      ctx.lineWidth = 5;
      ctx.stroke();

      // 2. Draw Finish Line at t=0.5
      const fin = TRACK_CURVE.getPointAt(0.5);
      const fx = center + (fin.x / 170) * (size * scale);
      const fy = center + (fin.z / 170) * (size * scale);
      ctx.fillStyle = "#ff4444";
      ctx.beginPath();
      ctx.arc(fx, fy, 4, 0, Math.PI * 2);
      ctx.fill();

      // 3. Draw collectible stars
      ctx.fillStyle = "#ffd633";
      for (let i = 0; i < STAR_POSITIONS.length; i++) {
        if (collectedStarsRef.current.has(i)) continue;
        const sp = STAR_POSITIONS[i];
        const sx = center + (sp.x / 170) * (size * scale);
        const sy = center + (sp.z / 170) * (size * scale);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // 4. Draw player kart icon (pulsing arrow)
      const kx = center + (kartPosRef.current.x / 170) * (size * scale);
      const ky = center + (kartPosRef.current.z / 170) * (size * scale);
      const yaw = kartYawRef.current;

      ctx.save();
      ctx.translate(kx, ky);
      ctx.rotate(yaw);

      // Kart glow ring
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 229, 255, 0.35)";
      ctx.fill();

      // Kart arrowhead pointing forward
      ctx.beginPath();
      ctx.moveTo(0, 7);
      ctx.lineTo(5, -5);
      ctx.lineTo(0, -2);
      ctx.lineTo(-5, -5);
      ctx.closePath();
      ctx.fillStyle = "#00e5ff";
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [kartPosRef, kartYawRef, collectedStarsRef]);

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-white/30 bg-black/50 p-1.5 shadow-xl backdrop-blur">
      <div className="absolute left-2 top-1.5 text-[9px] font-bold uppercase tracking-widest text-white/60">
        Radar
      </div>
      <canvas
        ref={canvasRef}
        width={150}
        height={150}
        className="block h-[110px] w-[110px] md:h-[135px] md:w-[135px]"
      />
    </div>
  );
}
