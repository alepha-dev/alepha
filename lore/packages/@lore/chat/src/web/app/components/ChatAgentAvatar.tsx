import { FileImage, cn } from "@alepha/ui";
import {
  AgentAvatar,
  projectInitials,
  projectMonogramColor,
} from "@lore/core/web";

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
 * core's agent avatar, the bot, for `@lore`. Served from the authenticated file route: an agent's
 * picture is read with `chat:read`.
 */
const ChatAgentAvatar = (props: ChatAgentAvatarProps) => {
  const box = cn(
    "@container flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]",
    props.className ?? "size-[30px]",
  );
  if (props.builtin || !props.name) {
    // Core's agent avatar, the robot every agent with no icon of its own is
    // drawn as, a quest's agent assignee included (#Q4353).
    return (
      <span className="contents" data-testid="chat-agent-avatar">
        <AgentAvatar className={props.className ?? "size-[30px]"} />
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
