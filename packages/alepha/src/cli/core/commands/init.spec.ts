import { Alepha, Json } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";
import { InitCommand } from "./init.ts";

describe("alepha init", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const fs = alepha.inject(MemoryFileSystemProvider);
    const shell = alepha.inject(MemoryShellProvider);
    const cli = alepha.inject(CliProvider);
    const cmd = alepha.inject(InitCommand);
    const json = alepha.inject(Json);

    return { alepha, fs, shell, cli, cmd, json };
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

    it("should create biome.json", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/biome.json")).toBe(true);
      expect(fs.wasWrittenMatching("/project/biome.json", /biomejs\.dev/)).toBe(
        true,
      );
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
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // AI Agent Files (always generated)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("AI agent files", () => {
    it("should create CLAUDE.md when claude CLI is installed", async () => {
      const { fs, shell, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      shell.installedCommands.add("claude");

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/CLAUDE.md")).toBe(true);
      expect(fs.wasWritten("/project/AGENTS.md")).toBe(false);
    });

    it("should create AGENTS.md when claude CLI is not installed", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/AGENTS.md")).toBe(true);
      expect(fs.wasWritten("/project/CLAUDE.md")).toBe(false);
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
  // Minimal Project Structure (default, no flags)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("minimal project structure (default)", () => {
    it("should create src/main.server.ts", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/main.server.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /Alepha\.create/),
      ).toBe(true);
    });

    it("should not create api structure without --api flag", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(false);
      expect(
        fs.wasWritten("/project/src/api/controllers/HelloController.ts"),
      ).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // API Project Structure (--api flag)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("--api flag", () => {
    it("should create src/main.server.ts with ApiModule import", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--api", root: "/project" });

      expect(fs.wasWritten("/project/src/main.server.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /ApiModule/),
      ).toBe(true);
    });

    it("should create src/api/index.ts with app name from directory", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json, "my-cool-app");

      await cli.run(cmd.init, { argv: "--api", root: "/project" });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/api/index.ts", /\$module/),
      ).toBe(true);
    });

    it("should create example HelloController", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--api", root: "/project" });

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
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // React Project Structure (--react flag)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("--react flag", () => {
    it("should create web directory structure", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--react", root: "/project" });

      expect(fs.wasWritten("/project/src/web/index.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/web/AppRouter.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/web/components/Home.tsx")).toBe(true);
    });

    it("should create main.browser.ts for client-side entry", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--react", root: "/project" });

      expect(fs.wasWritten("/project/src/main.browser.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.browser.ts", /WebModule/),
      ).toBe(true);
    });

    it("should create main.css", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--react", root: "/project" });

      expect(fs.wasWritten("/project/src/main.css")).toBe(true);
    });

    it("should not create api structure without --api flag", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--react", root: "/project" });

      // React alone should not create API structure
      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(false);
      expect(
        fs.wasWritten("/project/src/api/controllers/HelloController.ts"),
      ).toBe(false);
    });

    it("should create both api and web with --api --react", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--api --react", root: "/project" });

      // Both structures should be created
      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/web/index.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /ApiModule/),
      ).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.server.ts", /WebModule/),
      ).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Test Setup (--test flag)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("--test flag", () => {
    it("should create test directory with dummy.spec.ts", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--test", root: "/project" });

      expect(fs.wasWritten("/project/test/dummy.spec.ts")).toBe(true);
      expect(
        fs.wasWrittenMatching(
          "/project/test/dummy.spec.ts",
          /describe|test|it/,
        ),
      ).toBe(true);
    });

    it("should add vitest to package.json devDependencies", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--test", root: "/project" });

      const pkg = await fs.readJsonFile<{
        devDependencies?: Record<string, string>;
      }>("/project/package.json");
      expect(pkg.devDependencies?.vitest).toBeDefined();
    });

    it("should add test script to package.json", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--test", root: "/project" });

      const pkg = await fs.readJsonFile<{ scripts?: Record<string, string> }>(
        "/project/package.json",
      );
      expect(pkg.scripts?.test).toBe("vitest run");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Tailwind CSS (--tailwind flag)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("--tailwind flag", () => {
    it("should add tailwindcss devDependencies", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--tailwind", root: "/project" });

      const pkg = await fs.readJsonFile<{
        devDependencies?: Record<string, string>;
      }>("/project/package.json");
      expect(pkg.devDependencies?.tailwindcss).toBeDefined();
      expect(pkg.devDependencies?.["@tailwindcss/vite"]).toBeDefined();
    });

    it("should create vite.config.ts with tailwind plugin", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--tailwind", root: "/project" });

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

      await cli.run(cmd.init, { argv: "--tailwind", root: "/project" });

      expect(fs.wasWritten("/project/src/main.css")).toBe(true);
      expect(
        fs.wasWrittenMatching("/project/src/main.css", /@import "tailwindcss"/),
      ).toBe(true);
    });

    it("should imply --react", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--tailwind", root: "/project" });

      // React web structure should be created
      expect(fs.wasWritten("/project/src/web/index.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/main.browser.ts")).toBe(true);
    });

    it("should not create vite.config.ts without --tailwind", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--react", root: "/project" });

      expect(fs.wasWritten("/project/vite.config.ts")).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Non-empty directory guard (codegen flags)
  // ─────────────────────────────────────────────────────────────────────────────

  describe("non-empty directory guard", () => {
    it("should reject codegen into non-empty directory", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/src/existing.ts", "export {}");

      await expect(
        cli.run(cmd.init, { argv: "--api", root: "/project" }),
      ).rejects.toThrowError(/Target directory is not empty/);
    });

    it("should allow codegen when only package.json exists", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--api", root: "/project" });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
    });

    it("should allow codegen into non-empty directory with --force", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/src/existing.ts", "export {}");

      await cli.run(cmd.init, {
        argv: "--api --force",
        root: "/project",
      });

      expect(fs.wasWritten("/project/src/api/index.ts")).toBe(true);
    });

    it("should allow non-codegen init in non-empty directory", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);
      await fs.writeFile("/project/src/existing.ts", "export {}");

      // No codegen flags — should not throw
      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/tsconfig.json")).toBe(true);
    });

    it("should check each codegen flag independently", async () => {
      for (const flag of [
        "--react",
        "--ui",
        "--auth",
        "--admin",
        "--tailwind",
      ]) {
        const { fs, cli, cmd, json } = createTestEnv();
        await setupProject(fs, json);
        await fs.writeFile("/project/src/existing.ts", "export {}");

        await expect(
          cli.run(cmd.init, { argv: flag, root: "/project" }),
        ).rejects.toThrowError(/Target directory is not empty/);
      }
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
      expect(fs.wasWritten("/project/subdir/biome.json")).toBe(true);
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
      await fs.writeFile("/workspace/biome.json", "{}");
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

    it("should always create biome.json even when workspace root has it", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupWorkspace(fs, json);

      await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

      expect(fs.wasWritten("/workspace/packages/my-pkg/biome.json")).toBe(true);
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
