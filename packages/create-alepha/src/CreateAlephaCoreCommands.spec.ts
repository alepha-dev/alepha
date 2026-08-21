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
 * Answers a bounded number of questions with an empty line, through the same
 * seam the real terminal uses: `createPromptInterface()`. That is the one
 * protected hook `Asker` exposes for this (mirroring `TestAsker` in
 * `Asker.spec.ts`), so the actual `chooseOne` / `confirmValue` / `promptValue`
 * parsing still runs — this only replaces the `readline` interface underneath
 * it, not the `ask.*` methods themselves. An empty answer resolves to
 * whatever `default` the question was given, exactly like a real user
 * pressing Enter, so tests that supply `name`/`preset` via `args`/`flags` and
 * reach only the devtools question get its `default: true` for free.
 *
 * `questionCount` lets a test assert that a fully flagged invocation reaches
 * `scaffolder.init` without asking anything at all — the promptless path
 * this fix exists to restore — rather than merely asserting the double
 * wasn't left unused.
 *
 * Without this substitution the real `Asker` opens a `readline` interface on
 * the process's actual stdin, which never answers in a test run and hangs
 * every test that reaches a prompt until the suite times out.
 *
 * The answer supply is finite (mirroring `FakeInterface` in `Asker.spec.ts`),
 * not infinite: `CreateAlephaCoreCommands` asks at most three questions
 * (name, preset, devtools) in one run, so this has generous headroom for the
 * current command while staying bounded. If a regression made any question
 * re-ask on an empty answer, exhausting the supply reproduces real EOF
 * behaviour — `question()` never resolves and the interface closes, which is
 * what turns the hang into a fast, readable `NoInputError` instead of a
 * suite timeout.
 */
class AutoAnswerAsker extends Asker {
  questionCount = 0;

  protected remainingAnswers = 10;
  protected closed = false;
  protected listeners = new Map<string, Set<() => void>>();

  protected createPromptInterface(): any {
    return {
      question: () => {
        this.questionCount++;
        if (this.remainingAnswers > 0) {
          this.remainingAnswers--;
          return Promise.resolve("");
        }
        queueMicrotask(() => this.closeInterface());
        return new Promise<string>(() => {});
      },
      once: (event: string, fn: () => void) => {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)?.add(fn);
      },
      off: (event: string, fn: () => void) => {
        this.listeners.get(event)?.delete(fn);
      },
      close: () => this.closeInterface(),
    };
  }

  protected closeInterface(): void {
    if (this.closed) return;
    this.closed = true;
    for (const fn of this.listeners.get("close") ?? []) fn();
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
      asker: alepha.inject(Asker) as AutoAnswerAsker,
    };
  };

  const readDependencies = async (fs: MemoryFileSystemProvider) =>
    (
      await fs.readJsonFile<{ dependencies: Record<string, string> }>(
        "/project/my-app/package.json",
      )
    ).dependencies;

  const readDevDependencies = async (fs: MemoryFileSystemProvider) =>
    (
      await fs.readJsonFile<{ devDependencies: Record<string, string> }>(
        "/project/my-app/package.json",
      )
    ).devDependencies;

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

  /**
   * The whole point of `--preset`/`--pm`/`--no-devtools` each having a flag is
   * that a script or CI can supply all three and never see a question. This
   * checks that for real, not by reading the source: `asker.questionCount`
   * would be nonzero the moment any of the three fell through to `ask.*`
   * instead of its flag, and the resulting package.json is asserted directly
   * against what `scaffolder.init` actually wrote, not just that the double
   * was called.
   */
  it("should reach the scaffolder without asking a question when every flag is supplied", async () => {
    const { fs, cli, cmd, asker } = createTestEnv();

    await cli.run(cmd.root, {
      argv: "my-app --preset saas --pm yarn --no-devtools",
      root: "/project",
    });

    expect(asker.questionCount).toBe(0);
    expect(await readDependencies(fs)).toHaveProperty("@alepha/ui");
    expect(await readDevDependencies(fs)).not.toHaveProperty(
      "@alepha/devtools",
    );
  });

  it("should include devtools by default when --no-devtools is not passed", async () => {
    const { fs, cli, cmd, asker } = createTestEnv();

    await cli.run(cmd.root, {
      argv: "my-app --preset saas --pm yarn",
      root: "/project",
    });

    // Name and preset are supplied, so the devtools confirm is the only
    // question left to reach; the auto-answering double's empty reply takes
    // its `default: true`.
    expect(asker.questionCount).toBe(1);
    expect(await readDevDependencies(fs)).toHaveProperty("@alepha/devtools");
  });
});
