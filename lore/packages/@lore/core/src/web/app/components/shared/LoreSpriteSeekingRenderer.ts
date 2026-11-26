import { LoreSpriteRenderer } from "./LoreSpriteRenderer.ts";

/**
 * The companion looking for something: alert, her lens turned to the left,
 * sweeping a beam up and down with a sonar arc running out along it. The
 * mood of a pane waiting for a pick from the list beside it.
 *
 * She looks left because that is where Lore puts a list. A pane whose list
 * sits elsewhere wants a direction option, which nothing needs yet.
 */
export class LoreSpriteSeekingRenderer extends LoreSpriteRenderer {
  protected override step(t: number, dt: number): void {
    // As near a pointer: the dial turns faster and the wings beat quicker.
    this.pointer.near = 0.4;
    super.step(t, dt);
  }

  protected override stepGaze(t: number, dt: number): void {
    this.nextGlanceAt = Number.POSITIVE_INFINITY;
    this.gazeTarget.x = -0.85;
    this.gazeTarget.y = Math.sin(t * 0.85) * 0.6;
    super.stepGaze(t, dt);
  }

  protected override drawCore(t: number, pulse: number): void {
    const ctx = this.context;
    const lookX = this.gaze.x * 4.5;
    const lookY = this.gaze.y * 4.5;
    const direction = Math.atan2(this.gaze.y * 0.55, this.gaze.x || -0.001);
    const reach = 74;

    ctx.save();
    ctx.translate(lookX, lookY);
    ctx.rotate(direction);
    const beam = ctx.createLinearGradient(0, 0, reach, 0);
    beam.addColorStop(0, this.ink(this.dark ? 0.2 : 0.13));
    beam.addColorStop(1, this.ink(0));
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(5, -1.2);
    ctx.lineTo(reach, -16);
    ctx.lineTo(reach, 16);
    ctx.lineTo(5, 1.2);
    ctx.closePath();
    ctx.fill();

    // Sonar: two arcs half a cycle apart, running out and fading.
    const cycle = this.reducedMotion ? 0.35 : t * 0.55;
    for (const offset of [0, 0.5]) {
      const k = this.fract(cycle + offset);
      ctx.strokeStyle = this.ink((1 - k) * (this.dark ? 0.4 : 0.3));
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 18 + k * 52, -0.21, 0.21);
      ctx.stroke();
    }
    ctx.restore();

    super.drawCore(t, pulse);
  }

  protected override drawStill(): void {
    // The one frame reduced motion gets has to show where she looks.
    this.position = { x: 0, y: 0 };
    this.gaze = { x: -0.85, y: 0.2 };
    this.motes = [];
    this.pings = [];
    this.draw(4);
  }
}
