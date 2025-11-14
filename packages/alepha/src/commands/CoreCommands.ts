import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { $command, CliProvider } from "@alepha/command";
import { $inject, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { tsconfigJson } from "../assets/tsconfigJson.ts";
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
      yarn: t.optional(t.boolean({ description: "Use Yarn package manager" })),
      pnpm: t.optional(t.boolean({ description: "Use pnpm package manager" })),
      bun: t.optional(t.boolean({ description: "Use Bun package manager" })),
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

      await run(`npx degit feunard/alepha/apps/starter ${name}`, {
        alias: "Cloning repository",
      });

      // Remove .git directory to start fresh
      await run(`rm -rf ${name}/.git`, {
        alias: "Setting up project",
      });

      await run(`cd ${name} && ${installCmd}`, {
        alias: "Installing dependencies",
      });

      await run(`cd ${name} && npx alepha lint`, {
        alias: "Linting code",
      });

      await run(`cd ${name} && npx alepha typecheck`, {
        alias: "Type checking",
      });

      await run(`cd ${name} && npx alepha test`, {
        alias: "Running tests",
      });

      await run(`cd ${name} && npx alepha build`, {
        alias: "Building project",
      });

      this.log.info(
        `Project is ready!

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

  public readonly init = $command({
    name: "init",
    description: "Add missing Alepha configuration files to the project",
    flags: t.object({
      // TODO:
      // force: t.boolean({
      //   description: "If true, all config files will be overwritten",
      // }),
      yarn: t.boolean({ description: "Use Yarn package manager" }),
      api: t.boolean({ description: "Include Alepha Server dependencies" }),
      react: t.boolean({ description: "Include Alepha React dependencies" }),
    }),
    handler: async ({ run, flags }) => {
      const root = process.cwd();

      await this.ensureTsConfig(root);
      await this.ensurePackageJson(root, flags);

      if (flags.yarn) {
        await this.ensureYarn(root);
        await run("yarn", {
          alias: "Installing dependencies with Yarn",
        });
      } else {
        await run("npm install", {
          alias: "Installing dependencies with npm",
        });
      }
    },
  });

  public async ensureYarn(root: string) {
    const tsconfigPath = join(root, ".yarnrc.yml");
    try {
      await access(tsconfigPath);
    } catch {
      this.log.info("Missing .yarnrc.yml detected. Creating one...");
      await writeFile(tsconfigPath, "nodeLinker: node-modules");
    }
  }

  public generatePackageJsonContent(modes: { api?: boolean; react?: boolean }) {
    const dependencies: Record<string, string> = {
      "@alepha/core": `^${version}`,
      "@alepha/logger": `^${version}`,
      "@alepha/datetime": `^${version}`,
    };

    const devDependencies: Record<string, string> = {
      alepha: `^${version}`,
      "@alepha/vite": `^${version}`,
    };

    if (modes.api) {
      dependencies["@alepha/server"] = `^${version}`;
      dependencies["@alepha/server-swagger"] = `^${version}`;
      dependencies["@alepha/server-multipart"] = `^${version}`;
    }

    if (modes.react) {
      dependencies["@alepha/server"] = `^${version}`;
      dependencies["@alepha/server-links"] = `^${version}`;
      dependencies["@alepha/react"] = `^${version}`;
      dependencies.react = "^19.2.0";
      devDependencies["@types/react"] = "^19.0.0";
    }

    return {
      dependencies,
      devDependencies,
      scripts: {
        dev: "alepha dev",
        build: "alepha build",
      },
    };
  }

  public async ensurePackageJson(
    root: string,
    modes: { api?: boolean; react?: boolean },
  ) {
    const packageJsonPath = join(root, "package.json");
    try {
      await access(packageJsonPath);
    } catch (error) {
      this.log.info("No package.json found. Creating one...");
      await writeFile(
        packageJsonPath,
        JSON.stringify(this.generatePackageJsonContent(modes), null, 2),
      );
      return;
    }

    const content = await readFile(packageJsonPath, "utf8");
    const packageJson = JSON.parse(content);
    if (!packageJson.type || packageJson.type !== "module") {
      packageJson.type = "module";
    }
    const newPackageJson = this.generatePackageJsonContent(modes);

    packageJson.type = "module";
    packageJson.dependencies ??= {};
    packageJson.devDependencies ??= {};
    packageJson.scripts ??= {};

    Object.assign(packageJson.dependencies, newPackageJson.dependencies);
    Object.assign(packageJson.devDependencies, newPackageJson.devDependencies);
    Object.assign(packageJson.scripts, newPackageJson.scripts);

    await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  public async ensureTsConfig(root = process.cwd()) {
    const tsconfigPath = join(root, "tsconfig.json");
    try {
      await access(tsconfigPath);
    } catch {
      this.log.info("Missing tsconfig.json detected. Creating one...");
      await writeFile(tsconfigPath, tsconfigJson);
    }
  }
}
