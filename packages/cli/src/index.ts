#!/usr/bin/env node
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

			await run(`git clone https://github.com/feunard/alepha-starter ${name}`, {
				alias: "📥 Cloning repository",
			});

			// Remove .git directory to start fresh
			await run(`rm -rf ${name}/.git`, {
				alias: "🔧 Setting up project",
			});

			await run(`cd ${name} && npm install`, {
				alias: "📦 Installing dependencies",
			});

			await run(`cd ${name} && npm run lint`, {
				alias: "🔍 Linting code",
			});

			await run(`cd ${name} && npm run check`, {
				alias: "✅ Type checking",
			});

			await run(`cd ${name} && npm run test`, {
				alias: "🧪 Running tests",
			});

			await run(`cd ${name} && npm run build`, {
				alias: "🏗️ Building project",
			});

			this.log.info(
				`\n🎉 Project is ready!

$ cd ${name} && npm run dev
			`,
			);
		},
	});
}

run(AlephaCli, {
	env: {
		LOG_LEVEL: "alepha.core:warn,info",
		LOG_FORMAT: "raw",
		CLI_NAME: "alepha",
		CLI_DESCRIPTION: `Alepha CLI v${pkg.version} - Create and manage Alepha projects.`,
	},
});
