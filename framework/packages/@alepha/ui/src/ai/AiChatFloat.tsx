import { useI18n } from "alepha/react/i18n";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { cn } from "../core/utils.ts";

export interface AiChatFloatProps {
  children: ReactNode;
  className?: string;
  /**
   * Where a drag put the card (`useAiChatFloatDrag`).
   */
  style?: CSSProperties;
  /**
   * The card's accessible name, the panel's title. Defaults to "Assistant".
   */
  title?: string;
  /**
   * Given, the card is closing: it folds into this element, the app's
   * button for the chat, then calls `onFolded`. Straight away under reduced
   * motion, or when there is no element to fold into.
   */
  foldTo?: () => Element | null | undefined;
  /**
   * The fold is over: the card can go.
   */
  onFolded?: () => void;
}

/**
 * How long the fold takes.
 */
const FOLD_MS = 420;

/**
 * Folds `card` into `target` the way a window goes into a lamp: it narrows
 * toward the target first, then shrinks into it and fades, from its top
 * corner nearest the target. `undefined` where it cannot animate.
 */
const fold = (card: HTMLElement, target: Element): Animation | undefined => {
  if (
    typeof card.animate !== "function" ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return undefined;
  }
  const from = card.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  // From the card's top corner nearest the target, to the target's centre.
  const towardEnd = to.left + to.width / 2 > from.left + from.width / 2;
  const cornerX = towardEnd ? from.right : from.left;
  const dx = to.left + to.width / 2 - cornerX;
  const dy = to.top + to.height / 2 - from.top;
  // A drag put the card where it is with a transform: the fold starts there.
  const base = getComputedStyle(card).transform;
  const at = base && base !== "none" ? `${base} ` : "";
  const transformOrigin = `${towardEnd ? "right" : "left"} top`;
  return card.animate(
    [
      {
        transform: `${at}translate(0, 0) scale(1, 1)`,
        transformOrigin,
        opacity: 1,
      },
      {
        transform: `${at}translate(${dx * 0.35}px, ${dy * 0.35}px) scale(0.55, 0.8)`,
        transformOrigin,
        opacity: 0.95,
        offset: 0.45,
      },
      {
        transform: `${at}translate(${dx}px, ${dy}px) scale(0.04, 0.04)`,
        transformOrigin,
        opacity: 0,
      },
    ],
    {
      duration: FOLD_MS,
      easing: "cubic-bezier(0.55, 0, 0.75, 0.35)",
      fill: "forwards",
    },
  );
};

/**
 * The assistant as a card over the page's bottom corner, the way a support
 * chat sits: rounded, shadowed, a fixed size that never outgrows the screen.
 * No backdrop, no focus trap and nothing that closes it on a click
 * elsewhere, so the page under it stays usable while the conversation goes
 * on. Rendered into `document.body`, above the page's own layers. Closing,
 * it can fold into the app's button for the chat (`foldTo`).
 */
export const AiChatFloat = (props: AiChatFloatProps) => {
  const { tr } = useI18n();
  const [target, setTarget] = useState<Element>();
  const card = useRef<HTMLElement>(null);
  const folding = Boolean(props.foldTo);
  const onFolded = useRef(props.onFolded);
  onFolded.current = props.onFolded;

  // Closing: fold, then go. Opened again mid-fold, the card comes back
  // whole: the animation is cancelled.
  useLayoutEffect(() => {
    if (!folding || !card.current) return;
    const into = props.foldTo?.();
    // The focus was on the close button, in a card about to go: it follows
    // the card into the app's button.
    if (
      into instanceof HTMLElement &&
      card.current.contains(document.activeElement)
    ) {
      into.focus();
    }
    const animation = into ? fold(card.current, into) : undefined;
    if (!animation) {
      onFolded.current?.();
      return;
    }
    let done = false;
    animation.onfinish = () => {
      done = true;
      onFolded.current?.();
    };
    return () => {
      if (!done) animation.cancel();
    };
  }, [folding, target]);

  useEffect(() => {
    // After the commit: the server has no document.
    // oxlint-disable-next-line react/set-state-in-effect -- the portal target only exists in the browser
    setTarget(document.body);
  }, []);

  if (!target) {
    return null;
  }

  return createPortal(
    <section
      data-testid="ai-chat-float"
      ref={card}
      data-ai-chat-float=""
      data-folding={folding ? "" : undefined}
      inert={folding || undefined}
      style={props.style}
      aria-label={props.title ?? tr("ai.chat.title", { default: "Assistant" })}
      className={cn(
        "bg-card text-card-foreground fixed end-4 bottom-4 z-40 flex h-[min(44rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border text-sm shadow-2xl",
        "data-folding:pointer-events-none",
        props.className,
      )}
    >
      {props.children}
    </section>,
    target,
  );
};
