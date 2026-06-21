import { basename } from "node:path";
import { $inject } from "alepha";
import { KV_DEFAULT_BINDING } from "alepha/cache";
import { SEND_EMAIL_DEFAULT_BINDING } from "alepha/email/cloudflare";
import { QUEUE_DEFAULT_BINDING } from "alepha/queue";
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
  };
  /**
   * All distinct cron expressions registered by `$scheduler`
   * primitives. Empty when `hasCron` is false.
   */
  crons: string[];
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
    const name = basename(root)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63);
    const hasAssets = await this.fs.exists(
      this.fs.join(root, distDir, "public"),
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

    this.enhanceDomain(wrangler);
    this.enhanceCron(ctx, wrangler);
    this.enhanceDatabase(wrangler);
    this.enhanceR2(wrangler);
    this.enhanceKV(wrangler);
    this.enhanceQueue(wrangler);
    this.enhanceEmail(ctx, wrangler);

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
      hasBucket = ctx.alepha.primitives("$bucket").length > 0;
    } catch {}

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
      hasQueue = ctx.alepha.primitives("$queue").length > 0;
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
      },
      crons,
      email,
      env,
    };

    await this.fs.writeFile(
      this.fs.join(root, distDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
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
    if (ctx.alepha.primitives("scheduler").length === 0) {
      return [];
    }
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
    wrangler.queues.consumers = wrangler.queues.consumers || [];
    wrangler.queues.consumers.push({
      queue: queueName,
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
    const workerCode = `
import "./index.js";

// Stash the per-invocation \`executionCtx.waitUntil\` in the Alepha store
// so background work (notably $job direct dispatch) can keep the isolate
// alive past the response.
const setWaitUntil = (executionCtx) => {
  if (executionCtx && typeof executionCtx.waitUntil === "function") {
    __alepha.set("cloudflare.waitUntil", (p) => executionCtx.waitUntil(p));
  } else {
    __alepha.set("cloudflare.waitUntil", undefined);
  }
};

// Bind the per-invocation Worker \`env\`: keep the full binding (D1, R2, KV, …)
// in the store for providers, and lift its string values (secrets/vars like
// PUBLIC_URL) into \`alepha.env\` so \`$env\` resolves them at runtime.
const bindEnv = (env) => {
  __alepha.set("cloudflare.env", env);
  __alepha.loadEnv(env);
};

export default {
  fetch: async (request, env, executionCtx) => {
    const ctx = { req: request, res: undefined };

    bindEnv(env);
    setWaitUntil(executionCtx);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for fetch event", err);
      return new Response("Internal Server Error", { status: 500 });
    }

    await __alepha.events.emit("web:request", ctx);

    return ctx.res;
  },

  scheduled: async (event, env, executionCtx) => {
    bindEnv(env);
    setWaitUntil(executionCtx);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for scheduled event", err);
      throw err;
    }

    await __alepha.events.emit("cloudflare:scheduled", {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
    });
  },

  queue: async (batch, env, executionCtx) => {
    bindEnv(env);
    setWaitUntil(executionCtx);

    try {
      await __alepha.start();
    } catch (err) {
      __alepha.log.error("Failed to start Alepha for queue event", err);
      throw err;
    }

    for (const msg of batch.messages) {
      try {
        await __alepha.events.emit("cloudflare:queue", msg.body);
        msg.ack();
      } catch (e) {
        msg.retry();
      }
    }
  },
};
`.trim();

    await this.fs.writeFile(
      this.fs.join(root, distDir, "main.cloudflare.js"),
      `${this.warningComment}\n${workerCode}`.trim(),
    );
  }
}
