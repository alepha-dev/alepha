import {
  LoreSpriteRenderer,
  type LoreSpriteWing,
} from "./LoreSpriteRenderer.ts";

/**
 * The companion when something broke: her left upper wing is down, its
 * membrane flickering over the bare circuit traces, the frame tears in short
 * bursts, and her lens is red. The mood of an error page.
 *
 * The red is the one colour in a figure that is otherwise ink on paper or
 * light on dark, which is what lets it say "error" before the title does.
 * Reduced motion keeps the pose and the lens, and drops the tear and the
 * flicker.
 */
export class LoreSpriteGlitchRenderer extends LoreSpriteRenderer {
  protected burstUntil = 0;
  protected nextBurstAt = 2.2;
  protected readonly buffer = document.createElement("canvas");

  protected override step(t: number, dt: number): void {
    this.pointer.near = 0.3;
    super.step(t, dt);
    if (t < this.nextBurstAt) return;
    this.burstUntil = t + 0.16 + Math.random() * 0.2;
    // Now and then a second burst right behind the first.
    this.nextBurstAt =
      t + (Math.random() < 0.3 ? 0.45 : 1.6 + Math.random() * 2.6);
    // A jolt: the spring that carries her turns it into a stagger.
    this.velocity.x += (Math.random() - 0.5) * 150;
    this.velocity.y += (Math.random() - 0.5) * 80;
    for (let i = 0; i < 9; i++) this.spawn();
  }

  protected override spawn(): void {
    super.spawn();
    // Her dust comes out mostly as pixels: debris, not light.
    const mote = this.motes[this.motes.length - 1];
    if (mote && Math.random() < 0.8) {
      mote.pixel = true;
      mote.size *= 1.5;
    }
  }

  protected override drawWing(
    t: number,
    wing: LoreSpriteWing,
    side: number,
    unfold: number,
  ): void {
    if (side > 0 || wing.length <= 50) {
      super.drawWing(t, wing, side, unfold);
      return;
    }
    // The broken one: limp, twitching, its membrane cutting in and out
    // while the traces under it stay lit.
    const lit = this.reducedMotion || this.noise(t * 8, 5) > 0.4;
    const broken = {
      ...wing,
      angle: wing.angle + 0.7,
      length: wing.length * 0.94,
    };
    const twitch = this.reducedMotion ? 0 : Math.sin(t * 27) * 0.012;
    this.drawWingAt(
      t,
      broken,
      side,
      unfold,
      twitch,
      0.12,
      lit ? 0.85 : 0.14,
      true,
    );
  }

  protected override drawCore(t: number, pulse: number): void {
    super.drawCore(t, pulse);
    const ctx = this.context;
    const lookX = this.gaze.x * 4.5;
    const lookY = this.gaze.y * 4.5;
    const lit = this.reducedMotion || this.noise(t * 6, 11) > 0.22 ? 1 : 0.35;
    ctx.save();
    // Painted over, never added: additive red on a white-hot lens stays
    // white.
    ctx.globalCompositeOperation = "source-over";
    const hot = ctx.createRadialGradient(lookX, lookY, 0, lookX, lookY, 4.4);
    hot.addColorStop(0, `rgba(240,62,62,${(0.98 * lit).toFixed(3)})`);
    hot.addColorStop(0.55, `rgba(240,62,62,${(0.5 * lit).toFixed(3)})`);
    hot.addColorStop(1, "rgba(240,62,62,0)");
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.arc(lookX, lookY, 4.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  protected override draw(t: number): void {
    super.draw(t);
    if (this.reducedMotion || t >= this.burstUntil) return;
    // The tear: a few bands of the finished frame slip sideways.
    const { width, height } = this.canvas;
    this.buffer.width = width;
    this.buffer.height = height;
    const copy = this.buffer.getContext("2d");
    if (!copy) return;
    copy.drawImage(this.canvas, 0, 0);
    const ctx = this.context;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    const bands = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < bands; i++) {
      const y = Math.round(height * (0.18 + Math.random() * 0.62));
      const band = Math.round(height * (0.015 + Math.random() * 0.06));
      const shift = Math.round((Math.random() - 0.5) * width * 0.16);
      ctx.clearRect(0, y, width, band);
      ctx.drawImage(this.buffer, 0, y, width, band, shift, y, width, band);
    }
    ctx.restore();
  }
}
