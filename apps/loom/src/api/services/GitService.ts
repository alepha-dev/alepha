import { $inject } from "alepha";
import {
  FileSystemProvider,
  type ShellCommandResult,
  ShellProvider,
} from "alepha/system";

import type { Commit } from "../schemas/commitSchema.ts";
import type { Divergence } from "../schemas/divergenceSchema.ts";
import type { GitStatus } from "../schemas/gitStatusSchema.ts";

/**
 * One block of `git worktree list --porcelain`.
 */
export interface WorktreeEntry {
  path: string;
  head: string;
  /**
   * Short name, without `refs/heads/`. Absent on a detached HEAD.
   */
  branch?: string;
  bare: boolean;
  detached: boolean;
  /**
   * The lock reason, `""` for a lock without one, absent when unlocked.
   */
  lockReason?: string;
  prunable?: string;
}

/**
 * Read-only git, through `ShellProvider` so every command can be scripted in
 * a spec.
 *
 * ⚠️ **Every command runs with `GIT_OPTIONAL_LOCKS=0`.** A plain `git status`
 * refreshes the index and takes `index.lock` to write it back. Loom polls
 * every few seconds, in worktrees where agents are running `git add` and
 * `git commit`, and a status holding the lock at the wrong moment fails
 * theirs with "index.lock exists". The variable is git's own switch for
 * exactly this kind of background reader.
 */
export class GitService {
  protected readonly shell = $inject(ShellProvider);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Upper bound for one git command. A repository on a stalled mount must not
   * hang the whole collection.
   */
  protected readonly timeout = 10_000;

