import { $env, $inject, z } from "alepha";
import { FileSystemProvider, ShellProvider } from "alepha/system";

/**
 * Which commit, and which branch, a run belongs to.
 *
 * The commit is asked of git first, and `GITHUB_SHA` is only the fallback for
 * a run with no repository. ⚠️ `GITHUB_SHA` is the commit a run STARTED on: a
 * job that commits before it pushes (the Release job commits `release: X` and
 * tags it) builds a commit `GITHUB_SHA` does not name, and its artifacts were
 * recorded one release behind.
 *
 * The branch is the other way round: `GITHUB_REF_NAME` first, because a CI
 * checkout is detached and git cannot name it (see `branch`).
 */
export class GitContextService {
  protected readonly shell = $inject(ShellProvider);

  protected readonly env = $env(
    z.object({
      GITHUB_SHA: z.text({ default: "", secret: false }).optional(),
      GITHUB_REF_NAME: z.text({ default: "", secret: false }).optional(),
      GITHUB_EVENT_PATH: z.text({ default: "", secret: false }).optional(),
    }),
  );

  protected readonly fs = $inject(FileSystemProvider);

  /**
   * The repository's default branch (#Q4234): what a push to it means to
   * Lore, since a commit landing there completes the quests an automation
   * built. GitHub Actions names it in the event payload
   * (`repository.default_branch`); otherwise git's `origin/HEAD`. Undefined
   * when neither says, and Lore then takes `main`.
   */
  public async defaultBranch(root: string): Promise<string | undefined> {
    const path = String(this.env.GITHUB_EVENT_PATH ?? "");
    if (path) {
      try {
        const event = JSON.parse(await this.fs.readTextFile(path)) as {
          repository?: { default_branch?: unknown };
        };
        const named = event.repository?.default_branch;
        if (typeof named === "string" && named) return named;
      } catch {
        // No readable payload: ask git.
      }
    }
    const head = await this.git(
      root,
      "git symbolic-ref --short refs/remotes/origin/HEAD",
    );
    return head ? head.replace(/^origin\//, "") : undefined;
  }

  public async resolve(root: string): Promise<GitContext> {
    const sha = String(this.env.GITHUB_SHA ?? "");
    const ref = String(this.env.GITHUB_REF_NAME ?? "");

    return {
      commitSha: (await this.git(root, "git rev-parse HEAD")) || sha,
      branch: ref || (await this.branch(root)),
    };
  }

  /**
   * ⚠️ `git rev-parse --abbrev-ref HEAD` answers the literal string `HEAD` on
   * a detached checkout, which is what CI does by default. Storing that would
   * put a branch named `HEAD` on the tab, and `latest` is scoped by branch, so
   * it would quietly become its own timeline.
   *
   * A run whose branch cannot be named is `unknown` rather than a lie. It is
   * only reachable off CI, since `GITHUB_REF_NAME` is set there and names the
   * branch correctly even when the checkout is detached.
   */
  protected async branch(root: string): Promise<string> {
    const named = await this.git(root, "git rev-parse --abbrev-ref HEAD");
    return named && named !== "HEAD" ? named : GitContextService.UNKNOWN_BRANCH;
  }

  public static readonly UNKNOWN_BRANCH = "unknown";

  /**
   * Tracked changes in the working tree the build is pushed from (#E154):
   * `git status --porcelain --untracked-files=no`. Untracked files never
   * count, since build output and generated folders are untracked by nature.
   * `undefined` when git cannot say (no repository), which Lore reads as
   * unknown rather than clean.
   */
  public async dirty(
    root: string,
  ): Promise<{ dirty: boolean; paths: string[] } | undefined> {
    const result = await this.shell
      .capture(["git", "status", "--porcelain", "--untracked-files=no"], {
        root,
      })
      .catch(() => undefined);
    if (!result || result.exitCode !== 0) {
      return undefined;
    }
    const paths = result.stdout
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => line.slice(3));
    return { dirty: paths.length > 0, paths };
  }

  /**
   * Through `ShellProvider` rather than `child_process`, so the command stays
   * substitutable with `MemoryShellProvider`.
   *
   * A non-zero exit answers empty rather than throwing: a repository with no
   * commits, or a tarball with no `.git`, is a reason to push a run with a
   * blank sha, not a reason to fail a build over provenance.
   */
  protected async git(root: string, command: string): Promise<string> {
    const result = await this.shell.capture(command, { root });
    return result.exitCode === 0 ? result.stdout.trim() : "";
  }
}

export interface GitContext {
  commitSha: string;
  branch: string;
}
