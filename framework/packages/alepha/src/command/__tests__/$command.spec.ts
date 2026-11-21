import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Alepha, AlephaError, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, it, vi, type ExpectStatic } from "vitest";

import {
  $command,
  CliProvider,
  CommandError,
  ConsoleOutputProvider,
  cliOptions,
  ExclusiveProvider,
  MemoryOutputProvider,
} from "../index.ts";

/**
 * A malformed argv is reported, not thrown.
 *
 * These assertions used to be `.rejects.toThrow(...)`. Throwing out of the
 * `ready` hook surfaced as "Alepha failed to start" followed by a stack trace
 * through `CliProvider` internals: a crash report for a typo. The unknown-
 * command path had always rendered a message instead, and the two now agree:
 * log the reason, print the help for whatever context was resolved, exit 1.
 *
 * `CliProvider.run()`, the programmatic entry point, still throws: a caller
 * driving the CLI from code wants the error, not a printed page.
 */
const expectUsageError = async (
  expect: ExpectStatic,
  running: Promise<{
    mockLogger: MemoryDestinationProvider;
    mockOutput: MemoryOutputProvider;
  }>,
  message: string,
) => {
  const { mockLogger, mockOutput } = await running;

  const errors = mockLogger.logs.filter((l) => l.level === "ERROR");
  expect(errors.map((l) => l.message).join("\n")).toContain(message);
  expect(process.exitCode).toBe(1);

  // Either heading counts as "help was printed": a resolved command prints its
  // own `Usage:` block, while a root command with no subcommand path falls back
  // to the global listing under `Commands:`.
  const printedHelp =
    mockOutput.text.includes("Usage:") || mockOutput.text.includes("Commands:");
  expect(printedHelp).toBe(true);

  // Shared across tests in a single vitest worker, so it has to be cleared or
  // the next assertion inherits this one's failure.
  process.exitCode = 0;
};

