import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { AlephaError, z } from "alepha";
import { $command } from "alepha/command";
import { $logger } from "alepha/logger";

import { DocsRoots } from "./roots.ts";

/**
 * Checks the repository out at the latest release tag, for a deploy to build
 * the released sections from (#Q2766).
 *
 * alepha.dev documents what readers install. The framework and Bay ship in one
 * release under one bare `x.y.z` tag (#Q2776), so their pages come from that
 * tag, not from `main`, which may already describe what npm and the released
 * binary do not have. Lore's pages follow `main` (it is hosted and deploys on
 * every green push) and are never pinned.
 *
 * The checkout is a detached `git worktree` at `docs/.content/release`, so
 * `gen:tree` reads each page's last-modified date from the tag's own history.
 * A deploy then builds with `DOCS_RELEASE_ROOT=docs/.content/release`; see
 * {@link DocsRoots}.
 */
export class PinContentCommand {
  protected readonly log = $logger();

  protected readonly execFile = promisify(execFile);

  /**
   * Where the pinned release checkout lands.
   */
  public static readonly releaseDir = join(
    DocsRoots.repo,
    "docs/.content/release",
  );

  pin = $command({
    name: "docs:pin",
    description:
      "Check the latest release tag out, for a deploy to publish its pages",
    flags: z.object({
      tag: z
        .text()
        .describe("Release tag to publish (default: the latest x.y.z tag)")
        .optional(),
    }),
    handler: async ({ run, flags }) => {
      const tag = flags.tag ?? (await this.latestReleaseTag());
      const dir = PinContentCommand.releaseDir;

      await run(`pin the released docs at ${tag}`, async () => {
        if (existsSync(dir)) {
          await this.git(["worktree", "remove", "--force", dir]);
        }
        await this.git(["worktree", "add", "--detach", dir, tag]);
      });

      this.log.info(`Released docs pinned at ${tag}: ${dir}`);
    },
  });

  /**
   * The newest bare `x.y.z` tag: the repository's release tags.
   */
  protected async latestReleaseTag(): Promise<string> {
    const tags = await this.git(["tag", "--sort=-version:refname"]);
    const tag = tags
      .split("\n")
      .map((line) => line.trim())
      .find((line) => /^\d+\.\d+\.\d+$/.test(line));
    if (!tag) {
      throw new AlephaError("No release tag (x.y.z) to pin");
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
