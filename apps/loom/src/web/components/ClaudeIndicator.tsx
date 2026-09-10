import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { cn } from "@alepha/ui/lib/utils";

import type { ClaudeSession } from "../../api/schemas/claudeSessionSchema.ts";

export interface ClaudeIndicatorProps {
  claude: ClaudeSession;
  /**
   * Side-bar form: the dot alone.
   */
  compact?: boolean;
}

/**
 * What Claude is doing in a worktree, one dot per `activity`:
 *
 * - **working**: a weft dot that breathes, the one animated thing in Loom.
 * - **waiting**: a still weft dot. A session is open here and quiet.
 * - **stale**: a hollow warn ring. The lock outlived its session.
 * - **ended**: a grey dot, with when the session last spoke.
 */
export const ClaudeIndicator = (props: ClaudeIndicatorProps) => {
  const claude = props.claude;
  const activity = claude.activity;
  const name = claude.title ?? claude.lock?.session;

  if (activity === "none") {
    return props.compact ? null : (
      <span className="text-muted-foreground">-</span>
    );
  }

  const title = {
    working: `Claude is working here${name ? `: ${name}` : ""}`,
    waiting: `A Claude session is open here and waiting${name ? `: ${name}` : ""}`,
    stale: `Stale lock: session ${claude.lock?.session} (pid ${claude.lock?.pid}) has ended`,
    ended: `Claude was last here${name ? `: ${name}` : ""}`,
  }[activity];

  const dot = (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        activity === "working" && "bg-weft animate-weft",
        activity === "waiting" && "bg-weft/70",
        activity === "stale" && "ring-warn ring-[1.5px] ring-inset",
        activity === "ended" && "bg-muted-foreground/40",
      )}
    />
  );

  if (props.compact) {
    return (
      <span title={title} className="flex w-2 shrink-0 items-center">
        {dot}
      </span>
    );
  }

  return (
    <span title={title} className="flex min-w-0 items-center gap-1.5">
      {dot}
      <span
        className={cn(
          "truncate",
          activity === "working" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {activity === "stale" ? "Stale lock" : (name ?? "Claude")}
      </span>
      {activity !== "working" &&
        activity !== "stale" &&
        claude.lastActivityAt && (
          <span className="text-muted-foreground shrink-0 text-[12px]">
            <TimeAgo value={claude.lastActivityAt} />
          </span>
        )}
    </span>
  );
};
