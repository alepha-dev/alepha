import { basename, dirname } from "node:path";
import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import { agentMd } from "../templates/agentMd.ts";
import { alephaConfigTs } from "../templates/alephaConfigTs.ts";
import { apiHelloControllerTs } from "../templates/apiHelloControllerTs.ts";
import { apiHelloResponseSchemaTs } from "../templates/apiHelloResponseSchemaTs.ts";
import { apiIndexTs } from "../templates/apiIndexTs.ts";
import { biomeJson } from "../templates/biomeJson.ts";
import { componentsJsonTs } from "../templates/componentsJsonTs.ts";
import { dummySpecTs } from "../templates/dummySpecTs.ts";
import { editorconfig } from "../templates/editorconfig.ts";
import { gitignore } from "../templates/gitignore.ts";
import { logoSvg } from "../templates/logoSvg.ts";
import { mainBrowserTs } from "../templates/mainBrowserTs.ts";
import { mainCss } from "../templates/mainCss.ts";
import { mainServerTs } from "../templates/mainServerTs.ts";
import { saasAdminLayoutTsx } from "../templates/saasAdminLayoutTsx.ts";
import {
  saasAdminSessionsTsx,
  saasAdminUsersTsx,
} from "../templates/saasAdminPagesTsx.ts";
import { saasAuthLayoutTsx } from "../templates/saasAuthLayoutTsx.ts";
import {
  saasAuthLoginTsx,
  saasAuthRegisterTsx,
  saasAuthResetPasswordTsx,
  saasAuthVerifyEmailTsx,
} from "../templates/saasAuthPagesTsx.ts";
import { saasRealmProviderTs } from "../templates/saasRealmProviderTs.ts";
import { tsconfigJson } from "../templates/tsconfigJson.ts";
import { viteConfigTs } from "../templates/viteConfigTs.ts";
import { vitestConfigTs } from "../templates/vitestConfigTs.ts";
import { webAppRouterTs } from "../templates/webAppRouterTs.ts";
import { webHomeComponentTsx } from "../templates/webHomeComponentTsx.ts";
import { webIndexTs } from "../templates/webIndexTs.ts";
import { AlephaCliUtils } from "./AlephaCliUtils.ts";
import {
  type DependencyModes,
  PackageManagerUtils,
} from "./PackageManagerUtils.ts";

/**
 * Service for scaffolding new Alepha projects.
 *
 * Handles creation of:
 * - Project structure (src/api, src/web)
 * - Configuration files (tsconfig, biome, editorconfig)
 * - Entry points (main.server.ts, main.browser.ts)
 * - Example code (HelloController, Home component)
 */
export class ProjectScaffolder {
  protected readonly log = $logger();
  protected readonly colors = $inject(ConsoleColorProvider);
  protected readonly fs = $inject(FileSystemProvider);
  protected readonly shell = $inject(ShellProvider);
  protected readonly pm = $inject(PackageManagerUtils);
  protected readonly utils = $inject(AlephaCliUtils);

  /**
   * Get the app name from the directory name.
   *
   * Converts the directory name to a valid module name:
   * - Converts to lowercase
   * - Replaces spaces, dashes, underscores with nothing
   * - Falls back to "app" if empty
   */
  public getAppName(root: string): string {
    const dirName = basename(root);
    const appName = dirName.toLowerCase().replace(/[\s\-_.\d]/g, "");
    return appName || "app";
  }

