import {
  type LoreSpriteOptions,
  LoreSpriteRenderer,
  type LoreSpriteWing,
} from "./LoreSpriteRenderer.ts";

/**
 * One `z` of her sleep, rising and growing until it fades.
 */
interface LoreSpriteDream {
  x: number;
  y: number;
  age: number;
  life: number;
  size: number;
}

/**
 * The companion asleep: wings folded down, lens shut, breathing, dreaming in
 * small `z`s. The mood of a list that has never had a row.
 *
 * She does not drift, glance or trail dust: the base simulation is replaced
 * by a breath, and everything in the core runs at a fifth of its pace.
 */
export class LoreSpriteAsleepRenderer extends LoreSpriteRenderer {
  protected dreams: LoreSpriteDream[] = [];
  protected dreamDebt = 0.6;

  public constructor(canvas: HTMLCanvasElement, options: LoreSpriteOptions) {
    super(canvas, options);
    // Folded: the upper pair hangs out and down, the lower pair under her.
    this.wings[0].angle = 0.46;
    this.wings[0].length = 70;
    this.wings[1].angle = 1.12;
    this.nextPingAt = Number.POSITIVE_INFINITY;
  }

  /**
   * One breath, -1 to 1, about every six and a half seconds.
   */
  protected breath(t: number): number {
    return Math.sin(t * 0.95);
  }

  protected override step(t: number, dt: number): void {
    const breath = this.breath(t);
    this.position.x = (this.noise(t * 0.08, 1) - 0.5) * 3;
    this.position.y = 2 + breath * 2.4;
    this.velocity.x = 0;
    this.velocity.y = 0;
    this.tilt = -0.11 + breath * 0.014;
    this.gaze.x = -0.2;
    this.gaze.y = 0.5;

    // The entrance's dust still has to arrive and die.
    for (const mote of this.motes) {
      mote.age += dt;
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
    }
    this.motes = this.motes.filter((mote) => mote.age < mote.life);

    if (t > 2) this.dreamDebt += dt * 0.62;
    if (this.dreamDebt >= 1) {
      this.dreamDebt -= 1;
      const center = this.center();
      this.dreams.push({
        x: center.x + 17 * this.zoom,
        y: center.y - 15 * this.zoom,
        age: 0,
        life: 3.8,
        size: 7.5,
      });
    }
    for (const dream of this.dreams) {
      dream.age += dt;
      dream.x += (7 + Math.sin(dream.age * 2.2) * 5) * dt;
      dream.y -= 11 * dt;
    }
    this.dreams = this.dreams.filter((dream) => dream.age < dream.life);
  }

  protected override heartbeat(t: number): number {
    return 0.35 + 0.35 * this.breath(t);
  }

  protected override drawBloom(intro: number, pulse: number): void {
    super.drawBloom(intro * 0.6, pulse);
  }

  protected override drawWing(
    t: number,
    wing: LoreSpriteWing,
    side: number,
    unfold: number,
  ): void {
    // No beat and no echo: the wing only rises and falls with the breath.
    const breath = (this.breath(t) + 1) / 2;
    this.drawWingAt(t * 0.3, wing, side, unfold, breath * 0.07, 0.3, 0.8, true);
  }

  protected override drawCore(t: number, pulse: number): void {
    // The lid is held at the middle of a blink, which is as shut as the
    // base draws it.
    const slow = t * 0.2;
    this.blinkAt = slow - 0.08;
    super.drawCore(slow, pulse);
  }

  protected override drawMotes(): void {
    super.drawMotes();
    const ctx = this.context;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const dream of this.dreams) {
      const k = dream.age / dream.life;
      const alpha =
        Math.min(1, k * 5) * (1 - k) ** 1.4 * (this.dark ? 0.9 : 0.7);
      const size = dream.size * (0.75 + k * 1.25);
      ctx.font = `500 ${size.toFixed(2)}px "JetBrains Mono", ui-monospace, Menlo, monospace`;
      ctx.fillStyle = this.ink(alpha);
      ctx.fillText("z", dream.x, dream.y);
    }
    ctx.restore();
  }
}
