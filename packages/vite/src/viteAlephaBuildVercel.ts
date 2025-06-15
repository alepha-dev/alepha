import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { loadEnv } from "vite";

export interface ViteAlephaBuildVercelOptions {
	/**
	 * The name of the client directory.
	 */
	clientDir?: string;

	/**
	 * The directory where the build output will be placed.
	 */
	distDir?: string;

	/**
	 * The name of the project.
	 */
	projectName?: string;
}

/**
 *
 */
export function viteAlephaBuildVercel(opts: ViteAlephaBuildVercelOptions = {}) {
	const clientDir = opts.clientDir ?? "public";
	const distDir = opts.distDir ?? "dist";

	// project name is "dist" by default, we use the current working directory name if not specified
	const projectName = opts.projectName ?? basename(process.cwd());

	const warning =
		"// ⚠️ This file was automatically generated. DO NOT MODIFY." +
		"\n" +
		"// Changes to this file will be lost when the code is regenerated.\n";

	return {
		name: "vite-plugin-alepha-build-vercel",
		apply: "build",
		writeBundle() {
			const env = loadEnv("production", process.cwd(), "");

			// ensure the api directory exists
			if (!existsSync(`${distDir}/api`)) {
				mkdirSync(`${distDir}/api`);
			}

			// add the only one entry point for Vercel
			writeFileSync(
				`${distDir}/api/index.mjs`,
				`${warning}\nimport "../index.mjs";

export default async function (req, res) {
\tawait __alepha.start();
\t__alepha.handle(req, res);
}
`,
			);

			// always generate a vercel.json file
			writeFileSync(
				`${distDir}/vercel.json`,
				JSON.stringify(
					{
						name: projectName,
						rewrites: [
							{
								source: "/(.*)",
								destination: "/api/index.mjs",
							},
						],
						buildCommand: "",
						installCommand: "",
						outputDirectory: clientDir,
					},
					null,
					"  ",
				),
			);

			// generate .vercel/project.json if VERCEL_PROJECT_ID and VERCEL_ORG_ID are set
			const projectId = env.VERCEL_PROJECT_ID;
			const orgId = env.VERCEL_ORG_ID;
			if (projectId && orgId) {
				try {
					mkdirSync(`${distDir}/.vercel`, { recursive: true });
				} catch (e) {
					// ignore error if directory already exists
				}

				writeFileSync(
					`${distDir}/.vercel/project.json`,
					JSON.stringify(
						{
							projectId,
							orgId,
						},
						null,
						"  ",
					),
				);
			}
		},
	};
}
