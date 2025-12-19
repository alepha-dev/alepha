import { $inject, t } from "alepha";
import { $command, CliProvider } from "alepha/command";
import { $logger } from "alepha/logger";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { version } from "../version.ts";

export class CoreCommands {
  protected readonly log = $logger();
  protected readonly cli = $inject(CliProvider);
  protected readonly utils = $inject(AlephaCliUtils);

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
      // choose package manager
      yarn: t.optional(t.boolean({ description: "Use Yarn package manager" })),
      pnpm: t.optional(t.boolean({ description: "Use pnpm package manager" })),
      npm: t.optional(t.boolean({ description: "Use npm package manager" })),
      bun: t.optional(t.boolean({ description: "Use Bun package manager" })),
      // choose which dependencies to add
      react: t.optional(
        t.boolean({ description: "Include Alepha React dependencies" }),
      ),
      ui: t.optional(
        t.boolean({ description: "Include Alepha UI dependencies" }),
      ),
      test: t.optional(
        t.boolean({ description: "Include Vitest and create test directory" }),
      ),
    }),
    handler: async ({ run, flags, root }) => {
      if (flags.ui) {
        flags.react = true;
      }

      const isExpo = await this.utils.hasExpo(root);

      await run({
        name: "ensuring configuration files",
        handler: async () => {
          await this.utils.ensureConfig(root, {
            tsconfigJson: true,
            packageJson: flags,
            biomeJson: true,
            viteConfigTs: !isExpo,
            editorconfig: true,
            indexHtml: !!flags.react && !isExpo,
          });

          // Create src/main.ts if src directory is empty or doesn't exist
          if (!flags.react) {
            await this.utils.ensureSrcMain(root);
          }
        },
      });

      // TODO: check if all alepha dependencies are same version

      const pm = await this.utils.getPackageManager(root, flags);
      if (pm === "yarn") {
        await this.utils.ensureYarn(root);
        await run("yarn set version stable");
      } else if (pm === "pnpm") {
        await this.utils.ensurePnpm(root);
      } else {
        await this.utils.ensureNpm(root);
      }

      await run(`${pm} install`, {
        alias: `installing dependencies with ${pm}`,
      });

      if (!isExpo) {
        await this.utils.ensureDependency(root, "vite", { run });
      }

      await this.utils.ensureDependency(root, "@biomejs/biome", { run });

      // Install vitest and create test directory if --test flag is set
      if (flags.test) {
        await this.utils.ensureTestDir(root);
        await run(`${pm} ${pm === "yarn" ? "add" : "install"} -D vitest`, {
          alias: "setup testing with Vitest",
        });
      }
    },
  });
}
