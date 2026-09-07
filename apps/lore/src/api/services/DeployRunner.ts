import { $inject, Alepha } from "alepha";
import { FileService } from "alepha/api/files";
import {
  AlephaPlatformLibPlugin,
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

  /**
   * Where the artifact is unpacked inside the in-memory filesystem.
   *
   * Absolute and fixed: the tree is private to one container, so there is
   * nothing for a second deploy to collide with, and a path derived from the
   * deployment id would only make the log harder to read.
   */
  protected static readonly ROOT = "/deploy";

  public async run(
    request: DeployRequest,
  ): Promise<{ urls: string[]; domain?: string }> {
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
      const unpacked = await this.reader.extract(bytes, fs, DeployRunner.ROOT);
      await this.registry.line(
        deployment,
        `Unpacked ${unpacked.files} files (${Math.round(unpacked.bytes / 1024)} KB)`,
      );

      // ⚠️ Before the orchestrator resolves anything. The environment is a
      // Lore row, and this atom is how it reaches an engine that otherwise
      // reads a config file the artifact does not carry.
      alepha.set(platformOptions, {
        name: request.artifact.app,
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
        .use(request.credential);

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
      return result;
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
