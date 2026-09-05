import { basename } from "node:path";

import { $inject, AlephaError } from "alepha";
import { KV_DEFAULT_BINDING } from "alepha/cache";
import { SEND_EMAIL_DEFAULT_BINDING } from "alepha/email/cloudflare";
import { $logger } from "alepha/logger";
import { QUEUE_DEFAULT_BINDING, QUEUE_DEFAULT_MAX_RETRIES } from "alepha/queue";
import type { CronProvider, WorkerdCronProvider } from "alepha/scheduler";
import { FileSystemProvider } from "alepha/system";

import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

interface WranglerConfig {
  [key: string]: any;
}

/**
 * Generate Cloudflare Workers deployment configuration.
 *
 * Creates:
 * - wrangler.jsonc with worker configuration
 * - main.cloudflare.js entry point for Cloudflare Workers
 */
export class BuildCloudflareTask extends BuildTask {
  // Looked up by class name string (not by class identity) because
  // BuildCloudflareTask runs in the CLI's Alepha context while ctx.alepha
  // is the workspace's separate context. Two module graphs = two distinct
  // `CloudflareEmailProvider` class objects, so the imported reference
  // here wouldn't match the one the workspace registered.
  protected readonly cloudflareEmailProviderName = "CloudflareEmailProvider";

  // Must match WEBSOCKET_DEFAULT_BINDING in alepha/websocket (kept as a literal
  // here because the CF provider isn't on the node barrel).
  protected readonly websocketDoBinding = "ALEPHA_WEBSOCKET";
  // Must match the AlephaWebSocketDurableObject class name in alepha/websocket
  // (kept as a literal here because the CF provider isn't on the node barrel).
  protected readonly websocketDoClass = "AlephaWebSocketDurableObject";

  /**
   * Best-effort Cloudflare zone (registrable domain) for a wildcard Worker route:
   * strip the leading `*.` and any subdomain labels, keep the last two — e.g.
   * `*.club.alepha.dev` → `alepha.dev`, `*.alepha.club` → `alepha.club`. Correct
   * for single-label TLDs (the common case); a multi-label public suffix
   * (`.co.uk`) or a CF subdomain zone needs an explicit `CLOUDFLARE_ZONE`.
   */
  protected deriveZone(domain: string): string {
    return domain.replace(/^\*\./, "").split(".").slice(-2).join(".");
  }

  protected readonly fs = $inject(FileSystemProvider);
  protected readonly log = $logger();

  /**
   * How long `executionCtx.waitUntil` keeps a Worker isolate alive after the
   * response has been sent.
   *
   * This is the whole budget a job pushed from a request gets in direct mode,
   * and nothing in the `$job` API hints at it: `DirectJobDispatcher` runs the
   * handler through `BackgroundTaskProvider.defer`, which on Workers is
   * `waitUntil`. A queue consumer gets 15 minutes of wall clock AND 15
   * minutes of CPU instead, which is why the warning points at
   * `AlephaApiJobsQueue` rather than at lowering the timeout.
   */
  protected readonly waitUntilBudgetMs = 30_000;

  /**
   * Cron Triggers allowed per ACCOUNT on the free plan (250 on paid).
   *
   * Per account, not per Worker: a free-tier user with two Alepha apps can be
   * over the cap before writing a `$job` of their own. `InvitationJobs`
   * already carries a hand-written comment about two jobs sharing one slot to
   * keep this count down; that knowledge belongs in a build warning, not in a
   * comment somebody has to stumble on.
   */
  protected readonly freeCronTriggers = 5;

  protected readonly warningComment =
    "// This file was automatically generated. DO NOT MODIFY.\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  /**
   * Whether the workspace registers any `$websocket` OR `$room` primitive —
   * both ride the same worker upgrade branch and the same
   * `AlephaWebSocketDurableObject`, so a rooms-only app needs the exact same
   * wiring. Gates `enhanceDurableObjects` — resolved in `generateCloudflare`
   * from either `ctx.manifest` (prebuilt/manifest mode) or a live
   * `ctx.alepha` probe.
   */
  protected hasWebSocket = false;

