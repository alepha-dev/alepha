import { useEffect, useRef } from "react";

import { LoreSpriteRenderer } from "./LoreSpriteRenderer.ts";

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
}

/**
 * The Lore companion, alive, for the large hero spots: an orb of light with
 * a lens for an eye, wings veined with circuit traces, a trail of dust. Every
 * frame is drawn by `LoreSpriteRenderer` on a canvas; see it for why.
 *
 * The canvas is empty in the server render and the companion assembles
 * itself on mount (the dust gathers, the core lights, the wings unfold), so
 * hydration has nothing to disagree with and the first paint is an entrance
 * rather than a flash.
 *
 * Small marks (header, favicon) keep the raster `LoreLogo`: this one is drawn
 * for a box of 120 px and up.
 */
const LoreLogoAnimated = (props: LoreLogoAnimatedProps) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const renderer = new LoreSpriteRenderer(canvas, { follow: props.follow });
    renderer.start();
    return () => renderer.destroy();
  }, [props.follow]);

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
