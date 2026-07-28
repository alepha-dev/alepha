import { $inject, AlephaError } from "alepha";
import type { CronProvider } from "alepha/scheduler";
import { FileSystemProvider } from "alepha/system";
import { BuildTask, type BuildTaskContext } from "./BuildTask.ts";

/**
 * Generate Vercel Build Output API v3 deployment configuration.
 *
 * Creates:
 * - .vercel/output/config.json with routes and version
 * - .vercel/output/static/ (moved from dist/public/)
 * - .vercel/output/functions/index.func/ with handler, index.js, server/, package.json
 * - .vercel/project.json if projectId and orgId are set
 */
export class BuildVercelTask extends BuildTask {
  protected readonly fs = $inject(FileSystemProvider);

  protected readonly warningComment =
    "// This file was automatically generated. DO NOT MODIFY.\n" +
    "// Changes to this file will be lost when the code is regenerated.\n";

  async run(ctx: BuildTaskContext): Promise<void> {
    if (ctx.options.target !== "vercel") {
      return;
    }

    // `--prebuilt` deploys have no live container to introspect
    // (`ctx.alepha` is null in manifest mode), and this target needs one.
    // Without the guard the build died on a TypeError naming nothing.
    if (ctx.flags?.prebuilt) {
      throw new AlephaError(
        "Target 'vercel' does not support --prebuilt: it needs a live app to collect its cron jobs and routes. Run the build without --prebuilt.",
      );
    }

    const distDir = ctx.options.output?.dist ?? "dist";

    await ctx.run({
      name: "generate deploy config (vercel)",
      handler: async () => {
        await this.generateVercel(ctx, distDir);
      },
    });
  }

  protected async generateVercel(
    ctx: BuildTaskContext,
    distDir: string,
  ): Promise<void> {
    const root = ctx.root;
    const dist = this.fs.join(root, distDir);

    const outputDir = this.fs.join(dist, ".vercel", "output");
    const funcDir = this.fs.join(outputDir, "functions", "index.func");
    const staticDir = this.fs.join(outputDir, "static");

    await this.fs.mkdir(funcDir);
    await this.fs.mkdir(staticDir);

    await this.writeOutputConfig(
      outputDir,
      ctx.options.vercel?.config,
      this.collectCronJobs(ctx),
    );
    await this.writeVcConfig(funcDir);
    await this.writeHandler(funcDir);
    await this.copyServerBundle(dist, funcDir);
    await this.copyStaticAssets(
      dist,
      staticDir,
      ctx.options.output?.public ?? "public",
    );
    await this.writeProjectConfig(ctx, dist);
  }

  /**
   * Collect every registered `$job({ cron })` and turn it
   * into a Vercel Cron entry. Vercel hits `path` on the configured
   * `schedule`; the entry-point handler routes that to a `serverless:cron`
   * event so `CronProvider` runs the matching job in-process.
   *
   * Mirrors the equivalent in `BuildCloudflareTask.enhanceCron`, except
   * Vercel needs one path per job (it doesn't dispatch by cron expression
   * the way Cloudflare does).
   */
  protected collectCronJobs(
    ctx: BuildTaskContext,
  ): { path: string; schedule: string }[] {
    // `CronProvider` is the single registry — every `$job({ cron })` lands
    // there. (This used to open with an empty `if` guarding on a `scheduler`
    // primitive count; the primitive is gone and the branch did nothing.)
    let cronProvider: CronProvider | undefined;
    try {
      cronProvider = ctx.alepha.inject("CronProvider") as CronProvider;
    } catch {}

    const jobs = cronProvider?.getCronJobs();
    if (!jobs || jobs.length === 0) {
      return [];
    }

    return jobs.map((job) => ({
      path: `/_alepha/cron/${encodeURIComponent(job.name)}`,
      schedule: job.expression,
    }));
  }

  /**
   * Write .vercel/output/config.json with Build Output API v3 format.
   *
   * `userCrons` are merged with auto-collected `$job({ cron })`
   * entries — explicit user config wins on conflicting paths.
   */
  protected async writeOutputConfig(
    outputDir: string,
    config?: { crons?: { path: string; schedule: string }[] },
    autoCrons: { path: string; schedule: string }[] = [],
  ): Promise<void> {
    const outputConfig: Record<string, any> = {
      version: 3,
      routes: [{ handle: "filesystem" }, { src: "/(.*)", dest: "/index" }],
    };

    const merged = new Map<string, { path: string; schedule: string }>();
    for (const c of autoCrons) merged.set(c.path, c);
    for (const c of config?.crons ?? []) merged.set(c.path, c);
    const crons = [...merged.values()];
    if (crons.length > 0) {
      outputConfig.crons = crons;
    }

    await this.fs.writeFile(
      this.fs.join(outputDir, "config.json"),
      JSON.stringify(outputConfig, null, 2),
    );
  }

