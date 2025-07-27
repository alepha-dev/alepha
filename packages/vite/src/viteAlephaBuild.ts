import { readFile } from "node:fs/promises";
import type { Plugin, UserConfig } from "vite";
import { type BuildClientOptions, buildClient } from "./helpers/buildClient.ts";
import { buildServer } from "./helpers/buildServer.ts";
import { fileExists } from "./helpers/fileExists.ts";
import { extractFirstModuleScriptSrc, prerender } from "./helpers/prerender.ts";

export interface ViteAlephaBuildOptions {
	/**
	 * Path to the entry file for the server build.
	 * If empty, SSR build will be skipped.
	 */
	serverEntry?: string;

	/**
	 * Set false to skip the client build.
	 * This is useful if you only want to build the server-side application.
	 */
	client?: false | Partial<BuildClientOptions>;

	/**
	 * If true, the build will be optimized for Vercel deployment.
	 *
	 * If `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` environment variables are set, .vercel will be generated with the correct configuration.
	 *
	 * @default false
	 */
	vercel?: boolean;
}

export async function viteAlephaBuild(
	options: ViteAlephaBuildOptions = {},
): Promise<Plugin> {
	let entry = options.serverEntry;

	const distDir = "dist";
	const clientDir = "public";
	let rootConfig: UserConfig = {};

	return {
		name: "alepha-build",
		apply: "build",
		config(config, ctx) {
			if (!process.env.VITE_DOUBLE_BUILD_DONE) {
				rootConfig = config;
			}

			if (ctx.isSsrBuild || !process.env.VITE_DOUBLE_BUILD_DONE) {
				// this is a server build, so we don't need the public directory
				config.publicDir = false;
			} else {
				// this is a client build, so we need the public directory
				config.publicDir = "public";
			}
		},
		async buildStart() {
			if (process.env.VITE_DOUBLE_BUILD_DONE === "true") {
				return;
			}

			process.env.VITE_DOUBLE_BUILD_DONE = "true";

			const hasClient =
				options.client !== false && (await fileExists("index.html"));
			const buildClientOptions =
				typeof options.client === "object" ? options.client : {};

			let html = "";
			if (hasClient) {
				html = await readFile("index.html", "utf-8");
				await buildClient({
					...buildClientOptions,
					config: rootConfig,
					html,
					dist: `${distDir}/${clientDir}`,
				});
			}

			let template = "";
			if (hasClient) {
				template = await readFile(
					`${distDir}/${clientDir}/index.html`,
					"utf-8",
				);
			}

			if (buildClientOptions.prerender && !entry && html) {
				entry = extractFirstModuleScriptSrc(html);
			}

			if (entry) {
				await buildServer({
					config: rootConfig,
					entry,
					distDir: `${distDir}`,
					clientDir: hasClient ? clientDir : undefined,
					vercel: options.vercel,
				});
			}

			if (buildClientOptions.prerender && template) {
				await prerender({
					template: template,
					dist: `${distDir}/${clientDir}`,
					entry: `${distDir}/index.js`,
					compress: buildClientOptions.precompress,
				});
			}

			// prevent the default build from running again
			process.exit(0);
		},
	};
}
