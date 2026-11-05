import { type RefObject, useLayoutEffect, useRef } from "react";

export interface UseRowMotionOptions {
  body: RefObject<HTMLTableSectionElement | null>;
  rowKeys: string[];
  /**
   * Rows playing their exit, still in the DOM.
   */
  leaving: ReadonlySet<string>;
  /**
   * Rows redrawn by an optimistic patch, flashed once and then forgotten.
   */
  flash: Set<string>;
}

/**
 * Rows that move, arrive and leave like objects rather than redrawing.
 *
 * FLIP on the Web Animations API, no library: after each commit, every row
 * that kept its key but changed its `offsetTop` is played from where it was
 * to where it is; a new key fades and slides in with a tint; a leaving one
 * fades out sideways; a patched one flashes.
 *
 * ⚠️ It stands still when most of the page changed at once (a new page, a
 * filter, a sort): thirty rows sliding at the same moment is noise, not
 * information. And it stands still under `prefers-reduced-motion`.
 */
export const useRowMotion = (options: UseRowMotionOptions) => {
  const previous = useRef<Map<string, number> | undefined>(undefined);
  // The exit each leaving row is playing, so a rollback can take it back.
  const exits = useRef(new Map<string, Animation>());

  useLayoutEffect(() => {
    const body = options.body.current;
    if (!body) return;
    const rows = new Map<string, HTMLElement>();
    for (const el of body.querySelectorAll<HTMLElement>(
      ":scope > tr[data-row-key]",
    )) {
      rows.set(el.dataset.rowKey!, el);
    }
    const now = new Map<string, number>();
    for (const [key, el] of rows) now.set(key, el.offsetTop);

    const before = previous.current;
    previous.current = now;
    if (!before) return;
    if (
      typeof window === "undefined" ||
      // jsdom, and anything else without the Web Animations API.
      typeof body.animate !== "function" ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let kept = 0;
    for (const key of now.keys()) if (before.has(key)) kept++;
    // Most of the page is new: a page change, not an edit.
    if (now.size > 0 && kept / Math.max(now.size, before.size) < 0.5) {
      exits.current.clear();
      options.flash.clear();
      return;
    }

    for (const key of exits.current.keys()) {
      if (!rows.has(key)) exits.current.delete(key);
    }

    const tint = tintColor(body);
    for (const [key, el] of rows) {
      if (options.leaving.has(key)) {
        if (exits.current.has(key)) continue;
        const exit = el.animate(
          [
            { opacity: 1, transform: "translateX(0)" },
            { opacity: 0, transform: "translateX(-16px)" },
          ],
          { duration: 180, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" },
        );
        exits.current.set(key, exit);
        continue;
      }

      // Rolled back while leaving (the write failed, or Undo was quicker
      // than the exit): the held exit frame would keep it invisible.
      const exit = exits.current.get(key);
      if (exit) {
        exits.current.delete(key);
        exit.reverse();
        // Then let go of the held frame, which would otherwise pin the row's
        // opacity and transform under every later animation.
        exit.onfinish = () => exit.cancel();
        continue;
      }

      const from = before.get(key);
      if (from === undefined) {
        el.animate(
          [
            {
              opacity: 0,
              transform: "translateY(-6px)",
              backgroundColor: tint,
            },
            {
              opacity: 1,
              transform: "translateY(0)",
              backgroundColor: tint,
              offset: 0.4,
            },
            {
              opacity: 1,
              transform: "translateY(0)",
              backgroundColor: "transparent",
            },
          ],
          { duration: 900, easing: "ease-out" },
        );
        continue;
      }
      const dy = from - now.get(key)!;
      if (dy !== 0) {
        el.animate(
          [
            { transform: `translateY(${dy}px)` },
            { transform: "translateY(0)" },
          ],
          { duration: 260, easing: "cubic-bezier(.2,.8,.2,1)" },
        );
      }
      if (options.flash.has(key)) {
        options.flash.delete(key);
        el.animate(
          [{ backgroundColor: tint }, { backgroundColor: "transparent" }],
          { duration: 900, easing: "ease-out" },
        );
      }
    }
  });
};

/**
 * The theme's primary at low strength, read once per commit so it follows a
 * light/dark switch. A keyframe cannot take `var()` everywhere yet.
 */
const tintColor = (el: HTMLElement): string => {
  const primary = getComputedStyle(el).getPropertyValue("--primary").trim();
  return primary
    ? `color-mix(in oklab, ${primary} 14%, transparent)`
    : "rgba(127,127,127,.12)";
};