  /**
   * Write .vc-config.json for the serverless function.
   */
  protected async writeVcConfig(funcDir: string): Promise<void> {
    await this.fs.writeFile(
      this.fs.join(funcDir, ".vc-config.json"),
      JSON.stringify(
        {
          runtime: "nodejs22.x",
          handler: "handler.js",
          launcherType: "Nodejs",
        },
        null,
        2,
      ),
    );
  }

  /**
   * Write the handler.js entry point that uses node:request event.
   */
  protected async writeHandler(funcDir: string): Promise<void> {
    const handlerCode = `
import "./index.js";

const CRON_PREFIX = "/_alepha/cron/";

export default async (req, res) => {
  try {
    await __alepha.start();
  } catch (err) {
    __alepha.log.error("Failed to start Alepha for request", err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
    return;
  }

  // Vercel Cron triggers are HTTP GETs to a configured path. We route them
  // to the CronProvider via an event so the same job declaration works on
  // Vercel, Cloudflare, and long-running Node alike. Vercel signs cron
  // requests with \`Authorization: Bearer \${CRON_SECRET}\`; the secret is
  // available as \`process.env.CRON_SECRET\`. When set, we require the
  // header to match before triggering.
  const url = req.url || "";
  if (url.startsWith(CRON_PREFIX)) {
    const expected = process.env.CRON_SECRET;
    if (expected) {
      const got = (req.headers?.authorization || "").replace(/^Bearer\\s+/i, "");
      if (got !== expected) {
        res.writeHead(401, { "content-type": "text/plain" });
        res.end("Unauthorized");
        return;
      }
    }
    const name = decodeURIComponent(url.slice(CRON_PREFIX.length).split("?")[0]);
    try {
      await __alepha.events.emit("serverless:cron", { name });
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    } catch (err) {
      __alepha.log.error(\`Cron trigger '\${name}' failed\`, err);
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("cron failed");
    }
    return;
  }

  await __alepha.events.emit("node:request", { req, res });
};
`.trim();

    await this.fs.writeFile(
      this.fs.join(funcDir, "handler.js"),
      `${this.warningComment}\n${handlerCode}`,
    );
  }

  /**
   * Copy the server bundle (index.js, server/, package.json) into the function directory.
   */
  protected async copyServerBundle(
    dist: string,
    funcDir: string,
  ): Promise<void> {
    await this.fs.cp(
      this.fs.join(dist, "index.js"),
      this.fs.join(funcDir, "index.js"),
    );

    await this.fs.cp(
      this.fs.join(dist, "package.json"),
      this.fs.join(funcDir, "package.json"),
    );

    const serverDir = this.fs.join(dist, "server");
    if (await this.fs.exists(serverDir)) {
      await this.fs.cp(serverDir, this.fs.join(funcDir, "server"));
    }
  }

  /**
   * Move static assets from the build's public directory to
   * `.vercel/output/static/`.
   *
   * The directory name comes from `output.public` — it was hardcoded to
   * "public", so a project that configured a different one silently shipped
   * with no static assets at all.
   */
  protected async copyStaticAssets(
    dist: string,
    staticDir: string,
    publicDirName = "public",
  ): Promise<void> {
    const publicDir = this.fs.join(dist, publicDirName);
    if (await this.fs.exists(publicDir)) {
      await this.fs.cp(publicDir, staticDir);
    } else {
      await this.fs.writeFile(this.fs.join(staticDir, ".keep"), "");
    }
  }

  /**
   * Write .vercel/project.json if projectId and orgId are available.
   */
  protected async writeProjectConfig(
    ctx: BuildTaskContext,
    dist: string,
  ): Promise<void> {
    const projectId =
      process.env.VERCEL_PROJECT_ID ?? ctx.options.vercel?.projectId;
    const projectName =
      process.env.VERCEL_PROJECT_NAME ?? ctx.options.vercel?.projectName;
    const orgId = process.env.VERCEL_ORG_ID ?? ctx.options.vercel?.orgId;

    if (!projectId || !orgId) {
      return;
    }

    const vercelDir = this.fs.join(dist, ".vercel");
    await this.fs.mkdir(vercelDir);

    await this.fs.writeFile(
      this.fs.join(vercelDir, "project.json"),
      JSON.stringify(
        {
          projectId,
          projectName,
          orgId,
        },
        null,
        2,
      ),
    );
  }
}
