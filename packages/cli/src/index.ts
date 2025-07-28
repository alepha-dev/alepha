#!/usr/bin/env node

import { glob, readFile, writeFile } from "node:fs/promises";
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

			this.log.info("📂 Copying template files...");
			await run.cp(source, dest);

			await run("rename files", async () => {
				for await (const file of glob(`${dest}/**/*.txt`)) {
					const content = await readFile(file, "utf-8");
					await writeFile(
						file.replace(/\.txt$/, ""),
						await this.runTemplate(content),
					);
					await run.rm(file);
				}
			});

			// with emoji
			this.log.info("📦 Installing dependencies...");
			await run(`cd ${name} && npm install`);

			this.log.info(
				`🎉 Project created successfully!

\t$ cd ${name} && npm run dev
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
		LOG_LEVEL: "alepha:warn,info",
		LOG_FORMAT: "cli",
		CLI_NAME: "Alepha CLI",
		CLI_DESCRIPTION: "Create and manage Alepha projects.",
	},
});