  /**
   * Ensure all configuration files exist.
   */
  public async ensureConfig(
    root: string,
    opts: {
      force?: boolean;
      /**
       * Check workspace root for existing config files.
       */
      checkWorkspace?: boolean;
      packageJson?: boolean | DependencyModes;
      /**
       * `true` writes a tsconfig.json if one doesn't already exist (parent
       * dirs included). `"local"` writes one when none exists *in this
       * directory* — used by shadcn since the CLI reads the local
       * tsconfig directly for import-alias detection.
       */
      tsconfigJson?: boolean | "local";
      biomeJson?: boolean;
      editorconfig?: boolean;
      agentMd?: boolean;
    },
  ): Promise<void> {
    const tasks: Promise<void>[] = [];
    const force = opts.force ?? false;
    const checkWorkspace = opts.checkWorkspace ?? false;

    if (opts.packageJson) {
      tasks.push(
        this.pm
          .ensurePackageJson(
            root,
            typeof opts.packageJson === "boolean" ? {} : opts.packageJson,
          )
          .then(() => {}),
      );
    }
    if (opts.tsconfigJson) {
      tasks.push(
        this.ensureTsConfig(root, {
          force,
          localOnly: opts.tsconfigJson === "local",
        }),
      );
    }
    if (opts.biomeJson) {
      tasks.push(this.ensureBiomeConfig(root, { force, checkWorkspace }));
    }
    if (opts.editorconfig) {
      tasks.push(this.ensureEditorConfig(root, { force, checkWorkspace }));
    }
    if (opts.agentMd) {
      tasks.push(this.ensureAgentMd(root, { force }));
    }

    await Promise.all(tasks);
  }

  // ===========================================
  // Config Files
  // ===========================================

  public async ensureTsConfig(
    root: string,
    opts: { force?: boolean; localOnly?: boolean } = {},
  ): Promise<void> {
    // Check if tsconfig.json exists in current or parent directories.
    // `localOnly: true` skips the parent walk — needed when a tool reads the
    // local tsconfig directly (shadcn does this for import-alias detection).
    const exists = opts.localOnly
      ? await this.fs.exists(this.fs.join(root, "tsconfig.json"))
      : await this.existsInParents(root, "tsconfig.json");
    if (!opts.force && exists) {
      return;
    }
    await this.fs.writeFile(
      this.fs.join(root, "tsconfig.json"),
      tsconfigJson(),
    );
  }

  public async ensureBiomeConfig(
    root: string,
    opts: { force?: boolean; checkWorkspace?: boolean } = {},
  ): Promise<void> {
    if (
      !opts.force &&
      opts.checkWorkspace &&
      (await this.existsInParents(root, "biome.json"))
    ) {
      return;
    }
    await this.ensureFile(root, "biome.json", biomeJson(), opts.force);
  }

  public async ensureEditorConfig(
    root: string,
    opts: { force?: boolean; checkWorkspace?: boolean } = {},
  ): Promise<void> {
    if (
      !opts.force &&
      opts.checkWorkspace &&
      (await this.existsInParents(root, ".editorconfig"))
    ) {
      return;
    }
    await this.ensureFile(root, ".editorconfig", editorconfig(), opts.force);
  }

