#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $command, CliProvider } from "@alepha/command";
import { $inject, run, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import pkg from "../package.json" with { type: "json" };

class AlephaCli {
	log = $logger();

	cli = $inject(CliProvider);

	root = $command({
		name: "",
		handler: async () => {
			this.cli.printHelp();
		},
	});

	create = $command({
		name: "create",
		description: "Create a new Alepha project",
		args: t.string({ title: "name" }),
		summary: false,
		handler: async ({ run, args }) => {
			const name = args;

			await run(
				`git clone https://github.com/feunard/alepha-starter ${name}`,
				undefined,
				{ alias: "📥 Cloning repository" },
			);

			// Remove .git directory to start fresh
			await run(`rm -rf ${name}/.git`, undefined, {
				alias: "🔧 Setting up project",
			});

			const packageJsonPath = join(process.cwd(), name, "package.json");
			const packageJsonContent = await readFile(packageJsonPath, "utf-8");
			await writeFile(
				packageJsonPath,
				packageJsonContent.replace(
					/"alepha": "[^"]*"/,
					`"alepha": "^${pkg.version}"`,
				),
				"utf-8",
			);

			await run(`cd ${name} && npm install`, undefined, {
				alias: "📦 Installing dependencies",
			});

			await run(`cd ${name} && npm run lint`, undefined, {
				alias: "🔍 Linting code",
			});

			await run(`cd ${name} && npm run check`, undefined, {
				alias: "✅ Type checking",
			});

			await run(`cd ${name} && npm run test`, undefined, {
				alias: "🧪 Running tests",
			});

			await run(`cd ${name} && npm run build`, undefined, {
				alias: "🏗️ Building project",
			});

			this.log.info(
				`\n🎉 Project is ready!

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
