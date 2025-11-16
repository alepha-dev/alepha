import { Alepha, AlephaError, t } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, test, vi } from "vitest";
import { $command, CommandError, cliOptions } from "../../src/command";

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
        flags: t.object({
          name: t.text({ description: "Name to greet." }),
          times: t.optional(t.int({ default: 1 })),
        }),
        handler: mockHandlers.greet,
      });

      deploy = $command({
        description: "Deploys the application.",
        flags: t.object({
          production: t.optional(
            t.boolean({ description: "Deploy to production." }),
          ),
          "api-key": t.text({
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
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
      })
      .with(TestCommands);

    if (argv) {
      alepha.state.mut(cliOptions, (old) => ({
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
  });

  describe("Error Handling", () => {
    test("should log an error for an unknown command", async () => {
      const { mockLogger } = await setupTestCommands(["non-existent-command"]);

      const errorLog = mockLogger.logs.find((l) => l.level === "ERROR");
      expect(errorLog).toBeDefined();
      expect(errorLog?.message).toBe("Unknown command: 'non-existent-command'");
      // It should also print help
      expect(mockLogger.logs.some((l) => l.message === "Commands:")).toBe(true);
    });

    test("should throw a CommandError for missing flag values", async () => {
      await expect(() =>
        setupTestCommands(["greet", "--name"]),
      ).rejects.toThrow("Flag --name requires a value");
    });

    test("should throw a CommandError for invalid flag types", async () => {
      await expect(() =>
        setupTestCommands(["greet", "--name=Test", "--times=not-a-number"]),
      ).rejects.toThrow("Invalid flag: /times must be integer");
    });
  });

  describe("Help Message", () => {
    test("should print general help with --help flag", async () => {
      const { mockLogger } = await setupTestCommands(["--help"], (alepha) => {
        alepha.state.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
          description: "My awesome CLI tool.",
        }));
      });

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("My awesome CLI tool.");
      expect(output).toContain("Commands:");
      expect(output).toContain("my-cli greet, g");
      expect(output).toContain("my-cli deploy");
      expect(output).toContain("Flags:");
      expect(output).toContain("-h, --help");
    });

    test("should print command-specific help", async () => {
      const { mockLogger } = await setupTestCommands(
        ["greet", "-h"],
        (alepha) =>
          alepha.state.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          })),
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("Usage: `my-cli greet`");
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
          args: t.text(),
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
          args: t.number(),
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
          args: t.int(),
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
          args: t.boolean(),
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
          args: t.optional(t.text()),
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
          args: t.optional(t.text()),
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
          args: t.tuple([t.text(), t.number()]),
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
          args: t.tuple([t.text(), t.optional(t.number())]),
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
          flags: t.object({
            verbose: t.optional(t.boolean()),
          }),
          args: t.tuple([t.text(), t.number()]),
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
          args: t.text(),
          handler: vi.fn(),
        });
      }

      await expect(() =>
        setupTestCommands(["cmd"], (a) => a.with(TestCommand)),
      ).rejects.toThrow("Missing required argument");
    });

    test("should throw error for invalid number argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with number arg",
          args: t.number(),
          handler: vi.fn(),
        });
      }

      await expect(() =>
        setupTestCommands(["cmd", "not-a-number"], (a) => a.with(TestCommand)),
      ).rejects.toThrow('Expected number, got "not-a-number"');
    });

    test("should throw error for invalid integer argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with integer arg",
          args: t.int(),
          handler: vi.fn(),
        });
      }

      await expect(() =>
        setupTestCommands(["cmd", "42.5"], (a) => a.with(TestCommand)),
      ).rejects.toThrow('Expected integer, got "42.5"');
    });

    test("should throw error for invalid boolean argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with boolean arg",
          args: t.boolean(),
          handler: vi.fn(),
        });
      }

      await expect(() =>
        setupTestCommands(["cmd", "not-a-boolean"], (a) => a.with(TestCommand)),
      ).rejects.toThrow('Expected boolean, got "not-a-boolean"');
    });

    test("should throw error for missing required tuple argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args",
          args: t.tuple([t.text(), t.number()]),
          handler: vi.fn(),
        });
      }

      await expect(() =>
        setupTestCommands(["cmd", "hello"], (a) => a.with(TestCommand)),
      ).rejects.toThrow("Missing required argument at position 2");
    });
  });

  describe("Root Command Global Flags", () => {
    test("should display root command flags as global flags in help", async () => {
      const mockRootHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command",
          flags: t.object({
            verbose: t.optional(
              t.boolean({ description: "Enable verbose output." }),
            ),
            config: t.optional(
              t.text({
                description: "Path to config file.",
                alias: "c",
              }),
            ),
          }),
          handler: mockRootHandler,
        });
      }

      const { mockLogger } = await setupTestCommands(["--help"], (alepha) => {
        alepha.state.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
          description: "My awesome CLI tool.",
        }));
        alepha.with(RootCommand);
      });

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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
          flags: t.object({
            verbose: t.optional(t.boolean({ description: "Verbose mode." })),
            output: t.text({ description: "Output file." }),
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
          args: t.text(),
          handler: vi.fn(),
        });
      }

      const { mockLogger } = await setupTestCommands(
        ["cmd", "--help"],
        (alepha) => {
          alepha.state.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("Usage: `test-cli cmd <arg1>`");
    });

    test("should show argument usage in help for optional argument", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with optional arg",
          args: t.optional(t.text()),
          handler: vi.fn(),
        });
      }

      const { mockLogger } = await setupTestCommands(
        ["cmd", "--help"],
        (alepha) => {
          alepha.state.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("Usage: `test-cli cmd [arg1]`");
    });

    test("should show argument usage in help for tuple arguments", async () => {
      class TestCommand {
        cmd = $command({
          description: "Test command with tuple args",
          args: t.tuple([t.text(), t.optional(t.number())]),
          handler: vi.fn(),
        });
      }

      const { mockLogger } = await setupTestCommands(
        ["cmd", "--help"],
        (alepha) => {
          alepha.state.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("Usage: `test-cli cmd <arg1> [arg2: number]`");
    });
  });
});
