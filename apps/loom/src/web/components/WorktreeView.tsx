import TimeAgo from "@alepha/ui/components/time-ago/time-ago";
import { Button } from "@alepha/ui/components/ui/button";
import { useToast } from "@alepha/ui/components/use-toast/use-toast";
import {
  Asterisk,
  FolderGit2,
  GitBranch,
  House,
  Radio,
  ScrollText,
  Workflow,
} from "lucide-react";

import type { ProjectState } from "../../api/schemas/projectStateSchema.ts";
import type { WorktreeState } from "../../api/schemas/worktreeStateSchema.ts";
import { ChangesBadge } from "./ChangesBadge.tsx";
import { CiIndicator } from "./CiIndicator.tsx";
import { ClaudeIndicator } from "./ClaudeIndicator.tsx";
import { DetailGroup } from "./DetailGroup.tsx";
import { DetailRow } from "./DetailRow.tsx";
import { QuestChips } from "./QuestChips.tsx";
import { VerifyIndicator } from "./VerifyIndicator.tsx";
import { Weave } from "./Weave.tsx";
import { WorktreeViewSessions } from "./WorktreeViewSessions.tsx";

export interface WorktreeViewProps {
  path: string;
  worktree?: WorktreeState;
  state?: ProjectState;
}

/**
 * Everything Loom knows about one worktree, grouped by where it comes from:
 * git, CI, Lore, Claude, what it serves, and the worktree itself.
 */
