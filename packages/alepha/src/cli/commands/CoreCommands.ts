import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { $inject, t } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import { ProjectUtils } from "../services/ProjectUtils.ts";
import { version } from "../version.ts";

export class CoreCommands {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);
  protected readonly utils = $inject(ProjectUtils);

  /**
   * Called when no command is provided
   */
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

  /**
   * Create a new Alepha project based on one of the sample projects (for now, only one sample project is available)
   */
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
    handler: async ({ run, args, flags, root }) => {
      const name = args;
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
        this.utils.downloadSampleProject(dest),
      );

      if (flags.yarn) {
        await this.utils.ensureYarn(dest);
        await run(`cd ${name} && yarn set version stable`, {
          alias: "Setting Yarn to stable version",
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
      this.log.info(`$ cd ${name} && ${execCmd} alepha dev`.trim());
      this.log.info("");
    },
  });

  /**
   * Clean the project, removing the "dist" directory
   */
  public readonly clean = $command({
    name: "clean",
    description: "Clean the project",
    handler: async ({ run }) => {
      await run.rm("./dist");
    },
  });

  /**
   * Ensure the project has the necessary Alepha configuration files.
   * Add the correct dependencies to package.json and install them.
   */
  public readonly init = $command({
    name: "init",
    description: "Add missing Alepha configuration files to the project",
    flags: t.object({
      // TODO:
      // force: t.boolean({
      //   description: "If true, all config files will be overwritten",
      // }),
      // choose package manager
      yarn: t.optional(t.boolean({ description: "Use Yarn package manager" })),
      // choose which dependencies to add
      api: t.optional(
        t.boolean({ description: "Include Alepha Server dependencies" }),
      ),
      react: t.optional(
        t.boolean({ description: "Include Alepha React dependencies" }),
      ),
      orm: t.optional(
        t.boolean({ description: "Include Alepha ORM dependencies" }),
      ),
    }),
    handler: async ({ run, flags, root }) => {
      await run("Ensuring Alepha configuration files", async () => {
        await this.utils.ensureTsConfig(root);
        await this.utils.ensurePackageJson(root, flags);
      });

      if (flags.yarn) {
        await this.utils.ensureYarn(root);
        await run("yarn install", {
          alias: "Installing dependencies with Yarn",
        });
      } else {
        await run("npm install", {
          alias: "Installing dependencies with npm",
        });
      }
    },
  });
}
