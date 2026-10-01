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
      expect(shell.run("sh -c 'exit 7'", { capture: true })).rejects.toThrow(
        /exited with code 7/,
      );
    });
  });

  describe("run with inherit", () => {
    it("should resolve successfully for a zero-exit command", async () => {
      const out = await shell.run("true");
      expect(out).toBe("");
    });

    it("should reject when an inherited command exits non-zero", async () => {
      expect(shell.run("false")).rejects.toThrow(/exited with code/);
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

  /**
   * Mirror of `shellStringContract.spec.ts` (Node). Review #2 recorded these
   * as diverging between the two runtimes; they no longer do, and this table
   * is what keeps them from drifting apart again. Every token in the string
   * form is a literal argument — a pipeline needs an explicit `sh -c`.
   */
  describe("string form — literal argument contract (parity with Node)", () => {
    it("does not treat && as a command separator", async () => {
      const out = await shell.run("echo hello && echo world", {
        capture: true,
      });
      expect(out.trim()).toBe("hello && echo world");
    });

    it("does not treat | as a pipe", async () => {
      const out = await shell.run("echo a | tr a b", { capture: true });
      expect(out.trim()).toBe("a | tr a b");
    });

    it("does not expand environment variables", async () => {
      const out = await shell.run("echo $HOME", { capture: true });
      expect(out.trim()).toBe("$HOME");
    });

    it("does not evaluate command substitution", async () => {
      const out = await shell.run("echo $(id -u)", { capture: true });
      expect(out.trim()).toBe("$(id -u)");
    });

    it("does not treat ; as a separator", async () => {
      const out = await shell.run("echo one ; echo two", { capture: true });
      expect(out.trim()).toBe("one ; echo two");
    });

    it("keeps quoted arguments together", async () => {
      const out = await shell.run('echo "one two"', { capture: true });
      expect(out.trim()).toBe("one two");
    });

    it("runs a pipeline only when the caller asks for a shell explicitly", async () => {
      const out = await shell.run(["sh", "-c", "echo a | tr a b"], {
        capture: true,
      });
      expect(out.trim()).toBe("b");
    });

    it("preserves a single quote inside a double-quoted argument", async () => {
      // Regression: the old Bun capture path re-parsed the POSIX-escaped
      // string (`'it'\''s'`) with parseCommand, producing `it\s`. The
      // engine now receives argv directly.
      const out = await shell.run(`echo "it's"`, { capture: true });
      expect(out.trim()).toBe("it's");
    });
  });

  describe("capture (structured result)", () => {
    it("resolves with the exit code instead of throwing", async () => {
      const result = await shell.capture(["sh", "-c", "printf out; exit 5"]);
      expect(result.exitCode).toBe(5);
      expect(result.stdout).toBe("out");
    });

    it("resolves with stdout on success", async () => {
      const result = await shell.capture(["sh", "-c", "printf ok"]);
      expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
    });
  });

  describe("timeout", () => {
    it("kills a hung capture after the timeout", async () => {
      expect(
        shell.run(["sleep", "60"], { capture: true, timeout: 300 }),
      ).rejects.toThrow(/timed out after 300ms/);
    });

    it("kills a hung inherited command after the timeout", async () => {
      expect(shell.run(["sleep", "60"], { timeout: 300 })).rejects.toThrow(
        /timed out after 300ms/,
      );
    });
  });
});
