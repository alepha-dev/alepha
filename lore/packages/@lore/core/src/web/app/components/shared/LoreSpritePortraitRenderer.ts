import {
  type LoreSpriteOptions,
  LoreSpriteRenderer,
} from "./LoreSpriteRenderer.ts";

/**
 * The companion as a portrait, for an avatar of 30 to 48 px: the frame is
 * drawn in on her orb, and her wings are drawn whole on a canvas larger than
 * the avatar's slot (#Q4530).
 *
 * The whole figure is drawn for a box of 120 px and up, and at avatar size
 * it is a smudge. What survives a small box is the lens (it still glances
 * and blinks), the dial around it and the pulse of the core, so that is all
 * this draws: no dust and no pings, which would be under a pixel or out of
 * the frame.
 *
 * ## No tile, wings past the box (#Q4530)
 *
 * She was cropped on a dark tile, her wings cut by its edges. The owner
 * asked for the fairy alone, wings not truncated and not shrunk. So the
 * canvas is {@link OVERFLOW} times the slot, centred on it, and the zoom is
 * divided by as much: the orb keeps its size and its place in the slot, and
 * the wings, which reach about 1.7 slots across, have room to be drawn in
 * full. The caller lays the canvas over its slot without taking space
 * (`ChatAgentAvatar`).
 *
 * She follows the theme like the Home companion: light on dark in dark,
 * graphite on paper in light. With no tile there is nothing dark behind her
 * in light, so the paper rendering is the one that reads there, with its
 * haze kept to the core, since a wide grey bloom on white is a smudge.
 *
 * A room can show one per message, so it draws every other frame: at this
 * size 30 frames a second cannot be told from 60.
 */
export class LoreSpritePortraitRenderer extends LoreSpriteRenderer {
  /**
   * The canvas against the slot it sits on: 1.8 times its side, so 40% past
   * each edge. The wings' tips stay inside it, and the right one stops short
   * of a message's author name, 10 px beside the slot.
   */
  public static readonly OVERFLOW = 1.8;

  protected override readonly zoom = 2.3 / LoreSpritePortraitRenderer.OVERFLOW;
  protected skipped = false;

  public constructor(canvas: HTMLCanvasElement, options: LoreSpriteOptions) {
    super(canvas, options);
    this.nextPingAt = Number.POSITIVE_INFINITY;
  }

  protected override tick(now: number): void {
    this.skipped = !this.skipped;
    if (this.skipped) {
      this.schedule();
      return;
    }
    super.tick(now);
  }

  protected override center(): { x: number; y: number } {
    // Where the slot had her, lower than its middle to leave the wings its
    // top, in the larger canvas's units, and drifting a third as far: the
    // slot is small.
    const overflow = LoreSpritePortraitRenderer.OVERFLOW;
    return {
      x: 100 + (this.position.x * 0.35) / overflow,
      y: 100 + (14 + this.position.y * 0.35) / overflow,
    };
  }

  protected override drawBloom(intro: number, pulse: number): void {
    if (this.dark) {
      super.drawBloom(intro, pulse);
      return;
    }
    // On paper, only the core's own haze: the wide layers draw a grey disc
    // where the tile used to be.
    const ctx = this.context;
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
    gradient.addColorStop(0, this.ink((0.22 + pulse * 0.1) * 0.45 * intro));
    gradient.addColorStop(1, this.ink(0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  protected override introBurst(): void {
    // No dust to gather: it would be drawn under a pixel.
  }

  protected override stepMotes(): void {
    // No trail either, for the same reason.
  }
}
