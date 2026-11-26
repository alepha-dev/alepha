import {
  type LoreSpriteOptions,
  LoreSpriteRenderer,
} from "./LoreSpriteRenderer.ts";

/**
 * The companion as a portrait, for an avatar of 30 to 48 px: the frame is
 * drawn in on her orb and the roots of her wings, which leave by the top
 * corners.
 *
 * The whole figure is drawn for a box of 120 px and up, and at avatar size
 * it is a smudge. What survives a small box is the lens (it still glances
 * and blinks), the dial around it and the pulse of the core, so that is all
 * this draws: no dust and no pings, which would be under a pixel or out of
 * the frame.
 *
 * She is always light on dark here, whatever the theme: ink on paper at
 * this size is a grey smear, and her lit form is the one the logo has. The
 * tile she is drawn on is dark in both themes for that reason.
 *
 * A room can show one per message, so it draws every other frame: at this
 * size 30 frames a second cannot be told from 60.
 */
export class LoreSpritePortraitRenderer extends LoreSpriteRenderer {
  protected override readonly zoom = 2.3;
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

  protected override readTheme(): void {
    this.dark = true;
  }

  protected override center(): { x: number; y: number } {
    // Lower than the middle, to leave the wings the top of the frame, and
    // drifting a third as far: the box is small.
    return {
      x: 100 + this.position.x * 0.35,
      y: 114 + this.position.y * 0.35,
    };
  }

  protected override introBurst(): void {
    // No dust to gather: it would be drawn under a pixel.
  }

  protected override stepMotes(): void {
    // No trail either, for the same reason.
  }
}
