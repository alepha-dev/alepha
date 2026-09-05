/**
 * The questline viewport: one transform over a board that already places
 * every card in absolute coordinates.
 *
 * Everything here is arithmetic on a `{ k, tx, ty }` triple and nothing
 * touches the DOM, on purpose: jsdom does no layout, so a spec on this class
 * is the only place the pan and zoom math can be proven. The hook that owns
 * the listeners (`useQuestlineViewport`) is deliberately thin, and the
 * browser numbers go in the quest's completion message.
 */

export const MIN_SCALE = 0.25;
export const MAX_SCALE = 2;

/**
 * One press of the stat bar's plus or minus.
 */
export const ZOOM_STEP = 1.2;

/**
 * The room a fit leaves around the board, and the margin `panTo` keeps a
 * focused card away from the edge, in viewport pixels.
 */
export const FIT_PADDING = 20;

/**
 * How far a pointer travels before a press becomes a pan. Under it the
 * gesture is a click, and the card underneath gets it.
 */
export const DRAG_THRESHOLD = 4;

/**
 * A mouse wheel on Firefox reports lines rather than pixels. Sixteen is the
 * line height every browser assumes when it has to invent one.
 */
const LINE_PIXELS = 16;

export interface ViewportTransform {
  k: number;
  tx: number;
  ty: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

/**
 * A rectangle in viewport coordinates: where something IS on screen after
 * the transform, which is what `getBoundingClientRect` reports.
 */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class QuestlineViewport {
  /**
   * What the server renders and what the client hydrates with: the board at
   * its natural size, flush with the top-left corner. `fit` replaces it
   * after hydration, once there is a viewport to measure.
   */
  readonly identity: ViewportTransform = { k: 1, tx: 0, ty: 0 };

  clamp(k: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, k));
  }

  css(t: ViewportTransform): string {
    return `translate(${t.tx}px, ${t.ty}px) scale(${t.k})`;
  }

  /**
   * The transform that shows the whole board at once.
   *
   * Never enlarged past 1: a three-card questline is not made poster-sized
   * to fill a wide panel. Centred when it fits. When even `MIN_SCALE` cannot
   * fit it, flush with the padding on the overflowing axis, so the FIRST
   * cards are the ones on screen, which is what the old `m-auto` comment was
   * protecting.
   */
  fit(
    viewport: ViewportSize,
    board: ViewportSize,
    padding = FIT_PADDING,
  ): ViewportTransform {
    if (
      viewport.width <= 0 ||
      viewport.height <= 0 ||
      board.width <= 0 ||
      board.height <= 0
    ) {
      return this.identity;
    }
    const k = this.clamp(
      Math.min(
        1,
        (viewport.width - 2 * padding) / board.width,
        (viewport.height - 2 * padding) / board.height,
      ),
    );
    return {
      k,
      tx: this.place(viewport.width, board.width * k, padding),
      ty: this.place(viewport.height, board.height * k, padding),
    };
  }

  /**
   * Scale about a point, so what sits under the cursor stays under it.
   */
  zoomAt(
    t: ViewportTransform,
    factor: number,
    px: number,
    py: number,
  ): ViewportTransform {
    const k = this.clamp(t.k * factor);
    if (k === t.k) return t;
    const ratio = k / t.k;
    return { k, tx: px - (px - t.tx) * ratio, ty: py - (py - t.ty) * ratio };
  }

  panBy(t: ViewportTransform, dx: number, dy: number): ViewportTransform {
    if (dx === 0 && dy === 0) return t;
    return { k: t.k, tx: t.tx + dx, ty: t.ty + dy };
  }

  /**
   * The smallest pan that brings a rect fully inside the viewport with
   * `padding` to spare. A rect already inside returns the same transform; one
   * larger than the viewport is aligned on its leading edge, the way focus
   * scrolling does.
   */
  panTo(
    t: ViewportTransform,
    rect: ViewportRect,
    viewport: ViewportSize,
    padding = FIT_PADDING,
  ): ViewportTransform {
    return this.panBy(
      t,
      this.shift(rect.x, rect.width, viewport.width, padding),
      this.shift(rect.y, rect.height, viewport.height, padding),
    );
  }

  /**
   * A wheel delta in pixels, whatever unit the browser used. `page` is the
   * viewport extent on that axis, which is what one page unit means.
   */
  wheelPixels(delta: number, deltaMode: number, page: number): number {
    if (deltaMode === 1) return delta * LINE_PIXELS;
    if (deltaMode === 2) return delta * page;
    return delta;
  }

  /**
   * The zoom factor a wheel notch asks for. A pinch arrives the same way,
   * since browsers report it as a ctrl-wheel. Wheel down shrinks. The
   * exponents are d3-zoom's, which is the feel people already know: a 100px
   * notch is about one `ZOOM_STEP`.
   */
  wheelZoomFactor(deltaY: number, deltaMode: number): number {
    const exponent = deltaMode === 1 ? 0.05 : deltaMode === 2 ? 1 : 0.002;
    return 2 ** (-deltaY * exponent);
  }

  protected place(extent: number, content: number, padding: number): number {
    return content + 2 * padding <= extent ? (extent - content) / 2 : padding;
  }

  protected shift(
    start: number,
    length: number,
    extent: number,
    padding: number,
  ): number {
    if (start < padding) return padding - start;
    const overflow = start + length - (extent - padding);
    if (overflow <= 0) return 0;
    return -Math.min(overflow, start - padding);
  }
}
