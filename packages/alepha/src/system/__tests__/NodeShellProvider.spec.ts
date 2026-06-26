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
  });
});
