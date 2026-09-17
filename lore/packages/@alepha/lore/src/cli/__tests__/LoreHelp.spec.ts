import { Alepha, type ZObject, type ZType } from "alepha";
import {
  AlephaCommand,
  CliProvider,
  type CommandPrimitive,
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
} from "alepha/command";
import { LinkProvider } from "alepha/server/links";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { AlephaLoreCli } from "../index.ts";
import { LoreConventions } from "../services/LoreConventions.ts";

/**
 * The help is the `lore` CLI's documentation, and nothing else is: no skill,
 * no guide page (the owner's answer to epic #E45's question 4). So it is held
 * to a bar, over EVERY command in the container, the older verbs included.
 */
class TestCliProvider extends CliProvider {
  public testExtractFlagDefs = this.extractFlagDefs.bind(this);
  public testSchemaMeta = this.schemaMeta.bind(this);
  public testGetCommandPath = this.getCommandPath.bind(this);
}

const setup = () => {
  const alepha = Alepha.create({
    env: { LOG_LEVEL: "error", NO_COLOR: "true" },
  })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: LinkProvider, use: LinkProvider })
    .with({ provide: CliProvider, use: TestCliProvider })
    .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
    .with(AlephaCommand)
    .with(AlephaLoreCli);
  alepha.store.mut(cliOptions, (options) => ({
    ...options,
    name: "lore",
    description: LoreConventions.describe("0.0.0"),
  }));

  return {
    cli: alepha.inject(TestCliProvider),
    out: alepha.inject(MemoryOutputProvider),
  };
};

describe("lore -h and lore help", () => {
  it("describes every flag of every command", ({ expect }) => {
    const { cli } = setup();

    const undescribed = cli.commands.flatMap((command: CommandPrimitive) =>
      cli
        .testExtractFlagDefs(command.flags as ZObject)
        .filter((flag) => !flag.description?.trim())
        .map((flag) => `lore ${cli.testGetCommandPath(command)} --${flag.key}`),
    );

    expect(undescribed).toEqual([]);
  });

  it("titles every positional, so no help reads <arg1>", ({ expect }) => {
    const { cli, out } = setup();

    const untitled = cli.commands
      .filter((command: CommandPrimitive) => command.options.args)
      .filter(
        (command: CommandPrimitive) =>
          !cli.testSchemaMeta(command.options.args as ZType).title,
      )
      .map(
        (command: CommandPrimitive) =>
          `lore ${cli.testGetCommandPath(command)}`,
      );
    expect(untitled).toEqual([]);

    cli.printHelp();
    for (const command of cli.commands) {
      cli.printHelp(command);
    }
    expect(out.text).not.toContain("arg1");
  });

  it("describes every command, what each subject covers included", ({
    expect,
  }) => {
    const { cli } = setup();

    const bare = cli.commands
      .filter((command: CommandPrimitive) => !command.options.hide)
      .filter(
        (command: CommandPrimitive) => !command.options.description?.trim(),
      )
      .map(
        (command: CommandPrimitive) =>
          `lore ${cli.testGetCommandPath(command)}`,
      );

    expect(bare).toEqual([]);
  });

  /**
   * What cannot be discovered one command at a time: auth, the project, the
   * naming rule, output, bodies, references and exit codes.
   */
  it("opens the root help with the conventions, in at most twelve lines", ({
    expect,
  }) => {
    const block = LoreConventions.describe("1.2.3");

    expect(block.split("\n").length).toBeLessThanOrEqual(12);
    for (const word of [
      "lore login",
      "LORE_API_KEY",
      "LORE_URL",
      "LORE_PROJECT",
      "lore quest create",
      "--output json",
      "@file",
      "'#Q12'",
      "3 not authenticated",
      "4 forbidden",
    ]) {
      expect(block).toContain(word);
    }

    const { cli, out } = setup();
    cli.printHelp();
    expect(
      out.text.startsWith(`\n${LoreConventions.describe("0.0.0")}\n`),
    ).toBe(true);
    expect(out.text).toContain("Commands:");
  });

  it("prints the same page for lore help quest create as for lore quest create -h", async ({
    expect,
  }) => {
    const page = async (argv: string[]) => {
      const alepha = Alepha.create({
        env: { LOG_LEVEL: "error", NO_COLOR: "true" },
      })
        .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
        .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider })
        .with(AlephaCommand)
        .with(AlephaLoreCli);
      alepha.store.mut(cliOptions, (options) => ({
        ...options,
        name: "lore",
        argv,
      }));
      await alepha.start();
      const exitCode = process.exitCode;
      process.exitCode = 0;
      return { text: alepha.inject(MemoryOutputProvider).text, exitCode };
    };

    const word = await page(["help", "quest", "create"]);
    const flag = await page(["quest", "create", "-h"]);

    expect(word.text).toContain("Usage: lore quest create");
    expect(word.text).toContain("(takes @file, or @- for stdin");
    expect(word.text).toBe(flag.text);
    expect(word.exitCode).not.toBe(1);
  });
});
