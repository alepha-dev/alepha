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
  public testEnhanceAnalyticsEngine = this.enhanceAnalyticsEngine.bind(this);
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
    "CLOUDFLARE_ANALYTICS_DATASET",
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

  describe("enhanceAnalyticsEngine", () => {
    it("emits the dataset binding with no id to pair it with", () => {
      process.env.CLOUDFLARE_ANALYTICS_DATASET = "sigil_analytics";
      const wrangler: Record<string, any> = {};
      createTask().testEnhanceAnalyticsEngine(wrangler);

      // Unlike KV and D1, there is no id: Cloudflare provisions the dataset on
      // the first data point, so there is nothing to reference beforehand.
      expect(wrangler.analytics_engine_datasets).toEqual([
        { binding: "ANALYTICS", dataset: "sigil_analytics" },
      ]);
    });

    it("emits nothing at all when no dataset is configured", () => {
      const wrangler: Record<string, any> = {};
      createTask().testEnhanceAnalyticsEngine(wrangler);

      // Absent, not `[]`: an empty array is a key wrangler then validates, and
      // every app that does not use Analytics Engine would carry it.
      expect(wrangler.analytics_engine_datasets).toBeUndefined();
    });

    it("appends to a user-declared dataset list rather than replacing it", () => {
      process.env.CLOUDFLARE_ANALYTICS_DATASET = "sigil_analytics";
      const wrangler: Record<string, any> = {
        analytics_engine_datasets: [{ binding: "OTHER", dataset: "other" }],
      };
      createTask().testEnhanceAnalyticsEngine(wrangler);

      // The user's `cloudflare.config` is spread in before the enhancers run,
      // so a hand-written binding is already present here and must survive.
      expect(wrangler.analytics_engine_datasets).toHaveLength(2);
      expect(wrangler.analytics_engine_datasets[1].binding).toBe("ANALYTICS");
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

    /**
     * `ctx.options.cloudflare.config` is spread into the wrangler BEFORE the
     * enhancers run, so a user-supplied `migrations` array is already present
     * here. Blindly pushing `{ tag: "v1" }` on top of it produced either a
     * duplicate tag (wrangler error) or a duplicated class declaration.
     */
    it("skips the migration when a user migration already declares the DO class", () => {
      const task = createTask();
      task.setHasWebSocket(true);

      const wrangler: Record<string, any> = {
        migrations: [
          { tag: "v1", new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
        ],
      };
      task.testEnhanceDurableObjects(wrangler);

      expect(wrangler.migrations).toEqual([
        { tag: "v1", new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
      ]);
      // The binding itself is still required.
      expect(wrangler.durable_objects.bindings).toEqual([
        {
          name: "ALEPHA_WEBSOCKET",
          class_name: "AlephaWebSocketDurableObject",
        },
      ]);
    });

    it("picks the first free tag when user migrations already occupy v1", () => {
      const task = createTask();
      task.setHasWebSocket(true);

      const wrangler: Record<string, any> = {
        migrations: [{ tag: "v1", new_classes: ["MyOwnDurableObject"] }],
      };
      task.testEnhanceDurableObjects(wrangler);

      expect(wrangler.migrations).toEqual([
        { tag: "v1", new_classes: ["MyOwnDurableObject"] },
        { tag: "v2", new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
      ]);
    });

    it("does not double the DO binding when the user config already declares it", () => {
      const task = createTask();
      task.setHasWebSocket(true);

      const wrangler: Record<string, any> = {
        durable_objects: {
          bindings: [
            {
              name: "ALEPHA_WEBSOCKET",
              class_name: "AlephaWebSocketDurableObject",
            },
          ],
        },
      };
      task.testEnhanceDurableObjects(wrangler);

      expect(wrangler.durable_objects.bindings).toHaveLength(1);
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

    describe("edge cache", () => {
      /**
       * Lifts the generated `isEdgeCacheable` predicate out of the emitted
       * worker and makes it callable, so these assert what the policy DOES
       * rather than how it is spelled. It is the only thing standing between
       * a shared, URL-keyed cache and a per-user response.
       */
      const loadPolicy = async () => {
        const { task, fs } = createTaskWithFs();
        await task.testWriteWorkerEntryPoint("/root", "dist");
        const source = await fs.readTextFile(ENTRY);
        const start = source.indexOf("const isEdgeCacheable");
        const end = source.indexOf("export default");
        return new Function(
          `${source.slice(start, end)}; return isEdgeCacheable;`,
        )() as (request: Request, response?: Response) => boolean;
      };

      const req = (headers: Record<string, string> = {}, method = "GET") =>
        new Request("https://x.test/api/public/files/abc", { method, headers });

      const res = (headers: Record<string, string>, status = 200) =>
        new Response("bytes", { status, headers });

      const PUBLIC = { "cache-control": "public, max-age=31536000, immutable" };

      it("caches a public, anonymous, 200 GET", async () => {
        const isEdgeCacheable = await loadPolicy();
        expect(isEdgeCacheable(req(), res(PUBLIC))).toBe(true);
      });

      it("refuses a response the caller's identity could have shaped", async () => {
        const isEdgeCacheable = await loadPolicy();
        // A shared entry is keyed by URL alone, so a credentialed request must
        // stay out however loudly the route opts in.
        expect(
          isEdgeCacheable(req({ authorization: "Bearer t" }), res(PUBLIC)),
        ).toBe(false);
        expect(isEdgeCacheable(req({ cookie: "sid=1" }), res(PUBLIC))).toBe(
          false,
        );
        expect(
          isEdgeCacheable(req(), res({ ...PUBLIC, "set-cookie": "sid=1" })),
        ).toBe(false);
      });

      it("refuses anything the route did not declare public", async () => {
        const isEdgeCacheable = await loadPolicy();
        expect(
          isEdgeCacheable(req(), res({ "cache-control": "private, no-cache" })),
        ).toBe(false);
        expect(isEdgeCacheable(req(), res({}))).toBe(false);
        expect(
          isEdgeCacheable(req(), res({ "cache-control": "public, no-store" })),
        ).toBe(false);
      });

      it("refuses non-GET and non-200", async () => {
        const isEdgeCacheable = await loadPolicy();
        expect(isEdgeCacheable(req({}, "POST"), res(PUBLIC))).toBe(false);
        expect(isEdgeCacheable(req(), res(PUBLIC, 404))).toBe(false);
        expect(isEdgeCacheable(req(), res(PUBLIC, 206))).toBe(false);
        expect(isEdgeCacheable(req(), undefined)).toBe(false);
      });

      it("looks the cache up before booting the container", async () => {
        const { task, fs } = createTaskWithFs();
        await task.testWriteWorkerEntryPoint("/root", "dist");
        const source = await fs.readTextFile(ENTRY);

        // The whole point: a hit that still paid for __alepha.start() would
        // leave the expensive half of a cold request exactly where it was.
        expect(source.indexOf("cache.match(request)")).toBeLessThan(
          source.indexOf("await __alepha.start()"),
        );
      });
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

      /**
       * A `$room` registers on the provider's room registry, not the
       * `$websocket` endpoint registry — `getEndpoint(path)` returns
       * `undefined` for a room-only path, which silently skipped the 401
       * check and let anonymous sockets into a `$room({ secure: true })`.
       */
      it("falls back to the room endpoint for the secure-401 check", async () => {
        const { task, fs } = createTaskWithFs();
        task.setHasWebSocket(true);
        task.setWebsocketPaths(["/ws/world"]);

        await task.testWriteWorkerEntryPoint("/root", "dist");

        expect(
          fs.wasWrittenMatching(
            ENTRY,
            /wsProvider\.getEndpoint\(url\.pathname\) \?\?\s*wsProvider\.getRoomEndpoint\(url\.pathname\)/,
          ),
        ).toBe(true);
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
            hasAnalytics: false,
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

  describe("generateCloudflare (live probe)", () => {
    const WRANGLER = "/root/dist/wrangler.jsonc";
    const ENTRY = "/root/dist/main.cloudflare.js";

    /**
     * Minimal fake of the workspace's live `ctx.alepha`: `primitives` answers
     * per primitive name; every `inject` the task makes (CronProvider, the CF
     * email provider) is already wrapped in try/catch, so throwing is enough
     * to mean "absent".
     */
    const fakeAlephaWith = (byName: Record<string, string[]>) =>
      ({
        primitives: (name: string) =>
          (byName[name] ?? []).map((path) => ({
            options: { channel: { options: { path } } },
          })),
        inject: () => {
          throw new Error("not available in this fake");
        },
      }) as any;

    const contextFor = (byName: Record<string, string[]>) =>
      ({
        root: "/root",
        options: {},
        platformOptions: null,
        manifest: undefined,
        alepha: fakeAlephaWith(byName),
      }) as any;

    /**
     * The app declares `assets.run_worker_first` to keep the worker out of the
     * static path. Replacing the whole `assets` block would drop `binding`
     * with it, and `env.ASSETS` would vanish without a word.
     */
    it("merges the app's asset config over the defaults instead of replacing it", async () => {
      const { task, fs } = createTaskWithFs();
      await fs.mkdir("/root/dist/public", { recursive: true });

      const ctx = contextFor({});
      ctx.options = {
        cloudflare: {
          config: {
            assets: {
              run_worker_first: ["/api/*"],
              not_found_handling: "404-page",
            },
          },
        },
      };

      await task.testGenerateCloudflare(ctx, "dist");

      const wrangler = JSON.parse(fs.getFileContent(WRANGLER) ?? "{}");
      expect(wrangler.assets).toEqual({
        directory: "./public",
        binding: "ASSETS",
        run_worker_first: ["/api/*"],
        not_found_handling: "404-page",
      });
    });

    /**
     * Prebuilt deploys never load the workspace's `alepha.config.ts`, so the
     * artifact has to remember what it declared. Without this, the build wrote
     * a correct `wrangler.jsonc` and the deploy silently regenerated it with
     * the defaults — no error, and the only symptom was in production.
     */
    it("recovers the app's cloudflare config from the manifest in prebuilt mode", async () => {
      const { task, fs } = createTaskWithFs();
      await fs.mkdir("/root/dist/public", { recursive: true });

      const ctx = contextFor({});
      // Prebuilt: CLI flags only, no workspace config.
      ctx.options = {};
      ctx.manifest = {
        resources: { hasWebSocket: false },
        crons: [],
        websocketPaths: [],
        cloudflareConfig: {
          assets: { run_worker_first: ["/api/*"] },
        },
      };

      await task.testGenerateCloudflare(ctx, "dist");

      const wrangler = JSON.parse(fs.getFileContent(WRANGLER) ?? "{}");
      expect(wrangler.assets).toEqual({
        directory: "./public",
        binding: "ASSETS",
        run_worker_first: ["/api/*"],
      });
    });

    /**
     * lindocara's shape: the realtime layer is `$room` only (no `$websocket`
     * primitive at all). Without the union, the build emitted a worker with
     * no upgrade branch, no DO binding and no DO class export.
     */
    it("wires a $room-only app exactly like a $websocket one", async () => {
      const { task, fs } = createTaskWithFs();

      await task.testGenerateCloudflare(
        contextFor({ $room: ["/ws/world", "/ws/party", "/ws/presence"] }),
        "dist",
      );

      const wrangler = JSON.parse(fs.getFileContent(WRANGLER) ?? "{}");
      expect(wrangler.durable_objects.bindings).toEqual([
        {
          name: "ALEPHA_WEBSOCKET",
          class_name: "AlephaWebSocketDurableObject",
        },
      ]);
      expect(wrangler.migrations).toEqual([
        { tag: "v1", new_sqlite_classes: ["AlephaWebSocketDurableObject"] },
      ]);

      expect(
        fs.wasWrittenMatching(
          ENTRY,
          /export \{ AlephaWebSocketDurableObject \} from "\.\/index\.js"/,
        ),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          ENTRY,
          /\["\/ws\/world","\/ws\/party","\/ws\/presence"\]/,
        ),
      ).toBe(true);
    });

    it("dedups a channel path shared by a $websocket and a $room", async () => {
      const { task, fs } = createTaskWithFs();

      await task.testGenerateCloudflare(
        contextFor({ $websocket: ["/ws/chat"], $room: ["/ws/chat"] }),
        "dist",
      );

      expect(fs.wasWrittenMatching(ENTRY, /\["\/ws\/chat"\]/)).toBe(true);
      expect(
        fs.wasWrittenMatching(ENTRY, /\["\/ws\/chat","\/ws\/chat"\]/),
      ).toBe(false);
    });
  });
});
