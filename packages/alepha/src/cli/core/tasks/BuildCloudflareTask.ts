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

    // `dist/manifest.json` is written by BuildManifestTask, which runs for
    // every target — the manifest describes the app, not the destination.
    await this.writeWorkerEntryPoint(root, distDir);
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
