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
   * Eight, and no root of their own: the binary IS the root, so a `lore`
   * command inside it would read `lore lore quality push`.
   *
   * `deploy` is the one verb promoted out of a subject, because it is the
   * inner loop and `lore apps deploy` is two words for one act. Nothing else
   * is: see {@link AppsCommand.deployCommand} for why `build` and `destroy`
   * stay where they are.
   */
  it("puts the eight Lore verbs at the top level", () => {
    const names = setup()
      .testGetTopLevelCommands()
      .map((command) => command.name)
      .sort();

    expect(names).toEqual([
      "apps",
      "artifacts",
      "attachments",
      "deploy",
      "login",
      "logout",
      "quality",
      "releases",
    ]);
  });

  /**
   * ⚠️ One flags schema and one handler, asserted by IDENTITY rather than by
   * comparing two `--help` outputs. Two `$command`s that mean the same thing
   * are exactly the shape that drifts, and a structural comparison would go on
   * passing while one grew an alias the other did not.
   */
  it("gives `lore deploy` and `lore apps deploy` the same flags object", () => {
    const cli = setup();
    const top = cli
      .testGetTopLevelCommands()
      .find((command) => command.name === "deploy");
    const child = cli
      .testGetTopLevelCommands()
      .find((command) => command.name === "apps")
      ?.children.find((command) => command.name === "deploy");

    expect(top).toBeDefined();
    expect(child).toBeDefined();
    // Two primitives, so not the same command...
    expect(top).not.toBe(child);
    // ...over one schema.
    expect(top!.flags).toBe(child!.flags);
    expect(top!.options.description).toBe(child!.options.description);
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
      apps: ["build", "deploy", "destroy"],
      artifacts: ["push"],
      attachments: ["push"],
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
   *
   * ⚠️ **`build` is checked by PARENT, not by name.** `lore apps build`
   * registers a command called `build`, because a child is named by its leaf -
   * so a bare name test started failing as a false positive the moment that
   * command existed. The two wrong fixes were both available: dropping `build`
   * from the list would unguard the single name most likely to leak, since
   * `BuildCommand` is exactly what #1809 moved away from; renaming the verb
   * would make the CLI worse to use to keep a test green. What separates them
   * is where the command sits - a leaked `alepha build` is TOP-LEVEL, and ours
   * is a child of `apps`.
   */
  it.each([
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

  it("carries no top-level `build`, which is the framework's", () => {
    // The same guard as the cases above, expressed so `lore apps build` passes
    // and `alepha build` leaking in still fails.
    const cli = setup();
    const top = cli.testGetTopLevelCommands().map((command) => command.name);

    expect(top).not.toContain("build");
    // ...and ours is still there, one level down, so this cannot pass by the
    // command having disappeared.
    expect(
      cli
        .testGetTopLevelCommands()
        .find((command) => command.name === "apps")
        ?.children.map((child) => child.name),
    ).toEqual(["build", "deploy", "destroy"]);
  });
});
