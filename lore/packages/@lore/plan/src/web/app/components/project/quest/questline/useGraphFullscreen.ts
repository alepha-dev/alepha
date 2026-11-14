import { type RefObject, useCallback, useEffect, useState } from "react";

/**
 * Full screen for a graph view (#Q3450): the element `ref` names fills the
 * screen, through the browser's Fullscreen API, so Esc leaves it as it does
 * everywhere else. `active` follows the browser, not the click, so leaving
 * with Esc or the browser's own control redraws the toggle too.
 */
export const useGraphFullscreen = (ref: RefObject<HTMLElement | null>) => {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const sync = () =>
      setActive(
        document.fullscreenElement !== null &&
          document.fullscreenElement === ref.current,
      );
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, [ref]);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void ref.current?.requestFullscreen?.();
  }, [ref]);

  return { active, toggle };
};
