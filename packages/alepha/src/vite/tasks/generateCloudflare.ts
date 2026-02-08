import { access, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Alepha } from "alepha";
import { CloudflareR2Provider, R2_DEFAULT_BINDING } from "alepha/bucket";
import { type CloudflareKVProvider, KV_DEFAULT_BINDING } from "alepha/cache";
import type { CronProvider } from "alepha/scheduler";
import type { WorkerdCronProvider } from "../../scheduler/providers/WorkerdCronProvider.ts";

export interface GenerateCloudflareOptions {
  /**
   * The directory where the build output is placed.
   *
   * @default "dist"
   */
  distDir?: string;

  /**
   * Additional Wrangler configuration options to merge into wrangler.jsonc.
   */
  config?: WranglerConfig;

  alepha: Alepha;

  importModule: (root: string) => Promise<any>;
}

export interface WranglerConfig {
  [key: string]: any;
}

const WARNING_COMMENT =
  "// This file was automatically generated. DO NOT MODIFY.\n" +
  "// Changes to this file will be lost when the code is regenerated.\n";

/**
 * Generate Cloudflare Workers deployment configuration.
 *
 * This task creates:
 * - wrangler.jsonc with worker configuration
 * - worker.js entry point for Cloudflare Workers
 */
export async function generateCloudflare(
  opts: GenerateCloudflareOptions,
): Promise<void> {
  const distDir = opts.distDir ?? "dist";
  const root = process.cwd();
  const name = basename(root);
  const hasAssets = await access(join(root, distDir, "public"))
    .then(() => true)
    .catch(() => false);

  let workerdCronProvider: CronProvider | undefined;
  try {
    workerdCronProvider = opts.alepha.inject(
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
    ...opts.config,
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
    const [name, id] = url.replace("d1://", "").replace("d1:", "").split(":");
    wrangler.d1_databases = wrangler.d1_databases || [];
    wrangler.d1_databases.push({
      binding: name,
      database_name: name,
      database_id: id,
    });
    wrangler.vars ??= {};
    wrangler.vars.DATABASE_URL = `d1://${name}:${id}`;
  }

  // Add R2 binding if CloudflareR2Provider is used
  let r2Provider: CloudflareR2Provider | undefined;
  try {
    r2Provider = opts.alepha.inject(CloudflareR2Provider);
  } catch {}

  if (r2Provider) {
    wrangler.r2_buckets = wrangler.r2_buckets || [];
    wrangler.r2_buckets.push({
      binding: R2_DEFAULT_BINDING,
      bucket_name: r2Provider.bucketName,
    });
  }

  // Add KV namespace binding if CloudflareKVProvider is used
  let kvProvider: CloudflareKVProvider | undefined;
  const mod = await opts.importModule("alepha/cache");
  try {
    kvProvider = opts.alepha.inject<CloudflareKVProvider>(
      mod.CloudflareKVProvider,
    );
  } catch (e) {
    console.log(e);
  }

  if (kvProvider) {
    wrangler.kv_namespaces = wrangler.kv_namespaces || [];
    wrangler.kv_namespaces.push({
      binding: KV_DEFAULT_BINDING,
    });
  }

  await writeFile(
    join(root, distDir, "wrangler.jsonc"),
    JSON.stringify(wrangler, null, 2),
  );

  await writeWorkerEntryPoint(root, distDir);
}

/**
 * Write the worker entry point that bootstraps Alepha and handles fetch requests
 */
async function writeWorkerEntryPoint(
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
};
`.trim();

  await writeFile(
    join(root, distDir, "main.cloudflare.js"),
    `${WARNING_COMMENT}\n${workerCode}`.trim(),
  );
}
