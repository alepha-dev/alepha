import { basename } from "node:path";
import { $inject } from "alepha";
import { KV_DEFAULT_BINDING } from "alepha/cache";
import { $container, type ContainerPrimitive } from "alepha/containers";
import { EmailProvider } from "alepha/email";
import {
  CloudflareEmailProvider,
  SEND_EMAIL_DEFAULT_BINDING,
} from "alepha/email/cloudflare";
import { QUEUE_DEFAULT_BINDING } from "alepha/queue";
import type { CronProvider, WorkerdCronProvider } from "alepha/scheduler";
import { FileSystemProvider } from "alepha/system";
import { ViteUtils } from "../services/ViteUtils.ts";
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
    const containers = this.enhanceContainers(ctx, wrangler);

    await this.fs.writeFile(
      this.fs.join(root, distDir, "wrangler.jsonc"),
      JSON.stringify(wrangler, null, 2),
    );

    await this.writeWorkerEntryPoint(root, distDir, containers);
  }

  protected enhanceDomain(wrangler: WranglerConfig): void {
    const domain = process.env.CLOUDFLARE_DOMAIN;
    if (!domain) {
      return;
    }

    if (domain.includes("*")) {
      const zone = process.env.CLOUDFLARE_ZONE;
      if (!zone) {
        throw new Error(
          `Wildcard domain "${domain}" requires CLOUDFLARE_ZONE to be set (the parent zone name, e.g. "alepha.dev").`,
        );
      }
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
    if (ctx.alepha.primitives("scheduler").length === 0) {
      return;
    }

    let cronProvider: CronProvider | undefined;
    try {
      cronProvider = ctx.alepha.inject("CronProvider") as WorkerdCronProvider;
    } catch {}

    const crons = cronProvider?.getCronJobs();
    if (!crons || crons.length === 0) {
      return;
    }

    const cronExpressions = [...new Set(crons.map((c) => c.expression))];
    wrangler.triggers ??= {};
    wrangler.triggers.crons = cronExpressions;
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
    const jurisdiction = process.env.CLOUDFLARE_JURISDICTION;
    wrangler.d1_databases = wrangler.d1_databases || [];
    wrangler.d1_databases.push({
      binding,
      database_name: dbName,
      database_id: id,
      ...(jurisdiction ? { jurisdiction } : {}),
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
    let provider: EmailProvider | undefined;
    try {
      provider = ctx.alepha.inject(EmailProvider);
    } catch {
      return;
    }

    if (!(provider instanceof CloudflareEmailProvider)) {
      return;
    }

    wrangler.send_email = wrangler.send_email || [];
    if (
      wrangler.send_email.some(
        (b: { name: string }) => b.name === SEND_EMAIL_DEFAULT_BINDING,
      )
    ) {
      return;
    }

    const entry: Record<string, unknown> = { name: SEND_EMAIL_DEFAULT_BINDING };
    const destination = process.env.EMAIL_FROM;
    if (destination) {
      entry.destination_address = destination;
    }

    wrangler.send_email.push(entry);
  }

  /**
   * Discover `$container` primitives and emit the matching Cloudflare
   * Containers bindings, Durable Object bindings, and migrations into
   * `wrangler.jsonc`. The DO class declarations are added later, when
   * the worker entry point is written.
   *
   * Returns the list of container descriptors so
   * `writeWorkerEntryPoint` can emit `export class <NAME> extends
   * Container` declarations referencing them.
   */
  protected enhanceContainers(
    ctx: BuildTaskContext,
    wrangler: WranglerConfig,
  ): ContainerDescriptor[] {
    const primitives = ctx.alepha.primitives(
      $container,
    ) as ContainerPrimitive[];
    if (primitives.length === 0) {
      return [];
    }

    const descriptors: ContainerDescriptor[] = primitives.map((p) => ({
      name: p.name.toUpperCase(),
      className: p.name
        .split(/[^a-zA-Z0-9]/)
        .filter(Boolean)
        .map((s) => s[0]!.toUpperCase() + s.slice(1))
        .join(""),
      image: p.options.image,
      port: p.options.port ?? 3000,
      sleepAfter:
        typeof p.options.sleepAfter === "string" ? p.options.sleepAfter : "15m",
      instanceType: p.options.instanceType ?? "dev",
      maxInstances: p.options.maxInstances ?? 5,
      envVars: p.options.envVars,
    }));

    wrangler.containers = wrangler.containers || [];
    wrangler.durable_objects = wrangler.durable_objects || {};
    wrangler.durable_objects.bindings = wrangler.durable_objects.bindings || [];
    wrangler.migrations = wrangler.migrations || [];

    const newSqliteClasses: string[] = [];
    for (const d of descriptors) {
      wrangler.containers.push({
        class_name: d.className,
        image: d.image,
        instance_type: d.instanceType,
        max_instances: d.maxInstances,
      });
      wrangler.durable_objects.bindings.push({
        name: d.name,
        class_name: d.className,
      });
      newSqliteClasses.push(d.className);
    }

    if (newSqliteClasses.length > 0) {
      wrangler.migrations.push({
        tag: "containers-v1",
        new_sqlite_classes: newSqliteClasses,
      });
    }

    return descriptors;
  }

  protected async writeWorkerEntryPoint(
    root: string,
    distDir: string,
    containers: ContainerDescriptor[] = [],
  ): Promise<void> {
    const containerDeclarations = containers
      .map((c) => {
        const envVars = c.envVars
          ? `  envVars = ${JSON.stringify(c.envVars)};\n`
          : "";
        return `export class ${c.className} extends Container {\n  defaultPort = ${c.port};\n  sleepAfter = "${c.sleepAfter}";\n${envVars}}`;
      })
      .join("\n\n");

    const containerImport =
      containers.length > 0
        ? `import { Container } from "@cloudflare/containers";\n\n${containerDeclarations}\n\n`
        : "";

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

export default {
  fetch: async (request, env, executionCtx) => {
    const ctx = { req: request, res: undefined };

    __alepha.set("cloudflare.env", env);
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
    __alepha.set("cloudflare.env", env);
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
    __alepha.set("cloudflare.env", env);
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
      `${this.warningComment}\n${containerImport}${workerCode}`.trim(),
    );
  }
}

interface ContainerDescriptor {
  name: string;
  className: string;
  image: string;
  port: number;
  sleepAfter: string;
  instanceType: "dev" | "basic" | "standard";
  maxInstances: number;
  envVars?: Record<string, string>;
}
