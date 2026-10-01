import { readFileSync } from "node:fs";

import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { VendorService } from "../services/VendorService.ts";

describe("VendorService", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

    const service = alepha.inject(VendorService);
    const shell = alepha.inject(MemoryShellProvider);
    const fs = alepha.inject(MemoryFileSystemProvider);

    return { service, shell, fs };
  };

  /**
   * Helper to create a test service with a stubbed clone that returns
   * a known directory, plus stubs getCommitHash to return a fixed hash.
   */
  const createTestService = (shell: MemoryShellProvider) => {
    class TestVendorService extends VendorService {
      protected override async cloneRemote(): Promise<string> {
        await shell.run(
          "git clone --depth 1 --branch main --filter=blob:none remote /tmp/test-clone",
        );
        return "/tmp/test-clone";
      }

      protected override async cloneAtCommit(): Promise<string> {
        return "/tmp/test-baseline";
      }

      protected override async getCommitHash(): Promise<string> {
        return "abc123";
      }
    }

    const alepha = Alepha.create()
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

    return {
      service: alepha.inject(TestVendorService),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  describe("sync", () => {
    it("should clone the remote repository", async ({ expect }) => {
      const { service, shell, fs } = createTestEnv();

      await fs.mkdir("/tmp/.alepha-vendor-fake/packages/my-pkg", {
        recursive: true,
      });
      await fs.writeFile(
        "/tmp/.alepha-vendor-fake/packages/my-pkg/index.ts",
        "export {}",
      );

      await service.sync({
        root: "/project",
        remote: "git@github.com:user/repo.git",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
      });

      expect(
        shell.wasCalledMatching(
          /git clone --depth 1 --branch main --filter=blob:none git@github.com:user\/repo\.git/,
        ),
      ).toBe(true);
    });

    it("should remove local package dir before copying", async ({ expect }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      await fs.mkdir("/tmp/test-clone/packages/my-pkg", {
        recursive: true,
      });
      await fs.writeFile(
        "/tmp/test-clone/packages/my-pkg/index.ts",
        "export {}",
      );
      await fs.mkdir("/project/packages/my-pkg", { recursive: true });
      await fs.writeFile("/project/packages/my-pkg/old-file.ts", "old");

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
        force: true,
      });

      expect(result.synced).toEqual(["my-pkg"]);
      expect(result.errors).toEqual([]);
      expect(fs.wasDeleted("/project/packages/my-pkg")).toBe(true);
    });

    it("should report errors for missing remote packages", async ({
      expect,
    }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      await fs.mkdir("/tmp/test-clone/packages", { recursive: true });

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["missing-pkg"],
      });

      expect(result.synced).toEqual([]);
      expect(result.errors).toEqual([
        'Package "missing-pkg" not found in remote',
      ]);
    });

    it("should sync multiple packages", async ({ expect }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      await fs.mkdir("/tmp/test-clone/packages/pkg-a", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/pkg-a/index.ts", "a");
      await fs.mkdir("/tmp/test-clone/packages/pkg-b", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/pkg-b/index.ts", "b");

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg-a", "pkg-b"],
        force: true,
      });

      expect(result.synced).toEqual(["pkg-a", "pkg-b"]);
      expect(result.errors).toEqual([]);
    });

    it("should clean up temp directory even on error", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }

        protected override async getCommitHash(): Promise<string> {
          return "abc123";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/pkg-a", { recursive: true });
      await testFs.writeFile("/tmp/test-clone/packages/pkg-a/index.ts", "a");

      /**
       * Make cp throw to simulate a failure mid-sync.
       */
      const originalCp = testFs.cp.bind(testFs);
      testFs.cp = async () => {
        throw new Error("disk full");
      };

      await expect(
        testService.sync({
          root: "/project",
          remote: "remote",
          branch: "main",
          dir: "packages",
          packages: ["pkg-a"],
          force: true,
        }),
      ).rejects.toThrow("disk full");

      expect(testFs.wasDeleted("/tmp/test-clone")).toBe(true);

      testFs.cp = originalCp;
    });

    it("should write vendor.json after successful sync", async ({ expect }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      await fs.mkdir("/tmp/test-clone/packages/my-pkg", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/my-pkg/index.ts", "code");

      await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
      });

      expect(fs.wasWritten("/project/packages/vendor.json")).toBe(true);
      const content = await fs.readFile("/project/packages/vendor.json");
      const lock = JSON.parse(content.toString());
      expect(lock.commit).toBe("abc123");
      expect(lock.remote).toBe("remote");
    });

    it("should skip modification check on first sync (no vendor.json)", async ({
      expect,
    }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      await fs.mkdir("/tmp/test-clone/packages/my-pkg", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/my-pkg/index.ts", "code");

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
      });

      expect(result.synced).toEqual(["my-pkg"]);
      expect(result.aborted).toBeUndefined();
    });

    it("should abort when local modifications detected against baseline", async ({
      expect,
    }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      // Baseline (last synced state)
      await fs.mkdir("/tmp/test-baseline/packages/my-pkg", { recursive: true });
      await fs.writeFile(
        "/tmp/test-baseline/packages/my-pkg/index.ts",
        "original",
      );

      // Local (user modified)
      await fs.mkdir("/project/packages/my-pkg", { recursive: true });
      await fs.writeFile("/project/packages/my-pkg/index.ts", "modified");

      // Remote (latest)
      await fs.mkdir("/tmp/test-clone/packages/my-pkg", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/my-pkg/index.ts", "latest");

      // Vendor lock exists from a previous sync
      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "old-hash" }),
      );

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
      });

      expect(result.aborted).toBeDefined();
      expect(result.synced).toEqual([]);
    });

    it("should sync when local matches baseline", async ({ expect }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      // Baseline and local are identical
      await fs.mkdir("/tmp/test-baseline/packages/my-pkg", { recursive: true });
      await fs.writeFile("/tmp/test-baseline/packages/my-pkg/index.ts", "same");

      await fs.mkdir("/project/packages/my-pkg", { recursive: true });
      await fs.writeFile("/project/packages/my-pkg/index.ts", "same");

      // Remote has updates
      await fs.mkdir("/tmp/test-clone/packages/my-pkg", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/my-pkg/index.ts", "updated");

      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "old-hash" }),
      );

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
      });

      expect(result.synced).toEqual(["my-pkg"]);
      expect(result.aborted).toBeUndefined();
    });

    it("should skip modification check with --force even when vendor.json exists", async ({
      expect,
    }) => {
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      // Local has modifications
      await fs.mkdir("/project/packages/my-pkg", { recursive: true });
      await fs.writeFile("/project/packages/my-pkg/index.ts", "modified");

      // Remote
      await fs.mkdir("/tmp/test-clone/packages/my-pkg", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/my-pkg/index.ts", "latest");

      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "old-hash" }),
      );

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["my-pkg"],
        force: true,
      });

      expect(result.synced).toEqual(["my-pkg"]);
      expect(result.aborted).toBeUndefined();
    });
  });

  describe("diff", () => {
    const createDiffTestService = () => {
      class TestVendorService extends VendorService {
        protected override async cloneAtCommit(): Promise<string> {
          return "/tmp/test-baseline";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      return {
        service: alepha.inject(TestVendorService),
        fs: alepha.inject(MemoryFileSystemProvider),
      };
    };

    const writeVendorLock = async (fs: MemoryFileSystemProvider) => {
      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "abc123" }),
      );
    };

    it("should return no changes when no vendor.json exists", async ({
      expect,
    }) => {
      const { service } = createDiffTestService();

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg"],
      });

      expect(result.packages).toEqual([]);
      expect(result.totalChanges).toBe(0);
    });

    it("should detect locally added files", async ({ expect }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      // Baseline (last synced state)
      await fs.mkdir("/tmp/test-baseline/packages/pkg", { recursive: true });
      await fs.writeFile("/tmp/test-baseline/packages/pkg/shared.ts", "same");

      // Local (user added a file)
      await fs.mkdir("/project/packages/pkg", { recursive: true });
      await fs.writeFile("/project/packages/pkg/shared.ts", "same");
      await fs.writeFile("/project/packages/pkg/local-only.ts", "local");

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg"],
      });

      expect(result.packages[0].added).toEqual(["local-only.ts"]);
      expect(result.totalChanges).toBe(1);
    });

    it("should detect locally modified files", async ({ expect }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      await fs.mkdir("/tmp/test-baseline/packages/pkg", { recursive: true });
      await fs.writeFile("/tmp/test-baseline/packages/pkg/file.ts", "original");

      await fs.mkdir("/project/packages/pkg", { recursive: true });
      await fs.writeFile("/project/packages/pkg/file.ts", "modified by user");

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg"],
      });

      expect(result.packages[0].modified).toHaveLength(1);
      expect(result.packages[0].modified[0].file).toBe("file.ts");
      expect(result.packages[0].modified[0].changes).toEqual([
        { line: 1, type: "removed", text: "original" },
        { line: 1, type: "added", text: "modified by user" },
      ]);
      expect(result.totalChanges).toBe(1);
    });

    it("should detect locally removed files", async ({ expect }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      // Baseline had two files
      await fs.mkdir("/tmp/test-baseline/packages/pkg", { recursive: true });
      await fs.writeFile("/tmp/test-baseline/packages/pkg/kept.ts", "same");
      await fs.writeFile("/tmp/test-baseline/packages/pkg/deleted.ts", "gone");

      // Local only has one
      await fs.mkdir("/project/packages/pkg", { recursive: true });
      await fs.writeFile("/project/packages/pkg/kept.ts", "same");

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg"],
      });

      expect(result.packages[0].removed).toEqual(["deleted.ts"]);
      expect(result.totalChanges).toBe(1);
    });

    it("should report no changes when local matches baseline", async ({
      expect,
    }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      await fs.mkdir("/tmp/test-baseline/packages/pkg", { recursive: true });
      await fs.writeFile("/tmp/test-baseline/packages/pkg/file.ts", "same");

      await fs.mkdir("/project/packages/pkg", { recursive: true });
      await fs.writeFile("/project/packages/pkg/file.ts", "same");

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg"],
      });

      expect(result.totalChanges).toBe(0);
    });

    it("should include line-level changes for multi-line modifications", async ({
      expect,
    }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      await fs.mkdir("/tmp/test-baseline/packages/pkg", { recursive: true });
      await fs.writeFile(
        "/tmp/test-baseline/packages/pkg/config.ts",
        "const a = 1;\nconst b = 2;\nconst c = 3;",
      );

      await fs.mkdir("/project/packages/pkg", { recursive: true });
      await fs.writeFile(
        "/project/packages/pkg/config.ts",
        "const a = 1;\nconst b = 99;\nconst c = 3;\nconst d = 4;",
      );

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["pkg"],
      });

      const fileDiff = result.packages[0].modified[0];
      expect(fileDiff.file).toBe("config.ts");
      expect(fileDiff.changes).toEqual([
        { line: 2, type: "removed", text: "const b = 2;" },
        { line: 2, type: "added", text: "const b = 99;" },
        { line: 4, type: "added", text: "const d = 4;" },
      ]);
    });

    it("should clean up temp directory after diff", async ({ expect }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      await fs.mkdir("/tmp/test-baseline/packages", { recursive: true });

      await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: [],
      });

      expect(fs.wasDeleted("/tmp/test-baseline")).toBe(true);
    });
  });
  /**
   * A vendored checkout is the ONE shape of the framework that resolves to
   * TypeScript: the committed `exports` map points at `./src/**\/*.ts`, and
   * `publishConfig.exports` - which overrides all 78 entries to `./dist` at
   * publish time - never applies to a git clone. Anything loading it outside
   * Vite therefore gets raw TypeScript, and `.tsx` Node refuses outright.
   * That is #Q2150: a published package importing `alepha/react` cannot boot
   * in a project that vendors the framework.
   */
  describe("build", () => {
    const createBuildTestEnv = () => {
      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      return {
        service: alepha.inject(VendorService),
        shell: alepha.inject(MemoryShellProvider),
        fs: alepha.inject(MemoryFileSystemProvider),
      };
    };

    const writeManifest = async (
      fs: MemoryFileSystemProvider,
      dir: string,
      manifest: Record<string, unknown>,
    ) => {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        `${dir}/package.json`,
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    };

    const readManifest = async (
      fs: MemoryFileSystemProvider,
      dir: string,
    ): Promise<any> =>
      JSON.parse((await fs.readFile(`${dir}/package.json`)).toString());

    const vendored = {
      name: "alepha",
      scripts: { build: "node scripts/build.ts" },
      exports: { "./react": { import: "./src/react/index.ts" } },
      publishConfig: {
        exports: { "./react": { import: "./dist/react/index.js" } },
      },
    };

    it("builds each package in its own directory", async ({ expect }) => {
      const { service, shell, fs } = createBuildTestEnv();
      await writeManifest(fs, "/project/.vendor/alepha", vendored);

      const result = await service.build({
        root: "/project",
        dir: ".vendor",
        packages: ["alepha"],
        packageManager: "yarn",
      });

      expect(result.built).toEqual(["alepha"]);
      // ⚠️ `run build` with a cwd, not `--workspace` or `--filter`: those are
      // spelled differently by every package manager, and this one has to
      // work under all of them.
      expect(shell.wasCalled("yarn run build")).toBe(true);
    });

    it("skips a package that declares no build script", async ({ expect }) => {
      const { service, shell, fs } = createBuildTestEnv();
      await writeManifest(fs, "/project/.vendor/plain", { name: "plain" });

      const result = await service.build({
        root: "/project",
        dir: ".vendor",
        packages: ["plain"],
        packageManager: "yarn",
      });

      expect(result.skipped).toEqual(["plain"]);
      expect(result.built).toEqual([]);
      expect(shell.wasCalled("yarn run build")).toBe(false);
    });

    it("points the exports map at dist once the build has run", async ({
      expect,
    }) => {
      const { service, fs } = createBuildTestEnv();
      await writeManifest(fs, "/project/.vendor/alepha", vendored);

      await service.build({
        root: "/project",
        dir: ".vendor",
        packages: ["alepha"],
        packageManager: "yarn",
      });

      const manifest = await readManifest(fs, "/project/.vendor/alepha");
      expect(manifest.exports["./react"].import).toBe("./dist/react/index.js");
    });

    /**
     * ⚠️ Kept rather than consumed, and the idempotence is what
     * `diffFromClone` leans on: it applies the same transform to the baseline
     * before comparing, and a transform that removed its own input could not
     * produce a matching answer twice.
     */
    it("keeps publishConfig, so applying it twice changes nothing", async ({
      expect,
    }) => {
      const { service, fs } = createBuildTestEnv();
      await writeManifest(fs, "/project/.vendor/alepha", vendored);

      await service.build({
        root: "/project",
        dir: ".vendor",
        packages: ["alepha"],
        packageManager: "yarn",
      });
      const once = await readManifest(fs, "/project/.vendor/alepha");

      await service.build({
        root: "/project",
        dir: ".vendor",
        packages: ["alepha"],
        packageManager: "yarn",
      });
      const twice = await readManifest(fs, "/project/.vendor/alepha");

      expect(once.publishConfig).toEqual(vendored.publishConfig);
      expect(twice).toEqual(once);
    });

    it("collects a failed build instead of aborting the rest", async ({
      expect,
    }) => {
      const { service, shell, fs } = createBuildTestEnv();
      shell.configure({ errors: { "yarn run build": "tsdown exploded" } });
      await writeManifest(fs, "/project/.vendor/alepha", vendored);

      const result = await service.build({
        root: "/project",
        dir: ".vendor",
        packages: ["alepha"],
        packageManager: "yarn",
      });

      expect(result.built).toEqual([]);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain("alepha");
    });
  });

  /**
   * The two ways the build phase could have broken the commands around it.
   */
  describe("build, against the rest of the flow", () => {
    it("leaves tsdown.config.ts in the synced copy", async ({ expect }) => {
      // `@alepha/ui`'s build script is a bare `tsdown`, which reads exactly
      // that file. Stripping it - which sync used to do - left a package
      // whose own build could not run.
      const { service, fs } = createTestService(
        Alepha.create()
          .with({ provide: ShellProvider, use: MemoryShellProvider })
          .inject(MemoryShellProvider),
      );

      await fs.mkdir("/tmp/test-clone/packages/ui", { recursive: true });
      await fs.writeFile("/tmp/test-clone/packages/ui/index.ts", "export {}");
      await fs.writeFile(
        "/tmp/test-clone/packages/ui/tsdown.config.ts",
        "export default {}",
      );
      await fs.writeFile("/tmp/test-clone/packages/ui/thing.spec.ts", "test");

      await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["ui"],
        force: true,
      });

      expect(await fs.exists("/project/packages/ui/tsdown.config.ts")).toBe(
        true,
      );
      // The specs still go, so this is not a blanket "keep everything".
      expect(await fs.exists("/project/packages/ui/thing.spec.ts")).toBe(false);
    });

    /**
     * The regression the transform would otherwise cause: the local
     * `package.json` no longer matches the remote's, so an ordinary
     * `vendor sync` would abort on a modification the tool made itself.
     */
    it("does not report its own exports rewrite as a local modification", async ({
      expect,
    }) => {
      class TestVendorService extends VendorService {
        protected override async cloneAtCommit(): Promise<string> {
          return "/tmp/test-baseline";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
      const service = alepha.inject(TestVendorService);
      const fs = alepha.inject(MemoryFileSystemProvider);

      const manifest = {
        name: "alepha",
        scripts: { build: "node scripts/build.ts" },
        exports: { "./react": { import: "./src/react/index.ts" } },
        publishConfig: {
          exports: { "./react": { import: "./dist/react/index.js" } },
        },
      };

      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "abc123" }),
      );

      // The baseline is what the remote committed: exports on src.
      await fs.mkdir("/tmp/test-baseline/packages/alepha", { recursive: true });
      await fs.writeFile(
        "/tmp/test-baseline/packages/alepha/package.json",
        `${JSON.stringify(manifest, null, 2)}\n`,
      );

      // The local copy is the same package after `build()` rewrote it.
      await fs.mkdir("/project/packages/alepha", { recursive: true });
      await fs.writeFile(
        "/project/packages/alepha/package.json",
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await service.build({
        root: "/project",
        dir: "packages",
        packages: ["alepha"],
        packageManager: "yarn",
      });

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["alepha"],
      });

      expect(result.totalChanges).toBe(0);
    });

    /**
     * The opt-out: a project that syncs with `build: false` never rewrote its
     * manifests, so its copy must be compared to the baseline as committed.
     * Transforming the baseline anyway would report every synced
     * `package.json` as a local modification and abort the next sync.
     */
    it("compares an unbuilt copy as committed when build is off", async ({
      expect,
    }) => {
      class TestVendorService extends VendorService {
        protected override async cloneAtCommit(): Promise<string> {
          return "/tmp/test-baseline";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
      const service = alepha.inject(TestVendorService);
      const fs = alepha.inject(MemoryFileSystemProvider);

      const manifest = `${JSON.stringify(
        {
          name: "alepha",
          scripts: { build: "node scripts/build.ts" },
          exports: { "./react": { import: "./src/react/index.ts" } },
          publishConfig: {
            exports: { "./react": { import: "./dist/react/index.js" } },
          },
        },
        null,
        2,
      )}\n`;

      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "abc123" }),
      );
      await fs.mkdir("/tmp/test-baseline/packages/alepha", { recursive: true });
      await fs.writeFile(
        "/tmp/test-baseline/packages/alepha/package.json",
        manifest,
      );
      // The local copy is exactly what the remote committed: never built.
      await fs.mkdir("/project/packages/alepha", { recursive: true });
      await fs.writeFile("/project/packages/alepha/package.json", manifest);

      const diff = (build?: boolean) =>
        service.diff({
          root: "/project",
          remote: "remote",
          branch: "main",
          dir: "packages",
          packages: ["alepha"],
          build,
        });

      expect((await diff(false)).totalChanges).toBe(0);
      // The default still expects a built copy, so the same tree differs.
      expect((await diff()).totalChanges).toBe(1);
    });

    /**
     * The end of the chain, against the REAL manifest rather than a fixture.
     *
     * This is what a non-Vite consumer actually does: Node reads the
     * `exports` map and loads whatever it names. Today the vendored map
     * names `./src/**\/*.ts` for all 78 entries, so Node hits
     * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` on a parameter property or, with
     * no flag to save it, `ERR_UNKNOWN_FILE_EXTENSION` on a `.tsx`.
     *
     * ⚠️ An entry added to `exports` with no `publishConfig.exports`
     * counterpart turns this red, which is the point: it would be an entry
     * that stays on TypeScript after the transform and takes the whole
     * class of failure back with it.
     */
    it("leaves no TypeScript in the real alepha exports map", async ({
      expect,
    }) => {
      const manifest = JSON.parse(
        readFileSync(
          new URL("../../../../package.json", import.meta.url),
          "utf8",
        ),
      );

      // ⚠️ `.d.ts` is exempt: those sit on the `types` condition, which only
      // the TypeScript compiler reads. Node never loads one, so a declaration
      // file left on TypeScript is not this bug.
      const loadable = (exports: unknown): string[] =>
        (JSON.stringify(exports).match(/\.\/[^"]+\.[a-z]+/g) ?? []).filter(
          (it) => !it.endsWith(".d.ts"),
        );
      const typescript = (paths: string[]) =>
        paths.filter((it) => /\.tsx?$/.test(it));

      const vendored = { ...manifest, ...manifest.publishConfig };

      expect(loadable(vendored.exports).length).toBeGreaterThan(0);
      expect(typescript(loadable(vendored.exports))).toEqual([]);
      // And the untransformed map IS the failure, so this cannot pass by the
      // transform having done nothing.
      expect(typescript(loadable(manifest.exports)).length).toBeGreaterThan(0);
    });

    it("still reports a real edit to package.json", async ({ expect }) => {
      // The other half: the transform must not become a blanket exemption
      // for the one file that says what the package depends on.
      class TestVendorService extends VendorService {
        protected override async cloneAtCommit(): Promise<string> {
          return "/tmp/test-baseline";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
      const service = alepha.inject(TestVendorService);
      const fs = alepha.inject(MemoryFileSystemProvider);

      const base = {
        name: "alepha",
        dependencies: { zod: "1.0.0" },
        publishConfig: {
          exports: { "./react": { import: "./dist/react/index.js" } },
        },
      };

      await fs.mkdir("/project/packages", { recursive: true });
      await fs.writeFile(
        "/project/packages/vendor.json",
        JSON.stringify({ remote: "remote", commit: "abc123" }),
      );
      await fs.mkdir("/tmp/test-baseline/packages/alepha", { recursive: true });
      await fs.writeFile(
        "/tmp/test-baseline/packages/alepha/package.json",
        `${JSON.stringify(base, null, 2)}\n`,
      );

      await fs.mkdir("/project/packages/alepha", { recursive: true });
      await fs.writeFile(
        "/project/packages/alepha/package.json",
        `${JSON.stringify({ ...base, dependencies: { zod: "2.0.0" } }, null, 2)}\n`,
      );

      const result = await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        dir: "packages",
        packages: ["alepha"],
      });

      expect(result.totalChanges).toBeGreaterThan(0);
    });
  });
});
