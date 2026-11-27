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
 * one figure the product already has, alone on the page with her wings
 * drawn past the slot (#Q4530). She is decoration beside the name the row
 * prints, so she is hidden from assistive technology.
 */
const ChatAgentAvatar = (props: ChatAgentAvatarProps) => {
  const box = cn(
    "@container flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]",
    props.className ?? "size-[30px]",
  );
  if (props.builtin) {
    // No tile and no clipping (#Q4530): the slot keeps its size in the
    // layout, and the canvas lies over it, `LoreSpritePortraitRenderer`'s
    // OVERFLOW (1.8) times its side, so her wings are drawn whole past its
    // edges. It catches no pointer: what is under a wing tip stays
    // clickable. She follows the theme.
    return (
      <span
        aria-hidden
        className={cn(
          "relative inline-block shrink-0",
          props.className ?? "size-[30px]",
          // A shape class meant for a picture has nothing to round here.
          "rounded-none",
        )}
        data-testid="chat-agent-avatar"
        data-builtin
      >
        <LoreLogoAnimated
          portrait
          className="pointer-events-none absolute -inset-[40%] size-[180%]"
        />
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
