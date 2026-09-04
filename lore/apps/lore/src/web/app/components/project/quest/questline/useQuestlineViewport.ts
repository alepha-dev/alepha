import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  DRAG_THRESHOLD,
  QuestlineViewport,
  type ViewportTransform,
  ZOOM_STEP,
} from "./questlineViewport.ts";

export interface QuestlineViewportControls {
  /**
   * The clipped frame. Every listener hangs off it.
   */
  viewportRef: RefObject<HTMLDivElement | null>;
  /**
   * The board inside the frame, measured untransformed for the fit.
   */
  boardRef: RefObject<HTMLDivElement | null>;
  /**
   * The transform to put on the board.
   */
  boardStyle: CSSProperties;
  transform: ViewportTransform;
  /**
   * A pan is in progress: the cursor and the text selection follow it.
   */
  dragging: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  /**
   * Back to the fit. A resize re-fits again until the next gesture.
   */
  reset: () => void;
}

/**
 * Drag to pan and cursor-anchored zoom over the questline board.
 *
 * The math is `QuestlineViewport`; this owns the listeners and the one piece
 * of state. Every listener is native rather than a React prop, for two
 * reasons that are not tidiness. React registers `wheel` passively on the
 * root, so `preventDefault()` in an `onWheel` prop is a no-op and the page
 * scrolls behind the map. And the click that ends a pan has to be stopped
 * BEFORE React's root listener dispatches it to the card underneath, which
 * only a capture-phase listener on the frame can do.
 *
 * The frame is `overflow-clip`, not `overflow-hidden`: hidden is still a
 * scroll container, so focusing a card outside it would scroll the frame
 * under the transform and the next pan would jump. Clip cannot scroll, and
 * the `focusin` listener below pans the card into view instead.
 */
export const useQuestlineViewport = (): QuestlineViewportControls => {
  const geometry = useMemo(() => new QuestlineViewport(), []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<ViewportTransform>(
    geometry.identity,
  );
  const [dragging, setDragging] = useState(false);
  /**
   * Whether the reader has panned or zoomed. A resize re-fits only until
   * then: recentring a map somebody is reading is worse than a stale fit.
   */
  const touched = useRef(false);

  const fit = useCallback(() => {
    const frame = viewportRef.current;
    const board = boardRef.current;
    if (!frame || !board) return;
    touched.current = false;
    setTransform(
      geometry.fit(
        { width: frame.clientWidth, height: frame.clientHeight },
        // `offsetWidth` ignores the transform, which is the size a fit wants.
        { width: board.offsetWidth, height: board.offsetHeight },
      ),
    );
  }, [geometry]);

  // After hydration and before paint. The server renders `identity` because
  // it has nothing to measure, and a fit in a plain effect would flash one
  // frame of the board at its natural size first.
  useLayoutEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    const frame = viewportRef.current;
    const board = boardRef.current;
    if (!frame || !board || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    observer.observe(frame);
    // The board as well: a quest edited from the dialog can change the layout.
    observer.observe(board);
    return () => observer.disconnect();
  }, [fit]);

  useEffect(() => {
    const frame = viewportRef.current;
    if (!frame) return;

    // Plain wheel pans, ctrl-wheel zooms. Browsers synthesise `ctrlKey` for
    // a trackpad pinch, so this one branch is what makes it feel native.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      touched.current = true;
      const box = frame.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        const factor = geometry.wheelZoomFactor(event.deltaY, event.deltaMode);
        const px = event.clientX - box.left;
        const py = event.clientY - box.top;
        setTransform((t) => geometry.zoomAt(t, factor, px, py));
        return;
      }
      const dx = geometry.wheelPixels(event.deltaX, event.deltaMode, box.width);
      const dy = geometry.wheelPixels(
        event.deltaY,
        event.deltaMode,
        box.height,
      );
      setTransform((t) => geometry.panBy(t, -dx, -dy));
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const box = frame.getBoundingClientRect();
      const rect = target.getBoundingClientRect();
      setTransform((t) =>
        geometry.panTo(
          t,
          {
            x: rect.left - box.left,
            y: rect.top - box.top,
            width: rect.width,
            height: rect.height,
          },
          { width: box.width, height: box.height },
        ),
      );
    };

    let gesture: {
      id: number;
      x: number;
      y: number;
      dragging: boolean;
    } | null = null;
    let swallowClick = false;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      // A cancelled gesture never produces the click it armed against, so a
      // stale flag would eat the next real one.
      swallowClick = false;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        dragging: false,
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.dragging) {
        // Under the threshold this is still a click on whatever is under
        // the pointer, and the card keeps it.
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        gesture.dragging = true;
        touched.current = true;
        // Capture only once it IS a drag. Capturing on pointerdown would
        // retarget the pointerup, and with it the click, away from the card.
        frame.setPointerCapture(event.pointerId);
        setDragging(true);
      }
      gesture.x = event.clientX;
      gesture.y = event.clientY;
      setTransform((t) => geometry.panBy(t, dx, dy));
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (gesture.dragging) {
        swallowClick = true;
        if (frame.hasPointerCapture(event.pointerId)) {
          frame.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
      }
      gesture = null;
    };

    // Capture phase on the frame runs before the click reaches the card and
    // before React's root listener sees it, so a finished pan opens nothing.
    const onClick = (event: MouseEvent) => {
      if (!swallowClick) return;
      swallowClick = false;
      event.stopPropagation();
      event.preventDefault();
    };

    frame.addEventListener("wheel", onWheel, { passive: false });
    frame.addEventListener("focusin", onFocusIn);
    frame.addEventListener("pointerdown", onPointerDown);
    frame.addEventListener("pointermove", onPointerMove);
    frame.addEventListener("pointerup", onPointerEnd);
    frame.addEventListener("pointercancel", onPointerEnd);
    frame.addEventListener("click", onClick, true);
    return () => {
      frame.removeEventListener("wheel", onWheel);
      frame.removeEventListener("focusin", onFocusIn);
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerEnd);
      frame.removeEventListener("pointercancel", onPointerEnd);
      frame.removeEventListener("click", onClick, true);
    };
  }, [geometry]);

  // The buttons zoom about the frame's centre, since there is no cursor to
  // anchor on.
  const zoomBy = useCallback(
    (factor: number) => {
      const frame = viewportRef.current;
      if (!frame) return;
      touched.current = true;
      const px = frame.clientWidth / 2;
      const py = frame.clientHeight / 2;
      setTransform((t) => geometry.zoomAt(t, factor, px, py));
    },
    [geometry],
  );
  const zoomIn = useCallback(() => zoomBy(ZOOM_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / ZOOM_STEP), [zoomBy]);

  const boardStyle = useMemo<CSSProperties>(
    () => ({ transform: geometry.css(transform), transformOrigin: "0 0" }),
    [geometry, transform],
  );

  return {
    viewportRef,
    boardRef,
    boardStyle,
    transform,
    dragging,
    zoomIn,
    zoomOut,
    reset: fit,
  };
};
