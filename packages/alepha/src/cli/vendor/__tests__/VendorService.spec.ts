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
      const { service, shell, fs } = createTestEnv();

      /**
       * Since MemoryShellProvider does not actually clone, we simulate
       * by pre-populating the temp directory. We override cloneRemote
       * to return a known path.
       */
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          await shell.run(
            "git clone --depth 1 --branch main --filter=blob:none remote /tmp/test-clone",
          );
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/my-pkg", {
        recursive: true,
      });
      await testFs.writeFile(
        "/tmp/test-clone/packages/my-pkg/index.ts",
        "export {}",
      );
      await testFs.mkdir("/project/packages/my-pkg", { recursive: true });
      await testFs.writeFile("/project/packages/my-pkg/old-file.ts", "old");

      const result = await testService.sync({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: ["my-pkg"],
        force: true,
      });

      expect(result.synced).toEqual(["my-pkg"]);
      expect(result.errors).toEqual([]);
      expect(testFs.wasDeleted("/project/packages/my-pkg")).toBe(true);
    });

    it("should report errors for missing remote packages", async ({
      expect,
    }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages", { recursive: true });

      const result = await testService.sync({
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
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/pkg-a", { recursive: true });
      await testFs.writeFile("/tmp/test-clone/packages/pkg-a/index.ts", "a");
      await testFs.mkdir("/tmp/test-clone/packages/pkg-b", { recursive: true });
      await testFs.writeFile("/tmp/test-clone/packages/pkg-b/index.ts", "b");

      const result = await testService.sync({
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
  });

  describe("diff", () => {
    it("should clone the remote repository for diff", async ({ expect }) => {
      const { service, shell } = createTestEnv();

      await service.diff({
        root: "/project",
        remote: "git@github.com:user/repo.git",
        branch: "main",
        packages: [],
      });

      expect(
        shell.wasCalledMatching(
          /git clone --depth 1 --branch main --filter=blob:none/,
        ),
      ).toBe(true);
    });

    it("should detect added files", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/pkg", { recursive: true });
      await testFs.writeFile("/tmp/test-clone/packages/pkg/new-file.ts", "new");
      await testFs.writeFile("/tmp/test-clone/packages/pkg/shared.ts", "same");

      await testFs.mkdir("/project/packages/pkg", { recursive: true });
      await testFs.writeFile("/project/packages/pkg/shared.ts", "same");

      const result = await testService.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: ["pkg"],
      });

      expect(result.packages).toHaveLength(1);
      expect(result.packages[0].added).toEqual(["new-file.ts"]);
      expect(result.packages[0].modified).toEqual([]);
      expect(result.packages[0].removed).toEqual([]);
      expect(result.totalChanges).toBe(1);
    });

    it("should detect modified files", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/pkg", { recursive: true });
      await testFs.writeFile(
        "/tmp/test-clone/packages/pkg/file.ts",
        "updated content",
      );

      await testFs.mkdir("/project/packages/pkg", { recursive: true });
      await testFs.writeFile(
        "/project/packages/pkg/file.ts",
        "original content",
      );

      const result = await testService.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: ["pkg"],
      });

      expect(result.packages[0].modified).toEqual(["file.ts"]);
      expect(result.totalChanges).toBe(1);
    });

    it("should detect removed files", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/pkg", { recursive: true });
      await testFs.writeFile("/tmp/test-clone/packages/pkg/shared.ts", "same");

      await testFs.mkdir("/project/packages/pkg", { recursive: true });
      await testFs.writeFile("/project/packages/pkg/shared.ts", "same");
      await testFs.writeFile("/project/packages/pkg/local-only.ts", "local");

      const result = await testService.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: ["pkg"],
      });

      expect(result.packages[0].removed).toEqual(["local-only.ts"]);
      expect(result.totalChanges).toBe(1);
    });

    it("should handle package only in local", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages", { recursive: true });
      await testFs.mkdir("/project/packages/pkg", { recursive: true });
      await testFs.writeFile("/project/packages/pkg/file.ts", "local");

      const result = await testService.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: ["pkg"],
      });

      expect(result.packages[0].removed).toEqual(["file.ts"]);
      expect(result.packages[0].added).toEqual([]);
      expect(result.totalChanges).toBe(1);
    });

    it("should handle package only in remote", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages/pkg", { recursive: true });
      await testFs.writeFile("/tmp/test-clone/packages/pkg/file.ts", "remote");

      const result = await testService.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: ["pkg"],
      });

      expect(result.packages[0].added).toEqual(["file.ts"]);
      expect(result.packages[0].removed).toEqual([]);
      expect(result.totalChanges).toBe(1);
    });

    it("should clean up temp directory after diff", async ({ expect }) => {
      class TestVendorService extends VendorService {
        protected override async cloneRemote(): Promise<string> {
          return "/tmp/test-clone";
        }
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });

      const testService = alepha.inject(TestVendorService);
      const testFs = alepha.inject(MemoryFileSystemProvider);

      await testFs.mkdir("/tmp/test-clone/packages", { recursive: true });

      await testService.diff({
        root: "/project",
        remote: "remote",
        branch: "main",
        packages: [],
      });

      expect(testFs.wasDeleted("/tmp/test-clone")).toBe(true);
    });
  });
});
