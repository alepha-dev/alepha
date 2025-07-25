import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Alepha } from "@alepha/core";
import {
	$page,
	type PageDescriptor,
	type PageDescriptorRenderOptions,
} from "@alepha/react";
import type { Plugin, UserConfig } from "vite";
import { importAlepha } from "./helpers/importAlepha.ts";
import { compressFile, type ViteCompressOptions } from "./viteCompress.ts";

export interface VitePrerenderOptions {
	dist: string;
	html: string;
	compress?: ViteCompressOptions;
	config?: UserConfig;
}

export function vitePrerender(opts: VitePrerenderOptions): Plugin {
	return {
		name: "prerender",
		apply: "build",
		async writeBundle() {
			const now = Date.now();
			try {
				const entry = extractFirstModuleScriptSrc(opts.html);
				if (entry) {
					const { alepha } = await importAlepha(entry, opts.config ?? {});

					alepha.state(
						"react.server.template",
						await readFile(`${opts.dist}/index.html`, "utf-8").catch(() => ""),
					);

					const stats = await prerenderFromAlepha(
						alepha,
						opts.dist,
						opts.compress,
					);

					this.info(
						`Pre-rendered ${stats.count} page${stats.count > 1 ? "s" : ""} in ${Date.now() - now}ms.`,
					);
				}
			} catch (error) {
				console.warn(new Error("Prerendering has failed", { cause: error }));
			}
		},
	};
}

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

async function prerenderFromAlepha(
	alepha: Alepha,
	dist: string,
	compress?: ViteCompressOptions,
): Promise<{ count: number }> {
	let count = 0;
	const pages = alepha.descriptors($page);

	for (const page of pages) {
		const options = page.options;

		if (options.children) {
			continue;
		}

		if (!options.static) {
			continue;
		}

		const config = typeof options.static === "object" ? options.static : {};

		if (!options.schema?.params) {
			count += 1;
			await renderFile(page, {}, dist, compress);
			continue;
		}

		if (config.entries) {
			for (const entry of config.entries) {
				count += 1;
				await renderFile(page, entry, dist, compress);
			}
		}
	}

	return { count };
}

async function renderFile(
	page: PageDescriptor,
	options: PageDescriptorRenderOptions,
	dist: string,
	compress?: ViteCompressOptions,
) {
	const { html, context } = await page.render({
		html: true,
		...options,
	});

	const pathname = context.url.pathname;
	const filepath = `${dist}${pathname === "/" ? "/index" : pathname}.html`;

	await mkdir(filepath.substring(0, filepath.lastIndexOf("/")), {
		recursive: true,
	});

	await writeFile(filepath, html);

	if (compress) {
		await compressFile(compress, filepath);
	}
}
