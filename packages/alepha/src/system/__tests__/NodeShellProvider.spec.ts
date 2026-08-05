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

  describe("run with stdin", () => {
    it("pipes bytes into an argv command and captures what it echoes back", async () => {
      const out = await shell.run(
        ["node", "-e", "process.stdin.pipe(process.stdout)"],
        { capture: true, stdin: "piped-in" },
      );

      expect(out).toContain("piped-in");
    });

    it("pipes binary bytes through unchanged", async () => {
      // The artifact BayAdapter sends is a gzip stream, so a byte that is not
      // valid UTF-8 has to survive. A string-only implementation mangles this.
      const bytes = new Uint8Array([0x1f, 0x8b, 0x00, 0xff, 0xfe]);

      const out = await shell.run(
        [
          "node",
          "-e",
          "const c=[];process.stdin.on('data',d=>c.push(d));" +
            "process.stdin.on('end',()=>process.stdout.write(" +
            "Buffer.concat(c).toString('hex')))",
        ],
        { capture: true, stdin: bytes },
      );

      expect(out.trim()).toBe("1f8b00fffe");
    });

    it("closes stdin so a command that reads to EOF terminates", async () => {
      // Without an explicit end() the child waits forever and the test times
      // out — which is exactly how a deploy would hang.
      const out = await shell.run(
        [
          "node",
          "-e",
          "const c=[];process.stdin.on('data',d=>c.push(d));" +
            "process.stdin.on('end',()=>process.stdout.write('eof:'+" +
            "Buffer.concat(c).length))",
        ],
        { capture: true, stdin: "abc" },
      );

      expect(out.trim()).toBe("eof:3");
    });

    it("refuses stdin on the shell-string form rather than dropping it", async () => {
      // The string form is parsed and re-quoted for a shell; there is no argv
      // to attach a pipe to. Ignoring the option would lose the caller's data
      // silently, which is the worst of the three options.
      await expect(
        shell.run("node -e 'process.exit(0)'", { stdin: "x" }),
      ).rejects.toThrowError(/argv/i);
    });
  });
});
