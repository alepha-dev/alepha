import { $inject } from "alepha";
import { FileStorageProvider } from "alepha/bucket";
import { CloudflareAssetManifest } from "alepha/cli/infra-lib";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { MemoryFileSystemProvider } from "alepha/system";

import type { ArtifactAssetList } from "../schemas/artifactAssetListSchema.ts";
import {
  deployAssetCacheSchema,
  type DeployAssetCacheEntry,
} from "../schemas/deployAssetCacheSchema.ts";
import {
  ArtifactTarReader,
  type ArtifactTarSource,
} from "./ArtifactTarReader.ts";

/**
 * The asset list of an archive, stored beside it in the artifacts bucket: for
 * every asset its Cloudflare key, size and digest, plus the `_headers` and
 * `_redirects` texts. No files-table row or D1 query is needed to reuse it.
 *
 * ## Two sources (#Q3381)
 *
 * - **Pushed**: computed by the pusher's CLI and sent with the archive. The
 *   pusher's claim, so it is stored under the PROJECT that received it
 *   ({@link pushedKey}) and read only by that project's deploys.
 * - **Computed**: by a deploy, from the archive's own bytes, when no list was
 *   pushed (an older CLI). Lore's own work, so it is keyed by the digest
 *   alone ({@link key}) and shared by every deploy of those bytes.
 *
 * The row links to neither by a column: both keys derive from the row's own
 * `sha256` and `projectId`, which is the link.
 */
export class DeployAssetCache {
  protected readonly log = $logger();
  protected readonly storage = $inject(FileStorageProvider);
  protected readonly reader = $inject(ArtifactTarReader);
  protected readonly hashes = $inject(CloudflareAssetManifest);
  protected readonly clock = $inject(DateTimeProvider);
  protected static readonly MAX_CACHE_BYTES = 4 * 1024 * 1024;
  protected static readonly YIELD_EVERY = 32;
  protected static readonly YIELD_AFTER_MS = 25;

  /**
   * Where the list of an archive lives, beside it in the artifacts bucket.
   *
   * ⚠️ **The version is in the key, and bumping it is how a scheme change is
   * made safe.** `v1` lists carry wrangler's blake3 keys; `v2` carries the
   * SHA-256-derived keys of #Q3377. A v1 list read after the switch would
   * negotiate an upload session with keys no deployer computes any more, so
   * it is simply never found and the list is computed again.
   */
  public key(sha256: string): string {
    return `deploy-assets-v${DeployAssetCache.VERSION}-${sha256}.json`;
  }

  /**
   * Where a list PUSHED to one project lives: per project, because it is the
   * pusher's claim and must never steer another project's deploy of the same
   * bytes.
   */
  public pushedKey(projectId: number, sha256: string): string {
    return `deploy-assets-v${DeployAssetCache.VERSION}-p${projectId}-${sha256}.json`;
  }

  /**
   * Store the list a push carried, in the form a deploy reads.
   *
   * Each Cloudflare key is derived here from the pushed digest and the path:
   * one 70-byte hash per asset, never a read of the asset itself.
   */
  public async storePushed(
    bucket: string,
    projectId: number,
    sha256: string,
    list: ArtifactAssetList,
  ): Promise<void> {
    const manifest: DeployAssetCacheEntry["manifest"] = {};
    for (const asset of list.assets) {
      const key = this.hashes.key(asset.path);
      // Configuration travels as text; one listed as an asset is dropped
      // rather than uploaded, where it would be published and applied by
      // nothing.
      if (this.hashes.isConfigFile(key)) continue;
      manifest[key] = {
        hash: await this.hashes.cloudflareKey(asset.sha256, key),
        size: asset.size,
        digest: asset.sha256,
      };
    }
    await this.write(
      bucket,
      {
        version: DeployAssetCache.VERSION,
        sha256,
        manifest,
        configTexts: list.config,
        source: "push",
        unpacked: { files: 0, bytes: 0, skipped: 0 },
      },
      this.pushedKey(projectId, sha256),
    );
  }

  /**
   * The list format, and the version in {@link key}.
   */
  public static readonly VERSION = 2;

