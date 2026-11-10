import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { defineConfig } from "../../config/defineConfig.ts";
import { VerifyCommand } from "../commands/verify.ts";

class TestVerifyCommand extends VerifyCommand {
  public testHasTests = this.hasTests.bind(this);
}

describe("VerifyCommand", () => {
  const create = () => {
    const alepha = Alepha.create().with({
      provide: FileSystemProvider,
      use: MemoryFileSystemProvider,
    });
    return {
      verify: alepha.inject(TestVerifyCommand),
      fs: alepha.inject(MemoryFileSystemProvider),
    };
  };

  describe("hasTests", () => {
    it("should detect a test/ directory", async () => {
      const { verify, fs } = create();
      await fs.mkdir("/app/test", { recursive: true });

      expect(await verify.testHasTests("/app")).toBe(true);
    });

    it("should detect co-located specs under src/", async () => {
      // Gating on `test/` alone meant a project using the framework's own
      // co-located convention got a green `alepha verify` with zero tests
      // executed — the pipeline reported success without running anything.
      const { verify, fs } = create();
      await fs.mkdir("/app/src/users", { recursive: true });
      await fs.writeFile("/app/src/users/UserService.ts", "export {};");
      await fs.writeFile("/app/src/users/UserService.spec.ts", "export {};");

      expect(await verify.testHasTests("/app")).toBe(true);
    });

    it("should detect co-located browser specs", async () => {
      const { verify, fs } = create();
      await fs.mkdir("/app/src", { recursive: true });
      await fs.writeFile("/app/src/Button.browser.spec.tsx", "export {};");

      expect(await verify.testHasTests("/app")).toBe(true);
    });

    it("should report no tests when there are none", async () => {
      const { verify, fs } = create();
      await fs.mkdir("/app/src", { recursive: true });
      await fs.writeFile("/app/src/index.ts", "export {};");

      expect(await verify.testHasTests("/app")).toBe(false);
    });
  });

  describe("the check step", () => {
    const run = async (config?: Parameters<typeof defineConfig>[0]) => {
      const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: ShellProvider, use: MemoryShellProvider });
      if (config) {
        defineConfig(config)(alepha);
      }
      await alepha.inject(MemoryFileSystemProvider).mkdir("/app/src", {
        recursive: true,
      });
      await alepha
        .inject(CliProvider)
        .run(alepha.inject(VerifyCommand).verify, { root: "/app" });
      return alepha
        .inject(MemoryShellProvider)
        .calls.map((call) => call.command)
        .filter((command) => /alepha (lint|check|typecheck)$/.test(command));
    };

    it("runs alepha check between lint and typecheck, with no check key", async () => {
      expect(await run()).toEqual([
        "alepha lint",
        "alepha check",
        "alepha typecheck",
      ]);
    });

    it("runs it when the config tunes the rules", async () => {
      expect(
        await run({ check: { rules: { "no-module-code": "off" } } }),
      ).toContain("alepha check");
    });

    it("skips it with check: false", async () => {
      expect(await run({ check: false })).toEqual([
        "alepha lint",
        "alepha typecheck",
      ]);
    });
  });
});
