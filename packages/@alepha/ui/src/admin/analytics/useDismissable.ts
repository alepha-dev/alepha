import { useEffect } from "react";

export interface DismissableOptions {
  open: boolean;
  onClose: () => void;
  /**
   * The attribute selector marking the popover's own subtree. A pointerdown
   * inside it is not a dismissal.
   */
  selector: string;
}

/**
 * Close a popover on Escape or on a pointer down outside it.
 *
 * `pointerdown` in the capture phase rather than `click`: a control inside the
 * popover that re-renders on mousedown can be gone by the time the click
 * lands, and the dismissal would then read the wrong target.
 */
export const useDismissable = (options: DismissableOptions): void => {
  const { open, onClose, selector } = options;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      // A pointerdown can land on a text node, which has no `closest`. Walk up
      // to the nearest element first rather than treating that as "outside".
      const node = event.target;
      const element =
        node instanceof Element
          ? node
          : node instanceof Node
            ? node.parentElement
            : null;
      if (element?.closest(selector)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, selector]);
};
