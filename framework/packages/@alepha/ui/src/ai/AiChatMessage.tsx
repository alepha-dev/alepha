import { useI18n } from "alepha/react/i18n";

import { cn } from "../core/utils.ts";
import { MarkdownView } from "../markdown/MarkdownView.tsx";
import type { AiChatItem } from "./useAiChat.ts";

export interface AiChatMessageProps {
  item: AiChatItem;
}

/**
 * One line of the conversation: the user's message as typed, the
 * assistant's as markdown, a tool call as a quiet one-liner.
 */
export const AiChatMessage = (props: AiChatMessageProps) => {
  const { tr } = useI18n();
  const item = props.item;

  if (item.role === "tool") {
    return (
      <div
        data-testid="ai-chat-tool"
        className={cn(
          "text-muted-foreground px-1 text-xs",
          item.isError && "text-danger-text",
        )}
      >
        {item.isError
          ? tr("ai.chat.toolFailed", {
              default: "$1 failed",
              args: [item.name ?? ""],
            })
          : tr("ai.chat.toolDone", {
              default: "Ran $1",
              args: [item.name ?? ""],
            })}
      </div>
    );
  }

  if (item.role === "user") {
    return (
      <div
        data-testid="ai-chat-user"
        className="bg-primary text-primary-foreground ml-8 self-end rounded-lg px-3 py-2 text-sm whitespace-pre-wrap"
      >
        {item.content}
      </div>
    );
  }

  return (
    <div data-testid="ai-chat-assistant" className="mr-8 self-start">
      <MarkdownView content={item.content} />
    </div>
  );
};