  /**
   * The repository's top level for any path inside it, or `undefined` when
   * the path is not in a repository.
   */
  public async topLevel(path: string): Promise<string | undefined> {
    const result = await this.git(path, ["rev-parse", "--show-toplevel"]);
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  public async worktrees(repo: string): Promise<WorktreeEntry[]> {
    const result = await this.git(repo, ["worktree", "list", "--porcelain"]);
    if (result.exitCode !== 0) {
      return [];
    }
    return this.parseWorktrees(result.stdout);
  }

  public parseWorktrees(output: string): WorktreeEntry[] {
    const entries: WorktreeEntry[] = [];
    for (const block of output.split(/\n\s*\n/)) {
      const entry: WorktreeEntry = {
        path: "",
        head: "",
        bare: false,
        detached: false,
      };
      for (const line of block.split("\n")) {
        const space = line.indexOf(" ");
        const key = space === -1 ? line : line.slice(0, space);
        const value = space === -1 ? "" : line.slice(space + 1);
        if (key === "worktree") {
          entry.path = value;
        } else if (key === "HEAD") {
          entry.head = value;
        } else if (key === "branch") {
          entry.branch = value.replace(/^refs\/heads\//, "");
        } else if (key === "bare") {
          entry.bare = true;
        } else if (key === "detached") {
          entry.detached = true;
        } else if (key === "locked") {
          entry.lockReason = value;
        } else if (key === "prunable") {
          entry.prunable = value || "prunable";
        }
      }
      if (entry.path) {
        entries.push(entry);
      }
    }
    return entries;
  }

  public async status(path: string): Promise<GitStatus | undefined> {
    const result = await this.git(path, [
      "status",
      "--porcelain=v2",
      "--branch",
    ]);
    return result.exitCode === 0 ? this.parseStatus(result.stdout) : undefined;
  }

  public parseStatus(output: string): GitStatus {
    const status: GitStatus = {
      staged: 0,
      modified: 0,
      untracked: 0,
      conflicted: 0,
      ahead: 0,
      behind: 0,
    };
    for (const line of output.split("\n")) {
      if (line.startsWith("# branch.upstream ")) {
        status.upstream = line.slice("# branch.upstream ".length);
      } else if (line.startsWith("# branch.ab ")) {
        const match = /\+(\d+) -(\d+)/.exec(line);
        if (match) {
          status.ahead = Number(match[1]);
          status.behind = Number(match[2]);
        }
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        // `XY`: index status, then working-tree status; `.` is unchanged.
        if (line[2] !== ".") {
          status.staged++;
        }
        if (line[3] !== ".") {
          status.modified++;
        }
      } else if (line.startsWith("u ")) {
        status.conflicted++;
      } else if (line.startsWith("? ")) {
        status.untracked++;
      }
    }
    return status;
  }

  public async lastCommit(path: string): Promise<Commit | undefined> {
    const result = await this.git(path, [
      "log",
      "-1",
      "--format=%H%x1f%s%x1f%an%x1f%cI",
    ]);
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return undefined;
    }
    const [sha, subject, author, date] = result.stdout.trim().split("\x1f");
    return { sha, subject, author, date };
  }

  /**
   * The ref to measure every worktree against: `origin/HEAD`'s target when
   * the clone recorded one, else `origin/main` when it exists, else `main`.
   */
  public async defaultBranch(repo: string): Promise<string> {
    const head = await this.git(repo, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (head.exitCode === 0 && head.stdout.trim()) {
      return head.stdout.trim();
    }
    const main = await this.git(repo, [
      "rev-parse",
      "--verify",
      "--quiet",
      "refs/remotes/origin/main",
    ]);
    return main.exitCode === 0 ? "origin/main" : "main";
  }

  public async divergence(
    path: string,
    base: string,
  ): Promise<Divergence | undefined> {
    const result = await this.git(path, [
      "rev-list",
      "--left-right",
      "--count",
      `${base}...HEAD`,
    ]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    // Left is the base's side, right is HEAD's.
    const [behind, ahead] = result.stdout.trim().split(/\s+/).map(Number);
    return { base, ahead: ahead || 0, behind: behind || 0 };
  }

  /**
   * The full messages of the commits HEAD has and the base lacks: the
   * branch's own work, and where its `#Q` numbers are.
   */
  public async ownMessages(path: string, base: string): Promise<string> {
    const result = await this.git(path, [
      "log",
      "--format=%B",
      "--max-count=200",
      `${base}..HEAD`,
    ]);
    return result.exitCode === 0 ? result.stdout : "";
  }

  /**
   * `owner/repo` when `origin` is on GitHub.
   */
  public async github(repo: string): Promise<string | undefined> {
    const result = await this.git(repo, ["remote", "get-url", "origin"]);
    if (result.exitCode !== 0) {
      return undefined;
    }
    const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(
      result.stdout.trim(),
    );
    return match ? `${match[1]}/${match[2]}` : undefined;
  }

  /**
   * Stash entries per branch. The stack is shared by every worktree, and an
   * entry only records the branch it was taken on.
   */
  public async stashes(repo: string): Promise<Map<string, number>> {
    const result = await this.git(repo, ["stash", "list", "--format=%gs"]);
    const counts = new Map<string, number>();
    if (result.exitCode !== 0) {
      return counts;
    }
    for (const line of result.stdout.split("\n")) {
      const match = /^(?:WIP on|On) ([^:]+):/.exec(line);
      if (match) {
        counts.set(match[1], (counts.get(match[1]) ?? 0) + 1);
      }
    }
    return counts;
  }

  /**
   * When a worktree was added: the modification time of `commondir` in its
   * admin directory, a file `git worktree add` writes once and never touches
   * again. The main checkout has no admin directory, so it answers with its
   * repository's `description`, written by `git init` or `git clone`.
   */
  public async createdAt(
    path: string,
    isMain: boolean,
  ): Promise<number | undefined> {
    try {
      if (isMain) {
        return (await this.fs.stat(this.fs.join(path, ".git", "description")))
          .mtimeMs;
      }
      const pointer = await this.fs.readTextFile(this.fs.join(path, ".git"));
      const admin = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim();
      if (!admin) {
        return undefined;
      }
      return (await this.fs.stat(this.fs.join(admin, "commondir"))).mtimeMs;
    } catch {
      return undefined;
    }
  }

  protected git(root: string, args: string[]): Promise<ShellCommandResult> {
    return this.shell
      .capture(["git", ...args], {
        root,
        timeout: this.timeout,
        env: { GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      })
      .catch((error: Error) => ({
        stdout: "",
        stderr: error.message,
        exitCode: -1,
      }));
  }
}
