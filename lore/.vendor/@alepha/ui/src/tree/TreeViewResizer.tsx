import { useI18n } from "alepha/react/i18n";
import { type PointerEvent, type ReactElement, useRef } from "react";

export interface TreeViewResizerProps {
  width: number;
  onWidth: (width: number) => void;
  minWidth?: number;
  maxWidth?: number;
  /**
   * What a double click resets to.
   */
  defaultWidth?: number;
}

/**
 * The drag handle on a tree pane's edge.
 *
 * Two decisions worth keeping.
 *
 * **Pointer capture rather than window listeners.** Capture keeps every
 * subsequent `pointermove` coming to this element even when the pointer
 * outruns it, which it does on any quick drag, and it releases automatically
 * if the gesture is cancelled, so there is no listener left behind to leak.
 *
 * **A 1px line with a 5px grab target**, sitting half over the border. A 1px
 * hit area is a cursor-precision test rather than a control.
 *
 * ⚠️ Persisting the width is the consumer's job. This component reports and
 * never stores, so a pane preference survives navigation the way the
 * consumer's other pane preferences do.
 */
export const TreeViewResizer = (props: TreeViewResizerProps): ReactElement => {
  const { tr } = useI18n();
  const minWidth = props.minWidth ?? TREE_VIEW_MIN_WIDTH;
  const maxWidth = props.maxWidth ?? TREE_VIEW_MAX_WIDTH;
  const defaultWidth = props.defaultWidth ?? TREE_VIEW_DEFAULT_WIDTH;
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.preventDefault();
    start.current = { x: e.clientX, width: props.width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return;
    props.onWidth(start.current.width + (e.clientX - start.current.x));
  };

  const end = (e: PointerEvent<HTMLDivElement>): void => {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      data-slot="tree-view-resizer"
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-label={tr("treeView.resize", { default: "Resize tree" })}
      aria-valuenow={props.width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => props.onWidth(defaultWidth)}
      className="hover:bg-primary/40 active:bg-primary/60 -ml-[2px] w-[5px] flex-none cursor-col-resize transition-colors"
    />
  );
};

/**
 * Sane defaults for a navigation pane, overridable per consumer. These are the
 * numbers the component was extracted with; a consumer with its own opinion
 * passes it rather than editing these.
 */
export const TREE_VIEW_MIN_WIDTH = 180;
export const TREE_VIEW_MAX_WIDTH = 480;
export const TREE_VIEW_DEFAULT_WIDTH = 242;
