import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The clamp on the query panel. Narrower than 268px and the segmented rows
 * wrap; wider than 420px and the results pane starts losing chart.
 */
export const ANALYTICS_PANEL_MIN = 268;
export const ANALYTICS_PANEL_MAX = 420;
export const ANALYTICS_PANEL_DEFAULT = 300;

const STORAGE_KEY = "alepha.admin.analytics.panelWidth";

const clamp = (value: number): number =>
  Math.max(
    ANALYTICS_PANEL_MIN,
    Math.min(ANALYTICS_PANEL_MAX, Math.round(value)),
  );

export interface PanelWidthApi {
  width: number;
  /**
   * `pointerdown` on the 7px hit strip along the panel's right edge. The move
   * and release listeners live on `document`, so a fast drag that outruns the
   * cursor does not drop the gesture.
   */
  startResize: (event: ReactPointerEvent) => void;
}

/**
 * A draggable panel width, remembered across reloads.
 *
 * The initial read is lazy and guarded: this component renders on the server
 * too, and a width read there would differ from the one the browser has
 * stored, which is a hydration mismatch rather than a nicety.
 */
export const usePanelWidth = (): PanelWidthApi => {
  const [width, setWidth] = useState(ANALYTICS_PANEL_DEFAULT);
  const drag = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      // After the commit, not in a lazy initialiser: a width read during the
      // first render would differ from the one the server rendered, and a
      // hydration mismatch costs more than one extra paint.
      // oxlint-disable-next-line react/set-state-in-effect
      if (stored) setWidth(clamp(Number(stored)));
    } catch {
      // Private mode, or storage denied. The default is a fine answer.
    }
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;
      setWidth(clamp(drag.current.width + (event.clientX - drag.current.x)));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      try {
        window.localStorage.setItem(STORAGE_KEY, String(width));
      } catch {
        // Same as above: losing the preference is not worth an error.
      }
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [width]);

  const startResize = useCallback(
    (event: ReactPointerEvent) => {
      drag.current = { x: event.clientX, width };
      event.preventDefault();
    },
    [width],
  );

  return { width, startResize };
};
