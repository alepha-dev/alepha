import {
  type LoreSpriteOptions,
  LoreSpriteRenderer,
} from "./LoreSpriteRenderer.ts";

/**
 * One mote of the settled ring, by its place on the orbit.
 */
interface LoreSpriteOrbiter {
  angle: number;
  speed: number;
  radius: number;
  size: number;
  pixel: boolean;
  channel: number;
}

/**
 * The companion with nothing left to do: her dust has settled into one tidy
 * orbit around her. The mood of an inbox with nothing waiting in it.
 *
 * Everything else is the base renderer's: she still drifts, beats her wings,
 * glances and trails dust. The ring is the only addition, and it arrives
 * after her own entrance so the two do not compete.
 */
export class LoreSpriteCalmRenderer extends LoreSpriteRenderer {
  protected now = 0;
  protected readonly orbit: LoreSpriteOrbiter[] = [];

  public constructor(canvas: HTMLCanvasElement, options: LoreSpriteOptions) {
    super(canvas, options);
    const count = 26;
    for (let i = 0; i < count; i++) {
      this.orbit.push({
        angle: (i / count) * Math.PI * 2 + Math.random() * 0.2,
        speed: 0.16 + Math.random() * 0.05,
        radius: 60 + (Math.random() - 0.5) * 5,
        size: 0.5 + Math.random() * 0.9,
        pixel: Math.random() < 0.3,
        channel: 40 + i,
      });
    }
  }

  protected override draw(t: number): void {
    this.now = t;
    super.draw(t);
  }

  protected override drawMotes(): void {
    super.drawMotes();
    const t = this.now;
    const settle = this.reducedMotion ? 1 : this.clamp((t - 1.4) / 1.6, 0, 1);
    if (settle <= 0) return;

    const ctx = this.context;
    const center = this.center();
    ctx.save();
    ctx.translate(center.x, center.y + 5);
    ctx.rotate(-0.16 + this.tilt * 0.5);

    // The orbit itself, barely there: what makes the motes read as a ring.
    ctx.strokeStyle = this.ink(0.1 * settle);
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.ellipse(0, 0, 60 * this.zoom, 15 * this.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (const mote of this.orbit) {
      const angle = mote.angle + t * mote.speed;
      const x = Math.cos(angle) * mote.radius * this.zoom;
      const y = Math.sin(angle) * mote.radius * 0.25 * this.zoom;
      // Brighter in front of her than behind: the ring has a depth.
      const depth = 0.55 + 0.45 * Math.sin(angle);
      const twinkle = 0.45 + 0.55 * this.noise(t * 0.7, mote.channel);
      const alpha = settle * depth * twinkle * (this.dark ? 0.85 : 0.6);
      if (mote.pixel) {
        const side = mote.size * 1.3;
        ctx.fillStyle = this.ink(alpha);
        ctx.fillRect(x - side / 2, y - side / 2, side, side);
        continue;
      }
      const radius = mote.size * 2.2;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, this.ink(alpha));
      glow.addColorStop(0.35, this.ink(alpha * 0.45));
      glow.addColorStop(1, this.ink(0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
