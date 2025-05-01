import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";

export interface ViteAlephaBuildVercelOptions {
	/**
	 * The name of the output file.
	 *
	 * @default 'index'
	 */
	filename?: string;

	/**
	 * The name of the client directory.
	 *
	 * @default 'client'
	 */
	client?: string;
}

/**
 *
 */
export function viteAlephaBuildVercel(opts: ViteAlephaBuildVercelOptions = {}) {
	const outputFile = opts.filename;
	const client = opts.client || "client";

	return {
		name: "vite-plugin-alepha-build-vercel",
		apply: "build",
		writeBundle() {
			if (!existsSync("dist/api")) {
				mkdirSync("dist/api");
			}

			writeFileSync(
				"dist/api/index.mjs",
				`import "../server/${outputFile}.mjs";

alepha.state("ReactServerProvider.template", \`${readFileSync(`dist/${client}/index.html`, "utf-8")}\`);

export default async function (req, res) {
\tawait alepha.start();
\talepha.handle(req, res);
}
`,
			);

			writeFileSync(
				"dist/vercel.json",
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
						outputDirectory: client,
					},
					null,
					"  ",
				),
			);

			// for now, I don't know how to override /index.html by / on vercel, so we delete it
			unlinkSync("dist/client/index.html");
		},
	};
}
