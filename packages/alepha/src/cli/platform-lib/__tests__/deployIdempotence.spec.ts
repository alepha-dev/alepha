import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { Alepha, AlephaError } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import { WorkerCloudflareAdapter } from "../adapters/WorkerCloudflareAdapter.ts";
import { platformOptions } from "../atoms/platformOptions.ts";
import { AlephaPlatformLibPlugin } from "../index.ts";
import { PlatformAdapterRegistry } from "../services/PlatformAdapterRegistry.ts";
import { PlatformOrchestrator } from "../services/PlatformOrchestrator.ts";

/**
 * A Worker deploy run twice against the same account.
 *
 * ## ⚠️ Why twice is the case that matters
 *
 * A Lore deploy is a `$job` (`DeployJobs` in `apps/lore`), and a retried or
 * rescheduled execution replays the whole run. So every step has to be safe
 * to repeat, and `DeployJobs` says it is: provisioning finds before it
 * creates, the asset upload dedups by content hash, the script upload is a
 * PUT, the queue consumer is found and rebound, and migrations are guarded by
 * the `d1_migrations` bookkeeping table. This file is what checks that.
 *
 * Twice means twice in full. A run that died halfway through a step - between
 * a migration's import and its bookkeeping row, say - is a different question,
 * and not one this answers.
 *
 * ## ⚠️ Only Cloudflare is fake, and it is faked where the network is
 *
 * The run is built the way `DeployRunner` builds it - a container of its own,
 * the worker-side adapter registered by name, `PlatformOrchestrator.up()` in
 * prebuilt mode - and everything in it is real: the adapter, the build task
 * that regenerates `wrangler.jsonc`, `D1MigrationsService`, both Cloudflare
 * clients, and the `cloudflare` SDK under the deploy client.
 *
 * The fake stands behind `fetch` and answers Cloudflare's REST API, rather
 * than replacing a client. A fake shaped by `CloudflareDeployApi` agrees with
 * that hand-written interface by construction, and a client replaced by a
 * stub never runs its own find-before-create at all, so neither can say
 * whether a replay is safe. Its D1 is a real SQLite database, so a migration
 * applied twice fails the way it would there.
 *
 * It refuses what Cloudflare refuses: a second database, bucket, namespace or
 * queue under a name the account already holds, and a second consumer for the
 * same Worker on one queue. A replay that creates instead of finding fails on
 * its second run, which is the only way a test of idempotence can go red.
 */
