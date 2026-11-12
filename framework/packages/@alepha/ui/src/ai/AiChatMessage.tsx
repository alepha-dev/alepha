import { useI18n } from "alepha/react/i18n";
import { Ban, Check, Scissors, X } from "lucide-react";

import { Button } from "../core/Button.tsx";
import { cn } from "../core/utils.ts";
import {
  type MarkdownLinkRenderer,
  MarkdownView,
} from "../markdown/MarkdownView.tsx";
import type { AiChatItem } from "./useAiChat.ts";

export interface AiChatMessageProps {
  item: AiChatItem;
  /**
   * How the assistant's links render. See `MarkdownView`'s `renderLink`.
   */
  renderLink?: MarkdownLinkRenderer;
  /**
   * The words a tool step shows: `AiChat`'s `toolLabel`.
   */
  toolLabel?: AiChatToolLabel;
  /**
   * Asks the assistant to go on, from the notice under a reply that was cut
   * short. Absent, the notice shows without its button: `AiChatPanel` passes
   * it on the last line only, and never while a turn runs.
   */
  onContinue?: () => void;
}

/**
 * Names a tool step in the user's words ("Searched clients") instead of the
 * tool's own name. Return undefined to keep the default line.
 */
export type AiChatToolLabel = (
  name: string,
  state: "running" | "done" | "failed" | "denied",
) => string | undefined;

/**
 * One line of the conversation: the user's message as typed, the
 * assistant's as markdown, a tool call as a quiet one-liner.
 */
export const AiChatMessage = (props: AiChatMessageProps) => {
  const { tr } = useI18n();
  const item = props.item;

  if (item.role === "tool") {
    const name = item.name ?? "";
    const state = item.denied ? "denied" : item.isError ? "failed" : "done";
    const label =
      props.toolLabel?.(name, state) ??
      (state === "denied"
        ? tr("ai.chat.toolDenied", { default: "$1 cancelled", args: [name] })
        : state === "failed"
          ? tr("ai.chat.toolFailed", { default: "$1 failed", args: [name] })
          : tr("ai.chat.toolDone", { default: "Ran $1", args: [name] }));
    return (
      <div
        data-testid="ai-chat-tool"
        className={cn(
          "text-muted-foreground flex items-center gap-1.5 px-0.5 text-xs",
          state === "failed" && "text-danger-text",
        )}
      >
        {state === "denied" ? (
          <Ban className="size-3.5 shrink-0" />
        ) : state === "failed" ? (
          <X className="size-3.5 shrink-0" />
        ) : (
          <Check className="text-success-text size-3.5 shrink-0" />
        )}
        <span>{label}</span>
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div
        data-testid="ai-chat-user"
        className="bg-muted ms-10 self-end rounded-2xl rounded-ee-md px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap"
      >
        {item.content}
      </div>
    );
  }

  return (
    <div
      data-testid="ai-chat-assistant"
      className="me-4 self-start text-sm leading-relaxed"
    >
      {item.content ? (
        <MarkdownView content={item.content} renderLink={props.renderLink} />
      ) : null}
      {item.cut ? (
        <div
          data-testid="ai-chat-cut"
          role="status"
          className="text-warning-text mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        >
          <Scissors className="size-3.5 shrink-0" />
          <span>
            {tr("ai.chat.cut", {
              default:
                "This answer was cut short: it reached the length limit. Ask a narrower question, or continue.",
            })}
          </span>
          {props.onContinue ? (
            <Button
              type="button"
              variant="outlined"
              size="xs"
              onClick={props.onContinue}
            >
              {tr("ai.chat.continue", { default: "Continue" })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};
