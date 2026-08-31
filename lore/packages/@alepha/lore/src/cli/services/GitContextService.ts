import { $env, $inject, z } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * Which commit, and which branch, a run belongs to.
 *
 * CI already knows both, so ask it first: `GITHUB_SHA` and `GITHUB_REF_NAME`
 * are set on every GitHub Actions run and cost no subprocess. The git fallback
 * is for a developer running the command on a laptop.
 */
export class GitContextService {
  protected readonly shell = $inject(ShellProvider);

  protected readonly env = $env(
    z.object({
      GITHUB_SHA: z.text({ default: "", secret: false }).optional(),
      GITHUB_REF_NAME: z.text({ default: "", secret: false }).optional(),
    }),
  );

  public async resolve(root: string): Promise<GitContext> {
    const sha = String(this.env.GITHUB_SHA ?? "");
    const ref = String(this.env.GITHUB_REF_NAME ?? "");
    if (sha && ref) {
      return { commitSha: sha, branch: ref };
    }

    return {
      commitSha: sha || (await this.git(root, "git rev-parse HEAD")),
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
