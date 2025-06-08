import { access } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress } from "node:zlib";
import gzipPlugin from "rollup-plugin-gzip";
import { type Plugin, type UserConfig, build as viteBuild } from "vite";
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
	vercel?: boolean | { projectId: string; orgId: string; settings: any };

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
export function viteAlephaBuild(options: ViteAlephaBuildOptions = {}): Plugin {
	const entry = options.entry || "src/index.server.ts";
	const filename = entry.split("/").at(-1)?.split(".").slice(0, -1).join(".");

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
				outDir: "dist/client",
			},
			plugins,
		});
	};

	const viteBuildServer = async (opts: { client?: string }) => {
		const plugins: any[] = [];

		if (options.vercel) {
			plugins.push(
				viteAlephaBuildVercel({
					filename: filename,
					client: opts.client,
				}),
			);
		}

		await viteBuild({
			publicDir: false,
			ssr: {
				noExternal: options.noExternal ?? true,
			},
			build: {
				ssr: entry,
				outDir: "dist/server",
				rollupOptions: {
					output: {
						entryFileNames: "[name].mjs",
						chunkFileNames: "[name]-[hash].mjs",
						assetFileNames: "[name]-[hash][extname]",
						format: "esm",
					},
				},
			},
			plugins,
			...options.server,
		});
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
				client: hasClient ? "client" : undefined,
			});

			// Prevent the default build from running again
			process.exit(0);
		},
	};
}
