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
 * spark, Gemini CLI's four-point star. Written out here, not fetched, so an
 * avatar costs no request.
 */
const AGENT_ICONS: Record<string, { box: string; icon: ReactNode }> = {
  claude: {
    box: "bg-[#f4e5dc] dark:bg-[#3a2a22]",
    icon: (
      <path
        d="M12.0 9.8L12.0 2.5M13.1 10.1L15.8 5.5M13.9 10.9L20.2 7.2M14.2 12.0L19.5 12.0M13.9 13.1L20.2 16.8M13.1 13.9L15.8 18.5M12.0 14.2L12.0 21.5M10.9 13.9L8.3 18.5M10.1 13.1L3.8 16.8M9.8 12.0L4.5 12.0M10.1 10.9L3.8 7.2M10.9 10.1L8.2 5.5"
        stroke="#d97757"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
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
