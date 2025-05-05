import { access } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress } from "node:zlib";
import gzipPlugin from "rollup-plugin-gzip";
import { type Plugin, build as viteBuild } from "vite";
import { viteAlephaBuildVercel } from "./viteAlephaBuildVercel.ts";

const brotliPromise = promisify(brotliCompress);

export interface ViteAlephaBuildOptions {
	/**
	 * The entry point for the application. This is the file that will be executed when the application is run.
	 *
	 * @default 'src/index.ts'
	 */
	entry?: string;

	/**
	 *
	 */
	vercel?: boolean | { projectId: string; orgId: string; settings: any };
}

/**
 *
 */
export function viteAlephaBuild(options: ViteAlephaBuildOptions = {}): Plugin {
	const entry = options.entry || "src/index.ts";
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
			ssr: {
				noExternal: true,
			},
			publicDir: false,
			build: {
				ssr: entry,
				outDir: "dist/server",
				rollupOptions: {
					output: {
						entryFileNames: `${filename}.mjs`,
						format: "esm",
					},
				},
			},
			plugins,
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
			const hasClient = await access("index.html").catch(() => false);

			await viteBuildServer({
				client: hasClient ? "client" : undefined,
			});

			if (hasClient) {
				await viteBuildClient();
			}

			// Prevent the default build from running again
			process.exit(0);
		},
	};
}
