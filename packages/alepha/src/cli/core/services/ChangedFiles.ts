import { $inject, AlephaError } from "alepha";
import { ShellProvider } from "alepha/system";

/**
 * The files a working tree has changed, relative to a ref.
 *
 * Three sources, because a local run has to see work that has not been
 * committed yet: what the branch changed since the ref, what the tree has on
 * top of HEAD, and what is not tracked at all. A pipeline that read only the
 * first would skip the suite covering the file you are editing right now.
 */
export class ChangedFiles {
  protected readonly shell = $inject(ShellProvider);

  /**
   * Every path changed since `ref`, sorted and deduplicated.
   *
   * The three-dot form compares against the merge base rather than the ref's
   * tip, so a branch behind its base is not reported as having reverted
   * everything that landed in between.
   */
  public async since(ref: string, root?: string): Promise<string[]> {
    const files = new Set<string>();

    for (const command of [
      `git diff --name-only ${ref}...HEAD`,
      "git diff --name-only HEAD",
      "git ls-files --others --exclude-standard",
    ]) {
      for (const file of await this.lines(command, ref, root)) {
        files.add(file);
      }
    }

    return [...files].sort();
  }

  /**
   * One git invocation, as a list of paths.
   *
   * ⚠️ A failure raises. It would be far more convenient to treat an
   * unreadable git as "nothing changed", and that is the one thing this must
   * never do: an affected-only pipeline turns an empty list into an empty run
   * and then reports success. An unknown ref, a checkout with no remote, a
   * missing git, all have to stop the pipeline rather than quietly empty it.
   */
  protected async lines(
    command: string,
    ref: string,
    root?: string,
  ): Promise<string[]> {
    const result = await this.shell.capture(command, { root });

    if (result.exitCode !== 0) {
      throw new AlephaError(
        `Could not determine what changed since '${ref}': \`${command}\` exited ${result.exitCode}. ${result.stderr}`.trim(),
      );
    }

    return result.stdout.trim().split("\n").filter(Boolean);
  }
}
