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
        packages: ["my-pkg"],
      });

      expect(fs.wasWritten("/project/.alepha/vendor.json")).toBe(true);
      const content = await fs.readFile("/project/.alepha/vendor.json");
      const lock = JSON.parse(content.toString());
      expect(lock.commit).toBe("abc123");
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
      await fs.mkdir("/project/.alepha", { recursive: true });
      await fs.writeFile(
        "/project/.alepha/vendor.json",
        JSON.stringify({ commit: "old-hash" }),
      );

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
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

      await fs.mkdir("/project/.alepha", { recursive: true });
      await fs.writeFile(
        "/project/.alepha/vendor.json",
        JSON.stringify({ commit: "old-hash" }),
      );

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
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

      await fs.mkdir("/project/.alepha", { recursive: true });
      await fs.writeFile(
        "/project/.alepha/vendor.json",
        JSON.stringify({ commit: "old-hash" }),
      );

      const result = await service.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
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
      await fs.mkdir("/project/.alepha", { recursive: true });
      await fs.writeFile(
        "/project/.alepha/vendor.json",
        JSON.stringify({ commit: "abc123" }),
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
        packages: ["pkg"],
      });

      expect(result.packages[0].removed).toEqual(["local-only.ts"]);
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
        packages: ["pkg"],
      });

      expect(result.packages[0].modified).toEqual(["file.ts"]);
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
        packages: ["pkg"],
      });

      expect(result.packages[0].added).toEqual(["deleted.ts"]);
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
        packages: ["pkg"],
      });

      expect(result.totalChanges).toBe(0);
    });

    it("should clean up temp directory after diff", async ({ expect }) => {
      const { service, fs } = createDiffTestService();
      await writeVendorLock(fs);

      await fs.mkdir("/tmp/test-baseline/packages", { recursive: true });

      await service.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: [],
      });

      expect(fs.wasDeleted("/tmp/test-baseline")).toBe(true);
    });
  });
});
