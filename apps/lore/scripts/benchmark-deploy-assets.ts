import { readFile } from "node:fs/promises";

import { Alepha, AlephaError } from "alepha";
import { FileStorageProvider, MemoryFileStorageProvider } from "alepha/bucket";
import {
  CloudflareAssetManifest,
  CloudflareDeployClient,
  type CloudflareAssetEntry,
} from "alepha/cli/platform-lib";
import { MemoryFileSystemProvider } from "alepha/system";

import { deployAssetCacheSchema } from "../src/api/schemas/deployAssetCacheSchema.ts";
import { ArtifactTarReader } from "../src/api/services/ArtifactTarReader.ts";
import { DeployAssetCache } from "../src/api/services/DeployAssetCache.ts";

/**
 * Run against a ustar gzip of a built docs site. The upload uses the real
 * batching and encoding code with a local sink, so network latency is excluded.
 * Example: yarn w lore node scripts/benchmark-deploy-assets.ts /tmp/docs.tar.gz
 */
class DeployAssetBenchmark extends CloudflareAssetManifest {
  base64Ms = 0;
  hashMs = 0;
  override base64(bytes: Uint8Array): string {
    const start = performance.now();
    const result = super.base64(bytes);
    this.base64Ms += performance.now() - start;
    return result;
  }
  override hash(bytes: Uint8Array, path: string): string {
    const start = performance.now();
    const result = super.hash(bytes, path);
    this.hashMs += performance.now() - start;
    return result;
  }

  async run(path: string): Promise<void> {
    const archive = new Uint8Array(await readFile(path));
    const reader = new ArtifactTarReader();
    const sink = { mkdir: async () => {}, writeFile: async () => {} };
    const manifest: Record<string, CloudflareAssetEntry> = {};
    let assetBytes = 0;
    const cpu = process.cpuUsage();
    const started = performance.now();
    const counts = await reader.extract(archive, sink, "/deploy", {
      skip: () => true,
      onSkipped: (path, body) => {
        if (!path.startsWith("/deploy/dist/public/")) return;
        const key = this.key(path.slice("/deploy/dist/public/".length));
        if (this.isConfigFile(key)) return;
        manifest[key] = { hash: this.hash(body, key), size: body.length };
        assetBytes += body.length;
      },
    });
    const firstPassMs = performance.now() - started;
    const firstPassCpu = process.cpuUsage(cpu);
    const cachedStart = performance.now();
    await reader.extract(archive, sink, "/deploy", { skip: () => true });
    const inflateWithoutHashMs = performance.now() - cachedStart;
    const alepha = Alepha.create().with({
      provide: FileStorageProvider,
      use: MemoryFileStorageProvider,
    });
    const cache = alepha.inject(DeployAssetCache);
    const digest = "a".repeat(64);
    const missStart = performance.now();
    await cache.prepare(
      "artifacts",
      digest,
      archive,
      Alepha.create().inject(MemoryFileSystemProvider),
      "/deploy",
    );
    const cacheMissMs = performance.now() - missStart;
    const stored = await alepha
      .inject(MemoryFileStorageProvider)
      .download("artifacts", cache.key(digest));
    const parsed = deployAssetCacheSchema.safeParse(
      JSON.parse(await stored.text()),
    );
    if (!parsed.success)
      throw new AlephaError(JSON.stringify(parsed.error.issues));
    const hitStart = performance.now();
    await cache.prepare(
      "artifacts",
      digest,
      archive,
      Alepha.create().inject(MemoryFileSystemProvider),
      "/deploy",
    );
    const cacheHitMs = performance.now() - hitStart;
    let uploaded = 0;
    const client = new CloudflareDeployClient({
      apiToken: "benchmark",
      accountId: "benchmark",
      client: {
        workers: {
          scripts: {
            assets: {
              upload: {
                create: async () => ({
                  jwt: "local-session",
                  buckets: [Object.values(manifest).map((entry) => entry.hash)],
                }),
              },
            },
          },
          assets: {
            upload: {
              create: async ({ body }: { body: Record<string, File> }) => {
                for (const file of Object.values(body))
                  uploaded += (await file.arrayBuffer()).byteLength;
                return { jwt: "local-completion" };
              },
            },
          },
        },
      } as never,
    });
    const uploadStart = performance.now();
    await client.uploadAssets("benchmark", {
      manifest,
      read: async () => {
        throw new AlephaError("The benchmark requires streaming");
      },
      readAll: async (keys, onFile) => {
        await reader.extract(archive, sink, "/deploy", {
          skip: () => true,
          onSkipped: async (path, body) => {
            if (!path.startsWith("/deploy/dist/public/")) return;
            const key = this.key(path.slice("/deploy/dist/public/".length));
            if (keys.has(key)) await onFile(key, body);
          },
        });
      },
    });
    console.log(
      JSON.stringify(
        {
          files: counts.files,
          assets: Object.keys(manifest).length,
          assetBytes,
          firstPassMs,
          firstPassCpuMs: (firstPassCpu.user + firstPassCpu.system) / 1000,
          base64Ms: this.base64Ms,
          blake3AndEncodingMs: this.hashMs - this.base64Ms,
          inflateAndTraversalMs: firstPassMs - this.hashMs,
          inflateWithoutHashMs,
          cacheMissMs,
          cacheHitMs,
          uploadWithLocalSinkMs: performance.now() - uploadStart,
          uploadedBase64Bytes: uploaded,
        },
        null,
        2,
      ),
    );
  }
}

await new DeployAssetBenchmark().run(process.argv[2] ?? "/tmp/docs.tar.gz");
