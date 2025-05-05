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
	const client = opts.client;

	return {
		name: "vite-plugin-alepha-build-vercel",
		apply: "build",
		writeBundle() {
			if (!existsSync("dist/api")) {
				mkdirSync("dist/api");
			}

			const templateState = client
				? `alepha.state("ReactServerProvider.template", \`${readFileSync(`dist/${client}/index.html`, "utf-8")}\`);`
				: "";

			writeFileSync(
				"dist/api/index.mjs",
				`import "../server/${outputFile}.mjs";

${templateState}

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
			if (client) {
				unlinkSync("dist/client/index.html");
			}
		},
	};
}
