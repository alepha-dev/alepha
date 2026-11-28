import {
  type CSSProperties,
  type HTMLAttributes,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";

/**
 * Where a drag started: the pointer, the offset then, and the card's box.
 */
interface AiChatFloatDragStart {
  pointerX: number;
  pointerY: number;
  base: { x: number; y: number };
  rect: DOMRect;
}

export interface UseAiChatFloatDrag {
  /**
   * The card's offset from its corner, for `AiChatFloat`'s `style`.
   */
  style: CSSProperties | undefined;
  /**
   * The handle's handlers, for `AiChatPanel`'s `headerProps`.
   */
  headerProps: HTMLAttributes<HTMLDivElement>;
}

/**
 * How far from the screen's edges a dragged card stays.
 */
const MARGIN = 8;

/**
 * Moves the floating assistant by its header, the way a chat
 * window is dragged: a pointer pressed on the header, not on one of its
 * buttons, carries the card, which never leaves the screen.
 *
 * The offset lives as long as the `AiChat` holding it, so a minimize or a
 * close keeps where the card was put; a reload, a resize of the window or a
 * double click on the header brings it back to its corner. A keyboard user
 * never moves it, and keeps the corner.
 */
export const useAiChatFloatDrag = (): UseAiChatFloatDrag => {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef<AiChatFloatDragStart>(undefined);

  useEffect(() => {
    const reset = () => setOffset({ x: 0, y: 0 });
    window.addEventListener("resize", reset);
    return () => window.removeEventListener("resize", reset);
  }, []);

  const clamp = (value: number, max: number) =>
    Math.max(MARGIN, Math.min(value, max - MARGIN));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    // A button, a link or a field in the header keeps its own click.
    if (
      (event.target as Element).closest?.(
        "button, a, input, textarea, select, [role='menuitem']",
      )
    ) {
      return;
    }
    const card = event.currentTarget.closest("[data-ai-chat-float]");
    if (!card) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      base: offset,
      rect: card.getBoundingClientRect(),
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (!from) return;
    // The button came up where no `pointerup` reached the header: the drag
    // is over, and hovering must not carry the card.
    if (event.buttons === 0) {
      start.current = undefined;
      return;
    }
    const left = clamp(
      from.rect.left + event.clientX - from.pointerX,
      window.innerWidth - from.rect.width,
    );
    const top = clamp(
      from.rect.top + event.clientY - from.pointerY,
      window.innerHeight - from.rect.height,
    );
    setOffset({
      x: from.base.x + left - from.rect.left,
      y: from.base.y + top - from.rect.top,
    });
  };

  const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return {
    style:
      offset.x || offset.y
        ? { transform: `translate(${offset.x}px, ${offset.y}px)` }
        : undefined,
    headerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture: () => {
        start.current = undefined;
      },
      onDoubleClick: (event) => {
        if (!(event.target as Element).closest?.("button, a")) {
          setOffset({ x: 0, y: 0 });
        }
      },
      className: "cursor-grab touch-none select-none active:cursor-grabbing",
    },
  };
};
