import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { cn } from "@alepha/ui/lib/utils";

import type { ClaudeSession } from "../../api/schemas/claudeSessionSchema.ts";

export interface ClaudeIndicatorProps {
  claude: ClaudeSession;
  /**
   * Side-bar form: the mark alone.
   */
  compact?: boolean;
}

/**
 * What Claude is doing in a worktree, one mark per `activity`. Orange means
 * one thing only, working right now, so a glance down the column answers
 * "where is Claude busy" without reading:
 *
 * - **working**: a solid weft dot that breathes.
 * - **waiting**: a hollow grey ring. A session is open here and quiet.
 * - **stale**: a hollow amber ring. The lock outlived its session.
 * - **ended**: a small dim dot, with when the session last spoke.
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

  const mark = (
    <span
      className={cn(
        "shrink-0 rounded-full",
        activity === "working" && "bg-weft animate-weft size-2",
        activity === "waiting" &&
          "ring-muted-foreground size-2 ring-[1.5px] ring-inset",
        activity === "stale" && "ring-warn size-2 ring-[1.5px] ring-inset",
        activity === "ended" && "bg-muted-foreground/35 size-1.5",
      )}
    />
  );

  if (props.compact) {
    return (
      <span
        title={title}
        className="flex w-2 shrink-0 items-center justify-center"
      >
        {mark}
      </span>
    );
  }

  const state = {
    working: undefined,
    waiting: "waiting",
    stale: "stale lock",
    ended: "ended",
  }[activity];

  return (
    <span title={title} className="flex min-w-0 items-center gap-1.5">
      {mark}
      <span
        className={cn(
          "truncate",
          activity === "working" ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {name ?? "Claude"}
      </span>
      {state && (
        <span
          className={cn(
            "shrink-0 text-[12px]",
            activity === "stale" ? "text-warn" : "text-muted-foreground/80",
          )}
        >
          {state}
          {activity !== "stale" && claude.lastActivityAt && (
            <>
              {" · "}
              <TimeAgo value={claude.lastActivityAt} />
            </>
          )}
        </span>
      )}
    </span>
  );
};
