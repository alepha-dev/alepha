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
      // choose which modules to scaffold
      api: t.optional(
        t.boolean({
          description: "Include API module structure (src/api/)",
        }),
      ),
      react: t.optional(
        t.boolean({
          aliases: ["r"],
          description: "Include React dependencies and web module (src/web/)",
        }),
      ),
      ui: t.optional(
        t.boolean({
          description:
            "Include @alepha/ui (components, auth portal, admin portal)",
        }),
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
      if (args) {
        root = this.fs.join(root, args);
        await this.fs.mkdir(root, { force: true });
      }

      if (flags.ui) {
        flags.react = true;
      }

      // Detect workspace context (are we inside packages/ or apps/ of a monorepo?)
      const workspace = await this.pm.getWorkspaceContext(root);

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
            tsconfigJson: !workspace.config.tsconfigJson,
            packageJson: { ...flags, isPackage: workspace.isPackage },
            // Skip workspace-level configs if they exist at workspace root
            biomeJson: !workspace.config.biomeJson,
            editorconfig: !workspace.config.editorconfig,
            agentMd: agentType
              ? { type: agentType, react: !!flags.react, ui: !!flags.ui }
              : false,
          });

          // Create project structure based on flags
          await this.scaffolder.ensureMainServerTs(root, {
            api: !!flags.api,
            react: !!flags.react && !isExpo,
            force,
          });
          if (flags.api) {
            await this.scaffolder.ensureApiProject(root, { force });
          }
          if (flags.react && !isExpo) {
            await this.scaffolder.ensureWebProject(root, {
              api: !!flags.api,
              ui: !!flags.ui,
              force,
            });
          }
        },
      });

      // Use workspace PM if detected, otherwise detect from current root
      const pmName = await this.pm.getPackageManager(
        workspace.workspaceRoot ?? root,
        flags.pm ?? workspace.packageManager ?? undefined,
      );

      // Only setup PM files if not in a workspace package
      if (!workspace.isPackage) {
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
      }

      // Run install from workspace root if in a package, otherwise from current root
      const installRoot = workspace.workspaceRoot ?? root;
      await run(`${pmName} install`, {
        alias: `installing dependencies with ${pmName}`,
        root: installRoot,
      });

      // Create test directory if --test flag is set (vitest is in package.json)
      if (flags.test) {
        await this.scaffolder.ensureTestDir(root);
      }

      await run(`${pmName} run lint`, {
        alias: "running linter",
        root: installRoot,
      });

      // Initialize git repository if not in a workspace package
      if (!workspace.isPackage) {
        const gitInitialized = await this.scaffolder.ensureGitRepo(root, {
          force,
        });
        if (gitInitialized) {
          await run("git add .", {
            alias: "staging generated files",
            root,
          });
        }
      }
    },
  });
}
