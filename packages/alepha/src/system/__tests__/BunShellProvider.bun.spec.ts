import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Alepha } from "alepha";
import { BunShellProvider } from "../providers/BunShellProvider.ts";
import { ShellProvider } from "../providers/ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("BunShellProvider", () => {
  let alepha: Alepha;
  let shell: ShellProvider;

  beforeAll(async () => {
    alepha = Alepha.create().with({
      provide: ShellProvider,
      use: BunShellProvider,
    });
    shell = alepha.inject(ShellProvider);
    await alepha.start();
  });

  afterAll(async () => {
    await alepha?.stop().catch(() => {});
  });

  describe("run with capture", () => {
    it("should capture stdout from a simple command", async () => {
      const out = await shell.run("echo hello-bun", { capture: true });
      expect(out.trim()).toBe("hello-bun");
    });

    it("should respect cwd", async () => {
      const out = await shell.run("pwd", { capture: true, root: "/tmp" });
      // macOS resolves /tmp -> /private/tmp via symlink
      expect(out.trim()).toMatch(/\/tmp$/);
    });

    it("should pass env vars", async () => {
      const out = await shell.run("printenv ALEPHA_TEST_VAR", {
        capture: true,
        env: { ALEPHA_TEST_VAR: "xyz-123" },
      });
      expect(out.trim()).toBe("xyz-123");
    });

    it("should reject when command exits non-zero", async () => {
      await expect(
        shell.run("sh -c 'exit 7'", { capture: true }),
      ).rejects.toThrow(/exited with code 7/);
    });
  });

  describe("run with inherit", () => {
    it("should resolve successfully for a zero-exit command", async () => {
      const out = await shell.run("true");
      expect(out).toBe("");
    });

    it("should reject when an inherited command exits non-zero", async () => {
      await expect(shell.run("false")).rejects.toThrow(/exited with code/);
    });
  });

  describe("isInstalled", () => {
    it("should return true for a command that exists", async () => {
      expect(await shell.isInstalled("sh")).toBe(true);
    });

    it("should return false for a command that does not exist", async () => {
      expect(await shell.isInstalled("definitely-not-a-real-binary-xyz")).toBe(
        false,
      );
    });
  });
});