  /**
   * Registered realtime channel paths (e.g. `/ws/chat`) — the dedup'd union
   * of every `$websocket` and `$room` channel — resolved in
   * `generateCloudflare` alongside `hasWebSocket`. From a live `ctx.alepha`
   * probe, or from `ctx.manifest.websocketPaths` in prebuilt/manifest mode
   * (see `BuildManifestTask`, which captures the same paths at artifact-build
   * time so the manifest-only deploy path — Alepha Rocket `--prebuilt` —
   * doesn't need a live Alepha to introspect). Baked into the worker entry
   * point's upgrade-routing guard so only requests to a known channel path
   * are forwarded to the room Durable Object.
   */
  protected websocketPaths: string[] = [];

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.options.target !== "cloudflare") {
      return;
    }

    const distDir = ctx.options.output?.dist ?? "dist";

    await ctx.run({
      name: "generate deploy config (cloudflare)",
      handler: async () => {
        await this.generateCloudflare(ctx, distDir);
      },
    });
  }

  protected async generateCloudflare(
    ctx: BuildTaskContext,
    distDir: string,
  ): Promise<void> {
    const root = ctx.root;
    // Slugify the dir basename — wrangler rejects names that aren't
    // `^[a-z0-9-]+$` (no uppercase, dots, underscores, spaces, etc.).
    // Without this, running `alepha build -t cloudflare` in a dir like
    // `My App` or `club-0.0.2` produces an unusable `wrangler.jsonc`.
    //
    // This is a build-time PLACEHOLDER, not the deployed worker name. A
    // build is environment-agnostic — the same artifact ships to staging
    // and production — so the real name is only resolved at deploy time
    // by `naming.worker()`, as `<name>-<environment>`.
    //
    // Consequence worth knowing: pointing wrangler at this config picks
    // the wrong worker and reports a baffling "Worker does not exist".
    // Use the name printed by `alepha platform up`, e.g.
    // `wrangler tail my-app-production`. The file cannot carry a comment
    // saying so — example-ssr's build-artifacts spec pins it as strict
    // JSON-parseable.
    const name = basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
    const hasAssets = await this.fs.exists(
      this.fs.join(root, distDir, ctx.options.output?.public ?? "public"),
    );

    // In prebuilt mode the workspace's `alepha.config.ts` is never loaded, so
    // `ctx.options` carries CLI flags only. The manifest is the artifact's
    // memory of what the author actually declared — read it there, or this
    // deploy quietly regenerates `wrangler.jsonc` with the defaults and
    // overwrites a correct file with a worse one.
    const appConfig =
      ctx.options.cloudflare?.config ?? ctx.manifest?.cloudflareConfig ?? {};

    const wrangler: WranglerConfig = {
      name,
      main: "./main.cloudflare.js",
      compatibility_flags: ["nodejs_compat"],
      compatibility_date: "2025-11-17",
      no_bundle: true,
      rules: [
        {
          type: "ESModule",
          globs: ["index.js", "server/*.js"],
        },
      ],
      ...appConfig,
    };

    if (hasAssets) {
      // Merged, not `??=`. The app only ever wants to add a key —
      // `not_found_handling`, `run_worker_first` — and an all-or-nothing
      // replace made it restate `directory` and `binding` to do so, which is
      // a silent footgun: forget `binding` and `env.ASSETS` is simply gone.
      wrangler.assets = {
        directory: "./public",
        binding: "ASSETS",
        ...wrangler.assets,
      };
    }

    wrangler.observability ??= {
      enabled: true,
      head_sampling_rate: 1,
    };

    // Manifest/prebuilt mode: ctx.alepha is a null cast (see BuildCommand),
    // so read the resource flag captured at artifact-build time instead of
    // probing a live instance.
    if (ctx.manifest) {
      this.hasWebSocket = ctx.manifest.resources.hasWebSocket;
      this.websocketPaths = ctx.manifest.websocketPaths ?? [];
    } else {
      try {
        // Union of both realtime primitives: a `$room` registers on its
        // `$channel` path exactly like a `$websocket`, and a rooms-only app
        // (no `$websocket` at all) still needs the upgrade branch, the DO
        // binding and the DO class export. Dedup'd — a `$room` may share its
        // channel with a `$websocket` on the same path.
        const realtimePrimitives = [
          ...ctx.alepha.primitives("$websocket"),
          ...ctx.alepha.primitives("$room"),
        ];
        this.websocketPaths = [
          ...new Set(
            realtimePrimitives.map((p: any) => p.options.channel.options.path),
          ),
        ];
        this.hasWebSocket = this.websocketPaths.length > 0;
      } catch {
        this.hasWebSocket = false;
        this.websocketPaths = [];
      }
    }

    this.enhanceDomain(wrangler);
    this.enhanceServices(wrangler);
    this.enhanceCron(ctx, wrangler);
    this.warnUnreachableTimeouts(ctx);
    this.enhanceDatabase(wrangler);
    this.enhanceR2(wrangler);
    this.enhanceKV(wrangler);
    this.enhanceAnalyticsEngine(wrangler);
    this.enhanceQueue(wrangler);
    this.enhanceEmail(ctx, wrangler);
    this.enhanceDurableObjects(wrangler);

    await this.fs.writeFile(
      this.fs.join(root, distDir, "wrangler.jsonc"),
      JSON.stringify(wrangler, null, 2),
    );

    // `dist/manifest.json` is written by BuildManifestTask, which runs for
    // every target — the manifest describes the app, not the destination.
    await this.writeWorkerEntryPoint(root, distDir);
  }

  /**
   * Worker-to-worker service bindings, from CLOUDFLARE_SERVICES (JSON).
   */
  protected enhanceServices(wrangler: WranglerConfig): void {
    const raw = process.env.CLOUDFLARE_SERVICES;
    if (!raw) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // A bare SyntaxError here names neither the variable nor the input.
      throw new AlephaError(
        `CLOUDFLARE_SERVICES is not valid JSON. Expected an array of ` +
          `{ binding, service } objects, got: ${raw}`,
        { cause: error },
      );
    }
    const services = parsed as Array<{
      binding: string;
      service: string;
    }>;
    if (services.length > 0) {
      (wrangler as { services?: unknown }).services = services;
    }
  }

  protected enhanceDomain(wrangler: WranglerConfig): void {
    const domain = process.env.CLOUDFLARE_DOMAIN;
    if (!domain) {
      return;
    }

    if (domain.includes("*")) {
      // A wildcard is a Worker *Route* (not a Custom Domain), and the CF API
      // keys routes by zone. Default the zone to the registrable domain — the
      // last two labels of the wildcard host (`*.club.alepha.dev` → `alepha.dev`,
      // `*.alepha.club` → `alepha.club`). Set CLOUDFLARE_ZONE explicitly only to
      // override (a subdomain zone, or a multi-label public suffix like `.co.uk`
      // where "last two labels" is wrong).
      const zone = process.env.CLOUDFLARE_ZONE || this.deriveZone(domain);
      wrangler.routes = [
        {
          pattern: domain.endsWith("/*") ? domain : `${domain}/*`,
          zone_name: zone,
        },
      ];
      return;
    }

    // An explicit CLOUDFLARE_ZONE forces a zone *Route* for a non-wildcard
    // host too. Needed when the host is ALSO covered by another Worker's
    // wildcard route on the same zone: Cloudflare evaluates Routes before
    // Custom Domains, but among routes the most specific pattern wins — so
    // `app.club.alepha.dev/*` beats the pooled `*.club.alepha.dev/*`, while a
    // Custom Domain on that host would lose to the wildcard route entirely.
    if (process.env.CLOUDFLARE_ZONE) {
      wrangler.routes = [
        {
          pattern: `${domain}/*`,
          zone_name: process.env.CLOUDFLARE_ZONE,
        },
      ];
      return;
    }

    wrangler.routes = [
      {
        pattern: domain,
        custom_domain: true,
      },
    ];
  }

  /**
   * Every build-time warning goes through here, so a test can collect them
   * without reaching into the logger.
   */
  protected warn(message: string): void {
    this.log.warn(message);
  }

  protected enhanceCron(ctx: BuildTaskContext, wrangler: WranglerConfig): void {
    const cronExpressions = ctx.manifest
      ? ctx.manifest.crons
      : this.discoverCrons(ctx);
    if (cronExpressions.length === 0) {
      return;
    }
    if (cronExpressions.length > this.freeCronTriggers) {
      this.warn(
        `This app emits ${cronExpressions.length} Cron Triggers, over the free plan's limit of ${this.freeCronTriggers} per ACCOUNT (250 on paid). The cap is shared with every other Worker on the account, so two Alepha apps can exceed it between them. Give jobs that do not need their own cadence a shared expression: ${cronExpressions.join(", ")}`,
      );
    }
    wrangler.triggers ??= {};
    wrangler.triggers.crons = cronExpressions;
  }

  /**
   * Warn about a `timeout` direct mode on Cloudflare cannot honour.
   *
   * Only in direct mode: with a queue binding the consumer gets 15 minutes
   * of wall clock and 15 minutes of CPU, the most generous surface
   * Cloudflare offers, and the declared timeout is reachable.
   *
   * The consequence is worse than the truncation itself, which is why it is
   * worth a build-time line. `crashThresholdMs` is derived as twice the
   * declared timeout, so a step killed at 30 seconds under a
   * `timeout: [10, "minute"]` sits `running` for **twenty minutes** before
   * the sweep will even consider it crashed.
   */
  protected warnUnreachableTimeouts(ctx: BuildTaskContext): void {
    // A queue binding changes the budget entirely, so there is nothing to
    // warn about. Same variable `enhanceQueue` gates the producer on.
    if (process.env.CLOUDFLARE_QUEUE_NAME) {
      return;
    }
    const jobs = ctx.manifest
      ? (ctx.manifest.jobs ?? [])
      : this.discoverJobs(ctx);
    const unreachable = jobs.filter(
      (job) =>
        typeof job.timeoutMs === "number" &&
        job.timeoutMs > this.waitUntilBudgetMs,
    );
    if (unreachable.length === 0) {
      return;
    }
    this.warn(
      `Direct mode on Cloudflare gives a job about ${this.waitUntilBudgetMs / 1000}s of wall clock after the response (executionCtx.waitUntil), so these declared timeouts cannot be honoured: ${unreachable
        .map(
          (job) => `${job.name} (${Math.round((job.timeoutMs ?? 0) / 1000)}s)`,
        )
        .join(
          ", ",
        )}. Worse, crash recovery is derived from the declared timeout, so a job killed at the budget sits 'running' for twice its timeout before the sweep touches it. Register AlephaApiJobsQueue and set CLOUDFLARE_QUEUE_NAME: a queue consumer gets 15 minutes of wall clock AND 15 minutes of CPU.`,
    );
  }

  /**
   * Registered jobs and their declared timeouts, from the live container.
   *
   * Mirrors {@link discoverCrons}: looked up by class-name string because
   * the CLI and the workspace are two module graphs, so the imported
   * `JobProvider` here is a different class object from the one the
   * workspace registered.
   */
  protected discoverJobs(
    ctx: BuildTaskContext,
  ): Array<{ name: string; timeoutMs?: number }> {
    try {
      const provider = ctx.alepha.inject("JobProvider") as {
        getRegisteredJobs?: () => Map<string, { options: { timeout?: any } }>;
      };
      const registry = provider.getRegisteredJobs?.();
      if (!registry) return [];
      const dt = ctx.alepha.inject("DateTimeProvider") as {
        duration: (value: any) => { as: (unit: string) => number };
      };
      return [...registry.entries()].map(([name, registration]) => ({
        name,
        timeoutMs: registration.options.timeout
          ? dt.duration(registration.options.timeout).as("milliseconds")
          : undefined,
      }));
    } catch {
      return [];
    }
  }

  protected discoverCrons(ctx: BuildTaskContext): string[] {
    // `CronProvider` is the single registry of cron expressions — every
    // `$job({ cron })` lands there. This used to bail early unless a
    // `scheduler` primitive existed, which would emit zero cron triggers
    // for an app whose scheduled work is all `$job`.
    let cronProvider: CronProvider | undefined;
    try {
      cronProvider = ctx.alepha.inject("CronProvider") as WorkerdCronProvider;
    } catch {}
    const crons = cronProvider?.getCronJobs();
    if (!crons || crons.length === 0) {
      return [];
    }
    return [...new Set(crons.map((c) => c.expression))];
  }

  protected enhanceDatabase(wrangler: WranglerConfig): void {
    if (process.env.HYPERDRIVE_ID) {
      this.enhanceHyperdrive(wrangler);
      return;
    }

    this.enhanceD1(wrangler);
  }

  protected static readonly D1_BINDING = "DB";

  protected enhanceD1(wrangler: WranglerConfig): void {
    const url = process.env.DATABASE_URL;
    if (!url?.startsWith("d1:")) {
      return;
    }

    const [dbName, id] = url.replace("d1://", "").replace("d1:", "").split(":");
    const binding = BuildCloudflareTask.D1_BINDING;
    // No `jurisdiction` here: unlike r2_buckets, the wrangler D1 binding schema
    // has no jurisdiction field (it warns on the unexpected key). D1 data
    // residency is fixed when the database is created — see CloudflareApi —
    // and the binding just references it by `database_id`.
    wrangler.d1_databases = wrangler.d1_databases || [];
    wrangler.d1_databases.push({
      binding,
      database_name: dbName,
      database_id: id,
    });
    wrangler.vars ??= {};
    wrangler.vars.DATABASE_URL = `d1://${binding}`;
  }

  protected enhanceHyperdrive(wrangler: WranglerConfig): void {
    const hyperdriveId = process.env.HYPERDRIVE_ID;
    if (!hyperdriveId) {
      return;
    }

    const binding = "HYPERDRIVE";
    wrangler.hyperdrive = wrangler.hyperdrive || [];
    wrangler.hyperdrive.push({
      binding,
      id: hyperdriveId,
    });
    wrangler.vars ??= {};
    wrangler.vars.DATABASE_URL = `hyperdrive://${binding}`;

    if (process.env.POSTGRES_SCHEMA) {
      wrangler.vars.POSTGRES_SCHEMA = process.env.POSTGRES_SCHEMA;
    }
  }

  protected enhanceR2(wrangler: WranglerConfig): void {
    const bucketName = process.env.R2_BUCKET_NAME;
    if (!bucketName) {
      return;
    }

    const jurisdiction = process.env.CLOUDFLARE_JURISDICTION;
    wrangler.r2_buckets = wrangler.r2_buckets || [];
    wrangler.r2_buckets.push({
      binding: bucketName,
      bucket_name: bucketName,
      ...(jurisdiction ? { jurisdiction } : {}),
    });
    wrangler.vars ??= {};
    wrangler.vars.R2_BUCKET_NAME = bucketName;
  }

  protected enhanceKV(wrangler: WranglerConfig): void {
    const kvName = process.env.CLOUDFLARE_KV_NAME;
    if (!kvName) {
      return;
    }

    const kvId = process.env.CLOUDFLARE_KV_ID;

    wrangler.kv_namespaces = wrangler.kv_namespaces || [];
    wrangler.kv_namespaces.push({
      binding: KV_DEFAULT_BINDING,
      id: kvId ?? "",
    });
  }

  protected static readonly ANALYTICS_ENGINE_BINDING = "ANALYTICS";

  /**
   * Workers Analytics Engine dataset binding, from
   * `CLOUDFLARE_ANALYTICS_DATASET`.
   *
   * A write-only, fire-and-forget sink: `env.ANALYTICS.writeDataPoint({...})`
   * returns nothing and is not awaited — the runtime writes in the
   * background. Reading it back is **not** this binding's job and cannot be:
   * queries go over the account-scoped SQL API at
   * `api.cloudflare.com/…/analytics_engine/sql`, which is plain HTTP with a
   * bearer token. So a Worker that only writes needs this and nothing else,
   * and a Worker that also reads needs two credentials that have nothing to do
   * with each other.
   *
   * The dataset does not have to be created first — Cloudflare provisions it
   * on the first data point, which is why there is no id here to pair with the
   * name, unlike KV or D1.
   */
  protected enhanceAnalyticsEngine(wrangler: WranglerConfig): void {
    const dataset = process.env.CLOUDFLARE_ANALYTICS_DATASET;
    if (!dataset) {
      return;
    }

    wrangler.analytics_engine_datasets =
      wrangler.analytics_engine_datasets || [];
    wrangler.analytics_engine_datasets.push({
      binding: BuildCloudflareTask.ANALYTICS_ENGINE_BINDING,
      dataset,
    });

    // The binding alone is not enough, exactly as it is not for R2. The
    // provider reads this name at runtime for two things the binding cannot
    // supply: it is what `index.workerd.ts` checks to select the Analytics
    // Engine backend at all, and it is the table spliced into `FROM` on the
    // read path, which goes over HTTP rather than through the binding.
    //
    // Without it the worker boots with a perfectly good binding and never
    // uses it: provider selection falls through to the relational backend,
    // every write lands in D1, and the dataset stays empty forever with no
    // error anywhere. Mirrors `wrangler.vars.R2_BUCKET_NAME`.
    wrangler.vars ??= {};
    wrangler.vars.CLOUDFLARE_ANALYTICS_DATASET = dataset;
  }

  protected enhanceQueue(wrangler: WranglerConfig): void {
    // Consuming a queue this app does not produce to, so it is deliberately
    // NOT gated on CLOUDFLARE_QUEUE_NAME: an app running jobs in direct mode
    // still wants its bounce and complaint events.
    this.enhanceEmailEventsQueue(wrangler);

    const queueName = process.env.CLOUDFLARE_QUEUE_NAME;
    if (!queueName) {
      return;
    }

    wrangler.queues ??= {};
    wrangler.queues.producers = wrangler.queues.producers || [];
    wrangler.queues.producers.push({
      binding: QUEUE_DEFAULT_BINDING,
      queue: queueName,
    });

    // The worker's queue handler calls `msg.retry()` on any throw. Cloudflare
    // only gives a failing message somewhere to land if the consumer declares a
    // `dead_letter_queue` — otherwise it burns `max_retries` and DISCARDS the
    // message, with no record and no signal. CF creates the DLQ on demand, so a
    // derived default is safe.
    // `Number("")` is 0, which would silently disable retries when the
    // variable is exported but empty.
    const rawMaxRetries = process.env.CLOUDFLARE_QUEUE_MAX_RETRIES;
    const maxRetries = rawMaxRetries ? Number(rawMaxRetries) : Number.NaN;

    wrangler.queues.consumers = wrangler.queues.consumers || [];
    wrangler.queues.consumers.push({
      queue: queueName,
      dead_letter_queue:
        process.env.CLOUDFLARE_QUEUE_DLQ_NAME || `${queueName}-dlq`,
      max_retries: Number.isSafeInteger(maxRetries)
        ? maxRetries
        : QUEUE_DEFAULT_MAX_RETRIES,
    });
  }

  /**
   * A second consumer, for the queue Cloudflare's Email Sending event
   * subscription publishes to.
   *
   * **Consumer only, no producer binding.** This app does not write to that
   * queue; Cloudflare does. It also does not need `CloudflareQueueProvider`,
   * which throws on start when the `JOBS_QUEUE` binding is missing, so an
   * app with no job queue at all can still ingest bounces.
   *
   * The subscription itself (queue, Email Sending source, one sending
   * domain) is created in the dashboard or through the API, and is per
   * domain: a marketing subdomain added later needs its own.
   */
  protected enhanceEmailEventsQueue(wrangler: WranglerConfig): void {
    const queueName = process.env.CLOUDFLARE_EMAIL_EVENTS_QUEUE;
    if (!queueName) {
      return;
    }

    wrangler.queues ??= {};
    wrangler.queues.consumers = wrangler.queues.consumers || [];
    wrangler.queues.consumers.push({
      queue: queueName,
      dead_letter_queue:
        process.env.CLOUDFLARE_EMAIL_EVENTS_DLQ_NAME || `${queueName}-dlq`,
      max_retries: QUEUE_DEFAULT_MAX_RETRIES,
    });
  }

  /**
   * Durable Object binding + SQLite migration for the `$websocket`/`$room`
   * primitives on Cloudflare. Gated on `hasWebSocket` (resolved in
   * `generateCloudflare` from `ctx.manifest` or a live `ctx.alepha` probe) —
   * a workerd app with no realtime usage gets no binding and no migration.
   *
   * `new_sqlite_classes` (rather than `new_classes`) is required because
   * `AlephaWebSocketDurableObject` uses the SQLite-backed Durable Object
   * storage API.
   *
   * The user's `cloudflare.config` is spread into the wrangler BEFORE the
   * enhancers run, so a user-supplied `migrations`/`durable_objects` block is
   * already present here. The push must be idempotent: skip when a user
   * migration already declares the DO class, and never reuse an occupied
   * migration tag — a duplicated tag or class declaration is a wrangler
   * deploy error.
   */
  protected enhanceDurableObjects(wrangler: WranglerConfig): void {
    if (!this.hasWebSocket) {
      return;
    }

    wrangler.durable_objects ??= {};
    wrangler.durable_objects.bindings = wrangler.durable_objects.bindings || [];
    const bindings = wrangler.durable_objects.bindings as Array<{
      name?: string;
      class_name?: string;
    }>;
    if (!bindings.some((b) => b.class_name === this.websocketDoClass)) {
      bindings.push({
        name: this.websocketDoBinding,
        class_name: this.websocketDoClass,
      });
    }

    wrangler.migrations = wrangler.migrations || [];
    const migrations = wrangler.migrations as Array<Record<string, unknown>>;
    const declaresClass = (value: unknown): boolean =>
      Array.isArray(value) && value.includes(this.websocketDoClass);
    if (
      migrations.some(
        (m) =>
          declaresClass(m.new_sqlite_classes) || declaresClass(m.new_classes),
      )
    ) {
      return;
    }

    const tags = new Set(migrations.map((m) => m.tag));
    let n = 1;
    while (tags.has(`v${n}`)) {
      n += 1;
    }
    migrations.push({
      tag: `v${n}`,
      new_sqlite_classes: [this.websocketDoClass],
    });
  }

  protected enhanceEmail(
    ctx: BuildTaskContext,
    wrangler: WranglerConfig,
  ): void {
    // Resolve the CF email binding from whichever source this build path has:
    // - manifest/prebuilt mode (Alepha Rocket `--prebuilt`): no app boot, so
    //   read the binding captured into the manifest at artifact-build time.
    //   Without this the deploy silently drops `send_email` and the worker
    //   boots with email inert (binding not found).
    // - full Vite introspection (`ctx.alepha`, no manifest): probe for the
    //   registered CloudflareEmailProvider.
    let binding: string | undefined;
    if (ctx.manifest) {
      binding = ctx.manifest.email?.binding;
    } else if (ctx.alepha) {
      try {
        ctx.alepha.inject(this.cloudflareEmailProviderName);
        binding = SEND_EMAIL_DEFAULT_BINDING;
      } catch {
        // app doesn't use CloudflareEmailProvider — nothing to emit
      }
    }
    if (!binding) {
      return;
    }

    wrangler.send_email = wrangler.send_email || [];
    if (wrangler.send_email.some((b: { name: string }) => b.name === binding)) {
      return;
    }

    // NOTE: do NOT set `destination_address` here. On a Cloudflare
    // `send_email` binding, `destination_address` is a *recipient* allow-list
    // lock (the worker may then only send TO that one address) — it is not the
    // sender. Setting it to `EMAIL_FROM` (the sender) broke all outbound mail:
    // a bare address locked delivery to that single recipient ("email to … not
    // allowed"), and a display-name form like `Lore <noreply@…>` is a malformed
    // destination value that Cloudflare rejects with "internal error". The
    // sender goes in the message `from` field (see CloudflareEmailProvider.send);
    // leaving the binding unrestricted lets the worker send to any verified
    // destination.
    wrangler.send_email.push({ name: binding });
  }

  protected async writeWorkerEntryPoint(
    root: string,
    distDir: string,
  ): Promise<void> {
    // Re-exports the room Durable Object class so wrangler's
    // `new_sqlite_classes` migration (see enhanceDurableObjects) resolves a
    // real binding target. This only resolves at deploy time once `index.js`
    // itself re-exports the class — emitted here regardless, gated on
    // `hasWebSocket` alone.
    const doExport = this.hasWebSocket
      ? '\nexport { AlephaWebSocketDurableObject } from "./index.js";\n'
      : "";

    // WebSocket upgrade -> route to the room Durable Object. Runs at the very
    // top of `fetch`, before `bindEnv`/the normal request pipeline: a
    // hibernating WS upgrade has no HTTP response for `web:request` to
    // produce, so it must never reach that dispatcher.
    const upgradeBranch = this.hasWebSocket
      ? `
    if (request.headers.get("Upgrade") === "websocket") {
      const url = new URL(request.url);
      const wsPaths = ${JSON.stringify(this.websocketPaths)};
      if (wsPaths.includes(url.pathname)) {
        bindEnv(env);

        try {
          await __alepha.start();
        } catch (err) {
          __alepha.log.error("Failed to start Alepha for websocket upgrade", err);
          return new Response("Internal Server Error", { status: 500 });
        }

        const wsProvider = __alepha.inject("WebSocketServerProvider");

        // \`getEndpoint\` covers \`$websocket\` endpoints; a \`$room\` registers on
        // the provider's room registry instead, so fall back to
        // \`getRoomEndpoint\`. Without it, \`$room({ secure })\` was silently
        // unenforced. Both return their primitive options object directly
        // (see registerEndpoint/registerRoom in the providers), which is the
        // shape \`admit\` reads.
        const endpoint =
          wsProvider.getEndpoint(url.pathname) ??
          wsProvider.getRoomEndpoint(url.pathname);

        // One decision for both engines, see WebSocketServerProvider.admit:
        // the endpoint's own \`authorize\` hook when it has one (a machine
        // credential, which names its room and never touches the security
        // realm), the session resolver plus \`secure\` otherwise. A hook that
        // throws is an outage, not a revocation, so it answers 503 rather
        // than the 401 a machine client reads as "stop retrying".
        let admission;
        try {
          admission = await wsProvider.admit(endpoint, {
            url: request.url,
            headers: {
              authorization: request.headers.get("authorization") || undefined,
              cookie: request.headers.get("cookie") || undefined,
            },
          });
        } catch (err) {
          __alepha.log.error("WebSocket admission failed", err);
          return new Response("Service Unavailable", { status: 503 });
        }
        if (!admission.accepted) {
          return new Response("Unauthorized", { status: 401 });
        }
        const userId = admission.userId || "";

        // The room the credential named wins over the one the URL asked for,
        // which is what keeps a client out of a room it does not own.
        const roomId =
          admission.roomId ||
          url.searchParams.get("roomId") ||
          (url.searchParams.get("roomIds") || "").split(",")[0].trim() ||
          "default";

        const connectionId = "ws-" + crypto.randomUUID();
        const ns = env.ALEPHA_WEBSOCKET;
        const stub = ns.get(ns.idFromName(url.pathname + ":" + roomId));
        const forward = new Request(request, {
          headers: new Headers(request.headers),
        });
        // Strip any client-forged x-alepha-ws-* before setting the trusted
        // values — these headers are the worker->DO identity contract.
        forward.headers.delete("x-alepha-ws-channel");
        forward.headers.delete("x-alepha-ws-room");
        forward.headers.delete("x-alepha-ws-conn");
        forward.headers.delete("x-alepha-ws-user");
        forward.headers.set("x-alepha-ws-channel", url.pathname);
        forward.headers.set("x-alepha-ws-room", roomId);
        forward.headers.set("x-alepha-ws-conn", connectionId);
        if (userId) forward.headers.set("x-alepha-ws-user", userId);

        return stub.fetch(forward);
      }
    }
`
      : "";

    const workerCode = `
import "./index.js";
${doExport}
// Run an invocation inside an Alepha fork carrying THIS invocation's
// \`executionCtx.waitUntil\`, so background work (notably $job direct dispatch)
// can keep the isolate alive past the response.
//
// It must be the async context, never the shared store: one isolate serves
// concurrent invocations, so a store slot would let request B overwrite
// request A's handle — A's background work would then call B's already-returned
// context ("waitUntil after response") and be silently dropped.
const withExecutionContext = (executionCtx, fn) => {
  const waitUntil =
    executionCtx && typeof executionCtx.waitUntil === "function"
      ? (p) => executionCtx.waitUntil(p)
      : undefined;

  return __alepha.context.run(fn, { "cloudflare.waitUntil": waitUntil });
};

// Bind the per-invocation Worker \`env\`: keep the full binding (D1, R2, KV, …)
// in the store for providers, and lift its string values (secrets/vars like
// PUBLIC_URL) into \`alepha.env\` so \`$env\` resolves them at runtime.
const bindEnv = (env) => {
  __alepha.set("cloudflare.env", env);
  __alepha.loadEnv(env);
};

// --- Edge cache -------------------------------------------------------------
//
// Cloudflare's CDN sits in front of an ORIGIN, not in front of a Worker: a
// response this Worker generates is never stored, no matter what its
// Cache-Control says. Measured against lore.alepha.dev before this existed —
// \`/api/public/files/:id\` returned \`public, max-age=1y, immutable\` and no
// \`cf-cache-status\` header at all, while a static asset on the same zone came
// back \`cf-cache-status: HIT\`. So the header only ever reached browsers, and
// every new visitor re-paid the full D1 + R2 round trip.
//
// \`Cache-Control: public\` IS the opt-in. A route that declares its body
// shareable across users has already made exactly the statement a shared cache
// needs; nothing else is stored, and \`private\` (the default everywhere else)
// keeps a route out by construction.
const edgeCache = () =>
  typeof caches !== "undefined" && caches.default ? caches.default : undefined;

// --- D1 read replication ----------------------------------------------------
//
// A D1 session only buys sequential consistency ACROSS requests if the
// bookmark it ends on is handed back and presented on the next one. Drop it
// and a user who just created something can be served by a replica that has
// not caught up, and the write appears to have vanished.
//
// Carried in a cookie rather than a header because the browser returns it
// with no client-side code. Both ends are guarded: an app not running
// \`DATABASE_D1_MODE=sessions\` never populates the slot, so none of this fires.
const D1_BOOKMARK_COOKIE = "alepha_d1_bookmark";

const readBookmarkCookie = (request) => {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === D1_BOOKMARK_COOKIE && rest.length) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return undefined;
};

// \`append\`, not \`set\`: the response may already carry auth cookies and
// replacing the whole header would sign the user out.
const writeBookmarkCookie = (response, bookmark) => {
  try {
    response.headers.append(
      "set-cookie",
      D1_BOOKMARK_COOKIE +
        "=" +
        encodeURIComponent(bookmark) +
        "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600",
    );
  } catch {
    // A Response built from an immutable source rejects header writes. Losing
    // the bookmark costs consistency on the next request, never correctness
    // on this one, so it must not turn into a 500.
  }
};

// A shared entry is keyed by URL ALONE. Anything the caller's identity could
// have influenced must stay out however loudly the route opts in — hence the
// request-side credential check, which no Cache-Control directive can override.
const isEdgeCacheable = (request, response) => {
  if (request.method !== "GET") return false;
  if (request.headers.has("authorization")) return false;
  if (request.headers.has("cookie")) return false;
  if (!response || response.status !== 200) return false;
  // \`put\` rejects a Set-Cookie response outright; refusing here keeps that a
  // decision rather than a caught exception.
  if (response.headers.has("set-cookie")) return false;
  const control = response.headers.get("cache-control") ?? "";
  return control.includes("public") && !control.includes("no-store");
};

export default {
  fetch: async (request, env, executionCtx) => {${upgradeBranch}
    const ctx = { req: request, res: undefined };

    // Before \`__alepha.start()\`, deliberately. A hit that still paid for the
    // container boot would leave the expensive half of a cold request exactly
    // where it was — that boot is what separates a 60ms warm response from a
    // 700-990ms cold one. Consulting the cache for every GET is safe because
    // only \`isEdgeCacheable\` responses are ever written to it.
    const cache = edgeCache();
    if (cache && request.method === "GET") {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    bindEnv(env);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for fetch event", err);
      return new Response("Internal Server Error", { status: 500 });
    }

    // A holder, not a store read. \`store.set\` writes to the innermost async
    // layer and the handler runs several layers deeper than this, so the
    // session it opens cannot be read back from here. Mutating an object this
    // scope already owns crosses that boundary; reading the store instead
    // silently returned nothing and the bookmark never reached the response.
    const d1Carrier = {};

    await withExecutionContext(executionCtx, async () => {
      __alepha.store.set("alepha.orm.d1.carrier", d1Carrier, {
        skipEvents: true,
      });

      const incoming = readBookmarkCookie(request);
      if (incoming) {
        __alepha.store.set("alepha.orm.d1.bookmark", incoming, {
          skipEvents: true,
        });
      }

      await __alepha.events.emit("web:request", ctx);
    });

    const outgoingBookmark =
      d1Carrier.session && typeof d1Carrier.session.getBookmark === "function"
        ? d1Carrier.session.getBookmark()
        : undefined;

    // Cacheability is decided BEFORE the cookie is attached, and the two are
    // mutually exclusive. \`isEdgeCacheable\` refuses any response carrying a
    // \`set-cookie\`, so attaching the bookmark first would silently switch the
    // edge cache off for every response the moment an app enabled sessions.
    //
    // Skipping the bookmark on a cacheable response loses nothing: such a
    // response is public and shared by construction, so it cannot depend on
    // one caller's read position.
    const cacheable = cache && isEdgeCacheable(request, ctx.res);

    if (!cacheable && outgoingBookmark && ctx.res) {
      writeBookmarkCookie(ctx.res, outgoingBookmark);
    }

    if (cacheable) {
      // \`put\` drains the body it is given, so the clone goes to the cache and
      // the original goes to the client. waitUntil keeps the isolate alive
      // until the write lands instead of racing the response.
      const stored = ctx.res.clone();
      if (executionCtx && typeof executionCtx.waitUntil === "function") {
        executionCtx.waitUntil(cache.put(request, stored));
      } else {
        await cache.put(request, stored);
      }
    }

    return ctx.res;
  },

  scheduled: async (event, env, executionCtx) => {
    bindEnv(env);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for scheduled event", err);
      throw err;
    }

    await withExecutionContext(executionCtx, () =>
      __alepha.events.emit("cloudflare:scheduled", {
        cron: event.cron,
        scheduledTime: event.scheduledTime,
      }),
    );
  },

  queue: async (batch, env, executionCtx) => {
    bindEnv(env);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for queue event", err);
      throw err;
    }

    await withExecutionContext(executionCtx, async () => {
      for (const msg of batch.messages) {
        try {
          await __alepha.events.emit("cloudflare:queue", msg.body);
          msg.ack();
        } catch (e) {
          msg.retry();
        }
      }
    });
  },
};
`.trim();

    await this.fs.writeFile(
      this.fs.join(root, distDir, "main.cloudflare.js"),
      `${this.warningComment}\n${workerCode}`.trim(),
    );
  }
}
