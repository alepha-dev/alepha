import type { UserConfig } from "vite";
import { type ViteCompressOptions, viteCompress } from "../viteCompress.ts";
import { vitePrerender } from "../vitePrerender.ts";
import { importVite } from "./importVite.ts";

export interface BuildClientOptions {
	dist: string;
	html: string;

	/**
	 * @default {}
	 */
	compress?: ViteCompressOptions | boolean;

	/**
	 * @default true
	 */
	prerender?: boolean;
}

export const buildClient = async (opts: BuildClientOptions) => {
	const { build: viteBuild } = await importVite();
	const plugins: any[] = [];

	const compressOptions: ViteCompressOptions | undefined =
		opts.compress === false
			? undefined
			: typeof opts.compress === "object"
				? opts.compress
				: {};

	if (opts.prerender !== false) {
		plugins.push(
			vitePrerender({
				...opts,
				compress: compressOptions,
			}),
		);
	}

	if (compressOptions) {
		plugins.push(viteCompress(compressOptions));
	}

	const viteBuildClientConfig: UserConfig = {
		mode: "production",
		define: {
			"process.env.NODE_ENV": '"production"',
		},
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
};
