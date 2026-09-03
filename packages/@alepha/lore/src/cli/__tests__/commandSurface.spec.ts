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

import { AlephaLoreCliPlugin } from "../index.ts";

/**
 * What a `lore` binary would actually offer.
 *
 * ⚠️ The regression guard for a leak that no import graph shows.
 * `Alepha.inject` registers the module that DECLARES a service, through a
 * `[MODULE]` back-reference, so injecting one command from `alepha/cli`
 * registers `AlephaCli` entire. Measured before the fix: a container of
 * `AlephaCommand` plus an `inject(PackCommand)` reported 25 commands, among
 * them `build`, `dev`, `db` and `verify`.
 *
 * Neither obvious escape works, which is why this is a test rather than a
 * filter. `getTopLevelCommands` subtracts by `children`, so hiding `pack`
 * that way would publish it as `lore artifacts pack`; and `hide` is read only
 * by the help renderer, so a hidden `build` still executes. A binary that
 * lies about what it does is worse than one that leaks.
 *
 * The fix is that packing lives in `WorkspacePacker`, declared by the
 * command-free `AlephaCliServices`. Nothing about that is visible at the call
 * site, so this asserts the outcome instead.
 */
describe("the Lore CLI command surface", () => {
  const setup = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: LinkProvider })
      .with(AlephaCommand)
      .with(AlephaLoreCliPlugin);

    return alepha.inject(CliProvider);
  };

  it("registers the five Lore verbs and nothing else", () => {
    const names = setup()
      .commands.map((command) => command.name)
      .sort();

    expect(names).toEqual([
      "artifacts",
      "login",
      "logout",
      "lore",
      "publish",
      "push",
      "push",
      "quality",
      "releases",
    ]);
  });

  /**
   * Named one by one rather than left to the assertion above, so a failure
   * says which framework command came back instead of printing a diff of
   * twenty-five names.
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
