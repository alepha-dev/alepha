import { useI18n } from "alepha/react/i18n";
import { Sparkles } from "lucide-react";

import { Badge } from "../core/Badge.tsx";
import { Spinner } from "../core/Spinner.tsx";
import { cn } from "../core/utils.ts";
import type { UseAiChat } from "./useAiChat.ts";

export interface AiChatLauncherProps {
  /**
   * The conversation the pill speaks for.
   */
  chat: UseAiChat;
  title?: string;
  onRestore: () => void;
  className?: string;
}

/**
 * A minimized assistant: a pill at the bottom corner that brings the panel
 * back, and still says what the conversation is doing, so folding it away
 * never hides an action waiting for the user's approval.
 */
export const AiChatLauncher = (props: AiChatLauncherProps) => {
  const { tr } = useI18n();
  const { chat } = props;
  const waiting = chat.pending?.kind === "confirm";
  const busy = chat.loading && !chat.pending;
  const title = props.title ?? tr("ai.chat.title", { default: "Assistant" });

  return (
    <button
      type="button"
      data-testid="ai-chat-launcher"
      onClick={props.onRestore}
      aria-label={tr("ai.chat.restore", {
        default: "Open $1",
        args: [title],
      })}
      className={cn(
        "bg-background text-foreground hover:bg-accent focus-visible:ring-ring/50 fixed end-4 bottom-4 z-40 inline-flex items-center gap-2 rounded-full border py-2 ps-3.5 pe-4 text-sm font-medium shadow-lg transition-colors outline-none focus-visible:ring-3",
        props.className,
      )}
    >
      {busy ? (
        <Spinner className="size-4" />
      ) : (
        <Sparkles className="text-primary size-4" />
      )}
      {title}
      {waiting && (
        <Badge variant="tint" tone="warning" aria-live="polite">
          {tr("ai.chat.awaiting", { default: "Action to approve" })}
        </Badge>
      )}
    </button>
  );
};
