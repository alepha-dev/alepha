import type { LiveQuestController } from "@lore/ship/api";
import { $env, $inject, z } from "alepha";
import { WorkspacePacker } from "alepha/cli";
import type { RunnerMethod } from "alepha/command";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import { $client } from "alepha/server/links";
import { FileSystemProvider } from "alepha/system";

import { ArtifactAssetLister } from "./ArtifactAssetLister.ts";
import { ArtifactUploader } from "./ArtifactUploader.ts";
import { GitContextService } from "./GitContextService.ts";
import { GitQuestHistory, type QuestWalk } from "./GitQuestHistory.ts";
import { LoreClientService } from "./LoreClientService.ts";
import { LoreProjectLink } from "./LoreProjectLink.ts";
import { LoreProjectResolver } from "./LoreProjectResolver.ts";

/**
 * Pack the current `dist/` and push it to a Lore project: the body of
 * `lore artifacts push`, as a service.
 *
 * ## ⚠️ One push, for every caller
 *
 * `lore artifacts push`, `lore deploy`'s build-and-push, and the platform
 * adapter's `build()` all store an artifact, and they must store it the same
 * way: the packing, the `--force` semantics and the cleanup
 * on one path. `lore deploy` used to reach it by running the command object
 * through `CliProvider`, which a infra adapter cannot do, so the body moved
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
  protected readonly assetLister = $inject(ArtifactAssetLister);
  protected readonly git = $inject(GitContextService);
  protected readonly dateTime = $inject(DateTimeProvider);
  protected readonly history = $inject(GitQuestHistory);
  protected readonly link = $inject(LoreProjectLink);
  protected readonly client = $inject(LoreClientService);
  protected readonly liveQuests = $client<LiveQuestController>(
    this.client.scope(),
  );

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
   * The build's `manifest.json`, sent beside the archive so Lore need not
   * inflate it to find one (#Q2681).
   *
   * ⚠️ The very file `alepha pack` put at the archive root, read from `dist/`
   * right after the pack. Lore re-checks it against the archive's own copy at
   * deploy, so a mismatch is refused rather than trusted. Re-serialised so it
   * travels as one line in its form field. `undefined` when the build has
   * none, and Lore then reads the archive, as it always did.
   */
  protected async manifestOf(root: string): Promise<string | undefined> {
    const path = this.fs.join(root, "dist", "manifest.json");
    if (!(await this.fs.exists(path))) {
      return undefined;
    }
    try {
      return JSON.stringify(JSON.parse(await this.fs.readTextFile(path)));
    } catch {
      return undefined;
    }
  }

  /**
   * Pack `dist/` under `root` and push it as `app@tag`.
   *
   * Fails loudly: a push that cannot happen throws, and the caller exits
   * non-zero.
   */
  /**
   * The asset list sent with the push (#Q3381), as JSON, or `undefined` for a
   * build with no `public/`.
   *
   * ⚠️ Computed here, on the pusher's machine, because it depends only on the
   * build's bytes: Lore's Worker used to inflate and hash the whole archive
   * on every deploy to learn it, and a docs site of thousands of files spent
   * most of a deploy's CPU there. The time it adds to a push is logged.
   */
  protected async assetsOf(root: string): Promise<string | undefined> {
    const started = this.dateTime.nowMillis();
    const list = await this.assetLister.list(root);
    if (!list) {
      return undefined;
    }
    this.log.info(
      `Listed ${list.assets.length} assets in ${this.dateTime.nowMillis() - started} ms`,
    );
    return JSON.stringify(list);
  }

  /**
   * The newest Drizzle `snapshot.json` of each dialect under `migrations/`
   * (#Q3542), as `{ version: 1, dialects: { <dialect>: <snapshot> } }`, or
   * `undefined` for a build with no migrations.
   *
   * ⚠️ Read from the same `migrations/` the pack just put in the archive, so
   * the schema sent is the one those bytes migrate to. Newest is the last
   * folder by name: drizzle-kit names each `<timestamp>_<words>`, so the
   * name order is the order they apply in.
   *
   * Sent raw, as drizzle-kit wrote it: Lore reduces it, so this CLI needs no
   * knowledge of the format and a newer drizzle-kit needs no newer CLI.
   */
  protected async schemaOf(root: string): Promise<string | undefined> {
    const migrations = this.fs.join(root, "migrations");
    if (!(await this.fs.exists(migrations))) {
      return undefined;
    }
    const dialects: Record<string, unknown> = {};
    try {
      const byName = (a: string, b: string) => a.localeCompare(b);
      for (const dialect of (await this.fs.ls(migrations)).sort(byName)) {
        const folders = (
          await this.fs.ls(this.fs.join(migrations, dialect)).catch(() => [])
        ).sort((a, b) => byName(b, a));
        for (const folder of folders) {
          const path = this.fs.join(
            migrations,
            dialect,
            folder,
            "snapshot.json",
          );
          if (await this.fs.exists(path)) {
            dialects[dialect] = JSON.parse(await this.fs.readTextFile(path));
            break;
          }
        }
      }
    } catch (error) {
      // Only a rollback warning rides on it: a push never fails for it.
      this.log.warn(
        "The migrations' schema could not be read, and is not sent",
        {
          error,
        },
      );
      return undefined;
    }
    if (Object.keys(dialects).length === 0) {
      return undefined;
    }
    const json = JSON.stringify({ version: 1, dialects });
    if (json.length > LoreArtifactPusher.MAX_SCHEMA_BYTES) {
      this.log.warn("The migrations' schema is too large to send, and is not", {
        size: json.length,
      });
      return undefined;
    }
    return json;
  }

  /**
   * The largest `schema.json` Lore reads.
   */
  protected static readonly MAX_SCHEMA_BYTES = 4 * 1024 * 1024;

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
    // The quests this commit's history references, and whether the tree
    // the build came from had tracked changes (#E154). Never a refusal: a
    // push that cannot read git sends a partial set and says so.
    const [walks, tree, defaultBranch] = await Promise.all([
      git.commitSha ? this.walk(root, projectId, app) : undefined,
      this.git.dirty(root),
      this.git.defaultBranch(root),
    ]);
    const walk = walks?.whole;
    const scoped = walks?.scoped;

    const workDir = this.fs.join(root, LoreArtifactPusher.WORK_DIR);
    await this.fs.mkdir(workDir, { recursive: true });
    const filename = `${app}-${tag}.tar.zst`;
    const archivePath = this.fs.join(workDir, filename);

    try {
      // ⚠️ `name` is passed rather than left to the packer's own fallback,
      // so the filename is derived ONCE. Deriving it a second time here is
      // exactly what let `pack` write one file while `BayAdapter` looked for
      // another.
      await this.packer.pack({
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
        manifest: await this.manifestOf(root),
        assets: await this.assetsOf(root),
        schema: await this.schemaOf(root),
        ...(walk
          ? {
              quests: JSON.stringify({
                version: 1,
                ...(walk.base ? { base: walk.base } : {}),
                numbers: walk.numbers,
                complete: walk.complete,
              }),
              commits: JSON.stringify(walk.walked),
            }
          : {}),
        ...(scoped
          ? {
              appQuests: JSON.stringify({
                version: 1,
                paths: scoped.paths,
                ...(scoped.walk.base ? { base: scoped.walk.base } : {}),
                numbers: scoped.walk.numbers,
                complete: scoped.walk.complete,
              }),
              appCommits: JSON.stringify(scoped.walk.walked),
            }
          : {}),
        ...(tree ? { dirty: tree.dirty } : {}),
        ...(git.branch && git.branch !== GitContextService.UNKNOWN_BRANCH
          ? { branch: git.branch }
          : {}),
        ...(defaultBranch ? { defaultBranch } : {}),
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
      this.log.info(this.questLine(walk, tree, result.quests?.count));
      if (scoped) {
        this.log.info(
          this.appQuestLine(app, scoped.walk, result.appQuests?.count),
        );
      }
      if (tree?.dirty) {
        for (const path of tree.paths.slice(0, 5)) {
          this.log.info(`  modified: ${path}`);
        }
      }
      if (walk?.reason) {
        this.log.warn(this.partialReason(walk.reason));
      }
      if (walks?.skipped) {
        this.log.warn(walks.skipped);
      }

      await this.publishOutput(artifact.sha256);
    } finally {
      // A tarball left in `node_modules` is invisible until it is stale.
      // `alepha pack` is what to run when the file itself is wanted.
      await this.fs.rm(archivePath, { force: true });
    }
  }

  /**
   * The longest list of paths Lore keeps beside a set, joined by line
   * breaks. Tied to `commit_quest_sets.paths`.
   */
  public static readonly MAX_PATHS_LENGTH = 2000;

  /**
   * Walk the commit's history for quest references, from the newest
   * ancestor Lore already has a complete set for (#E154). A bare `#<n>`
   * counts when the nearest `.alepha/lore.json` says `bareQuestRefs`.
   *
   * When that file declares the app's paths (#Q3868), walk a second time
   * over the commits that touched them only. The whole-history walk is
   * always sent too: "behind" is read against it.
   */
  protected async walk(
    root: string,
    projectId: number,
    app: string,
  ): Promise<{
    whole: QuestWalk;
    scoped?: { paths: string; walk: QuestWalk };
    /**
     * Why the app's paths were declared and not walked.
     */
    skipped?: string;
  }> {
    const link = await this.link.find(root).catch(() => undefined);
    const bare = link?.bareQuestRefs === true;
    const whole = await this.history.walk({
      root,
      bare,
      known: async (shas) => {
        try {
          return (
            await this.liveQuests.findKnownCommits({
              params: { projectId },
              body: { shas },
            })
          ).known;
        } catch {
          // An older Lore has no such endpoint: walk the whole history.
          return undefined;
        }
      },
    });

    const declared = link?.apps[app.trim().toLowerCase()];
    if (!declared) {
      return { whole };
    }
    const paths = declared.join("\n");
    if (paths.length > LoreArtifactPusher.MAX_PATHS_LENGTH) {
      return {
        whole,
        skipped: `The paths of ${app} in ${link.path} are longer than the ${LoreArtifactPusher.MAX_PATHS_LENGTH} characters Lore keeps: its quests follow the whole history.`,
      };
    }
    const walk = await this.history.walk({
      root,
      bare,
      paths: declared,
      known: async (shas) => {
        try {
          const answer = await this.liveQuests.findKnownCommits({
            params: { projectId },
            body: { shas, app, paths },
          });
          // ⚠️ A Lore from before #Q3868 ignores `app` and answers the
          // whole-history sets, which are no base for this walk. It echoes
          // no `app` either, and that is how it is told apart.
          return answer.app === undefined ? undefined : answer.known;
        } catch {
          return undefined;
        }
      },
    });
    if (walk.reason === "no-repository" || walk.reason === "git-failed") {
      return {
        whole,
        skipped: `The paths of ${app} could not be read from git: its quests follow the whole history.`,
      };
    }
    return { whole, scoped: { paths, walk } };
  }

  /**
   * One line: "N quests referenced (complete|partial, since <base> or full
   * history), clean|dirty".
   */
  public questLine(
    walk: QuestWalk | undefined,
    tree: { dirty: boolean } | undefined,
    count: number | undefined,
  ): string {
    const state = tree ? (tree.dirty ? "dirty" : "clean") : "dirty unknown";
    if (!walk) {
      return `No quests recorded (no commit to record them on), ${state}`;
    }
    const n = count ?? walk.numbers.length;
    const from = walk.base ? `since ${walk.base.slice(0, 12)}` : "full history";
    return `${n} quest${n === 1 ? "" : "s"} referenced (${walk.complete ? "complete" : "partial"}, ${from}), ${state}`;
  }

  /**
   * One line for the app's own set: "N of them touch <app>'s paths
   * (complete|partial, since <base> or full history)".
   */
  public appQuestLine(
    app: string,
    walk: QuestWalk,
    count: number | undefined,
  ): string {
    const n = count ?? walk.numbers.length;
    const from = walk.base ? `since ${walk.base.slice(0, 12)}` : "full history";
    return `${n} of them touch${n === 1 ? "es" : ""} the paths of ${app} (${walk.complete ? "complete" : "partial"}, ${from})`;
  }

  /**
   * Why a set is partial, and what fixes it.
   */
  public partialReason(reason: NonNullable<QuestWalk["reason"]>): string {
    switch (reason) {
      case "shallow":
        return "The quest set is partial: this clone is shallow and Lore knows none of its commits. Set `fetch-depth: 0` on `actions/checkout`.";
      case "no-repository":
        return "The quest set is partial: there is no git repository here.";
      case "git-failed":
        return "The quest set is partial: git could not read the history.";
      case "too-long":
        return `The quest set is partial: the history walked is longer than the ${GitQuestHistory.MAX_WALKED} commits a push sends.`;
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
