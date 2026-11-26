import { AlephaError } from "alepha";

/**
 * A mote of the sprite's dust: a soft point of light or a small square
 * "pixel", in the canvas's 200 x 200 logical space.
 */
export interface LoreSpriteMote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  pixel: boolean;
  spin: number;
}

/**
 * One wing, drawn for the right side and mirrored for the left.
 */
export interface LoreSpriteWing {
  rootX: number;
  rootY: number;
  angle: number;
  length: number;
  width: number;
  /**
   * How far a beat swings it, and which way: the upper wings rise, the lower
   * ones fall.
   */
  swing: number;
  /**
   * Its share of the beat's phase, so the lower pair trails the upper one.
   */
  lag: number;
}

export interface LoreSpriteOptions {
  /**
   * Look at and drift toward the pointer, anywhere on the page.
   */
  follow?: boolean;
}

/**
 * Draws the Lore companion on a `<canvas>` and keeps it alive: an orb of
 * light with a lens for an eye, two pairs of wings veined with circuit
 * traces, and a trail of dust.
 *
 * ## Why a canvas and not an SVG
 *
 * Nothing here is a loop. The drift is smoothed noise, the wingbeat changes
 * strength and sometimes stops to glide, the eye glances around, blinks at
 * random and looks at the pointer, the dust is spawned by the movement it
 * trails. CSS keyframes can only replay; this is a simulation stepped every
 * frame, with additive blending for the light, which SVG has no cheap way to
 * do.
 *
 * ## The rules of its life
 *
 * - Drawn in a 200 x 200 logical space, scaled to the element and to the
 *   device pixel ratio (capped at 2).
 * - Stopped while off screen or in a hidden tab; one static frame under
 *   `prefers-reduced-motion`.
 * - Dark mode is light on dark, blended additively; light mode is graphite
 *   on paper, blended normally, with the glow turned into a soft shade. The
 *   mode is read from `<html class="dark">` and followed live.
 */
export class LoreSpriteRenderer {
  protected readonly canvas: HTMLCanvasElement;
  protected readonly context: CanvasRenderingContext2D;
  protected readonly options: LoreSpriteOptions;
  protected readonly reducedMotion: boolean;
  protected readonly seed = Math.random() * 1000;
  /**
   * How large the figure is drawn in its 200-unit box: as large as it can
   * be with room left for the upper wingtips to beat and the body to drift.
   */
  protected readonly zoom = 1.25;

  protected dark = true;
  protected scale = 1;
  protected frame = 0;
  protected visible = true;
  protected destroyed = false;
  protected startedAt = -1;
  protected previousAt = -1;

  protected position = { x: 0, y: 0 };
  protected velocity = { x: 0, y: 0 };
  protected tilt = 0;

  protected pointer = { x: 0, y: 0, active: false, near: 0 };
  protected nearSmooth = 0;

  protected gaze = { x: 0, y: 0 };
  protected gazeTarget = { x: 0, y: 0 };
  protected nextGlanceAt = 1.2;
  protected blinkAt = 2.5;

  protected pings: number[] = [];
  protected nextPingAt = 3;
  protected motes: LoreSpriteMote[] = [];
  protected spawnDebt = 0;

  protected readonly wings: LoreSpriteWing[] = [
    {
      rootX: 6,
      rootY: -5,
      angle: -0.64,
      length: 80,
      width: 20,
      swing: -1,
      lag: 0,
    },
    {
      rootX: 8,
      rootY: 7,
      angle: 0.34,
      length: 35,
      width: 11,
      swing: 0.7,
      lag: 0.08,
    },
  ];

  protected readonly observers: Array<() => void> = [];

