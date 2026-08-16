import { Alepha } from "alepha";
import { Asker, CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";
import { CreateAlephaCoreCommands } from "./CreateAlephaCoreCommands.ts";

/**
 * Every test here supplies the project name and preset through `args`/
 * `flags`, so the only question the handler ever reaches is "Include
 * @alepha/devtools?". An empty answer is enough to clear it: `ask.confirm`
 * falls back to its `default: true` on a blank line, exactly like a real
 * terminal user pressing Enter.
 *
 * Without this substitution the real `Asker` opens a `readline` interface on
 * the process's actual stdin, which never answers in a test run and hangs
 * every test that reaches the prompt until the suite times out.
 */
class AutoAnswerAsker extends Asker {
  protected createPromptInterface(): any {
    return {
      question: () => Promise.resolve(""),
      once: () => {},
      off: () => {},
      close: () => {},
    };
  }
}

/**
 * `create-alepha` is a thin wrapper over `ProjectScaffolder.init`, so these
 * assert the wiring — that a flag typed at the prompt reaches the scaffolder —
 * rather than re-testing what `init-preset.spec.ts` already covers.
 */
describe("create-alepha", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: Asker, use: AutoAnswerAsker });

    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(CreateAlephaCoreCommands),
    };
  };

  const readDependencies = async (fs: MemoryFileSystemProvider) =>
    (
      await fs.readJsonFile<{ dependencies: Record<string, string> }>(
        "/project/my-app/package.json",
      )
    ).dependencies;

  it("should scaffold the default preset when no flag is given", async () => {
    const { fs, cli, cmd } = createTestEnv();

    await cli.run(cmd.root, { argv: "my-app", root: "/project" });

    expect(await readDependencies(fs)).not.toHaveProperty("@alepha/ui");
  });

  /**
   * Space-separated on purpose: this is the form `npm create alepha my-app
   * --preset saas` produces, and it is the one that can go wrong — the parser
   * has to consume `saas` as the flag's value rather than leave it in the
   * positional list, where it would become the project name.
   */
  it("should forward --preset saas to the scaffolder", async () => {
    const { fs, cli, cmd } = createTestEnv();

    await cli.run(cmd.root, {
      argv: "my-app --preset saas",
      root: "/project",
    });

    expect(await readDependencies(fs)).toHaveProperty("@alepha/ui");
  });

  it("should accept --preset=saas", async () => {
    const { fs, cli, cmd } = createTestEnv();

    await cli.run(cmd.root, {
      argv: "my-app --preset=saas",
      root: "/project",
    });

    expect(await readDependencies(fs)).toHaveProperty("@alepha/ui");
  });

  it("should take the project name from the positional, not the flag value", async () => {
    const { fs, cli, cmd } = createTestEnv();

    await cli.run(cmd.root, {
      argv: "my-app --preset saas",
      root: "/project",
    });

    expect(await fs.exists("/project/my-app/package.json")).toBe(true);
    expect(await fs.exists("/project/saas/package.json")).toBe(false);
  });

  /**
   * Asserts on the message, not just that it throws: before the flag existed
   * this rejected too, as `Unknown flag: --preset`. Naming the enum is what
   * distinguishes a validated value from an unrecognised one.
   */
  it("should reject an unknown preset name", async () => {
    const { cli, cmd } = createTestEnv();

    await expect(
      cli.run(cmd.root, { argv: "my-app --preset blog", root: "/project" }),
    ).rejects.toThrow(/saas/);
  });
});
