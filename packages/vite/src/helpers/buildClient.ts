import { parse } from "node-html-parser";
import type { UserConfig } from "vite";
import { viteCompress } from "../viteCompress.ts";
import { importVite } from "./importVite.ts";
import { prerender } from "./prerender.ts";

export interface BuildClientOptions {
	dist: string;
	html: string;
	prerender?: boolean;
}

export const buildClient = async (opts: BuildClientOptions) => {
	const { build: viteBuild } = await importVite();
	const plugins: any[] = [];

	plugins.push(viteCompress());

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

	const root = parse(opts.html);
	const script = root.querySelector('script[type="module"]');
	const entry = script?.getAttribute("src");
	if (entry) {
		await prerender({
			entry,
			dist: opts.dist,
			all: !!opts.prerender,
		});
	}
};
