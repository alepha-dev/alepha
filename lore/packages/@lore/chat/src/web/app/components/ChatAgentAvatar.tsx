import { FileImage, cn } from "@alepha/ui";
import { projectInitials, projectMonogramColor } from "@lore/core/web";
import { Bot } from "lucide-react";

export interface ChatAgentAvatarProps {
  /**
   * The agent's name, whose initials are drawn when it has no picture.
   */
  name: string;
  /**
   * Its picture, a file of the `chat-agent-avatars` bucket.
   */
  avatarId?: string;
  /**
   * The built-in `@lore`, drawn as the bot it always was.
   */
  builtin?: boolean;
  /**
   * Size and shape: `size-[30px]` by default.
   */
  className?: string;
}

/**
 * A chat agent's picture (#E170, #Q4198): its uploaded avatar, or its
 * initials on a colour of its own when it has none or it fails to load, and
 * the bot for `@lore`. Served from the authenticated file route: an agent's
 * picture is read with `chat:read`.
 */
const ChatAgentAvatar = (props: ChatAgentAvatarProps) => {
  const box = cn(
    "@container flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]",
    props.className ?? "size-[30px]",
  );
  if (props.builtin || !props.name) {
    return (
      <span
        className={cn(box, "bg-primary/10 text-primary")}
        data-testid="chat-agent-avatar"
      >
        <Bot className="size-[55%]" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className={box} data-testid="chat-agent-avatar">
      <FileImage
        id={props.avatarId}
        alt=""
        className="size-full object-cover"
        fallback={
          <span
            aria-hidden
            data-testid="chat-agent-initials"
            className={cn(
              "flex size-full items-center justify-center text-[42cqw] leading-none font-semibold select-none",
              projectMonogramColor(props.name),
            )}
          >
            {projectInitials(props.name)}
          </span>
        }
      />
    </span>
  );
};

export default ChatAgentAvatar;
