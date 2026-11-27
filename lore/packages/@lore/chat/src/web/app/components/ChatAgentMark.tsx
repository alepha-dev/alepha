import { cn } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Bot } from "lucide-react";

export interface ChatAgentMarkProps {
  className?: string;
}

/**
 * What says an author is an agent (#Q4511): a small muted robot beside the
 * name, quieter than the name and the time, where a violet "agent" pill
 * used to be. Named "Agent" for a screen reader and on hover.
 */
const ChatAgentMark = (props: ChatAgentMarkProps) => {
  const { tr } = useI18n<I18n, "en">();
  const label = tr("chat.agent.tag");
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-testid="chat-agent-mark"
      className={cn(
        "text-muted-foreground inline-flex shrink-0 self-center",
        props.className,
      )}
    >
      <Bot className="size-3.5" aria-hidden />
    </span>
  );
};

export default ChatAgentMark;
