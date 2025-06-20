import { access, readFile, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress } from "node:zlib";
import gzipPlugin from "rollup-plugin-gzip";
import type * as vite from "vite";
import { mergeConfig, type Plugin, type UserConfig } from "vite";
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
	 * If true, the build will be optimized for Vercel deployment.
	 *
	 * If `VERCEL_PROJECT_ID` and `VERCEL_ORG_ID` environment variables are set, .vercel will be generated with the correct configuration.
	 *
	 * @default false
	 */
	vercel?:
		| boolean
		| {
				name?: string; // The name of the Vercel project
		  };

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
	const entry = options.entry || "src/index.ts";
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

		const viteBuildClientConfig: UserConfig = {
			publicDir: "public",
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
		};

		await viteBuild(viteBuildClientConfig);
	};

	const viteBuildServer = async (opts: { clientDir?: string }) => {
		const plugins: any[] = [];

		if (options.vercel) {
			const vercel = typeof options.vercel === "boolean" ? {} : options.vercel;
			plugins.push(
				viteAlephaBuildVercel({
					clientDir: opts.clientDir,
					distDir: distDir,
					...vercel,
				}),
			);
		}

		const viteBuildServerConfig: UserConfig = {
			publicDir: false,
			ssr: {
				noExternal: true,
			},
			build: {
				ssr: entry,
				outDir: `${distDir}/server`,
				rollupOptions: {
					output: {
						entryFileNames: "[hash].mjs",
						chunkFileNames: "[hash].mjs",
						assetFileNames: "[hash][extname]",
						format: "esm",
					},
				},
			},
			resolve: {
				alias: {
					"pg-cloudflare": "pg", // skip pg-cloudflare for now, not supported in noExternal mode
				},
			},
			plugins,
		};

		const result = await viteBuild(
			mergeConfig(viteBuildServerConfig, options.server || {}),
		);

		const rollupOutput = (
			Array.isArray(result) ? result[0] : result
		) as vite.Rollup.RollupOutput;

		const entryFilePath = join(process.cwd(), entry);
		const indexFileName = rollupOutput.output.find(
			(it) => "facadeModuleId" in it && it.facadeModuleId === entryFilePath,
		)?.fileName;

		let state = "";

		if (opts.clientDir) {
			const index = await readFile(
				`${distDir}/${opts.clientDir}/index.html`,
				"utf-8",
			);

			state = `__alepha.state(\n\t"ReactServerProvider.template", \n\t\`${index.replace(/>\s*</g, "><").trim()}\`\n);`;

			await unlink(`${distDir}/${opts.clientDir}/index.html`);
		}

		const warning =
			"// ⚠️ This file was automatically generated. DO NOT MODIFY." +
			"\n" +
			"// Changes to this file will be lost when the code is regenerated.\n";

		await writeFile(
			`${distDir}/index.mjs`,
			`${warning}\nimport'./server/${indexFileName}';\n\n${state}`.trim(),
		);
	};

	return {
		name: "vite-plugin-alepha-build",
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

			const hasServer = await access(join(process.cwd(), entry))
				.then(() => true)
				.catch(() => false);

			const hasClient = await access(join(process.cwd(), "index.html"))
				.then(() => true)
				.catch(() => false);

			if (hasClient) {
				await viteBuildClient();
			}

			if (hasServer) {
				await viteBuildServer({
					clientDir: hasClient ? clientDir : undefined,
				});
			}

			// prevent the default build from running again
			process.exit(0);
		},
	};
}

const importVite = async (): Promise<typeof vite> => {
	try {
		// try to import rolldown-vite first, as it is a more optimized version of Vite
		return createRequire(import.meta.url)("rolldown-vite");
	} catch (_error) {
		console.warn(
			"Using Vite instead of rolldown-vite. Please install rolldown-vite for better performance.",
		);
		try {
			return createRequire(import.meta.url)("vite");
		} catch (_error) {
			throw new Error(
				"Vite is not installed. Please install it with `npm install vite` or `npm install rolldown-vite`.",
			);
		}
	}
};
