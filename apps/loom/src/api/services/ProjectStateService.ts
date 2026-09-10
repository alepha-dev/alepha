import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider } from "alepha/system";

import type { CiRun } from "../schemas/ciRunSchema.ts";
import type { ClaudeSession } from "../schemas/claudeSessionSchema.ts";
import type { DevServer } from "../schemas/devServerSchema.ts";
import type { Project } from "../schemas/projectSchema.ts";
import type { ProjectState } from "../schemas/projectStateSchema.ts";
import type { WorktreeState } from "../schemas/worktreeStateSchema.ts";
import { CiService } from "./CiService.ts";
import { type ClaudeProcess, ClaudeService } from "./ClaudeService.ts";
import { DevServerService } from "./DevServerService.ts";
import { GitService, type WorktreeEntry } from "./GitService.ts";
import { LoreService } from "./LoreService.ts";

/**
 * What the per-project sources answered, handed to each worktree.
 */
interface ProjectSources {
  base: string;
  stashes: Map<string, number>;
  ci?: Map<string, CiRun>;
  alive: Set<number>;
  servers: DevServer[];
  claude: ClaudeProcess[];
  paths: string[];
}

/**
 * One project's state: every worktree and everything known about it.
 *
 * Project-wide sources (the worktree list, stashes, CI, listening sockets,
 * Claude processes) are read once; per-worktree git runs in batches of
 * {@link concurrency}, since a repository with twenty Claude worktrees would
 * otherwise start a hundred git processes at once.
 *
 * Two callers asking for the same project at once (two tabs polling) share
 * one collection through {@link inflight}.
 */
export class ProjectStateService {
  protected readonly git = $inject(GitService);
  protected readonly ci = $inject(CiService);
  protected readonly lore = $inject(LoreService);
  protected readonly claude = $inject(ClaudeService);
  protected readonly devServers = $inject(DevServerService);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly concurrency = 6;
  protected readonly inflight = new Map<string, Promise<ProjectState>>();

  /**
   * How recently a transcript must have been written for its session to count
   * as working. Claude appends to it on every message and tool call, so two
   * quiet minutes is a session waiting on someone.
   */
  protected readonly workingWindow = 120_000;

  public collect(project: Project): Promise<ProjectState> {
    const running = this.inflight.get(project.id);
    if (running) {
      return running;
    }
    const next = this.doCollect(project).finally(() => {
      this.inflight.delete(project.id);
    });
    this.inflight.set(project.id, next);
    return next;
  }

  /**
   * The worktree a path belongs to: the longest worktree path it is inside.
   * Longest, because every linked worktree under `.claude/worktrees/` is
   * inside the main checkout's path too.
   */
  public owner(path: string, worktrees: string[]): string | undefined {
    let best: string | undefined;
    for (const candidate of worktrees) {
      const inside = path === candidate || path.startsWith(`${candidate}/`);
      if (inside && (!best || candidate.length > best.length)) {
        best = candidate;
      }
    }
    // A process still sitting in a Claude worktree that has since been
    // removed is inside the main checkout's path, but it is not the main
    // checkout's: it belongs to a worktree that no longer exists.
    if (
      best &&
      !best.includes("/.claude/worktrees/") &&
      path.slice(best.length).includes("/.claude/worktrees/")
    ) {
      return undefined;
    }
    return best;
  }

  /**
   * See `claudeSessionSchema.activity`.
   */
  public activity(
    live: boolean,
    locked: boolean,
    lastActivityAt: number | undefined,
  ): ClaudeSession["activity"] {
    if (live) {
      const recent =
        lastActivityAt !== undefined &&
        this.dateTime.nowMillis() - lastActivityAt < this.workingWindow;
      return recent ? "working" : "waiting";
    }
    if (locked) {
      return "stale";
    }
    return lastActivityAt !== undefined ? "ended" : "none";
  }

