import { $command, CliProvider } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";

export class AlephaCli {
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
		args: t.text({ title: "name" }),
		flags: t.object({
			yarn: t.boolean({ description: "Use Yarn package manager" }),
			pnpm: t.boolean({ description: "Use pnpm package manager" }),
			bun: t.boolean({ description: "Use Bun package manager" }),
		}),
		summary: false,
		handler: async ({ run, args, flags }) => {
			const name = args;

			// Determine package manager
			let installCmd = "npm install";
			let runCmd = "npm run";

			if (flags.yarn) {
				installCmd = "yarn";
				runCmd = "yarn";
			} else if (flags.pnpm) {
				installCmd = "pnpm install";
				runCmd = "pnpm";
			} else if (flags.bun) {
				installCmd = "bun install";
				runCmd = "bun run";
			}

			await run(`git clone https://github.com/feunard/alepha-starter ${name}`, {
				alias: "📥 Cloning repository",
			});

			// Remove .git directory to start fresh
			await run(`rm -rf ${name}/.git`, {
				alias: "🔧 Setting up project",
			});

			await run(`cd ${name} && ${installCmd}`, {
				alias: "📦 Installing dependencies",
			});

			await run(`cd ${name} && ${runCmd} lint`, {
				alias: "🔍 Linting code",
			});

			await run(`cd ${name} && ${runCmd} check`, {
				alias: "✅ Type checking",
			});

			await run(`cd ${name} && ${runCmd} test`, {
				alias: "🧪 Running tests",
			});

			await run(`cd ${name} && ${runCmd} build`, {
				alias: "🏗️ Building project",
			});

			this.log.info(
				`\n🎉 Project is ready!

$ cd ${name} && ${runCmd} dev
			`,
			);
		},
	});
}
