import { basename } from "node:path";
import { $inject } from "alepha";
import { CloudflareR2Provider, R2_DEFAULT_BINDING } from "alepha/bucket";
import { type CloudflareKVProvider, KV_DEFAULT_BINDING } from "alepha/cache";
import { FileSystemProvider } from "alepha/system";
import type { CloudflareQueueProvider } from "../../queue/core/providers/CloudflareQueueProvider.ts";
import { QUEUE_DEFAULT_BINDING } from "../../queue/core/providers/CloudflareQueueProvider.ts";
import type { CronProvider } from "../../scheduler/providers/CronProvider.ts";
import type { WorkerdCronProvider } from "../../scheduler/providers/WorkerdCronProvider.ts";
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
    const name = basename(root);
    const hasAssets = await this.fs.exists(
      this.fs.join(root, distDir, "public"),
    );

    let workerdCronProvider: CronProvider | undefined;
    try {
      workerdCronProvider = ctx.alepha.inject(
        "CronProvider",
      ) as WorkerdCronProvider;
    } catch {}

    const crons = workerdCronProvider?.getCronJobs();

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

    if (crons && crons.length > 0) {
      const cronExpressions = [...new Set(crons.map((c) => c.expression))];
      wrangler.triggers ??= {};
      wrangler.triggers.crons = cronExpressions;
    }

    const url = process.env.DATABASE_URL;
    if (url?.startsWith("d1:")) {
      const [dbName, id] = url
        .replace("d1://", "")
        .replace("d1:", "")
        .split(":");
      wrangler.d1_databases = wrangler.d1_databases || [];
      wrangler.d1_databases.push({
        binding: dbName,
        database_name: dbName,
        database_id: id,
      });
      wrangler.vars ??= {};
      wrangler.vars.DATABASE_URL = `d1://${dbName}:${id}`;
    }

    let r2Provider: CloudflareR2Provider | undefined;
    try {
      r2Provider = ctx.alepha.inject(CloudflareR2Provider);
    } catch {}

    if (r2Provider) {
      wrangler.r2_buckets = wrangler.r2_buckets || [];
      wrangler.r2_buckets.push({
        binding: R2_DEFAULT_BINDING,
        bucket_name: r2Provider.bucketName,
      });
    }

    let kvProvider: CloudflareKVProvider | undefined;
    try {
      kvProvider = ctx.alepha.inject<CloudflareKVProvider>(
        "CloudflareKVProvider",
      );
    } catch {}

    if (kvProvider) {
      wrangler.kv_namespaces = wrangler.kv_namespaces || [];
      wrangler.kv_namespaces.push({
        binding: KV_DEFAULT_BINDING,
      });
    }

    let queueProvider: CloudflareQueueProvider | undefined;
    const queueMod = await this.viteUtils.importModule("alepha/queue");
    try {
      queueProvider = ctx.alepha.inject<CloudflareQueueProvider>(
        queueMod.CloudflareQueueProvider,
      );
    } catch {}

    if (queueProvider) {
      const queueName = `${name}-queue`;
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

    await this.fs.writeFile(
      this.fs.join(root, distDir, "wrangler.jsonc"),
      JSON.stringify(wrangler, null, 2),
    );

    await this.writeWorkerEntryPoint(root, distDir);
  }

  protected async writeWorkerEntryPoint(
    root: string,
    distDir: string,
  ): Promise<void> {
    const workerCode = `
import "./index.js";

export default {
  fetch: async (request, env) => {
    const ctx = { req: request, res: undefined };

    __alepha.set("cloudflare.env", env);

    try {
      await __alepha.start();
    } catch (err) {
      console.error("Failed to start Alepha for fetch event", err);
      return new Response("Internal Server Error", { status: 500 });
    }

    await __alepha.events.emit("web:request", ctx);

    return ctx.res;
  },

  scheduled: async (event, env, ctx) => {
    __alepha.set("cloudflare.env", env);

    try {
      await __alepha.start();
    } catch (err) {
      console.error("Failed to start Alepha for scheduled event", err);
      throw err;
    }

    await __alepha.events.emit("cloudflare:scheduled", {
      cron: event.cron,
      scheduledTime: event.scheduledTime,
    });
  },

  queue: async (batch, env) => {
    __alepha.set("cloudflare.env", env);

    try {
      await __alepha.start();
    } catch (err) {
      console.error("Failed to start Alepha for queue event", err);
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
