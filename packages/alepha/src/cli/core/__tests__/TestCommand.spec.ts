import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { TestCommand } from "../commands/test.ts";

describe("alepha test", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      shell: alepha.inject(MemoryShellProvider),
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(TestCommand),
    };
  };

  it("should not pass --project when the flag is absent", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.test, { root: "/project" });

    expect(shell.calls[0].command).not.toMatch(/--project/);
  });

  /**
   * Project names are package names, and this repo's own CLAUDE.md spells a
   * workspace selection `--project '<name>*'`. `--project` does not declare
   * `atFile`, so a leading `@` is a literal: reading it as a file would look
   * for `alepha/ui*` and refuse a command the docs tell people to type.
   */
  it("should forward a scoped package project with its leading @ as typed", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.test, {
      argv: ["--project", "@alepha/ui*"],
      root: "/project",
    });

    expect(shell.calls[0].command).toMatch(/--project @alepha\/ui\*/);
  });

  it("should forward a single project to vitest", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.test, { argv: "--project alepha", root: "/project" });

    expect(shell.calls[0].command).toMatch(/--project alepha\b/);
  });

  /**
   * A workspace with browser specs owns two projects, `lore` and `lore:jsdom`,
   * so selecting one workspace whole is a glob. The value reaches the shell as
   * a literal argument (`ShellProvider.run(string)` never lets a token expand),
   * which is what keeps `lore*` from being resolved against the filesystem
   * before vitest ever sees it.
   */
  it("should forward a comma-separated list as one flag per project", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.test, {
      argv: "--project lore*,alepha",
      root: "/project",
    });

    const { command } = shell.calls[0];
    expect(command).toMatch(/--project lore\*/);
    expect(command).toMatch(/--project alepha\b/);
  });

  it("should ignore blank entries in the list", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.test, { argv: "--project alepha,,", root: "/project" });

    expect(shell.calls[0].command.match(/--project/g)).toHaveLength(1);
  });
});
