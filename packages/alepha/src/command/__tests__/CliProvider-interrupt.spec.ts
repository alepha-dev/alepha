import { $inject, Alepha, type ZObject } from "alepha";
import { NodeShellProvider, ShellProvider } from "alepha/system";
import { afterEach, describe, it } from "vitest";

import { $command, CliProvider, type CommandPrimitive } from "../index.ts";

/**
 * Exposes the production execution path, the one that opens the command's
 * context.
 */
class TestCliProvider extends CliProvider {
  public testExecute = (command: CommandPrimitive<ZObject>) =>
    this.executeCommand(command, [], true);
}

/**
 * A command runs under a signal aborted on SIGINT / SIGTERM (#E85), so a
 * child it spawned is killed with it.
 */
describe("CliProvider interrupt", () => {
  // Keeps the default exit off while the spec emits the signal itself: with
  // another listener present, the command's handler does not re-raise it.
  const keepAlive = () => {};
  afterEach(() => {
    process.off("SIGINT", keepAlive);
    process.off("SIGTERM", keepAlive);
  });

  for (const name of ["SIGINT", "SIGTERM"] as const) {
    it(`aborts the command's signal on ${name} and kills its child`, async ({
      expect,
    }) => {
      process.on(name, keepAlive);
      let outcome: unknown;
      let started!: () => void;
      const starting = new Promise<void>((r) => {
        started = r;
      });

      class Commands {
        shell = $inject(ShellProvider);
        work = $command({
          name: "work",
          handler: async () => {
            started();
            try {
              await this.shell.run(["sleep", "5"]);
            } catch (error) {
              outcome = error;
            }
          },
        });
      }

      const alepha = Alepha.create().with({
        provide: ShellProvider,
        use: NodeShellProvider,
      });
      const commands = alepha.inject(Commands);
      const cli = alepha.inject(TestCliProvider);

      const startedAt = performance.now();
      const run = cli.testExecute(commands.work);
      await starting;
      await new Promise((r) => setTimeout(r, 50));
      process.emit(name, name);
      await run;

      expect(performance.now() - startedAt).toBeLessThan(2000);
      expect(alepha.context.isAbortError(outcome)).toBe(true);
      // The command's listeners are gone once it finished.
      expect(process.listeners(name)).toEqual([keepAlive]);
    });
  }

  it("leaves no signal listener behind after a command that was not interrupted", async ({
    expect,
  }) => {
    const before = process.listenerCount("SIGINT");
    class Commands {
      work = $command({ name: "work", handler: async () => {} });
    }
    const alepha = Alepha.create();
    const commands = alepha.inject(Commands);
    const cli = alepha.inject(TestCliProvider);

    await cli.testExecute(commands.work);

    expect(process.listenerCount("SIGINT")).toBe(before);
  });
});
