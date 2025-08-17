import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { importVite } from "./helpers/importVite.ts";

export interface ViteAlephaBuildVercelOptions {
	/**
	 * The directory where the build output will be placed.
	 *
	 * @default "dist"
	 */
	distDir?: string;

	/**
	 * The name of the client directory.
	 *
	 * @default "public"
	 */
	clientDir?: string;

	config?: VercelConfig;
}

export interface VercelConfig {
	projectName?: string;
	orgId?: string;
	projectId?: string;
	crons?: Array<{
		path: string;
		schedule: string;
	}>;
}

export async function viteAlephaBuildVercel(
	opts: ViteAlephaBuildVercelOptions = {},
) {
	const distDir = opts.distDir ?? "dist";
	const clientDir = opts.clientDir ?? "public";
	const { loadEnv } = await importVite();

	const warning =
		"// ⚠️ This file was automatically generated. DO NOT MODIFY." +
		"\n" +
		"// Changes to this file will be lost when the code is regenerated.\n";

	return {
		name: "alepha-vercel",
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

// This file is the entry point for Vercel serverless functions.
export default async function (req, res) {
\tawait __alepha.start();
\t__alepha.emit("node:request", { req, res });
}
`,
			);

			// always generate a vercel.json file
			writeFileSync(
				`${distDir}/vercel.json`,
				JSON.stringify(
					{
						crons: opts.config?.crons,
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
			const projectId = env.VERCEL_PROJECT_ID ?? opts.config?.projectId;
			const projectName = env.VERCEL_PROJECT_NAME ?? opts.config?.projectName;
			const orgId = env.VERCEL_ORG_ID ?? opts.config?.orgId;

			if (projectId && orgId) {
				try {
					mkdirSync(`${distDir}/.vercel`, { recursive: true });
				} catch (_e) {
					// ignore error if directory already exists
				}

				writeFileSync(
					`${distDir}/.vercel/project.json`,
					JSON.stringify(
						{
							projectId,
							projectName,
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
