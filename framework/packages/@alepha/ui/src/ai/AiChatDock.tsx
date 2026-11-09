import { useI18n } from "alepha/react/i18n";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../core/utils.ts";
import { AI_CHAT_DOCK_SLOT } from "./AiChatDockSlot.tsx";

/**
 * The clamp on the dock's width. Narrower than 320px and a confirmation card
 * wraps every field; wider than 640px and the page it sits beside is what
 * suffers.
 */
export const AI_CHAT_DOCK_MIN = 320;
export const AI_CHAT_DOCK_MAX = 640;
export const AI_CHAT_DOCK_DEFAULT = 384;

const STORAGE_KEY = "alepha.ui.ai.dockWidth";

const clamp = (value: number): number =>
  Math.max(AI_CHAT_DOCK_MIN, Math.min(AI_CHAT_DOCK_MAX, Math.round(value)));

export interface AiChatDockProps {
  children: ReactNode;
  className?: string;
}

/**
 * The assistant beside the page, not over it: no backdrop, no focus trap,
 * nothing that closes it on a click elsewhere, so the page stays readable
 * and usable while the conversation goes on, and a link in a reply changes
 * the page next to it. It renders into the layout's `AiChatDockSlot`, which
 * narrows the page to make room, and its left edge drags to resize; the
 * width is remembered in this browser.
 */
export const AiChatDock = (props: AiChatDockProps) => {
  const { tr } = useI18n();
  const [target, setTarget] = useState<{ node: Element; slot: boolean }>();
  const [width, setWidth] = useState(AI_CHAT_DOCK_DEFAULT);
  const drag = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    // After the commit, not in an initializer: the server has no document,
    // and the slot is a sibling the same commit mounts.
    const slot = document.querySelector(`[data-slot="${AI_CHAT_DOCK_SLOT}"]`);
    // oxlint-disable-next-line react/set-state-in-effect -- the portal target only exists after the commit, see above
    setTarget(
      slot ? { node: slot, slot: true } : { node: document.body, slot: false },
    );
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setWidth(clamp(Number(stored)));
    } catch {
      // Private mode, or storage denied: the default width is a fine answer.
    }
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!drag.current) return;
      // The handle is on the left edge: dragging left widens the dock.
      setWidth(clamp(drag.current.width - (event.clientX - drag.current.x)));
    };
    const onUp = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.removeProperty("cursor");
      try {
        window.localStorage.setItem(STORAGE_KEY, String(width));
      } catch {
        // Losing the preference is not worth an error.
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
      // Keeps the resize cursor while the pointer outruns the strip.
      document.body.style.cursor = "col-resize";
      event.preventDefault();
    },
    [width],
  );

  if (!target) {
    return null;
  }

  return createPortal(
    <aside
      data-testid="ai-chat-dock"
      aria-label={tr("ai.chat.title", { default: "Assistant" })}
      style={{ width }}
      className={cn(
        "bg-card text-card-foreground relative flex flex-col overflow-hidden rounded-xl border text-sm shadow-sm",
        target.slot
          ? // In the layout's column: a card the page narrows for, kept in
            // view when the page itself scrolls.
            "sticky top-2 my-2 me-2 h-[calc(100%-1rem)] max-h-[calc(100svh-1rem)]"
          : // No slot: over the page's right edge, still without a backdrop.
            "fixed inset-y-2 end-2 z-40 shadow-2xl",
        props.className,
      )}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={tr("ai.chat.resize", { default: "Resize the assistant" })}
        onPointerDown={startResize}
        className="hover:bg-primary/20 absolute inset-y-0 start-0 z-10 w-1.5 cursor-col-resize transition-colors"
      />
      {props.children}
    </aside>,
    target.node,
  );
};
