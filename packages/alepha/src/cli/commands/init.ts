import { $inject, t } from "alepha";
import { $command } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { FileSystemProvider } from "alepha/system";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";
import { PackageManagerUtils } from "../services/PackageManagerUtils.ts";
import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

export class InitCommand {
  protected readonly log = $logger();
  protected readonly colors = $inject(ConsoleColorProvider);
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
      ai: t.optional(
        t.boolean({
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
      auth: t.optional(
        t.boolean({
          description:
            "Include authentication (AppSecurity, $uiAuth). Implies --api --ui --react",
        }),
      ),
      admin: t.optional(
        t.boolean({
          description: "Include admin portal ($uiAdmin). Implies --auth",
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

      // Flag cascading: --admin → --auth → --ui → --react, --api
      if (flags.admin) {
        flags.auth = true;
      }
      if (flags.auth) {
        flags.api = true;
        flags.ui = true;
      }
      if (flags.ui) {
        flags.react = true;
      }

      // Detect workspace context (are we inside packages/ or apps/ of a monorepo?)
      const workspace = await this.pm.getWorkspaceContext(root);

      // Detect agent type: claude CLI → CLAUDE.md, else → AGENTS.md
      let agentType: "claude" | "agents" | false = false;
      if (flags.ai && !workspace.isPackage) {
        const hasClaudeCli = await this.utils.isInstalledAsync("claude");
        agentType = hasClaudeCli ? "claude" : "agents";
      }

      const isExpo = await this.pm.hasExpo(root);

      // Get git email for admin auto-promotion (if auth enabled)
      const adminEmail = flags.auth
        ? await this.utils.getGitEmail()
        : undefined;

      const force = !!flags.force;

      await run({
        name: "ensuring configuration files",
        handler: async () => {
          await this.scaffolder.ensureConfig(root, {
            force,
            packageJson: { ...flags, isPackage: workspace.isPackage },
            // Skip workspace-level configs if they exist at workspace root
            tsconfigJson: !workspace.config.tsconfigJson,
            biomeJson: !workspace.config.biomeJson,
            editorconfig: !workspace.config.editorconfig,
            agentMd: agentType ? { type: agentType } : false,
          });

          // Create alepha.config.ts with documented options
          await this.scaffolder.ensureAlephaConfig(root, { force });

          // Create project structure based on flags
          await this.scaffolder.ensureMainServerTs(root, {
            api: !!flags.api,
            react: !!flags.react && !isExpo,
            force,
          });
          if (flags.api) {
            await this.scaffolder.ensureApiProject(root, {
              auth: !!flags.auth,
              adminEmail,
              force,
            });
          }
          if (flags.react && !isExpo) {
            await this.scaffolder.ensureWebProject(root, {
              api: !!flags.api,
              ui: !!flags.ui,
              auth: !!flags.auth,
              admin: !!flags.admin,
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

      // Don't show success message if no path arg, e.g. just "alepha init" to re-configure current dir
      if (!args) {
        return;
      }

      // We must end the run context in order to log success message
      run.end();

      // Success message
      const projectName = args || ".";
      const pmRun = pmName === "npm" ? "npm run" : pmName;
      const c = this.colors;

      this.log.info("");
      this.log.info(`  ${c.set("GREEN", "✓")} Project ready!`);
      this.log.info("");
      this.log.info(
        `  ${c.set("GREY_DARK", "$")} cd ${c.set("CYAN", projectName)}`,
      );
      this.log.info(
        `  ${c.set("GREY_DARK", "$")} ${c.set("CYAN", `${pmRun} dev`)}`,
      );

      if (adminEmail) {
        this.log.info("");
        this.log.info(`  Admin email: ${c.set("GREEN", adminEmail)}`);
        this.log.info(
          `  ${c.set("GREY_DARK", "(from git config, change in src/api/AppSecurity.ts)")}`,
        );
      }

      this.log.info("");
    },
  });
}
