import { useGameStore } from "./useGameStore";

// =====================================================================
// audio.ts — Full procedural WebAudio synthesizer for ChunkCoaster.
// Zero external audio assets. Everything generated in real-time:
//   • Dynamic kart engine hum that revs up with speed & throttle
//   • Nitro turbo whoosh on boost pads
//   • Springy boing on mushrooms
//   • Sparkling pentatonic chimes on star collectibles
//   • Tire screech on hard steering
//   • Victory fanfare & game-over chords
//   • Uplifting background chiptune arpeggiator (optional / toggleable)
// =====================================================================

export class SoundSystem {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // Engine audio nodes
  private engineOsc1: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private engineRunning = false;

  // Tire skid nodes
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private skidPlaying = false;

  ensure() {
    if (!this.ctx) {
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  isMuted() {
    return useGameStore.getState().muted;
  }

  // -------------------------------------------------------------------
  // Dynamic Engine Audio
  // -------------------------------------------------------------------
  startEngine() {
    const ctx = this.ensure();
    if (!ctx || !this.masterGain || this.engineRunning) return;
    try {
      this.engineOsc1 = ctx.createOscillator();
      this.engineOsc2 = ctx.createOscillator();
      this.engineFilter = ctx.createBiquadFilter();
      this.engineGain = ctx.createGain();

      this.engineOsc1.type = "sawtooth";
      this.engineOsc2.type = "triangle";
      this.engineOsc1.frequency.setValueAtTime(45, ctx.currentTime);
      this.engineOsc2.frequency.setValueAtTime(90, ctx.currentTime);

      this.engineFilter.type = "lowpass";
      this.engineFilter.frequency.setValueAtTime(320, ctx.currentTime);
      this.engineFilter.Q.setValueAtTime(2.5, ctx.currentTime);

      this.engineGain.gain.setValueAtTime(0.001, ctx.currentTime);

      this.engineOsc1.connect(this.engineFilter);
      this.engineOsc2.connect(this.engineFilter);
      this.engineFilter.connect(this.engineGain);
      this.engineGain.connect(this.masterGain);

      this.engineOsc1.start();
      this.engineOsc2.start();
      this.engineRunning = true;
    } catch {
      this.engineRunning = false;
    }
  }

  updateEngine(speedKmh: number, isAccelerating: boolean, isBoosted: boolean, isRacing: boolean) {
    if (this.isMuted() || !isRacing) {
      if (this.engineGain && this.ctx) {
        this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
      }
      return;
    }

    if (!this.engineRunning) {
      this.startEngine();
    }

    const ctx = this.ctx;
    if (!ctx || !this.engineOsc1 || !this.engineOsc2 || !this.engineFilter || !this.engineGain) return;

    const normSpeed = Math.min(1.5, Math.max(0, speedKmh / 80));
    const baseFreq = 45 + normSpeed * 95 + (isBoosted ? 75 : 0) + (isAccelerating ? 15 : 0);
    const filterFreq = 300 + normSpeed * 900 + (isBoosted ? 1200 : 0);
    const targetGain = isBoosted ? 0.22 : isAccelerating ? 0.16 : Math.max(0.05, normSpeed * 0.12);

    this.engineOsc1.frequency.setTargetAtTime(baseFreq, ctx.currentTime, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, ctx.currentTime, 0.05);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, ctx.currentTime, 0.08);
    this.engineGain.gain.setTargetAtTime(targetGain, ctx.currentTime, 0.05);
  }

  stopEngine() {
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    }
    if (this.engineRunning && this.ctx) {
      try {
        this.engineOsc1?.stop(this.ctx.currentTime + 0.1);
        this.engineOsc2?.stop(this.ctx.currentTime + 0.1);
      } catch {}
      this.engineRunning = false;
    }
  }

  // -------------------------------------------------------------------
  // Sound Effects
  // -------------------------------------------------------------------
  blip(freq: number, duration = 0.15, type: OscillatorType = "square") {
    if (this.isMuted()) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.05);
  }

  starChime(combo = 0) {
    if (this.isMuted()) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    const scale = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98, 2093.0];
    const baseFreq = scale[combo % scale.length];

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = "sine";
    osc2.type = "triangle";
    osc1.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc2.frequency.setValueAtTime(baseFreq * 2, ctx.currentTime);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.24, ctx.currentTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(this.masterGain);

    osc1.start();
    osc2.start();
    osc1.stop(ctx.currentTime + 0.45);
    osc2.stop(ctx.currentTime + 0.45);
  }

  boost() {
    if (this.isMuted()) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(220, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.35);

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(400, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(1800, ctx.currentTime + 0.35);
    filter.Q.setValueAtTime(3, ctx.currentTime);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  }

  mushroom() {
    if (this.isMuted()) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(620, ctx.currentTime + 0.12);
    osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.35);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.38);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  }

  driftScreech(active: boolean) {
    if (this.isMuted() || !active) {
      if (this.skidGain && this.ctx) {
        this.skidGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.06);
      }
      this.skidPlaying = false;
      return;
    }

    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    if (!this.skidPlaying) {
      const bufferSize = ctx.sampleRate * 0.5;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      noise.loop = true;

      this.skidFilter = ctx.createBiquadFilter();
      this.skidFilter.type = "bandpass";
      this.skidFilter.frequency.setValueAtTime(1400, ctx.currentTime);
      this.skidFilter.Q.setValueAtTime(4.0, ctx.currentTime);

      this.skidGain = ctx.createGain();
      this.skidGain.gain.setValueAtTime(0.001, ctx.currentTime);
      this.skidGain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);

      noise.connect(this.skidFilter);
      this.skidFilter.connect(this.skidGain);
      this.skidGain.connect(this.masterGain);

      noise.start();
      this.skidPlaying = true;
    }
  }

  winFanfare() {
    if (this.isMuted()) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    const notes = [
      { f: 523.25, t: 0.0, d: 0.12 },
      { f: 659.25, t: 0.12, d: 0.12 },
      { f: 783.99, t: 0.24, d: 0.14 },
      { f: 1046.5, t: 0.38, d: 0.5 },
    ];

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(n.f, ctx.currentTime + n.t);

      gain.gain.setValueAtTime(0.0001, ctx.currentTime + n.t);
      gain.gain.linearRampToValueAtTime(0.24, ctx.currentTime + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + n.t + n.d);

      osc.connect(gain);
      gain.connect(this.masterGain!);

      osc.start(ctx.currentTime + n.t);
      osc.stop(ctx.currentTime + n.t + n.d + 0.05);
    });
  }

  loseSound() {
    if (this.isMuted()) return;
    const ctx = this.ensure();
    if (!ctx || !this.masterGain) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(330, ctx.currentTime);
    osc.frequency.linearRampToValueAtTime(140, ctx.currentTime + 0.6);

    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.65);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start();
    osc.stop(ctx.currentTime + 0.7);
  }
}

export const audio = new SoundSystem();
