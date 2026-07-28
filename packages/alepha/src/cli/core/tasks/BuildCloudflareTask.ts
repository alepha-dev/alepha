import { basename } from "node:path";
import { $inject, AlephaError } from "alepha";
import { KV_DEFAULT_BINDING } from "alepha/cache";
import { SEND_EMAIL_DEFAULT_BINDING } from "alepha/email/cloudflare";
import { QUEUE_DEFAULT_BINDING, QUEUE_DEFAULT_MAX_RETRIES } from "alepha/queue";
import type { CronProvider, WorkerdCronProvider } from "alepha/scheduler";
import { FileSystemProvider } from "alepha/system";
import { ViteUtils } from "../services/ViteUtils.ts";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

// Looked up by class name string (not by class identity) because
// BuildCloudflareTask runs in the CLI's Alepha context while ctx.alepha
// is the workspace's separate context. Two module graphs = two distinct
// `CloudflareEmailProvider` class objects, so the imported reference
// here wouldn't match the one the workspace registered.
const CLOUDFLARE_EMAIL_PROVIDER_NAME = "CloudflareEmailProvider";

// Must match WEBSOCKET_DEFAULT_BINDING in alepha/websocket (kept as a literal
// here because the CF provider isn't on the node barrel).
const WEBSOCKET_DO_BINDING = "ALEPHA_WEBSOCKET";
// Must match the AlephaWebSocketDurableObject class name in alepha/websocket
// (kept as a literal here because the CF provider isn't on the node barrel).
const WEBSOCKET_DO_CLASS = "AlephaWebSocketDurableObject";

/**
 * Best-effort Cloudflare zone (registrable domain) for a wildcard Worker route:
 * strip the leading `*.` and any subdomain labels, keep the last two — e.g.
 * `*.club.alepha.dev` → `alepha.dev`, `*.alepha.club` → `alepha.club`. Correct
 * for single-label TLDs (the common case); a multi-label public suffix
 * (`.co.uk`) or a CF subdomain zone needs an explicit `CLOUDFLARE_ZONE`.
 */
const deriveZone = (domain: string): string =>
  domain.replace(/^\*\./, "").split(".").slice(-2).join(".");

interface WranglerConfig {
  [key: string]: any;
}

/**
 * Build-time snapshot describing what the workspace needs at deploy
 * time. Written to `dist/manifest.json` alongside `wrangler.jsonc`.
 *
 * Lets `alepha platform up --prebuilt` skip the Vite-based
 * introspection step on the deploy side — and lets Alepha Rocket skip
 * the workspace's runtime `npm install` because no app source is
 * booted at deploy time. The manifest captures the bits of primitive
 * data that the deploy steps (provision, secrets, hooks) need to
 * know.
 */
