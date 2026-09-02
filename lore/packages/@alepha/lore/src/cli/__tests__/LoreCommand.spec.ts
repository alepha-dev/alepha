import { Alepha } from "alepha";
import type { CommandPrimitive } from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { LoreCommand } from "../commands/LoreCommand.ts";
import { AlephaLoreCliPlugin } from "../index.ts";

/**
 * ⚠️ The regression guard for a failure that is silent by construction.
 *
 * `CliProvider.findCommand` resolves a name with `findLast`, so two classes
 * declaring `lore` do not collide loudly: the second SHADOWS the first and the
 * losing subtree simply stops existing. `alepha lore quality push` would keep
 * typechecking, keep being registered, and answer "unknown command".
 *
 * Nothing in the type system ties a command's name to its uniqueness, so this
 * is the only thing that turns that into a red test.
 */
describe("alepha lore", () => {
  const setup = async () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: LinkProvider, use: LinkProvider })
      .with(AlephaLoreCliPlugin);

    await alepha.start();
    return alepha;
  };

  it("is declared exactly once", async () => {
    const alepha = await setup();

    const roots = alepha
      .primitives<CommandPrimitive<any>>("$command")
      .filter((command) => command.name === "lore");

    expect(roots).toHaveLength(1);
  });

  it("carries every verb", async () => {
    const alepha = await setup();

    const lore = alepha.inject(LoreCommand).lore;

    expect(lore.children.map((child) => child.name).sort()).toEqual([
      "artifacts",
      "login",
      "logout",
      "quality",
      "releases",
    ]);
  });

  /**
   * `quality`, `artifacts` and `releases` are nouns holding a verb; `login`
   * and `logout` are verbs in their own right and sit directly under `lore`,
   * because `alepha lore auth login` would be a noun invented to hold two
   * commands.
   */
  it("keeps each subject's own subcommand reachable", async () => {
    const alepha = await setup();

    const lore = alepha.inject(LoreCommand).lore;
    const subjects = lore.children.filter((child) => child.hasChildren);

    const verbs = Object.fromEntries(
      subjects.map((subject) => [
        subject.name,
        subject.children.map((child) => child.name),
      ]),
    );
    expect(verbs).toEqual({
      artifacts: ["push"],
      quality: ["push"],
      releases: ["publish"],
    });
  });
});
