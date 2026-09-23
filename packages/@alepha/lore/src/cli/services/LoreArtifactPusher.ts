import { $env, $inject, z } from "alepha";
import { WorkspacePacker } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { ArtifactUploader } from "./ArtifactUploader.ts";
import { GitContextService } from "./GitContextService.ts";
import { LoreProjectResolver } from "./LoreProjectResolver.ts";

/**
 * Pack the current `dist/` and push it to a Lore project: the body of
 * `lore artifacts push`, as a service.
 *
 * ## ⚠️ One push, for every caller
 *
 * `lore artifacts push`, `lore deploy`'s build-and-push, and the platform
 * adapter's `build()` all store an artifact, and they must store it the same
 * way: the packing, the maps sibling, the `--force` semantics and the cleanup
 * on one path. `lore deploy` used to reach it by running the command object
 * through `CliProvider`, which a platform adapter cannot do, so the body moved
 * here and the command became its flag parser.
 *
 * It packs rather than taking a tarball, and that is not a convenience:
 * requiring `alepha pack` as a separate step means the file on disk and the
 * build in `dist/` can differ, and the push would ship the older one.
 */
export class LoreArtifactPusher {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly packer = $inject(WorkspacePacker);
  protected readonly projects = $inject(LoreProjectResolver);
  protected readonly uploader = $inject(ArtifactUploader);
  protected readonly git = $inject(GitContextService);

  /**
   * ⚠️ Declared through `$env` rather than read off `process.env`, for the
   * reason every other variable in this package is: a direct read is a seam
   * nothing can substitute, so the one behaviour that only ever happens inside
   * CI would be the one behaviour no test could reach.
   */
  protected readonly env = $env(
    z.object({
      GITHUB_OUTPUT: z
        .text({
          default: "",
          secret: false,
          description:
            "File GitHub Actions gives a step to write its outputs to. Set by Actions; never set by hand.",
        })
        .optional(),
    }),
  );

  /**
   * Where the tarball is written on the way through.
   *
   * Under `node_modules/.alepha`, beside the dev database and the mail spool,
   * rather than in the workspace root: the push produces the file as a means
   * and not as an output, and leaving `my-app-latest.tar.zst` in a checkout
   * would be indistinguishable from one somebody packed on purpose. Removed
   * again whichever way the push ends.
   */
  public static readonly WORK_DIR = "node_modules/.alepha";

  /**
   * Pack `dist/` under `root` and push it as `app@tag`.
   *
   * Fails loudly: a push that cannot happen throws, and the caller exits
   * non-zero.
   */
  public async push(input: {
    root: string;
    project: string;
    app: string;
    tag: string;
    force?: boolean;
    run: RunnerMethod;
  }): Promise<void> {
    const { root, project, app, tag } = input;

    const [projectId, git] = await Promise.all([
      this.projects.resolve(project),
      this.git.resolve(root),
    ]);

    const workDir = this.fs.join(root, LoreArtifactPusher.WORK_DIR);
    await this.fs.mkdir(workDir, { recursive: true });
    const filename = `${app}-${tag}.tar.zst`;
    const archivePath = this.fs.join(workDir, filename);

    try {
      // ⚠️ `name` is passed rather than left to the packer's own fallback,
      // so the filename is derived ONCE. Deriving it a second time here is
      // exactly what let `pack` write one file while `BayAdapter` looked for
      // another.
      const packed = await this.packer.pack({
        root,
        name: app,
        tag,
        output: workDir,
        run: input.run,
      });

      const result = await this.uploader.upload({
        projectId,
        app,
        tag,
        commitSha: git.commitSha,
        force: input.force,
        archivePath,
        filename,
        // The sibling source-map archive, when the build produced one
        // (#1515). Absent is normal, not an error: the maps are excluded
        // from the artifact and stored beside it, so nothing is discarded.
        mapsPath: packed.maps?.outputPath,
        mapsFilename: packed.maps?.filename,
      });

      const { artifact } = result;
      this.log.info(
        result.stored
          ? `Pushed ${artifact.app} ${artifact.tag} (${artifact.runtime}) to ${project}`
          : `${artifact.app} ${artifact.tag} (${artifact.runtime}) was already pushed to ${project}`,
        { sha256: artifact.sha256, size: artifact.size },
      );
      // On its own line and unadorned: a later step reads this off the log
      // when it has no `$GITHUB_OUTPUT` to read instead.
      this.log.info(`sha256: ${artifact.sha256}`);

      await this.publishOutput(artifact.sha256);
    } finally {
      // A tarball left in `node_modules` is invisible until it is stale.
      // `alepha pack` is what to run when the file itself is wanted. The
      // maps archive is removed by name rather than from `packed`, which is
      // out of scope in a `finally` that also runs when `pack` threw.
      await this.fs.rm(archivePath, { force: true });
      await this.fs.rm(this.fs.join(workDir, `${app}-${tag}.maps.tar.zst`), {
        force: true,
      });
    }
  }

  /**
   * Hand the digest to the rest of the workflow.
   *
   * A tag can be moved by another job; a digest cannot. A step that means to
   * deploy exactly these bytes needs the second, so the push writes it where
   * GitHub Actions expects an output rather than leaving the next step to
   * scrape a log line.
   *
   * `GITHUB_OUTPUT` being set IS the CI detection - it is the file Actions
   * creates per step - so there is no separate `CI` check to disagree with it.
   */
  public async publishOutput(sha256: string): Promise<void> {
    const target = String(this.env.GITHUB_OUTPUT ?? "");
    if (!target) {
      return;
    }
    await this.fs.appendFile(target, `sha256=${sha256}\n`);
  }
}