export interface BuildManifest {
  version: 1;
  project: string;
  /**
   * Default environment when `--env` is omitted at deploy time.
   * Captured from `platformOptions.default` (defaults to `"production"`).
   */
  defaultEnv: string;
  /**
   * Multi-tenancy mode (`none` | `optional` | `required`). Captured from
   * `platformOptions.tenancy` so the prebuilt deploy side (Rocket) can
   * validate `--tenant` without re-evaluating `alepha.config.ts`.
   */
  tenancy?: "none" | "optional" | "required";
  /**
   * Resolved `platform({ environments: ... })` map. Captured at build
   * time from the workspace's `alepha.config.ts` so the deploy side
   * doesn't need to re-evaluate the config. Each value is the same
   * `EnvironmentConfig` shape consumed by the orchestrator (adapter,
   * domain, zone, jurisdiction, accountId).
   */
  environments: Record<
    string,
    {
      adapter: "cloudflare" | "vercel";
      domain?: string;
      zone?: string;
      jurisdiction?: "eu" | "fedramp";
      accountId?: string;
    }
  >;
  resources: {
    hasDatabase: boolean;
    hasBucket: boolean;
    hasKV: boolean;
    hasQueue: boolean;
    hasCron: boolean;
    hasWebSocket: boolean;
  };
  /**
   * All distinct cron expressions registered against `CronProvider` —
   * i.e. every `$job({ cron })`. Empty when `hasCron` is false.
   */
  crons: string[];
  /**
   * Registered `$websocket` channel paths (e.g. `/ws/chat`), captured the
   * same way `writeWorkerEntryPoint`'s live-probe path resolves
   * `websocketPaths` (`ctx.alepha.primitives("$websocket")` mapped to
   * `options.channel.options.path`). The prebuilt/manifest deploy path
   * (Alepha Rocket `--prebuilt`) has no live Alepha to introspect, so
   * without this the emitted worker's `wsPaths` guard stays empty and
   * WebSocket upgrades silently fail to route even though the DO binding
   * and migration are still emitted. Empty when `resources.hasWebSocket`
   * is false.
   */
  websocketPaths: string[];
  /**
   * Cloudflare email binding, captured when the app registers
   * `CloudflareEmailProvider` at artifact-build time. The prebuilt/manifest
   * deploy path (Alepha Rocket `--prebuilt`) has no Vite introspection, so it
   * reads this to re-emit the `send_email` wrangler binding. Absent when the
   * app doesn't use Cloudflare email.
   */
  email?: { binding: string };
  /**
   * Every env var the app declares via `$env`, captured from
   * `alepha.dump().env` at build time. The deploy `secrets` step uses this
   * as the worker-secret allowlist (minus build/binding vars) so CI can
   * deliver secrets straight from `process.env` without a `.env` file —
   * `platform.secrets.keys` overrides it when set. Empty when introspection
   * was unavailable (older artifacts / prebuilt mode).
   */
  env: string[];
}

/**
 * Generate Cloudflare Workers deployment configuration.
 *
 * Creates:
 * - wrangler.jsonc with worker configuration
 * - main.cloudflare.js entry point for Cloudflare Workers
 */
