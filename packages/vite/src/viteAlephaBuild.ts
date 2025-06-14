import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress } from "node:zlib";
import gzipPlugin from "rollup-plugin-gzip";
import type { Plugin, UserConfig } from "vite";
import type * as vite from "vite";
import { viteAlephaBuildVercel } from "./viteAlephaBuildVercel.ts";

const brotliPromise = promisify(brotliCompress);

export interface ViteAlephaBuildOptions {
	/**
	 * The entry point for the application. This is the file that will be executed when the application is run.
	 *
	 * @default 'src/index.server.ts'
	 */
	entry?: string;

	/**
	 *
	 */
	vercel?: boolean;

	/**
	 * A list of modules that should not be externalized in the build process.
	 *
	 * @default true
	 */
	noExternal?: string | RegExp | (string | RegExp)[] | true;

	/**
	 * Vite server options to override the default server configuration.
	 */
	server?: UserConfig;
}

/**
 *
 */
export async function viteAlephaBuild(
	options: ViteAlephaBuildOptions = {},
): Promise<Plugin> {
	const entry = options.entry || "src/index.server.ts";
	const distDir = "dist";
	const clientDir = "public";
	const { build: viteBuild } = await importVite();

	const viteBuildClient = async () => {
		const plugins: any[] = [];

		plugins.push(
			gzipPlugin({
				filter: /\.(js|mjs|cjs|css|wasm|svg)$/,
			}),
		);

		plugins.push(
			gzipPlugin({
				filter: /\.(js|mjs|cjs|css|wasm|svg)$/,
				customCompression: (content) =>
					brotliPromise(
						Buffer.isBuffer(content) ? content : Buffer.from(content),
					),
				fileName: ".br",
			}),
		);

		await viteBuild({
			build: {
				outDir: `${distDir}/${clientDir}`,
				rollupOptions: {
					output: {
						entryFileNames: "[hash].js",
						chunkFileNames: "[hash].js",
						assetFileNames: "[hash][extname]",
					},
				},
			},
			plugins,
		});
	};

	const viteBuildServer = async (opts: { clientDir?: string }) => {
		const plugins: any[] = [];

		if (options.vercel) {
			plugins.push(
				viteAlephaBuildVercel({
					clientDir: opts.clientDir,
					distDir: distDir,
				}),
			);
		}

		await viteBuild({
			publicDir: false,
			ssr: {
				noExternal: options.noExternal ?? true,
			},
			resolve: {
				alias: {
					"pg-cloudflare": "pg",
				},
			},
			build: {
				ssr: entry,
				copyPublicDir: false,
				ssrManifest: true,
				outDir: `${distDir}/server`,
				rollupOptions: {
					output: {
						entryFileNames: "index.mjs",
						chunkFileNames: "[hash].mjs",
						assetFileNames: "[hash][extname]",
						format: "esm",
					},
				},
			},
			plugins,
			...options.server,
		});

		const templateState = clientDir
			? `__alepha.state(\n\t"ReactServerProvider.template", \n\t\`${readFileSync(`${distDir}/${clientDir}/index.html`, "utf-8").replace(/>\s*</g, "><").trim()}\`\n);`
			: "";

		writeFileSync(
			`${distDir}/index.mjs`,
			`
			import'./server/index.mjs';

${templateState}

		`.trim(),
		);

		if (clientDir) {
			unlinkSync(`${distDir}/${clientDir}/index.html`);
		}
	};

	return {
		name: "vite-plugin-alepha-build",
		apply: "build",
		async buildStart() {
			if (process.env.VITE_DOUBLE_BUILD_DONE === "true") {
				return;
			}

			process.env.VITE_DOUBLE_BUILD_DONE = "true";
			const hasClient = await access(join(process.cwd(), "index.html"))
				.then(() => true)
				.catch(() => false);

			if (hasClient) {
				await viteBuildClient();
			}

			await viteBuildServer({
				clientDir: hasClient ? clientDir : undefined,
			});

			// Prevent the default build from running again
			process.exit(0);
		},
	};
}

const importVite = async (): Promise<typeof vite> => {
	try {
		// Try to import rolldown-vite first, as it is a more optimized version of Vite
		return createRequire(import.meta.url)("rolldown-vite");
	} catch (error) {
		console.warn(
			"Using Vite instead of rolldown-vite. Please install rolldown-vite for better performance.",
		);
		try {
			return createRequire(import.meta.url)("vite");
		} catch (error) {
			throw new Error(
				"Vite is not installed. Please install it with `npm install vite` or `npm install rolldown-vite`.",
			);
		}
	}
};
