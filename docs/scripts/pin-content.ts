import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { DocsRoots } from "./roots.ts";

/**
 * Checks the framework and Bay out at their release tags, for a deploy to
 * build their sections from (#Q2766).
 *
 * alepha.dev documents what readers install, so the `/docs` pages come from
 * the latest framework release, not from `main`, which may already describe
 * APIs that npm does not have. Lore's pages follow `main` (it is hosted and
 * deploys on every green push) and are never pinned. Bay's follow its newest
 * `bay-x.y.z` tag (#Q2767), and `main` until the first one exists.
 *
 * Each checkout is a detached `git worktree` under `docs/.content/`, so
 * `gen:tree` reads each page's last-modified date from the tag's own history.
 * A deploy then runs the build with `DOCS_FRAMEWORK_ROOT=docs/.content/framework`
 * and `DOCS_BAY_ROOT=docs/.content/bay`; see {@link DocsRoots}, which ignores a
 * root that was not checked out.
 */
export class PinContentCommand {
  protected readonly log = $logger();

  protected readonly execFile = promisify(execFile);

  /**
   * Where the pinned framework checkout lands.
   */
  public static readonly frameworkDir = join(
    DocsRoots.repo,
    "docs/.content/framework",
  );

  /**
   * Where the pinned Bay checkout lands, when Bay has a release tag.
   */
  public static readonly bayDir = join(DocsRoots.repo, "docs/.content/bay");

  pin = $command({
    name: "docs:pin",
    description:
      "Check the framework and Bay out at their release tags, for a deploy to publish",
    flags: z.object({
      framework: z
        .text()
        .describe("Framework tag to publish (default: the latest release tag)")
        .optional(),
      bay: z
        .text()
        .describe("Bay tag to publish (default: the latest bay-x.y.z tag)")
        .optional(),
    }),
    handler: async ({ run, flags }) => {
      const tag = flags.framework ?? (await this.latestTag(/^\d+\.\d+\.\d+$/));
      if (!tag) {
        throw new AlephaError("No framework release tag (x.y.z) to pin");
      }
      await run(`pin framework at ${tag}`, () =>
        this.checkout(PinContentCommand.frameworkDir, tag),
      );
      this.log.info(`Framework docs pinned at ${tag}`);

      // No `bay-*` tag yet: the Bay section reads `main`, as `DocsRoots`
      // does for a root that was never checked out.
      const bayTag = flags.bay ?? (await this.latestTag(/^bay-\d+\.\d+\.\d+$/));
      if (bayTag) {
        await run(`pin bay at ${bayTag}`, () =>
          this.checkout(PinContentCommand.bayDir, bayTag),
        );
        this.log.info(`Bay docs pinned at ${bayTag}`);
      } else {
        this.log.info("No bay-x.y.z tag: the Bay docs follow main");
      }
    },
  });

  /**
   * The newest tag matching `pattern`. The framework tags bare `x.y.z`, Lore
   * and Bay prefix theirs (#Q2767), so each pattern sees one product only.
   */
  protected async latestTag(pattern: RegExp): Promise<string | undefined> {
    const tags = await this.git(["tag", "--sort=-version:refname"]);
    return tags
      .split("\n")
      .map((line) => line.trim())
      .find((line) => pattern.test(line));
  }

  protected async checkout(dir: string, tag: string): Promise<void> {
    if (existsSync(dir)) {
      await this.git(["worktree", "remove", "--force", dir]);
    }
    await this.git(["worktree", "add", "--detach", dir, tag]);
  }

  protected async git(args: string[]): Promise<string> {
    const { stdout } = await this.execFile("git", args, {
      cwd: DocsRoots.repo,
    });
    return stdout;
  }
}
