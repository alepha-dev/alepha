import { useI18n } from "alepha/react/i18n";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
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
}

/**
 * The assistant as a card over the page's bottom corner, the way a support
 * chat sits: rounded, shadowed, a fixed size that never outgrows the screen.
 * No backdrop, no focus trap and nothing that closes it on a click
 * elsewhere, so the page under it stays usable while the conversation goes
 * on. Rendered into `document.body`, above the page's own layers.
 */
export const AiChatFloat = (props: AiChatFloatProps) => {
  const { tr } = useI18n();
  const [target, setTarget] = useState<Element>();

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
      data-ai-chat-float=""
      style={props.style}
      aria-label={props.title ?? tr("ai.chat.title", { default: "Assistant" })}
      className={cn(
        "bg-card text-card-foreground fixed end-4 bottom-4 z-40 flex h-[min(44rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border text-sm shadow-2xl",
        props.className,
      )}
    >
      {props.children}
    </section>,
    target,
  );
};
