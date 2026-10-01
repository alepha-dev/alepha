import { Alepha } from "alepha";
import { AlephaCommand, CliProvider } from "alepha/command";
import { describe, expect, it } from "vitest";

import { buildOptions } from "../atoms/buildOptions.ts";
import { AlephaCli, AlephaCliServices } from "../index.ts";
import { BuildCloudflareTask } from "../tasks/BuildCloudflareTask.ts";

/**
 * Which module a build task belongs to, asserted from the outside.
 *
 * ⚠️ The leak this guards has no import graph to read. `Alepha.inject`
 * registers the module that DECLARES a service, through a `[MODULE]`
 * back-reference, so a task declared beside the twelve `*Command` classes
 * pulls all twenty-five commands into any container that injects one. That is
 * what `lore apps build` would have done: a second `build`, `dev`, `db` and
 * `verify` under the `lore` binary's name and release cadence.
 *
 * `@alepha/lore`'s own `commandSurface.spec.ts` asserts the same property from
 * the consumer's side. This half fails in the package that caused it, so the
 * next person to add a task learns the rule where the task is written.
 */
class TestCliProvider extends CliProvider {
  public testGetTopLevelCommands = this.getTopLevelCommands.bind(this);
}

describe("the CLI's build tasks and its commands", () => {
  const cliOf = (register: (alepha: Alepha) => void) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: CliProvider,
      use: TestCliProvider,
    });
    register(alepha);
    return alepha.inject(TestCliProvider);
  };

  it("registers no command for a container that only wanted a build task", () => {
    const cli = cliOf((alepha) => {
      alepha.with(AlephaCommand).with(AlephaCliServices);
      alepha.inject(BuildCloudflareTask);
    });

    // `commands`, not `getTopLevelCommands`: the latter subtracts by
    // `children`, so a command merely absent from the help still runs.
    expect(cli.commands.map((command) => command.name)).toEqual([]);
  });

  it("keeps every one of them when the full CLI module is registered", () => {
    const cli = cliOf((alepha) => {
      alepha.with(AlephaCommand).with(AlephaCli);
    });

    const names = cli.commands.map((command) => command.name);
    for (const command of [
      "build",
      "clean",
      "db",
      "dev",
      "gen",
      "init",
      "lint",
      "pack",
      "test",
      "typecheck",
      "verify",
    ]) {
      expect(names).toContain(command);
    }
  });

  it("resolves the buildOptions atom without the commands", () => {
    // The atom moved with the tasks. Left behind on `AlephaCli` it would read
    // as unregistered from exactly the container the move exists to serve.
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with(
      AlephaCliServices,
    );
    alepha.inject(BuildCloudflareTask);

    expect(alepha.store.get(buildOptions)).toBeDefined();
  });
});
