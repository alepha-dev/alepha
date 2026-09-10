import { cn } from "@alepha/ui/lib/utils";
import { GitBranch, House } from "lucide-react";

import type { WorktreeState } from "../../api/schemas/worktreeStateSchema.ts";
import { ChangesBadge } from "./ChangesBadge.tsx";
import { CiIndicator } from "./CiIndicator.tsx";
import { ClaudeIndicator } from "./ClaudeIndicator.tsx";
import { VerifyIndicator } from "./VerifyIndicator.tsx";

export interface WorktreeItemProps {
  worktree: WorktreeState;
  selected: boolean;
  onOpen: () => void;
}

/**
 * One worktree in the side bar, decorated on the right the way VS Code
 * decorates a file: changes as letters, then CI, a flask while a local
 * `yarn v` runs or waits, then the Claude mark.
 */
export const WorktreeItem = (props: WorktreeItemProps) => {
  const worktree = props.worktree;
  const Icon = worktree.isMain ? House : GitBranch;

  return (
    <button
      type="button"
      onClick={props.onOpen}
      title={worktree.branch ?? worktree.head.slice(0, 7)}
      className={cn(
        "focus-visible:ring-ring flex h-[22px] w-full items-center gap-1.5 pr-3 pl-5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset",
        props.selected
          ? "bg-warp/20 text-accent-foreground"
          : "hover:bg-sidebar-accent",
        worktree.prunable && "text-muted-foreground line-through",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          worktree.isMain ? "text-warp" : "text-muted-foreground",
        )}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate">{worktree.name}</span>
      <ChangesBadge status={worktree.status} compact />
      <CiIndicator ci={worktree.ci} compact />
      <VerifyIndicator verify={worktree.verify} compact />
      <ClaudeIndicator claude={worktree.claude} compact />
    </button>
  );
};
