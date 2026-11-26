import {
  type LoreSpriteOptions,
  LoreSpriteRenderer,
} from "./LoreSpriteRenderer.ts";

/**
 * Where the seeking companion searches: `left`, at the list beside a pane,
 * or `around`, from one side of a page to the other.
 */
export type LoreSpriteSeekingLook = "left" | "around";

export interface LoreSpriteSeekingOptions extends LoreSpriteOptions {
  /**
   * Where she searches, `left` when absent.
   */
  look?: LoreSpriteSeekingLook;
}

/**
 * The companion looking for something: alert, her lens turned aside,
 * sweeping a beam with a sonar arc running out along it.
 *
 * - `left`, the mood of a pane waiting for a pick: she looks left because
 *   that is where Lore puts a list, and the beam sweeps up and down it.
 * - `around`, the mood of a page that is not there: no list to look at, so
 *   she turns her lens from one side of the page to the other and back.
 *
 * The beam turns in the plane of the page, like a lighthouse seen from the
 * side: at full length while she looks aside, foreshortened to nothing as
 * her lens passes the viewer.
 */
export class LoreSpriteSeekingRenderer extends LoreSpriteRenderer {
  protected readonly look: LoreSpriteSeekingLook;

  public constructor(
    canvas: HTMLCanvasElement,
    options: LoreSpriteSeekingOptions,
  ) {
    super(canvas, options);
    this.look = options.look ?? "left";
  }

  protected override step(t: number, dt: number): void {
    // As near a pointer: the dial turns faster and the wings beat quicker.
    this.pointer.near = 0.4;
    super.step(t, dt);
  }

  protected override stepGaze(t: number, dt: number): void {
    this.nextGlanceAt = Number.POSITIVE_INFINITY;
    if (this.look === "around") {
      // A cosine, so she dwells on each side and crosses the middle fast.
      this.gazeTarget.x = -Math.cos(t * 0.55) * 0.85;
      this.gazeTarget.y = Math.sin(t * 1.3) * 0.22;
    } else {
      this.gazeTarget.x = -0.85;
      this.gazeTarget.y = Math.sin(t * 0.85) * 0.6;
    }
    super.stepGaze(t, dt);
  }

  protected override drawCore(t: number, pulse: number): void {
    const ctx = this.context;
    const lookX = this.gaze.x * 4.5;
    const lookY = this.gaze.y * 4.5;
    const direction = Math.atan2(this.gaze.y * 0.55, this.gaze.x || -0.001);
    // How far aside she looks: 1 at either side, 0 straight at the viewer.
    const aside = this.clamp(
      Math.hypot(this.gaze.x, this.gaze.y * 0.55) / 0.85,
      0,
      1,
    );
    const reach = 74 * aside;

    ctx.save();
    ctx.translate(lookX, lookY);
    ctx.rotate(direction);
    if (reach > 6) {
      const beam = ctx.createLinearGradient(0, 0, reach, 0);
      beam.addColorStop(0, this.ink((this.dark ? 0.2 : 0.13) * aside));
      beam.addColorStop(1, this.ink(0));
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(5, -1.2);
      ctx.lineTo(reach, -16 * aside);
      ctx.lineTo(reach, 16 * aside);
      ctx.lineTo(5, 1.2);
      ctx.closePath();
      ctx.fill();
    }

    // Sonar: two arcs half a cycle apart, running out and fading.
    const cycle = this.reducedMotion ? 0.35 : t * 0.55;
    for (const offset of [0, 0.5]) {
      const k = this.fract(cycle + offset);
      ctx.strokeStyle = this.ink(
        (1 - k) * (this.dark ? 0.4 : 0.3) * aside * aside,
      );
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 18 + k * 52 * aside, -0.21, 0.21);
      ctx.stroke();
    }
    ctx.restore();

    super.drawCore(t, pulse);
  }

  protected override drawStill(): void {
    // The one frame reduced motion gets has to show where she looks.
    this.position = { x: 0, y: 0 };
    this.gaze =
      this.look === "around" ? { x: 0.85, y: -0.12 } : { x: -0.85, y: 0.2 };
    this.motes = [];
    this.pings = [];
    this.draw(4);
  }
}
