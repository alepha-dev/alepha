import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuildCloudflareTask } from "../tasks/BuildCloudflareTask.ts";

/**
 * Exposes the protected binding enhancers so the wrangler.jsonc shape can be
 * asserted directly without driving a full build.
 */
class TestBuildCloudflareTask extends BuildCloudflareTask {
  public testEnhanceD1 = this.enhanceD1.bind(this);
  public testEnhanceR2 = this.enhanceR2.bind(this);
}

describe("BuildCloudflareTask", () => {
  const createTask = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return alepha.inject(TestBuildCloudflareTask);
  };

  // Snapshot + restore the env vars these enhancers read so tests don't leak.
  const ENV_KEYS = [
    "DATABASE_URL",
    "R2_BUCKET_NAME",
    "CLOUDFLARE_JURISDICTION",
  ] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  describe("enhanceD1", () => {
    it("does not emit `jurisdiction` on the D1 binding (wrangler rejects it)", () => {
      // D1 jurisdiction is applied at database-creation time, not on the
      // binding — wrangler warns on the unexpected field. See CloudflareApi.
      process.env.DATABASE_URL = "d1://my-db:db-id-123";
      process.env.CLOUDFLARE_JURISDICTION = "eu";

      const wrangler: Record<string, any> = {};
      createTask().testEnhanceD1(wrangler);

      expect(wrangler.d1_databases).toEqual([
        { binding: "DB", database_name: "my-db", database_id: "db-id-123" },
      ]);
      expect(wrangler.d1_databases[0]).not.toHaveProperty("jurisdiction");
      expect(wrangler.vars.DATABASE_URL).toBe("d1://DB");
    });

    it("ignores non-d1 DATABASE_URL", () => {
      process.env.DATABASE_URL = "postgres://localhost/db";
      const wrangler: Record<string, any> = {};
      createTask().testEnhanceD1(wrangler);
      expect(wrangler.d1_databases).toBeUndefined();
    });
  });

  describe("enhanceR2", () => {
    it("keeps `jurisdiction` on the R2 binding (wrangler accepts it)", () => {
      process.env.R2_BUCKET_NAME = "my-bucket";
      process.env.CLOUDFLARE_JURISDICTION = "eu";

      const wrangler: Record<string, any> = {};
      createTask().testEnhanceR2(wrangler);

      expect(wrangler.r2_buckets).toEqual([
        { binding: "my-bucket", bucket_name: "my-bucket", jurisdiction: "eu" },
      ]);
    });
  });
});