  protected async doCollect(project: Project): Promise<ProjectState> {
    const started = this.dateTime.nowMillis();
    const entries = (await this.git.worktrees(project.path)).filter(
      (entry) => !entry.bare,
    );
    const lockPids = entries
      .map((entry) => this.claude.parseLock(entry.lockReason)?.pid)
      .filter((pid): pid is number => pid !== undefined);
    const branches = entries
      .map((entry) => entry.branch)
      .filter((branch): branch is string => !!branch);

    const [base, github, stashes, alive, servers, claude] = await Promise.all([
      this.git.defaultBranch(project.path),
      this.git.github(project.path),
      this.git.stashes(project.path),
      this.claude.alive(lockPids),
      this.devServers.listening(),
      this.claude.processes(),
    ]);
    const ci =
      github && (await this.ci.available())
        ? await this.ci.latest(github, branches)
        : undefined;

    const sources: ProjectSources = {
      base,
      stashes,
      ci,
      alive,
      servers,
      claude,
      paths: entries.map((entry) => entry.path),
    };

    const collected: Array<{ state: WorktreeState; questIds: number[] }> = [];
    for (let i = 0; i < entries.length; i += this.concurrency) {
      const batch = entries.slice(i, i + this.concurrency);
      collected.push(
        ...(await Promise.all(
          batch.map((entry, j) => this.worktree(entry, i + j === 0, sources)),
        )),
      );
    }

    const allQuestIds = [
      ...new Set(collected.flatMap((it) => it.questIds)),
    ].sort((a, b) => b - a);
    const quests = await this.lore.resolve(project, allQuestIds);
    for (const { state, questIds } of collected) {
      state.quests = questIds
        .map((id) => quests.get(id))
        .filter((quest) => quest !== undefined);
    }

    const worktrees = collected
      .map((it) => it.state)
      .sort((a, b) => {
        if (a.isMain !== b.isMain) {
          return a.isMain ? -1 : 1;
        }
        return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
      });

    return {
      project,
      base,
      github,
      worktrees,
      sources: { gh: ci !== undefined, lore: await this.lore.enabled() },
      collectedAt: this.dateTime.nowISOString(),
      took: this.dateTime.nowMillis() - started,
    };
  }

  protected async worktree(
    entry: WorktreeEntry,
    isMain: boolean,
    sources: ProjectSources,
  ): Promise<{ state: WorktreeState; questIds: number[] }> {
    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    const lock = this.claude.parseLock(entry.lockReason);
    const lockAlive = lock ? sources.alive.has(lock.pid) : false;
    const pids = sources.claude
      .filter((it) => this.owner(it.cwd, sources.paths) === entry.path)
      .map((it) => it.pid);
    const state: WorktreeState = {
      path: entry.path,
      name,
      isMain,
      branch: entry.branch,
      head: entry.head,
      prunable: entry.prunable,
      lockReason: entry.lockReason,
      stashes: entry.branch ? (sources.stashes.get(entry.branch) ?? 0) : 0,
      installed: false,
      quests: [],
      ci: entry.branch ? sources.ci?.get(entry.branch) : undefined,
      claude: {
        activity: this.activity(
          lockAlive || pids.length > 0,
          lock !== undefined,
          undefined,
        ),
        lock: lock ? { ...lock, alive: lockAlive } : undefined,
        pids,
      },
      devServers: sources.servers.filter(
        (server) => this.owner(server.cwd, sources.paths) === entry.path,
      ),
    };

    // A prunable worktree's directory is gone: git has nothing to say about
    // it beyond what the list already said.
    if (entry.prunable) {
      return { state, questIds: [] };
    }

    const [
      status,
      divergence,
      lastCommit,
      messages,
      createdAt,
      installed,
      transcript,
    ] = await Promise.all([
      this.git.status(entry.path),
      isMain ? undefined : this.git.divergence(entry.path, sources.base),
      this.git.lastCommit(entry.path),
      isMain ? "" : this.git.ownMessages(entry.path, sources.base),
      this.git.createdAt(entry.path, isMain),
      this.fs.exists(this.fs.join(entry.path, "node_modules")),
      this.claude.transcript(entry.path),
    ]);

    state.status = status;
    state.divergence = divergence;
    state.lastCommit = lastCommit;
    state.installed = installed;
    if (createdAt !== undefined) {
      state.createdAt = this.dateTime.toISOString(createdAt);
    }
    if (transcript) {
      state.claude.sessionId = transcript.sessionId;
      state.claude.title = transcript.title;
      state.claude.lastActivityAt = this.dateTime.toISOString(
        transcript.lastActivityAt,
      );
      state.claude.activity = this.activity(
        lockAlive || pids.length > 0,
        lock !== undefined,
        transcript.lastActivityAt,
      );
    }

    return { state, questIds: this.lore.questIds(messages) };
  }
}
