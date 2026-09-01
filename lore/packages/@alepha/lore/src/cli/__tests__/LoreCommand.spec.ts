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

  it("carries both verbs", async () => {
    const alepha = await setup();

    const lore = alepha.inject(LoreCommand).lore;

    expect(lore.children.map((child) => child.name).sort()).toEqual([
      "artifacts",
      "quality",
    ]);
  });

  it("keeps each verb's own subcommand reachable", async () => {
    const alepha = await setup();

    const lore = alepha.inject(LoreCommand).lore;
    for (const verb of lore.children) {
      expect(verb.children.map((child) => child.name)).toEqual(["push"]);
    }
  });
});
