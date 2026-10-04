import { $inject } from "alepha";
import { ShellProvider } from "alepha/system";

import type { MigrationDrift } from "../schemas/migrationDriftSchema.ts";
import type { WorktreeState } from "../schemas/worktreeStateSchema.ts";

/**
 * What the devtools reads from git, one command at a time.
 *
 * Plain `git` through `ShellProvider`, argv form only (paths come from run
 * entries), so a spec substitutes `MemoryShellProvider`. Every method
 * degrades to "nothing known" rather than throwing: a directory that stopped
 * being a repository is not an error worth a red screen.
 */
export class GitService {
  protected readonly shell = $inject(ShellProvider);

  /**
   * The directory, relative to an app's own, under which its migrations live:
   * `migrations/<provider>` by default (`DatabaseProvider.getMigrationsFolder`).
   */
  public readonly migrationsDir = "migrations";

  public async worktree(root: string): Promise<WorktreeState | undefined> {
    const common = await this.git(root, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    if (common === undefined) return undefined;

    // A main checkout's common dir is `<repo>/.git`; a bare one is the repo.
    const repository = common.replace(/[\\/]\.git[\\/]?$/, "") || common;
    const branch =
      (await this.git(root, ["rev-parse", "--abbrev-ref", "HEAD"])) ?? "HEAD";

    let ahead: number | undefined;
    let behind: number | undefined;
    const counts = await this.git(root, [
      "rev-list",
      "--left-right",
      "--count",
      "@{upstream}...HEAD",
    ]);
    if (counts) {
      const [left, right] = counts.split(/\s+/).map(Number);
      if (Number.isFinite(left) && Number.isFinite(right)) {
        behind = left;
        ahead = right;
      }
    }

    const status = (await this.git(root, ["status", "--porcelain"])) ?? "";
    const dirty = status.split("\n").filter((line) => line.trim()).length;

    return { repository, worktree: root, branch, ahead, behind, dirty };
  }

  /**
   * Migration files under `cwd/migrations` added or modified since the
   * merge-base with the default branch, uncommitted ones included.
   *
   * The default branch is `origin/HEAD`, else `main`. A repository with no
   * remote has nothing to compare with, and gets no flag rather than an
   * error.
   */
  public async migrations(cwd: string): Promise<MigrationDrift> {
    const remotes = await this.git(cwd, ["remote"]);
    if (!remotes) return { files: [] };

    const head = await this.git(cwd, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    const base = head || "main";

    const mergeBase = await this.git(cwd, ["merge-base", "HEAD", base]);
    if (!mergeBase) return { files: [] };

    const files: MigrationDrift["files"] = [];
    const diff =
      (await this.git(cwd, [
        "diff",
        "--relative",
        "--name-status",
        "--diff-filter=AM",
        mergeBase,
        "--",
        this.migrationsDir,
      ])) ?? "";
    for (const line of diff.split("\n")) {
      const [code, path] = line.split("\t");
      if (!path) continue;
      files.push({
        path,
        status: code?.startsWith("A") ? "added" : "modified",
      });
    }

    const untracked =
      (await this.git(cwd, [
        "ls-files",
        "--others",
        "--exclude-standard",
        "--",
        this.migrationsDir,
      ])) ?? "";
    for (const path of untracked.split("\n")) {
      if (path.trim()) files.push({ path: path.trim(), status: "added" });
    }

    files.sort((a, b) => a.path.localeCompare(b.path));
    return { base, files };
  }

  /**
   * `git -C <dir> ...args`, trimmed stdout, or `undefined` on any failure.
   */
  protected async git(
    dir: string,
    args: string[],
  ): Promise<string | undefined> {
    try {
      const result = await this.shell.capture(["git", "-C", dir, ...args]);
      return result.exitCode === 0 ? result.stdout.trim() : undefined;
    } catch {
      return undefined;
    }
  }
}
