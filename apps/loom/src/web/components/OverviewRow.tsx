import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { cn } from "@alepha/ui/lib/utils";

import type { WorktreeState } from "../../api/schemas/worktreeStateSchema.ts";
import { ChangesBadge } from "./ChangesBadge.tsx";
import { CiIndicator } from "./CiIndicator.tsx";
import { ClaudeIndicator } from "./ClaudeIndicator.tsx";
import { QuestChips } from "./QuestChips.tsx";
import { VerifyIndicator } from "./VerifyIndicator.tsx";
import { Weave } from "./Weave.tsx";

export interface OverviewRowProps {
  worktree: WorktreeState;
  onOpen: () => void;
}

/**
 * One worktree in the overview. The whole row opens the worktree's tab,
 * except where a cell is itself a link (a CI run, a quest, a port), which
 * keeps its own meaning. The name is the row's real button, for the keyboard.
 */
export const OverviewRow = (props: OverviewRowProps) => {
  const worktree = props.worktree;
  const cell = "border-border/60 border-b px-3 py-2 align-middle";

  return (
    <tr
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("a, button")) {
          props.onOpen();
        }
      }}
      className={cn(
        "hover:bg-accent/40",
        worktree.prunable && "text-muted-foreground",
      )}
    >
      <td className={cn(cell, "pl-6")}>
        <Weave divergence={worktree.divergence} isMain={worktree.isMain} />
      </td>
      <td className={cell}>
        <button
          type="button"
          onClick={props.onOpen}
          className="focus-visible:ring-ring block max-w-full truncate rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-1"
        >
          {worktree.name}
        </button>
        <div className="text-muted-foreground truncate font-mono text-[11px]">
          {worktree.prunable
            ? "directory gone"
            : (worktree.branch ?? `detached at ${worktree.head.slice(0, 7)}`)}
        </div>
      </td>
      <td className={cell}>
        <ChangesBadge status={worktree.status} />
      </td>
      <td className={cell}>
        <CiIndicator ci={worktree.ci} />
      </td>
      <td className={cell}>
        <VerifyIndicator verify={worktree.verify} />
      </td>
      <td className={cell}>
        <QuestChips quests={worktree.quests} max={2} />
      </td>
      <td className={cell}>
        <ClaudeIndicator claude={worktree.claude} />
      </td>
      <td className={cell}>
        {worktree.devServers.length === 0 ? (
          <span className="text-muted-foreground">-</span>
        ) : (
          <span className="flex flex-wrap gap-x-2">
            {worktree.devServers.map((server) => (
              <a
                key={`${server.pid}:${server.port}`}
                href={`http://localhost:${server.port}`}
                target="_blank"
                rel="noreferrer"
                title={`${server.command} (pid ${server.pid}) in ${server.cwd}`}
                className="text-weft font-mono text-[12px] hover:underline"
              >
                :{server.port}
              </a>
            ))}
          </span>
        )}
      </td>
      <td className={cn(cell, "text-muted-foreground whitespace-nowrap")}>
        {worktree.createdAt ? <TimeAgo value={worktree.createdAt} /> : "-"}
      </td>
      <td className={cn(cell, "pr-6")}>
        {worktree.lastCommit ? (
          <>
            <div className="truncate" title={worktree.lastCommit.subject}>
              {worktree.lastCommit.subject}
            </div>
            <div className="text-muted-foreground truncate text-[11px]">
              <TimeAgo value={worktree.lastCommit.date} /> ·{" "}
              {worktree.lastCommit.author}
            </div>
          </>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </td>
    </tr>
  );
};
