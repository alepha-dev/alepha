import { $inject, Alepha, AlephaError } from "alepha";
import { FileService } from "alepha/api/files";
import {
  AlephaInfraLibPlugin,
  type CloudflareAssetEntry,
  CloudflareAssetManifest,
  type CloudflareDeployAssets,
  NamingService,
  InfraOrchestrator,
  infraOptions,
  WorkerCloudflareAdapter,
} from "alepha/cli/infra-lib";
import { $logger } from "alepha/logger";
import { BadRequestError } from "alepha/server";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";

import type { Artifact } from "../entities/artifacts.ts";
import type { DeployAssetCacheEntry } from "../schemas/deployAssetCacheSchema.ts";
import { ArtifactService } from "./ArtifactService.ts";
import {
  ArtifactTarReader,
  type ArtifactTarSource,
} from "./ArtifactTarReader.ts";
import { DeployAssetCache } from "./DeployAssetCache.ts";
import { DeployFileSystemProvider } from "./DeployFileSystemProvider.ts";
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
   * ⚠️ `alepha infra` names `<name>-<env>` from its config and must keep
   * doing so: it has no project, it runs against the operator's own account,
   * and changing its scheme would point every existing deploy at a database
   * that does not exist yet.
   */
  name: string;

  /**
   * The environment, from the `app_instances` row. ⚠️ Not from the artifact:
   * an environment is a ROW in Lore, which is the whole difference between
   * this and `alepha infra`, where it is a declaration in a config file.
   */
  env: string;

  /**
   * The estate's Cloudflare credential, opened at the moment of use.
   */
  credential: {
    apiToken: string;
    accountId: string;
    jurisdiction?: "eu" | "us" | "fedramp";
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
   * The D1, KV and Hyperdrive ids this copy's last deploy recorded
   * (#Q3386), so `provision` checks each by id instead of listing the
   * estate's account. A hint: each is verified, and a missing one is
   * recreated. For Hyperdrive it is also the only config a deploy may take
   * over and PATCH (#Q3510): a same-named one it never recorded is refused.
   */
  known?: {
    d1?: { name: string; id: string };
    kv?: { name: string; id: string };
    hyperdrive?: { name: string; id: string };
  };

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
 * 3. Drive `InfraOrchestrator.up()` against that filesystem, with the
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
 * `InfraInspector.resolveConfig` prefers the `infraOptions` atom over
 * `dist/manifest.json`, and the runner sets that atom. That is the epic's
 * founding difference in one line: `alepha infra` reads
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
   * The Worker entry `alepha build --runtime workerd` writes beside the slice,
   * which `wrangler.jsonc`'s `main` names.
   */
  protected static readonly ENTRY = "main.cloudflare.js";

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
      const fs = alepha.inject(DeployFileSystemProvider);

      await this.registry.line(
        deployment,
        `Fetching ${request.artifact.sha256.slice(0, 12)}`,
      );
      const open = () => this.artifactStream(request.artifact);
      const source = await open();

      await this.registry.line(deployment, "Unpacking");
      const { manifest, configTexts, unpacked } = await this.assetCache.prepare(
        ArtifactService.BUCKET,
        request.artifact.sha256,
        source,
        fs,
        DeployRunner.ROOT,
        request.artifact.projectId,
        (path) => this.isForeignSlice(path),
      );
      await this.registry.line(
        deployment,
        `Unpacked ${unpacked.files} files (${Math.round(unpacked.bytes / 1024)} KB), ${unpacked.skipped} assets streamed`,
      );

      await this.reportSourceMaps(deployment, request.artifact);

      // Before anything is provisioned: the row's manifest may be the one
      // the pusher sent rather than one read from these bytes (#Q2681).
      await this.assertManifestMatches(fs, request.artifact);

      // ⚠️ After the unpack, which writes it, and before `up()`, whose build
      // step would replace it with an entry from Lore's own framework. See
      // `DeployFileSystemProvider`.
      await this.pinEntry(fs, deployment);

      // ⚠️ The stored name, handed to the naming the container substituted.
      // `infraOptions.name` is only a label past this point: nothing that
      // names a resource reads it once `NamingService` is replaced.
      this.naming(alepha).use(request.name);

      // ⚠️ Before the orchestrator resolves anything. The environment is a
      // Lore row, and this atom is how it reaches an engine that otherwise
      // reads a config file the artifact does not carry.
      alepha.set(infraOptions, {
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
        .withSecrets(request.secrets ?? {})
        .withKnownResources(request.known ?? {});
      const assets = this.assetsOf(manifest, open, deployment, configTexts);
      if (assets) {
        adapter.useAssets(assets);
      }

      const result = await alepha.inject(InfraOrchestrator).up({
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
        // What a later rollback past this run reads, to ask only when it
        // crosses a schema change (#Q3479).
        migrationsApplied: adapter.migrationsApplied,
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
   * Whether a path belongs to a server slice a Cloudflare deploy never runs
   * (#Q3383): `server/node/`, `server/bun/` and their `index.<runtime>.js`.
   *
   * ⚠️ Left out of the memory filesystem, not out of the walk: a
   * multi-runtime artifact carries a node slice of tens of megabytes beside
   * the workerd one, and writing it into the isolate cost memory for files no
   * step reads. Only runtimes Cloudflare cannot run are named, so a slice
   * this list does not know is still written.
   */
  protected isForeignSlice(path: string): boolean {
    const relative = path.slice(DeployRunner.ROOT.length + 1);
    return DeployRunner.FOREIGN_RUNTIMES.some(
      (runtime) =>
        relative.startsWith(`server/${runtime}/`) ||
        relative === `index.${runtime}.js`,
    );
  }

  /**
   * The runtimes whose slices a Cloudflare deploy leaves out.
   */
  protected static readonly FOREIGN_RUNTIMES = ["node", "bun"];

  /**
   * Keep the artifact's own Worker entry, when it ships one.
   *
   * An artifact with none (packed by hand, or by a build that predates the
   * entry) still gets the generated one.
   */
  protected async pinEntry(
    fs: DeployFileSystemProvider,
    deployment: string | undefined,
  ): Promise<void> {
    const entry = `${DeployRunner.ROOT}/${DeployRunner.ENTRY}`;
    if (!(await fs.exists(entry))) {
      return;
    }
    fs.pin(entry);
    await this.registry.line(
      deployment,
      `Keeping the artifact's own ${DeployRunner.ENTRY}`,
    );
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
        .with({ provide: FileSystemProvider, use: DeployFileSystemProvider })
        // ⚠️ Before the plugin, which registers `NamingService` itself: a
        // substitution recorded after it would lose to the original.
        .with({ provide: NamingService, use: StoredNamingService })
        .with(AlephaInfraLibPlugin)
    );
  }

  /**
   * Says, once, that this deploy uploads the Worker without its source maps.
   *
   * `alepha deploy` uploads them (#Q3061), but this Worker does not load the
   * maps archive stored beside the build (#Q1515): measured 2026-11-05 on
   * Lore's own build, the workerd slice's maps are 26.7 MB against 6.0 MB of
   * code, and the adapter holds each one twice while normalising it, on top
   * of the unpacked artifact, in a Worker that has already died of memory
   * while unpacking. The line names the size so the gap is visible.
   */
  protected async reportSourceMaps(
    deployment: string | undefined,
    artifact: Artifact,
  ): Promise<void> {
    if (!artifact.mapsFileId) {
      return;
    }
    const size = await this.files
      .getFileById(artifact.mapsFileId)
      .then((file) => file.size)
      .catch(() => undefined);
    await this.registry.line(
      deployment,
      `Source maps not uploaded: this deploy does not load the build's maps archive${size === undefined ? "" : ` (${Math.round(size / 1024)} KB compressed)`}, so Workers Logs show bundled frames`,
    );
  }

  /**
   * The artifact's bytes, as a stream straight from storage.
   *
   * ⚠️ **Never read whole** (#Q3380). The tar reader decodes a stream, so the
   * archive is pulled from R2 as the zstd decoder needs it: what is resident is
   * the decoder's window and one chunk, not the archive. A stream is consumed
   * by one walk, so each pass opens its own.
   */
  protected async artifactStream(
    artifact: Artifact,
  ): Promise<ReadableStream<Uint8Array>> {
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
    return file.stream();
  }

  /**
   * Refuses a deploy whose recorded manifest is not the archive's own.
   *
   * ⚠️ Since #Q2681 a push may send `manifest.json` beside the bytes, so the
   * push never inflates the archive, and the row records what was sent. The
   * archive stays the authority, and this is where it is held to: the
   * runtimes a deploy was matched on, the resources `provision` creates and
   * the secrets it mints all come from the row, so a row that disagrees with
   * the bytes would deploy something other than what it says.
   *
   * Compared after a canonical sort of the keys, so a pusher that serialised
   * the same document in another key order is not refused. A row with no
   * manifest (one too large for the column) has nothing to disagree with.
   */
  protected async assertManifestMatches(
    fs: MemoryFileSystemProvider,
    artifact: Artifact,
  ): Promise<void> {
    if (!artifact.manifest) {
      return;
    }
    const path = `${DeployRunner.ROOT}/${ArtifactTarReader.MANIFEST_PATH}`;
    let archived: unknown;
    let recorded: unknown;
    try {
      archived = JSON.parse(await fs.readTextFile(path));
      recorded = JSON.parse(artifact.manifest);
    } catch {
      throw new BadRequestError(
        `This artifact carries no readable ${ArtifactTarReader.MANIFEST_PATH}, so there is nothing to say what it binds.`,
      );
    }
    // The column never holds `surface` (see `ArtifactService.serialise`), so
    // the archive's copy is compared without it.
    if (
      this.canonical(this.withoutSurface(archived)) !==
      this.canonical(this.withoutSurface(recorded))
    ) {
      throw new BadRequestError(
        `${artifact.app} ${artifact.tag}: the manifest recorded at push does not match the ${ArtifactTarReader.MANIFEST_PATH} inside the archive. Push the build again.`,
      );
    }
  }

  /**
   * JSON with every object's keys sorted, so two serialisations of one
   * document compare equal.
   */
  /**
   * The manifest without its build list, which the column does not store.
   */
  protected withoutSurface(value: unknown): unknown {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const { surface: _surface, ...rest } = value as Record<string, unknown>;
      return rest;
    }
    return value;
  }

  protected canonical(value: unknown): string {
    return JSON.stringify(value, (_key, entry: unknown) =>
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? Object.fromEntries(
            Object.entries(entry as Record<string, unknown>).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          )
        : entry,
    );
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
    listed: DeployAssetCacheEntry["manifest"],
    open: () => Promise<ArtifactTarSource>,
    deployment?: string,
    configTexts: Record<string, string> = {},
  ): CloudflareDeployAssets | undefined {
    if (Object.keys(listed).length === 0) {
      return undefined;
    }
    // ⚠️ Only `hash` and `size` go to Cloudflare: the stored list also keeps
    // each asset's full digest, which is Lore's, and an upload session is
    // negotiated with exactly the two fields its API documents.
    const manifest: Record<string, CloudflareAssetEntry> = {};
    for (const [key, entry] of Object.entries(listed)) {
      manifest[key] = { hash: entry.hash, size: entry.size };
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
      await this.reader.extract(await open(), nowhere, DeployRunner.ROOT, {
        skip: () => true,
        onSkipped: async (path, body) => {
          if (!path.startsWith(DeployRunner.ASSETS)) {
            return;
          }
          const key = this.assetManifest.key(
            path.slice(DeployRunner.ASSETS.length),
          );
          if (keys.has(key)) {
            // ⚠️ The list may be the pusher's claim (#Q3381), so the bytes
            // about to be uploaded are checked against its digest: native
            // SHA-256 over a body already in hand. A body that disagrees is
            // refused, never uploaded under a key it does not match.
            const expected = listed[key]?.digest;
            if (
              expected &&
              (await this.assetManifest.digest(body)) !== expected
            ) {
              throw new BadRequestError(
                `The asset list stored for this build does not match the archive at ${key}. Push the build again.`,
              );
            }
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
