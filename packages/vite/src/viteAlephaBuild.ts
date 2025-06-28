import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";
import { buildClient } from "./helpers/buildClient.ts";
import { buildServer } from "./helpers/buildServer.ts";
import { fileExists } from "./helpers/fileExists.ts";

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
	client?: false;

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
	const entry = options.serverEntry;

	const distDir = "dist";
	const clientDir = "public";

	return {
		name: "alepha-build",
		apply: "build",
		config(config, ctx) {
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

			if (hasClient) {
				await buildClient({
					html: await readFile("index.html", "utf-8"),
					dist: `${distDir}/${clientDir}`,
				});
			}

			if (entry) {
				await buildServer({
					entry,
					distDir: `${distDir}`,
					clientDir: hasClient ? clientDir : undefined,
					vercel: options.vercel,
				});
			}

			// prevent the default build from running again
			process.exit(0);
		},
	};
}
