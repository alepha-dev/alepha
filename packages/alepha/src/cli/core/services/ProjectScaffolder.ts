import { basename, dirname } from "node:path";
import { $inject, AlephaError } from "alepha";
import type { RunnerMethod } from "alepha/command";
import { $logger, ConsoleColorProvider } from "alepha/logger";
import { FileSystemProvider, ShellProvider } from "alepha/system";
import type { Preset } from "../schemas/presetSchema.ts";
import { agentMd } from "../templates/agentMd.ts";
import { alephaConfigTs } from "../templates/alephaConfigTs.ts";
import { apiHelloControllerTs } from "../templates/apiHelloControllerTs.ts";
import { apiHelloResponseSchemaTs } from "../templates/apiHelloResponseSchemaTs.ts";
import { apiIndexTs } from "../templates/apiIndexTs.ts";
import { apiRealmTs } from "../templates/apiRealmTs.ts";
import { biomeJson } from "../templates/biomeJson.ts";
import { dummySpecTs } from "../templates/dummySpecTs.ts";
import { editorconfig } from "../templates/editorconfig.ts";
import { envExample } from "../templates/envExample.ts";
import { envLocal } from "../templates/envLocal.ts";
import { gitignore } from "../templates/gitignore.ts";
import { logoSvg } from "../templates/logoSvg.ts";
import { mainBrowserTs } from "../templates/mainBrowserTs.ts";
import { mainCss } from "../templates/mainCss.ts";
import { mainServerTs } from "../templates/mainServerTs.ts";
import { tsconfigJson } from "../templates/tsconfigJson.ts";
import { viteConfigTs } from "../templates/viteConfigTs.ts";
import {
  vscodeExtensionsJson,
  vscodeSettingsJson,
} from "../templates/vscodeSettingsJson.ts";
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
   * Name given to the migration generated at init.
   *
   * Unnamed, drizzle-kit picks from a random word list and the first file in
   * the project's history reads `20260815223535_youthful_swarm`. It is the
   * migration most likely to be opened by someone who did not write it.
   */
  protected readonly initialMigrationName = "initial_schema";

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
      tsconfigJson?: boolean;
      biomeJson?: boolean;
      editorconfig?: boolean;
      /**
       * Write `.env.example`, the committed template for `.env`.
       *
       * Pass `{ database: true }` to document `DATABASE_URL` alongside
       * `APP_SECRET`.
       */
      envExample?: boolean | { database?: boolean };
      /**
       * `true` writes the file with no optional sections — pass
       * `{ devtools: true }` to document the `/__devtools/api/` endpoints and
       * `{ saas: true }` to document the identity surface.
       */
      agentMd?: boolean | { devtools?: boolean; saas?: boolean };
      /**
       * Write `.vscode/settings.json` pointing the editor's TypeScript
       * server at the `typescript` copy embedded in `alepha`.
       */
      vscodeSettings?: boolean;
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
      tasks.push(this.ensureTsConfig(root, { force }));
    }
    if (opts.biomeJson) {
      tasks.push(this.ensureBiomeConfig(root, { force, checkWorkspace }));
    }
    if (opts.editorconfig) {
      tasks.push(this.ensureEditorConfig(root, { force, checkWorkspace }));
    }
    if (opts.envExample) {
      tasks.push(
        this.ensureEnvExample(root, {
          force,
          database:
            typeof opts.envExample === "boolean"
              ? false
              : opts.envExample.database,
        }),
      );
    }
    if (opts.agentMd) {
      const agentMdOpts = typeof opts.agentMd === "boolean" ? {} : opts.agentMd;
      tasks.push(
        this.ensureAgentMd(root, {
          force,
          devtools: agentMdOpts.devtools,
          saas: agentMdOpts.saas,
        }),
      );
    }
    if (opts.vscodeSettings) {
      tasks.push(this.ensureVscodeSettings(root, { force, checkWorkspace }));
    }

    await Promise.all(tasks);
  }

  // ===========================================
  // Config Files
  // ===========================================

  public async ensureTsConfig(
    root: string,
    opts: { force?: boolean } = {},
  ): Promise<void> {
    const exists = await this.existsInParents(root, "tsconfig.json");
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
   * Write `.env.example`.
   *
   * Not tied to `ensureGitRepo` like `.gitignore` is: a project that already
   * has a `.git` still needs to be told that `APP_SECRET` exists.
   */
  public async ensureEnvExample(
    root: string,
    opts: { force?: boolean; database?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(
      root,
      ".env.example",
      envExample({ database: opts.database }),
      opts.force,
    );
  }

  /**
   * Write the gitignored `.env`, carrying the resolved `ADMIN_EMAIL`.
   *
   * Never forced. `--force` exists to re-scaffold the generated files, and a
   * `.env` is the one file in the tree that is not generated in any meaningful
   * sense — it is where the developer put their local secrets. Overwriting it
   * on a re-run would be a data loss bug, so an existing `.env` is left alone
   * even when everything else is rewritten.
   */
  public async ensureEnvLocal(
    root: string,
    opts: { adminEmail: string },
  ): Promise<void> {
    await this.ensureFile(
      root,
      ".env",
      envLocal({ adminEmail: opts.adminEmail }),
    );
  }

  /**
   * The address the first registration is promoted to admin with.
   *
   * `git config user.email` is the one address already on the machine that is
   * almost certainly the person running `alepha init`, and reading it costs a
   * subprocess that has already been spawned for `git init`. It is only ever a
   * local default — `Realm` reads `ADMIN_EMAIL` from the environment, so every
   * deployed environment still sets its own.
   *
   * Falls back to a placeholder on a machine with no git identity. The
   * fallback is deliberately not a real mailbox anyone can register: it is a
   * value that makes the wiring visible and obviously needs replacing.
   */
  public async resolveAdminEmail(root: string): Promise<string> {
    const fallback = "admin@alepha.dev";
    try {
      const result = await this.shell.capture("git config user.email", {
        root,
      });
      const email = result.stdout.trim();
      // A machine without a git identity exits non-zero with empty stdout.
      return result.exitCode === 0 && email ? email : fallback;
    } catch {
      // git missing entirely — same outcome, no reason to fail init over it.
      return fallback;
    }
  }

  /**
   * Ensure `.vscode/` exists: `settings.json` puts the editor on the same
   * TypeScript and the same formatter as the CLI, and `extensions.json`
   * recommends the Biome extension the settings depend on — see
   * `vscodeSettingsJson`.
   */
  public async ensureVscodeSettings(
    root: string,
    opts: { force?: boolean; checkWorkspace?: boolean } = {},
  ): Promise<void> {
    if (
      !opts.force &&
      opts.checkWorkspace &&
      (await this.existsInParents(root, ".vscode"))
    ) {
      return;
    }
    await this.fs.mkdir(this.fs.join(root, ".vscode"), { recursive: true });

    // Written separately rather than in one guarded block: a project that
    // already has settings.json (hand-tuned, say) still needs the extension
    // recommendation, or its formatter setting points at nothing.
    const settings = this.fs.join(root, ".vscode", "settings.json");
    if (opts.force || !(await this.fs.exists(settings))) {
      await this.fs.writeFile(settings, vscodeSettingsJson());
    }

    const extensions = this.fs.join(root, ".vscode", "extensions.json");
    if (opts.force || !(await this.fs.exists(extensions))) {
      await this.fs.writeFile(extensions, vscodeExtensionsJson());
    }
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

    // Initialize git repository.
    //
    // Captured rather than inherited: with stdio inherited, git's own
    // "Initialized empty Git repository in ..." landed raw in the middle of an
    // otherwise uniform log stream — no timestamp, no level, the one line in
    // `init` that did not look like the others. Re-emitting it through the
    // logger keeps the report in one voice.
    const result = await this.shell.capture("git init", { root });
    if (result.exitCode !== 0) {
      throw new AlephaError(
        `git init failed: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    const initMessage = result.stdout.trim();
    if (initMessage) {
      this.log.info(initMessage);
    }

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
    options: { force?: boolean; devtools?: boolean; saas?: boolean } = {},
  ): Promise<void> {
    await Promise.all([
      this.ensureFile(
        root,
        "AGENTS.md",
        agentMd({ devtools: options.devtools, saas: options.saas }),
        options.force,
      ),
      this.ensureFile(root, "CLAUDE.md", "@AGENTS.md\n", options.force),
    ]);
  }

  /**
   * Ensure alepha.config.ts exists with documented options.
   */
  public async ensureAlephaConfig(
    root: string,
    opts: { force?: boolean; devtools?: boolean } = {},
  ): Promise<void> {
    await this.ensureFile(
      root,
      "alepha.config.ts",
      alephaConfigTs({ devtools: opts.devtools }),
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
    opts: { react?: boolean; force?: boolean } = {},
  ): Promise<void> {
    const srcDir = this.fs.join(root, "src");
    await this.fs.mkdir(srcDir, { recursive: true });
    await this.ensureFile(
      srcDir,
      "main.server.ts",
      mainServerTs({ react: opts.react }),
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
   * - src/api/Realm.ts (saas preset only)
   */
  public async ensureApiProject(
    root: string,
    opts: { force?: boolean; saas?: boolean } = {},
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

    // Sits at the module root rather than under controllers/ or schemas/: a
    // realm is neither, and it is the one file in the preset a new project is
    // guaranteed to edit.
    if (opts.saas) {
      await this.ensureFile(
        root,
        "src/api/Realm.ts",
        apiRealmTs({ appName }),
        opts.force,
      );
    }
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
   * - vite.config.ts (Tailwind plugin)
   * - src/web/index.ts, src/web/AppRouter.ts, src/web/components/Home.tsx
   */
  public async ensureWebProject(
    root: string,
    opts: {
      force?: boolean;
      saas?: boolean;
    } = {},
  ): Promise<void> {
    const appName = this.getAppName(root);

    // Create directories
    await this.fs.mkdir(this.fs.join(root, "src/web/components"), {
      recursive: true,
    });

    // public/favicon.svg
    await this.fs.mkdir(this.fs.join(root, "public"), { recursive: true });
    await this.ensureFile(root, "public/favicon.svg", logoSvg, opts.force);

    // src/main.css
    await this.ensureFile(
      root,
      "src/main.css",
      mainCss({ ui: opts.saas }),
      opts.force,
    );

    // vite.config.ts (Tailwind CSS plugin)
    await this.ensureFile(root, "vite.config.ts", viteConfigTs(), opts.force);

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
      webAppRouterTs(),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/web/components/Home.tsx",
      webHomeComponentTsx(),
      opts.force,
    );
    await this.ensureFile(
      root,
      "src/main.browser.ts",
      mainBrowserTs(),
      opts.force,
    );
  }

  // ===========================================
  // Test Directory
  // ===========================================

  /**
   * Ensure the test directory exists with a dummy spec.
   *
   * No `vitest.config.ts` any more: Vitest falls back to `vite.config.ts`, and
   * `viteConfigTs` carries the `test` block — including the `test.root` that
   * stops Vitest walking up into a parent monorepo config (e.g. one that boots
   * a Postgres container). One file, so plugins and aliases cannot drift
   * between the build and the tests.
   */
  public async ensureTestDir(root: string): Promise<void> {
    const testDir = this.fs.join(root, "test");
    const dummyPath = this.fs.join(testDir, "dummy.spec.ts");

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
      preset?: Preset;
      pm?: "yarn" | "npm" | "pnpm" | "bun";
      force?: boolean;
      "no-devtools"?: boolean;
    };
    args?: string;
  }) {
    // Whether the user named a target directory. Distinguishes
    // `alepha init my-app` (create a project there) from a bare
    // `alepha init` (fill in whatever is missing, right here).
    const explicitPath = !!args;

    // Whether this call produced a project rather than topping up an existing
    // one. Not the same question as `explicitPath`: a bare `alepha init` in an
    // empty directory creates a project too, and it earns the same "Project
    // ready!" sign-off. Only the fill-in-the-gaps run on a directory that
    // already had a `package.json` stays silent.
    let newProject = explicitPath;

    if (!args) {
      // If the current directory doesn't look like an existing project
      // (no package.json), default to creating a `my-app/` subdirectory
      // rather than scaffolding into a random cwd.
      //
      // Except when the directory is empty. `mkdir my-app && cd my-app &&
      // alepha init` is the single most obvious way to start a project, and
      // answering it with `my-app/my-app/` is a surprise every other tool
      // avoids — `git init`, `npm init`, `cargo init` and `bun init` all
      // scaffold in place. The "random cwd" this guard protects is by
      // definition not empty, so emptiness is the signal to use: there is
      // nothing to scatter files over and nothing to clobber.
      //
      // `ls` hides dotfiles, so a directory holding only `.git` (or a stray
      // `.DS_Store`) still counts as empty — which is what someone who ran
      // `git init` first expects.
      const hasPackageJson = await this.fs.exists(
        this.fs.join(root, "package.json"),
      );
      if (!hasPackageJson) {
        newProject = true;

        const entries = await this.fs.ls(root);
        if (entries.length > 0) {
          args = "my-app";
        }
      }
    }

    if (args) {
      // `resolve`, not `join`: an absolute `alepha init /tmp/foo` names the
      // target outright, and `join` would reparent it under the cwd and
      // scaffold into `./tmp/foo` without a word. Relative paths are
      // unaffected — they still anchor to `root`.
      root = this.fs.resolve(root, args);
      await this.fs.mkdir(root, { force: true });
    }

    // Creating a project at a named path expects a clean slate, so refuse to
    // scaffold over someone else's files. A bare `alepha init` is the
    // fill-in-the-gaps mode and stays safe to run on an existing project —
    // `ensureFile` never overwrites without `--force`.
    if (explicitPath && !flags.force) {
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

    // Expo owns its own client runtime, so it is the one case where the web
    // module and its Tailwind pipeline are skipped. Everything else gets the
    // full shape unconditionally.
    const isExpo = await this.pm.hasExpo(root);
    const web = !isExpo;

    // All three saas routers are React pages, so the preset has nothing to
    // mount without the web module. Refusing beats scaffolding an api-only
    // project that quietly ignored the flag — the difference would only
    // surface as a missing /admin much later.
    const saas = (flags.preset ?? "default") === "saas";
    if (saas && !web) {
      throw new AlephaError(
        "The saas preset needs the web module, which is skipped for expo projects (expo owns its own client runtime). Use the default preset here.",
      );
    }

    // Devtools is on by default for apps and never for workspace packages —
    // a library has no Vite dev shell for the overlay to attach to.
    const devtools = !flags["no-devtools"] && !workspace.isPackage;

    const force = !!flags.force;

    await run({
      name: "ensuring configuration files",
      handler: async () => {
        await this.ensureConfig(root, {
          force,
          packageJson: {
            react: web,
            tailwind: web,
            isPackage: workspace.isPackage,
            devtools,
            ui: saas,
          },
          tsconfigJson: !workspace.config.tsconfigJson,
          biomeJson: true,
          editorconfig: !workspace.config.editorconfig,
          // Same rule as the agent files: a project root owns its env, a
          // monorepo sub-package reads the workspace root's.
          envExample: writeAgentMd && { database: saas },
          agentMd: writeAgentMd && { devtools, saas },
          // Editor TS-server pointer at a project root only; monorepo
          // sub-packages inherit the workspace-root `.vscode/`.
          vscodeSettings: writeAgentMd,
        });

        // Create alepha.config.ts with documented options
        await this.ensureAlephaConfig(root, { force, devtools });

        // Only the saas preset has an identity surface to hand an admin to.
        // Writing ADMIN_EMAIL into a default-preset project would document a
        // variable nothing reads.
        if (saas && writeAgentMd) {
          await this.ensureEnvLocal(root, {
            adminEmail: await this.resolveAdminEmail(root),
          });
        }

        // Every project gets the same structure; the preset only decides
        // what is mounted on top of it.
        await this.ensureMainServerTs(root, { react: web, force });
        await this.ensureApiProject(root, { force, saas });
        if (web) {
          await this.ensureWebProject(root, { force, saas });
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

    // Always scaffold the test setup — Vitest ships embedded in `alepha`, so
    // `alepha test` works in every project. The dummy spec doubles as a
    // worked example for both humans and AI agents.
    await this.ensureTestDir(root);

    // Freeze the schema the preset just mounted.
    //
    // `alepha verify` runs `db migrations check` unconditionally — gating it on
    // a `migrations/` directory inverted the check, so that gate is gone. A
    // preset that declares entities and ships no migration therefore fails the
    // command its own `alepha.config.ts` recommends for CI, on commit zero.
    //
    // Deploying in that state is worse than the red build: production's
    // `DatabaseProvider.migrate()` does not fall back to push-sync the way dev
    // does. It logs "Migration SKIPPED - no migrations found" and returns, so
    // the app boots green with no tables and 500s on its first query.
    //
    // Generating it here is safe in a way later migrations are not: a baseline
    // diffs against an empty database, so it is pure CREATE TABLE — none of the
    // DROP/ALTER statements that need a human reading them before they reach a
    // CASCADE parent on D1. Only presets that mount an ORM get one; the diff is
    // computed from the entity declarations against the snapshot on disk, so
    // this needs no database connection and works offline.
    //
    // Ahead of the lint pass on purpose. biome reformats drizzle's
    // `snapshot.json` — collapsing its arrays, semantically identical, and the
    // migration check reads the reformatted file happily. But whoever formats
    // it first wins, and if that is not init then it is the user's first
    // `lint` or `verify`, which hands them a dirty tree on a project they have
    // not edited. Formatting it here means the staged copy is the final one.
    if (saas) {
      try {
        await run(
          `alepha db migrations create --name=${this.initialMigrationName}`,
          {
            alias: "generating the initial migration",
            root,
          },
        );
      } catch (err) {
        // Same contract as the lint pass below: every file is already on disk,
        // and leaving a half-scaffolded project behind is worse than leaving a
        // migration for the user to generate. `verify` will name the command.
        this.log.warn(
          "Could not generate the initial migration — continuing. Run `alepha db migrations create` before your first `alepha verify` or deploy.",
          { error: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    // Best-effort lint pass — don't block init if it fails. The user can
    // fix or silence issues later.
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

    // Nothing was created — this was `alepha init` re-configuring a project
    // that already existed. Announcing "Project ready!" there would be noise.
    if (!newProject) {
      return;
    }

    // We must end the run context in order to log the success message after
    // the last "Finished ..." line and the total.
    run.end();

    // Three lines, and only three: the blank ones this used to log came out as
    // a bare `22:43:28 I` with nothing after it, and the `✓` plus the
    // two-space indent pushed `$ cd my-app` out of line with every other entry
    // in the stream.
    const pmRun = pmName === "npm" ? "npm run" : pmName;
    const c = this.colors;

    this.log.info(c.set("GREEN", "Project ready!"));
    // No `cd` line when the project was scaffolded into the current directory
    // — there is nowhere to go.
    if (args) {
      this.log.info(`${c.set("GREY_DARK", "$")} cd ${c.set("CYAN", args)}`);
    }
    this.log.info(
      `${c.set("GREY_DARK", "$")} ${c.set("CYAN", `${pmRun} dev`)}`,
    );
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
