import { Alepha } from "alepha";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NodeShellProvider } from "../providers/NodeShellProvider.ts";
import { ShellProvider } from "../providers/ShellProvider.ts";

// ---------------------------------------------------------------------------------------------------------------------

describe("NodeShellProvider", () => {
  let alepha: Alepha;
  let shell: ShellProvider;

  beforeAll(async () => {
    alepha = Alepha.create().with({
      provide: ShellProvider,
      use: NodeShellProvider,
    });
    shell = alepha.inject(ShellProvider);
    await alepha.start();
  });

  afterAll(async () => {
    await alepha?.stop().catch(() => {});
  });

  describe("run with capture", () => {
    it("captures stdout from a successful command", async () => {
      const cmd = `node -e "process.stdout.write('hello-node')"`;
      const out = await shell.run(cmd, { capture: true });
      expect(out).toContain("hello-node");
    });

    it("attaches both stdout and stderr to the error on failure", async () => {
      const cmd = `node -e "process.stdout.write('OUT');process.stderr.write('ERR');process.exit(3)"`;

      const err = await shell.run(cmd, { capture: true }).then(
        () => {
          throw new Error("expected the command to reject");
        },
        (e) => e as { stdout?: string; stderr?: string },
      );

      expect(err.stdout).toContain("OUT");
      expect(err.stderr).toContain("ERR");
    });

    it("does not execute shell metacharacters embedded in an argument", async () => {
      // `;` was missing from the escape set — "echo foo;id" executed `id`.
      const out = await shell.run("echo foo;id", { capture: true });
      expect(out.trim()).toBe("foo;id");
    });

    it("does not expand command substitution in an argument", async () => {
      // Double-quoted escaping still expanded `$(...)`; args must stay literal.
      const out = await shell.run("echo $(id)", { capture: true });
      expect(out.trim()).toBe("$(id)");
    });
  });

  describe("run with argv array", () => {
    it("captures stdout with args passed verbatim (no shell)", async () => {
      const hostile = "a;b|c`$(id)'\"";
      const out = await shell.run(
        ["node", "-e", "process.stdout.write(process.argv[1])", hostile],
        { capture: true },
      );
      expect(out).toBe(hostile);
    });

    it("attaches stdout/stderr to the error on failure", async () => {
      const err = await shell
        .run(
          [
            "node",
            "-e",
            "process.stdout.write('OUT');process.stderr.write('ERR');process.exit(3)",
          ],
          { capture: true },
        )
        .then(
          () => {
            throw new Error("expected the command to reject");
          },
          (e) => e as { stdout?: string; stderr?: string },
        );

      expect(err.stdout).toContain("OUT");
      expect(err.stderr).toContain("ERR");
    });
  });

  describe("isInstalled", () => {
    it("returns true for an installed command", async () => {
      await expect(shell.isInstalled("node")).resolves.toBe(true);
    });

    it("rejects names containing shell metacharacters without executing them", async () => {
      await expect(shell.isInstalled("node; echo pwned")).resolves.toBe(false);
    });
  });
});
