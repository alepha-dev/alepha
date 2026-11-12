import type { AiController } from "alepha/api/ai";
import { useClient, useQuery } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { History } from "lucide-react";
import { useState } from "react";

import { Button } from "../core/Button.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../core/Popover.tsx";
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
 * The caller's past conversations, newest first, behind a header button:
 * the drawer belongs to the conversation, the list opens on demand and
 * closes once one is picked.
 */
export const AiChatHistory = (props: AiChatHistoryProps) => {
  const api = useClient<AiController>();
  const { tr, l } = useI18n();
  const [open, setOpen] = useState(false);
  const conversations = useQuery(
    {
      key: ["ai-conversations"],
      handler: () => api.listConversations(),
    },
    [api, props.current],
  );
  const list = conversations.data ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            size="icon-sm"
            variant="minimal"
            disabled={props.disabled}
            aria-label={tr("ai.chat.history", { default: "History" })}
          />
        }
      >
        <History className="size-4" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 gap-1 p-1.5"
        data-testid="ai-chat-history"
      >
        {list.length === 0 && (
          <p className="text-muted-foreground px-2 py-3 text-sm">
            {tr("ai.chat.noHistory", { default: "No conversation yet" })}
          </p>
        )}
        <div className="flex max-h-80 flex-col overflow-y-auto">
          {list.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              aria-current={
                conversation.id === props.current ? "true" : undefined
              }
              className={cn(
                "hover:bg-muted flex flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-start",
                conversation.id === props.current && "bg-muted",
              )}
              onClick={() => {
                setOpen(false);
                props.onOpen(conversation.id);
              }}
            >
              <span className="w-full truncate text-sm">
                {conversation.title ||
                  tr("ai.chat.untitled", {
                    default: "Untitled conversation",
                  })}
              </span>
              <span className="text-muted-foreground text-xs">
                {l(new Date(conversation.updatedAt), {
                  date: { dateStyle: "medium", timeStyle: "short" },
                })}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
