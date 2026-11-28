import { LoreSpriteRenderer } from "./LoreSpriteRenderer.ts";

/**
 * The companion waiting for your words: the mood of a conversation that has
 * not started yet (#Q4562, the floating chat's empty state).
 *
 * Attentive rather than idle: her lens rests low, on the composer under her,
 * with a slight sway, and the dial turns as near a pointer. Around her orb
 * two thin rings of light turn the opposite ways, each broken into arcs as
 * the dial is, and between them a ring of short ticks rises and falls like a
 * voice level, which is the "listening" a person reads.
 *
 * Nothing is drawn she could not already draw: it is her light, in arcs and
 * strokes like her sonar and her dial, behind the wings and in front of the
 * bloom. The rings arrive after her own entrance so the two do not compete.
 */
export class LoreSpriteListeningRenderer extends LoreSpriteRenderer {
  protected now = 0;

  protected override step(t: number, dt: number): void {
    this.pointer.near = Math.max(this.pointer.near, 0.25);
    super.step(t, dt);
  }

  protected override stepGaze(t: number, dt: number): void {
    // Down at the composer, unless a pointer draws her lens elsewhere.
    if (!this.pointer.active) {
      this.nextGlanceAt = Number.POSITIVE_INFINITY;
      this.gazeTarget.x = (this.noise(t * 0.4, 7) - 0.5) * 0.5;
      this.gazeTarget.y = 0.5 + (this.noise(t * 0.3, 8) - 0.5) * 0.2;
    }
    super.stepGaze(t, dt);
  }

  protected override draw(t: number): void {
    this.now = t;
    super.draw(t);
  }

  protected override drawPings(t: number): void {
    super.drawPings(t);
    const arrive = this.reducedMotion ? 1 : this.clamp((t - 1.3) / 1.4, 0, 1);
    if (arrive <= 0) return;
    const ctx = this.context;
    const strength = arrive * (this.dark ? 1 : 1.2);
    const spin = this.reducedMotion ? 0.6 : t;

    // Two broken rings, turning against each other.
    const rings = [
      { radius: 30, segments: 6, gap: 0.32, speed: 0.35, alpha: 0.34 },
      { radius: 47, segments: 9, gap: 0.45, speed: -0.22, alpha: 0.22 },
    ];
    ctx.lineWidth = 0.6;
    for (const ring of rings) {
      const step = (Math.PI * 2) / ring.segments;
      ctx.strokeStyle = this.ink(ring.alpha * strength);
      for (let i = 0; i < ring.segments; i++) {
        const from = spin * ring.speed + i * step;
        ctx.beginPath();
        ctx.arc(0, 0, ring.radius, from, from + step * (1 - ring.gap));
        ctx.stroke();
      }
    }

    // The level between them: short ticks, each lifted by its own noise and
    // all by one slow swell, brighter where they reach further.
    const ticks = 48;
    const swell = 0.55 + 0.45 * this.noise(this.now * 0.6, 3);
    ctx.lineWidth = 0.7;
    for (let i = 0; i < ticks; i++) {
      const angle = (i / ticks) * Math.PI * 2 - Math.PI / 2;
      const level = this.reducedMotion
        ? 0.4
        : this.noise(this.now * 2.4 + i * 0.37, 11) * swell;
      const inner = 35;
      const outer = inner + 1.5 + level * 7;
      ctx.strokeStyle = this.ink((0.12 + level * 0.4) * strength);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
  }

  protected override drawStill(): void {
    this.position = { x: 0, y: 0 };
    this.gaze = { x: 0, y: 0.5 };
    this.motes = [];
    this.pings = [];
    this.draw(4);
  }
}
