import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useRef, useState } from "react";

export interface PaneResizerProps {
  /**
   * The pane's width now, in pixels.
   */
  width: number;
  /**
   * The width to keep: called once when a drag ends, on an arrow key, and on
   * the double click that resets. Persist it here.
   */
  onWidth: (width: number) => void;
  /**
   * Every step of a drag, for the pane to follow the pointer. Without it the
   * handle follows on its own and the pane jumps on release.
   */
  onResize?: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  /**
   * What a double click resets to.
   */
  defaultWidth?: number;
  /**
   * Which edge of the pane the handle sits on. `right` (the default) for a
   * pane on the left of the page, so dragging right widens it.
   */
  side?: "left" | "right";
  /**
   * The accessible name. Defaults to "Resize pane".
   */
  label?: string;
}

/**
 * The drag handle on a side pane's edge: a hairline that turns into an
 * accent line on hover and while dragging, over a wider invisible grab
 * area. Drag to resize, arrow keys to step, double click to reset.
 *
 * ⚠️ **Positioned absolutely** on the pane's edge, so the pane must be
 * `relative`. It draws the pane's border itself: the pane needs none on that
 * side.
 *
 * **Pointer capture rather than window listeners.** Capture keeps every
 * `pointermove` coming here even when the pointer outruns the handle, and
 * releases on its own if the gesture is cancelled, so nothing leaks.
 *
 * **Two callbacks.** `onResize` follows the drag; `onWidth` fires once, on
 * release, so a width persisted to a cookie or storage is written once per
 * gesture rather than on every pointer move. Both are clamped to the bounds.
 */
export const PaneResizer = (props: PaneResizerProps): ReactElement => {
  const { tr } = useI18n();
  const minWidth = props.minWidth ?? PANE_MIN_WIDTH;
  const maxWidth = props.maxWidth ?? PANE_MAX_WIDTH;
  const defaultWidth = props.defaultWidth ?? PANE_DEFAULT_WIDTH;
  const direction = props.side === "left" ? -1 : 1;
  const clamp = (value: number) =>
    Math.round(Math.min(maxWidth, Math.max(minWidth, value)));

  const start = useRef<{ x: number; width: number } | null>(null);
  const [dragWidth, setDragWidth] = useState<number | undefined>();
  const width = dragWidth ?? props.width;

  const end = (commit: boolean) => {
    if (!start.current) return;
    start.current = null;
    if (commit && dragWidth !== undefined) props.onWidth(dragWidth);
    setDragWidth(undefined);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={props.label ?? tr("pane.resize", { default: "Resize pane" })}
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      data-slot="pane-resizer"
      data-dragging={dragWidth !== undefined || undefined}
      // Focusable, and the arrow keys resize, so the handle is not
      // pointer-only.
      tabIndex={0}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowLeft" ? -16 : event.key === "ArrowRight" ? 16 : 0;
        if (step === 0) return;
        event.preventDefault();
        props.onWidth(clamp(props.width + step * direction));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, width: props.width };
        setDragWidth(props.width);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const next = clamp(
          start.current.width + (event.clientX - start.current.x) * direction,
        );
        setDragWidth(next);
        props.onResize?.(next);
      }}
      onPointerUp={() => end(true)}
      onPointerCancel={() => end(false)}
      onDoubleClick={() => props.onWidth(clamp(defaultWidth))}
      className={`group/resize focus-visible:ring-ring/50 absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none select-none focus-visible:ring-2 focus-visible:outline-none ${
        props.side === "left" ? "left-0" : "right-0"
      }`}
    >
      <span
        className={`bg-border group-hover/resize:bg-primary/60 group-data-[dragging]/resize:bg-primary absolute inset-y-0 w-px transition-colors group-hover/resize:w-0.5 group-data-[dragging]/resize:w-0.5 ${
          props.side === "left" ? "left-0" : "right-0"
        }`}
      />
    </div>
  );
};

/**
 * Sane defaults for a navigation pane, overridable per consumer.
 */
export const PANE_MIN_WIDTH = 180;
export const PANE_MAX_WIDTH = 480;
export const PANE_DEFAULT_WIDTH = 242;
