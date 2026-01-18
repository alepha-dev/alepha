import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/file";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class InitCommand {
  protected readonly utils = $inject(AlephaCliUtils);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly scaffolder = $inject(ProjectScaffolder);
  protected readonly fs = $inject(FileSystemProvider);

  /**
   * Ensure the project has the necessary Alepha configuration files.
   * Add the correct dependencies to package.json and install them.
   */
  public readonly init = $command({
    name: "init",
    description: "Add missing Alepha configuration files to the project",
    args: t.optional(
      t.text({
        title: "path",
        trim: true,
        lowercase: true,
      }),
    ),
    flags: t.object({
      agent: t.optional(
        t.boolean({
          aliases: ["a"],
          description: "Add CLAUDE.md for Claude Code AI assistant",
        }),
      ),
      // choose package manager
      yarn: t.optional(t.boolean({ description: "Use Yarn package manager" })),
      pnpm: t.optional(t.boolean({ description: "Use pnpm package manager" })),
      npm: t.optional(t.boolean({ description: "Use npm package manager" })),
      bun: t.optional(t.boolean({ description: "Use Bun package manager" })),
      // choose which dependencies to add
      web: t.optional(
        t.boolean({
          aliases: ["r"],
          description: "Include Alepha React dependencies",
        }),
      ),
      admin: t.optional(
        t.boolean({ description: "Include Alepha UI dependencies" }),
      ),
      test: t.optional(
        t.boolean({ description: "Include Vitest and create test directory" }),
      ),
    }),
    handler: async ({ run, flags, root, args }) => {
      if (flags.admin) {
        flags.web = true;
      }

      if (args) {
        root = this.fs.join(root, args);
        await this.fs.mkdir(root);
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
            indexHtml: !!flags.web && !isExpo,
            claudeMd: flags.agent
              ? { react: !!flags.web, ui: !!flags.admin }
              : false,
          });

          // Create API project structure if not React
          if (!flags.web) {
            await this.scaffolder.ensureApiProject(root);
          }
        },
      });

      // TODO: check if all alepha dependencies are same version

      const pmName = await this.pm.getPackageManager(root, flags);
      if (pmName === "yarn") {
        await this.pm.ensureYarn(root);
        await run("yarn set version stable", { root });
      } else if (pmName === "bun") {
        await this.pm.ensureBun(root);
      } else if (pmName === "pnpm") {
        await this.pm.ensurePnpm(root);
      } else {
        await this.pm.ensureNpm(root);
      }

      await run(`${pmName} install`, {
        alias: `installing dependencies with ${pmName}`,
        root,
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

      await run(`${pmName} run lint`, {
        alias: "running linter",
        root,
      });
    },
  });
}
