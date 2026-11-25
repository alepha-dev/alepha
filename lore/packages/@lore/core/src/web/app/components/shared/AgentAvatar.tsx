import { cn } from "@alepha/ui";
import { Bot } from "lucide-react";
import type { ReactNode } from "react";

export interface AgentAvatarProps {
  /**
   * The agent CLI, by the adapter name a job records (`claude`, `gemini`).
   * Absent or unknown, the robot.
   */
  agent?: string;
  /**
   * Size and shape: `size-[30px]` by default.
   */
  className?: string;
}

/**
 * An agent's picture (#Q4353): the icon of the agent CLI it runs, on the
 * rounded square chat draws an agent in, and the robot for an agent with no
 * known icon. What a quest's agent assignee and chat's built-in `@lore`
 * both draw, so Lore has one set of agent icons.
 */
export const AgentAvatar = (props: AgentAvatarProps) => {
  const known = props.agent ? AGENT_ICONS[props.agent] : undefined;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-[9px]",
        known ? known.box : "bg-primary/10 text-primary",
        props.className ?? "size-[30px]",
      )}
      data-testid="agent-avatar"
      data-agent={known ? props.agent : "unknown"}
    >
      {known ? (
        <svg
          viewBox="0 0 24 24"
          className="size-[70%]"
          aria-hidden="true"
          data-testid="agent-avatar-icon"
        >
          {known.icon}
        </svg>
      ) : (
        <Bot
          className="size-[55%]"
          aria-hidden="true"
          data-testid="agent-avatar-robot"
        />
      )}
    </span>
  );
};

/**
 * Each agent CLI Bay has an adapter for, drawn as its mark: Claude Code's
 * official spark on its orange, Gemini CLI's four-point star. Written out here, not fetched, so an
 * avatar costs no request.
 */
const AGENT_ICONS: Record<string, { box: string; icon: ReactNode }> = {
  // The mark the owner supplied (#Q4410), traced: the white spark on
  // Claude's orange.
  claude: {
    box: "bg-[#d97757]",
    icon: (
      <path
        d="M12.53 11.21L8.51 1.56L7.59 1.1L6.67 1.52L6.42 2.53L11.18 11.83ZM12.97 11.58L14.66 2.16L14.2 1.38L13.32 1.25L12.65 1.86L11.5 11.36ZM13.14 12.1L19.62 4.95L19.65 4.04L18.97 3.46L18.07 3.63L12.01 11.14ZM12.9 12.79L22.45 11.88L23.08 11.23L22.97 10.34L22.2 9.86L12.71 11.31ZM12.63 13.01L21.97 15.35L22.73 14.98L22.92 14.16L22.39 13.5L12.96 11.56ZM12.17 13.14L19.05 19.35L19.96 19.38L20.54 18.7L20.37 17.8L13.13 12.01ZM11.71 13.05L15.25 22.16L16.05 22.59L16.88 22.24L17.12 21.37L13.08 12.47ZM11.33 12.73L10.18 21.8L10.64 22.51L11.47 22.6L12.06 21.99L12.81 12.89ZM11.16 11.91L3.49 16.85L3.22 17.72L3.73 18.46L4.64 18.52L12.0 13.13ZM11.49 11.37L1.47 10.81L0.79 11.31L0.76 12.15L1.4 12.7L11.43 12.85ZM12.02 11.14L4.18 5.07L3.21 5.12L2.66 5.89L2.92 6.83L11.15 12.34ZM9.84 12.14a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0Z"
        fill="#fff"
      />
    ),
  },
  gemini: {
    box: "bg-[#e3ecfd] dark:bg-[#1e2a42]",
    icon: (
      <path
        d="M12 2C12 7.5 16.5 12 22 12C16.5 12 12 16.5 12 22C12 16.5 7.5 12 2 12C7.5 12 12 7.5 12 2Z"
        fill="#4b8cf5"
      />
    ),
  },
};

export default AgentAvatar;
