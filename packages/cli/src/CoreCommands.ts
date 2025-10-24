import "tsx";
import { spawn } from "node:child_process";
import { $command, CliProvider } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";

export class CoreCommands {
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

  run = $command({
    name: "run",
    description: "Run a TypeScript file directly",
    flags: t.object({
      watch: t.optional(
        t.boolean({ description: "Watch file for changes", alias: "w" }),
      ),
    }),
    summary: false,
    args: t.text({ title: "path", description: "Filepath to run" }),
    handler: async ({ args, flags, run }) => {
      const filePath = args;
      const watchFlag = flags.watch ? "--watch" : "";

      // Find tsx binary - it should be in node_modules/.bin
      // Using tsx directly since it's imported at the top of the file
      const tsxCmd = watchFlag
        ? `npx tsx ${watchFlag} ${filePath}`
        : `npx tsx ${filePath}`;

      const tsxArgs = flags.watch ? ["--watch", filePath] : [filePath];
      const tsx = spawn("npx", ["tsx", ...tsxArgs], {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      await new Promise<void>((resolve) =>
        tsx.on("exit", (code) => {
          resolve();
        }),
      );
    },
  });

  dev = $command({
    name: "dev",
    summary: false,
    handler: async () => {
      const tsx = spawn("npx", ["vite"], {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      await new Promise<void>((resolve) =>
        tsx.on("exit", () => {
          resolve();
        }),
      );
    },
  });

  build = $command({
    name: "build",
    summary: false,
    handler: async () => {
      const tsx = spawn("npx", ["vite", "build"], {
        stdio: "inherit",
        cwd: process.cwd(),
      });

      await new Promise<void>((resolve) =>
        tsx.on("exit", () => {
          resolve();
        }),
      );
    },
  });
}
