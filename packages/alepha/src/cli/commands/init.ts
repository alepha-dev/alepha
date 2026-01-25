import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { FileSystemProvider } from "alepha/system";
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
          description:
            "Add AI agent instructions (CLAUDE.md if claude CLI installed, else AGENTS.md)",
        }),
      ),
      pm: t.optional(
        t.enum(["yarn", "npm", "pnpm", "bun"], {
          description: "Package manager to use",
        }),
      ),
      // choose which dependencies to add
      react: t.optional(
        t.boolean({
          aliases: ["r"],
          description: "Include Alepha React dependencies",
        }),
      ),
      ui: t.optional(
        t.boolean({ description: "Include Alepha UI dependencies" }),
      ),
      test: t.optional(
        t.boolean({ description: "Include Vitest and create test directory" }),
      ),
      force: t.optional(
        t.boolean({
          aliases: ["f"],
          description: "Override existing files",
        }),
      ),
    }),
    handler: async ({ run, flags, root, args }) => {
      if (flags.react) {
        flags.ui = true;
      }

      if (args) {
        root = this.fs.join(root, args);
        await this.fs.mkdir(root);
      }

      // Detect agent type: claude CLI → CLAUDE.md, else → AGENTS.md
      let agentType: "claude" | "agents" | false = false;
      if (flags.agent) {
        const hasClaudeCli = await this.utils.isInstalledAsync("claude");
        agentType = hasClaudeCli ? "claude" : "agents";
      }

      const isExpo = await this.pm.hasExpo(root);

      const force = !!flags.force;

      await run({
        name: "ensuring configuration files",
        handler: async () => {
          await this.scaffolder.ensureConfig(root, {
            force,
            tsconfigJson: true,
            packageJson: flags,
            biomeJson: true,
            editorconfig: true,
            indexHtml: !!flags.react && !isExpo,
            agentMd: agentType
              ? { type: agentType, react: !!flags.react, ui: !!flags.ui }
              : false,
          });

          // Create API project structure if not React
          if (!flags.react) {
            await this.scaffolder.ensureApiProject(root, { force });
          }
        },
      });

      // TODO: check if all alepha dependencies are same version

      const pmName = await this.pm.getPackageManager(root, flags.pm);
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
