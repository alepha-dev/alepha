import {
  type UniqueIdentifier,
  useDraggable,
  useDroppable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, PointerEvent } from "react";

export interface SortableItem {
  /**
   * The item's element: what moves, and what another item is dropped on.
   */
  ref: (node: HTMLElement | null) => void;
  /**
   * Where the item is while dragged.
   */
  style: CSSProperties;
  /**
   * The drag's start, for the element a press begins on: the item itself,
   * in the capture phase so a control inside it (a menu trigger) cannot
   * swallow the press, or a grip of its own.
   */
  onPointerDown: ((event: PointerEvent<HTMLElement>) => void) | undefined;
  isDragging: boolean;
  /**
   * Another item is held over this one: where a drop lands.
   */
  isOver: boolean;
}

/**
 * One item of a {@link useSortableList}: the element both dragged and dropped
 * on, and only the pointer listener of `@dnd-kit`. The keyboard move is the
 * list's own (`onKeyDown`), on whichever element of the item takes focus.
 */
export const useSortableItem = (
  id: UniqueIdentifier,
  options: { disabled?: boolean } = {},
): SortableItem => {
  const disabled = !!options.disabled;
  const {
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id, disabled });
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id, disabled });
  return {
    ref: (node) => {
      setDragRef(node);
      setDropRef(node);
    },
    style: {
      transform: CSS.Translate.toString(transform),
      zIndex: isDragging ? 10 : undefined,
    },
    onPointerDown: disabled
      ? undefined
      : (listeners?.onPointerDown as
          | ((event: PointerEvent<HTMLElement>) => void)
          | undefined),
    isDragging,
    isOver: isOver && !isDragging,
  };
};
