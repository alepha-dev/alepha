import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { FolderGit2 } from "lucide-react";

/**
 * The leftmost strip. One view today, worktrees; the script runner and the
 * file tree take the next slots.
 *
 * The active view is marked the way VS Code marks it, with a bar on its left
 * edge, in warp.
 */
export const ActivityBar = () => {
  return (
    <nav
      aria-label="Views"
      className="bg-frame border-sidebar-border flex w-12 shrink-0 flex-col items-center border-r"
    >
      <img
        src="/loom.svg"
        alt="Loom"
        width={22}
        height={22}
        className="my-3 opacity-90"
      />
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              aria-current="page"
              aria-label="Worktrees"
              className="text-foreground before:bg-warp relative flex h-12 w-12 items-center justify-center before:absolute before:inset-y-2 before:left-0 before:w-0.5"
            />
          }
        >
          <FolderGit2 className="size-6" strokeWidth={1.5} />
        </TooltipTrigger>
        <TooltipContent side="right">Worktrees</TooltipContent>
      </Tooltip>
    </nav>
  );
};
