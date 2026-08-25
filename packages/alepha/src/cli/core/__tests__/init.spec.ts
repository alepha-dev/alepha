import { Alepha, Json } from "alepha";
import { CliProvider } from "alepha/command";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { InitCommand } from "../commands/init.ts";

describe("alepha init", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "info" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const cli = alepha.inject(CliProvider);
    const cmd = alepha.inject(InitCommand);
    const json = alepha.inject(Json);
    const logs = alepha.inject(MemoryDestinationProvider);

    return { alepha, fs, shell, cli, cmd, json, logs };
  };

  /**
   * The sign-off, as it reaches the log stream.
   *
   * Everything before it is `Runner` narration ("Starting ...", "Finished ...
   * after Ns", "Total time"), which every test here would otherwise have to
   * filter past to see the three lines it cares about.
   *
   * Colour is stripped: the destination stores the message as the logger built
   * it, escape sequences included, and which ones `ConsoleColorProvider`
   * happens to emit is not what these assert.
   */
  const signOff = (logs: MemoryDestinationProvider) => {
    const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
    const messages = logs.logs.map((log) => log.message.replace(ansi, ""));
    const start = messages.findIndex((message) =>
      message.includes("Project ready!"),
    );
    return start === -1 ? [] : messages.slice(start);
  };

  const setupProject = async (
    fs: MemoryFileSystemProvider,
    json: Json,
    name = "test-app",
  ) => {
    await fs.writeFile("/project/package.json", json.stringify({ name }));
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Configuration Files
  // ─────────────────────────────────────────────────────────────────────────────

  describe("configuration files", () => {
    it("should create tsconfig.json with alepha base", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/tsconfig.json")).toBe(true);
      const tsconfig = await fs.readJsonFile<{ extends: string }>(
        "/project/tsconfig.json",
      );
      expect(tsconfig.extends).toBe("alepha/tsconfig.base");
    });

    it("should create the oxlint and oxfmt configs", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      // Both, or the project gets half a toolchain: a formatter with no linter
      // silently stops gating, and a linter with no formatter reformats every
      // file it touches to oxfmt's Prettier defaults, tabs included.
      expect(fs.wasWritten("/project/.oxlintrc.json")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/.oxlintrc.json", /"correctness"/),
      ).toBe(true);
      expect(fs.wasWritten("/project/.oxfmtrc.json")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/.oxfmtrc.json", /"useTabs": false/),
      ).toBe(true);
    });

    /**
     * The editor's copy of the guard `alepha lint` passes on the command line.
     * oxlint has no built-in `node_modules` exclusion (oxfmt does), and the
     * scaffold both recommends the Oxc extension and turns on
     * `source.fixAll.oxc`, so a project whose `.gitignore` is missing has its
     * dependencies linted and fixed from inside the editor.
     */
    it("should keep the linter out of node_modules", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(
        fs.wasWrittenMatching(
          "/project/.oxlintrc.json",
          /"ignorePatterns":.*"node_modules"/,
        ),
      ).toBe(true);
    });

    it("should create .editorconfig", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/.editorconfig")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/.editorconfig", /root\s*=\s*true/),
      ).toBe(true);
    });

    it("should create alepha.config.ts with documented options", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/alepha.config.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/alepha.config.ts", /defineConfig/),
      ).toBe(true);
      expect(fs.wasWrittenMatching("/project/alepha.config.ts", /entry:/)).toBe(
        true,
      );
      expect(fs.wasWrittenMatching("/project/alepha.config.ts", /build:/)).toBe(
        true,
      );
    });

    it("should create .vscode/settings.json pointing at the embedded tsdk", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/.vscode/settings.json")).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/.vscode/settings.json",
          /node_modules\/typescript\/lib/,
        ),
      ).toBe(true);
    });

    it("should point the editor's formatter at Oxc, and recommend it", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      // The project ships an `.oxfmtrc.json` and `alepha lint` formats with
      // oxfmt. Without this the editor formats with something else on save and
      // the two undo each other.
      expect(
        fs.wasWrittenMatching(
          "/project/.vscode/settings.json",
          /"\[typescript\]": \{ "editor\.defaultFormatter": "oxc\.oxc-vscode" \}/,
        ),
      ).toBe(true);

      // Pointing `defaultFormatter` at an extension the user does not have
      // makes VS Code complain on every save, so the recommendation ships too.
      expect(
        fs.wasWrittenMatching(
          "/project/.vscode/extensions.json",
          /oxc\.oxc-vscode/,
        ),
      ).toBe(true);
    });

    it("should carry the test config inside vite.config.ts", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      // Vitest falls back to vite.config.ts, so one file drives both the build
      // and the tests — plugins and aliases cannot drift apart.
      expect(fs.wasWritten("/project/vitest.config.ts")).toBe(false);
      expect(
        fs.wasWrittenMatching(
          "/project/vite.config.ts",
          /from "vitest\/config"/,
        ),
      ).toBe(true);
      // `test.root` is what stops Vitest walking up into a parent monorepo
      // config that boots containers this project knows nothing about.
      expect(
        fs.wasWrittenMatching("/project/vite.config.ts", /root: "\."/),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AI Agent Files (always generated)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("AI agent files", () => {
    it("should create both AGENTS.md and CLAUDE.md", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/AGENTS.md")).toBe(true);
      expect(fs.wasWritten("/project/CLAUDE.md")).toBe(true);
    });

    it("should write CLAUDE.md as a stub importing AGENTS.md", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const claude = await fs.readTextFile("/project/CLAUDE.md");
      expect(claude.trim()).toBe("@AGENTS.md");
    });

    it("should include Alepha instructions in agent file", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWrittenMatching("/project/AGENTS.md", /Alepha/)).toBe(true);
      expect(fs.wasWrittenMatching("/project/AGENTS.md", /alepha lint/)).toBe(
        true,
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Package Manager Detection
  // ─────────────────────────────────────────────────────────────────────────────

  describe("package manager detection", () => {
    it("should use yarn when yarn.lock exists", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/yarn.lock", "");

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalled("yarn install")).toBe(true);
      expect(shell.wasCalled("yarn set version stable")).toBe(true);
    });

    it("should use npm when package-lock.json exists", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/package-lock.json", "{}");

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalled("npm install")).toBe(true);
    });

    it("should use pnpm when pnpm-lock.yaml exists", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/pnpm-lock.yaml", "");

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalled("pnpm install")).toBe(true);
    });

    it("should use bun when bun.lock exists", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/bun.lock", "");

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalled("bun install")).toBe(true);
    });

    it("should respect --pm flag over lockfile detection", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/yarn.lock", ""); // yarn lockfile exists

      await cli.run(cmd.init, { argv: "--pm=npm", root: "/project" });

      expect(shell.wasCalled("npm install")).toBe(true);
      expect(shell.wasCalled("yarn install")).toBe(false);
    });

    it("should accept --pm=yarn", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--pm=yarn", root: "/project" });

      expect(shell.wasCalled("yarn install")).toBe(true);
    });

    it("should accept --pm=pnpm", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--pm=pnpm", root: "/project" });

      expect(shell.wasCalled("pnpm install")).toBe(true);
    });

    it("should accept --pm=bun", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--pm=bun", root: "/project" });

      expect(shell.wasCalled("bun install")).toBe(true);
    });

    it("should reject invalid --pm value", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await expect(
        cli.run(cmd.init, { argv: "--pm=invalid", root: "/project" }),
      ).rejects.toThrowError(/Invalid flag/);
    });

    it("should show enum values in help for --pm flag", async () => {
      const { alepha, cli, cmd } = createTestEnv();
      await alepha.start();

      // Verify printHelp works with the init command (which has an enum flag)
      expect(() => cli.printHelp(cmd.init)).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Project Structure — API + web + Tailwind, always. No flags to opt in.
  // ─────────────────────────────────────────────────────────────────────────────

  describe("project structure", () => {
    it("should reject the removed structure flags", async () => {
      for (const flag of ["--api", "--react", "-r", "--tailwind"]) {
        const { fs, cli, cmd, json } = createTestEnv();
        await setupProject(fs, json);

        await expect(
          cli.run(cmd.init, { argv: flag, root: "/project" }),
        ).rejects.toThrowError(/Unknown flag/);
      }
    });

    it("should create src/main.server.ts wiring both modules", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/main.server.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /Alepha\.create/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /ApiModule/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /WebModule/),
      ).toBe(true);
    });

    it("should create api structure by default", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/api/index.ts", /\$module/),
      ).toBe(true);
    });

    it("should create example HelloController", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(
        fs.wasWritten("/project/src/api/controllers/HelloController.ts"),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/src/api/controllers/HelloController.ts",
          /\$action/,
        ),
      ).toBe(true);
    });

    it("should create web directory structure by default", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/web/index.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/web/AppRouter.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/web/components/Home.tsx")).toBe(true);
    });

    it("should wire the router to the API via $client", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(
        fs.wasWrittenMatching("/project/src/web/AppRouter.ts", /\$client/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/src/web/AppRouter.ts",
          /HelloController/,
        ),
      ).toBe(true);
    });

    it("should create main.browser.ts for client-side entry", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/main.browser.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.browser.ts", /WebModule/),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Setup (always scaffolded — Vitest ships embedded in alepha)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("test setup", () => {
    it("should always create test directory with dummy.spec.ts", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/test/dummy.spec.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/test/dummy.spec.ts",
          /describe|test|it/,
        ),
      ).toBe(true);
    });

    it("should NOT pin vitest in package.json (embedded in alepha)", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const pkg = await fs.readJsonFile<{
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      }>("/project/package.json");
      // The toolchain (vitest, vite, oxlint/oxfmt, tsc, drizzle-kit) ships embedded
      // as dependencies of `alepha` — the project never declares it.
      expect(pkg.devDependencies?.vitest).toBeUndefined();
      expect(pkg.dependencies?.vitest).toBeUndefined();
    });

    it("should add test script to package.json", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const pkg = await fs.readJsonFile<{ scripts?: Record<string, string> }>(
        "/project/package.json",
      );
      expect(pkg.scripts?.test).toBe("alepha test");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tailwind CSS — part of the default shape, no flag
  // ─────────────────────────────────────────────────────────────────────────────

  describe("tailwind", () => {
    it("should add tailwindcss devDependencies", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const pkg = await fs.readJsonFile<{
        devDependencies?: Record<string, string>;
      }>("/project/package.json");
      expect(pkg.devDependencies?.tailwindcss).toBeDefined();
      expect(pkg.devDependencies?.["@tailwindcss/vite"]).toBeDefined();
    });

    it("should create vite.config.ts with tailwind plugin", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/vite.config.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/vite.config.ts", /tailwindcss/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/vite.config.ts", /@tailwindcss\/vite/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/vite.config.ts", /defineConfig/),
      ).toBe(true);
    });

    it("should add @import tailwindcss to main.css", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/main.css")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.css", /@import "tailwindcss"/),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Emptiness
  //
  // A bare `alepha init` scaffolds in place when the directory is empty, and
  // creates `my-app/` when it is not. What counts as empty is the whole
  // question: `ls` hides dotfiles, so a directory holding only `.git` is
  // still empty. Windows has no dotfile convention, it has a hidden attribute,
  // so the same reasoning has to cover the files it produces.
  // ─────────────────────────────────────────────────────────────────────────────

  describe("emptiness", () => {
    it("should scaffold in place when the directory holds only a dotfile", async () => {
      const { fs, cli, cmd } = createTestEnv();
      await fs.writeFile("/project/.gitignore", "node_modules");

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
      expect(fs.wasWritten("/project/my-app/src/api/index.ts")).toBe(false);
    });

    /**
     * Windows creates `desktop.ini` on its own whenever a folder gets a custom
     * icon or view, and inside OneDrive-synced trees. It is hidden by
     * attribute, not by a leading dot, so Explorer shows the folder as empty
     * while `ls` reports one entry. Counting it turns
     * `mkdir my-app && cd my-app && alepha init` into `my-app/my-app/`.
     */
    it("should scaffold in place when the directory holds only Windows shell metadata", async () => {
      const { fs, cli, cmd } = createTestEnv();
      await fs.writeFile("/project/desktop.ini", "[.ShellClassInfo]");

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
      expect(fs.wasWritten("/project/my-app/src/api/index.ts")).toBe(false);
    });

    it("should still create my-app/ for a file that is real content", async () => {
      const { fs, cli, cmd } = createTestEnv();
      await fs.writeFile("/project/notes.txt", "x");

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/my-app/src/api/index.ts")).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Non-empty directory guard
  //
  // Only applies when a target path is named. A bare `alepha init` is the
  // fill-in-the-gaps mode and must stay safe on an existing project.
  // ─────────────────────────────────────────────────────────────────────────────

  describe("non-empty directory guard", () => {
    it("should reject scaffolding into a named non-empty directory", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await fs.writeFile(
        "/project/subdir/package.json",
        json.stringify({ name: "subdir-app" }),
      );
      await fs.writeFile("/project/subdir/src/existing.ts", "export {}");

      await expect(
        cli.run(cmd.init, { argv: "subdir", root: "/project" }),
      ).rejects.toThrowError(/Target directory is not empty/);
    });

    it("should allow a named directory holding only package.json", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await fs.writeFile(
        "/project/subdir/package.json",
        json.stringify({ name: "subdir-app" }),
      );

      await cli.run(cmd.init, { argv: "subdir", root: "/project" });

      expect(fs.wasWritten("/project/subdir/src/api/index.ts")).toBe(true);
    });

    /**
     * Same notion of content as the bare-init emptiness check: shell metadata
     * is not something a person put there, so refusing on it is a false alarm.
     */
    it("should allow a named directory holding only Windows shell metadata", async () => {
      const { fs, cli, cmd } = createTestEnv();
      await fs.writeFile("/project/subdir/desktop.ini", "[.ShellClassInfo]");

      await cli.run(cmd.init, { argv: "subdir", root: "/project" });

      expect(fs.wasWritten("/project/subdir/src/api/index.ts")).toBe(true);
    });

    it("should allow a named non-empty directory with --force", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await fs.writeFile(
        "/project/subdir/package.json",
        json.stringify({ name: "subdir-app" }),
      );
      await fs.writeFile("/project/subdir/src/existing.ts", "export {}");

      await cli.run(cmd.init, { argv: "subdir --force", root: "/project" });

      expect(fs.wasWritten("/project/subdir/src/api/index.ts")).toBe(true);
    });

    it("should allow in-place init in a non-empty directory", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/src/existing.ts", "export {}");

      // No path argument — should not throw
      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/tsconfig.json")).toBe(true);
    });

    it("should not overwrite existing files during in-place init", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/src/main.server.ts", "// mine");

      await cli.run(cmd.init, { root: "/project" });

      expect(await fs.readTextFile("/project/src/main.server.ts")).toBe(
        "// mine",
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Path Argument
  // ─────────────────────────────────────────────────────────────────────────────

  describe("path argument", () => {
    it("should create project in subdirectory when path provided", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await fs.writeFile(
        "/project/subdir/package.json",
        json.stringify({ name: "subdir-app" }),
      );

      await cli.run(cmd.init, { argv: "subdir", root: "/project" });

      expect(fs.wasWritten("/project/subdir/tsconfig.json")).toBe(true);
      expect(fs.wasWritten("/project/subdir/.oxlintrc.json")).toBe(true);
    });

    it("should honour an absolute path instead of reparenting it under root", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await fs.writeFile(
        "/elsewhere/app/package.json",
        json.stringify({ name: "absolute-app" }),
      );

      await cli.run(cmd.init, { argv: "/elsewhere/app", root: "/project" });

      expect(fs.wasWritten("/elsewhere/app/tsconfig.json")).toBe(true);
      // `join(root, args)` silently reparents the target under the cwd, so the
      // project lands in `/project/elsewhere/app` — a directory nobody asked
      // for, created without a word of warning.
      expect(fs.wasWritten("/project/elsewhere/app/tsconfig.json")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Linter Execution
  // ─────────────────────────────────────────────────────────────────────────────

  describe("post-install tasks", () => {
    it("should run linter after install", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/yarn.lock", "");

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalled("yarn run lint")).toBe(true);
    });

    /**
     * `git init` writes "Initialized empty Git repository in ..." itself. Run
     * with stdio inherited it landed raw between two log lines — the one line
     * in the whole of `init` with no timestamp and no level in front of it.
     */
    it("should report git's own output through the logger", async () => {
      const { fs, shell, cli, cmd, json, logs } = createTestEnv();
      await setupProject(fs, json);
      shell.configure({
        installedCommands: ["git"],
        outputs: {
          "git init": "Initialized empty Git repository in /project/.git/",
        },
      });

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalled("git init")).toBe(true);
      expect(
        logs.logs.some((log) =>
          log.message.includes("Initialized empty Git repository"),
        ),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Sign-off
  // ─────────────────────────────────────────────────────────────────────────────

  describe("sign-off", () => {
    /**
     * Three lines and nothing else. It used to log a blank line either side
     * and between the heading and the commands, which the `cli` log format
     * renders as a bare `22:43:28 I` with nothing after it.
     */
    it("should log the commands to run next", async () => {
      const { fs, cli, cmd, json, logs } = createTestEnv();
      await fs.writeFile(
        "/project/subdir/package.json",
        json.stringify({ name: "subdir-app" }),
      );

      await cli.run(cmd.init, { argv: "subdir", root: "/project" });

      expect(signOff(logs)).toEqual([
        "Project ready!",
        "$ cd subdir",
        "$ yarn dev",
      ]);
    });

    /**
     * `mkdir my-app && cd my-app && alepha init` scaffolds in place, so there
     * is nowhere to `cd` to.
     */
    it("should omit the cd line when the project was scaffolded in place", async () => {
      const { fs, cli, cmd, logs } = createTestEnv();
      await fs.mkdir("/project");

      await cli.run(cmd.init, { root: "/project" });

      expect(signOff(logs)).toEqual(["Project ready!", "$ yarn dev"]);
    });

    /**
     * A bare `alepha init` on a directory that already had a `package.json` is
     * the fill-in-the-gaps mode. Nothing was created, so there is nothing to
     * announce.
     */
    it("should stay silent when it only topped up an existing project", async () => {
      const { fs, cli, cmd, json, logs } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(signOff(logs)).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Workspace Package Detection
  // ─────────────────────────────────────────────────────────────────────────────

  describe("workspace package detection", () => {
    const setupWorkspace = async (
      fs: MemoryFileSystemProvider,
      json: Json,
      pm: "yarn" | "npm" | "pnpm" | "bun" = "yarn",
    ) => {
      // Setup workspace root at /workspace
      await fs.writeFile(
        "/workspace/package.json",
        json.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
      );
      await fs.writeFile("/workspace/.oxlintrc.json", "{}");
      await fs.writeFile("/workspace/.editorconfig", "root=true");
      await fs.writeFile("/workspace/tsconfig.json", "{}");

      // Setup lockfile based on PM
      const lockfiles: Record<string, string> = {
        yarn: "yarn.lock",
        npm: "package-lock.json",
        pnpm: "pnpm-lock.yaml",
        bun: "bun.lock",
      };
      await fs.writeFile(`/workspace/${lockfiles[pm]}`, "");

      // Setup package inside workspace (2 levels down)
      await fs.writeFile(
        "/workspace/packages/my-pkg/package.json",
        json.stringify({ name: "my-pkg" }),
      );
    };

    it("should always create the oxc configs even when workspace root has them", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json);

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(fs.wasWritten("/workspace/packages/my-pkg/.oxlintrc.json")).toBe(
        true,
      );
      expect(fs.wasWritten("/workspace/packages/my-pkg/.oxfmtrc.json")).toBe(
        true,
      );
    });

    it("should skip .editorconfig when workspace root has it", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json);

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(fs.wasWritten("/workspace/packages/my-pkg/.editorconfig")).toBe(
        false,
      );
    });

    it("should skip tsconfig.json when workspace root has it", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json);

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(fs.wasWritten("/workspace/packages/my-pkg/tsconfig.json")).toBe(
        false,
      );
    });

    it("should detect yarn from workspace root lockfile", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json, "yarn");

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(shell.wasCalled("yarn install")).toBe(true);
    });

    it("should detect pnpm from workspace root lockfile", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json, "pnpm");

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(shell.wasCalled("pnpm install")).toBe(true);
    });

    it("should run install from workspace root when in package", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json, "yarn");

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      // Install should be run with workspace root
      const installCalls = shell.getCallsMatching(/yarn install/);
      expect(installCalls.length).toBeGreaterThan(0);
      expect(installCalls[0].options.root).toBe("/workspace");
    });

    it("should not setup PM files when in workspace package", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json, "yarn");

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      // Should not run yarn set version stable in package
      expect(shell.wasCalled("yarn set version stable")).toBe(false);
    });

    it("should still create package.json in the package", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json);

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(fs.wasWritten("/workspace/packages/my-pkg/package.json")).toBe(
        true,
      );
    });
  });
});
