import { $env, $inject, AlephaError, z } from "alepha";
import { PackCommand } from "alepha/cli";
import { $command } from "alepha/command";
import { CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";

import { ArtifactUploader } from "../services/ArtifactUploader.ts";
import { GitContextService } from "../services/GitContextService.ts";
import { LoreClientService } from "../services/LoreClientService.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `alepha lore artifacts push` - store what CI just built.
 *
 * ```bash
 * alepha build
 * export LORE_API_KEY=...
 * alepha lore artifacts push --tag 1.2.3 --project alepha
 * ```
 *
 * ## It packs for you, and that is not a convenience
 *
 * `alepha pack` stays, for anyone who wants the file. But requiring it as a
 * separate step means the tarball on disk and the build in `dist/` can differ,
 * and the push would happily ship the older one - a stale artifact that
 * deploys cleanly and runs the wrong code. Packing here makes that
 * unrepresentable.
 *
 * ## ⚠️ There is no `--runtime`, and there must never be one
 *
 * The runtime is read by Lore from the artifact's own `dist/manifest.json`. A
 * flag would eventually disagree with the manifest, and the manifest is the
 * artifact's own claim about itself. It is also why nothing here parses the
 * filename.
 *
 * ## Failing loudly is the design
 *
 * A push that cannot happen exits non-zero, matching `alepha lore quality
 * push`. The safety is where the command runs rather than in a flag: the push
 * step is `continue-on-error` and gates no deploy, so a red push is a warning
 * annotation rather than a blocked release.
 */
export class ArtifactCommand {
  protected readonly log = $logger();
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly cli = $inject(CliProvider);
  protected readonly packCommand = $inject(PackCommand);
  protected readonly client = $inject(LoreClientService);
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
   * rather than in the workspace root: `push` produces the file as a means and
   * not as an output, and leaving `my-app-latest.tar.gz` in a checkout would
   * be indistinguishable from one somebody packed on purpose. Removed again
   * whichever way the push ends.
   */
  protected static readonly WORK_DIR = "node_modules/.alepha";

  /**
   * The tag a push carries when nobody names one.
   *
   * `latest` and not the version in `package.json`: `latest` is the mutable
   * tag, so the default push is the one that replaces rather than the one that
   * pins. A version pushed by accident is write-once and needs `--force` to
   * take back.
   */
  protected static readonly DEFAULT_TAG = "latest";

  public readonly push = $command({
    name: "push",
    description: "Pack the current build and push it to a Lore project",
    flags: z.object({
      project: z
        .text({
          description:
            "Lore project slug, overriding the one in alepha.config.ts for this invocation",
        })
        .optional(),
      app: z
        .text({
          description:
            "Name the artifact is filed under. Defaults to the slugified `name` from package.json.",
        })
        .optional(),
      tag: z
        .text({
          aliases: ["t"],
          description:
            "Version this build is named by. Defaults to `latest`, the one tag that may be replaced.",
        })
        .optional(),
      force: z
        .boolean()
        .describe(
          "Move a tag that already holds different bytes. Only ever needed for a pinned tag, and only for 'tagged the wrong commit'.",
        )
        .optional(),
    }),
    handler: async ({ flags, root }) => {
      const project = this.client.resolveProject(flags.project);
      const app = flags.app ?? (await this.appNameFrom(root));
      const tag = flags.tag ?? ArtifactCommand.DEFAULT_TAG;

      const [projectId, git] = await Promise.all([
        this.projects.resolve(project),
        this.git.resolve(root),
      ]);

      const workDir = this.fs.join(root, ArtifactCommand.WORK_DIR);
      await this.fs.mkdir(workDir, { recursive: true });
      const filename = `${app}-${tag}.tar.gz`;
      const archivePath = this.fs.join(workDir, filename);

      try {
        // ⚠️ `--name` is passed rather than left to `pack`'s own fallback, so
        // the filename is derived ONCE. Deriving it a second time here is
        // exactly what let `pack` write one file while `BayAdapter` looked for
        // another.
        await this.cli.run(this.packCommand.pack, {
          root,
          argv: ["--name", app, "--tag", tag, "--output", workDir],
        });

        const result = await this.uploader.upload({
          projectId,
          app,
          tag,
          commitSha: git.commitSha,
          force: flags.force,
          archivePath,
          filename,
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
        // `alepha pack` is what to run when the file itself is wanted.
        await this.fs.rm(archivePath, { force: true });
      }
    },
  });

  public readonly artifacts = $command({
    name: "artifacts",
    description: "Builds this project has kept",
    children: [this.push],
    handler: async ({ help }) => {
      help();
    },
  });

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
  protected async publishOutput(sha256: string): Promise<void> {
    const target = String(this.env.GITHUB_OUTPUT ?? "");
    if (!target) {
      return;
    }
    await this.fs.appendFile(target, `sha256=${sha256}\n`);
  }

  /**
   * The name this artifact is filed under, when `--app` names none.
   *
   * `package.json`'s `name`, slugified the way `alepha pack` slugifies it, so
   * a scoped package (`@acme/app`) lands as `acme-app` in both the filename
   * and the registry rather than as a path that exists in neither.
   */
  protected async appNameFrom(root: string): Promise<string> {
    const path = this.fs.join(root, "package.json");
    let name: string | undefined;
    try {
      const pkg = await this.fs.readJsonFile<{ name?: string }>(path);
      name = pkg.name;
    } catch {
      throw new AlephaError(
        `Could not read ${path}. Run \`alepha lore artifacts push\` from a workspace directory, or pass --app <name>.`,
      );
    }
    if (!name) {
      throw new AlephaError(
        'Missing "name" in package.json, so there is nothing to file this artifact under. Pass --app <name>.',
      );
    }
    return this.slugify(name);
  }

  /**
   * A package name made safe to be both a filename segment and a URL segment.
   *
   * The same transformation `PackCommand` applies, restated because that one is
   * `protected` and this package must not reach into it. They cannot drift
   * apart unnoticed: `--name` is passed to `pack` from here, so `pack` takes
   * this result verbatim and never computes its own.
   */
  protected slugify(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}
