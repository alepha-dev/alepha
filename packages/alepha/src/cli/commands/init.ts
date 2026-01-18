import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class InitCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);

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
      agent: t.optional(
        t.boolean({
          description: "Add CLAUDE.md for Claude Code AI assistant",
        }),
      ),
    }),
    handler: async ({ run, flags, root }) => {
      if (flags.ui) {
        flags.react = true;
      }

      const isExpo = await this.pm.hasExpo(root);

      await run({
        name: "ensuring configuration files",
        handler: async () => {
          await this.scaffolder.ensureConfig(root, {
            tsconfigJson: true,
            packageJson: flags,
            biomeJson: true,
            editorconfig: true,
            indexHtml: !!flags.react && !isExpo,
            claudeMd: flags.agent
              ? { react: !!flags.react, ui: !!flags.ui }
              : false,
          });

          // Create API project structure if not React
          if (!flags.react) {
            await this.scaffolder.ensureApiProject(root);
          }
        },
      });

      // TODO: check if all alepha dependencies are same version

      const pmName = await this.pm.getPackageManager(root, flags);
      if (pmName === "yarn") {
        await this.pm.ensureYarn(root);
        await run("yarn set version stable");
      } else if (pmName === "bun") {
        await this.pm.ensureBun(root);
      } else if (pmName === "pnpm") {
        await this.pm.ensurePnpm(root);
      } else {
        await this.pm.ensureNpm(root);
      }

      await run(`${pmName} install`, {
        alias: `installing dependencies with ${pmName}`,
      });

      if (!isExpo) {
        await this.pm.ensureDependency(root, "vite", {
          run,
          exec: (cmd, opts) => this.utils.exec(cmd, opts),
        });
      }

      await this.pm.ensureDependency(root, "@biomejs/biome", {
        run,
        exec: (cmd, opts) => this.utils.exec(cmd, opts),
      });

      // Install vitest and create test directory if --test flag is set
      if (flags.test) {
        await this.scaffolder.ensureTestDir(root);
        await run(
          `${pmName} ${pmName === "yarn" ? "add" : "install"} -D vitest`,
          {
            alias: "setup testing with Vitest",
          },
        );
      }
    },
  });
}
