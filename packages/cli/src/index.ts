#!/usr/bin/env node

import { cp, glob, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $command } from "@alepha/command";
import { $logger, run, t } from "@alepha/core";
import pkg from "../package.json" with { type: "json" };

class AlephaCli {
	log = $logger();

	create = $command({
		name: "create",
		description: "Create a new Alepha project",
		flags: t.object({
			name: t.optional(t.string()),
		}),
		summary: false,
		handler: async ({ run, flags }) => {
			const name = flags.name ?? "my-alepha-project";
			const source = join(
				import.meta.dirname,
				"..",
				"assets",
				"templates",
				"default",
			);
			const dest = join(process.cwd(), name);

			await run("📂 Copying files", async () => {
				await cp(source, dest, { recursive: true });
				for await (const file of glob(`${dest}/**/*`, {
					withFileTypes: true,
				})) {
					if (file.isDirectory()) continue;
					const filepath = join(file.parentPath, file.name);
					const content = await readFile(filepath, "utf-8");
					await writeFile(filepath, await this.runTemplate(content));
				}
			});

			// with emoji
			await run(`cd ${name} && npm install`, undefined, {
				alias: "📦 Installing dependencies",
			});

			this.log.info(
				`\n🎉 Project created successfully!

  $ cd ${name} && npm run dev
`,
			);
		},
	});

	public async runTemplate(template: string) {
		// best template engine ever
		return template.replace(/{{\s*alepha.version\s*}}/g, pkg.version);
	}
}

run(AlephaCli, {
	env: {
		LOG_LEVEL: "alepha.core:warn,info",
		LOG_FORMAT: "raw",
		CLI_NAME: "alepha",
		CLI_DESCRIPTION: `Alepha CLI v${pkg.version} - Create and manage Alepha projects.`,
	},
});
