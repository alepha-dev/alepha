import { $inject } from "alepha";
import { FileStorageProvider } from "alepha/bucket";
import {
  CloudflareAssetManifest,
  type CloudflareAssetEntry,
} from "alepha/cli/platform-lib";
import { DateTimeProvider } from "alepha/datetime";
import { $logger } from "alepha/logger";
import type { MemoryFileSystemProvider } from "alepha/system";

import {
  deployAssetCacheSchema,
  type DeployAssetCacheEntry,
} from "../schemas/deployAssetCacheSchema.ts";
import { ArtifactTarReader } from "./ArtifactTarReader.ts";

/**
 * Disposable, server-computed asset metadata beside the artifact blobs.
 * No files-table row or D1 query is needed to reuse an immutable digest.
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

  public key(sha256: string): string {
    return `deploy-assets-v1-${sha256}.json`;
  }

  public async prepare(
    bucket: string,
    sha256: string,
    bytes: Uint8Array,
    fs: MemoryFileSystemProvider,
    root: string,
  ): Promise<DeployAssetCacheEntry> {
    const cached = await this.read(bucket, sha256);
    this.log.info(
      cached ? "Using cached asset manifest" : "Computing asset manifest",
      { sha256 },
    );
    const manifest: Record<string, CloudflareAssetEntry> =
      cached?.manifest ?? {};
    const configTexts: Record<string, string> = cached?.configTexts ?? {};
    const assets = `${root}/dist/public/`;
    let count = 0;
    let yieldedAt = this.clock.nowMillis();
    const unpacked = await this.reader.extract(bytes, fs, root, {
      skip: (path) => path.startsWith(assets),
      onSkipped: cached
        ? undefined
        : async (path, body) => {
            const key = this.hashes.key(path.slice(assets.length));
            if (this.hashes.isConfigFile(key)) {
              const field = this.hashes.configField(key);
              if (field) configTexts[field] = new TextDecoder().decode(body);
            } else {
              manifest[key] = {
                hash: this.hashes.hash(body, key),
                size: body.length,
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
      version: 1,
      sha256,
      manifest,
      configTexts,
      unpacked,
    };
    if (!cached) await this.write(bucket, entry);
    return entry;
  }

  protected async read(
    bucket: string,
    sha256: string,
  ): Promise<DeployAssetCacheEntry | undefined> {
    try {
      const file = await this.storage.download(bucket, this.key(sha256));
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
  ): Promise<void> {
    try {
      const file = new File([JSON.stringify(entry)], this.key(entry.sha256), {
        type: "application/json",
      });
      if (file.size <= DeployAssetCache.MAX_CACHE_BYTES) {
        await this.storage.upload(bucket, file, this.key(entry.sha256));
      }
    } catch {
      // A failed optimization must never turn a valid deploy into a failure.
    }
  }

  public async remove(bucket: string, sha256: string): Promise<void> {
    try {
      await this.storage.delete(bucket, this.key(sha256));
    } catch {
      // Already absent or unavailable. A shared digest can be rebuilt lazily.
    }
  }
}