describe("$command", () => {
  const setupTestCommands = async (
    argv?: string[],
    before?: (alepha: Alepha) => any,
  ) => {
    const mockHandlers = {
      greet: vi.fn(),
      deploy: vi.fn(),
    };

    class TestCommands {
      greet = $command({
        description: "A simple greeting command.",
        aliases: ["g"],
        flags: z.object({
          name: z.text({ description: "Name to greet." }),
          times: z.integer().default(1).optional(),
        }),
        handler: mockHandlers.greet,
      });

      deploy = $command({
        description: "Deploys the application.",
        flags: z.object({
          production: z.boolean().describe("Deploy to production.").optional(),
          "api-key": z.text({
            description: "API key for deployment.",
            aliases: ["key"],
          }),
        }),
        handler: mockHandlers.deploy,
      });
    }

    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "info",
        NO_COLOR: "true",
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      })
      // Help and command output go to stdout now, not through the logger, so
      // the logger alone can no longer see them.
      .with({
        provide: ConsoleOutputProvider,
        use: MemoryOutputProvider,
      })
      .with(TestCommands);

    if (argv) {
      alepha.store.mut(cliOptions, (old) => ({
        ...old,
        argv,
      }));
    }

    await before?.(alepha);
    await alepha.start();

    return {
      alepha,
      mockHandlers,
      mockLogger: alepha.inject(MemoryDestinationProvider),
      mockOutput: alepha.inject(MemoryOutputProvider),
    };
  };

  describe("exclusive", () => {
    /**
     * Point the queue at a scratch directory for the duration of one case, and
     * remove it afterwards.
     *
     * The variable is read inside `baseDir()` at acquire time, so it has to be
     * set on this process rather than passed in.
     */
    const inScratchQueue = async (
      body: (dir: string) => Promise<void>,
    ): Promise<void> => {
      const dir = mkdtempSync(join(tmpdir(), "alepha-exclusive-cmd-"));
      process.env.ALEPHA_EXCLUSIVE_DIR = dir;
      try {
        await body(dir);
      } finally {
        delete process.env.ALEPHA_EXCLUSIVE_DIR;
        rmSync(dir, { recursive: true, force: true });
      }
    };

    it("holds one slot for the whole pre-hook, handler and post-hook run", async ({
      expect,
    }) => {
      await inScratchQueue(async () => {
        const seen: string[] = [];

        class ExclusiveCommands {
          prework = $command({
            pre: "work",
            handler: async () => {
              seen.push("pre");
            },
          });

          work = $command({
            name: "work",
            exclusive: "test:work",
            handler: async () => {
              seen.push("handler");
            },
          });

          postwork = $command({
            post: "work",
            handler: async () => {
              seen.push("post");
            },
          });
        }

        const { alepha } = await setupTestCommands(["work"], (a) =>
          a.with(ExclusiveCommands),
        );

        expect(seen).toEqual(["pre", "handler", "post"]);

        // The slot was taken and released, so the queue is empty again.
        const exclusive = alepha.inject(ExclusiveProvider);
        const queue = exclusive.queueDir("test:work");
        expect(existsSync(queue)).toBe(true);
        expect(
          readdirSync(queue).filter((f) => f.endsWith(".json")),
        ).toHaveLength(0);
      });
    });

    it("does not queue from CliProvider.run(), the programmatic path", async ({
      expect,
    }) => {
      await inScratchQueue(async () => {
        class RunCommands {
          work = $command({
            name: "work",
            exclusive: "test:run",
            handler: async () => {},
          });
        }

        const alepha = Alepha.create();
        const commands = alepha.inject(RunCommands);
        const cli = alepha.inject(CliProvider);
        const exclusive = alepha.inject(ExclusiveProvider);

        await cli.run(commands.work);

        // run() is documented as the lightweight path: no runner session, no
        // context wrapper, no .env loading. Queueing there would make every
        // unit test that drives a command wait on a real filesystem queue.
        expect(existsSync(exclusive.queueDir("test:run"))).toBe(false);
      });
    });

    it("resolves a function key against the parsed flags", async ({
      expect,
    }) => {
      await inScratchQueue(async () => {
        const seen: Array<boolean | undefined> = [];

        class FlagKeyedCommands {
          work = $command({
            name: "work",
            flags: z.object({ fast: z.boolean().optional() }),
            exclusive: ({ flags }) => {
              seen.push(flags.fast);
              return flags.fast ? undefined : "test:flagged";
            },
            handler: async () => {},
          });
        }

        const { alepha } = await setupTestCommands(["work"], (a) =>
          a.with(FlagKeyedCommands),
        );
        const exclusive = alepha.inject(ExclusiveProvider);

        expect(seen).toEqual([undefined]);
        // The slot was taken, so the key's directory exists and is now empty.
        expect(existsSync(exclusive.queueDir("test:flagged"))).toBe(true);
      });
    });

    it("takes no slot at all when the function returns undefined", async ({
      expect,
    }) => {
      await inScratchQueue(async () => {
        class FlagKeyedCommands {
          work = $command({
            name: "work",
            flags: z.object({ fast: z.boolean().optional() }),
            exclusive: ({ flags }) => (flags.fast ? undefined : "test:skipped"),
            handler: async () => {},
          });
        }

        const { alepha } = await setupTestCommands(["work", "--fast"], (a) =>
          a.with(FlagKeyedCommands),
        );
        const exclusive = alepha.inject(ExclusiveProvider);

        // Never acquired, so the key's directory was never created. This is
        // the concurrent lane: it must not queue behind the serialised one.
        expect(existsSync(exclusive.queueDir("test:skipped"))).toBe(false);
      });
    });
  });

  describe("Command Execution", () => {
    it("should execute a matched command with correct flags", async ({
      expect,
    }) => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name=Alepha",
      ]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      const [callArgs] = mockHandlers.greet.mock.calls[0];
      expect(callArgs.flags).toEqual({ name: "Alepha", times: 1 });
      expect(callArgs.run).toBeDefined();
    });

    it("should execute a command using its alias", async ({ expect }) => {
      const { mockHandlers } = await setupTestCommands(["g", "--name=World"]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags.name).toBe("World");
    });

    it("should execute the root command when no command name is provided", async ({
      expect,
    }) => {
      const mockHandlers = {
        root: vi.fn(),
      };

      await setupTestCommands([], (a) => {
        a.with(
          class Ext {
            root = $command({
              name: "", // root command has an empty name
              description: "Root command",
              handler: mockHandlers.root,
            });
          },
        );
      });

      expect(mockHandlers.root).toHaveBeenCalledOnce();
    });

    it("should not execute any command if no matching command and no root command", async ({
      expect,
    }) => {
      const { mockHandlers } = await setupTestCommands(["--some-flag"]);

      expect(mockHandlers.greet).not.toHaveBeenCalled();
      expect(mockHandlers.deploy).not.toHaveBeenCalled();
    });
  });

  describe("Flag Parsing", () => {
    it("should parse string and boolean flags", async ({ expect }) => {
      const { mockHandlers } = await setupTestCommands([
        "deploy",
        "--production",
        "--api-key=xyz-123",
      ]);

      expect(mockHandlers.deploy).toHaveBeenCalledOnce();
      expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
        production: true,
        "api-key": "xyz-123",
      });
    });

    it("should use flag aliases", async ({ expect }) => {
      const { mockHandlers } = await setupTestCommands([
        "deploy",
        "--key=abc-456",
      ]);

      expect(mockHandlers.deploy).toHaveBeenCalledOnce();
      expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
        "api-key": "abc-456",
      });
    });

    it("should correctly parse and cast integer flags", async ({ expect }) => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name=Tester",
        "--times=5",
      ]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags.times).toBe(5);
    });

    it("should parse space-separated flag values", async ({ expect }) => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name",
        "Alepha",
      ]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags).toEqual({
        name: "Alepha",
        times: 1,
      });
    });

    it("should parse space-separated flag values with aliases", async ({
      expect,
    }) => {
      const { mockHandlers } = await setupTestCommands([
        "deploy",
        "--key",
        "my-secret-key",
      ]);

      expect(mockHandlers.deploy).toHaveBeenCalledOnce();
      expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
        "api-key": "my-secret-key",
      });
    });

    it("should mix space-separated and equals syntax", async ({ expect }) => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name",
        "World",
        "--times=3",
      ]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags).toEqual({
        name: "World",
        times: 3,
      });
    });

    it("should parse space-separated with boolean flag before it", async ({
      expect,
    }) => {
      const { mockHandlers } = await setupTestCommands([
        "deploy",
        "--production",
        "--api-key",
        "xyz-123",
      ]);

      expect(mockHandlers.deploy).toHaveBeenCalledOnce();
      expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
        production: true,
        "api-key": "xyz-123",
      });
    });

    it("should handle space-separated with short flag alias", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command",
          flags: z.object({
            output: z.text({ alias: "o" }),
          }),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "-o", "output.txt"], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].flags).toEqual({
        output: "output.txt",
      });
    });

    it("should parse JSON object with space-separated syntax", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with JSON flag",
          flags: z.object({
            data: z.object({
              name: z.string(),
              age: z.number(),
            }),
          }),
          handler: mockHandler,
        });
      }

      await setupTestCommands(
        ["cmd", "--data", '{"name":"John","age":30}'],
        (a) => a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].flags).toEqual({
        data: { name: "John", age: 30 },
      });
    });

    it("should parse JSON array with space-separated syntax", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with array flag",
          flags: z.object({
            items: z.array(z.string()),
          }),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "--items", '["a","b","c"]'], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].flags).toEqual({
        items: ["a", "b", "c"],
      });
    });

    it("should report a usage error when space-separated value is missing (next arg is a flag)", async ({
      expect,
    }) => {
      await expectUsageError(
        expect,
        setupTestCommands(["greet", "--name", "--times=5"]),
        "Flag --name requires a value",
      );
    });

    it("should report a usage error when space-separated value is missing (end of args)", async ({
      expect,
    }) => {
      await expectUsageError(
        expect,
        setupTestCommands(["greet", "--name"]),
        "Flag --name requires a value",
      );
    });
  });

  /**
   * A typo in a *sub*command used to exit 0.
   *
   * `resolveCommand` stops walking at the first word matching no child and
   * returns the group it reached, so `db bogus` resolved to `db`, whose
   * handler prints help and returns normally. `alepha db migreate` was a green
   * no-op in CI. The guard has to stay off groups that take positional args of
   * their own, where a leftover word is data rather than a typo.
   */
  describe("Unknown subcommands", () => {
    const pushHandler = vi.fn();

    class NestedCommands {
      push = $command({
        name: "push",
        description: "Push the schema.",
        args: z.text().optional(),
        handler: pushHandler,
      });

      seed = $command({
        name: "seed",
        description: "Seed the database.",
        children: [this.push],
        handler: ({ help }) => help(),
      });

      db = $command({
        name: "db",
        description: "Database management commands",
        children: [this.push, this.seed],
        handler: ({ help }) => help(),
      });
    }

    const setupNested = (argv: string[]) =>
      setupTestCommands(argv, (a) => a.with(NestedCommands));

    it("should report an unknown subcommand instead of exiting 0", async ({
      expect,
    }) => {
      await expectUsageError(expect, setupNested(["db", "bogus"]), "db bogus");
    });

    it("should report an unknown subcommand at any depth", async ({
      expect,
    }) => {
      await expectUsageError(
        expect,
        setupNested(["db", "seed", "bogus"]),
        "db seed bogus",
      );
    });

    it("should still run a group with no subcommand at all", async ({
      expect,
    }) => {
      const { mockOutput } = await setupNested(["db"]);

      expect(process.exitCode).not.toBe(1);
      expect(mockOutput.text).toContain("Usage:");
    });

    it("should treat a leftover word as an argument when the command takes one", async ({
      expect,
    }) => {
      pushHandler.mockClear();
      await setupNested(["db", "push", "./some/path"]);

      expect(pushHandler).toHaveBeenCalledOnce();
      expect(pushHandler.mock.calls[0][0].args).toBe("./some/path");
      expect(process.exitCode).not.toBe(1);
    });

    /**
     * A leaf is where this used to stop, because the guard also demanded
     * `hasChildren`. So `alepha verify fast` (meaning `--fast`) ran a full
     * verify and exited 0 with the word dropped on the floor - the same green
     * no-op in CI that the group-level guard exists to prevent, one level
     * down. A leaf has no subcommands to have mistyped, so the message names
     * the argument rather than a command.
     */
    it("should reject a stray word on a command that takes none", async ({
      expect,
    }) => {
      const leafHandler = vi.fn();

      class LeafCommands {
        verify = $command({
          name: "verify",
          description: "Verify the project.",
          handler: leafHandler,
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["verify", "fast"], (a) => a.with(LeafCommands)),
        "Unexpected argument 'fast'",
      );
      expect(leafHandler).not.toHaveBeenCalled();
    });

    /**
     * `--mode` never appears in any command's `flags` - `mode: true` turns it
     * on and it is read straight off the argv - so the resolver had no way to
     * know it takes a value, and left `production` sitting in the positionals.
     * Harmless while leaves were unguarded; a usage error the moment they were
     * not.
     */
    it("should not mistake a --mode value for a stray word", async ({
      expect,
    }) => {
      const modeHandler = vi.fn();

      class ModeCommands {
        build = $command({
          name: "build",
          mode: true,
          description: "Build the project.",
          handler: modeHandler,
        });
      }

      await setupTestCommands(["build", "--mode", "production"], (a) =>
        a.with(ModeCommands),
      );

      expect(modeHandler).toHaveBeenCalledOnce();
      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("Error Handling", () => {
    it("should log an error for an unknown command", async ({ expect }) => {
      const { mockLogger, mockOutput } = await setupTestCommands([
        "non-existent-command",
      ]);

      // The reason is a log: it is the CLI reporting a problem.
      const errorLog = mockLogger.logs.find((l) => l.level === "ERROR");
      expect(errorLog).toBeDefined();
      expect(errorLog?.message).toBe("Unknown command: 'non-existent-command'");

      // The help that follows is output: it is a document, and it goes to
      // stdout so a caller can pipe it.
      expect(mockOutput.text).toContain("Commands:");
    });

    it("should report a usage error for invalid flag types", async ({
      expect,
    }) => {
      // Strict-zod: flag values are cast + validated via parseArgumentValue
      // (same path as positional args), which rejects non-numeric integer flags
      // up front rather than deferring to the decode message.
      await expectUsageError(
        expect,
        setupTestCommands(["greet", "--name=Test", "--times=not-a-number"]),
        'Expected number, got "not-a-number"',
      );
    });
  });

  /**
   * A task that ran and failed is a command failure, not a crash.
   *
   * `tsc`, `vitest` and `oxlint` all print their own diagnostics before the
   * `CommandError` is raised. Letting it out of the `ready` hook wrapped it in
   * "Alepha failed to start" and roughly thirty stack frames, none of them
   * in the user's code, a crash report for a type error.
   */
  describe("Task Failure", () => {
    const failingCommand = (cause?: Error) =>
      class FailingCommands {
        broken = $command({
          name: "broken",
          description: "Always fails.",
          handler: () => {
            throw new CommandError("Task 'node tsc --noEmit' failed", {
              cause,
            });
          },
        });
      };

    it("should report the reason and exit 1 instead of throwing", async ({
      expect,
    }) => {
      const { mockLogger } = await setupTestCommands(["broken"], (alepha) =>
        alepha.with(
          failingCommand(
            new AlephaError(
              "Command exited with code 1: src/a.ts(1,1): error TS2322",
            ),
          ),
        ),
      );

      const errors = mockLogger.logs
        .filter((l) => l.level === "ERROR")
        .map((l) => l.message);

      expect(errors).toContain("Task 'node tsc --noEmit' failed");
      // The innermost cause is what actually explains the failure.
      expect(errors).toContain(
        "Command exited with code 1: src/a.ts(1,1): error TS2322",
      );
      // Never the crash banner, and never a frame of framework internals.
      expect(errors.join("\n")).not.toContain("Alepha failed to start");
      expect(errors.join("\n")).not.toContain("    at ");
      expect(process.exitCode).toBe(1);

      process.exitCode = 0;
    });

    it("should not repeat the message when there is no cause", async ({
      expect,
    }) => {
      const { mockLogger } = await setupTestCommands(["broken"], (alepha) =>
        alepha.with(failingCommand()),
      );

      const errors = mockLogger.logs
        .filter((l) => l.level === "ERROR")
        .map((l) => l.message);

      expect(errors).toEqual(["Task 'node tsc --noEmit' failed"]);
      expect(process.exitCode).toBe(1);

      process.exitCode = 0;
    });

    // The tool streamed its own diagnostics, so a bare exit code is a second
    // line saying what the first already said.
    it("should drop a cause that carries only the exit code", async ({
      expect,
    }) => {
      const { mockLogger } = await setupTestCommands(["broken"], (alepha) =>
        alepha.with(
          failingCommand(new AlephaError("Command exited with code 1")),
        ),
      );

      const errors = mockLogger.logs
        .filter((l) => l.level === "ERROR")
        .map((l) => l.message);

      expect(errors).toEqual(["Task 'node tsc --noEmit' failed"]);

      process.exitCode = 0;
    });

    /**
     * An exit code a script can branch on: 3 for "not authenticated", 4 for
     * "forbidden", without parsing the sentence. An error that names none
     * keeps exiting 1, which the cases above already pin.
     */
    it("should exit with the code the error carries", async ({ expect }) => {
      class RefusingCommands {
        refused = $command({
          name: "refused",
          handler: () => {
            throw new CommandError(
              { exitCode: 3 },
              { message: "Not authenticated to lore.example.com." },
            );
          },
        });
      }

      const { mockLogger } = await setupTestCommands(["refused"], (alepha) =>
        alepha.with(RefusingCommands),
      );

      expect(process.exitCode).toBe(3);
      expect(
        mockLogger.logs
          .filter((l) => l.level === "ERROR")
          .map((l) => l.message),
      ).toEqual(["Not authenticated to lore.example.com."]);

      process.exitCode = 0;
    });

    it("should exit with the code of an error thrown inside a run() task", async ({
      expect,
    }) => {
      class RefusingCommands {
        whoami = $command({
          name: "whoami",
          handler: async ({ run }) => {
            await run("check session", () => {
              throw new CommandError(
                { exitCode: 3 },
                { message: "Not authenticated." },
              );
            });
          },
        });
      }

      const { mockLogger } = await setupTestCommands(["whoami"], (alepha) =>
        alepha.with(RefusingCommands),
      );

      expect(process.exitCode).toBe(3);
      expect(
        mockLogger.logs
          .filter((l) => l.level === "ERROR")
          .map((l) => l.message),
      ).toEqual(["Task 'check session' failed", "Not authenticated."]);

      process.exitCode = 0;
    });

    it("should not repeat a cause the message already quotes", async ({
      expect,
    }) => {
      const { mockLogger } = await setupTestCommands(["broken"], (alepha) =>
        alepha.with(
          class QuotingCommands {
            broken = $command({
              name: "broken",
              handler: () => {
                throw new CommandError(
                  { exitCode: 4 },
                  {
                    message:
                      "Project alepha: Your rank does not grant quest:create.",
                    cause: new AlephaError(
                      "Your rank does not grant quest:create.",
                    ),
                  },
                );
              },
            });
          },
        ),
      );

      expect(
        mockLogger.logs
          .filter((l) => l.level === "ERROR")
          .map((l) => l.message),
      ).toEqual(["Project alepha: Your rank does not grant quest:create."]);
      expect(process.exitCode).toBe(4);

      process.exitCode = 0;
    });
  });

  describe("Help Message", () => {
    it("should print general help with --help flag", async ({ expect }) => {
      const { mockOutput } = await setupTestCommands(["--help"], (alepha) => {
        alepha.store.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
          description: "My awesome CLI tool.",
        }));
      });

      const output = mockOutput.text;
      expect(output).toContain("My awesome CLI tool.");
      expect(output).toContain("Commands:");
      expect(output).toContain("my-cli greet, g");
      expect(output).toContain("my-cli deploy");
      expect(output).toContain("Flags:");
      expect(output).toContain("-h, --help");
    });

    it("should print command-specific help", async ({ expect }) => {
      const { mockOutput } = await setupTestCommands(
        ["greet", "-h"],
        (alepha) =>
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          })),
      );

      const output = mockOutput.text;
      expect(output).toContain("Usage: my-cli greet");
      expect(output).toContain("A simple greeting command.");
      expect(output).toContain("Flags:");
      expect(output).toContain("--name");
      expect(output).toContain("--times");
      expect(output).toContain("-h, --help");
    });
  });

  describe("Arguments Parsing", () => {
    it("should parse single string argument", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with string arg",
          args: z.text(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "hello"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.args).toBe("hello");
    });

    it("should parse single number argument", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with number arg",
          args: z.number(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "42.5"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBe(42.5);
    });

    it("should parse single integer argument", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with integer arg",
          args: z.integer(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "42"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBe(42);
    });

    it("should parse single boolean argument", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with boolean arg",
          args: z.boolean(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "true"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBe(true);

      mockHandler.mockClear();
      await setupTestCommands(["cmd", "false"], (a) => a.with(TestCommand));
      expect(mockHandler.mock.calls[0][0].args).toBe(false);
    });

    it("should handle optional string argument when provided", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with optional string arg",
          args: z.text().optional(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "optional-value"], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBe("optional-value");
    });

    it("should handle optional string argument when not provided", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with optional string arg",
          args: z.text().optional(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBeUndefined();
    });

    it("should parse tuple arguments with multiple types", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args",
          args: z.tuple([z.text(), z.number()]),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "hello", "42"], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toEqual(["hello", 42]);
    });

    it("should parse tuple with optional arguments", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with tuple containing optional arg",
          args: z.tuple([z.text(), z.number().optional()]),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "hello"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toEqual(["hello", undefined]);
    });

    it("should handle arguments with flags mixed in", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with args and flags",
          flags: z.object({
            verbose: z.boolean().optional(),
          }),
          args: z.tuple([z.text(), z.number()]),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "--verbose", "hello", "42"], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.flags).toEqual({ verbose: true });
      expect(callArgs.args).toEqual(["hello", 42]);
    });

    it("should handle arguments with space-separated flags", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with args and space-separated flags",
          flags: z.object({
            output: z.text(),
          }),
          args: z.text(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd", "--output", "file.txt", "my-arg"], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.flags).toEqual({ output: "file.txt" });
      expect(callArgs.args).toBe("my-arg");
    });

    it("should handle tuple arguments with space-separated flags interspersed", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args and space-separated flags",
          flags: z.object({
            config: z.text(),
            verbose: z.boolean().optional(),
          }),
          args: z.tuple([z.text(), z.number()]),
          handler: mockHandler,
        });
      }

      await setupTestCommands(
        ["cmd", "--config", "app.json", "hello", "--verbose", "42"],
        (a) => a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.flags).toEqual({ config: "app.json", verbose: true });
      expect(callArgs.args).toEqual(["hello", 42]);
    });

    it("should pass fs and glob to handler", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command to check fs and glob",
          handler: mockHandler,
        });
      }

      await setupTestCommands(["cmd"], (a) => a.with(TestCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.fs).toBeDefined();
      expect(callArgs.glob).toBeDefined();
    });
  });

  describe("Arguments Error Handling", () => {
    it("should report a usage error for missing required argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with required arg",
          args: z.text(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["cmd"], (a) => a.with(TestCommand)),
        "Missing required argument",
      );
    });

    it("should report a usage error for invalid number argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with number arg",
          args: z.number(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["cmd", "not-a-number"], (a) => a.with(TestCommand)),
        'Expected number, got "not-a-number"',
      );
    });

    it("should report a usage error for invalid integer argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with integer arg",
          args: z.integer(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["cmd", "42.5"], (a) => a.with(TestCommand)),
        'Expected integer, got "42.5"',
      );
    });

    it("should report a usage error for invalid boolean argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with boolean arg",
          args: z.boolean(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["cmd", "not-a-boolean"], (a) => a.with(TestCommand)),
        'Expected boolean, got "not-a-boolean"',
      );
    });

    it("should report a usage error for missing required tuple argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args",
          args: z.tuple([z.text(), z.number()]),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["cmd", "hello"], (a) => a.with(TestCommand)),
        "Missing required argument at position 2",
      );
    });
  });

  describe("Root Command with Arguments", () => {
    it("should parse single string argument for root command", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with string arg",
          args: z.text(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["hello"], (a) => a.with(RootCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.args).toBe("hello");
    });

    it("should parse optional argument for root command when provided", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with optional arg",
          args: z.text().optional(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["my-value"], (a) => a.with(RootCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBe("my-value");
    });

    it("should handle optional argument for root command when not provided", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with optional arg",
          args: z.text().optional(),
          handler: mockHandler,
        });
      }

      await setupTestCommands([], (a) => a.with(RootCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBeUndefined();
    });

    it("should parse tuple arguments for root command", async ({ expect }) => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with tuple args",
          args: z.tuple([z.text(), z.number()]),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["hello", "42"], (a) => a.with(RootCommand));

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toEqual(["hello", 42]);
    });

    it("should parse root command args with flags mixed in", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with args and flags",
          flags: z.object({
            verbose: z.boolean().optional(),
          }),
          args: z.text(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["--verbose", "my-arg"], (a) =>
        a.with(RootCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.flags).toEqual({ verbose: true });
      expect(callArgs.args).toBe("my-arg");
    });

    it("should parse root command with space-separated flags and args", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with space-separated flags",
          flags: z.object({
            config: z.text(),
          }),
          args: z.text(),
          handler: mockHandler,
        });
      }

      await setupTestCommands(["--config", "app.json", "my-arg"], (a) =>
        a.with(RootCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.flags).toEqual({ config: "app.json" });
      expect(callArgs.args).toBe("my-arg");
    });

    it("should report a usage error for missing required root command argument", async ({
      expect,
    }) => {
      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with required arg",
          args: z.text(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands([], (a) => a.with(RootCommand)),
        "Missing required argument",
      );
    });
  });

  describe("Root Command Global Flags", () => {
    it("should display root command flags as global flags in help", async ({
      expect,
    }) => {
      const mockRootHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command",
          flags: z.object({
            verbose: z.boolean().describe("Enable verbose output.").optional(),
            config: z
              .text({
                description: "Path to config file.",
                alias: "c",
              })
              .optional(),
          }),
          handler: mockRootHandler,
        });
      }

      const { mockOutput } = await setupTestCommands(["--help"], (alepha) => {
        alepha.store.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
          description: "My awesome CLI tool.",
        }));
        alepha.with(RootCommand);
      });

      const output = mockOutput.text;
      expect(output).toContain("Flags:");
      expect(output).toContain("--verbose");
      expect(output).toContain("Enable verbose output.");
      expect(output).toContain("--config");
      expect(output).toContain("Path to config file.");
      expect(output).toContain("-h, --help");
    });

    it("should parse root command flags correctly", async ({ expect }) => {
      const mockRootHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command",
          flags: z.object({
            verbose: z.boolean().describe("Verbose mode.").optional(),
            output: z.text({ description: "Output file." }),
          }),
          handler: mockRootHandler,
        });
      }

      await setupTestCommands(["--verbose", "--output=test.txt"], (alepha) => {
        alepha.with(RootCommand);
      });

      expect(mockRootHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockRootHandler.mock.calls[0];
      expect(callArgs.flags).toEqual({
        verbose: true,
        output: "test.txt",
      });
    });
  });

  describe("Help Message with Arguments", () => {
    it("should show argument usage in help for single string argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with string arg",
          args: z.text(),
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(
        ["cmd", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockOutput.text;
      expect(output).toContain("Usage: test-cli cmd <arg1>");
    });

    it("should show argument usage in help for optional argument", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with optional arg",
          args: z.text().optional(),
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(
        ["cmd", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockOutput.text;
      expect(output).toContain("Usage: test-cli cmd [arg1]");
    });

    it("should show argument usage in help for tuple arguments", async ({
      expect,
    }) => {
      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args",
          args: z.tuple([z.text(), z.number().optional()]),
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(
        ["cmd", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockOutput.text;
      expect(output).toContain("Usage: test-cli cmd <arg1> [arg2: number]");
    });
  });

  describe("Subcommands", () => {
    it("should execute subcommand with space-separated syntax", async ({
      expect,
    }) => {
      const mockHandlers = {
        parent: vi.fn(),
        child: vi.fn(),
      };

      class TestCommands {
        child = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          handler: mockHandlers.child,
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: mockHandlers.parent,
        });
      }

      await setupTestCommands(["deploy", "vercel"], (a) =>
        a.with(TestCommands),
      );

      expect(mockHandlers.child).toHaveBeenCalledOnce();
      expect(mockHandlers.parent).not.toHaveBeenCalled();
    });

    it("should execute parent handler when subcommand is not provided", async ({
      expect,
    }) => {
      const mockHandlers = {
        parent: vi.fn(),
        child: vi.fn(),
      };

      class TestCommands {
        child = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          handler: mockHandlers.child,
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: mockHandlers.parent,
        });
      }

      await setupTestCommands(["deploy"], (a) => a.with(TestCommands));

      expect(mockHandlers.parent).toHaveBeenCalledOnce();
      expect(mockHandlers.child).not.toHaveBeenCalled();
    });

    it("should provide help() function in handler args", async ({ expect }) => {
      let helpFn: (() => void) | undefined;

      class TestCommands {
        child = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          handler: vi.fn(),
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: ({ help }) => {
            helpFn = help;
            help();
          },
        });
      }

      const { mockOutput } = await setupTestCommands(["deploy"], (alepha) => {
        alepha.store.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
        }));
        alepha.with(TestCommands);
      });

      expect(helpFn).toBeDefined();
      const output = mockOutput.text;
      expect(output).toContain("Usage: my-cli deploy <command>");
      expect(output).toContain("Commands:");
      expect(output).toContain("vercel");
    });

    it("should pass flags to subcommand", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommands {
        child = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          flags: z.object({
            prod: z.boolean().optional(),
          }),
          handler: mockHandler,
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: vi.fn(),
        });
      }

      await setupTestCommands(["deploy", "vercel", "--prod"], (a) =>
        a.with(TestCommands),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].flags).toEqual({ prod: true });
    });

    it("should pass arguments to subcommand", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommands {
        child = $command({
          name: "surge",
          description: "Deploy to Surge",
          args: z.text().optional(),
          handler: mockHandler,
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: vi.fn(),
        });
      }

      await setupTestCommands(["deploy", "surge", "my-domain.surge.sh"], (a) =>
        a.with(TestCommands),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      expect(mockHandler.mock.calls[0][0].args).toBe("my-domain.surge.sh");
    });

    it("should show subcommands in help output", async ({ expect }) => {
      class TestCommands {
        child1 = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          handler: vi.fn(),
        });

        child2 = $command({
          name: "cloudflare",
          description: "Deploy to Cloudflare",
          handler: vi.fn(),
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child1, this.child2],
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(
        ["deploy", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          }));
          alepha.with(TestCommands);
        },
      );

      const output = mockOutput.text;
      expect(output).toContain("Usage: my-cli deploy <command>");
      expect(output).toContain("Commands:");
      expect(output).toContain("my-cli deploy vercel");
      expect(output).toContain("my-cli deploy cloudflare");
      expect(output).toContain("Deploy to Vercel");
      expect(output).toContain("Deploy to Cloudflare");
    });

    it("should support colon notation for backwards compatibility", async ({
      expect,
    }) => {
      const mockHandler = vi.fn();

      class TestCommands {
        legacyCommand = $command({
          name: "db:migrate",
          description: "Run database migrations",
          handler: mockHandler,
        });
      }

      await setupTestCommands(["db:migrate"], (a) => a.with(TestCommands));

      expect(mockHandler).toHaveBeenCalledOnce();
    });

    it("should not show child commands in top-level help", async ({
      expect,
    }) => {
      class TestCommands {
        child = $command({
          name: "vercel",
          description: "Deploy to Vercel",
          handler: vi.fn(),
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(["--help"], (alepha) => {
        alepha.store.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
        }));
        alepha.with(TestCommands);
      });

      const output = mockOutput.text;
      expect(output).toContain("my-cli deploy <command>");
      // vercel should not be listed as a top-level command
      expect(output).not.toMatch(/^\s*my-cli vercel/m);
    });

    it("should execute subcommand by alias", async ({ expect }) => {
      const mockHandler = vi.fn();

      class TestCommands {
        child = $command({
          name: "vercel",
          aliases: ["v"],
          description: "Deploy to Vercel",
          handler: mockHandler,
        });

        parent = $command({
          name: "deploy",
          description: "Deploy the application",
          children: [this.child],
          handler: vi.fn(),
        });
      }

      await setupTestCommands(["deploy", "v"], (a) => a.with(TestCommands));

      expect(mockHandler).toHaveBeenCalledOnce();
    });
  });

  describe("Environment Variables", () => {
    it("should pass validated env vars to handler", async ({ expect }) => {
      let receivedEnv: any;

      class TestCommands {
        cmd = $command({
          name: "test",
          env: z.object({
            MY_TOKEN: z.text({ description: "API token" }),
          }),
          handler: ({ env }) => {
            receivedEnv = env;
          },
        });
      }

      // Set env var before running
      process.env.MY_TOKEN = "secret123";

      try {
        await setupTestCommands(["test"], (a) => a.with(TestCommands));
        expect(receivedEnv).toEqual({ MY_TOKEN: "secret123" });
      } finally {
        delete process.env.MY_TOKEN;
      }
    });

    it("should report a usage error for missing required env var", async ({
      expect,
    }) => {
      class TestCommands {
        cmd = $command({
          name: "test",
          env: z.object({
            REQUIRED_VAR: z.text({ description: "Required variable" }),
          }),
          handler: vi.fn(),
        });
      }

      // Ensure env var is not set
      delete process.env.REQUIRED_VAR;

      await expectUsageError(
        expect,
        setupTestCommands(["test"], (a) => a.with(TestCommands)),
        "Missing required environment variable: REQUIRED_VAR",
      );
    });

    it("should handle optional env vars", async ({ expect }) => {
      let receivedEnv: any;

      class TestCommands {
        cmd = $command({
          name: "test",
          env: z.object({
            OPTIONAL_VAR: z.text({ description: "Optional" }).optional(),
          }),
          handler: ({ env }) => {
            receivedEnv = env;
          },
        });
      }

      // Ensure env var is not set
      delete process.env.OPTIONAL_VAR;

      await setupTestCommands(["test"], (a) => a.with(TestCommands));
      expect(receivedEnv).toEqual({});
    });

    it("should handle optional env vars with defaults", async ({ expect }) => {
      let receivedEnv: any;

      class TestCommands {
        cmd = $command({
          name: "test",
          env: z.object({
            MY_VAR: z.text({ default: "default_value" }).optional(),
          }),
          handler: ({ env }) => {
            receivedEnv = env;
          },
        });
      }

      // Ensure env var is not set
      delete process.env.MY_VAR;

      await setupTestCommands(["test"], (a) => a.with(TestCommands));
      expect(receivedEnv).toEqual({ MY_VAR: "default_value" });
    });

    it("should show env vars in help output", async ({ expect }) => {
      class TestCommands {
        cmd = $command({
          name: "test",
          env: z.object({
            API_TOKEN: z.text({ description: "API token for authentication" }),
            ORG_ID: z.text({ description: "Organization ID" }).optional(),
          }),
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(
        ["test", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          }));
          alepha.with(TestCommands);
        },
      );

      const output = mockOutput.text;
      expect(output).toContain("Env:");
      expect(output).toContain("API_TOKEN");
      expect(output).toContain("API token for authentication");
      expect(output).toContain("ORG_ID");
      expect(output).toContain("(optional)");
    });

    it("should report a usage error for multiple missing env vars", async ({
      expect,
    }) => {
      class TestCommands {
        cmd = $command({
          name: "test",
          env: z.object({
            VAR_ONE: z.text(),
            VAR_TWO: z.text(),
          }),
          handler: vi.fn(),
        });
      }

      delete process.env.VAR_ONE;
      delete process.env.VAR_TWO;

      await expectUsageError(
        expect,
        setupTestCommands(["test"], (a) => a.with(TestCommands)),
        "Missing required environment variables: VAR_ONE, VAR_TWO",
      );
    });
  });

  describe("mode option", () => {
    it("should pass mode value to handler when --mode flag is used", async ({
      expect,
    }) => {
      const handler = vi.fn();

      class TestCommands {
        build = $command({
          name: "build",
          mode: true,
          handler,
        });
      }

      await setupTestCommands(["build", "--mode", "production"], (a) =>
        a.with(TestCommands),
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "production",
        }),
      );
    });

    it("should pass mode value with -m shorthand", async ({ expect }) => {
      const handler = vi.fn();

      class TestCommands {
        build = $command({
          name: "build",
          mode: true,
          handler,
        });
      }

      await setupTestCommands(["build", "-m", "staging"], (a) =>
        a.with(TestCommands),
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "staging",
        }),
      );
    });

    it("should pass mode value with --mode=value syntax", async ({
      expect,
    }) => {
      const handler = vi.fn();

      class TestCommands {
        build = $command({
          name: "build",
          mode: true,
          handler,
        });
      }

      await setupTestCommands(["build", "--mode=development"], (a) =>
        a.with(TestCommands),
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "development",
        }),
      );
    });

    it("should pass undefined mode when flag is not provided", async ({
      expect,
    }) => {
      const handler = vi.fn();

      class TestCommands {
        build = $command({
          name: "build",
          mode: true,
          handler,
        });
      }

      await setupTestCommands(["build"], (a) => a.with(TestCommands));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: undefined,
        }),
      );
    });

    it("should report a usage error when --mode is used without value", async ({
      expect,
    }) => {
      class TestCommands {
        build = $command({
          name: "build",
          mode: true,
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        expect,
        setupTestCommands(["build", "--mode"], (a) => a.with(TestCommands)),
        "Flag --mode requires a value.",
      );
    });

    it("should show --mode flag in help when mode option is enabled", async ({
      expect,
    }) => {
      class TestCommands {
        build = $command({
          name: "build",
          description: "Build the project",
          mode: true,
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(["build", "-h"], (a) =>
        a.with(TestCommands),
      );

      const output = mockOutput.text;
      expect(output).toContain("-m, --mode");
      expect(output).toContain("Environment mode");
    });

    it("should not show --mode flag when mode option is disabled", async ({
      expect,
    }) => {
      class TestCommands {
        build = $command({
          name: "build",
          description: "Build the project",
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(["build", "-h"], (a) =>
        a.with(TestCommands),
      );

      const output = mockOutput.text;
      expect(output).not.toContain("-m, --mode");
    });

    it("should use string mode as default when no --mode flag provided", async ({
      expect,
    }) => {
      const handler = vi.fn();

      class TestCommands {
        deploy = $command({
          name: "deploy",
          mode: "production",
          handler,
        });
      }

      await setupTestCommands(["deploy"], (a) => a.with(TestCommands));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "production",
        }),
      );
    });

    it("should override string default mode when --mode flag provided", async ({
      expect,
    }) => {
      const handler = vi.fn();

      class TestCommands {
        deploy = $command({
          name: "deploy",
          mode: "production",
          handler,
        });
      }

      await setupTestCommands(["deploy", "--mode", "staging"], (a) =>
        a.with(TestCommands),
      );

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: "staging",
        }),
      );
    });

    it("should show default mode in help when mode is a string", async ({
      expect,
    }) => {
      class TestCommands {
        deploy = $command({
          name: "deploy",
          description: "Deploy the project",
          mode: "production",
          handler: vi.fn(),
        });
      }

      const { mockOutput } = await setupTestCommands(["deploy", "-h"], (a) =>
        a.with(TestCommands),
      );

      const output = mockOutput.text;
      expect(output).toContain("-m, --mode");
      expect(output).toContain("default: production");
    });
  });
});