  public async prepare(
    bucket: string,
    sha256: string,
    source: ArtifactTarSource,
    fs: MemoryFileSystemProvider,
    root: string,
    projectId?: number,
    leaveOut?: (path: string) => boolean,
  ): Promise<DeployAssetCacheEntry> {
    // The project's pushed list first, then one a deploy computed.
    const cached =
      (projectId === undefined
        ? undefined
        : await this.read(bucket, sha256, this.pushedKey(projectId, sha256))) ??
      (await this.read(bucket, sha256, this.key(sha256)));
    this.log.info(
      cached
        ? `Using the ${cached.source === "push" ? "pushed" : "stored"} asset list`
        : "Computing the asset list",
      { sha256 },
    );
    const manifest: DeployAssetCacheEntry["manifest"] = cached?.manifest ?? {};
    const configTexts: Record<string, string> = cached?.configTexts ?? {};
    // ⚠️ At the archive root. The artifact unpacks to its contents now, so
    // `dist/public/` names a directory that is not there — and the failure is
    // not an error: every asset simply stops being skipped, gets extracted
    // into the isolate, and a 49 MB site kills the deploy on memory.
    const assets = `${root}/public/`;
    let count = 0;
    let yieldedAt = this.clock.nowMillis();
    const unpacked = await this.reader.extract(source, fs, root, {
      // ⚠️ `leaveOut` is the caller's: a slice this deploy never runs is
      // walked past like an asset, and never written (#Q3383).
      skip: (path) => path.startsWith(assets) || Boolean(leaveOut?.(path)),
      onSkipped: cached
        ? undefined
        : async (path, body) => {
            if (!path.startsWith(assets)) return;
            const key = this.hashes.key(path.slice(assets.length));
            if (this.hashes.isConfigFile(key)) {
              const field = this.hashes.configField(key);
              if (field) configTexts[field] = new TextDecoder().decode(body);
            } else {
              const digest = await this.hashes.digest(body);
              manifest[key] = {
                hash: await this.hashes.cloudflareKey(digest, key),
                size: body.length,
                digest,
              };
            }
            if (
              ++count % DeployAssetCache.YIELD_EVERY === 0 ||
              this.clock.nowMillis() - yieldedAt >=
                DeployAssetCache.YIELD_AFTER_MS
            ) {
              // A resolved promise only yields a microtask. A timer gives pending
              // I/O and D1 responses a turn, including after one large asset.
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
              yieldedAt = this.clock.nowMillis();
            }
          },
    });
    const entry: DeployAssetCacheEntry = {
      version: DeployAssetCache.VERSION,
      sha256,
      manifest,
      configTexts,
      source: cached?.source ?? "deploy",
      unpacked,
    };
    if (!cached) await this.write(bucket, entry, this.key(sha256));
    return entry;
  }

  protected async read(
    bucket: string,
    sha256: string,
    key: string,
  ): Promise<DeployAssetCacheEntry | undefined> {
    try {
      const file = await this.storage.download(bucket, key);
      if (file.size > DeployAssetCache.MAX_CACHE_BYTES) return;
      const parsed = deployAssetCacheSchema.safeParse(
        JSON.parse(await file.text()),
      );
      if (parsed.success && parsed.data.sha256 === sha256) return parsed.data;
    } catch {
      // Missing, corrupt and unavailable caches all cost only a fresh hash.
    }
  }

  protected async write(
    bucket: string,
    entry: DeployAssetCacheEntry,
    key: string,
  ): Promise<void> {
    try {
      const file = new File([JSON.stringify(entry)], key, {
        type: "application/json",
      });
      if (file.size <= DeployAssetCache.MAX_CACHE_BYTES) {
        await this.storage.upload(bucket, file, key);
      }
    } catch {
      // A failed optimization must never turn a valid deploy into a failure.
    }
  }

  /**
   * Drop the lists of an archive: the computed one, and the one pushed to
   * `projectId` when it is given.
   */
  public async remove(
    bucket: string,
    sha256: string,
    projectId?: number,
  ): Promise<void> {
    const keys = [this.key(sha256)];
    if (projectId !== undefined) keys.push(this.pushedKey(projectId, sha256));
    for (const key of keys) {
      try {
        await this.storage.delete(bucket, key);
      } catch {
        // Already absent or unavailable. A shared digest can be rebuilt lazily.
      }
    }
  }
}
