import type { AiController } from "alepha/api/ai";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";

import { Button } from "../core/Button.tsx";
import { cn } from "../core/utils.ts";

export interface AiChatHistoryProps {
  /**
   * The conversation on screen, highlighted.
   */
  current?: string;
  disabled?: boolean;
  onOpen: (id?: string) => void;
}

/**
 * The caller's past conversations, newest first, and a way to start a new
 * one.
 */
export const AiChatHistory = (props: AiChatHistoryProps) => {
  const api = useClient<AiController>();
  const { tr } = useI18n();
  const conversations = useQuery(
    {
      key: ["ai-conversations"],
      handler: () => api.listConversations(),
    },
    [api, props.current],
  );

  return (
    <div data-testid="ai-chat-history" className="flex flex-col gap-1">
      <Button
        variant="outlined"
        size="sm"
        disabled={props.disabled}
        onClick={() => props.onOpen(undefined)}
      >
        {tr("ai.chat.new", { default: "New conversation" })}
      </Button>
      {(conversations.data ?? []).map((conversation) => (
        <Button
          key={conversation.id}
          variant="minimal"
          size="sm"
          disabled={props.disabled}
          className={cn(
            "justify-start truncate",
            conversation.id === props.current && "bg-muted",
          )}
          onClick={() => props.onOpen(conversation.id)}
        >
          {conversation.title ||
            tr("ai.chat.untitled", { default: "Untitled conversation" })}
        </Button>
      ))}
    </div>
  );
};
