import { Alepha, AlephaError } from "alepha";
import { FileStorageProvider, MemoryFileStorageProvider } from "alepha/bucket";
import { CloudflareAssetManifest } from "alepha/cli/infra-lib";
import { MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

// By file, not through the barrel: evaluating `../src/api/index.ts` declares
// `LoreShipApi`, which tags its services, and injecting a tagged one boots
// the whole module. This spec exercises the cache alone.
import { ArtifactTarReader } from "../src/api/services/ArtifactTarReader.ts";
import { DeployAssetCache } from "../src/api/services/DeployAssetCache.ts";
import { gzip, tar } from "../src/testing/artifactTarball.ts";

class CountingManifest extends CloudflareAssetManifest {
  hashes = 0;
  timerFired = false;
  hashesAtTimer = 0;
  override async digest(bytes: Uint8Array): Promise<string> {
    if (++this.hashes === 1) {
      setTimeout(() => {
        this.timerFired = true;
        this.hashesAtTimer = this.hashes;
      }, 0);
    }
    return await super.digest(bytes);
  }
}

describe("deploy asset cache", () => {
  const boot = (reader = ArtifactTarReader) => {
    const alepha = Alepha.create()
      .with({ provide: CloudflareAssetManifest, use: CountingManifest })
      .with({ provide: ArtifactTarReader, use: reader });
    return {
      alepha,
      cache: alepha.inject(DeployAssetCache),
      hashes: alepha.inject(CountingManifest),
      storage: alepha.inject(MemoryFileStorageProvider),
      fs: () => Alepha.create().inject(MemoryFileSystemProvider),
    };
  };
  const bytes = () =>
    gzip(
      tar({
        "index.node.js": "server",
        "public/index.html": "page",
        "public/_headers": `/*\n  X-Test: ${"yes".repeat(200)}\n`,
      }),
    );
  const digest = "a".repeat(64);

  it("hashes a miss, reuses a digest and still unpacks server files on a hit", async ({
    expect,
  }) => {
    const ctx = boot();
    const archive = await bytes();
    const first = await ctx.cache.prepare(
      "artifacts",
      digest,
      archive,
      ctx.fs(),
      "/deploy",
    );
    const target = ctx.fs();
    const second = await ctx.cache.prepare(
      "artifacts",
      digest,
      archive,
      target,
      "/deploy",
    );
    expect(ctx.hashes.hashes).toBe(1);
    expect(second).toEqual(first);
    expect(second.configTexts).toEqual({
      _headers: `/*\n  X-Test: ${"yes".repeat(200)}\n`,
    });
    expect(Object.keys(second.manifest)).toEqual(["/index.html"]);
    expect(await target.readTextFile("/deploy/index.node.js")).toBe("server");
    expect(await target.exists("/deploy/public/index.html")).toBe(false);
    await ctx.cache.prepare(
      "artifacts",
      "b".repeat(64),
      archive,
      ctx.fs(),
      "/deploy",
    );
    expect(ctx.hashes.hashes).toBe(2);
  });

  it("falls back for malformed or mismatched sidecars", async ({ expect }) => {
    const ctx = boot();
    const archive = await bytes();
    const result = await ctx.cache.prepare(
      "artifacts",
      digest,
      archive,
      ctx.fs(),
      "/deploy",
    );
    for (const content of [
      "not json",
      "{}",
      JSON.stringify({ ...result, version: 1, sha256: "b".repeat(64) }),
    ]) {
      await ctx.storage.upload(
        "artifacts",
        new File([content], "cache.json"),
        ctx.cache.key(digest),
      );
      expect(
        await ctx.cache.prepare(
          "artifacts",
          digest,
          archive,
          ctx.fs(),
          "/deploy",
        ),
      ).toEqual(result);
    }
    expect(ctx.hashes.hashes).toBe(4);
  });

  it("never reads a v1 list, whose keys are wrangler's blake3 scheme (#Q3377)", async ({
    expect,
  }) => {
    const ctx = boot();
    const archive = await bytes();
    const fresh = await ctx.cache.prepare(
      "artifacts",
      digest,
      archive,
      ctx.fs(),
      "/deploy",
    );
    await ctx.storage.delete("artifacts", ctx.cache.key(digest));
    await ctx.storage.upload(
      "artifacts",
      new File(
        [JSON.stringify({ ...fresh, version: 1, manifest: {} })],
        "cache.json",
      ),
      `deploy-assets-v1-${digest}.json`,
    );

    const again = await ctx.cache.prepare(
      "artifacts",
      digest,
      archive,
      ctx.fs(),
      "/deploy",
    );

    expect(ctx.cache.key(digest)).toBe(`deploy-assets-v2-${digest}.json`);
    expect(again.manifest).toEqual(fresh.manifest);
    expect(ctx.hashes.hashes).toBe(2);
  });

  describe("a list pushed with the archive (#Q3381)", () => {
    const pushed = {
      version: 1 as const,
      assets: [
        {
          path: "/index.html",
          sha256: "b".repeat(64),
          size: 4,
          contentType: "text/html; charset=utf-8",
        },
      ],
      config: { _headers: "/*\n  X: pushed\n" },
    };

    it("is used by that project's deploy, which then hashes nothing", async ({
      expect,
    }) => {
      const ctx = boot();
      await ctx.cache.storePushed("artifacts", 7, digest, pushed);
      const fs = ctx.fs();

      const entry = await ctx.cache.prepare(
        "artifacts",
        digest,
        await bytes(),
        fs,
        "/deploy",
        7,
      );

      expect(ctx.hashes.hashes).toBe(0);
      expect(entry.source).toBe("push");
      expect(entry.manifest["/index.html"]?.digest).toBe("b".repeat(64));
      expect(entry.configTexts).toEqual(pushed.config);
      // The server files are still unpacked: the list replaces the hashing,
      // never the extraction.
      expect(await fs.readTextFile("/deploy/index.node.js")).toBe("server");
    });

    it("never steers another project's deploy of the same bytes", async ({
      expect,
    }) => {
      const ctx = boot();
      await ctx.cache.storePushed("artifacts", 7, digest, pushed);

      const entry = await ctx.cache.prepare(
        "artifacts",
        digest,
        await bytes(),
        ctx.fs(),
        "/deploy",
        8,
      );

      expect(entry.source).toBe("deploy");
      expect(ctx.hashes.hashes).toBe(1);
      expect(entry.manifest["/index.html"]?.digest).not.toBe("b".repeat(64));
    });
  });

  it("treats storage failures as a cache miss, including writes", async ({
    expect,
  }) => {
    class UnavailableStorage extends MemoryFileStorageProvider {
      override async download(): Promise<never> {
        throw new AlephaError("unavailable");
      }
      override async upload(): Promise<never> {
        throw new AlephaError("unavailable");
      }
    }
    const alepha = Alepha.create().with({
      provide: FileStorageProvider,
      use: UnavailableStorage,
    });
    const cache = alepha.inject(DeployAssetCache);
    const result = await cache.prepare(
      "artifacts",
      digest,
      await bytes(),
      alepha.inject(MemoryFileSystemProvider),
      "/deploy",
    );
    expect(result.manifest["/index.html"].size).toBe(4);
  });

  it("services a real timer before a large batch finishes hashing", async ({
    expect,
  }) => {
    class BufferedReader extends ArtifactTarReader {
      override async extract(
        ...args: Parameters<ArtifactTarReader["extract"]>
      ) {
        const [, , root, options] = args;
        for (let i = 0; i < 200; i++) {
          await options?.onSkipped?.(
            `${root}/public/${i}.html`,
            new Uint8Array([1]),
          );
        }
        return { files: 200, skipped: 200, bytes: 0 };
      }
    }
    const ctx = boot(BufferedReader);
    const files = Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [`public/${i}.html`, "page"]),
    );
    await ctx.cache.prepare(
      "artifacts",
      digest,
      await gzip(tar(files)),
      ctx.fs(),
      "/deploy",
    );
    expect(ctx.hashes.timerFired).toBe(true);
    expect(ctx.hashes.hashesAtTimer).toBeLessThan(200);
  });

  it("removes a sidecar without requiring a metadata row", async ({
    expect,
  }) => {
    const ctx = boot();
    await ctx.cache.prepare(
      "artifacts",
      digest,
      await bytes(),
      ctx.fs(),
      "/deploy",
    );
    await ctx.cache.remove("artifacts", digest);
    expect(await ctx.storage.exists("artifacts", ctx.cache.key(digest))).toBe(
      false,
    );
    await ctx.cache.remove("artifacts", digest);
  });
});
