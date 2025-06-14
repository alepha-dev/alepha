import { existsSync, mkdirSync, writeFileSync } from "node:fs";
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
}

/**
 *
 */
export function viteAlephaBuildVercel(opts: ViteAlephaBuildVercelOptions = {}) {
	const clientDir = opts.clientDir ?? "public";
	const distDir = opts.distDir ?? "dist";

	return {
		name: "vite-plugin-alepha-build-vercel",
		apply: "build",
		writeBundle() {
			const env = loadEnv("production", process.cwd(), "");

			if (!existsSync(`${distDir}/api`)) {
				mkdirSync(`${distDir}/api`);
			}

			writeFileSync(
				`${distDir}/api/index.mjs`,
				`import "../index.mjs";

export default async function (req, res) {
\tawait __alepha.start();
\t__alepha.handle(req, res);
}
`,
			);

			writeFileSync(
				`${distDir}/vercel.json`,
				JSON.stringify(
					{
						env: {
							RUNTIME: "vercel",
						},
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
