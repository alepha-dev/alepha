import { $inject, Alepha, AlephaError } from "alepha";
import { FileService } from "alepha/api/files";
import {
  AlephaPlatformLibPlugin,
  type CloudflareAssetEntry,
  CloudflareAssetManifest,
  type CloudflareDeployAssets,
  NamingService,
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
import { DeployAssetCache } from "./DeployAssetCache.ts";
import { DeployRegistry } from "./DeployRegistry.ts";
import { StoredNamingService } from "./StoredNamingService.ts";

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
   * The name every resource this deploy provisions carries,
   * `<project>-<app>-<env>`, as stored on the copy (`appInstances.resourceName`).
   *
   * ⚠️ **Read, never recomputed here.** It was decided on the copy's first
   * deploy, from the project's slug at that moment, and a project rename since
   * then must not move it: Cloudflare has no rename, so a new prefix is an
   * empty database beside the live one.
   *
   * ⚠️ `alepha platform` names `<name>-<env>` from its config and must keep
   * doing so: it has no project, it runs against the operator's own account,
   * and changing its scheme would point every existing deploy at a database
   * that does not exist yet.
   */
  name: string;

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
   * ⚠️ **Uploaded WITH the script, not after it**, as `secret_text` bindings
   * of the same version, so a deploy is one Worker version and the new build
   * never runs against the previous secret set - first deploy included. A
   * secret changed on a copy therefore reaches the Worker with its next
   * deploy, not before.
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
  protected readonly assetCache = $inject(DeployAssetCache);

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
  protected static readonly ASSETS = "/deploy/public/";

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
      const { manifest, configTexts, unpacked } = await this.assetCache.prepare(
        ArtifactService.BUCKET,
        request.artifact.sha256,
        bytes,
        fs,
        DeployRunner.ROOT,
      );
      await this.registry.line(
        deployment,
        `Unpacked ${unpacked.files} files (${Math.round(unpacked.bytes / 1024)} KB), ${unpacked.skipped} assets streamed`,
      );

      // ⚠️ The stored name, handed to the naming the container substituted.
      // `platformOptions.name` is only a label past this point: nothing that
      // names a resource reads it once `NamingService` is replaced.
      this.naming(alepha).use(request.name);

      // ⚠️ Before the orchestrator resolves anything. The environment is a
      // Lore row, and this atom is how it reaches an engine that otherwise
      // reads a config file the artifact does not carry.
      alepha.set(platformOptions, {
        name: request.name,
        environments: {
          [request.env]: {
            adapter: WorkerCloudflareAdapter,
            options: { domain: request.domain },
          },
        },
      });

      const adapter = alepha
        .inject(WorkerCloudflareAdapter)
        .use(request.credential)
        .withSecrets(request.secrets ?? {});
      const assets = this.assetsOf(manifest, bytes, deployment, configTexts);
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
   * The container's naming, which must be the stored one.
   *
   * ⚠️ Checked rather than cast. If the substitution in {@link container} ever
   * stopped taking, the original would compose `<project>-<env>` from the
   * platform name and the deploy would provision a fresh, empty set of
   * resources beside the copy's own, reporting success.
   */
  protected naming(alepha: Alepha): StoredNamingService {
    const naming = alepha.inject(NamingService);
    if (!(naming instanceof StoredNamingService)) {
      throw new AlephaError(
        "The deploy container is not using the copy's stored name, so it will not provision anything.",
      );
    }
    return naming;
  }

  /**
   * A container of its own for this deploy.
   */
  protected container(): Alepha {
    return (
      Alepha.create({ env: { LOG_LEVEL: "error" } })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        // ⚠️ Before the plugin, which registers `NamingService` itself: a
        // substitution recorded after it would lose to the original.
        .with({ provide: NamingService, use: StoredNamingService })
        .with(AlephaPlatformLibPlugin)
    );
  }

  /**
   * The artifact's bytes, whole.
   *
   * ⚠️ Held in memory, which is what bounds an artifact at 20 MB on the way in
   * and what `ArtifactTarReader.extract` bounds again on the way out. A
   * streaming unpack would be better and is not what the tar reader does.
   */
  protected async artifactBytes(artifact: Artifact): Promise<Uint8Array> {
    // ⚠️ An image row stores a registry reference and no bytes at all, so
    // there is nothing here to unpack. `DeployService` refuses one before a
    // deployment row is ever created; this is the second wall, and it names
    // the reason rather than dereferencing an absent `fileId`.
    if (!artifact.fileId) {
      throw new BadRequestError(
        `${artifact.app} ${artifact.tag} is a container image (${artifact.reference ?? "no reference recorded"}), not a packed build: Lore stores its reference and never its bytes, so there is nothing to fetch and unpack.`,
      );
    }
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
    // ⚠️ At the archive root. The artifact used to unpack into a `dist/`
    // wrapper; `alepha pack` puts the build's contents at the top now, so a
    // reader still looking under `dist/` finds nothing and reports an
    // artifact that binds nothing at all.
    const path = `${DeployRunner.ROOT}/${ArtifactTarReader.MANIFEST_PATH}`;
    let manifest: { resources?: Record<string, boolean> };
    try {
      manifest = JSON.parse(await fs.readTextFile(path));
    } catch {
      throw new BadRequestError(
        `This artifact carries no readable ${ArtifactTarReader.MANIFEST_PATH}, so there is nothing to say what it binds.`,
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
   * The first pass unpacks server files and hashes assets only when the
   * digest has no cached manifest. The second pass feeds
   * `CloudflareDeployClient` file by file, and it
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
    configTexts: Record<string, string> = {},
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
      // ⚠️ Only the texts. The adapter merges them into the wrangler config's
      // own asset behaviour (`not_found_handling`, `run_worker_first`), and
      // it is the only place that knows that config.
      ...(Object.keys(configTexts).length > 0 ? { config: configTexts } : {}),
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
    type Task = { name: string; handler: () => Promise<unknown> };
    /*
      ⚠️ An ARRAY is a set of steps to run concurrently, which is what the
      CLI's `Runner` does with one, and what an adapter passes to provision a
      database and a bucket at once. Treated as one task here, it would crash
      on `task.handler`.

      The lines go first and in order, the handlers after, together:
      `registry.line` is a read-modify-write of one row with no lock, so two
      lines written at the same moment would lose one of them.
    */
    const run = async (task: Task | Task[]) => {
      if (Array.isArray(task)) {
        for (const it of task) {
          await registry.line(deployment, it.name);
        }
        return await Promise.all(task.map((it) => it.handler()));
      }
      await registry.line(deployment, task.name);
      return await task.handler();
    };
    return Object.assign(run, { end: () => {} });
  }
}
