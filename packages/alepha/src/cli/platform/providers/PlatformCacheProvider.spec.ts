import { Alepha } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, test } from "vitest";
import { PlatformCacheProvider } from "./PlatformCacheProvider.ts";

describe("PlatformCacheProvider", () => {
  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  const createTestEnv = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const dateTime = alepha.inject(DateTimeProvider);
    const cache = alepha.inject(PlatformCacheProvider);

    return { alepha, fs, dateTime, cache };
  };

  test("returns false when no cache file exists", async ({ expect }) => {
    const { cache } = createTestEnv();
    const result = await cache.isLoginFresh("/project", "cloudflare");
    expect(result).toBe(false);
  });

  test("returns true when login was checked recently", async ({ expect }) => {
    const { cache, dateTime } = createTestEnv();
    dateTime.pause();
    await cache.recordLogin("/project", "cloudflare", "abc123");
    const result = await cache.isLoginFresh("/project", "cloudflare");
    expect(result).toBe(true);
  });

  test("returns false when login cache is stale (>4h)", async ({ expect }) => {
    const { cache, dateTime } = createTestEnv();
    dateTime.pause();
    await cache.recordLogin("/project", "cloudflare", "abc123");
    await dateTime.travel(FOUR_HOURS_MS + 1);
    const result = await cache.isLoginFresh("/project", "cloudflare");
    expect(result).toBe(false);
  });

  test("reads back accountId", async ({ expect }) => {
    const { cache, dateTime } = createTestEnv();
    dateTime.pause();
    await cache.recordLogin("/project", "cloudflare", "abc123");
    const accountId = await cache.getAccountId("/project", "cloudflare");
    expect(accountId).toBe("abc123");
  });

  test("writes to node_modules/.alepha/platform.json", async ({ expect }) => {
    const { cache, fs } = createTestEnv();
    await cache.recordLogin("/project", "cloudflare", "abc123");
    expect(fs.wasWritten("/project/node_modules/.alepha/platform.json")).toBe(
      true,
    );
  });
});
