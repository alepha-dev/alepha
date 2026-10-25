import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { ProjectScaffolder } from "../services/ProjectScaffolder.ts";

/**
 * Exposes the NODE_OPTIONS sanitizer, which is protected because nothing
 * outside init has any business calling it.
 */
class TestProjectScaffolder extends ProjectScaffolder {
  public testWithoutForeignPnpRuntime =
    this.withoutForeignPnpRuntime.bind(this);
}

describe("ProjectScaffolder", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    const scaffolder = alepha.inject(TestProjectScaffolder);

    return { alepha, scaffolder };
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // getAppName
  // ─────────────────────────────────────────────────────────────────────────────

  describe("getAppName", () => {
    it("should return lowercase directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/MyApp")).toBe("myapp");
    });

    it("should remove dashes from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my-cool-app")).toBe("mycoolapp");
    });

    it("should remove underscores from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my_cool_app")).toBe("mycoolapp");
    });

    it("should remove spaces from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my cool app")).toBe("mycoolapp");
    });

    it("should remove dots from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my.cool.app")).toBe("mycoolapp");
    });

    it("should remove digits from directory name", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/app123")).toBe("app");
      expect(scaffolder.getAppName("/project/my2app")).toBe("myapp");
      expect(scaffolder.getAppName("/project/v2-app")).toBe("vapp");
    });

    it("should handle combination of special characters", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/my-cool_app.v2")).toBe(
        "mycoolappv",
      );
      expect(scaffolder.getAppName("/project/test_app-2.0")).toBe("testapp");
    });

    it("should fallback to 'app' when all characters are removed", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/project/123")).toBe("app");
      expect(scaffolder.getAppName("/project/---")).toBe("app");
      expect(scaffolder.getAppName("/project/1.2.3")).toBe("app");
      expect(scaffolder.getAppName("/project/_-._")).toBe("app");
    });

    it("should handle deeply nested paths", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/workspace/packages/apps/my-app")).toBe(
        "myapp",
      );
    });

    it("should handle root-level directories", () => {
      const { scaffolder } = createTestEnv();

      expect(scaffolder.getAppName("/myapp")).toBe("myapp");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // init — where the project lands
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * A bare `alepha init` picks its own target, and the rule is emptiness.
   *
   * `mkdir my-app && cd my-app && alepha init` used to answer with
   * `my-app/my-app/`, because the check was "no package.json ⇒ make a
   * subdirectory". An empty directory has nothing to scatter files over, so it
   * scaffolds in place like `git init` / `npm init` / `cargo init` do. A
   * *non-empty* directory without a package.json is the accident the guard was
   * written for and still gets `my-app/`.
   */
  describe("init target directory", () => {
    // `run` is the task runner the CLI injects. Invoke the handler form and
    // ignore the shell-command form — this asserts where files land, not what
    // the package manager did.
    const run: any = Object.assign(
      async (task: any) =>
        typeof task === "object" && task?.handler ? task.handler() : undefined,
      { end: () => {} },
    );

    const initAt = async (root: string, seed?: Record<string, string>) => {
      const { alepha, scaffolder } = createTestEnv();
      const fs = alepha.inject(MemoryFileSystemProvider);

      await fs.mkdir(root, { recursive: true });
      for (const [path, content] of Object.entries(seed ?? {})) {
        await fs.writeFile(`${root}/${path}`, content);
      }

      await scaffolder.init({ run, root, flags: {}, args: undefined });

      return fs;
    };

    it("should scaffold in place when the directory is empty", async () => {
      const fs = await initAt("/project");

      expect(fs.wasWritten("/project/package.json")).toBe(true);
      expect(fs.wasWritten("/project/my-app/package.json")).toBe(false);
    });

    it("should scaffold in place when only dotfiles are present", async () => {
      const fs = await initAt("/project", { ".gitignore": "node_modules/" });

      expect(fs.wasWritten("/project/package.json")).toBe(true);
      expect(fs.wasWritten("/project/my-app/package.json")).toBe(false);
    });

    it("should create my-app/ when the directory has unrelated files", async () => {
      const fs = await initAt("/project", { "notes.txt": "hello" });

      expect(fs.wasWritten("/project/my-app/package.json")).toBe(true);
      expect(fs.wasWritten("/project/package.json")).toBe(false);
    });

    it("should fill in place when a package.json already exists", async () => {
      const fs = await initAt("/project", {
        "package.json": JSON.stringify({ name: "existing" }),
        "notes.txt": "hello",
      });

      expect(fs.wasWritten("/project/tsconfig.json")).toBe(true);
      expect(fs.wasWritten("/project/my-app/package.json")).toBe(false);
    });
  });

  /**
   * `yarn create alepha` runs create-alepha from a temporary PnP install and
   * leaks `--require <tmp>/.pnp.cjs` into every child process. Vite's oxc
   * transform then hunts for a PnP manifest in a project scaffolded with
   * `nodeLinker: node-modules`, and the initial migration never gets written.
   */
  describe("withoutForeignPnpRuntime", () => {
    it("drops a --require pointing at a pnp runtime", () => {
      const { scaffolder } = createTestEnv();

      expect(
        scaffolder.testWithoutForeignPnpRuntime("--require /tmp/x/.pnp.cjs"),
      ).toBeUndefined();
    });

    it("drops the inline form and the loader form", () => {
      const { scaffolder } = createTestEnv();

      expect(
        scaffolder.testWithoutForeignPnpRuntime("--require=/tmp/x/.pnp.cjs"),
      ).toBeUndefined();
      expect(
        scaffolder.testWithoutForeignPnpRuntime(
          "--experimental-loader /tmp/x/.pnp.loader.mjs",
        ),
      ).toBeUndefined();
    });

    it("keeps options the user set for their own reasons", () => {
      const { scaffolder } = createTestEnv();

      expect(
        scaffolder.testWithoutForeignPnpRuntime(
          "--max-old-space-size=4096 --require /tmp/x/.pnp.cjs --enable-source-maps",
        ),
      ).toBe("--max-old-space-size=4096 --enable-source-maps");
    });

    it("leaves a --require of something that is not a pnp runtime alone", () => {
      const { scaffolder } = createTestEnv();

      expect(
        scaffolder.testWithoutForeignPnpRuntime(
          "--require /tmp/instrument.cjs",
        ),
      ).toBe("--require /tmp/instrument.cjs");
    });

    it("passes through empty and undefined untouched", () => {
      const { scaffolder } = createTestEnv();

      expect(
        scaffolder.testWithoutForeignPnpRuntime(undefined),
      ).toBeUndefined();
      expect(scaffolder.testWithoutForeignPnpRuntime("")).toBe("");
    });
  });
});