describe("a Worker deploy, replayed against the account it deployed to", () => {
  const credential = { apiToken: "estate-token", accountId: "estate-account" };

  /**
   * What `DeployRunner.resourcesOf` reads out of the artifact.
   */
  const resources = {
    hasDatabase: true,
    hasBucket: true,
    hasAnalytics: false,
    hasKV: true,
    hasQueue: true,
    hasCron: true,
    hasWebSocket: false,
  };

  /**
   * An artifact binding everything a replay could duplicate: a database with
   * two migrations, a bucket, a namespace, the job queue and its consumer, a
   * cron, a custom domain and two static assets.
   */
  const artifact: Record<string, string> = {
    "dist/manifest.json": JSON.stringify({
      version: 1,
      runtime: "workerd",
      project: "notes",
      defaultEnv: "production",
      environments: { production: { adapter: "cloudflare" } },
      crons: ["0 3 * * *"],
      websocketPaths: [],
      env: [],
      resources,
    }),
    "dist/index.js": "export default { fetch: () => new Response('ok') };",
    "dist/server/chunk.js": "export const chunk = 1;",
    "dist/public/assets/app.3f9a.js": "console.log('app');",
    "dist/public/favicon.svg": "<svg/>",
    "migrations/sqlite/0001_notes/migration.sql":
      "CREATE TABLE notes (id integer PRIMARY KEY, body text NOT NULL);",
    "migrations/sqlite/0002_title/migration.sql":
      "ALTER TABLE notes ADD COLUMN title text;",
  };

  /**
   * One run, shaped as `DeployRunner.run` shapes it.
   *
   * ⚠️ A fresh container every time, because that is what a replay is: a new
   * execution, a new isolate for all it knows, and nothing carried over but
   * what Cloudflare holds.
   */
  const deploy = async (account: FakeCloudflareAccount) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with(AlephaPlatformLibPlugin);
    const fs = alepha.inject(MemoryFileSystemProvider);
    for (const [path, content] of Object.entries(artifact)) {
      await fs.writeFile(`/deploy/${path}`, content);
    }

    alepha.set(platformOptions, {
      name: "acme-notes",
      environments: {
        production: { adapter: "cloudflare", domain: "notes.example.com" },
      },
    } as never);
    alepha
      .inject(PlatformAdapterRegistry)
      .set("cloudflare", WorkerCloudflareAdapter);
    const adapter = alepha
      .inject(WorkerCloudflareAdapter)
      .use(credential)
      .withSecrets({ APP_SECRET: "s3cret" });

    const restore = account.listen();
    try {
      const result = await alepha.inject(PlatformOrchestrator).up({
        root: "/deploy",
        env: "production",
        prebuilt: true,
        entry: { root: "/deploy", server: "" } as never,
        resources: resources as never,
        run: Object.assign(
          async (task: { handler: () => Promise<unknown> }) =>
            await task.handler(),
          { end: () => {} },
        ) as never,
      });
      account.assertAnswered();
      return {
        result,
        versionId: adapter.deployedVersionId,
        recorded: structuredClone(adapter.provisionedResources),
      };
    } finally {
      restore();
    }
  };

  const twice = async () => {
    const account = new FakeCloudflareAccount(credential);
    const first = await deploy(account);
    const afterFirst = {
      resources: account.resources(),
      imports: account.imports.length,
      uploads: account.uploads.length,
    };
    const second = await deploy(account);
    return { account, first, afterFirst, second };
  };

  it("succeeds the second time, at the same address", async ({ expect }) => {
    const { first, second } = await twice();

    expect(second.result).toEqual({
      urls: ["https://notes.example.com"],
      domain: "notes.example.com",
    });
    expect(second.result).toEqual(first.result);
  });

  it("finds every resource the first run made, and creates none", async ({
    expect,
  }) => {
    const { account, afterFirst, first, second } = await twice();

    const held = account.resources();
    expect(held.d1.map((it) => it.name)).toEqual(["acme-notes-production"]);
    expect(held.r2).toEqual(["acme-notes-production"]);
    expect(held.kv.map((it) => it.title)).toEqual(["acme-notes-production"]);
    expect(held.queues.map((it) => it.queue_name)).toEqual([
      "acme-notes-production",
      "acme-notes-production-dlq",
    ]);
    // The same ones, not look-alikes: every id is the one the first run was
    // handed.
    expect(held).toEqual(afterFirst.resources);
    // ⚠️ And the replay records the same ids. Lore stores this record so a
    // teardown deletes what it MADE rather than whatever bears the name, so a
    // replay that recorded a second database would point it at the wrong one.
    expect(second.recorded).toEqual(first.recorded);
  });

  it("applies each migration once, on the first run only", async ({
    expect,
  }) => {
    const { account, afterFirst } = await twice();

    expect(afterFirst.imports).toBe(2);
    expect(account.imports).toEqual([
      {
        database: "acme-notes-production",
        sql: "CREATE TABLE notes (id integer PRIMARY KEY, body text NOT NULL);",
      },
      {
        database: "acme-notes-production",
        sql: "ALTER TABLE notes ADD COLUMN title text;",
      },
    ]);
    expect(
      account.query(
        "acme-notes-production",
        "SELECT name FROM d1_migrations ORDER BY id",
      ),
    ).toEqual([{ name: "0001_notes" }, { name: "0002_title" }]);
  });

  it("uploads no asset the account already holds, and keeps serving them", async ({
    expect,
  }) => {
    const { account, afterFirst } = await twice();

    expect(afterFirst.uploads).toBe(2);
    expect(account.uploads).toHaveLength(2);

    // ⚠️ Nothing uploaded must not mean nothing served. A version that
    // references no asset set is a site that is up and unstyled, behind a
    // green deploy - so the replay's version has to carry the first's.
    const [v1, v2] = account.versions("acme-notes-production");
    expect(Object.keys(v2?.assets ?? {}).sort()).toEqual([
      "/assets/app.3f9a.js",
      "/favicon.svg",
    ]);
    expect(v2?.assets).toEqual(v1?.assets);
  });

  it("rebinds its queue consumer rather than adding a second", async ({
    expect,
  }) => {
    const { account, afterFirst } = await twice();

    expect(account.resources().consumers).toEqual([
      {
        // Updated in place: the id the first run's create was answered with.
        consumer_id: afterFirst.resources.consumers[0]?.consumer_id,
        queue_name: "acme-notes-production",
        script_name: "acme-notes-production",
        dead_letter_queue: "acme-notes-production-dlq",
        // The build's `max_batch_size: 1`, in the API's name for it.
        settings: { batch_size: 1, max_retries: 3 },
      },
    ]);
  });

  it("uploads a Worker bound to what the first run provisioned", async ({
    expect,
  }) => {
    const { account, second } = await twice();

    const versions = account.versions("acme-notes-production");
    // The one change a replay should make: every upload is a version.
    expect(versions).toHaveLength(2);
    expect(second.versionId).toBe(versions[1]?.id);

    const [database] = account.resources().d1;
    const [namespace] = account.resources().kv;
    expect(versions[1]?.metadata.bindings).toEqual(
      expect.arrayContaining([
        { type: "d1", name: "DB", id: database?.uuid },
        {
          type: "kv_namespace",
          name: "KV_CACHE",
          namespace_id: namespace?.id,
        },
        {
          type: "r2_bucket",
          name: "acme-notes-production",
          bucket_name: "acme-notes-production",
        },
        {
          type: "queue",
          name: "JOBS_QUEUE",
          queue_name: "acme-notes-production",
        },
        { type: "secret_text", name: "APP_SECRET", text: "s3cret" },
      ]),
    );
    expect(versions[1]?.metadata.bindings).toEqual(
      versions[0]?.metadata.bindings,
    );
  });

  it("leaves one schedule, one domain and workers.dev as it was", async ({
    expect,
  }) => {
    const { account } = await twice();

    expect(account.script("acme-notes-production")).toMatchObject({
      schedules: ["0 3 * * *"],
      // A copy with a domain stops answering on workers.dev, on every run.
      subdomain: { enabled: false, previews_enabled: false },
    });
    expect(account.resources().domains).toEqual([
      { hostname: "notes.example.com", service: "acme-notes-production" },
    ]);
  });
});

