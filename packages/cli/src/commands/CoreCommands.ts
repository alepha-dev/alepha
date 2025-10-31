import { $command, CliProvider } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { version } from "../version.ts";

export class CoreCommands {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);

  public readonly root = $command({
    root: true,
    flags: t.object({
      version: t.optional(
        t.boolean({
          description: "Show Alepha CLI version",
          aliases: ["v"],
        }),
      ),
    }),
    handler: async ({ flags }) => {
      if (flags.version) {
        this.log.info(version);
        return;
      }

      this.cli.printHelp();
    },
  });

  public readonly create = $command({
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

      let installCmd = "npm install";
      if (flags.yarn) {
        installCmd = "yarn";
      } else if (flags.pnpm) {
        installCmd = "pnpm install";
      } else if (flags.bun) {
        installCmd = "bun install";
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

      await run(`cd ${name} && npx alepha lint`, {
        alias: "🔍 Linting code",
      });

      await run(`cd ${name} && npx alepha typecheck`, {
        alias: "✅ Type checking",
      });

      await run(`cd ${name} && npx alepha test`, {
        alias: "🧪 Running tests",
      });

      await run(`cd ${name} && npx alepha build`, {
        alias: "🏗️ Building project",
      });

      this.log.info(
        `\n🎉 Project is ready!

$ cd ${name} && npx alepha dev
			`,
      );
    },
  });

  public readonly clean = $command({
    name: "clean",
    description: "Clean the project",
    handler: async ({ run }) => {
      await run.rm("./dist");
    },
  });
}
