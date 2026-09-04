import { Alepha } from "alepha";
import { AlephaCommand, CliProvider } from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { AlephaLoreCli } from "../index.ts";

/**
 * What `lore --help` offers, asserted against the container the bin builds.
 *
 * ⚠️ The regression guard for a leak that no import graph shows.
 * `Alepha.inject` registers the module that DECLARES a service, through a
 * `[MODULE]` back-reference, so injecting one command from `alepha/cli`
 * registers `AlephaCli` entire. Measured: a container of `AlephaCommand` plus
 * an `inject(PackCommand)` reports 25 commands, among them `build`, `dev`,
 * `db` and `verify`.
 *
 * Neither obvious escape works, which is why this is a test rather than a
 * filter. {@link CliProvider.getTopLevelCommands} subtracts by `children`, so
 * hiding `pack` that way would publish it as `lore artifacts pack`; and `hide`
 * is read only by the help renderer, so a hidden `build` would still execute.
 * A binary that lies about what it does is worse than one that leaks.
 */
class TestCliProvider extends CliProvider {
  public testGetTopLevelCommands = this.getTopLevelCommands.bind(this);
}

describe("the Lore CLI command surface", () => {
  const setup = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: LinkProvider })
      .with({ provide: CliProvider, use: TestCliProvider })
      .with(AlephaCommand)
      .with(AlephaLoreCli);

    return alepha.inject(TestCliProvider);
  };

  /**
   * Five, and no root of their own: the binary IS the root, so a `lore`
   * command inside it would read `lore lore quality push`.
   */
  it("puts the five Lore verbs at the top level", () => {
    const names = setup()
      .testGetTopLevelCommands()
      .map((command) => command.name)
      .sort();

    expect(names).toEqual([
      "artifacts",
      "login",
      "logout",
      "quality",
      "releases",
    ]);
  });

  it("keeps each subject's own verb reachable underneath", () => {
    const subjects = setup()
      .testGetTopLevelCommands()
      .filter((command) => command.hasChildren);

    expect(
      Object.fromEntries(
        subjects.map((subject) => [
          subject.name,
          subject.children.map((child) => child.name),
        ]),
      ),
    ).toEqual({
      artifacts: ["push"],
      quality: ["push"],
      releases: ["publish"],
    });
  });

  /**
   * Named one by one rather than left to the assertion above, so a failure
   * says which framework command came back instead of printing a diff of
   * twenty-five names. `getTopLevelCommands` is deliberately NOT used here:
   * `findCommand` resolves against every registered command, so one that is
   * merely absent from the help still runs.
   */
  it.each([
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
  ])("does not carry the Alepha CLI's `%s`", (leaked) => {
    const names = setup().commands.map((command) => command.name);

    expect(names).not.toContain(leaked);
  });
});