/**
 * One Cloudflare account, answering the part of the REST API a Worker deploy
 * calls, with state.
 *
 * ⚠️ Every refusal answers 400. Cloudflare's own statuses vary by product,
 * and the SDK under the deploy client retries a 409 twice with a backoff, so a
 * realistic status there would turn a red test into a slow one without making
 * it any redder.
 */
class FakeCloudflareAccount {
  protected static readonly API = "https://api.cloudflare.com/client/v4";

  /**
   * Where D1 tells a client to PUT a migration file. An R2 presigned URL in
   * the real flow, which is why it is not under {@link API}.
   */
  protected static readonly D1_UPLOADS = "https://d1-imports.fake.test/";

  protected readonly accountId: string;
  protected readonly apiToken: string;

  protected readonly databases: Array<{
    uuid: string;
    name: string;
    sqlite: DatabaseSync;
  }> = [];
  protected readonly buckets: string[] = [];
  protected readonly namespaces: Array<{ id: string; title: string }> = [];
  protected readonly queues: Array<{ queue_id: string; queue_name: string }> =
    [];
  protected readonly consumers: Array<{
    consumer_id: string;
    queue_id: string;
    script_name: string;
    dead_letter_queue?: string;
    settings?: Record<string, unknown>;
  }> = [];
  protected readonly domains: Array<{ hostname: string; service: string }> = [];
  protected readonly scripts = new Map<
    string,
    {
      versions: FakeWorkerVersion[];
      schedules: string[];
      subdomain?: { enabled: boolean; previews_enabled: boolean };
    }
  >();

  /**
   * Every migration file D1 was asked to run, in order.
   */
  public readonly imports: Array<{ database: string; sql: string }> = [];

  /**
   * Every asset file an upload carried, by hash, in order.
   */
  public readonly uploads: string[] = [];

