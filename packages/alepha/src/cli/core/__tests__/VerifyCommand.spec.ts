import { Alepha } from "alepha";
import { FileSystemProvider, MemoryFileSystemProvider } from "alepha/system";
import { describe, expect, it } from "vitest";
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
});
