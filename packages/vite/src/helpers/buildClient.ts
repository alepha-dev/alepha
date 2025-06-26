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

	const entry = extractFirstModuleScriptSrc(opts.html);
	if (entry) {
		await prerender({
			entry,
			dist: opts.dist,
			all: !!opts.prerender,
		});
	}
};

function extractFirstModuleScriptSrc(html: string): string | null {
	const scriptRegex = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
	let match: RegExpExecArray | null = scriptRegex.exec(html);

	while (match) {
		const tag = match[0];

		// Check for type="module"
		if (/type=["']module["']/i.test(tag)) {
			// Extract the src value
			const srcMatch = tag.match(/\bsrc=["']([^"']+)["']/i);
			return srcMatch?.[1] ?? null;
		}

		match = scriptRegex.exec(html);
	}

	return null;
}
