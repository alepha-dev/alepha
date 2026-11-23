import {
  type DndContextProps,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  TouchSensor,
  type UniqueIdentifier,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { type KeyboardEvent, useId, useState } from "react";

/**
 * What a sortable list says to a screen reader as an item is moved from the
 * keyboard. The words are the app's, in its own language.
 */
export interface SortableListAnnouncements {
  picked: (label: string) => string;
  moved: (label: string, position: number, total: number) => string;
  dropped: (label: string) => string;
  cancelled: (label: string) => string;
}

export interface UseSortableListOptions<Id extends UniqueIdentifier> {
  /**
   * The order the app holds, as the server last answered it.
   */
  ids: readonly Id[];
  /**
   * A drop that changed the order: `next` is the whole list as now shown,
   * `previous` the order it replaced, for a save that puts it back on a
   * refusal. The list keeps showing `next` until `ids` changes.
   */
  onReorder: (next: Id[], previous: Id[]) => void;
  /**
   * The item's name, for the announcements.
   */
  labelOf: (id: Id) => string;
  announcements: SortableListAnnouncements;
  /**
   * How far a pointer moves before a press becomes a drag, in pixels, so a
   * plain click stays a click. Default 6.
   */
  activationDistance?: number;
  /**
   * Called as a pointer drag starts: a list of links swallows the click the
   * drop ends with, for one.
   */
  onDragStart?: () => void;
}

export interface SortableList<Id extends UniqueIdentifier> {
  /**
   * The order to draw: the one held after a drop or a keyboard step, until
   * `ids` catches up, else `ids`.
   */
  order: Id[];
  /**
   * Spread on the `DndContext` around the list.
   */
  contextProps: Pick<
    DndContextProps,
    | "id"
    | "sensors"
    | "modifiers"
    | "autoScroll"
    | "onDragStart"
    | "onDragEnd"
    | "onDragCancel"
  >;
  /**
   * The keyboard move, for the item's focusable element: Space picks it up,
   * the arrows move it, Space or Enter drops it and Escape (or Tab) puts it
   * back.
   */
  onKeyDown: (id: Id) => (event: KeyboardEvent<HTMLElement>) => void;
  /**
   * The item held by the keyboard, if any.
   */
  picked: Id | undefined;
  /**
   * True while a pointer drag runs.
   */
  dragging: boolean;
  /**
   * The live region's text: render it in an `aria-live="assertive"` element.
   */
  announcement: string;
}

/**
 * A vertical list reordered by dragging or from the keyboard, on `@dnd-kit`
 * (pointer and touch sensors, and a keyboard move of its own).
 *
 * It holds what every such list needs and nothing of how it looks: the
 * activation distance, a vertical-only modifier that keeps an item inside the
 * list, the drop index, the order held between a drop and the server's
 * answer, and the keyboard move with its screen-reader announcements. Each
 * item uses {@link useSortableItem}; the list draws `order` inside a
 * `DndContext` given `contextProps`.
 *
 * The keyboard move is the list's own rather than `@dnd-kit`'s
 * `KeyboardSensor`: it moves by one place per arrow, inside a list that may
 * scroll, and says where the item is at each step.
 */
export const useSortableList = <Id extends UniqueIdentifier>(
  options: UseSortableListOptions<Id>,
): SortableList<Id> => {
  const dndId = useId();
  const key = options.ids.join("\u0000");
  // The order shown before the app holds it, and the order the app held
  // when it was set: once `ids` moves (the save read back, or the server
  // said otherwise) it hands back to `ids`.
  const [pending, setPending] = useState<
    { order: Id[]; base: string } | undefined
  >();
  const [picked, setPicked] = useState<{ id: Id; before: Id[] } | undefined>();
  const [dragging, setDragging] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: options.activationDistance ?? 6 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );

  // Adjusted during render, React's "adjust state when a prop changes": the
  // held order never outlives the answer, and no effect runs a second pass.
  if (pending && !picked && pending.base !== key) {
    setPending(undefined);
  }
  const order = pending ? pending.order : [...options.ids];

  const move = (list: Id[], from: number, to: number): Id[] => {
    const next = [...list];
    next.splice(to, 0, ...next.splice(from, 1));
    return next;
  };

  const save = (next: Id[], previous: Id[]) => {
    setPending({ order: next, base: key });
    options.onReorder(next, previous);
  };

  // One column: an item moves up and down it, never sideways, and never
  // past its ends.
  const vertical: Modifier = ({
    transform,
    draggingNodeRect,
    containerNodeRect,
  }) => {
    let y = transform.y;
    if (draggingNodeRect && containerNodeRect) {
      y = Math.min(
        Math.max(y, containerNodeRect.top - draggingNodeRect.top),
        containerNodeRect.bottom - draggingNodeRect.bottom,
      );
    }
    return { ...transform, x: 0, y };
  };

  const onDragEnd = (event: DragEndEvent) => {
    setDragging(false);
    const from = order.findIndex((id) => id === event.active.id);
    const to = event.over ? order.findIndex((id) => id === event.over!.id) : -1;
    if (from < 0 || to < 0 || from === to) return;
    save(move(order, from, to), order);
  };

  const onKeyDown = (id: Id) => (event: KeyboardEvent<HTMLElement>) => {
    const label = options.labelOf(id);
    const held = picked?.id === id;
    if (event.key === " " && !held) {
      event.preventDefault();
      setPicked({ id, before: order });
      setAnnouncement(options.announcements.picked(label));
      return;
    }
    if (!held) return;
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const from = order.indexOf(id);
      const to = from + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= order.length) return;
      // Drawn now, saved on the drop.
      setPending({ order: move(order, from, to), base: key });
      setAnnouncement(options.announcements.moved(label, to + 1, order.length));
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      setPicked(undefined);
      setAnnouncement(options.announcements.dropped(label));
      if (order.join("\u0000") !== picked.before.join("\u0000")) {
        save(order, picked.before);
      } else {
        setPending(undefined);
      }
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      setPending(undefined);
      setPicked(undefined);
      setAnnouncement(options.announcements.cancelled(label));
    }
  };

  return {
    order,
    contextProps: {
      id: dndId,
      sensors,
      modifiers: [vertical],
      // Vertical only: the column has nothing to scroll sideways.
      autoScroll: { threshold: { x: 0, y: 0.2 } },
      onDragStart: () => {
        setDragging(true);
        options.onDragStart?.();
      },
      onDragEnd,
      onDragCancel: () => setDragging(false),
    },
    onKeyDown,
    picked: picked?.id,
    dragging,
    announcement,
  };
};