export class BuildCloudflareTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly viteUtils = $inject(ViteUtils);

  protected readonly warningComment =
    "// This file was automatically generated. DO NOT MODIFY.\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  /**
   * Whether the workspace registers any `$websocket` primitive. Gates
   * `enhanceDurableObjects` — resolved in `generateCloudflare` from either
   * `ctx.manifest` (prebuilt/manifest mode) or a live `ctx.alepha` probe.
   */
  protected hasWebSocket = false;

  /**
   * Registered `$websocket` channel paths (e.g. `/ws/chat`), resolved in
   * `generateCloudflare` alongside `hasWebSocket` — from a live `ctx.alepha`
   * probe, or from `ctx.manifest.websocketPaths` in prebuilt/manifest mode
   * (see `writeManifest`, which captures the same paths at artifact-build
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
      ...ctx.options.cloudflare?.config,
    };

    if (hasAssets) {
      wrangler.assets ??= {
        directory: "./public",
        binding: "ASSETS",
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
        const websocketPrimitives = ctx.alepha.primitives("$websocket");
        this.hasWebSocket = websocketPrimitives.length > 0;
        this.websocketPaths = websocketPrimitives.map(
          (p: any) => p.options.channel.options.path,
        );
      } catch {
        this.hasWebSocket = false;
        this.websocketPaths = [];
      }
    }

    this.enhanceDomain(wrangler);
    this.enhanceServices(wrangler);
    this.enhanceCron(ctx, wrangler);
    this.enhanceDatabase(wrangler);
    this.enhanceR2(wrangler);
    this.enhanceKV(wrangler);
    this.enhanceQueue(wrangler);
    this.enhanceEmail(ctx, wrangler);
    this.enhanceDurableObjects(wrangler);

    await this.fs.writeFile(
      this.fs.join(root, distDir, "wrangler.jsonc"),
      JSON.stringify(wrangler, null, 2),
    );

    // Only write a fresh manifest when we discovered it from a booted
    // Alepha instance. In manifest mode (ctx.manifest != null) we're
    // re-emitting the same data we just read — skip to avoid a redundant
    // write and to keep the original manifest as the canonical record.
    if (!ctx.manifest) {
      await this.writeManifest(ctx, root, distDir, name);
    }
    await this.writeWorkerEntryPoint(root, distDir);
  }

  /**
   * Write `dist/manifest.json` — a build-time snapshot of everything
   * downstream tooling needs to know about the app without re-booting
   * it. Used by `alepha platform up --prebuilt` (and Alepha Rocket) so
   * the deploy path can skip the Vite-based introspection step and the
   * workspace's runtime npm install.
   */
  protected async writeManifest(
    ctx: BuildTaskContext,
    root: string,
    distDir: string,
    name: string,
  ): Promise<void> {
    // Discover the same primitive shapes the enhance* methods read.
    // Errors are silently swallowed — an absent primitive class just
    // means the app doesn't use that resource.
    let hasDatabase = false;
    let hasBucket = false;
    let hasKV = false;
    let hasQueue = false;
    let crons: string[] = [];

    try {
      const repo = ctx.alepha.inject("RepositoryProvider") as {
        getRepositories?: () => unknown[];
      };
      hasDatabase = (repo.getRepositories?.() ?? []).length > 0;
    } catch {}

    try {
      hasBucket = ctx.alepha.primitives("$storage").length > 0;
    } catch {}

    // `$storage` is the usual signal, but it is not the only supported way
    // to use object storage: `alepha/bucket` documents injecting
    // `FileStorageProvider` directly for "blobs without a database", and
    // that route declares no primitive.
    //
    // It cannot be detected from here either. The build introspects the
    // app under **node**, where `alepha/bucket` binds Local/Memory/S3; the
    // R2 binding — and its hard `R2_BUCKET_NAME` requirement — only exists
    // in the **workerd** variant. So nothing observable at build time says
    // "this app will need R2 at runtime".
    //
    // The result was a worker that built and uploaded but could not boot,
    // rejected by Cloudflare with a bare
    // `SchemaValidationError: 'R2_BUCKET_NAME' is required`.
    //
    // Setting `R2_BUCKET_NAME` yourself is therefore a first-class way to
    // declare the need. It provisions the bucket and emits the binding
    // exactly as `$storage` would.
    if (!hasBucket && process.env.R2_BUCKET_NAME) {
      hasBucket = true;
    }

    try {
      // Only count $cache primitives without an explicit `provider`
      // option — those fall back to KV on workerd. Explicit memory /
      // Redis / Postgres providers opt out of KV provisioning.
      hasKV =
        ctx.alepha
          .primitives("cache")
          .filter(
            (p) =>
              (p as { options?: { provider?: unknown } }).options?.provider ==
              null,
          ).length > 0;
    } catch {}

    try {
      // There is no queue primitive to count. A Queue binding is needed only
      // when `$job` dispatch is routed through a broker, which is exactly
      // what registering `JobQueueProvider` (via `AlephaApiJobsQueue`) means.
      hasQueue = !!ctx.alepha.inject("JobQueueProvider");
    } catch {}

    let hasWebSocket = false;
    let websocketPaths: string[] = [];
    try {
      const websocketPrimitives = ctx.alepha.primitives("$websocket");
      hasWebSocket = websocketPrimitives.length > 0;
      websocketPaths = websocketPrimitives.map(
        (p: any) => p.options.channel.options.path,
      );
    } catch {}

    try {
      const cronProvider = ctx.alepha.inject("CronProvider") as {
        getCronJobs?: () => Array<{ expression: string }>;
      };
      crons = [
        ...new Set(
          (cronProvider.getCronJobs?.() ?? []).map((c) => c.expression),
        ),
      ];
    } catch {}

    // platformOptions come from the CLI's Alepha instance (where
    // alepha.config.ts ran during the configure hook). BuildCommand
    // reads them up there and threads them via ctx — ctx.alepha here
    // is the WORKSPACE's Vite-booted Alepha, which never saw the
    // platform options.
    const defaultEnv = ctx.platformOptions?.default ?? "production";
    const environments = (ctx.platformOptions?.environments ??
      {}) as BuildManifest["environments"];

    // Every declared `$env` key. dump() force-instantiates the graph (no
    // start/ready hooks), so this is the full env surface — used by the
    // deploy `secrets` step as the worker-secret allowlist.
    let env: string[] = [];
    try {
      env = Object.keys(ctx.alepha.dump().env).sort();
    } catch {}

    // Capture the CF email binding so manifest-mode deploys (Rocket) can
    // re-emit `send_email` — `enhanceEmail` can't introspect there.
    let email: BuildManifest["email"];
    try {
      ctx.alepha.inject(CLOUDFLARE_EMAIL_PROVIDER_NAME);
      email = { binding: SEND_EMAIL_DEFAULT_BINDING };
    } catch {}

    const manifest: BuildManifest = {
      version: 1,
      project: name,
      defaultEnv,
      tenancy: ctx.platformOptions?.tenancy,
      environments,
      resources: {
        hasDatabase,
        hasBucket,
        hasKV,
        hasQueue,
        hasCron: crons.length > 0,
        hasWebSocket,
      },
      crons,
      websocketPaths,
      email,
      env,
    };

    await this.fs.writeFile(
      this.fs.join(root, distDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }

  /** Worker-to-worker service bindings, from CLOUDFLARE_SERVICES (JSON). */
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
      const zone = process.env.CLOUDFLARE_ZONE || deriveZone(domain);
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

  protected enhanceCron(ctx: BuildTaskContext, wrangler: WranglerConfig): void {
    const cronExpressions = ctx.manifest
      ? ctx.manifest.crons
      : this.discoverCrons(ctx);
    if (cronExpressions.length === 0) {
      return;
    }
    wrangler.triggers ??= {};
    wrangler.triggers.crons = cronExpressions;
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

  protected enhanceQueue(wrangler: WranglerConfig): void {
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
    const maxRetries = Number(process.env.CLOUDFLARE_QUEUE_MAX_RETRIES);

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
   * Durable Object binding + SQLite migration for the `$websocket` primitive
   * on Cloudflare. Gated on `hasWebSocket` (resolved in `generateCloudflare`
   * from `ctx.manifest` or a live `ctx.alepha` probe) — a workerd app with no
   * `$websocket` usage gets no binding and no migration.
   *
   * `new_sqlite_classes` (rather than `new_classes`) is required because
   * `AlephaWebSocketDurableObject` uses the SQLite-backed Durable Object
   * storage API.
   */
  protected enhanceDurableObjects(wrangler: WranglerConfig): void {
    if (!this.hasWebSocket) {
      return;
    }

    wrangler.durable_objects ??= {};
    wrangler.durable_objects.bindings = wrangler.durable_objects.bindings || [];
    wrangler.durable_objects.bindings.push({
      name: WEBSOCKET_DO_BINDING,
      class_name: WEBSOCKET_DO_CLASS,
    });

    wrangler.migrations = wrangler.migrations || [];
    wrangler.migrations.push({
      tag: "v1",
      new_sqlite_classes: [WEBSOCKET_DO_CLASS],
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
        ctx.alepha.inject(CLOUDFLARE_EMAIL_PROVIDER_NAME);
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

        const roomId =
          url.searchParams.get("roomId") ||
          (url.searchParams.get("roomIds") || "").split(",")[0].trim() ||
          "default";

        const wsProvider = __alepha.inject("WebSocketServerProvider");

        let userId = "";
        try {
          const resolved = await wsProvider.resolveUserId({
            url: request.url,
            headers: {
              authorization: request.headers.get("authorization") || undefined,
              cookie: request.headers.get("cookie") || undefined,
            },
          });
          userId = resolved || "";
        } catch (err) {
          __alepha.log.warn("Failed to resolve WebSocket user identity", err);
        }

        // \`getEndpoint\` returns the \`WebSocketPrimitiveOptions\` config object
        // directly (see registerEndpoint in the providers) — \`secure\` is a
        // top-level field, there is no \`.options\` wrapper on it.
        const endpoint = wsProvider.getEndpoint(url.pathname);
        if (endpoint && endpoint.secure && !userId) {
          return new Response("Unauthorized", { status: 401 });
        }

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

export default {
  fetch: async (request, env, executionCtx) => {${upgradeBranch}
    const ctx = { req: request, res: undefined };

    bindEnv(env);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for fetch event", err);
      return new Response("Internal Server Error", { status: 500 });
    }

    await withExecutionContext(executionCtx, () =>
      __alepha.events.emit("web:request", ctx),
    );

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
