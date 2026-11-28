import { useEffect, useRef } from "react";

import { type LoreSpriteMood, LoreSpriteMoods } from "./LoreSpriteMoods.ts";
import { LoreSpritePortraitRenderer } from "./LoreSpritePortraitRenderer.ts";
import type { LoreSpriteSeekingLook } from "./LoreSpriteSeekingRenderer.ts";

export interface LoreLogoAnimatedProps {
  /**
   * Sizing classes. The companion is drawn square, to the smaller side of
   * the box, and follows light and dark on its own.
   */
  className?: string;
  /**
   * Look at the pointer and drift toward it, anywhere on the page. A touch
   * screen has no pointer to follow, so there it glances around on its own.
   */
  follow?: boolean;
  /**
   * The state she is in: `calm`, `asleep`, `seeking`, `glitch` or
   * `listening` (`LoreSpriteMoods`). Absent, the companion of the Home page.
   */
  mood?: LoreSpriteMood;
  /**
   * Where the `seeking` mood searches: `left`, at the list beside a pane
   * (the default), or `around`, across a full page that has no list. The
   * other moods ignore it.
   */
  look?: LoreSpriteSeekingLook;
  /**
   * Frame her orb and the roots of her wings, for an avatar of 30 to 48 px
   * (`LoreSpritePortraitRenderer`). A portrait has no mood and follows no
   * pointer.
   */
  portrait?: boolean;
}

/**
 * The Lore companion, alive, for the large hero spots: an orb of light with
 * a lens for an eye, wings veined with circuit traces, a trail of dust. Every
 * frame is drawn by `LoreSpriteRenderer` on a canvas; see it for why.
 *
 * The canvas is empty in the server render and the companion assembles
 * itself on mount (the dust gathers, the core lights, the wings unfold), so
 * hydration has nothing to disagree with and the first paint is an entrance
 * rather than a flash. A change of `mood` or `look` is a new entrance.
 *
 * Small marks (header, favicon) keep the raster `LoreLogo`: this one is drawn
 * for a box of 120 px and up, or as a `portrait` for an avatar.
 */
const LoreLogoAnimated = (props: LoreLogoAnimatedProps) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // Nothing to draw on: jsdom has no 2D context and neither observer (a
    // spec may stub the observers, never the context), and the companion is
    // never the only thing a screen says.
    if (
      typeof CanvasRenderingContext2D === "undefined" ||
      typeof ResizeObserver === "undefined" ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const renderer = props.portrait
      ? new LoreSpritePortraitRenderer(canvas, {})
      : LoreSpriteMoods.create(
          canvas,
          { follow: props.follow, look: props.look },
          props.mood,
        );
    renderer.start();
    return () => renderer.destroy();
  }, [props.follow, props.mood, props.look, props.portrait]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label="Lore"
      className={`block ${props.className ?? ""}`}
    />
  );
};

export default LoreLogoAnimated;
