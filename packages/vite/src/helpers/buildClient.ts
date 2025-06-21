import { promisify } from "node:util";
import { brotliCompress } from "node:zlib";
import gzipPlugin from "rollup-plugin-gzip";
import type { UserConfig } from "vite";
import { importVite } from "./importVite.ts";
import { prerender } from "./prerender.ts";

const brotliPromise = promisify(brotliCompress);

export interface BuildClientOptions {
	dist: string;
	prerender?: boolean;
}

export const buildClient = async (opts: BuildClientOptions) => {
	const { build: viteBuild } = await importVite();
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
			outDir: opts.dist,
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

	await prerender({
		entry: "src/index.ts",
		dist: opts.dist,
		all: !!opts.prerender,
	});
};
