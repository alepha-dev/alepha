import { Alepha, AlephaError, t } from "alepha";
import {
  LogDestinationProvider,
  MemoryDestinationProvider,
} from "alepha/logger";
import { describe, expect, test, vi } from "vitest";
import { $command, CommandError, cliOptions } from "../index.ts";

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
          times: t.optional(t.integer({ default: 1 })),
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
        NO_COLOR: "true",
      },
    })
      .with({
        provide: LogDestinationProvider,
        use: MemoryDestinationProvider,
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
          flags: t.object({
            output: t.text({ alias: "o" }),
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
          flags: t.object({
            data: t.object({
              name: t.string(),
              age: t.number(),
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
          flags: t.object({
            items: t.array(t.string()),
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
      await expect(() =>
        setupTestCommands(["greet", "--name", "--times=5"]),
      ).rejects.toThrow("Flag --name requires a value");
    });

    test("should throw error when space-separated value is missing (end of args)", async () => {
      await expect(() =>
        setupTestCommands(["greet", "--name"]),
      ).rejects.toThrow("Flag --name requires a value");
    });
  });

  describe("Error Handling", () => {
    test("should log an error for an unknown command", async () => {
      const { mockLogger } = await setupTestCommands(["non-existent-command"]);

      const errorLog = mockLogger.logs.find((l) => l.level === "ERROR");
      expect(errorLog).toBeDefined();
      expect(errorLog?.message).toBe("Unknown command: 'non-existent-command'");
      // It should also print help
      expect(mockLogger.logs.some((l) => l.message.includes("Commands:"))).toBe(
        true,
      );
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
        alepha.store.mut(cliOptions, (old) => ({
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
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          })),
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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
          args: t.integer(),
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

    test("should handle arguments with space-separated flags", async () => {
      const mockHandler = vi.fn();

      class TestCommand {
        cmd = $command({
          description: "Test command with args and space-separated flags",
          flags: t.object({
            output: t.text(),
          }),
          args: t.text(),
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
          flags: t.object({
            config: t.text(),
            verbose: t.optional(t.boolean()),
          }),
          args: t.tuple([t.text(), t.number()]),
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
          args: t.integer(),
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

  describe("Root Command with Arguments", () => {
    test("should parse single string argument for root command", async () => {
      const mockHandler = vi.fn();

      class RootCommand {
        root = $command({
          name: "",
          description: "Root command with string arg",
          args: t.text(),
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
          args: t.optional(t.text()),
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
          args: t.optional(t.text()),
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
          args: t.tuple([t.text(), t.number()]),
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
          flags: t.object({
            verbose: t.optional(t.boolean()),
          }),
          args: t.text(),
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
          flags: t.object({
            config: t.text(),
          }),
          args: t.text(),
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
          args: t.text(),
          handler: vi.fn(),
        });
      }

      await expect(() =>
        setupTestCommands([], (a) => a.with(RootCommand)),
      ).rejects.toThrow("Missing required argument");
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
        alepha.store.mut(cliOptions, (old) => ({
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
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("Usage: test-cli cmd <arg1>");
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
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("Usage: test-cli cmd [arg1]");
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
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "test-cli",
          }));
          alepha.with(TestCommand);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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

      const { mockLogger } = await setupTestCommands(["deploy"], (alepha) => {
        alepha.store.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
        }));
        alepha.with(TestCommands);
      });

      expect(helpFn).toBeDefined();
      const output = mockLogger.logs.map((l) => l.message).join("\n");
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
          flags: t.object({
            prod: t.optional(t.boolean()),
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
          args: t.optional(t.text()),
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

      const { mockLogger } = await setupTestCommands(
        ["deploy", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          }));
          alepha.with(TestCommands);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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

      const { mockLogger } = await setupTestCommands(["--help"], (alepha) => {
        alepha.store.mut(cliOptions, (old) => ({
          ...old,
          name: "my-cli",
        }));
        alepha.with(TestCommands);
      });

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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
          env: t.object({
            MY_TOKEN: t.text({ description: "API token" }),
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
          env: t.object({
            REQUIRED_VAR: t.text({ description: "Required variable" }),
          }),
          handler: vi.fn(),
        });
      }

      // Ensure env var is not set
      delete process.env.REQUIRED_VAR;

      await expect(
        setupTestCommands(["test"], (a) => a.with(TestCommands)),
      ).rejects.toThrow("Missing required environment variable: REQUIRED_VAR");
    });

    test("should handle optional env vars", async () => {
      let receivedEnv: any;

      class TestCommands {
        cmd = $command({
          name: "test",
          env: t.object({
            OPTIONAL_VAR: t.optional(t.text({ description: "Optional" })),
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
          env: t.object({
            MY_VAR: t.optional(t.text({ default: "default_value" })),
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
          env: t.object({
            API_TOKEN: t.text({ description: "API token for authentication" }),
            ORG_ID: t.optional(t.text({ description: "Organization ID" })),
          }),
          handler: vi.fn(),
        });
      }

      const { mockLogger } = await setupTestCommands(
        ["test", "--help"],
        (alepha) => {
          alepha.store.mut(cliOptions, (old) => ({
            ...old,
            name: "my-cli",
          }));
          alepha.with(TestCommands);
        },
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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
          env: t.object({
            VAR_ONE: t.text(),
            VAR_TWO: t.text(),
          }),
          handler: vi.fn(),
        });
      }

      delete process.env.VAR_ONE;
      delete process.env.VAR_TWO;

      await expect(
        setupTestCommands(["test"], (a) => a.with(TestCommands)),
      ).rejects.toThrow(
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

      await expect(
        setupTestCommands(["build", "--mode"], (a) => a.with(TestCommands)),
      ).rejects.toThrow("Flag --mode requires a value.");
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

      const { mockLogger } = await setupTestCommands(["build", "-h"], (a) =>
        a.with(TestCommands),
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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

      const { mockLogger } = await setupTestCommands(["build", "-h"], (a) =>
        a.with(TestCommands),
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
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

      const { mockLogger } = await setupTestCommands(["deploy", "-h"], (a) =>
        a.with(TestCommands),
      );

      const output = mockLogger.logs.map((l) => l.message).join("\n");
      expect(output).toContain("-m, --mode");
      expect(output).toContain("default: production");
    });
  });
});
