import { useI18n } from "alepha/react/i18n";
import { Ban, Check, X } from "lucide-react";

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
        className="bg-muted ml-10 self-end rounded-2xl rounded-br-md px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap"
      >
        {item.content}
      </div>
    );
  }

  return (
    <div
      data-testid="ai-chat-assistant"
      className="mr-4 self-start text-sm leading-relaxed"
    >
      <MarkdownView content={item.content} renderLink={props.renderLink} />
    </div>
  );
};
