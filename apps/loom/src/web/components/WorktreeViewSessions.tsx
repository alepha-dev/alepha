import { useInject } from "alepha/react";
import { Asterisk, Brush, SearchCode } from "lucide-react";

import type { WorktreeState } from "../../api/schemas/worktreeStateSchema.ts";
import { ClaudeLinks } from "../services/ClaudeLinks.ts";
import { WorktreeViewSessionsLink } from "./WorktreeViewSessionsLink.tsx";

export interface WorktreeViewSessionsProps {
  worktree: WorktreeState;
  /**
   * The ref the worktree's divergence is measured against.
   */
  base: string;
}

/**
 * Buttons that open a new Claude Code session in the desktop app, in this
 * worktree: an empty one, one that investigates a failed CI run, and one
 * that cleans the worktree up. Each is a plain link to `claude://code/new`,
 * so the browser asks before opening the app and Loom runs nothing itself.
 * The prompt is typed, not sent: the session starts when the user says so.
 */
export const WorktreeViewSessions = (props: WorktreeViewSessionsProps) => {
  const links = useInject(ClaudeLinks);
  const worktree = props.worktree;
  const investigate = links.investigateCi(worktree);

  return (
    <div className="flex items-center gap-2">
      <WorktreeViewSessionsLink
        href={links.newSession(worktree.path)}
        label="New session"
        hint="A new Claude Code session in this worktree"
        icon={<Asterisk className="size-3.5" />}
      />
      {investigate && (
        <WorktreeViewSessionsLink
          href={links.newSession(worktree.path, investigate)}
          label="Investigate CI"
          hint="A session asked to find why the latest run failed"
          icon={<SearchCode className="size-3.5" />}
        />
      )}
      {!worktree.isMain && (
        <WorktreeViewSessionsLink
          href={links.newSession(
            worktree.path,
            links.cleanUp(worktree, props.base),
          )}
          label="Clean up"
          hint="A session asked to remove this worktree if its work is on main"
          icon={<Brush className="size-3.5" />}
        />
      )}
    </div>
  );
};
