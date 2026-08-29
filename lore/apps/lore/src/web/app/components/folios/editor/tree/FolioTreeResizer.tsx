import { useI18n } from "alepha/react/i18n";
import { type PointerEvent, type ReactElement, useRef } from "react";

import type { I18n } from "@/web/app/services/I18n.ts";

import {
  TREE_DEFAULT_WIDTH,
  TREE_MAX_WIDTH,
  TREE_MIN_WIDTH,
} from "../useFolioPanes.ts";

export interface FolioTreeResizerProps {
  width: number;
  onWidth: (width: number) => void;
}

/**
 * The drag handle on the tree pane's right edge.
 *
 * Uses pointer capture rather than window listeners: capture keeps every
 * subsequent `pointermove` coming to this element even when the pointer
 * outruns it — which it does on any quick drag — and it releases
 * automatically if the gesture is cancelled, so there is no listener left
 * behind to leak.
 *
 * The visible line is 1px but the grab target is 5px and sits half over
 * the border, because a 1px hit area is a cursor-precision test rather
 * than a control.
 */
const FolioTreeResizer = (props: FolioTreeResizerProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
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
      tabIndex={0}
      role="separator"
      aria-orientation="vertical"
      aria-label={String(tr("folio.tree.resize"))}
      aria-valuenow={props.width}
      aria-valuemin={TREE_MIN_WIDTH}
      aria-valuemax={TREE_MAX_WIDTH}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => props.onWidth(TREE_DEFAULT_WIDTH)}
      className="hover:bg-primary/40 active:bg-primary/60 -ml-[2px] w-[5px] flex-none cursor-col-resize transition-colors"
    />
  );
};

export default FolioTreeResizer;
