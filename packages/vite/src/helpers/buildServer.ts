import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type * as vite from "vite";
import type { UserConfig } from "vite";
import { viteAlephaBuildVercel } from "../viteAlephaBuildVercel.ts";
import { importVite } from "./importVite.ts";

export interface BuildServerOptions {
	entry: string;
	distDir: string;
	clientDir?: string;
	vercel?: boolean;
	config?: UserConfig;
}

export const buildServer = async (opts: BuildServerOptions) => {
	const { build: viteBuild, mergeConfig } = await importVite();
	const plugins: any[] = [];

	if (opts.vercel) {
		const vercel = typeof opts.vercel === "boolean" ? {} : opts.vercel;
		plugins.push(
			viteAlephaBuildVercel({
				clientDir: opts.clientDir,
				distDir: opts.distDir,
				...vercel,
			}),
		);
	}

	const viteBuildServerConfig: UserConfig = {
		mode: "production",
		define: {
			"process.env.NODE_ENV": '"production"',
		},
		publicDir: false,
		ssr: {
			noExternal: true,
		},
		build: {
			ssr: opts.entry,
			outDir: `${opts.distDir}/server`,
			minify: false, // for now, we don't need to minify the server build
			rollupOptions: {
				output: {
					entryFileNames: "[hash].mjs",
					chunkFileNames: "[hash].mjs",
					assetFileNames: "[hash][extname]",
					format: "esm",
				},
			},
		},
		plugins,
	};

	const entryFilePath = join(process.cwd(), opts.entry).replace(/\\/g, "/");
	const result = await viteBuild(
		mergeConfig(viteBuildServerConfig, opts.config || {}),
	);

	const rollupOutput = (
		Array.isArray(result) ? result[0] : result
	) as vite.Rollup.RollupOutput;

	const indexFileName = rollupOutput.output.find(
		(it) => "facadeModuleId" in it && it.facadeModuleId === entryFilePath,
	)?.fileName;

	if (!indexFileName) {
		throw new Error(
			`Could not find the entry file "${entryFilePath}" in the build output. Please check your entry file and try again.`,
		);
	}

	let state = "";

	if (opts.clientDir) {
		const index = await readFile(
			`${opts.distDir}/${opts.clientDir}/index.html`,
			"utf-8",
		);

		state = `__alepha.state(\n\t"react.server.template", \n\t\`${index.replace(/>\s*</g, "><").trim()}\`\n);`;

		await unlink(`${opts.distDir}/${opts.clientDir}/index.html`);
	}

	const warning =
		"// ⚠️ This file was automatically generated. DO NOT MODIFY." +
		"\n" +
		"// Changes to this file will be lost when the code is regenerated.\n";

	const forceProduction = "process.env.NODE_ENV ??= 'production';\n";

	await writeFile(
		`${opts.distDir}/index.js`,
		`${warning}\n${forceProduction}\nimport'./server/${indexFileName}';\n\n${state}`.trim(),
	);
};