  public constructor(canvas: HTMLCanvasElement, options: LoreSpriteOptions) {
    this.canvas = canvas;
    this.options = options;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new AlephaError("A 2D canvas context is not available.");
    }
    this.context = context;
    this.reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
  }

  public start(): void {
    this.readTheme();
    this.resize();
    this.watch();
    if (this.reducedMotion) {
      this.drawStill();
      return;
    }
    this.introBurst();
    this.schedule();
  }

  public destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    for (const stop of this.observers) stop();
  }

  // ─── setup ──────────────────────────────────────────────────────────────

  protected watch(): void {
    const resize = new ResizeObserver(() => {
      this.resize();
      if (this.reducedMotion) this.drawStill();
    });
    resize.observe(this.canvas);
    this.observers.push(() => resize.disconnect());

    const theme = new MutationObserver(() => {
      this.readTheme();
      if (this.reducedMotion) this.drawStill();
    });
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    this.observers.push(() => theme.disconnect());

    if (this.reducedMotion) return;

    const seen = new IntersectionObserver((entries) => {
      this.visible = entries.some((entry) => entry.isIntersecting);
      this.schedule();
    });
    seen.observe(this.canvas);
    this.observers.push(() => seen.disconnect());

    const onVisibility = () => this.schedule();
    document.addEventListener("visibilitychange", onVisibility);
    this.observers.push(() =>
      document.removeEventListener("visibilitychange", onVisibility),
    );

    if (!this.options.follow) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const box = this.canvas.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      this.pointer.x = this.clamp(dx / (window.innerWidth / 2), -1, 1);
      this.pointer.y = this.clamp(dy / (window.innerHeight / 2), -1, 1);
      this.pointer.near = this.clamp(
        1 - Math.hypot(dx, dy) / (box.width * 1.4),
        0,
        1,
      );
      this.pointer.active = true;
    };
    const onLeave = () => {
      this.pointer.active = false;
      this.pointer.near = 0;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    this.observers.push(() => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    });
  }

  protected readTheme(): void {
    this.dark = document.documentElement.classList.contains("dark");
  }

  protected resize(): void {
    const box = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const side = Math.max(1, Math.round(Math.min(box.width, box.height)));
    this.canvas.width = Math.round(side * ratio);
    this.canvas.height = Math.round(side * ratio);
    this.scale = (side * ratio) / 200;
  }

  protected schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.destroyed || !this.visible || document.hidden) {
      // A pause must not read as a long frame on resume.
      this.previousAt = -1;
      return;
    }
    this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  protected tick(now: number): void {
    if (this.startedAt < 0) this.startedAt = now;
    const dt =
      this.previousAt < 0
        ? 1 / 60
        : Math.min((now - this.previousAt) / 1000, 1 / 20);
    this.previousAt = now;
    const t = (now - this.startedAt) / 1000;
    this.step(t, dt);
    this.draw(t);
    this.schedule();
  }

  protected drawStill(): void {
    this.position = { x: 0, y: 0 };
    this.gaze = { x: 0, y: 0 };
    this.motes = [];
    this.pings = [];
    this.draw(4);
  }

  // ─── simulation ─────────────────────────────────────────────────────────

  protected step(t: number, dt: number): void {
    this.nearSmooth +=
      (this.pointer.near - this.nearSmooth) * Math.min(1, dt * 4);

    // Drift: two octaves of value noise per axis, never a sine.
    const driftX = (this.noise(t * 0.32, 1) - 0.5) * 16;
    const driftY = (this.noise(t * 0.27, 2) - 0.5) * 13;
    const followX = this.pointer.active ? this.pointer.x * 11 : 0;
    const followY = this.pointer.active ? this.pointer.y * 8 : 0;
    const targetX = driftX + followX;
    const targetY = driftY + followY;

    // A damped spring toward it, so a quick pointer flick overshoots a hair.
    const stiffness = 26;
    const damping = 8.5;
    this.velocity.x +=
      ((targetX - this.position.x) * stiffness - this.velocity.x * damping) *
      dt;
    this.velocity.y +=
      ((targetY - this.position.y) * stiffness - this.velocity.y * damping) *
      dt;
    this.position.x += this.velocity.x * dt;
    this.position.y += this.velocity.y * dt;

    const lean = this.clamp(this.velocity.x * 0.014, -0.32, 0.32);
    this.tilt += (lean - this.tilt) * Math.min(1, dt * 6);

    this.stepGaze(t, dt);
    this.stepPings(t);
    this.stepMotes(t, dt);
  }

  protected stepGaze(t: number, dt: number): void {
    if (this.pointer.active && this.pointer.near > 0.02) {
      this.gazeTarget.x = this.pointer.x;
      this.gazeTarget.y = this.pointer.y;
    } else if (this.pointer.active) {
      this.gazeTarget.x = this.pointer.x * 0.8;
      this.gazeTarget.y = this.pointer.y * 0.8;
    } else if (t >= this.nextGlanceAt) {
      // A saccade: the eye jumps somewhere, rests, jumps again.
      const angle = Math.random() * Math.PI * 2;
      const reach = Math.random() < 0.3 ? 0 : 0.35 + Math.random() * 0.6;
      this.gazeTarget.x = Math.cos(angle) * reach;
      this.gazeTarget.y = Math.sin(angle) * reach * 0.7;
      this.nextGlanceAt = t + 0.8 + Math.random() * 2.6;
    }
    // Fast, as eyes are.
    const speed = Math.min(1, dt * 14);
    this.gaze.x += (this.gazeTarget.x - this.gaze.x) * speed;
    this.gaze.y += (this.gazeTarget.y - this.gaze.y) * speed;

    if (t > this.blinkAt + 0.16) {
      // Sometimes twice in a row, as a person does.
      this.blinkAt =
        t + (Math.random() < 0.18 ? 0.25 : 2.2 + Math.random() * 4.5);
    }
  }

  protected stepPings(t: number): void {
    if (t >= this.nextPingAt) {
      this.pings.push(t);
      this.nextPingAt = t + 4.5 + Math.random() * 6;
    }
    this.pings = this.pings.filter((at) => t - at < 1.8);
  }

  protected stepMotes(t: number, dt: number): void {
    const speed = Math.hypot(this.velocity.x, this.velocity.y);
    const rate = 9 + speed * 1.6 + this.nearSmooth * 10;
    this.spawnDebt += rate * dt;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      this.spawn();
    }
    for (const mote of this.motes) {
      mote.age += dt;
      mote.vx *= 1 - dt * 0.9;
      mote.vy *= 1 - dt * 0.9;
      // Dust settles: a faint pull down, and a breath of turbulence.
      mote.vy += 6 * dt;
      mote.vx +=
        (this.noise(mote.y * 0.05 + t * 0.6, mote.size * 7) - 0.5) * 18 * dt;
      mote.x += mote.vx * dt;
      mote.y += mote.vy * dt;
    }
    this.motes = this.motes.filter((mote) => mote.age < mote.life);
  }

  protected spawn(): void {
    const center = this.center();
    const fromWing = Math.random() < 0.35;
    let x = center.x;
    let y = center.y;
    if (fromWing) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const wing = this.wings[0];
      const along = 0.55 + Math.random() * 0.45;
      const angle = wing.angle + this.tilt * side;
      x +=
        side * (wing.rootX + Math.cos(angle) * wing.length * along) * this.zoom;
      y += (wing.rootY + Math.sin(angle) * wing.length * along) * this.zoom;
    } else {
      const angle = Math.random() * Math.PI * 2;
      const radius = (10 + Math.random() * 8) * this.zoom;
      x += Math.cos(angle) * radius;
      y += Math.sin(angle) * radius;
    }
    this.motes.push({
      x,
      y,
      // Left behind by the movement, plus a little scatter.
      vx: -this.velocity.x * 0.25 + (Math.random() - 0.5) * 10,
      vy: -this.velocity.y * 0.25 + (Math.random() - 0.3) * 8,
      age: 0,
      life: 1.4 + Math.random() * 1.8,
      size: 0.5 + Math.random() * Math.random() * 1.6,
      pixel: Math.random() < 0.3,
      spin: (Math.random() - 0.5) * 4,
    });
  }

  protected introBurst(): void {
    // The dust gathers into the core before it lights.
    for (let i = 0; i < 46; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 55 + Math.random() * 40;
      const life = 0.5 + Math.random() * 0.45;
      const x = 100 + Math.cos(angle) * radius;
      const y = 108 + Math.sin(angle) * radius;
      this.motes.push({
        x,
        y,
        vx: (100 - x) / life,
        vy: (108 - y) / life,
        age: 0,
        life,
        size: 0.6 + Math.random() * 1.1,
        pixel: Math.random() < 0.35,
        spin: (Math.random() - 0.5) * 6,
      });
    }
  }

  // ─── drawing ────────────────────────────────────────────────────────────

  protected draw(t: number): void {
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.globalCompositeOperation = this.dark ? "lighter" : "source-over";

    const intro = this.reducedMotion ? 1 : this.clamp((t - 0.35) / 1.1, 0, 1);
    const wingsIn = this.reducedMotion ? 1 : this.clamp((t - 0.6) / 1.0, 0, 1);
    const pulse = this.heartbeat(t);

    this.drawMotes();

    const center = this.center();
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate(this.tilt);
    ctx.scale(this.zoom, this.zoom);

    this.drawBloom(intro, pulse);
    this.drawPings(t);
    const unfold = this.easeOutBack(wingsIn);
    if (unfold > 0.001) {
      for (const side of [-1, 1]) {
        for (const wing of this.wings) {
          this.drawWing(t, wing, side, unfold);
        }
      }
    }
    const grow = this.easeOutBack(intro);
    if (grow > 0.001) {
      ctx.save();
      ctx.scale(grow, grow);
      this.drawCore(t, pulse);
      ctx.restore();
    }
    ctx.restore();
  }

  protected center(): { x: number; y: number } {
    return { x: 100 + this.position.x, y: 108 + this.position.y };
  }

  protected ink(alpha: number): string {
    const a = this.clamp(alpha, 0, 1).toFixed(3);
    return this.dark ? `rgba(236,240,248,${a})` : `rgba(24,24,28,${a})`;
  }

  protected drawBloom(intro: number, pulse: number): void {
    const ctx = this.context;
    const strength = intro * (this.dark ? 1 : 0.45);
    const near = this.nearSmooth;
    const layers = [
      { radius: 70, alpha: 0.07 + near * 0.05 },
      { radius: 38, alpha: 0.13 + pulse * 0.06 + near * 0.06 },
      { radius: 22, alpha: 0.22 + pulse * 0.1 },
    ];
    for (const layer of layers) {
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, layer.radius);
      gradient.addColorStop(0, this.ink(layer.alpha * strength));
      gradient.addColorStop(1, this.ink(0));
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, layer.radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  protected drawPings(t: number): void {
    const ctx = this.context;
    for (const at of this.pings) {
      const k = (t - at) / 1.8;
      const eased = 1 - (1 - k) ** 3;
      ctx.strokeStyle = this.ink((1 - k) * (this.dark ? 0.24 : 0.18));
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.arc(0, 0, 17 + eased * 50, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  protected drawWing(
    t: number,
    wing: LoreSpriteWing,
    side: number,
    unfold: number,
  ): void {
    // A beat: a quick downstroke and a slower recovery, its strength
    // breathing with noise, down to a glide now and then.
    const tempo = 6.2 + this.nearSmooth * 2.5;
    const strength =
      this.clamp((this.noise(t * 0.22, 9) - 0.28) * 1.6, 0.08, 1) *
      (0.16 + this.nearSmooth * 0.06);

    // Two faint echoes of where the wing just was: the eye's own blur.
    const echoes = this.reducedMotion ? [0] : [0.07, 0.035, 0];
    for (const echo of echoes) {
      const phase = this.fract((t - echo) * tempo - wing.lag);
      const beat = this.beatShape(phase);
      const alpha = echo === 0 ? 1 : echo > 0.05 ? 0.14 : 0.26;
      this.drawWingAt(
        t,
        wing,
        side,
        unfold,
        beat * strength,
        beat,
        alpha,
        echo === 0,
      );
    }
  }

  protected drawWingAt(
    t: number,
    wing: LoreSpriteWing,
    side: number,
    unfold: number,
    swing: number,
    beat: number,
    alpha: number,
    detailed: boolean,
  ): void {
    const ctx = this.context;
    const length = wing.length * unfold;
    const width = wing.width * unfold;
    ctx.save();
    ctx.scale(side, 1);
    ctx.translate(wing.rootX, wing.rootY);
    ctx.rotate(wing.angle + wing.swing * swing);
    // The membrane turns as it beats: foreshortened, so it reads in depth.
    ctx.scale(1, 1 - beat * 0.38);

    const { lead, trail, membrane } = this.wingPaths(length, width);

    // The membrane: lit at the root, thinning to nothing at the tip, and a
    // second, lighter sheen across its width so it has a curve to it.
    const fill = ctx.createLinearGradient(0, 0, length, 0);
    const root = this.dark ? 0.4 : 0.2;
    fill.addColorStop(0, this.ink(root * alpha));
    fill.addColorStop(0.55, this.ink(root * 0.32 * alpha));
    fill.addColorStop(1, this.ink(0.02 * alpha));
    ctx.fillStyle = fill;
    ctx.fill(membrane);
    const sheen = ctx.createLinearGradient(0, -width, 0, width * 0.5);
    sheen.addColorStop(0, this.ink((this.dark ? 0.16 : 0.08) * alpha));
    sheen.addColorStop(0.45, this.ink(0));
    ctx.fillStyle = sheen;
    ctx.fill(membrane);

    // An echo is a smear of membrane only: outlines on it would double the
    // edge instead of blurring it.
    if (!detailed) {
      ctx.restore();
      return;
    }

    const leadEdge = ctx.createLinearGradient(0, 0, length, 0);
    leadEdge.addColorStop(0, this.ink((this.dark ? 0.9 : 0.8) * alpha));
    leadEdge.addColorStop(0.7, this.ink((this.dark ? 0.55 : 0.5) * alpha));
    leadEdge.addColorStop(1, this.ink((this.dark ? 0.25 : 0.3) * alpha));
    ctx.strokeStyle = leadEdge;
    ctx.lineWidth = 0.7;
    ctx.stroke(lead);
    ctx.strokeStyle = this.ink((this.dark ? 0.22 : 0.25) * alpha);
    ctx.lineWidth = 0.45;
    ctx.stroke(trail);

    if (wing.length > 50) this.drawTraces(t, length, width, side);
    ctx.restore();
  }

  /**
   * The cyber half of the wing: circuit traces for veins, straight runs
   * with 45 degree bends ending on a node, and now and then a signal
   * running out along one of them.
   */
  protected drawTraces(
    t: number,
    length: number,
    width: number,
    side: number,
  ): void {
    const ctx = this.context;
    const traces = this.tracePoints(length, width);
    ctx.lineWidth = 0.45;
    ctx.strokeStyle = this.ink(this.dark ? 0.5 : 0.55);
    ctx.fillStyle = this.ink(this.dark ? 0.85 : 0.75);
    for (const [index, trace] of traces.entries()) {
      ctx.beginPath();
      ctx.moveTo(trace[0][0], trace[0][1]);
      for (const [x, y] of trace.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
      const [nx, ny] = trace[trace.length - 1];
      ctx.beginPath();
      ctx.arc(nx, ny, 1.05, 0, Math.PI * 2);
      ctx.fill();

      // A signal: each trace fires on its own clock, at its own pace.
      const period = 2.6 + index * 1.3 + (side > 0 ? 0.7 : 0);
      const k = this.fract((t + this.seed * (index + 1)) / period) * 2.2;
      if (k <= 1) {
        const [px, py] = this.along(trace, k);
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 3.2);
        glow.addColorStop(0, this.ink(this.dark ? 0.95 : 0.7));
        glow.addColorStop(1, this.ink(0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(px, py, 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.ink(this.dark ? 0.85 : 0.75);
      }
    }
  }

  protected drawCore(t: number, pulse: number): void {
    const ctx = this.context;
    const dark = this.dark;
    const near = this.nearSmooth;

    // The HUD: three arcs and a ring of ticks, turning opposite ways.
    ctx.save();
    ctx.rotate(t * (0.42 + near * 0.9));
    ctx.strokeStyle = this.ink(dark ? 0.32 + near * 0.3 : 0.35 + near * 0.2);
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      const start = (i * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(0, 0, 21, start, start + Math.PI * 0.42);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.rotate(-t * 0.14);
    for (let i = 0; i < 36; i++) {
      // Two sectors of ticks rather than a full dial: an instrument, not a
      // crosshair.
      if (i % 18 > 6) continue;
      const angle = (i * Math.PI * 2) / 36;
      const major = i % 6 === 0;
      const inner = major ? 24 : 24.8;
      ctx.strokeStyle = this.ink((major ? 0.3 : 0.12) + near * 0.2);
      ctx.lineWidth = major ? 0.55 : 0.4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * 26.4, Math.sin(angle) * 26.4);
      ctx.stroke();
    }
    ctx.restore();

    // The orb: glass, lit from the side it looks toward.
    const lookX = this.gaze.x * 4.5;
    const lookY = this.gaze.y * 4.5;
    const radius = 15;
    const body = ctx.createRadialGradient(
      lookX * 0.6,
      lookY * 0.6 - 3,
      1,
      0,
      0,
      radius,
    );
    if (dark) {
      body.addColorStop(0, this.ink(0.62 + pulse * 0.18));
      body.addColorStop(0.55, this.ink(0.2));
      body.addColorStop(1, this.ink(0.06));
    } else {
      body.addColorStop(0, "rgba(255,255,255,0.95)");
      body.addColorStop(0.6, this.ink(0.07));
      body.addColorStop(1, this.ink(0.22));
    }
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.ink(dark ? 0.85 : 0.8);
    ctx.lineWidth = 0.75;
    ctx.stroke();

    // A rim highlight, opposite the gaze, so the glass has a back.
    ctx.strokeStyle = this.ink(dark ? 0.35 : 0.2);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    const rimAngle = Math.atan2(-lookY, -lookX || 0.001);
    ctx.arc(0, 0, radius - 2.4, rimAngle - 0.7, rimAngle + 0.7);
    ctx.stroke();

    // The eye: a lens with an aperture, which blinks.
    const blinking = t >= this.blinkAt && t < this.blinkAt + 0.16;
    const lid = blinking
      ? 1 - Math.sin(((t - this.blinkAt) / 0.16) * Math.PI) * 0.92
      : 1;
    ctx.save();
    ctx.translate(lookX, lookY);
    ctx.scale(1, lid);
    const iris = 5.6 + near * 0.8;
    ctx.strokeStyle = this.ink(dark ? 0.9 : 0.85);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, iris, 0, Math.PI * 2);
    ctx.stroke();
    // Aperture blades: six short chords, the lens's mechanism.
    ctx.lineWidth = 0.35;
    ctx.strokeStyle = this.ink(dark ? 0.3 : 0.32);
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3 + t * 0.3;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * iris, Math.sin(angle) * iris);
      ctx.lineTo(
        Math.cos(angle + 2.1) * iris * 0.45,
        Math.sin(angle + 2.1) * iris * 0.45,
      );
      ctx.stroke();
    }
    const hot = ctx.createRadialGradient(0, 0, 0, 0, 0, 3.4);
    if (dark) {
      hot.addColorStop(0, "rgba(255,255,255,1)");
      hot.addColorStop(1, "rgba(255,255,255,0)");
    } else {
      hot.addColorStop(0, this.ink(0.95));
      hot.addColorStop(1, this.ink(0));
    }
    ctx.fillStyle = hot;
    ctx.beginPath();
    ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  protected drawMotes(): void {
    const ctx = this.context;
    for (const mote of this.motes) {
      const k = mote.age / mote.life;
      // In fast, out slow; a pixel stutters as it dies, a glitch.
      let alpha = Math.min(1, k * 8) * (1 - k) ** 1.6;
      if (mote.pixel && k > 0.6 && Math.random() < 0.35) alpha *= 0.15;
      alpha *= this.dark ? 0.9 : 0.6;
      if (alpha < 0.01) continue;
      if (mote.pixel) {
        ctx.save();
        ctx.translate(mote.x, mote.y);
        ctx.rotate(mote.spin * mote.age);
        ctx.fillStyle = this.ink(alpha);
        const s = mote.size * 1.25;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        const r = mote.size * 2.2;
        const glow = ctx.createRadialGradient(
          mote.x,
          mote.y,
          0,
          mote.x,
          mote.y,
          r,
        );
        glow.addColorStop(0, this.ink(alpha));
        glow.addColorStop(0.35, this.ink(alpha * 0.45));
        glow.addColorStop(1, this.ink(0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(mote.x, mote.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ─── shared geometry ────────────────────────────────────────────────────

  /**
   * One wing's outline, in its own frame: root at the origin, pointing
   * along +x. The leading edge (the upper curve, to the tip) and the
   * trailing edge back to the root are kept apart so each can be lit on its
   * own; `membrane` is both, closed.
   */
  protected wingPaths(
    length: number,
    width: number,
  ): { lead: Path2D; trail: Path2D; membrane: Path2D } {
    const lead = new Path2D();
    lead.moveTo(0, 0);
    lead.bezierCurveTo(
      length * 0.18,
      -width * 1.2,
      length * 0.7,
      -width * 1.15,
      length * 0.97,
      -width * 0.3,
    );
    lead.quadraticCurveTo(
      length * 1.01,
      -width * 0.05,
      length * 0.9,
      width * 0.08,
    );
    const trail = new Path2D();
    trail.moveTo(length * 0.9, width * 0.08);
    trail.bezierCurveTo(
      length * 0.62,
      width * 0.42,
      length * 0.24,
      width * 0.5,
      0,
      0,
    );
    const membrane = new Path2D();
    membrane.addPath(lead);
    membrane.bezierCurveTo(
      length * 0.62,
      width * 0.42,
      length * 0.24,
      width * 0.5,
      0,
      0,
    );
    membrane.closePath();
    return { lead, trail, membrane };
  }

  /**
   * The two circuit traces of an upper wing, in the wing's frame: straight
   * runs with 45 degree bends, each ending on a node.
   */
  protected tracePoints(length: number, width: number): number[][][] {
    return [
      [
        [length * 0.08, -width * 0.05],
        [length * 0.34, -width * 0.05],
        [length * 0.46, -width * 0.42],
        [length * 0.8, -width * 0.42],
      ],
      [
        [length * 0.16, width * 0.08],
        [length * 0.4, width * 0.08],
        [length * 0.5, -width * 0.02],
        [length * 0.62, -width * 0.02],
      ],
    ];
  }

  // ─── math ───────────────────────────────────────────────────────────────

  /**
   * Smooth value noise in 0..1, two octaves, one stream per `channel`.
   */
  protected noise(x: number, channel: number): number {
    const octave = (v: number, salt: number) => {
      const i = Math.floor(v);
      const f = v - i;
      const s = f * f * (3 - 2 * f);
      return (
        this.hash(i, channel + salt) * (1 - s) +
        this.hash(i + 1, channel + salt) * s
      );
    };
    return octave(x, 0) * 0.68 + octave(x * 2.3 + 17, 31) * 0.32;
  }

  protected hash(i: number, channel: number): number {
    const v = Math.sin(i * 127.1 + (channel + this.seed) * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }

  /**
   * A wingbeat over one cycle, 0 at rest and 1 at the top: up over 60% of
   * it, and down, the power stroke, over the last 40%.
   */
  protected beatShape(phase: number): number {
    if (phase < 0.6) {
      const k = phase / 0.6;
      return k * k * (3 - 2 * k);
    }
    const k = (phase - 0.6) / 0.4;
    return 1 - k * k;
  }

  /**
   * A double beat, then rest: the core's pulse, about once every 1.7 s.
   */
  protected heartbeat(t: number): number {
    const phase = this.fract(t / 1.7);
    const bump = (center: number, spread: number) =>
      Math.exp(-(((phase - center) / spread) ** 2));
    return bump(0.08, 0.045) + bump(0.24, 0.06) * 0.6;
  }

  protected along(points: number[][], k: number): [number, number] {
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const d = Math.hypot(
        points[i][0] - points[i - 1][0],
        points[i][1] - points[i - 1][1],
      );
      lengths.push(d);
      total += d;
    }
    let remaining = k * total;
    for (let i = 1; i < points.length; i++) {
      const d = lengths[i - 1];
      if (remaining <= d) {
        const f = d === 0 ? 0 : remaining / d;
        return [
          points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f,
          points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f,
        ];
      }
      remaining -= d;
    }
    const last = points[points.length - 1];
    return [last[0], last[1]];
  }

  protected easeOutBack(k: number): number {
    const c = 1.6;
    const x = k - 1;
    return 1 + (c + 1) * x ** 3 + c * x ** 2;
  }

  protected fract(v: number): number {
    return v - Math.floor(v);
  }

  protected clamp(v: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, v));
  }
}
