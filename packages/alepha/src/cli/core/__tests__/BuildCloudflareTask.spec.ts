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
  public testEnhanceQueue = this.enhanceQueue.bind(this);
  public testEnhanceDurableObjects = this.enhanceDurableObjects.bind(this);
  public testWriteWorkerEntryPoint = this.writeWorkerEntryPoint.bind(this);
  public testGenerateCloudflare = this.generateCloudflare.bind(this);

  public setHasWebSocket(value: boolean): void {
    this.hasWebSocket = value;
  }

  public setWebsocketPaths(paths: string[]): void {
    this.websocketPaths = paths;
  }
}

describe("BuildCloudflareTask", () => {
  const createTask = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return alepha.inject(TestBuildCloudflareTask);
  };

  const createTaskWithFs = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      task: alepha.inject(TestBuildCloudflareTask),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  // Snapshot + restore the env vars these enhancers read so tests don't leak.
  const ENV_KEYS = [
    "DATABASE_URL",
    "R2_BUCKET_NAME",
    "CLOUDFLARE_JURISDICTION",
    "CLOUDFLARE_QUEUE_NAME",
    "CLOUDFLARE_QUEUE_DLQ_NAME",
    "CLOUDFLARE_QUEUE_MAX_RETRIES",
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

  describe("enhanceQueue", () => {
    /**
     * The worker's queue handler calls `msg.retry()` on any throw. Without a
     * `dead_letter_queue`, CF burns its retries and then DISCARDS the message —
     * a poison job disappears with no record and no signal.
     */
    it("gives the consumer a dead-letter queue and a retry ceiling", () => {
      process.env.CLOUDFLARE_QUEUE_NAME = "my-queue";

      const wrangler: Record<string, any> = {};
      createTask().testEnhanceQueue(wrangler);

      expect(wrangler.queues.consumers).toEqual([
        {
          queue: "my-queue",
          dead_letter_queue: "my-queue-dlq",
          max_retries: 3,
        },
      ]);
    });

    it("honours an explicit dead-letter queue and retry ceiling", () => {
      process.env.CLOUDFLARE_QUEUE_NAME = "my-queue";
      process.env.CLOUDFLARE_QUEUE_DLQ_NAME = "shared-dlq";
      process.env.CLOUDFLARE_QUEUE_MAX_RETRIES = "5";

      const wrangler: Record<string, any> = {};
      createTask().testEnhanceQueue(wrangler);

      expect(wrangler.queues.consumers[0]).toEqual({
        queue: "my-queue",
        dead_letter_queue: "shared-dlq",
        max_retries: 5,
      });
    });

    it("ignores a non-numeric retry ceiling rather than emitting NaN", () => {
      process.env.CLOUDFLARE_QUEUE_NAME = "my-queue";
      process.env.CLOUDFLARE_QUEUE_MAX_RETRIES = "not-a-number";

      const wrangler: Record<string, any> = {};
      createTask().testEnhanceQueue(wrangler);

      expect(wrangler.queues.consumers[0].max_retries).toBe(3);
    });
  });

  describe("enhanceDurableObjects", () => {
    it("emits the DO binding + sqlite migration when websocket is present", () => {
      const task = createTask();
      task.setHasWebSocket(true);

      const wrangler: Record<string, any> = {};
      task.testEnhanceDurableObjects(wrangler);

      expect(wrangler.durable_objects.bindings).toEqual([
        {
          name: "ALEPHA_WEBSOCKET",
          class_name: "AlephaWebSocketDurableObject",
        },
      ]);
      expect(wrangler.migrations).toEqual([
        { tag: "v1", new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
      ]);
    });

    it("no-ops when websocket is absent", () => {
      const task = createTask();
      task.setHasWebSocket(false);

      const wrangler: Record<string, any> = {};
      task.testEnhanceDurableObjects(wrangler);

      expect(wrangler.durable_objects).toBeUndefined();
      expect(wrangler.migrations).toBeUndefined();
    });
  });

  describe("writeWorkerEntryPoint", () => {
    const ENTRY = "/root/dist/main.cloudflare.js";

    /**
     * A single CF isolate serves concurrent invocations. Stashing the
     * per-invocation `executionCtx.waitUntil` on the shared Alepha store means
     * request B overwrites request A's, and A's background work then calls B's
     * (already-returned) context — "waitUntil after response" — silently
     * killing it. The handle must ride the per-invocation async context.
     */
    it("does not stash waitUntil on the shared global store", async () => {
      const { task, fs } = createTaskWithFs();

      await task.testWriteWorkerEntryPoint("/root", "dist");

      expect(
        fs.wasWrittenMatching(
          ENTRY,
          /__alepha\.set\(\s*["']cloudflare\.waitUntil["']/,
        ),
      ).toBe(false);
    });

    it("scopes waitUntil to each invocation's async context", async () => {
      const { task, fs } = createTaskWithFs();

      await task.testWriteWorkerEntryPoint("/root", "dist");

      // Every entry point (fetch / scheduled / queue) must run its body inside
      // an Alepha fork seeded with that invocation's waitUntil.
      expect(fs.wasWrittenMatching(ENTRY, /__alepha\.context\.run\(/)).toBe(
        true,
      );
    });

    describe("websocket routing", () => {
      it("re-exports the DO class and adds an upgrade branch when websocket is present", async () => {
        const { task, fs } = createTaskWithFs();
        task.setHasWebSocket(true);
        task.setWebsocketPaths(["/ws/chat"]);

        await task.testWriteWorkerEntryPoint("/root", "dist");

        expect(
          fs.wasWrittenMatching(
            ENTRY,
            /export \{ AlephaWebSocketDurableObject \} from "\.\/index\.js"/,
          ),
        ).toBe(true);
        expect(fs.wasWrittenMatching(ENTRY, /Upgrade/)).toBe(true);
        expect(fs.wasWrittenMatching(ENTRY, /idFromName/)).toBe(true);
        // The registered channel path must be baked into the routing guard.
        expect(fs.wasWrittenMatching(ENTRY, /\["\/ws\/chat"\]/)).toBe(true);
        // Regression guard for the brief's incorrect `endpoint.options.secure`
        // shape: `getEndpoint` returns `WebSocketPrimitiveOptions` directly,
        // so `secure` is a top-level field.
        expect(fs.wasWrittenMatching(ENTRY, /endpoint\.secure/)).toBe(true);
        expect(fs.wasWrittenMatching(ENTRY, /endpoint\.options\.secure/)).toBe(
          false,
        );
      });

      it("strips any client-forged x-alepha-ws-user header before trusting it", async () => {
        const { task, fs } = createTaskWithFs();
        task.setHasWebSocket(true);
        task.setWebsocketPaths(["/ws/chat"]);

        await task.testWriteWorkerEntryPoint("/root", "dist");

        const content = fs.getFileContent(ENTRY) ?? "";
        const deleteIndex = content.indexOf(
          'forward.headers.delete("x-alepha-ws-user")',
        );
        const setIndex = content.indexOf(
          'if (userId) forward.headers.set("x-alepha-ws-user"',
        );

        // A forged inbound `x-alepha-ws-user` header must be deleted before
        // the trusted value is conditionally set — otherwise an anonymous
        // client on a non-secure endpoint could forge its identity.
        expect(deleteIndex).toBeGreaterThan(-1);
        expect(setIndex).toBeGreaterThan(-1);
        expect(deleteIndex).toBeLessThan(setIndex);
      });

      it("omits the DO export and upgrade branch when websocket is absent", async () => {
        const { task, fs } = createTaskWithFs();
        task.setHasWebSocket(false);

        await task.testWriteWorkerEntryPoint("/root", "dist");

        expect(
          fs.wasWrittenMatching(ENTRY, /AlephaWebSocketDurableObject/),
        ).toBe(false);
        expect(fs.wasWrittenMatching(ENTRY, /Upgrade/)).toBe(false);
      });
    });
  });

  describe("generateCloudflare (manifest/prebuilt mode)", () => {
    /**
     * In `--prebuilt`/manifest mode there is no live Alepha to probe, so
     * `websocketPaths` must come from `ctx.manifest` instead — otherwise the
     * emitted worker's `wsPaths` routing guard stays empty and WebSocket
     * upgrades silently fail to route even though the DO binding and
     * migration are still emitted (see FIX 3).
     */
    it("resolves websocketPaths from ctx.manifest so the emitted worker's routing guard is populated", async () => {
      const { task, fs } = createTaskWithFs();

      const ctx = {
        root: "/root",
        options: {},
        platformOptions: null,
        manifest: {
          version: 1,
          project: "my-app",
          defaultEnv: "production",
          environments: {},
          resources: {
            hasDatabase: false,
            hasBucket: false,
            hasKV: false,
            hasQueue: false,
            hasCron: false,
            hasWebSocket: true,
          },
          crons: [],
          websocketPaths: ["/ws/chat"],
          env: [],
        },
      } as any;

      await task.testGenerateCloudflare(ctx, "dist");

      expect(
        fs.wasWrittenMatching(
          "/root/dist/main.cloudflare.js",
          /\["\/ws\/chat"\]/,
        ),
      ).toBe(true);
    });
  });
});
