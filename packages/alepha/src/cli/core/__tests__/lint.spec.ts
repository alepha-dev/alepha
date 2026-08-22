import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { LintCommand } from "../commands/lint.ts";
import { AlephaCliUtils } from "../services/AlephaCliUtils.ts";

describe("alepha lint", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      alepha,
      fs: alepha.inject(MemoryFileSystemProvider),
      shell: alepha.inject(MemoryShellProvider),
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(LintCommand),
    };
  };

  it("should run oxlint first, then oxfmt", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.lint, { root: "/project" });

    const [lint, format] = shell.calls;
    expect(lint.command).toMatch(/oxlint/);
    expect(format.command).toMatch(/oxfmt/);
  });

  /**
   * The two halves of the toolchain disagree about `node_modules`: oxfmt skips
   * it unless asked not to, oxlint has no built-in exclusion and honours only
   * the ignore files it finds. So a project with no `.gitignore` on disk has
   * `oxlint --fix` walk into its dependencies and rewrite them.
   *
   * `alepha init` reaches exactly that state: it lints before `ensureGitRepo`
   * writes the `.gitignore`, and skips that write altogether when the
   * directory was already a git repository. A `--preset saas` scaffold
   * reported 258k errors from `node_modules` and edited 460 files across
   * drizzle-kit, react-dom and alepha's own installed `dist`.
   */
  it("should keep oxlint out of node_modules without relying on .gitignore", async () => {
    const { shell, cli, cmd } = createTestEnv();

    await cli.run(cmd.lint, { root: "/project" });

    expect(
      shell.wasCalledMatching(/oxlint.*--ignore-pattern node_modules/),
    ).toBe(true);
  });

  /**
   * Held rather than thrown, so a project with one unfixable lint error still
   * gets formatted instead of being left half-done.
   */
  it("should still format when oxlint fails, then report the failure", async () => {
    const { alepha, shell, cli, cmd } = createTestEnv();
    const oxlint = alepha.inject(AlephaCliUtils).resolveBin("oxlint");
    shell.errors.set(
      `node "${oxlint}" --fix --ignore-pattern node_modules`,
      "one unfixable finding",
    );

    await expect(cli.run(cmd.lint, { root: "/project" })).rejects.toThrow();

    expect(shell.wasCalledMatching(/oxfmt/)).toBe(true);
  });
});
