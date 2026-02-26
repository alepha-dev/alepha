import { $inject } from "alepha";
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

		await this.writeOutputConfig(outputDir, ctx.options.vercel?.config);
		await this.writeVcConfig(funcDir);
		await this.writeHandler(funcDir);
		await this.copyServerBundle(dist, funcDir);
		await this.copyStaticAssets(dist, staticDir);
		await this.writeProjectConfig(ctx, dist);
	}

	/**
	 * Write .vercel/output/config.json with Build Output API v3 format.
	 */
	protected async writeOutputConfig(
		outputDir: string,
		config?: { crons?: { path: string; schedule: string }[] },
	): Promise<void> {
		const outputConfig: Record<string, any> = {
			version: 3,
			routes: [
				{ handle: "filesystem" },
				{ src: "/(.*)", dest: "/index" },
			],
		};

		if (config?.crons && config.crons.length > 0) {
			outputConfig.crons = config.crons;
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

export default async (req, res) => {
  try {
    await __alepha.start();
  } catch (err) {
    __alepha.log.error("Failed to start Alepha for request", err);
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("Internal Server Error");
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
	 * Move static assets from dist/public/ to .vercel/output/static/.
	 */
	protected async copyStaticAssets(
		dist: string,
		staticDir: string,
	): Promise<void> {
		const publicDir = this.fs.join(dist, "public");
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
