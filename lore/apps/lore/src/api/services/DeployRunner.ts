import { $inject, Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import {
  AlephaPlatformLibPlugin,
  type CloudflareAssetEntry,
  CloudflareAssetManifest,
  type CloudflareDeployAssets,
  PlatformAdapterRegistry,
  PlatformOrchestrator,
  platformOptions,
  WorkerCloudflareAdapter,
} from "alepha/cli/platform-lib";
import { $logger } from "alepha/logger";
import { BadRequestError } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";

import type { Artifact } from "../entities/artifacts.ts";
import { ArtifactService } from "./ArtifactService.ts";
import { ArtifactTarReader } from "./ArtifactTarReader.ts";
import { DeployRegistry } from "./DeployRegistry.ts";

/**
 * What one deploy is about: which bytes, where they go, and under whose
 * credential.
 */
export interface DeployRequest {
  /**
   * The stored build. Named by ROW rather than by digest so the runner reads
   * the same artifact the deployment row will point at, even while a `latest`
   * push is replacing it underneath.
   */
  artifact: Artifact;

  /**
   * The Lore project's slug, which is the first segment of every resource name
   * this deploy provisions.
   *
   * ⚠️ **This is what keeps two projects off each other's infrastructure.**
   * `NamingService` composes `<name>-<env>`, and with `name` as the app alone
   * two Lore projects that each call an app `api` and deploy `production` onto
   * the same estate compute one `api-production` - one Worker, one database,
   * one bucket, silently shared and each deploy overwriting the other.
   *
   * ⚠️ `alepha platform` does NOT do this and must not: it has no project, it
   * runs against the operator's own account, and changing its scheme would
   * point every existing deploy at a database that does not exist yet.
   * Cloudflare has no rename, so a prefix change is a data migration - which
   * is exactly why this landed while the only copies deployed through Lore
   * were throwaway ones.
   */
  project: string;

  /**
   * The environment, from the `app_instances` row. ⚠️ Not from the artifact:
   * an environment is a ROW in Lore, which is the whole difference between
   * this and `alepha platform`, where it is a declaration in a config file.
   */
  env: string;

  /**
   * The estate's Cloudflare credential, opened at the moment of use.
   */
  credential: {
    apiToken: string;
    accountId: string;
    jurisdiction?: "eu" | "fedramp";
  };

  /**
   * The host this environment answers on, when it has one.
   */
  domain?: string;

  /**
   * The deployment row to write status and log lines against.
   */
  deploymentId?: string;

  /**
   * The copy's environment, opened.
   *
   * ⚠️ **Uploaded WITH the script, not after it.** `PlatformOrchestrator.up()`
   * runs `deploy` then `secrets`, and its own comment records the cost: about
   * six seconds in which the new build runs against the previous secret set,
   * and a deploy introducing a newly required variable boots without it. It is
   * that way round only because `wrangler secret put` needs the worker to
   * exist. Lore does the upload itself, so the constraint is gone and the
   * window never exists - first deploy included.
   *
   * ⚠️ Never logged. Every line this runner writes goes onto a row every member
   * of the project can read.
   */
  secrets?: Record<string, string>;
}

/**
 * Running a deploy inside Lore's own Worker.
 *
 * ## The shape
 *
 * 1. Fetch the artifact's bytes from `$storage`.
 * 2. Unpack them into a `MemoryFileSystemProvider` - guarded, see
 *    `ArtifactTarReader.extract`.
 * 3. Drive `PlatformOrchestrator.up()` against that filesystem, with the
 *    worker-side Cloudflare adapter.
 * 4. Write status and log lines as it goes.
 *
 * ## ⚠️ A container per deploy, and it is not an optimisation to remove
 *
 * The orchestrator, the adapter and the build task all read one
 * `FileSystemProvider`, and each deploy has its own unpacked tree. A shared
 * container would mean two overlapping deploys reading each other's `dist/`,
 * which is the same class of failure as the `process.env` race #288 removed
 * from `runBuildInProcess`, one level up. The container is cheap: no server,
 * no database, no routes.
 *
 * ## ⚠️ The environment is INJECTED, not read from the artifact
 *
 * `PlatformInspector.resolveConfig` prefers the `platformOptions` atom over
 * `dist/manifest.json`, and the runner sets that atom. That is the epic's
 * founding difference in one line: `alepha platform` reads
 * `config.environments[env]` from a file the app committed, and Lore has a
 * ROW. An artifact built before this environment existed deploys to it
 * without a rebuild, which is the entire point of a preview environment.
 *
 * ## ⚠️ The adapter is registered by name, here, on purpose
 *
 * Under `workerd` the platform-lib entry registers `WorkerCloudflareAdapter`
 * already. Under node - every test, and `yarn v` - the full entry registers
 * `CloudflareAdapter`, which shells out to wrangler. Setting the entry
 * explicitly is what makes a deploy behave the same either way, rather than
 * quietly driving the wrong adapter in a test that then proves nothing.
 */
export class DeployRunner {
  protected readonly log = $logger();
  protected readonly files = $inject(FileService);
  protected readonly reader = $inject(ArtifactTarReader);
  protected readonly registry = $inject(DeployRegistry);
  protected readonly assetManifest = $inject(CloudflareAssetManifest);

  /**
   * Where the artifact is unpacked inside the in-memory filesystem.
   *
   * Absolute and fixed: the tree is private to one container, so there is
   * nothing for a second deploy to collide with, and a path derived from the
   * deployment id would only make the log harder to read.
   */
  protected static readonly ROOT = "/deploy";

  /**
   * Where an artifact's static assets live, and the one directory this runner
   * refuses to put in a filesystem.
   */
  protected static readonly ASSETS = "/deploy/dist/public/";

  /**
   * How often the asset upload says where it has got to.
   *
   * The log is a row every project member can read and is capped, so this is
   * a compromise between saying nothing for minutes and filling that cap with
   * progress on a site of a few hundred files.
   */
  protected static readonly PROGRESS_EVERY = 250;

  public async run(request: DeployRequest): Promise<{
    urls: string[];
    domain?: string;
    resources?: Record<string, unknown>;
  }> {
    const deployment = request.deploymentId;
    await this.registry.started(deployment);

    try {
      const alepha = this.container();
      const fs = alepha.inject(MemoryFileSystemProvider);

      await this.registry.line(
        deployment,
        `Fetching ${request.artifact.sha256.slice(0, 12)}`,
      );
      const bytes = await this.artifactBytes(request.artifact);

      await this.registry.line(deployment, "Unpacking");
      // ⚠️ `dist/public` is walked and hashed, never stored. See `assetsOf`.
      const manifest: Record<string, CloudflareAssetEntry> = {};
      const unpacked = await this.reader.extract(bytes, fs, DeployRunner.ROOT, {
        skip: (path) => path.startsWith(DeployRunner.ASSETS),
        onSkipped: (path, body) => {
          const key = this.assetManifest.key(
            path.slice(DeployRunner.ASSETS.length),
          );
          manifest[key] = {
            hash: this.assetManifest.hash(body, key),
            size: body.length,
          };
        },
      });
      await this.registry.line(
        deployment,
        `Unpacked ${unpacked.files} files (${Math.round(unpacked.bytes / 1024)} KB), ${unpacked.skipped} assets streamed`,
      );

      // ⚠️ Before the orchestrator resolves anything. The environment is a
      // Lore row, and this atom is how it reaches an engine that otherwise
      // reads a config file the artifact does not carry.
      alepha.set(platformOptions, {
        // `<project>-<app>`, so `NamingService` composes
        // `<project>-<app>-<env>`. See `DeployRequest.project`.
        name: `${request.project}-${request.artifact.app}`,
        environments: {
          [request.env]: {
            adapter: "cloudflare",
            domain: request.domain,
          },
        },
      } as never);

      alepha
        .inject(PlatformAdapterRegistry)
        .set("cloudflare", WorkerCloudflareAdapter);
      const adapter = alepha
        .inject(WorkerCloudflareAdapter)
        .use(request.credential)
        .withSecrets(request.secrets ?? {});
      const assets = this.assetsOf(manifest, bytes, deployment);
      if (assets) {
        adapter.useAssets(assets);
      }

      const result = await alepha.inject(PlatformOrchestrator).up({
        root: DeployRunner.ROOT,
        env: request.env,
        // Prebuilt: Lore's Worker cannot run Vite, so `dist/` always arrives
        // built and `build` only regenerates the deploy config.
        prebuilt: true,
        entry: { root: DeployRunner.ROOT, server: "" } as never,
        resources: (await this.resourcesOf(fs)) as never,
        run: this.runner(deployment) as never,
      });

      await this.registry.succeeded(deployment, {
        url: result.urls[0],
        // ⚠️ Read off the adapter rather than returned by `up()`, which answers
        // a URL. It is what makes #1519's fast rollback possible: Cloudflare
        // keeps every uploaded version, so pointing at an older one needs no
        // artifact at all.
        versionId: adapter.deployedVersionId,
      });
      // ⚠️ Carried out so the copy can record what Lore created for it. A
      // teardown that had to recompute these names would delete whatever bears
      // them on a lent account, which is not the same thing as deleting what
      // Lore made.
      return { ...result, resources: adapter.provisionedResources };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.registry.failed(deployment, message);
      throw error;
    }
  }

  /**
   * A container of its own for this deploy.
   */
  protected container(): Alepha {
    return Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with(AlephaPlatformLibPlugin);
  }

  /**
   * The artifact's bytes, whole.
   *
   * ⚠️ Held in memory, which is what bounds an artifact at 20 MB on the way in
   * and what `ArtifactTarReader.extract` bounds again on the way out. A
   * streaming unpack would be better and is not what the tar reader does.
   */
  protected async artifactBytes(artifact: Artifact): Promise<Uint8Array> {
    const file = await this.files.streamFile(artifact.fileId, {
      bucket: ArtifactService.BUCKET,
    });
    return new Uint8Array(await file.arrayBuffer());
  }

  /**
   * What the app binds, from its own manifest.
   *
   * ⚠️ Read from the artifact and never guessed. `provision` creates exactly
   * what this says, so an over-broad answer bills somebody for a bucket their
   * app never opens.
   */
  protected async resourcesOf(
    fs: MemoryFileSystemProvider,
  ): Promise<Record<string, boolean>> {
    const path = `${DeployRunner.ROOT}/dist/manifest.json`;
    let manifest: { resources?: Record<string, boolean> };
    try {
      manifest = JSON.parse(await fs.readTextFile(path));
    } catch {
      throw new BadRequestError(
        "This artifact carries no readable dist/manifest.json, so there is nothing to say what it binds.",
      );
    }
    return {
      hasDatabase: false,
      hasBucket: false,
      hasAnalytics: false,
      hasKV: false,
      hasQueue: false,
      hasCron: false,
      ...manifest.resources,
    };
  }

  /**
   * The app's static assets, as a manifest already computed plus a way to read
   * the bytes back - without either of them ever being held.
   *
   * ## ⚠️ Why the assets never reach the filesystem
   *
   * `extract` used to write every entry into the `MemoryFileSystemProvider`,
   * so a site's whole `dist/public` was resident before the build read a byte.
   * `apps/docs` is 49 MB of assets across 1629 files inside a 128 MB isolate,
   * and it died with `Worker exceeded memory limit` while unpacking - leaving
   * a row reading `running` for ever, because the timer meant to abandon it
   * died with the isolate.
   *
   * So the archive is walked TWICE and nothing is kept either time. The first
   * pass hashes each asset as it goes past, which is all the upload session
   * needs. The second feeds `CloudflareDeployClient` file by file, and it
   * uploads each batch as that batch fills, so what is resident is one batch.
   *
   * ⚠️ The cost is a second inflate of the archive, paid only for the assets
   * Cloudflare actually asks for - a redeploy of unchanged bytes asks for
   * none, and the walk never happens. That is the right way round: the pass is
   * cheap and predictable, and the memory it replaces was neither.
   */
  protected assetsOf(
    manifest: Record<string, CloudflareAssetEntry>,
    bytes: Uint8Array,
    deployment?: string,
  ): CloudflareDeployAssets | undefined {
    if (Object.keys(manifest).length === 0) {
      return undefined;
    }

    const readAll = async (
      keys: Set<string>,
      onFile: (key: string, body: Uint8Array) => Promise<void>,
    ) => {
      // ⚠️ A sink that writes nothing, because this pass exists only for its
      // `onSkipped`. Storing here would put back exactly what the first pass
      // went out of its way not to store.
      const nowhere = {
        mkdir: async () => {},
        writeFile: async () => {},
      };
      // ⚠️ Progress is reported from HERE rather than from the client, and it
      // is not decoration: an upload of thousands of files is the one step
      // that can outlive a run, and a log that jumps from "deploy worker" to
      // silence cannot say whether it was abandoned at its own deadline or
      // killed under it. One line per PROGRESS_EVERY files answers that from
      // the timestamps alone.
      let sent = 0;
      await this.reader.extract(bytes, nowhere, DeployRunner.ROOT, {
        skip: () => true,
        onSkipped: async (path, body) => {
          if (!path.startsWith(DeployRunner.ASSETS)) {
            return;
          }
          const key = this.assetManifest.key(
            path.slice(DeployRunner.ASSETS.length),
          );
          if (keys.has(key)) {
            await onFile(key, body);
            if (++sent % DeployRunner.PROGRESS_EVERY === 0) {
              await this.registry.line(
                deployment,
                `Uploaded ${sent}/${keys.size} assets`,
              );
            }
          }
        },
      });
      if (sent > 0) {
        await this.registry.line(deployment, `Uploaded ${sent} assets`);
      }
    };

    return {
      manifest,
      readAll,
      // Never called while `readAll` is present, and present because the
      // interface is the same one a laptop deploy satisfies off a disk.
      read: async (key) => {
        let found: Uint8Array | undefined;
        await readAll(new Set([key]), async (_, body) => {
          found = body;
        });
        if (!found) {
          throw new BadRequestError(
            `This artifact no longer carries the asset \`${key}\` the manifest named.`,
          );
        }
        return found;
      },
    };
  }

  /**
   * The `RunnerMethod` the orchestrator reports progress through, wired to the
   * deployment's log.
   *
   * The CLI's own runner draws spinners on a terminal. There is none here, so
   * each step becomes a log line - which is what the UI follows.
   */
  protected runner(deployment: string | undefined) {
    const registry = this.registry;
    const run = async (task: {
      name: string;
      handler: () => Promise<unknown>;
    }) => {
      await registry.line(deployment, task.name);
      return await task.handler();
    };
    return Object.assign(run, { end: () => {} });
  }
}
