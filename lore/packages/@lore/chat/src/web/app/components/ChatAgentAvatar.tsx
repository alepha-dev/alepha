import { FileImage, cn } from "@alepha/ui";
import {
  AgentAvatar,
  LoreLogoAnimated,
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
   * The built-in `@lore`, drawn as the Lore companion.
   */
  builtin?: boolean;
  /**
   * Size and shape: `size-[30px]` by default.
   */
  className?: string;
}

/**
 * A chat agent's picture (#E170, #Q4198): its uploaded avatar, or its
 * initials on a colour of its own when it has none or it fails to load.
 * Served from the authenticated file route: an agent's picture is read with
 * `chat:read`.
 *
 * The built-in `@lore` is the Lore companion herself, alive, in her portrait
 * framing (`LoreLogoAnimated`'s `portrait`): the agent of the product is the
 * one figure the product already has. She is decoration beside the name the
 * row prints, so the tile is hidden from assistive technology.
 */
const ChatAgentAvatar = (props: ChatAgentAvatarProps) => {
  const box = cn(
    "@container flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]",
    props.className ?? "size-[30px]",
  );
  if (props.builtin) {
    return (
      <span
        aria-hidden
        // Dark in both themes: the portrait is always light on dark.
        className={cn(box, "bg-neutral-950 dark:ring-1 dark:ring-white/10")}
        data-testid="chat-agent-avatar"
        data-builtin
      >
        <LoreLogoAnimated portrait className="size-full" />
      </span>
    );
  }
  if (!props.name) {
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
