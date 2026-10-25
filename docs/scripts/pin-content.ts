import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { DocsRoots } from "./roots.ts";

/**
 * Checks the framework out at its release tag, for a deploy to build the
 * framework section from (#Q2766).
 *
 * alepha.dev documents what readers install, so the `/docs` pages come from
 * the latest framework release, not from `main`, which may already describe
 * APIs that npm does not have. Lore's pages follow `main` (it is hosted and
 * deploys on every green push) and are never pinned; Bay's will be pinned the
 * same way once its releases carry tags of their own (#Q2767).
 *
 * The checkout is a detached `git worktree` under `docs/.content/framework`,
 * so `gen:tree` reads each page's last-modified date from the tag's own
 * history. A deploy then runs the build with
 * `DOCS_FRAMEWORK_ROOT=docs/.content/framework`; see {@link DocsRoots}.
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

  pin = $command({
    name: "docs:pin",
    description:
      "Check the framework out at its release tag, for a deploy to publish",
    flags: z.object({
      framework: z
        .text()
        .describe("Framework tag to publish (default: the latest release tag)")
        .optional(),
    }),
    handler: async ({ run, flags }) => {
      const tag = flags.framework ?? (await this.latestFrameworkTag());
      const dir = PinContentCommand.frameworkDir;

      await run(`pin framework at ${tag}`, async () => {
        if (existsSync(dir)) {
          await this.git(["worktree", "remove", "--force", dir]);
        }
        await this.git(["worktree", "add", "--detach", dir, tag]);
      });

      this.log.info(`Framework docs pinned at ${tag}: ${dir}`);
    },
  });

  /**
   * The newest bare `x.y.z` tag: the framework's release tags. Lore and Bay
   * tag with a product prefix (#Q2767), so they never match.
   */
  protected async latestFrameworkTag(): Promise<string> {
    const tags = await this.git(["tag", "--sort=-version:refname"]);
    const tag = tags
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+\.\d+\.\d+$/.test(line));
    if (!tag) {
      throw new AlephaError("No framework release tag (x.y.z) to pin");
    }
    return tag;
  }

  protected async git(args: string[]): Promise<string> {
    const { stdout } = await this.execFile("git", args, {
      cwd: DocsRoots.repo,
    });
    return stdout;
  }
}