  /**
   * Ensure git repository is initialized with .gitignore.
   *
   * @returns true if git was initialized, false if already exists or git unavailable
   */
  public async ensureGitRepo(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<boolean> {
    const gitDir = this.fs.join(root, ".git");

    // Skip if .git already exists
    if (!opts.force && (await this.fs.exists(gitDir))) {
      return false;
    }

    // Check if git is available
    const hasGit = await this.utils.isInstalledAsync("git");
    if (!hasGit) {
      return false;
    }

    // Initialize git repository
    await this.utils.exec("git init", { root, global: true });

    // Write .gitignore
    await this.ensureFile(root, ".gitignore", gitignore(), opts.force);

    return true;
  }

  /**
   * Ensure AGENTS.md (cross-tool standard, canonical source) exists, with a
   * CLAUDE.md stub that imports it via Claude Code's `@` syntax. Single
   * source of truth, cross-platform, no symlink needed.
   */
  public async ensureAgentMd(
    root: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    await Promise.all([
      this.ensureFile(root, "AGENTS.md", agentMd(), options.force),
      this.ensureFile(root, "CLAUDE.md", "@AGENTS.md\n", options.force),
    ]);
  }

  /**
   * Ensure alepha.config.ts exists with documented options.
   */
  public async ensureAlephaConfig(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(
      root,
      "alepha.config.ts",
      alephaConfigTs(),
      opts.force,
    );
  }

  // ===========================================
  // Minimal Project Structure
  // ===========================================

  /**
   * Ensure src/main.server.ts exists with correct module imports.
   */
  public async ensureMainServerTs(
    root: string,
    opts: { api?: boolean; react?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const srcDir = this.fs.join(root, "src");
    await this.fs.mkdir(srcDir, { recursive: true });
    await this.ensureFile(
      srcDir,
      "main.server.ts",
      mainServerTs({ api: opts.api, react: opts.react }),
      opts.force,
    );
  }

  // ===========================================
  // API Project Structure
  // ===========================================

  /**
   * Ensure API module structure exists.
   *
   * Creates:
   * - src/api/index.ts (API module)
   * - src/api/controllers/HelloController.ts (example controller)
   */
  public async ensureApiProject(
    root: string,
    opts: { saas?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/api/controllers"), {
      recursive: true,
    });
    await this.fs.mkdir(this.fs.join(root, "src/api/schemas"), {
      recursive: true,
    });

    // Create files
    await this.ensureFile(
      root,
      "src/api/index.ts",
      apiIndexTs({ appName, saas: opts.saas }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/api/controllers/HelloController.ts",
      apiHelloControllerTs({ appName }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/api/schemas/helloResponseSchema.ts",
      apiHelloResponseSchemaTs(),
      opts.force,
    );

    if (opts.saas) {
      await this.fs.mkdir(this.fs.join(root, "src/api/providers"), {
        recursive: true,
      });
      const adminEmail = await this.detectGitEmail();
      await this.ensureFile(
        root,
        "src/api/providers/RealmProvider.ts",
        saasRealmProviderTs({ adminEmail }),
        opts.force,
      );
    }
  }

  /**
   * Best-effort lookup for the developer's git email (used as the seeded
   * `adminEmails` entry in the SaaS realm). Returns undefined if git isn't
   * available or if `user.email` isn't configured — the template falls back
   * to `admin@example.com` in that case.
   */
  protected async detectGitEmail(): Promise<string | undefined> {
    try {
      const stdout = (await this.shell.run("git config --get user.email", {
        capture: true,
      })) as unknown as string;
      const email = (stdout ?? "").trim();
      if (!email || !email.includes("@")) return undefined;
      return email;
    } catch {
      return undefined;
    }
  }

  // ===========================================
  // Web Project Structure
  // ===========================================

  /**
   * Ensure web/React project structure exists.
   *
   * Creates:
   * - src/main.browser.ts
   * - src/main.css
   * - src/web/index.ts, src/web/AppRouter.ts, src/web/components/Home.tsx
   */
  public async ensureWebProject(
    root: string,
    opts: {
      api?: boolean;
      tailwind?: boolean;
      shadcn?: boolean;
      saas?: boolean;
      force?: boolean;
    } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/web/components"), {
      recursive: true,
    });

    if (opts.saas) {
      await this.fs.mkdir(this.fs.join(root, "src/web/components/auth"), {
        recursive: true,
      });
      await this.fs.mkdir(this.fs.join(root, "src/web/components/admin"), {
        recursive: true,
      });
    }

    // public/favicon.svg
    await this.fs.mkdir(this.fs.join(root, "public"), { recursive: true });
    await this.ensureFile(root, "public/favicon.svg", logoSvg, opts.force);

    // src/main.css
    await this.ensureFile(
      root,
      "src/main.css",
      mainCss({ tailwind: opts.tailwind }),
      opts.force,
    );

    // vite.config.ts (Tailwind CSS plugin)
    if (opts.tailwind) {
      await this.ensureFile(root, "vite.config.ts", viteConfigTs(), opts.force);
    }

    // shadcn/ui: write components.json before running `shadcn init` — the
    // CLI respects an existing config and skips its interactive prompts,
    // which lets us pin our aliases (`@/web/*`) and the `@alepha` registry.
    // The CLI itself writes the cn() helper, theme tokens, and installs
    // runtime deps (clsx, tailwind-merge, class-variance-authority,
    // lucide-react, tw-animate-css) — see runShadcnInit below.
    if (opts.shadcn) {
      await this.ensureFile(
        root,
        "components.json",
        componentsJsonTs(),
        opts.force,
      );
    }

    // Web structure
    await this.ensureFile(
      root,
      "src/web/index.ts",
      webIndexTs({ appName, saas: opts.saas }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/AppRouter.ts",
      webAppRouterTs({ api: opts.api, saas: opts.saas }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/components/Home.tsx",
      webHomeComponentTsx({ api: opts.api }),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/main.browser.ts",
      mainBrowserTs(),
      opts.force,
    );

    if (opts.saas) {
      // Auth — layout + 4 pages, each a thin wrapper around the registry
      // component that `shadcn add @alepha/auth-*` drops at
      // src/web/components/auth-*.tsx.
      await this.ensureFile(
        root,
        "src/web/components/auth/AuthLayout.tsx",
        saasAuthLayoutTsx(),
        opts.force,
      );
      await this.ensureFile(
        root,
        "src/web/components/auth/Login.tsx",
        saasAuthLoginTsx(),
        opts.force,
      );
      await this.ensureFile(
        root,
        "src/web/components/auth/Register.tsx",
        saasAuthRegisterTsx(),
        opts.force,
      );
      await this.ensureFile(
        root,
        "src/web/components/auth/ResetPassword.tsx",
        saasAuthResetPasswordTsx(),
        opts.force,
      );
      await this.ensureFile(
        root,
        "src/web/components/auth/VerifyEmail.tsx",
        saasAuthVerifyEmailTsx(),
        opts.force,
      );

      // Admin — AppShell layout + 5 admin-* pages
      await this.ensureFile(
        root,
        "src/web/components/admin/AdminLayout.tsx",
        saasAdminLayoutTsx(),
        opts.force,
      );
      await this.ensureFile(
        root,
        "src/web/components/admin/Users.tsx",
        saasAdminUsersTsx(),
        opts.force,
      );
      await this.ensureFile(
        root,
        "src/web/components/admin/Sessions.tsx",
        saasAdminSessionsTsx(),
        opts.force,
      );
    }
  }

  // ===========================================
  // Test Directory
  // ===========================================

  /**
   * Ensure test directory exists with a dummy test file + a self-contained
   * `vitest.config.ts`. Pinning `test.root` prevents Vitest from walking up
   * to a parent monorepo config (e.g. one that boots a Postgres container).
   */
  public async ensureTestDir(root: string): Promise<void> {
    const testDir = this.fs.join(root, "test");
    const dummyPath = this.fs.join(testDir, "dummy.spec.ts");
    const vitestConfigPath = this.fs.join(root, "vitest.config.ts");

    if (!(await this.fs.exists(vitestConfigPath))) {
      await this.fs.writeFile(vitestConfigPath, vitestConfigTs());
    }

    if (!(await this.fs.exists(testDir))) {
      await this.fs.mkdir(testDir, { recursive: true });
      await this.fs.writeFile(dummyPath, dummySpecTs());
      return;
    }

    const files = await this.fs.ls(testDir);
    if (files.length === 0) {
      await this.fs.writeFile(dummyPath, dummySpecTs());
    }
  }

  // ===========================================
  // Full Init Orchestration
  // ===========================================

  /**
   * Full project init — scaffolds files, installs deps, sets up PM and git.
   */
  async init({
    run,
    root,
    flags,
    args,
  }: {
    run: RunnerMethod;
    root: string;
    flags: {
      pm?: "yarn" | "npm" | "pnpm" | "bun";
      api?: boolean;
      react?: boolean;
      tailwind?: boolean;
      /** boolean toggle, or a string preset id (default `b0` when bare). */
      shadcn?: boolean | string;
      /** boolean toggle, or a string preset id (default `b0` when bare). */
      saas?: boolean | string;
      test?: boolean;
      force?: boolean;
    };
    args?: string;
  }) {
    if (args) {
      root = this.fs.join(root, args);
      await this.fs.mkdir(root, { force: true });
    }

    // `--shadcn` / `--saas` are union flags: bare → true, string → preset.
    // Capture the preset string (default `b0`), then normalize both flags
    // to plain booleans so the rest of the pipeline keeps its boolean
    // contract with PackageManagerUtils + ensureWebProject etc.
    const shadcnPreset =
      (typeof flags.saas === "string" && flags.saas) ||
      (typeof flags.shadcn === "string" && flags.shadcn) ||
      "b0";

    // Cast to a narrower view so downstream sees pure booleans.
    const f = flags as Omit<typeof flags, "shadcn" | "saas"> & {
      shadcn?: boolean;
      saas?: boolean;
    };
    f.shadcn = !!flags.shadcn;
    f.saas = !!flags.saas;

    // Flag cascading:
    //   --saas    → --shadcn + --api
    //   --shadcn  → --tailwind
    //   --tailwind→ --react
    if (f.saas) {
      f.shadcn = true;
      f.api = true;
    }
    if (f.shadcn) {
      f.tailwind = true;
    }
    if (flags.tailwind) {
      flags.react = true;
    }

    // When codegen flags are set, target directory must be empty (unless --force)
    const hasCodegenFlags =
      flags.api || flags.react || flags.tailwind || flags.shadcn || flags.saas;
    if (hasCodegenFlags && !flags.force) {
      const files = await this.fs.ls(root);
      // Allow a directory that only has package.json (common for monorepo packages)
      const meaningful = files.filter((f) => f !== "package.json");
      if (meaningful.length > 0) {
        throw new AlephaError(
          `Target directory is not empty (${root}). Use --force to overwrite existing files.`,
        );
      }
    }

    // Detect workspace context (are we inside packages/ or apps/ of a monorepo?)
    const workspace = await this.pm.getWorkspaceContext(root);

    // Always emit both AGENTS.md and CLAUDE.md at project roots (skip for
    // monorepo sub-packages where agent files live at workspace root).
    const writeAgentMd = !workspace.isPackage;

    const isExpo = await this.pm.hasExpo(root);

    const force = !!flags.force;

    await run({
      name: "ensuring configuration files",
      handler: async () => {
        await this.ensureConfig(root, {
          force,
          packageJson: { ...f, isPackage: workspace.isPackage },
          // Skip workspace-level configs if they exist at workspace root —
          // unless --shadcn is set: the shadcn CLI reads the local
          // tsconfig.json directly to detect import aliases (it doesn't
          // follow `extends`), so we must ensure one exists in the package.
          tsconfigJson: f.shadcn ? "local" : !workspace.config.tsconfigJson,
          biomeJson: true,
          editorconfig: !workspace.config.editorconfig,
          agentMd: writeAgentMd,
        });

        // Create alepha.config.ts with documented options
        await this.ensureAlephaConfig(root, { force });

        // Create project structure based on flags
        await this.ensureMainServerTs(root, {
          api: !!flags.api,
          react: !!flags.react && !isExpo,
          force,
        });
        if (flags.api) {
          await this.ensureApiProject(root, { saas: !!flags.saas, force });
        }
        if (flags.react && !isExpo) {
          await this.ensureWebProject(root, {
            api: !!flags.api,
            tailwind: !!flags.tailwind,
            shadcn: !!flags.shadcn,
            saas: !!flags.saas,
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
      await this.ensureTestDir(root);
    }

    // shadcn/ui: run `<pm> shadcn init` against the components.json we wrote
    // earlier. shadcn detects the existing config, respects our aliases,
    // injects theme tokens into src/main.css, writes src/web/lib/utils.ts,
    // and installs runtime deps (clsx, tailwind-merge, etc.).
    //
    // Flags chosen to keep this fully non-interactive:
    //   --yes           skip confirmation prompts (default in shadcn v4 but
    //                   passed explicitly so older versions also behave)
    //   --no-monorepo   skip the monorepo prompt — we ship a single-app
    //                   layout; users opt into monorepo via `--monorepo`
    //                   on the alepha side later
    //   --silent        suppress shadcn's own progress output; alepha's
    //                   runner already prints a status line
    //
    // We deliberately do NOT pass `--defaults` (would force Next.js +
    // base-nova preset) or `--template` (only applies to scratch projects;
    // ours already has main.server.ts / main.browser.ts).
    // Each PM has a different way to exec a project-local binary.
    const exec = pmExecPrefix(pmName);

    if (flags.shadcn) {
      // Fully non-interactive shadcn init. The `--preset` arg is what makes
      // this work — without it shadcn falls back to interactive prompts even
      // with --yes/--force. Defaults: vite template + radix base + reinstall
      // (so the components.json we pre-wrote stays canonical).
      await run(
        `${exec} shadcn init --no-monorepo --base radix -t vite --yes --force --reinstall --preset ${escapeShellArg(shadcnPreset)}`,
        { alias: `running shadcn init (preset ${shadcnPreset})`, root },
      );
      // Re-pin our aliases + alepha registry — `shadcn init --force`
      // overwrites components.json with the template defaults.
      await this.fs.writeFile(
        this.fs.join(root, "components.json"),
        componentsJsonTs(),
      );
    }

    // SaaS preset: pull in the auth + admin registry components from the
    // public alepha registry (already wired via components.json's
    // `registries: { "@alepha": "https://alepha.dev/r/{name}.json" }`).
    // Each `shadcn add` writes the component into src/web/components/* and
    // pulls its peer primitives + dependencies (sonner, etc.).
    if (flags.saas) {
      // Pull the public SaaS bundle in one shot — it aggregates control,
      // auto-form, alepha-table, use-dialog, app-shell, every auth-*, and
      // every admin-* block. Definition lives at
      // https://alepha.dev/r/saas.json (see @alepha/ui-registry).
      // `--yes --overwrite` is the only combo that works non-interactively
      // when registry items would replace files we pre-wrote (auth-login etc.
      // overlap with shadcn primitives like button/input).
      await run(`${exec} shadcn add @alepha/saas --yes --overwrite`, {
        alias: "adding alepha saas registry bundle",
        root,
      });
    }

    // Best-effort lint: shadcn-imported registry components occasionally
    // trip biome rules (e.g. noArrayIndexKey on a Fragment loop). The user
    // can fix or silence these later — don't block the whole init.
    try {
      await run(`${pmName} run lint`, {
        alias: "running linter",
        root,
      });
    } catch (err) {
      this.log.warn(
        "Linter reported issues during init — continuing. Run `lint` again later to inspect.",
        { error: err instanceof Error ? err.message : String(err) },
      );
    }

    // Initialize git repository if not in a workspace package
    if (!workspace.isPackage) {
      const gitInitialized = await this.ensureGitRepo(root, {
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

    this.log.info("");
  }

  // ===========================================
  // Helpers
  // ===========================================

  /**
   * Write a file, optionally overriding if it exists.
   */
  protected async ensureFile(
    root: string,
    relativePath: string,
    content: string,
    force?: boolean,
  ): Promise<void> {
    const fullPath = this.fs.join(root, relativePath);
    if (force || !(await this.fs.exists(fullPath))) {
      await this.fs.writeFile(fullPath, content);
    }
  }

  /**
   * Check if a file exists in the given directory or any parent directory.
   */
  protected async existsInParents(
    root: string,
    filename: string,
  ): Promise<boolean> {
    let current = root;
    while (true) {
      if (await this.fs.exists(this.fs.join(current, filename))) {
        return true;
      }
      const parent = dirname(current);
      if (parent === current) {
        // Reached filesystem root
        return false;
      }
      current = parent;
    }
  }
}

/**
 * Map a package manager name to the command that runs a project-local binary.
 *
 * - npm:  `npx`
 * - yarn: `yarn` (yarn auto-resolves binary names; `yarn shadcn ...` works)
 * - pnpm: `pnpm exec`
 * - bun:  `bunx`
 *
 * Used to invoke `shadcn init` / `shadcn add` regardless of the user's PM —
 * `npm shadcn ...` is invalid (it tries to run a script named `shadcn`).
 */
/** Quote a value so it survives shell parsing. */
const escapeShellArg = (value: string): string => {
  if (/^[A-Za-z0-9_./@:-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
};

const pmExecPrefix = (pmName: string): string => {
  switch (pmName) {
    case "npm":
      return "npx";
    case "pnpm":
      return "pnpm exec";
    case "bun":
      return "bunx";
    default:
      return "yarn";
  }
};
