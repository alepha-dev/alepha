import { cp, writeFile } from "node:fs/promises";
import { fileExists } from "./helpers/fileExists.ts";

export interface ViteAlephaBuildDockerOptions {
	/**
	 * The directory where the build output will be placed.
	 *
	 * @default "dist"
	 */
	distDir?: string;

	/**
	 * Image name to use in the Dockerfile.
	 * If not provided, it will default to `node:24-alpine`.
	 */
	image?: string;

	/**
	 * Command to run in the Docker container.
	 * If not provided, it will default to `node`.
	 */
	command?: string;
}

export async function viteAlephaBuildDocker(
	opts: ViteAlephaBuildDockerOptions = {},
) {
	const distDir = opts.distDir ?? "dist";
	const image = opts.image ?? "node:24-alpine";
	const command = opts.command ?? "node";

	const hasMigrations = await fileExists(`drizzle`);
	if (hasMigrations) {
		await cp("drizzle", `${distDir}/drizzle`, {
			recursive: true,
		});
	}

	return {
		name: "alepha-vercel",
		apply: "build",
		async writeBundle() {
			const dockerfile = `# ⚠️ This file was automatically generated. DO NOT MODIFY.
# Changes to this file will be lost when the code is regenerated.
FROM ${image}
WORKDIR /app

COPY . .

CMD ["${command}", "index.js"]
`;
			await writeFile(`${distDir}/Dockerfile`, dockerfile);
		},
	};
}
