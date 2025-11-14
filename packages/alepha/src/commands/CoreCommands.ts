import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { $command, CliProvider } from "@alepha/command";
import { $inject, AlephaError, t } from "@alepha/core";
import { $logger } from "@alepha/logger";
import { pipeline } from "stream/promises";
import * as tar from "tar";
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
    aliases: ["new"],
    args: t.text({
      title: "name",
    }),
    flags: t.object({
      yarn: t.optional(t.boolean({ description: "Use Yarn package manager" })),
      pnpm: t.optional(t.boolean({ description: "Use pnpm package manager" })),
    }),
    summary: false,
    handler: async ({ run, args, flags }) => {
      const name = args;
      const root = process.cwd();
      const dest = join(root, name);

      try {
        await access(dest);
        this.log.error(
          `Directory "${name}" already exists. Please choose a different project name.`,
        );
        return;
      } catch {
        // Directory does not exist, proceed
      }

      let installCmd = "npm install";
      let execCmd = "npx";
      if (flags.yarn) {
        installCmd = "yarn";
        execCmd = "yarn";
      } else if (flags.pnpm) {
        installCmd = "pnpm install";
        execCmd = "pnpm";
      }

      await mkdir(dest, { recursive: true }).catch(() => null);

      await run("Downloading sample project", () =>
        this.downloadSampleProject(dest),
      );

      if (flags.yarn) {
        await this.ensureYarn(dest);
        await run(`cd ${name} &&yarn init -2`, {
          alias: "Init Yarn",
        });
      }

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

      this.log.info("");
      this.log.info(
        `🎉 Project is ready! You can now start developing your Alepha project:

$ cd ${name} && ${execCmd} alepha dev
			`.trim(),
      );
      this.log.info("");
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

  public async downloadSampleProject(targetDir: string) {
    const url = "https://api.github.com/repos/feunard/alepha/tarball/main";
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Alepha-CLI", // GitHub API requires User-Agent
      },
    });

    if (!response.ok) {
      throw new AlephaError(`Failed to download: ${response.statusText}`);
    }

    const tarStream = Readable.fromWeb(response.body as any);
    await pipeline(
      tarStream,
      tar.extract({
        cwd: targetDir, // Extract to target directory
        strip: 3, // Remove feunard-alepha-<hash>/apps/starter prefix
        filter: (path) => {
          // Only extract files from apps/starter/
          const parts = path.split("/");
          return (
            parts.length >= 3 && parts[1] === "apps" && parts[2] === "starter"
          );
        },
      }),
    );
  }
}
