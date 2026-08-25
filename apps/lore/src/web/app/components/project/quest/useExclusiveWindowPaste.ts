import { useEffect, useRef } from "react";

/**
 * Every consumer listening for a window paste, in mount order.
 *
 * @see useExclusiveWindowPaste
 */
const listeners: Array<(event: ClipboardEvent) => void> = [];

/**
 * A window-level paste handler that runs in exactly ONE consumer.
 *
 * Binding to `window` is deliberate: a screenshot should land without hunting
 * for a drop target first, and a paste aimed at no field in particular has no
 * element to bubble from. The cost is that every mounted consumer hears it,
 * and Lore routinely has two - a quest's attachments row, and the edit or
 * duplicate sheet open over it - so one Ctrl+V produced two uploads.
 *
 * The last consumer to MOUNT wins: that is the sheet while it is open, and the
 * row underneath again the moment it closes. Mount order rather than focus,
 * because focus is exactly what a paste aimed at nothing does not have.
 *
 * `handler` is read through a ref, so a consumer that re-renders keeps its
 * place in the queue instead of jumping to the front of it.
 */
export const useExclusiveWindowPaste = (
  handler: (event: ClipboardEvent) => void,
  enabled = true,
): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const listener = (event: ClipboardEvent) => {
      if (listeners.at(-1) !== listener) return;
      handlerRef.current(event);
    };

    listeners.push(listener);
    window.addEventListener("paste", listener);

    return () => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
      window.removeEventListener("paste", listener);
    };
  }, [enabled]);
};
