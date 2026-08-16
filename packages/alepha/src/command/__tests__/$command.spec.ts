import { Alepha, AlephaError, z } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, test, vi } from "vitest";
import {
  $command,
  CommandError,
  ConsoleOutputProvider,
  cliOptions,
  MemoryOutputProvider,
} from "../index.ts";

/**
 * A malformed argv is reported, not thrown.
 *
 * These assertions used to be `.rejects.toThrow(...)`. Throwing out of the
 * `ready` hook surfaced as "Alepha failed to start" followed by a stack trace
 * through `CliProvider` internals — a crash report for a typo. The unknown-
 * command path had always rendered a message instead, and the two now agree:
 * log the reason, print the help for whatever context was resolved, exit 1.
 *
 * `CliProvider.run()`, the programmatic entry point, still throws — a caller
 * driving the CLI from code wants the error, not a printed page.
 */
const expectUsageError = async (
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
      root: vi.fn(),
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
    try {
      await alepha.start();
    } catch (error) {
      if (error instanceof AlephaError && error.cause instanceof CommandError) {
        throw error.cause;
      }
      throw error;
    }

    return {
      alepha,
      mockHandlers,
      mockLogger: alepha.inject(MemoryDestinationProvider),
      mockOutput: alepha.inject(MemoryOutputProvider),
    };
  };

  describe("Command Execution", () => {
    test("should execute a matched command with correct flags", async () => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name=Alepha",
      ]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      const [callArgs] = mockHandlers.greet.mock.calls[0];
      expect(callArgs.flags).toEqual({ name: "Alepha", times: 1 });
      expect(callArgs.run).toBeDefined();
    });

    test("should execute a command using its alias", async () => {
      const { mockHandlers } = await setupTestCommands(["g", "--name=World"]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags.name).toBe("World");
    });

    test("should execute the root command when no command name is provided", async () => {
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

    test("should not execute any command if no matching command and no root command", async () => {
      const { mockHandlers } = await setupTestCommands(["--some-flag"]);

      expect(mockHandlers.greet).not.toHaveBeenCalled();
      expect(mockHandlers.deploy).not.toHaveBeenCalled();
    });
  });

  describe("Flag Parsing", () => {
    test("should parse string and boolean flags", async () => {
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

    test("should use flag aliases", async () => {
      const { mockHandlers } = await setupTestCommands([
        "deploy",
        "--key=abc-456",
      ]);

      expect(mockHandlers.deploy).toHaveBeenCalledOnce();
      expect(mockHandlers.deploy.mock.calls[0][0].flags).toEqual({
        "api-key": "abc-456",
      });
    });

    test("should apply default values for optional flags", async () => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name=Tester",
      ]);
      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags).toEqual({
        name: "Tester",
        times: 1,
      });
    });

    test("should correctly parse and cast integer flags", async () => {
      const { mockHandlers } = await setupTestCommands([
        "greet",
        "--name=Tester",
        "--times=5",
      ]);

      expect(mockHandlers.greet).toHaveBeenCalledOnce();
      expect(mockHandlers.greet.mock.calls[0][0].flags.times).toBe(5);
    });

    test("should parse space-separated flag values", async () => {
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

    test("should parse space-separated flag values with aliases", async () => {
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

    test("should mix space-separated and equals syntax", async () => {
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

    test("should parse space-separated with boolean flag before it", async () => {
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

    test("should handle space-separated with short flag alias", async () => {
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

    test("should parse JSON object with space-separated syntax", async () => {
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

    test("should parse JSON array with space-separated syntax", async () => {
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

    test("should throw error when space-separated value is missing (next arg is a flag)", async () => {
      await expectUsageError(
        setupTestCommands(["greet", "--name", "--times=5"]),
        "Flag --name requires a value",
      );
    });

    test("should throw error when space-separated value is missing (end of args)", async () => {
      await expectUsageError(
        setupTestCommands(["greet", "--name"]),
        "Flag --name requires a value",
      );
    });
  });

  /**
   * A typo in a *sub*command used to exit 0.
   *
   * `resolveCommand` stops walking at the first word matching no child and
   * returns the group it reached, so `db bogus` resolved to `db` — whose
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

    test("should report an unknown subcommand instead of exiting 0", async () => {
      await expectUsageError(setupNested(["db", "bogus"]), "db bogus");
    });

    test("should report an unknown subcommand at any depth", async () => {
      await expectUsageError(
        setupNested(["db", "seed", "bogus"]),
        "db seed bogus",
      );
    });

    test("should still run a group with no subcommand at all", async () => {
      const { mockOutput } = await setupNested(["db"]);

      expect(process.exitCode).not.toBe(1);
      expect(mockOutput.text).toContain("Usage:");
    });

    test("should treat a leftover word as an argument when the command takes one", async () => {
      pushHandler.mockClear();
      await setupNested(["db", "push", "./some/path"]);

      expect(pushHandler).toHaveBeenCalledOnce();
      expect(pushHandler.mock.calls[0][0].args).toBe("./some/path");
      expect(process.exitCode).not.toBe(1);
    });
  });

  describe("Error Handling", () => {
    test("should log an error for an unknown command", async () => {
      const { mockLogger, mockOutput } = await setupTestCommands([
        "non-existent-command",
      ]);

      // The reason is a log — it is the CLI reporting a problem.
      const errorLog = mockLogger.logs.find((l) => l.level === "ERROR");
      expect(errorLog).toBeDefined();
      expect(errorLog?.message).toBe("Unknown command: 'non-existent-command'");

      // The help that follows is output — it is a document, and it goes to
      // stdout so a caller can pipe it.
      expect(mockOutput.text).toContain("Commands:");
    });

    test("should throw a CommandError for missing flag values", async () => {
      await expectUsageError(
        setupTestCommands(["greet", "--name"]),
        "Flag --name requires a value",
      );
    });

    test("should throw a CommandError for invalid flag types", async () => {
      // Strict-zod: flag values are cast + validated via parseArgumentValue
      // (same path as positional args), which rejects non-numeric integer flags
      // up front rather than deferring to the (typebox-style) decode message.
      await expectUsageError(
        setupTestCommands(["greet", "--name=Test", "--times=not-a-number"]),
        'Expected number, got "not-a-number"',
      );
    });
  });

  /**
   * A task that ran and failed is a command failure, not a crash.
   *
   * `tsc`, `vitest` and `biome` all print their own diagnostics before the
   * `CommandError` is raised. Letting it out of the `ready` hook wrapped it in
   * "Alepha failed to start / Failed during 'ready()' hook for service:
   * CliProvider" and roughly thirty stack frames, none of them in the user's
   * code — a crash report for a type error.
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

    test("should report the reason and exit 1 instead of throwing", async () => {
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

    test("should not repeat the message when there is no cause", async () => {
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
    test("should drop a cause that carries only the exit code", async () => {
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
  });

  describe("Help Message", () => {
    test("should print general help with --help flag", async () => {
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

    test("should print command-specific help", async () => {
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
    test("should parse single string argument", async () => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with string arg",
          args: z.text(),
          handler: mockHandler,
        });
      }

      const { alepha } = await setupTestCommands(["cmd", "hello"], (a) =>
        a.with(TestCommand),
      );

      expect(mockHandler).toHaveBeenCalledOnce();
      const [callArgs] = mockHandler.mock.calls[0];
      expect(callArgs.args).toBe("hello");
    });

    test("should parse single number argument", async () => {
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

    test("should parse single integer argument", async () => {
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

    test("should parse single boolean argument", async () => {
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

    test("should handle optional string argument when provided", async () => {
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

    test("should handle optional string argument when not provided", async () => {
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

    test("should parse tuple arguments with multiple types", async () => {
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

    test("should parse tuple with optional arguments", async () => {
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

    test("should handle arguments with flags mixed in", async () => {
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

    test("should handle arguments with space-separated flags", async () => {
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

    test("should handle tuple arguments with space-separated flags interspersed", async () => {
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

    test("should pass fs and glob to handler", async () => {
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
    test("should throw error for missing required argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with required arg",
          args: z.text(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands(["cmd"], (a) => a.with(TestCommand)),
        "Missing required argument",
      );
    });

    test("should throw error for invalid number argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with number arg",
          args: z.number(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands(["cmd", "not-a-number"], (a) => a.with(TestCommand)),
        'Expected number, got "not-a-number"',
      );
    });

    test("should throw error for invalid integer argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with integer arg",
          args: z.integer(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands(["cmd", "42.5"], (a) => a.with(TestCommand)),
        'Expected integer, got "42.5"',
      );
    });

    test("should throw error for invalid boolean argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with boolean arg",
          args: z.boolean(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands(["cmd", "not-a-boolean"], (a) => a.with(TestCommand)),
        'Expected boolean, got "not-a-boolean"',
      );
    });

    test("should throw error for missing required tuple argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args",
          args: z.tuple([z.text(), z.number()]),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands(["cmd", "hello"], (a) => a.with(TestCommand)),
        "Missing required argument at position 2",
      );
    });
  });

  describe("Root Command with Arguments", () => {
    test("should parse single string argument for root command", async () => {
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

    test("should parse optional argument for root command when provided", async () => {
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

    test("should handle optional argument for root command when not provided", async () => {
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

    test("should parse tuple arguments for root command", async () => {
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

    test("should parse root command args with flags mixed in", async () => {
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

    test("should parse root command with space-separated flags and args", async () => {
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

    test("should throw error for missing required root command argument", async () => {
      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with required arg",
          args: z.text(),
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands([], (a) => a.with(RootCommand)),
        "Missing required argument",
      );
    });
  });

  describe("Root Command Global Flags", () => {
    test("should display root command flags as global flags in help", async () => {
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

    test("should parse root command flags correctly", async () => {
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
    test("should show argument usage in help for single string argument", async () => {
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

    test("should show argument usage in help for optional argument", async () => {
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

    test("should show argument usage in help for tuple arguments", async () => {
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
    test("should execute subcommand with space-separated syntax", async () => {
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

    test("should execute parent handler when subcommand is not provided", async () => {
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

    test("should provide help() function in handler args", async () => {
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

    test("should pass flags to subcommand", async () => {
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

    test("should pass arguments to subcommand", async () => {
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

    test("should show subcommands in help output", async () => {
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

    test("should support colon notation for backwards compatibility", async () => {
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

    test("should not show child commands in top-level help", async () => {
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

    test("should execute subcommand by alias", async () => {
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
    test("should pass validated env vars to handler", async () => {
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

    test("should throw error for missing required env var", async () => {
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
        setupTestCommands(["test"], (a) => a.with(TestCommands)),
        "Missing required environment variable: REQUIRED_VAR",
      );
    });

    test("should handle optional env vars", async () => {
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

    test("should handle optional env vars with defaults", async () => {
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

    test("should show env vars in help output", async () => {
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

    test("should throw error for multiple missing env vars", async () => {
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
        setupTestCommands(["test"], (a) => a.with(TestCommands)),
        "Missing required environment variables: VAR_ONE, VAR_TWO",
      );
    });
  });

  describe("mode option", () => {
    test("should pass mode value to handler when --mode flag is used", async () => {
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

    test("should pass mode value with -m shorthand", async () => {
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

    test("should pass mode value with --mode=value syntax", async () => {
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

    test("should pass undefined mode when flag is not provided", async () => {
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

    test("should throw error when --mode is used without value", async () => {
      class TestCommands {
        build = $command({
          name: "build",
          mode: true,
          handler: vi.fn(),
        });
      }

      await expectUsageError(
        setupTestCommands(["build", "--mode"], (a) => a.with(TestCommands)),
        "Flag --mode requires a value.",
      );
    });

    test("should show --mode flag in help when mode option is enabled", async () => {
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

    test("should not show --mode flag when mode option is disabled", async () => {
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

    test("should use string mode as default when no --mode flag provided", async () => {
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

    test("should override string default mode when --mode flag provided", async () => {
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

    test("should show default mode in help when mode is a string", async () => {
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