export const WorktreeView = (props: WorktreeViewProps) => {
  const toast = useToast();
  const worktree = props.worktree;

  if (!worktree) {
    return (
      <p className="text-muted-foreground px-6 py-5">
        {props.state
          ? `${props.path} is no longer a worktree of this project.`
          : "Reading worktrees..."}
      </p>
    );
  }

  const Icon = worktree.isMain ? House : GitBranch;
  const status = worktree.status;
  const ci = worktree.ci;
  const claude = worktree.claude;

  const copyPath = async () => {
    await navigator.clipboard.writeText(worktree.path);
    toast.success("Copied the path");
  };

  return (
    <div className="flex max-w-6xl flex-col gap-5 px-6 py-5">
      <header className="flex flex-wrap items-center gap-3">
        <Icon
          className={
            worktree.isMain
              ? "text-warp size-5"
              : "text-muted-foreground size-5"
          }
          strokeWidth={1.75}
        />
        <h1 className="text-[20px] font-semibold tracking-tight">
          {worktree.name}
        </h1>
        {worktree.branch && (
          <span className="bg-muted rounded-sm px-1.5 py-0.5 font-mono text-[12px]">
            {worktree.branch}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <WorktreeViewSessions
            worktree={worktree}
            root={props.state?.project.path ?? worktree.path}
            base={props.state?.base ?? "origin/main"}
          />
          <span className="bg-border mx-1 h-5 w-px" />
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={`vscode://file${worktree.path}`} />}
          >
            Open in VS Code
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void copyPath()}>
            Copy path
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <DetailGroup title="Git" icon={GitBranch}>
          <DetailRow label="HEAD" mono>
            {worktree.head.slice(0, 10)}
            {!worktree.branch && " (detached)"}
          </DetailRow>
          {!worktree.isMain && (
            <DetailRow label={`vs ${props.state?.base ?? "base"}`}>
              <Weave divergence={worktree.divergence} isMain={false} />
            </DetailRow>
          )}
          <DetailRow label="Changes">
            <ChangesBadge status={status} />
          </DetailRow>
          <DetailRow label="Upstream" mono>
            {status?.upstream ? (
              <>
                {status.upstream}
                <span className="text-muted-foreground">
                  {" "}
                  ({status.ahead} to push, {status.behind} to pull)
                </span>
              </>
            ) : (
              <span className="text-muted-foreground font-sans">
                not pushed
              </span>
            )}
          </DetailRow>
          {worktree.lastCommit && (
            <DetailRow label="Last commit">
              {worktree.lastCommit.subject}
              <div className="text-muted-foreground text-[12px]">
                <span className="font-mono">
                  {worktree.lastCommit.sha.slice(0, 7)}
                </span>{" "}
                · {worktree.lastCommit.author} ·{" "}
                <TimeAgo value={worktree.lastCommit.date} />
              </div>
            </DetailRow>
          )}
          <DetailRow label="Stash">
            {worktree.stashes > 0
              ? `${worktree.stashes} ${worktree.stashes === 1 ? "entry" : "entries"} on this branch`
              : "none"}
          </DetailRow>
        </DetailGroup>

        <DetailGroup
          title="CI"
          icon={Workflow}
          aside={ci && <CiIndicator ci={ci} />}
        >
          {ci ? (
            <>
              <DetailRow label="Workflow">{ci.name}</DetailRow>
              <DetailRow label="State">
                {ci.status === "completed"
                  ? (ci.conclusion ?? "completed")
                  : `${ci.status.replace("_", " ")}, ${ci.progress ?? 0}%`}
              </DetailRow>
              {ci.jobs && (
                <DetailRow label="Jobs">
                  {ci.jobs.completed} of {ci.jobs.total} done
                  {ci.jobs.failed > 0 && (
                    <span className="text-fail">, {ci.jobs.failed} failed</span>
                  )}
                </DetailRow>
              )}
              <DetailRow label="Started">
                <TimeAgo value={ci.startedAt} />
              </DetailRow>
              <DetailRow label="Commit" mono>
                {ci.headSha.slice(0, 10)}
                {ci.headSha !== worktree.head && (
                  <span className="text-warn font-sans"> (not HEAD)</span>
                )}
              </DetailRow>
            </>
          ) : (
            <DetailRow label="Runs">
              <span className="text-muted-foreground">
                {props.state?.sources.gh
                  ? "No run for this branch."
                  : "GitHub CLI unavailable, or the remote is not on GitHub."}
              </span>
            </DetailRow>
          )}
          <DetailRow label="yarn v">
            {worktree.verify ? (
              <VerifyIndicator verify={worktree.verify} />
            ) : (
              <span className="text-muted-foreground">
                Not running from here.
              </span>
            )}
          </DetailRow>
        </DetailGroup>

        <DetailGroup title="Lore" icon={ScrollText}>
          <DetailRow label="Quests">
            {worktree.quests.length > 0 ? (
              <QuestChips quests={worktree.quests} />
            ) : (
              <span className="text-muted-foreground">
                {worktree.isMain
                  ? "Main has no commits of its own."
                  : "No #Q in this branch's commits."}
              </span>
            )}
          </DetailRow>
          {worktree.quests
            .filter((quest) => quest.title)
            .map((quest) => (
              <DetailRow key={quest.shortId} label={`#Q${quest.shortId}`}>
                {quest.title}
                <div className="text-muted-foreground text-[12px]">
                  {quest.status}
                  {quest.epic && ` · E${quest.epic.number} ${quest.epic.title}`}
                </div>
              </DetailRow>
            ))}
          {!props.state?.sources.lore && worktree.quests.length > 0 && (
            <DetailRow label="Titles">
              <span className="text-muted-foreground">
                Put a Lore API key in ~/.lore-api-key to show titles and epics.
              </span>
            </DetailRow>
          )}
        </DetailGroup>

        <DetailGroup
          title="Claude"
          icon={Asterisk}
          aside={<ClaudeIndicator claude={claude} compact />}
        >
          <DetailRow label="Session">
            {claude.title ?? claude.lock?.session ?? (
              <span className="text-muted-foreground">none</span>
            )}
          </DetailRow>
          {claude.lastActivityAt && (
            <DetailRow label="Last active">
              <TimeAgo value={claude.lastActivityAt} />
            </DetailRow>
          )}
          {claude.contextTokens !== undefined && (
            <DetailRow label="Context">
              <span
                className="font-mono text-[12px] tabular-nums"
                title={`${claude.contextTokens.toLocaleString("en")} tokens sent by the last turn`}
              >
                {formatTokens(claude.contextTokens)}
              </span>{" "}
              tokens
              {claude.model && (
                <span className="text-muted-foreground"> · {claude.model}</span>
              )}
            </DetailRow>
          )}
          <DetailRow label="Lock">
            {claude.lock ? (
              <>
                {claude.lock.session}, pid {claude.lock.pid}{" "}
                {claude.lock.alive ? (
                  <span className="text-weft">running</span>
                ) : (
                  <span className="text-warn">ended, lock is stale</span>
                )}
              </>
            ) : worktree.lockReason !== undefined ? (
              worktree.lockReason || "locked, no reason given"
            ) : (
              <span className="text-muted-foreground">unlocked</span>
            )}
          </DetailRow>
          {claude.pids.length > 0 && (
            <DetailRow label="Processes" mono>
              {claude.pids.join(", ")}
            </DetailRow>
          )}
          {claude.sessionId && (
            <DetailRow label="Transcript" mono>
              {claude.sessionId}
            </DetailRow>
          )}
        </DetailGroup>

        <DetailGroup title="Serving" icon={Radio}>
          {worktree.devServers.length === 0 ? (
            <DetailRow label="Ports">
              <span className="text-muted-foreground">
                Nothing listens from here.
              </span>
            </DetailRow>
          ) : (
            worktree.devServers.map((server) => (
              <DetailRow
                key={`${server.pid}:${server.port}`}
                label={`:${server.port}`}
              >
                <a
                  href={`http://localhost:${server.port}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-weft hover:underline"
                >
                  localhost:{server.port}
                </a>
                <div className="text-muted-foreground font-mono text-[12px]">
                  {server.command} · pid {server.pid} ·{" "}
                  {server.cwd.slice(worktree.path.length) || "/"}
                </div>
              </DetailRow>
            ))
          )}
        </DetailGroup>

        <DetailGroup title="Worktree" icon={FolderGit2}>
          <DetailRow label="Path" mono>
            {worktree.path}
          </DetailRow>
          <DetailRow label="Created">
            {worktree.createdAt ? (
              <>
                <TimeAgo value={worktree.createdAt} />
                <span className="text-muted-foreground">
                  {" "}
                  ({worktree.createdAt.slice(0, 16).replace("T", " ")} UTC)
                </span>
              </>
            ) : (
              "-"
            )}
          </DetailRow>
          <DetailRow label="Dependencies">
            {worktree.installed ? (
              "installed"
            ) : (
              <span className="text-warn">
                no node_modules: run yarn install
              </span>
            )}
          </DetailRow>
          {worktree.prunable && (
            <DetailRow label="Prunable">
              <span className="text-warn">{worktree.prunable}</span>
            </DetailRow>
          )}
        </DetailGroup>
      </div>
    </div>
  );
};

/**
 * A token count the way context sizes are spoken of: 877k, 1.2M.
 */
const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}k`;
  }
  return String(tokens);
};
