import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { vendorOptions } from "../atoms/vendorOptions.ts";
import { VendorCommand } from "../commands/VendorCommand.ts";
import type {
  VendorBuildOptions,
  VendorBuildResult,
  VendorSyncResult,
} from "../services/VendorService.ts";
import { VendorService } from "../services/VendorService.ts";

describe("VendorCommand", () => {
  /**
   * The copy is on disk and the build has not pointed its manifest at
   * `dist`, so the vendored package still serves raw TypeScript. Reporting
   * success over that is how #Q2490 went unnoticed across three consumers.
   */
  describe("sync", () => {
    const createEnv = (buildErrors: string[]) => {
      class FakeVendorService extends VendorService {
        public override async sync(): Promise<VendorSyncResult> {
          return { synced: ["alepha"], errors: [] };
        }

        public override async build(
          options: VendorBuildOptions,
        ): Promise<VendorBuildResult> {
          return {
            built: buildErrors.length > 0 ? [] : options.packages,
            skipped: [],
            errors: buildErrors,
          };
        }
      }

      class TestVendorCommand extends VendorCommand {
        public testSync = this.sync;
      }

      const alepha = Alepha.create()
        .with({ provide: ShellProvider, use: MemoryShellProvider })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: VendorService, use: FakeVendorService });
      alepha.store.set(vendorOptions, { packages: ["alepha"] });

      return {
        cli: alepha.inject(CliProvider),
        cmd: alepha.inject(TestVendorCommand),
        fs: alepha.inject(MemoryFileSystemProvider),
      };
    };

    it("fails when a vendored package fails to build", async ({ expect }) => {
      const { cli, cmd, fs } = createEnv([
        'Failed to build "alepha": Command exited with code 1',
      ]);
      await fs.writeFile("/project/yarn.lock", "");

      await expect(
        cli.run(cmd.testSync, { root: "/project", argv: "" }),
      ).rejects.toThrow(/1 vendored package failed to build/);
    });

    it("succeeds when every vendored package builds", async ({ expect }) => {
      const { cli, cmd, fs } = createEnv([]);
      await fs.writeFile("/project/yarn.lock", "");

      await expect(
        cli.run(cmd.testSync, { root: "/project", argv: "" }),
      ).resolves.not.toThrow();
    });
  });
});
