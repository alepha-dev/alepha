import pkg from "@alepha/lore/package.json" with { type: "json" };
import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import { describe, it } from "vitest";

import { RootCommand } from "../commands/RootCommand.ts";

/**
 * `lore --version` (#Q3994): the version, bare, the way `alepha --version`
 * prints it, so `VERSION=$(lore --version)` is exactly it.
 */
describe("lore --version", () => {
  const run = async (argv: string) => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "error" } }).with({
      provide: ConsoleOutputProvider,
      use: MemoryOutputProvider,
    });
    // Not started: a started CLI runs the root command itself, from the
    // process's own argv.
    const command = alepha.inject(RootCommand);
    await alepha.inject(CliProvider).run(command.root as never, { argv });
    return alepha.inject(MemoryOutputProvider).lines;
  };

  it("prints exactly one line, the version, when piped", async ({ expect }) => {
    // A spec's stdout is not a terminal: the runtime line stays out.
    expect(await run("--version")).toEqual([pkg.version]);
  });

  it("takes -v for the same", async ({ expect }) => {
    expect(await run("-v")).toEqual([pkg.version]);
  });

  it("still prints the command list with no flag", async ({ expect }) => {
    const printed = await run("");
    expect(printed.join("\n")).toContain("--version, -v");
    expect(printed).not.toContain(pkg.version);
  });
});