  /**
   * Requests nothing here models. Collected rather than thrown, because
   * several deploy steps catch their own failures on purpose (the version
   * read-back, the workers.dev subdomain), and a throw there would vanish.
   */
  protected readonly unanswered: string[] = [];

  /**
   * The assets the account holds, by hash. Account-wide and content-addressed,
   * which is what lets a second session ask for nothing.
   */
  protected readonly assets = new Map<string, Uint8Array>();
  protected readonly sessions = new Map<
    string,
    {
      script: string;
      manifest: Record<string, { hash: string; size: number }>;
      wanted: Set<string>;
      received: Set<string>;
    }
  >();
  protected readonly tokens = new Map<
    string,
    { session: string; kind: "upload" | "complete" }
  >();
  protected readonly pendingImports = new Map<
    string,
    { database: string; bytes?: Uint8Array }
  >();
  protected counter = 0;

  constructor(credential: { apiToken: string; accountId: string }) {
    this.accountId = credential.accountId;
    this.apiToken = credential.apiToken;
  }

  /**
   * Stand in for the network until the returned function is called.
   */
  public listen(): () => void {
    const original = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const href =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      // The SDK probes whether this `fetch` can send a `FormData` by fetching
      // a data URL. That is not a request to Cloudflare.
      if (href.startsWith("data:")) {
        return await original(input, init);
      }
      return await this.answer(new Request(input, init), init?.body);
    }) as typeof globalThis.fetch;
    return () => {
      globalThis.fetch = original;
    };
  }

  public assertAnswered(): void {
    if (this.unanswered.length > 0) {
      throw new AlephaError(
        `The deploy reached endpoints the fake account does not model: ${this.unanswered.join(", ")}`,
      );
    }
  }

  /**
   * What the account holds, as plain data.
   */
  public resources() {
    return structuredClone({
      d1: this.databases.map((it) => ({ uuid: it.uuid, name: it.name })),
      r2: this.buckets,
      kv: this.namespaces,
      queues: this.queues,
      consumers: this.consumers.map((it) => this.consumerView(it)),
      domains: this.domains,
    });
  }

  public versions(script: string): FakeWorkerVersion[] {
    return structuredClone(this.scripts.get(script)?.versions ?? []);
  }

  public script(script: string) {
    return structuredClone(this.scripts.get(script));
  }

  /**
   * Read a database directly, the way nothing in a deploy can.
   */
  public query(database: string, sql: string): unknown[] {
    const found = this.databases.find((it) => it.name === database);
    return found ? [...found.sqlite.prepare(sql).all()] : [];
  }

  protected async answer(request: Request, body: unknown): Promise<Response> {
    const url = new URL(request.url);
    if (request.url.startsWith(FakeCloudflareAccount.D1_UPLOADS)) {
      return this.receiveImport(
        url,
        new Uint8Array(await request.arrayBuffer()),
      );
    }
    if (!request.url.startsWith(FakeCloudflareAccount.API)) {
      this.unanswered.push(`${request.method} ${request.url}`);
      return new Response("not modelled", { status: 404 });
    }

    const path = url.pathname.replace(/^\/client\/v4/, "");
    const prefix = `/accounts/${this.accountId}`;
    if (!path.startsWith(`${prefix}/`)) {
      return this.refuse("Authentication error: not this account.", 403);
    }
    const at = path.slice(prefix.length);

    // Every call carries the estate's token, except the asset upload, which
    // authenticates with the session's own.
    if (
      at !== "/workers/assets/upload" &&
      request.headers.get("authorization") !== `Bearer ${this.apiToken}`
    ) {
      return this.refuse("Authentication error: wrong token.", 403);
    }

    const json = async () => JSON.parse((await request.text()) || "null");
    const form = async () =>
      body instanceof FormData ? body : await request.formData();

    const routes: Array<
      [string, RegExp, (params: string[]) => Promise<Response> | Response]
    > = [
      [
        "GET",
        /^\/d1\/database$/,
        () =>
          this.page(
            url,
            this.databases.map((it) => ({ uuid: it.uuid, name: it.name })),
          ),
      ],
      ["POST", /^\/d1\/database$/, async () => this.createD1(await json())],
      [
        "POST",
        /^\/d1\/database\/([^/]+)\/query$/,
        async ([id]) => this.queryD1(id, await json()),
      ],
      [
        "POST",
        /^\/d1\/database\/([^/]+)\/import$/,
        async ([id]) => this.importD1(id, await json()),
      ],
      [
        "GET",
        /^\/r2\/buckets$/,
        () => this.ok({ buckets: this.buckets.map((name) => ({ name })) }),
      ],
      ["POST", /^\/r2\/buckets$/, async () => this.createR2(await json())],
      [
        "GET",
        /^\/storage\/kv\/namespaces$/,
        () => this.page(url, this.namespaces),
      ],
      [
        "POST",
        /^\/storage\/kv\/namespaces$/,
        async () => this.createKV(await json()),
      ],
      ["GET", /^\/queues$/, () => this.page(url, this.queues)],
      ["POST", /^\/queues$/, async () => this.createQueue(await json())],
      [
        "GET",
        /^\/queues\/([^/]+)\/consumers$/,
        ([queue]) =>
          this.ok(
            this.consumers
              .filter((it) => it.queue_id === queue)
              .map((it) => this.consumerView(it)),
          ),
      ],
      [
        "POST",
        /^\/queues\/([^/]+)\/consumers$/,
        async ([queue]) => this.createConsumer(queue, await json()),
      ],
      [
        "PUT",
        /^\/queues\/([^/]+)\/consumers\/([^/]+)$/,
        async ([queue, id]) => this.updateConsumer(queue, id, await json()),
      ],
      [
        "POST",
        /^\/workers\/scripts\/([^/]+)\/assets-upload-session$/,
        async ([script]) => this.openSession(script, await json()),
      ],
      [
        "POST",
        /^\/workers\/assets\/upload$/,
        async () => this.receiveAssets(request, url, await form()),
      ],
      [
        "PUT",
        /^\/workers\/scripts\/([^/]+)$/,
        async ([script]) => this.putScript(script, await form()),
      ],
      [
        "GET",
        /^\/workers\/scripts\/([^/]+)\/versions$/,
        ([script]) => this.listVersions(script),
      ],
      [
        "PUT",
        /^\/workers\/scripts\/([^/]+)\/schedules$/,
        async ([script]) => this.putSchedules(script, await json()),
      ],
      [
        "POST",
        /^\/workers\/scripts\/([^/]+)\/subdomain$/,
        async ([script]) => this.putSubdomain(script, await json()),
      ],
      ["PUT", /^\/workers\/domains$/, async () => this.putDomain(await json())],
      ["GET", /^\/workers\/subdomain$/, () => this.ok({ subdomain: "acme" })],
    ];

    for (const [method, pattern, handle] of routes) {
      const match = request.method === method ? pattern.exec(at) : null;
      if (match) {
        return await handle(match.slice(1) as string[]);
      }
    }
    this.unanswered.push(`${request.method} ${at}`);
    return this.refuse(`No route for ${request.method} ${at}.`, 404);
  }

  // ---------------------------------------------------------------------------
  // D1
  // ---------------------------------------------------------------------------

  protected createD1(body: { name: string }): Response {
    if (this.databases.some((it) => it.name === body.name)) {
      return this.refuse(`A database named ${body.name} already exists.`);
    }
    const database = {
      uuid: this.id("d1"),
      name: body.name,
      sqlite: new DatabaseSync(":memory:"),
    };
    this.databases.push(database);
    return this.ok({ uuid: database.uuid, name: database.name });
  }

  protected queryD1(id: string, body: { sql: string }): Response {
    const database = this.databases.find((it) => it.uuid === id);
    if (!database) {
      return this.refuse(`No D1 database ${id}.`, 404);
    }
    try {
      if (/^\s*select\b/i.test(body.sql)) {
        const results = database.sqlite.prepare(body.sql).all();
        return this.ok([{ results, success: true, meta: {} }]);
      }
      database.sqlite.exec(body.sql);
      return this.ok([{ results: [], success: true, meta: {} }]);
    } catch (error) {
      return this.refuse((error as Error).message);
    }
  }

  /**
   * The `init`, `ingest`, `poll` flow `wrangler d1 execute --file` uses.
   *
   * ⚠️ An ingest RUNS the file, every time. Real D1 is said to answer a file
   * it already holds by md5 as complete without running it; this does not, so
   * it is stricter than the real thing and a migration sent twice fails here
   * rather than being quietly absorbed.
   */
  protected importD1(
    id: string,
    body: { action: string; etag?: string; filename?: string },
  ): Response {
    const database = this.databases.find((it) => it.uuid === id);
    if (!database) {
      return this.refuse(`No D1 database ${id}.`, 404);
    }
    if (body.action === "init") {
      const filename = this.id("import");
      this.pendingImports.set(filename, { database: database.name });
      return this.ok({
        upload_url: `${FakeCloudflareAccount.D1_UPLOADS}${filename}`,
        filename,
      });
    }
    if (body.action === "ingest") {
      const pending = this.pendingImports.get(body.filename ?? "");
      if (!pending?.bytes || pending.database !== database.name) {
        return this.refuse(`Nothing was uploaded as ${body.filename}.`);
      }
      const sql = new TextDecoder().decode(pending.bytes);
      this.imports.push({ database: database.name, sql });
      try {
        database.sqlite.exec(sql);
      } catch (error) {
        return this.ok({ status: "error", errors: [(error as Error).message] });
      }
      return this.ok({ status: "complete" });
    }
    return this.ok({ status: "complete" });
  }

  protected receiveImport(url: URL, bytes: Uint8Array): Response {
    const pending = this.pendingImports.get(url.pathname.slice(1));
    if (!pending) {
      return new Response(null, { status: 404 });
    }
    pending.bytes = bytes;
    return new Response(null, {
      status: 200,
      headers: { etag: `"${createHash("md5").update(bytes).digest("hex")}"` },
    });
  }

  // ---------------------------------------------------------------------------
  // R2, KV, queues
  // ---------------------------------------------------------------------------

  protected createR2(body: { name: string }): Response {
    if (this.buckets.includes(body.name)) {
      return this.refuse(`The bucket ${body.name} already exists.`);
    }
    this.buckets.push(body.name);
    return this.ok({ name: body.name });
  }

  protected createKV(body: { title: string }): Response {
    if (this.namespaces.some((it) => it.title === body.title)) {
      return this.refuse(`A namespace titled ${body.title} already exists.`);
    }
    const namespace = { id: this.id("kv"), title: body.title };
    this.namespaces.push(namespace);
    return this.ok(namespace);
  }

  protected createQueue(body: { queue_name: string }): Response {
    if (this.queues.some((it) => it.queue_name === body.queue_name)) {
      return this.refuse(`A queue named ${body.queue_name} already exists.`);
    }
    const queue = { queue_id: this.id("queue"), queue_name: body.queue_name };
    this.queues.push(queue);
    return this.ok(queue);
  }

  protected createConsumer(
    queueId: string,
    body: {
      script_name: string;
      dead_letter_queue?: string;
      settings?: Record<string, unknown>;
    },
  ): Response {
    const refused = this.refuseConsumer(queueId, body);
    if (refused) {
      return refused;
    }
    if (
      this.consumers.some(
        (it) => it.queue_id === queueId && it.script_name === body.script_name,
      )
    ) {
      return this.refuse(
        `Queue ${queueId} already has a consumer for ${body.script_name}.`,
      );
    }
    const consumer = {
      consumer_id: this.id("consumer"),
      queue_id: queueId,
      script_name: body.script_name,
      dead_letter_queue: body.dead_letter_queue,
      settings: body.settings,
    };
    this.consumers.push(consumer);
    return this.ok(this.consumerView(consumer));
  }

  protected updateConsumer(
    queueId: string,
    consumerId: string,
    body: {
      script_name: string;
      dead_letter_queue?: string;
      settings?: Record<string, unknown>;
    },
  ): Response {
    const consumer = this.consumers.find(
      (it) => it.queue_id === queueId && it.consumer_id === consumerId,
    );
    if (!consumer) {
      return this.refuse(`No consumer ${consumerId} on ${queueId}.`, 404);
    }
    const refused = this.refuseConsumer(queueId, body);
    if (refused) {
      return refused;
    }
    Object.assign(consumer, {
      script_name: body.script_name,
      dead_letter_queue: body.dead_letter_queue,
      settings: body.settings,
    });
    return this.ok(this.consumerView(consumer));
  }

  /**
   * What either write of a consumer is refused for: a queue, a Worker or a
   * dead-letter queue the account does not have.
   */
  protected refuseConsumer(
    queueId: string,
    body: { script_name: string; dead_letter_queue?: string },
  ): Response | undefined {
    if (!this.queues.some((it) => it.queue_id === queueId)) {
      return this.refuse(`No queue ${queueId}.`, 404);
    }
    if (!this.scripts.has(body.script_name)) {
      return this.refuse(`No Worker named ${body.script_name}.`, 404);
    }
    if (
      body.dead_letter_queue &&
      !this.queues.some((it) => it.queue_name === body.dead_letter_queue)
    ) {
      return this.refuse(`No queue named ${body.dead_letter_queue}.`);
    }
    return undefined;
  }

  protected consumerView(consumer: {
    consumer_id: string;
    queue_id: string;
    script_name: string;
    dead_letter_queue?: string;
    settings?: Record<string, unknown>;
  }) {
    return {
      consumer_id: consumer.consumer_id,
      queue_name: this.queues.find((it) => it.queue_id === consumer.queue_id)
        ?.queue_name,
      script_name: consumer.script_name,
      dead_letter_queue: consumer.dead_letter_queue,
      settings: consumer.settings,
    };
  }

  // ---------------------------------------------------------------------------
  // Workers
  // ---------------------------------------------------------------------------

  /**
   * An upload session: ask for exactly the hashes the account does not hold.
   *
   * With nothing missing, the session's own token is already the completion
   * token, which is how wrangler's `syncAssets` treats it.
   */
  protected openSession(
    script: string,
    body: { manifest: Record<string, { hash: string; size: number }> },
  ): Response {
    const hashes = [
      ...new Set(Object.values(body.manifest).map((it) => it.hash)),
    ];
    const wanted = hashes.filter((hash) => !this.assets.has(hash));
    const session = this.id("session");
    this.sessions.set(session, {
      script,
      manifest: body.manifest,
      wanted: new Set(wanted),
      received: new Set(),
    });
    return this.ok({
      jwt: this.token(session, wanted.length === 0 ? "complete" : "upload"),
      buckets: wanted.length === 0 ? [] : [wanted],
    });
  }

  protected async receiveAssets(
    request: Request,
    url: URL,
    form: FormData,
  ): Promise<Response> {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    const grant = this.tokens.get(token ?? "");
    const session = grant && this.sessions.get(grant.session);
    if (!session || grant?.kind !== "upload") {
      return this.refuse("Unauthorized: not an upload session token.", 401);
    }
    if (url.searchParams.get("base64") !== "true") {
      return this.refuse("Expected base64=true.");
    }
    for (const [hash, part] of form.entries()) {
      if (!session.wanted.has(hash)) {
        return this.refuse(`This session did not ask for ${hash}.`);
      }
      const encoded = await this.textOf(part);
      this.assets.set(
        hash,
        Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
      );
      session.received.add(hash);
      this.uploads.push(hash);
    }
    const complete = [...session.wanted].every((hash) =>
      session.received.has(hash),
    );
    return this.ok(
      complete ? { jwt: this.token(grant.session, "complete") } : {},
    );
  }

  protected async putScript(script: string, form: FormData): Promise<Response> {
    const metadata = JSON.parse(await this.textOf(form.get("metadata")));
    const modules: Record<string, string> = {};
    for (const [name, part] of form.entries()) {
      if (name !== "metadata") {
        modules[name] = await this.textOf(part);
      }
    }
    if (!(metadata.main_module in modules)) {
      return this.refuse(
        `main_module ${metadata.main_module} is not one of the uploaded parts.`,
      );
    }

    const entry = this.scripts.get(script) ?? { versions: [], schedules: [] };
    let assets: Record<string, string> | undefined;
    if (metadata.assets?.jwt) {
      const grant = this.tokens.get(metadata.assets.jwt);
      const session = grant && this.sessions.get(grant.session);
      if (grant?.kind !== "complete" || session?.script !== script) {
        return this.refuse(
          "The assets jwt is not a completed upload session for this Worker.",
        );
      }
      assets = Object.fromEntries(
        Object.entries(session.manifest).map(([key, it]) => [key, it.hash]),
      );
    } else if (metadata.assets?.keep_assets) {
      assets = entry.versions.at(-1)?.assets;
    }

    const number = entry.versions.length + 1;
    entry.versions.push({
      id: `${script}-v${number}`,
      number,
      metadata,
      modules,
      assets,
    });
    this.scripts.set(script, entry);
    // ⚠️ `id` is the script NAME here, as Cloudflare answers it. The version
    // is read back from the versions list.
    return this.ok({ id: script, startup_time_ms: 1 });
  }

  protected listVersions(script: string): Response {
    const entry = this.scripts.get(script);
    if (!entry) {
      return this.refuse(`No Worker named ${script}.`, 404);
    }
    // Newest first, as Cloudflare lists them.
    const items = entry.versions.toReversed().map((it) => ({
      id: it.id,
      number: it.number,
      metadata: { source: "api" },
    }));
    return this.ok(
      { items },
      {
        result_info: {
          page: 1,
          per_page: items.length,
          count: items.length,
          total_count: items.length,
        },
      },
    );
  }

  protected putSchedules(script: string, body: Array<{ cron: string }>) {
    const entry = this.scripts.get(script);
    if (!entry) {
      return this.refuse(`No Worker named ${script}.`, 404);
    }
    entry.schedules = body.map((it) => it.cron);
    return this.ok({ schedules: body });
  }

  protected putSubdomain(
    script: string,
    body: { enabled: boolean; previews_enabled: boolean },
  ) {
    const entry = this.scripts.get(script);
    if (!entry) {
      return this.refuse(`No Worker named ${script}.`, 404);
    }
    entry.subdomain = {
      enabled: body.enabled,
      previews_enabled: body.previews_enabled,
    };
    return this.ok(entry.subdomain);
  }

  protected putDomain(body: { hostname: string; service: string }) {
    if (!this.scripts.has(body.service)) {
      return this.refuse(`No Worker named ${body.service}.`, 404);
    }
    const existing = this.domains.find((it) => it.hostname === body.hostname);
    if (existing) {
      existing.service = body.service;
    } else {
      this.domains.push({ hostname: body.hostname, service: body.service });
    }
    return this.ok({ hostname: body.hostname, service: body.service });
  }

  // ---------------------------------------------------------------------------
  // transport
  // ---------------------------------------------------------------------------

  /**
   * A JWT-shaped token. The client reads the payload for `exp` and
   * `wrangler_single_asset_uploads`, so it has to decode, and carrying neither
   * means no deadline and the batched upload.
   */
  protected token(session: string, kind: "upload" | "complete"): string {
    const part = (value: unknown) =>
      btoa(JSON.stringify(value))
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
    const token = `${part({ alg: "HS256", typ: "JWT" })}.${part({ session, kind })}.signature`;
    this.tokens.set(token, { session, kind });
    return token;
  }

  /**
   * A multipart part's content. Typed loosely because the global `FormData`
   * types its entries as strings here, while an upload's parts are files.
   */
  protected async textOf(part: unknown): Promise<string> {
    if (part === null || part === undefined) {
      return "";
    }
    return typeof part === "string" ? part : await (part as Blob).text();
  }

  protected page<T>(url: URL, items: T[]): Response {
    const page = Number(url.searchParams.get("page") ?? 1);
    const perPage = Number(url.searchParams.get("per_page") ?? 20);
    const slice = items.slice((page - 1) * perPage, page * perPage);
    return this.ok(slice, {
      result_info: {
        page,
        per_page: perPage,
        count: slice.length,
        total_count: items.length,
      },
    });
  }

  protected ok(result: unknown, extra: Record<string, unknown> = {}): Response {
    return Response.json({
      success: true,
      errors: [],
      messages: [],
      result,
      ...extra,
    });
  }

  protected refuse(message: string, status = 400): Response {
    return Response.json(
      { success: false, errors: [{ message }], messages: [], result: null },
      { status },
    );
  }

  protected id(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }
}

/**
 * One upload of a Worker, as the account keeps it.
 */
interface FakeWorkerVersion {
  id: string;
  number: number;
  metadata: Record<string, any>;
  modules: Record<string, string>;
  /**
   * Served path to hash: what this version serves as static assets.
   */
  assets?: Record<string, string>;
}
